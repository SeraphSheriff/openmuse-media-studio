import { readFile } from "node:fs/promises";
import { basename } from "node:path";
import { readVideoSettings } from "./video-settings.js";

const COMFY_URL = process.env.COMFYUI_URL?.trim() || "http://127.0.0.1:8188";

function dimensionsFor(aspectRatio: string): { width: number; height: number } {
  if (aspectRatio === "16:9") return { width: 1280, height: 720 };
  if (aspectRatio === "9:16") return { width: 720, height: 1280 };
  if (aspectRatio === "4:3") return { width: 1152, height: 864 };
  if (aspectRatio === "3:4") return { width: 864, height: 1152 };
  return { width: 1024, height: 1024 };
}

async function uploadImageToComfy(absPath: string): Promise<string> {
  const bytes = await readFile(absPath);
  const name = `openmuse_img_${Date.now()}_${basename(absPath)}`;
  const form = new FormData();
  form.append("image", new Blob([bytes]), name);
  form.append("overwrite", "true");
  const res = await fetch(`${COMFY_URL}/upload/image`, { method: "POST", body: form });
  if (!res.ok) throw new Error(`ComfyUI image upload failed (${res.status})`);
  const data = (await res.json()) as { name?: string };
  return data.name || name;
}

async function runGraphAndFetchPng(graph: Record<string, unknown>): Promise<Uint8Array> {
  const qRes = await fetch(`${COMFY_URL}/prompt`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ prompt: graph }),
  });
  if (!qRes.ok) {
    throw new Error(`ComfyUI image queue failed (${qRes.status}): ${await qRes.text()}`);
  }
  const { prompt_id: promptId } = (await qRes.json()) as { prompt_id: string };
  const deadline = Date.now() + 240_000;
  while (Date.now() < deadline) {
    await new Promise((r) => setTimeout(r, 700));
    const hRes = await fetch(`${COMFY_URL}/history/${promptId}`);
    if (!hRes.ok) continue;
    const hist = (await hRes.json()) as Record<
      string,
      {
        status?: { status_str?: string; messages?: unknown[] };
        outputs?: Record<
          string,
          { images?: Array<{ filename: string; subfolder: string; type: string }> }
        >;
      }
    >;
    const job = hist[promptId];
    if (!job) continue;
    if (job.status?.status_str === "error") {
      throw new Error(`Image render failed: ${JSON.stringify(job.status.messages ?? [])}`);
    }
    for (const out of Object.values(job.outputs ?? {})) {
      const img = out.images?.[0];
      if (img) {
        const params = new URLSearchParams({
          filename: img.filename,
          subfolder: img.subfolder ?? "",
          type: img.type ?? "output",
        });
        const vRes = await fetch(`${COMFY_URL}/view?${params.toString()}`);
        if (!vRes.ok) throw new Error(`ComfyUI /view failed (${vRes.status})`);
        return new Uint8Array(await vRes.arrayBuffer());
      }
    }
  }
  throw new Error("Timed out waiting for ComfyUI image output");
}

function buildImageGraph(opts: {
  engine: string;
  prompt: string;
  negPrompt: string;
  width: number;
  height: number;
  steps: number;
  cfgScale: number;
  denoise: number;
  uploadedImage?: string;
  uploadedMask?: string;
}): Record<string, unknown> {
  const seed = Math.floor(Math.random() * 1_000_000_000);
  if (opts.engine === "flux_kontext" && opts.uploadedImage) {
    return {
      "1": {
        class_type: "UNETLoader",
        inputs: {
          unet_name: "flux1-dev-kontext_fp8_scaled.safetensors",
          weight_dtype: "fp8_e4m3fn",
        },
      },
      "2": {
        class_type: "DualCLIPLoader",
        inputs: {
          clip_name1: "t5xxl_fp8_e4m3fn.safetensors",
          clip_name2: "clip_l.safetensors",
          type: "flux",
          device: "default",
        },
      },
      "3": { class_type: "VAELoader", inputs: { vae_name: "ae.safetensors" } },
      "7": { class_type: "LoadImage", inputs: { image: opts.uploadedImage } },
      "12": { class_type: "VAEEncode", inputs: { pixels: ["7", 0], vae: ["3", 0] } },
      "4": { class_type: "CLIPTextEncode", inputs: { clip: ["2", 0], text: opts.prompt } },
      "14": {
        class_type: "ReferenceLatent",
        inputs: { conditioning: ["4", 0], latent: ["12", 0] },
      },
      "5": {
        class_type: "FluxGuidance",
        inputs: { conditioning: ["14", 0], guidance: Math.max(2.5, opts.cfgScale) },
      },
      "6": { class_type: "CLIPTextEncode", inputs: { clip: ["2", 0], text: opts.negPrompt } },
      ...(opts.uploadedMask
        ? {
            "13": {
              class_type: "LoadImageMask",
              inputs: { image: opts.uploadedMask, channel: "alpha" },
            },
            "11": {
              class_type: "SetLatentNoiseMask",
              inputs: { samples: ["12", 0], mask: ["13", 0] },
            },
          }
        : {
            "11": { class_type: "VAEEncode", inputs: { pixels: ["7", 0], vae: ["3", 0] } },
          }),
      "8": {
        class_type: "KSampler",
        inputs: {
          model: ["1", 0],
          positive: ["5", 0],
          negative: ["6", 0],
          latent_image: ["11", 0],
          seed,
          steps: Math.max(20, opts.steps),
          cfg: 1.0,
          sampler_name: "euler",
          scheduler: "simple",
          denoise: opts.uploadedMask ? 0.88 : 1.0,
        },
      },
      "9": { class_type: "VAEDecode", inputs: { samples: ["8", 0], vae: ["3", 0] } },
      ...(opts.uploadedMask
        ? {
            "15": {
              class_type: "ImageCompositeMasked",
              inputs: {
                destination: ["7", 0],
                source: ["9", 0],
                mask: ["13", 0],
                x: 0,
                y: 0,
                resize_source: false,
              },
            },
            "10": {
              class_type: "SaveImage",
              inputs: { images: ["15", 0], filename_prefix: "openmuse_kontext" },
            },
          }
        : {
            "10": {
              class_type: "SaveImage",
              inputs: { images: ["9", 0], filename_prefix: "openmuse_kontext" },
            },
          }),
    };
  }
  if (opts.engine === "flux_dev") {
    return {
      "1": {
        class_type: "UNETLoader",
        inputs: { unet_name: "flux1-dev-fp8.safetensors", weight_dtype: "fp8_e4m3fn" },
      },
      "2": {
        class_type: "DualCLIPLoader",
        inputs: {
          clip_name1: "t5xxl_fp8_e4m3fn.safetensors",
          clip_name2: "clip_l.safetensors",
          type: "flux",
          device: "default",
        },
      },
      "3": { class_type: "VAELoader", inputs: { vae_name: "ae.safetensors" } },
      "4": { class_type: "CLIPTextEncode", inputs: { clip: ["2", 0], text: opts.prompt } },
      "5": {
        class_type: "FluxGuidance",
        inputs: { conditioning: ["4", 0], guidance: Math.max(1.5, opts.cfgScale) },
      },
      "6": { class_type: "CLIPTextEncode", inputs: { clip: ["2", 0], text: opts.negPrompt } },
      ...(opts.uploadedImage
        ? {
            "7": { class_type: "LoadImage", inputs: { image: opts.uploadedImage } },
            "12": { class_type: "VAEEncode", inputs: { pixels: ["7", 0], vae: ["3", 0] } },
            ...(opts.uploadedMask
              ? {
                  "13": {
                    class_type: "LoadImageMask",
                    inputs: { image: opts.uploadedMask, channel: "alpha" },
                  },
                  "11": {
                    class_type: "SetLatentNoiseMask",
                    inputs: { samples: ["12", 0], mask: ["13", 0] },
                  },
                }
              : {
                  "11": { class_type: "VAEEncode", inputs: { pixels: ["7", 0], vae: ["3", 0] } },
                }),
          }
        : {
            "11": {
              class_type: "EmptySD3LatentImage",
              inputs: { width: opts.width, height: opts.height, batch_size: 1 },
            },
          }),
      "8": {
        class_type: "KSampler",
        inputs: {
          model: ["1", 0],
          positive: ["5", 0],
          negative: ["6", 0],
          latent_image: ["11", 0],
          seed,
          steps: Math.max(16, opts.steps),
          cfg: 1.0,
          sampler_name: "euler",
          scheduler: "simple",
          denoise: opts.denoise,
        },
      },
      "9": { class_type: "VAEDecode", inputs: { samples: ["8", 0], vae: ["3", 0] } },
      "10": {
        class_type: "SaveImage",
        inputs: { images: ["9", 0], filename_prefix: "openmuse_flux" },
      },
    };
  }
  return {
    "1": {
      class_type: "UNETLoader",
      inputs: { unet_name: "z_image_turbo_bf16.safetensors", weight_dtype: "default" },
    },
    "2": {
      class_type: "CLIPLoader",
      inputs: { clip_name: "qwen_3_4b.safetensors", type: "lumina2", device: "default" },
    },
    "3": { class_type: "VAELoader", inputs: { vae_name: "ae.safetensors" } },
    "4": { class_type: "ModelSamplingAuraFlow", inputs: { model: ["1", 0], shift: 3.0 } },
    "5": { class_type: "CLIPTextEncode", inputs: { clip: ["2", 0], text: opts.prompt } },
    "6": { class_type: "CLIPTextEncode", inputs: { clip: ["2", 0], text: opts.negPrompt } },
    ...(opts.uploadedImage
      ? {
          "7": { class_type: "LoadImage", inputs: { image: opts.uploadedImage } },
          "12": { class_type: "VAEEncode", inputs: { pixels: ["7", 0], vae: ["3", 0] } },
          ...(opts.uploadedMask
            ? {
                "13": {
                  class_type: "LoadImageMask",
                  inputs: { image: opts.uploadedMask, channel: "alpha" },
                },
                "11": {
                  class_type: "SetLatentNoiseMask",
                  inputs: { samples: ["12", 0], mask: ["13", 0] },
                },
              }
            : {
                "11": { class_type: "VAEEncode", inputs: { pixels: ["7", 0], vae: ["3", 0] } },
              }),
        }
      : {
          "7": {
            class_type: "EmptySD3LatentImage",
            inputs: { width: opts.width, height: opts.height, batch_size: 1 },
          },
          "11": {
            class_type: "EmptySD3LatentImage",
            inputs: { width: opts.width, height: opts.height, batch_size: 1 },
          },
        }),
    "8": {
      class_type: "KSampler",
      inputs: {
        model: ["4", 0],
        positive: ["5", 0],
        negative: ["6", 0],
        latent_image: ["11", 0],
        seed,
        steps: opts.steps,
        cfg: opts.cfgScale,
        sampler_name: "res_multistep",
        scheduler: "simple",
        denoise: opts.denoise,
      },
    },
    "9": { class_type: "VAEDecode", inputs: { samples: ["8", 0], vae: ["3", 0] } },
    "10": {
      class_type: "SaveImage",
      inputs: { images: ["9", 0], filename_prefix: "openmuse_zimage" },
    },
  };
}

export async function renderLocalZImage(prompt: string, aspectRatio: string): Promise<Uint8Array> {
  const cfg = await readVideoSettings();
  const { width, height } = dimensionsFor(aspectRatio);
  return runGraphAndFetchPng(
    buildImageGraph({
      engine:
        String(cfg.imageEngine || "z_image_turbo") === "flux_kontext"
          ? "flux_dev"
          : String(cfg.imageEngine || "z_image_turbo"),
      prompt,
      negPrompt: typeof cfg.imageNegativePrompt === "string" ? cfg.imageNegativePrompt : "",
      width,
      height,
      steps: Number(cfg.imageSteps) || 8,
      cfgScale: Number(cfg.imageCfg) || 1.0,
      denoise: 1.0,
    }),
  );
}

export async function editLocalZImage(
  absImagePath: string,
  prompt: string,
  overrideDenoise?: number,
  maskPngPath?: string,
): Promise<Uint8Array> {
  const cfg = await readVideoSettings();
  const uploaded = await uploadImageToComfy(absImagePath);
  const uploadedMask = maskPngPath ? await uploadImageToComfy(maskPngPath) : undefined;
  const wantExact = /\b(exact|same|preserve|keep|identical)\b/i.test(prompt);
  const editEngine =
    wantExact || cfg.imageEngine === "flux_kontext" || cfg.editEngine === "flux_kontext"
      ? "flux_kontext"
      : String(cfg.imageEngine || "z_image_turbo");
  return runGraphAndFetchPng(
    buildImageGraph({
      engine: editEngine,
      prompt,
      negPrompt: typeof cfg.imageNegativePrompt === "string" ? cfg.imageNegativePrompt : "",
      width: 1024,
      height: 1024,
      steps: Number(cfg.imageSteps) || 8,
      cfgScale: Number(cfg.imageCfg) || 1.0,
      denoise:
        typeof overrideDenoise === "number"
          ? overrideDenoise
          : uploadedMask
            ? 0.85
            : Number(cfg.imageDenoise) || 0.3,
      uploadedImage: uploaded,
      uploadedMask,
    }),
  );
}

export async function eraseMaskedRegion(
  absImagePath: string,
  maskPngPath: string,
  fillPrompt = "clean seamless natural background texture, empty space, photorealistic, high detail, consistent lighting",
): Promise<Uint8Array> {
  const uploaded = await uploadImageToComfy(absImagePath);
  const uploadedMask = await uploadImageToComfy(maskPngPath);
  return runGraphAndFetchPng({
    "1": {
      class_type: "UNETLoader",
      inputs: { unet_name: "flux1-dev-fp8.safetensors", weight_dtype: "fp8_e4m3fn" },
    },
    "2": {
      class_type: "DualCLIPLoader",
      inputs: {
        clip_name1: "t5xxl_fp8_e4m3fn.safetensors",
        clip_name2: "clip_l.safetensors",
        type: "flux",
        device: "default",
      },
    },
    "3": { class_type: "VAELoader", inputs: { vae_name: "ae.safetensors" } },
    "7": { class_type: "LoadImage", inputs: { image: uploaded } },
    "12": { class_type: "VAEEncode", inputs: { pixels: ["7", 0], vae: ["3", 0] } },
    "13": { class_type: "LoadImageMask", inputs: { image: uploadedMask, channel: "alpha" } },
    "11": { class_type: "SetLatentNoiseMask", inputs: { samples: ["12", 0], mask: ["13", 0] } },
    "4": { class_type: "CLIPTextEncode", inputs: { clip: ["2", 0], text: fillPrompt } },
    "5": { class_type: "FluxGuidance", inputs: { conditioning: ["4", 0], guidance: 3.5 } },
    "6": {
      class_type: "CLIPTextEncode",
      inputs: { clip: ["2", 0], text: "object, artifact, distortion, blur, seam" },
    },
    "8": {
      class_type: "KSampler",
      inputs: {
        model: ["1", 0],
        positive: ["5", 0],
        negative: ["6", 0],
        latent_image: ["11", 0],
        seed: Math.floor(Math.random() * 2147483647),
        steps: 28,
        cfg: 1.0,
        sampler_name: "euler",
        scheduler: "simple",
        denoise: 1.0,
      },
    },
    "9": { class_type: "VAEDecode", inputs: { samples: ["8", 0], vae: ["3", 0] } },
    "15": {
      class_type: "ImageCompositeMasked",
      inputs: {
        destination: ["7", 0],
        source: ["9", 0],
        mask: ["13", 0],
        x: 0,
        y: 0,
        resize_source: false,
      },
    },
    "10": {
      class_type: "SaveImage",
      inputs: { images: ["15", 0], filename_prefix: "openmuse_erased" },
    },
  });
}

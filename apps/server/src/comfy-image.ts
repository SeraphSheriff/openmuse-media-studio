import { existsSync } from "node:fs";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { homedir } from "node:os";
import { basename, resolve } from "node:path";
import { detectModelFamily, readVideoSettings } from "./video-settings.js";

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

function inferSlotType(inputName: string): string {
  if (inputName.includes("model")) return "MODEL";
  if (inputName.includes("clip")) return "CLIP";
  if (inputName.includes("vae")) return "VAE";
  if (
    inputName.includes("positive") ||
    inputName.includes("negative") ||
    inputName.includes("conditioning")
  )
    return "CONDITIONING";
  if (inputName.includes("latent") || inputName.includes("samples")) return "LATENT";
  if (
    inputName.includes("image") ||
    inputName.includes("pixels") ||
    inputName.includes("destination") ||
    inputName.includes("source")
  )
    return "IMAGE";
  if (inputName.includes("mask")) return "MASK";
  return "*";
}

function apiGraphToUiWorkflow(graph: Record<string, unknown>) {
  const entries = Object.entries(graph);
  const links: Array<[number, number, number, number, number, string]> = [];
  const outLinks = new Map<string, number[]>();
  const inLink = new Map<string, number>();
  let nextLink = 1;

  for (const [dstKey, rawNode] of entries) {
    const dstId = Number(dstKey);
    const inputs = (rawNode as { inputs?: Record<string, unknown> })?.inputs ?? {};
    for (const [inName, val] of Object.entries(inputs)) {
      if (Array.isArray(val) && val.length === 2 && typeof val[1] === "number") {
        const srcId = Number(val[0]);
        const srcSlot = val[1];
        const linkId = nextLink++;
        const dstInputs = Object.entries(inputs).filter(
          ([, v]) => Array.isArray(v) && v.length === 2 && typeof v[1] === "number",
        );
        const dstSlot = dstInputs.findIndex(([k]) => k === inName);
        links.push([linkId, srcId, srcSlot, dstId, Math.max(0, dstSlot), inferSlotType(inName)]);
        const oKey = `${srcId}:${srcSlot}`;
        outLinks.set(oKey, [...(outLinks.get(oKey) ?? []), linkId]);
        inLink.set(`${dstId}:${inName}`, linkId);
      }
    }
  }

  const colMap: Record<string, number> = {
    UNETLoader: 0,
    DualCLIPLoader: 0,
    CLIPLoader: 0,
    VAELoader: 0,
    LoadImage: 0,
    LoadImageMask: 0,
    EmptySD3LatentImage: 0,
    LoraLoader: 1,
    ModelSamplingAuraFlow: 1,
    CLIPTextEncode: 1,
    VAEEncode: 1,
    FluxGuidance: 2,
    ReferenceLatent: 2,
    SetLatentNoiseMask: 2,
    KSampler: 3,
    VAEDecode: 4,
    ImageCompositeMasked: 4,
    SaveImage: 5,
  };
  const colCounts: Record<number, number> = {};
  const nodes = entries.map(([key, rawNode]) => {
    const id = Number(key);
    const node = rawNode as { class_type: string; inputs?: Record<string, unknown> };
    const col = colMap[node.class_type] ?? 2;
    const row = colCounts[col] ?? 0;
    colCounts[col] = row + 1;
    const inputsObj = node.inputs ?? {};
    const nodeInputs = Object.entries(inputsObj)
      .filter(([, v]) => Array.isArray(v) && v.length === 2)
      .map(([name]) => ({
        name,
        type: inferSlotType(name),
        link: inLink.get(`${id}:${name}`) ?? null,
      }));
    const widgetValues = Object.entries(inputsObj)
      .filter(([, v]) => !(Array.isArray(v) && v.length === 2))
      .flatMap(([k, v]) =>
        node.class_type === "KSampler" && k === "seed"
          ? [v, "fixed"]
          : node.class_type === "LoadImage" && k === "image"
            ? [v, "image"]
            : [v],
      );
    const outTypes =
      node.class_type === "LoraLoader"
        ? ["MODEL", "CLIP"]
        : node.class_type === "KSampler" ||
            node.class_type === "VAEEncode" ||
            node.class_type === "EmptySD3LatentImage" ||
            node.class_type === "ReferenceLatent" ||
            node.class_type === "SetLatentNoiseMask"
          ? ["LATENT"]
          : node.class_type === "VAEDecode" ||
              node.class_type === "LoadImage" ||
              node.class_type === "ImageCompositeMasked"
            ? ["IMAGE"]
            : node.class_type === "LoadImageMask"
              ? ["MASK"]
              : node.class_type === "VAELoader"
                ? ["VAE"]
                : node.class_type.includes("CLIP") && !node.class_type.includes("Encode")
                  ? ["CLIP"]
                  : node.class_type.includes("Encode") || node.class_type === "FluxGuidance"
                    ? ["CONDITIONING"]
                    : node.class_type === "SaveImage"
                      ? []
                      : ["MODEL"];
    const nodeOutputs = outTypes.map((t, slot) => ({
      name: t,
      type: t,
      links: outLinks.get(`${id}:${slot}`) ?? [],
      slot_index: slot,
    }));
    return {
      id,
      type: node.class_type,
      pos: [80 + col * 340, 80 + row * 230],
      size: [300, 180],
      flags: {},
      order: col * 10 + row,
      mode: 0,
      inputs: nodeInputs,
      outputs: nodeOutputs,
      properties: { "Node name for S&R": node.class_type },
      widgets_values: widgetValues,
    };
  });

  return {
    last_node_id: Math.max(20, ...nodes.map((n) => n.id)),
    last_link_id: nextLink - 1,
    nodes,
    links,
    groups: [],
    config: {},
    extra: {},
    version: 0.4,
  };
}

async function runGraphAndFetchPng(graph: Record<string, unknown>): Promise<Uint8Array> {
  const uiWorkflow = apiGraphToUiWorkflow(graph);
  const wfDir = resolve(homedir(), "ComfyUI", "user", "default", "workflows");
  await mkdir(wfDir, { recursive: true }).catch(() => {});
  await writeFile(resolve(wfDir, "OpenMuse_Live.json"), JSON.stringify(uiWorkflow, null, 2)).catch(
    () => {},
  );
  const qRes = await fetch(`${COMFY_URL}/prompt`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      prompt: graph,
      extra_data: { extra_pnginfo: { workflow: uiWorkflow } },
    }),
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

type ActiveLora = { loraName: string; loraStrength: number };

async function resolveCompatibleImageLoras(
  cfg: Record<string, unknown>,
  engine: string,
): Promise<ActiveLora[]> {
  const candidates: ActiveLora[] = [];
  const primary = typeof cfg.loraName === "string" ? cfg.loraName.trim() : "";
  const pStr = Number(cfg.loraStrength);
  if (primary) {
    candidates.push({
      loraName: primary,
      loraStrength: Number.isFinite(pStr) && pStr > 0 ? Math.min(2, pStr) : 0.75,
    });
  }
  try {
    const rawExtra =
      typeof cfg.extraLoras === "string" ? JSON.parse(cfg.extraLoras) : cfg.extraLoras;
    if (Array.isArray(rawExtra)) {
      for (const item of rawExtra) {
        const name = typeof item?.name === "string" ? item.name.trim() : "";
        const str = Number(item?.strength);
        if (name && !candidates.some((c) => c.loraName === name)) {
          candidates.push({
            loraName: name,
            loraStrength: Number.isFinite(str) && str > 0 ? Math.min(2, str) : 0.75,
          });
        }
      }
    }
  } catch {}
  const isFlux = engine === "flux_dev" || engine === "flux_kontext";
  const compatible: ActiveLora[] = [];
  for (const item of candidates) {
    const abs = resolve(homedir(), "ComfyUI", "models", "loras", item.loraName);
    if (!existsSync(abs)) continue;
    const fam = await detectModelFamily(abs, item.loraName);
    if (isFlux && fam !== "FLUX" && fam !== "Universal") continue;
    if (!isFlux && fam !== "Z-Image" && fam !== "Universal") continue;
    compatible.push(item);
  }
  return compatible;
}

function buildLoraChain(loras: ActiveLora[] | undefined): {
  nodes: Record<string, unknown>;
  modelRef: [string, number];
  clipRef: [string, number];
} {
  const nodes: Record<string, unknown> = {};
  let modelRef: [string, number] = ["1", 0];
  let clipRef: [string, number] = ["2", 0];
  (loras ?? []).forEach((item, idx) => {
    const id = String(20 + idx);
    nodes[id] = {
      class_type: "LoraLoader",
      inputs: {
        model: modelRef,
        clip: clipRef,
        lora_name: item.loraName,
        strength_model: item.loraStrength,
        strength_clip: item.loraStrength,
      },
    };
    modelRef = [id, 0];
    clipRef = [id, 1];
  });
  return { nodes, modelRef, clipRef };
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
  loras?: ActiveLora[];
}): Record<string, unknown> {
  const chain = buildLoraChain(opts.loras);
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
    const modelRef = chain.modelRef;
    const clipRef = chain.clipRef;
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
      ...chain.nodes,
      "3": { class_type: "VAELoader", inputs: { vae_name: "ae.safetensors" } },
      "4": { class_type: "CLIPTextEncode", inputs: { clip: clipRef, text: opts.prompt } },
      "5": {
        class_type: "FluxGuidance",
        inputs: { conditioning: ["4", 0], guidance: Math.max(1.5, opts.cfgScale) },
      },
      "6": { class_type: "CLIPTextEncode", inputs: { clip: clipRef, text: opts.negPrompt } },
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
          model: modelRef,
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
    ...chain.nodes,
    "4": {
      class_type: "ModelSamplingAuraFlow",
      inputs: { model: chain.modelRef, shift: 3.0 },
    },
    "5": {
      class_type: "CLIPTextEncode",
      inputs: { clip: chain.clipRef, text: opts.prompt },
    },
    "6": {
      class_type: "CLIPTextEncode",
      inputs: { clip: chain.clipRef, text: opts.negPrompt },
    },
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

export async function renderLocalZImage(
  prompt: string,
  aspectRatio: string,
  extraNegPrompt?: string,
): Promise<Uint8Array> {
  const cfg = await readVideoSettings();
  const { width, height } = dimensionsFor(aspectRatio);
  const engine =
    String(cfg.imageEngine || "z_image_turbo") === "flux_kontext"
      ? "flux_dev"
      : String(cfg.imageEngine || "z_image_turbo");
  const loras = await resolveCompatibleImageLoras(cfg, engine);
  return runGraphAndFetchPng(
    buildImageGraph({
      engine,
      prompt,
      negPrompt: [
        typeof cfg.imageNegativePrompt === "string" ? cfg.imageNegativePrompt.trim() : "",
        extraNegPrompt?.trim() || "",
      ]
        .filter(Boolean)
        .join(", "),
      width,
      height,
      steps: Number(cfg.imageSteps) || 8,
      cfgScale: Number(cfg.imageCfg) || 1.0,
      denoise: 1.0,
      loras,
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
  const loras = await resolveCompatibleImageLoras(cfg, editEngine);
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
      loras,
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

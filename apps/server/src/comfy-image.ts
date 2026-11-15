import { readFile } from "node:fs/promises";
import { basename } from "node:path";

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
    throw new Error(`ComfyUI Z-Image-Turbo queue failed (${qRes.status}): ${await qRes.text()}`);
  }
  const { prompt_id: promptId } = (await qRes.json()) as { prompt_id: string };

  const deadline = Date.now() + 180_000;
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
      throw new Error(`Z-Image-Turbo failed: ${JSON.stringify(job.status.messages ?? [])}`);
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
  throw new Error("Timed out waiting for Z-Image-Turbo output");
}

export async function renderLocalZImage(prompt: string, aspectRatio: string): Promise<Uint8Array> {
  const { width, height } = dimensionsFor(aspectRatio);
  const seed = Math.floor(Math.random() * 1_000_000_000);
  const graph: Record<string, unknown> = {
    "1": {
      class_type: "UNETLoader",
      inputs: { unet_name: "z_image_turbo_bf16.safetensors", weight_dtype: "default" },
    },
    "2": {
      class_type: "CLIPLoader",
      inputs: { clip_name: "qwen_3_4b.safetensors", type: "lumina2", device: "default" },
    },
    "3": {
      class_type: "VAELoader",
      inputs: { vae_name: "ae.safetensors" },
    },
    "4": {
      class_type: "ModelSamplingAuraFlow",
      inputs: { model: ["1", 0], shift: 3.0 },
    },
    "5": {
      class_type: "CLIPTextEncode",
      inputs: { clip: ["2", 0], text: prompt },
    },
    "6": {
      class_type: "CLIPTextEncode",
      inputs: { clip: ["2", 0], text: "" },
    },
    "7": {
      class_type: "EmptySD3LatentImage",
      inputs: { width, height, batch_size: 1 },
    },
    "8": {
      class_type: "KSampler",
      inputs: {
        model: ["4", 0],
        positive: ["5", 0],
        negative: ["6", 0],
        latent_image: ["7", 0],
        seed,
        steps: 8,
        cfg: 1.0,
        sampler_name: "res_multistep",
        scheduler: "simple",
        denoise: 1.0,
      },
    },
    "9": {
      class_type: "VAEDecode",
      inputs: { samples: ["8", 0], vae: ["3", 0] },
    },
    "10": {
      class_type: "SaveImage",
      inputs: { images: ["9", 0], filename_prefix: "openmuse_zimage" },
    },
  };
  return runGraphAndFetchPng(graph);
}

export async function editLocalZImage(absImagePath: string, prompt: string): Promise<Uint8Array> {
  const uploaded = await uploadImageToComfy(absImagePath);
  const seed = Math.floor(Math.random() * 1_000_000_000);
  const graph: Record<string, unknown> = {
    "1": {
      class_type: "UNETLoader",
      inputs: { unet_name: "z_image_turbo_bf16.safetensors", weight_dtype: "default" },
    },
    "2": {
      class_type: "CLIPLoader",
      inputs: { clip_name: "qwen_3_4b.safetensors", type: "lumina2", device: "default" },
    },
    "3": {
      class_type: "VAELoader",
      inputs: { vae_name: "ae.safetensors" },
    },
    "4": {
      class_type: "ModelSamplingAuraFlow",
      inputs: { model: ["1", 0], shift: 3.0 },
    },
    "5": {
      class_type: "CLIPTextEncode",
      inputs: { clip: ["2", 0], text: prompt },
    },
    "6": {
      class_type: "CLIPTextEncode",
      inputs: { clip: ["2", 0], text: "" },
    },
    "7": {
      class_type: "LoadImage",
      inputs: { image: uploaded },
    },
    "11": {
      class_type: "VAEEncode",
      inputs: { pixels: ["7", 0], vae: ["3", 0] },
    },
    "8": {
      class_type: "KSampler",
      inputs: {
        model: ["4", 0],
        positive: ["5", 0],
        negative: ["6", 0],
        latent_image: ["11", 0],
        seed,
        steps: 8,
        cfg: 1.0,
        sampler_name: "res_multistep",
        scheduler: "simple",
        denoise: 0.65,
      },
    },
    "9": {
      class_type: "VAEDecode",
      inputs: { samples: ["8", 0], vae: ["3", 0] },
    },
    "10": {
      class_type: "SaveImage",
      inputs: { images: ["9", 0], filename_prefix: "openmuse_zimage_edit" },
    },
  };
  return runGraphAndFetchPng(graph);
}

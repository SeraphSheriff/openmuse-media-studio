import { mkdir, readFile, writeFile } from "node:fs/promises";
import { basename, join, resolve } from "node:path";

const GEN_DIR = resolve(process.cwd(), "generated");

function comfyBase(): string {
  return (process.env.COMFYUI_URL?.trim() || "http://127.0.0.1:8188").replace(/\/+$/, "");
}

function resolveMediaInput(inputPath: string): string {
  const clean = inputPath.trim();
  if (clean.startsWith("/")) return clean;
  if (clean.startsWith("generated/")) return resolve(process.cwd(), clean);
  return resolve(GEN_DIR, basename(clean));
}

async function uploadAudioToComfy(localPath: string): Promise<string> {
  const buf = await readFile(localPath);
  const name = basename(localPath);
  const form = new FormData();
  form.append("image", new Blob([new Uint8Array(buf)]), name);
  form.append("overwrite", "true");
  const res = await fetch(`${comfyBase()}/upload/image`, { method: "POST", body: form });
  if (!res.ok) throw new Error(`ComfyUI audio upload failed (${res.status})`);
  const json = (await res.json()) as { name?: string };
  return json.name || name;
}

export async function cloneVoiceLocal(opts: {
  referenceAudioPath: string;
  text: string;
  referenceText?: string;
  language?: string;
  instruct?: string;
  seed?: number;
}): Promise<string> {
  const absRef = resolveMediaInput(opts.referenceAudioPath);
  const uploadedName = await uploadAudioToComfy(absRef);
  const seed = opts.seed && opts.seed > 0 ? opts.seed : Math.floor(Math.random() * 1_000_000_000);
  const prefix = `openmuse_tts_${Date.now()}`;

  const prompt: Record<string, unknown> = {
    "1": {
      class_type: "LoadAudio",
      inputs: { audio: uploadedName },
    },
    "2": {
      class_type: "QwenTTSVoiceCloneGenerate",
      inputs: {
        ref_audio: ["1", 0],
        target_text: opts.text,
        ref_text: opts.referenceText?.trim() || "",
        model_choice: "1.7B",
        device: "auto",
        precision: "bf16",
        language: opts.language || "Auto",
        seed,
        max_new_tokens: 2048,
        top_p: 1.0,
        top_k: 50,
        temperature: 0.9,
        repetition_penalty: 1.05,
        x_vector_only: !opts.referenceText?.trim(),
        instruct: opts.instruct?.trim() || "",
        attention: "auto",
        unload_model_after_generate: true,
        custom_model_path: "",
      },
    },
    "3": {
      class_type: "SaveAudioMP3",
      inputs: {
        audio: ["2", 0],
        filename_prefix: prefix,
        quality: "320k",
      },
    },
  };

  const qRes = await fetch(`${comfyBase()}/prompt`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ prompt }),
  });
  if (!qRes.ok) {
    const errTxt = await qRes.text();
    throw new Error(`ComfyUI Qwen3-TTS queue failed (${qRes.status}): ${errTxt}`);
  }
  const { prompt_id: promptId } = (await qRes.json()) as { prompt_id?: string };
  if (!promptId) throw new Error("ComfyUI returned no prompt_id for Qwen3-TTS");

  const deadline = Date.now() + 180_000;
  while (Date.now() < deadline) {
    await new Promise((r) => setTimeout(r, 1500));
    const hRes = await fetch(`${comfyBase()}/history/${encodeURIComponent(promptId)}`);
    if (!hRes.ok) continue;
    const hist = (await hRes.json()) as Record<
      string,
      {
        status?: { status_str?: string; messages?: unknown[] };
        outputs?: Record<
          string,
          { audio?: Array<{ filename: string; subfolder?: string; type?: string }> }
        >;
      }
    >;
    const entry = hist[promptId];
    if (!entry) continue;
    if (entry.status?.status_str === "error") {
      throw new Error(`Qwen3-TTS error: ${JSON.stringify(entry.status.messages ?? [])}`);
    }
    const audioOut = entry.outputs?.["3"]?.audio?.[0];
    if (audioOut?.filename) {
      const viewUrl = `${comfyBase()}/view?filename=${encodeURIComponent(audioOut.filename)}&subfolder=${encodeURIComponent(audioOut.subfolder || "")}&type=${encodeURIComponent(audioOut.type || "output")}`;
      const fileRes = await fetch(viewUrl);
      if (!fileRes.ok) throw new Error(`Failed to fetch generated audio (${fileRes.status})`);
      const bytes = new Uint8Array(await fileRes.arrayBuffer());
      await mkdir(GEN_DIR, { recursive: true });
      const outPath = join(GEN_DIR, `voice-${Date.now()}.mp3`);
      await writeFile(outPath, bytes);
      return outPath;
    }
  }
  throw new Error("Timed out waiting for Qwen3-TTS voice clone generation");
}

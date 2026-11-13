import { execFile } from "node:child_process";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { join, resolve } from "node:path";
import { promisify } from "node:util";
import { defineTool } from "@copilotkit/runtime/v2";
import { z } from "zod";
import { renderLocalVideo } from "./comfy-video.js";

const execFileAsync = promisify(execFile);
const GEN_DIR = resolve(process.cwd(), "generated");
const IMAGE_MODELS = [
  "gemini-3.1-flash-lite-image",
  "gemini-3.1-flash-image",
  "gemini-2.5-flash-image",
];

function googleBase(): string {
  return ["https://", "generativelanguage", ".googleapis", ".com/v1beta"].join("");
}

function pollinationsImageBase(): string {
  return ["https://", "image", ".pollinations", ".ai/prompt"].join("");
}

async function saveGenerated(prefix: string, ext: string, bytes: Uint8Array): Promise<string> {
  await mkdir(GEN_DIR, { recursive: true });
  const fullPath = join(GEN_DIR, `${prefix}-${Date.now()}.${ext}`);
  await writeFile(fullPath, bytes);
  return fullPath;
}

async function runGeminiImage(parts: Array<Record<string, unknown>>, prefix: string) {
  const apiKey = process.env.GOOGLE_API_KEY?.trim() ?? "";
  if (!apiKey) return { ok: false, error: "No GOOGLE_API_KEY configured" };
  let lastError = "No image models succeeded";
  for (const model of IMAGE_MODELS) {
    const res = await fetch(`${googleBase()}/models/${model}:generateContent?key=${apiKey}`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        contents: [{ parts }],
        generationConfig: { responseModalities: ["IMAGE"] },
      }),
    });
    if (!res.ok) {
      lastError = `${model} (${res.status}): ${await res.text()}`;
      continue;
    }
    const gData = (await res.json()) as {
      candidates?: Array<{ content?: { parts?: Array<{ inlineData?: { data?: string } }> } }>;
    };
    const imgB64 = gData.candidates?.at(0)?.content?.parts?.find((p) => p.inlineData?.data)
      ?.inlineData?.data;
    if (imgB64)
      return {
        ok: true,
        model,
        savedPath: await saveGenerated(prefix, "png", Buffer.from(imgB64, "base64")),
      };
  }
  return { ok: false, error: lastError };
}

export function mediaTools() {
  return [
    defineTool({
      name: "generate_image",
      description: "Generate a new AI image from a text prompt and save it to disk.",
      parameters: z.object({
        prompt: z.string().min(1).max(2000),
        aspectRatio: z.enum(["1:1", "16:9", "9:16", "4:3", "3:4"]).default("1:1"),
      }),
      execute: async ({ prompt, aspectRatio }) => {
        const g = await runGeminiImage(
          [{ text: `${prompt}. Aspect ratio: ${aspectRatio}.` }],
          "image",
        );
        if (g.ok) return g;
        const w = aspectRatio === "16:9" ? 1280 : aspectRatio === "9:16" ? 720 : 1024;
        const h = aspectRatio === "16:9" ? 720 : aspectRatio === "9:16" ? 1280 : 1024;
        const res = await fetch(
          `${pollinationsImageBase()}/${encodeURIComponent(prompt)}?width=${w}&height=${h}&seed=${Math.floor(Math.random() * 1e6)}&nologo=true`,
        );
        if (!res.ok) return { ok: false, error: `Fallback error (${res.status})` };
        return {
          ok: true,
          model: "pollinations-flux-free",
          savedPath: await saveGenerated("image", "jpg", new Uint8Array(await res.arrayBuffer())),
        };
      },
    }),

    defineTool({
      name: "edit_image",
      description: "Modify or restyle an existing local image file using a text prompt.",
      parameters: z.object({ imagePath: z.string().min(1), prompt: z.string().min(1).max(2000) }),
      execute: async ({ imagePath, prompt }) => {
        const abs = resolve(imagePath);
        const bytes = await readFile(abs);
        const mimeType = abs.endsWith(".webp")
          ? "image/webp"
          : /\.jpe?g$/i.test(abs)
            ? "image/jpeg"
            : "image/png";
        return runGeminiImage(
          [{ inlineData: { mimeType, data: bytes.toString("base64") } }, { text: prompt }],
          "edited",
        );
      },
    }),

    defineTool({
      name: "generate_video",
      description:
        "Generate a local AI text-to-video OR image-to-video MP4 clip with audio on the RTX 3090 via ComfyUI (LTX-2.3). Pass imagePath to animate an existing image into video, or omit imagePath for text-to-video. Supports durationSeconds from 4 up to 180 seconds (3 minutes).",
      parameters: z.object({
        prompt: z.string().min(1).max(2000),
        imagePath: z.string().optional(),
        aspectRatio: z.enum(["16:9", "9:16", "1:1"]).optional(),
        durationSeconds: z.number().int().min(4).max(180).optional(),
        fastMode: z.boolean().optional(),
      }),
      execute: async ({ prompt, imagePath, aspectRatio, durationSeconds, fastMode }) => {
        try {
          const savedPath = await renderLocalVideo(
            imagePath ?? null,
            prompt,
            aspectRatio,
            durationSeconds,
            fastMode,
          );
          return { ok: true, model: "ltx-2.3-t2v-rtx3090", durationSeconds, savedPath };
        } catch (err) {
          return {
            ok: false,
            error: err instanceof Error ? err.message : "Local video generation failed",
          };
        }
      },
    }),

    defineTool({
      name: "animate_image",
      description:
        "Animate an existing local image (PNG, JPG, WebP) into a local AI MP4 video with audio on the RTX 3090 via ComfyUI (LTX-2.3 Image-to-Video). Supports durationSeconds from 4 up to 180 seconds (3 minutes).",
      parameters: z.object({
        imagePath: z.string().min(1),
        prompt: z.string().min(1).max(2000),
        aspectRatio: z.enum(["16:9", "9:16", "1:1"]).optional(),
        durationSeconds: z.number().int().min(4).max(180).optional(),
        fastMode: z.boolean().optional(),
      }),
      execute: async ({ imagePath, prompt, aspectRatio, durationSeconds, fastMode }) => {
        try {
          const savedPath = await renderLocalVideo(
            imagePath,
            prompt,
            aspectRatio,
            durationSeconds,
            fastMode,
          );
          return { ok: true, model: "ltx-2.3-i2v-rtx3090", durationSeconds, savedPath };
        } catch (err) {
          return {
            ok: false,
            error: err instanceof Error ? err.message : "Local image animation failed",
          };
        }
      },
    }),

    defineTool({
      name: "modify_media",
      description: "Convert, resize, crop, or animate local media files using ffmpeg.",
      parameters: z.object({
        inputPath: z.string().min(1),
        outputExt: z.enum(["png", "webp", "gif", "mp4"]).default("webp"),
        ffmpegArgs: z.array(z.string()).default([]),
      }),
      execute: async ({ inputPath, outputExt, ffmpegArgs }) => {
        await mkdir(GEN_DIR, { recursive: true });
        const outPath = join(GEN_DIR, `modified-${Date.now()}.${outputExt}`);
        const mp4Defaults =
          outputExt === "mp4"
            ? ["-c:v", "libx264", "-pix_fmt", "yuv420p", "-movflags", "+faststart"]
            : [];
        try {
          await execFileAsync("ffmpeg", [
            "-y",
            "-i",
            resolve(inputPath),
            ...ffmpegArgs,
            ...mp4Defaults,
            outPath,
          ]);
          return { ok: true, savedPath: outPath };
        } catch (err) {
          return { ok: false, error: err instanceof Error ? err.message : "ffmpeg failed" };
        }
      },
    }),
  ];
}

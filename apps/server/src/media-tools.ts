import { execFile } from "node:child_process";
import { existsSync } from "node:fs";
import { mkdir, writeFile } from "node:fs/promises";
import { basename, join, resolve } from "node:path";
import { promisify } from "node:util";
import { defineTool } from "@copilotkit/runtime/v2";
import { z } from "zod";
import { cloneVoiceLocal } from "./comfy-audio.js";
import { editLocalZImage, eraseMaskedRegion, renderLocalZImage } from "./comfy-image.js";
import { renderLocalVideo } from "./comfy-video.js";
import { appendPromptHistory } from "./prompt-history.js";
import { runCopyRegionClone, runLocalVisionInspect } from "./vision-tools.js";

const execFileAsync = promisify(execFile);
const GEN_DIR = resolve(process.cwd(), "generated");
function resolveMediaPath(p: string): string {
  const direct = resolve(p);
  if (existsSync(direct)) return direct;
  const inGen = join(GEN_DIR, basename(p));
  if (existsSync(inGen)) return inGen;
  return direct;
}
const IMAGE_MODELS = [
  "gemini-3.1-flash-lite-image",
  "gemini-3.1-flash-image",
  "gemini-2.5-flash-image",
];

function googleBase(): string {
  return ["https://", "generativelanguage", ".googleapis", ".com/v1beta"].join("");
}

const sceneSpecSchema = z.object({
  subject: z
    .string()
    .min(1)
    .describe("Core subject identity, age/build, hair, skin, and expression"),
  attireState: z
    .string()
    .min(1)
    .describe(
      "Exact clothing or nudity state (e.g., completely nude, unclothed, bare skin, no underwear vs specific garments)",
    ),
  poseAndAction: z
    .string()
    .min(1)
    .describe("Exact body orientation, limb placement, posture, and action"),
  cameraAndFraming: z
    .string()
    .default("medium full shot, natural perspective")
    .describe("Shot distance, camera angle, lens, and depth of field"),
  environmentAndLighting: z
    .string()
    .default("natural indoor lighting")
    .describe("Background setting, atmosphere, and key/rim lighting"),
  styleAndMedium: z
    .string()
    .default("photorealistic 35mm candid photograph, natural skin texture")
    .describe("Visual medium and rendering style"),
  mustAvoid: z
    .array(z.string())
    .default([])
    .describe("Explicit visual elements, garments, or artifacts to exclude"),
});

function compileSceneSpec(
  spec: z.infer<typeof sceneSpecSchema> | undefined,
  rawPrompt: string,
): { positivePrompt: string; negativePrompt: string } {
  if (!spec) {
    const isNude =
      /\b(nude|naked|unclothed|no underwear|no thong|bare skin|genital|penis|vulva|breasts)\b/i.test(
        rawPrompt,
      );
    return {
      positivePrompt: rawPrompt.trim(),
      negativePrompt: isNude
        ? "thong, underwear, briefs, panties, swimwear, bikini, trunks, lingerie, clothing, censored, mosaic, blur"
        : "",
    };
  }
  const combined = `${spec.attireState} ${spec.subject} ${rawPrompt}`;
  const isNude =
    /\b(nude|naked|unclothed|no underwear|no thong|bare skin|genital|penis|vulva|breasts)\b/i.test(
      combined,
    );
  const posParts = [
    spec.styleAndMedium,
    spec.subject,
    isNude ? `${spec.attireState}, completely unclothed, bare skin` : spec.attireState,
    spec.poseAndAction,
    spec.cameraAndFraming,
    spec.environmentAndLighting,
  ]
    .map((s) => s.trim())
    .filter(Boolean);
  const negSet = new Set<string>(spec.mustAvoid.map((s) => s.trim()).filter(Boolean));
  if (isNude) {
    for (const item of [
      "thong",
      "underwear",
      "briefs",
      "panties",
      "swimwear",
      "bikini",
      "trunks",
      "lingerie",
      "clothing",
      "censored",
      "mosaic",
      "blur",
    ]) {
      negSet.add(item);
    }
  }
  return {
    positivePrompt: posParts.join(", "),
    negativePrompt: [...negSet].join(", "),
  };
}

async function saveGenerated(prefix: string, ext: string, bytes: Uint8Array): Promise<string> {
  await mkdir(GEN_DIR, { recursive: true });
  const fullPath = join(GEN_DIR, `${prefix}-${Date.now()}.${ext}`);
  await writeFile(fullPath, bytes);
  return fullPath;
}

async function _runGeminiImage(parts: Array<Record<string, unknown>>, prefix: string) {
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
      name: "inspect_image",
      description:
        "Visually inspect a local image using the local Qwen2.5-VL vision model to describe details or locate exact [x1, y1, x2, y2] bounding boxes (0-1000 scale) of anatomical features, objects, or people.",
      parameters: z.object({
        imagePath: z
          .string()
          .min(1)
          .describe(
            "Filename in /home/cowboy/openmuse/generated/ (e.g. maleForm.png) or full path",
          ),
        question: z
          .string()
          .min(1)
          .max(1000)
          .describe(
            "What to inspect or locate in the image, including requesting [x1, y1, x2, y2] coordinates",
          ),
      }),
      execute: async ({ imagePath, question }) => {
        try {
          const analysis = await runLocalVisionInspect(imagePath, question);
          return { ok: true, analysis };
        } catch (err) {
          return { ok: false, error: err instanceof Error ? err.message : String(err) };
        }
      },
    }),

    defineTool({
      name: "copy_region",
      description:
        "Copy a specific visual region/feature (such as a belly button, tattoo, or facial detail) from one person/location in an image onto another person/location in the same image (or another image), automatically matching skin tone, lighting, and shadow gradients via Poisson seamless cloning.",
      parameters: z.object({
        sourceImagePath: z
          .string()
          .min(1)
          .describe("Source image filename in generated/ or full path"),
        sourceBox: z
          .array(z.number())
          .length(4)
          .describe(
            "Source bounding box [x1, y1, x2, y2] (0-1000 normalized scale from inspect_image)",
          ),
        targetImagePath: z
          .string()
          .optional()
          .describe("Target image path; omit to copy from one person to another in the same image"),
        targetBox: z
          .array(z.number())
          .length(4)
          .describe(
            "Target destination bounding box [x1, y1, x2, y2] (0-1000 normalized scale from inspect_image)",
          ),
        scaleMultiplier: z.number().min(0.4).max(2.5).optional(),
        rotationDeg: z.number().min(-180).max(180).optional(),
        blendMode: z.enum(["normal", "mixed"]).optional(),
      }),
      execute: async (params) => {
        try {
          const savedPath = await runCopyRegionClone({
            ...params,
            sourceBox: params.sourceBox as [number, number, number, number],
            targetBox: params.targetBox as [number, number, number, number],
          });
          return { ok: true, savedPath };
        } catch (err) {
          return { ok: false, error: err instanceof Error ? err.message : String(err) };
        }
      },
    }),

    defineTool({
      name: "generate_image",
      description:
        "Extract the user request into a structured sceneSpec and compile it into a deterministic ComfyUI generation prompt to render a new local image. ONLY call when the user explicitly requests creating a new image—NEVER call when the user asks why an existing image looks wrong or asks a diagnostic question.",
      parameters: z.object({
        prompt: z.string().min(1).max(2000).describe("Original user image request"),
        sceneSpec: sceneSpecSchema.describe(
          "Structured breakdown of subject, attire/nudity state, pose, framing, lighting, style, and exclusions",
        ),
        aspectRatio: z.enum(["1:1", "16:9", "9:16", "4:3", "3:4"]).default("1:1"),
      }),
      execute: async ({ prompt, sceneSpec, aspectRatio }) => {
        try {
          const { positivePrompt, negativePrompt } = compileSceneSpec(sceneSpec, prompt);
          const png = await renderLocalZImage(positivePrompt, aspectRatio, negativePrompt);
          const savedPath = await saveGenerated("image", "png", png);
          await appendPromptHistory({
            tool: "generate_image",
            prompt: `${positivePrompt}${negativePrompt ? ` [NEG: ${negativePrompt}]` : ""}`,
            savedPath,
          });
          return {
            ok: true,
            savedPath,
            sceneSpec,
            compiledPrompt: positivePrompt,
            negativePrompt,
          };
        } catch (err) {
          return {
            ok: false,
            error: `Local ComfyUI image error: ${err instanceof Error ? err.message : String(err)}`,
          };
        }
      },
    }),

    defineTool({
      name: "edit_image",
      description:
        "ONLY call when the user explicitly asks to visually modify or edit an existing image—NEVER call when the user asks a question, requests file/app info, or discusses workflow steps." +
        "Modify or restyle an existing local image file. Automatically masks and preserves the full body and face when exact subject preservation or background/region masking is requested.",
      parameters: z.object({
        imagePath: z
          .string()
          .min(1)
          .describe("Filename in /home/cowboy/openmuse/generated/ or full local path"),
        prompt: z.string().min(1).max(2000),
        maskTarget: z
          .string()
          .optional()
          .describe(
            "Optional region to edit exclusively (e.g. background, jacket, hat), keeping the rest untouched.",
          ),
      }),
      execute: async ({ imagePath, prompt, maskTarget }) => {
        const abs = resolveMediaPath(imagePath);
        const maskPath = await buildInpaintMask(abs, prompt, maskTarget);
        const cleanupMask = async () => {
          if (maskPath)
            await import("node:fs/promises")
              .then(({ rm }) => rm(maskPath, { force: true }))
              .catch(() => {});
        };
        try {
          const png = await editLocalZImage(abs, prompt, undefined, maskPath);
          const savedPath = await saveGenerated("edited", "png", png);
          await appendPromptHistory({ tool: "edit_image", prompt, savedPath });
          await cleanupMask();
          return { ok: true, maskedInpaint: Boolean(maskPath), savedPath };
        } catch (err) {
          await cleanupMask();
          return {
            ok: false,
            error: `Local ComfyUI edit_image error: ${err instanceof Error ? err.message : String(err)}`,
          };
        }
      },
    }),

    defineTool({
      name: "remove_object",
      description:
        "Explicitly erase and remove a specified object, watermark, prop, or region from a local image using Qwen2.5-VL mask detection + pure clean-plate inpainting (denoise 1.0 without ReferenceLatent) and pixel-exact compositing of the untouched image.",
      parameters: z.object({
        imagePath: z
          .string()
          .min(1)
          .describe("Filename in /home/cowboy/openmuse/generated/ or full local path"),
        target: z
          .string()
          .min(1)
          .describe(
            "Description of the object or region to completely remove (e.g. green grapes, watermark, chair)",
          ),
        fillPrompt: z
          .string()
          .optional()
          .describe(
            "Optional description of the clean background texture that should replace the removed object",
          ),
      }),
      execute: async ({ imagePath, target, fillPrompt }) => {
        const abs = resolveMediaPath(imagePath);
        const maskPath = await buildInpaintMask(abs, `remove ${target}`, target);
        if (!maskPath) {
          return {
            ok: false,
            error: `Could not locate "${target}" in the image to mask for removal.`,
          };
        }
        try {
          const png = await eraseMaskedRegion(abs, maskPath, fillPrompt);
          const savedPath = await saveGenerated("erased", "png", png);
          await appendPromptHistory({
            tool: "remove_object",
            prompt: `remove: ${target}`,
            savedPath,
          });
          return { ok: true, removedTarget: target, savedPath };
        } catch (err) {
          return { ok: false, error: err instanceof Error ? err.message : "Object removal failed" };
        } finally {
          await import("node:fs/promises")
            .then(({ rm }) => rm(maskPath, { force: true }))
            .catch(() => {});
        }
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
          await appendPromptHistory({
            tool: "generate_video",
            prompt: prompt,
            savedPath: savedPath,
          });
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
          await appendPromptHistory({
            tool: "animate_image",
            prompt: prompt,
            savedPath: savedPath,
          });
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
      name: "extend_video",
      description:
        "Use an existing local video (MP4/WebM) as a reference to generate a continuation video clip via LTX-2.3 Image-to-Video. Automatically extracts the final frame (or a specific timestampSeconds frame) of the reference video, animates it with your new prompt, and optionally stitches the original and new clips together into one seamless MP4.",
      parameters: z.object({
        videoPath: z
          .string()
          .min(1)
          .describe("Reference video filename in generated/ or full path"),
        prompt: z
          .string()
          .min(1)
          .max(2000)
          .describe("Action/scene prompt for the continuation clip"),
        timestampSeconds: z
          .number()
          .min(0)
          .optional()
          .describe(
            "Optional timestamp in seconds to extract as the seed frame; defaults to the last frame",
          ),
        stitchWithOriginal: z
          .boolean()
          .default(true)
          .describe(
            "When true, concatenates the reference video and new continuation into one seamless MP4",
          ),
        aspectRatio: z.enum(["16:9", "9:16", "1:1"]).optional(),
        durationSeconds: z.number().int().min(4).max(180).optional(),
        fastMode: z.boolean().optional(),
      }),
      execute: async ({
        videoPath,
        prompt,
        timestampSeconds,
        stitchWithOriginal,
        aspectRatio,
        durationSeconds,
        fastMode,
      }) => {
        const { unlink } = await import("node:fs/promises");
        await mkdir(GEN_DIR, { recursive: true });
        const absVideo = videoPath.startsWith("/")
          ? videoPath
          : join(GEN_DIR, videoPath.replace("generated/", ""));
        const framePath = join(GEN_DIR, `.ref-frame-${Date.now()}.png`);
        try {
          const extractArgs =
            typeof timestampSeconds === "number"
              ? [
                  "-y",
                  "-ss",
                  String(timestampSeconds),
                  "-i",
                  absVideo,
                  "-frames:v",
                  "1",
                  "-q:v",
                  "2",
                  framePath,
                ]
              : ["-y", "-sseof", "-0.1", "-i", absVideo, "-frames:v", "1", "-q:v", "2", framePath];
          await execFileAsync("ffmpeg", extractArgs);
          const nextClipPath = await renderLocalVideo(
            framePath,
            prompt,
            aspectRatio,
            durationSeconds,
            fastMode,
          );
          let finalPath = nextClipPath;
          if (stitchWithOriginal) {
            const stitchedPath = join(GEN_DIR, `extended-${Date.now()}.mp4`);
            await execFileAsync("ffmpeg", [
              "-y",
              "-i",
              absVideo,
              "-i",
              nextClipPath,
              "-filter_complex",
              "[0:v:0][1:v:0]concat=n=2:v=1:a=0[vout]",
              "-map",
              "[vout]",
              "-c:v",
              "libx264",
              "-pix_fmt",
              "yuv420p",
              "-movflags",
              "+faststart",
              stitchedPath,
            ]);
            finalPath = stitchedPath;
          }
          await appendPromptHistory({ tool: "extend_video", prompt: prompt, savedPath: finalPath });
          return {
            ok: true,
            model: "ltx-2.3-extend-rtx3090",
            stitched: Boolean(stitchWithOriginal),
            savedPath: finalPath,
          };
        } catch (err) {
          return {
            ok: false,
            error: err instanceof Error ? err.message : "Video extension failed",
          };
        } finally {
          await unlink(framePath).catch(() => {});
        }
      },
    }),

    defineTool({
      name: "restyle_video",
      description:
        "Video-to-Video motion and style transfer. Takes a reference MP4/WebM video in generated/ and restyles its frames consistently using local Z-Image-Turbo image-to-image while preserving the original subject pose, motion trajectory, and audio track.",
      parameters: z.object({
        videoPath: z
          .string()
          .min(1)
          .describe("Reference video filename in generated/ or full path"),
        prompt: z
          .string()
          .min(1)
          .max(2000)
          .describe("Target visual style, lighting, or scene transformation prompt"),
        fps: z
          .number()
          .int()
          .min(4)
          .max(24)
          .default(8)
          .describe("Frame sampling rate for restyling (default 8 fps for fast, smooth output)"),
        maxSeconds: z
          .number()
          .int()
          .min(1)
          .max(15)
          .default(6)
          .describe("Maximum seconds of the source video to restyle (default 6s)"),
      }),
      execute: async ({ videoPath, prompt, fps, maxSeconds }) => {
        const { readdir, rm } = await import("node:fs/promises");
        await mkdir(GEN_DIR, { recursive: true });
        const absVideo = videoPath.startsWith("/")
          ? videoPath
          : join(GEN_DIR, videoPath.replace("generated/", ""));
        const workDir = join(GEN_DIR, `.v2v-${Date.now()}`);
        const framesDir = join(workDir, "in");
        const styledDir = join(workDir, "out");
        await mkdir(framesDir, { recursive: true });
        await mkdir(styledDir, { recursive: true });
        try {
          await execFileAsync("ffmpeg", [
            "-y",
            "-t",
            String(maxSeconds),
            "-i",
            absVideo,
            "-vf",
            `fps=${fps}`,
            join(framesDir, "frame_%04d.png"),
          ]);
          const frames = (await readdir(framesDir)).filter((f) => f.endsWith(".png")).sort();
          if (frames.length === 0) throw new Error("Could not extract frames from reference video");
          for (let i = 0; i < frames.length; i += 1) {
            const styledPath = await editLocalZImage(join(framesDir, frames[i]), prompt);
            const { rename, writeFile } = await import("node:fs/promises");
            const destFrame = join(styledDir, `frame_${String(i + 1).padStart(4, "0")}.png`);
            if (typeof styledPath === "string") await rename(styledPath, destFrame);
            else await writeFile(destFrame, styledPath);
          }
          const outPath = join(GEN_DIR, `restyled-${Date.now()}.mp4`);
          await execFileAsync("ffmpeg", [
            "-y",
            "-framerate",
            String(fps),
            "-i",
            join(styledDir, "frame_%04d.png"),
            "-t",
            String(maxSeconds),
            "-i",
            absVideo,
            "-map",
            "0:v:0",
            "-map",
            "1:a?",
            "-c:v",
            "libx264",
            "-pix_fmt",
            "yuv420p",
            "-c:a",
            "aac",
            "-shortest",
            "-movflags",
            "+faststart",
            outPath,
          ]);
          await appendPromptHistory({ tool: "restyle_video", prompt, savedPath: outPath });
          return {
            ok: true,
            model: "z-image-turbo-v2v-rtx3090",
            framesRestyled: frames.length,
            savedPath: outPath,
          };
        } catch (err) {
          return {
            ok: false,
            error: err instanceof Error ? err.message : "Video restyling failed",
          };
        } finally {
          await rm(workDir, { recursive: true, force: true }).catch(() => {});
        }
      },
    }),

    defineTool({
      name: "clone_voice",
      description:
        "Zero-shot voice cloning using local Qwen3-TTS-12Hz-1.7B-Base. Provide a short 3-15 second reference voice clip (filename in generated/ or full path) and any new dialogue text to generate a high-quality MP3 in that exact voice.",
      parameters: z.object({
        referenceAudioPath: z
          .string()
          .min(1)
          .describe("Reference audio filename in generated/ (e.g. my_voice.wav) or full path"),
        text: z
          .string()
          .min(1)
          .describe("The new dialogue or narration text to speak in the cloned voice"),
        referenceText: z
          .string()
          .optional()
          .describe(
            "Optional exact transcript of what is spoken in the reference audio clip for higher accuracy",
          ),
        language: z
          .enum([
            "Auto",
            "English",
            "Chinese",
            "Japanese",
            "Korean",
            "French",
            "German",
            "Spanish",
            "Portuguese",
            "Russian",
            "Italian",
          ])
          .default("Auto"),
        instruct: z
          .string()
          .optional()
          .describe("Optional delivery style or emotion instruction, e.g. calm, excited, dramatic"),
      }),
      execute: async ({ referenceAudioPath, text, referenceText, language, instruct }) => {
        try {
          const savedPath = await cloneVoiceLocal({
            referenceAudioPath,
            text,
            referenceText,
            language,
            instruct,
          });
          await appendPromptHistory({ tool: "clone_voice", prompt: text, savedPath });
          await appendPromptHistory({ tool: "clone_voice", prompt: text, savedPath: savedPath });
          return { ok: true, model: "qwen3-tts-12hz-1.7b-base", savedPath };
        } catch (err) {
          return {
            ok: false,
            error: err instanceof Error ? err.message : "Local voice cloning failed",
          };
        }
      },
    }),

    defineTool({
      name: "add_audio_to_video",
      description:
        "Add or mix a generated voiceover/audio track onto a video file using ffmpeg, saving a ready-to-play MP4 into generated/.",
      parameters: z.object({
        videoPath: z
          .string()
          .min(1)
          .describe("Video filename in generated/ (e.g. video-123.mp4) or full path"),
        audioPath: z
          .string()
          .min(1)
          .describe("Audio filename in generated/ (e.g. voice-456.mp3) or full path"),
        mixOriginalAudio: z
          .boolean()
          .default(false)
          .describe(
            "Set true to mix the new voiceover over the video existing audio; false replaces the audio track",
          ),
      }),
      execute: async ({ videoPath, audioPath, mixOriginalAudio }) => {
        await mkdir(GEN_DIR, { recursive: true });
        const absVideo = videoPath.startsWith("/")
          ? videoPath
          : join(GEN_DIR, videoPath.replace("generated/", ""));
        const absAudio = audioPath.startsWith("/")
          ? audioPath
          : join(GEN_DIR, audioPath.replace("generated/", ""));
        const outPath = join(GEN_DIR, `voiced-${Date.now()}.mp4`);
        const args = mixOriginalAudio
          ? [
              "-y",
              "-i",
              absVideo,
              "-i",
              absAudio,
              "-filter_complex",
              "[0:a][1:a]amix=inputs=2:duration=first:dropout_transition=2[aout]",
              "-map",
              "0:v:0",
              "-map",
              "[aout]",
              "-c:v",
              "copy",
              "-c:a",
              "aac",
              "-b:a",
              "192k",
              "-movflags",
              "+faststart",
              outPath,
            ]
          : [
              "-y",
              "-i",
              absVideo,
              "-i",
              absAudio,
              "-map",
              "0:v:0",
              "-map",
              "1:a:0",
              "-c:v",
              "copy",
              "-c:a",
              "aac",
              "-b:a",
              "192k",
              "-shortest",
              "-movflags",
              "+faststart",
              outPath,
            ];
        try {
          await execFileAsync("ffmpeg", args);
          return { ok: true, savedPath: outPath };
        } catch (err) {
          return {
            ok: false,
            error: err instanceof Error ? err.message : "ffmpeg audio mux failed",
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
        const preInputArgs: string[] = [];
        const postInputArgs: string[] = [];
        for (let i = 0; i < ffmpegArgs.length; i += 1) {
          const arg = ffmpegArgs[i];
          if (arg === "-stream_loop" && i + 1 < ffmpegArgs.length) {
            preInputArgs.push("-stream_loop", String(ffmpegArgs[i + 1]));
            i += 1;
          } else if (arg !== undefined) {
            postInputArgs.push(arg);
          }
        }
        const mp4Defaults =
          outputExt === "mp4" && !postInputArgs.includes("-c:v")
            ? ["-c:v", "libx264", "-pix_fmt", "yuv420p", "-movflags", "+faststart"]
            : [];
        try {
          await execFileAsync("ffmpeg", [
            "-y",
            ...preInputArgs,
            "-i",
            resolveMediaPath(inputPath),
            ...postInputArgs,
            ...mp4Defaults,
            outPath,
          ]);
          let durationSeconds: number | undefined;
          let resolution: string | undefined;
          try {
            const { stdout } = await execFileAsync("ffprobe", [
              "-v",
              "error",
              "-select_streams",
              "v:0",
              "-show_entries",
              "stream=width,height:format=duration",
              "-of",
              "json",
              outPath,
            ]);
            const probe = JSON.parse(stdout) as {
              streams?: Array<{ width?: number; height?: number }>;
              format?: { duration?: string };
            };
            const dur = Number(probe.format?.duration);
            if (Number.isFinite(dur) && dur > 0) durationSeconds = Math.round(dur * 100) / 100;
            const st = probe.streams?.[0];
            if (st?.width && st?.height) resolution = `${st.width}x${st.height}`;
          } catch {}
          return {
            ok: true,
            savedPath: outPath,
            ...(durationSeconds !== undefined ? { durationSeconds } : {}),
            ...(resolution ? { resolution } : {}),
          };
        } catch (err) {
          return { ok: false, error: err instanceof Error ? err.message : "ffmpeg failed" };
        }
      },
    }),
  ];
}
async function buildInpaintMask(
  absImg: string,
  prompt: string,
  maskTarget?: string,
): Promise<string | undefined> {
  const target = (maskTarget || "").trim();
  const lockSubject = !target && /\b(exact|same|preserve|keep|identical)\b/i.test(prompt);
  const query =
    target && target.toLowerCase() !== "background" ? target : "the main person full body and head";
  const invert = !target || target.toLowerCase() === "background" || lockSubject;
  try {
    const raw = await runLocalVisionInspect(
      absImg,
      `Return ONLY a JSON array [ymin, xmin, ymax, xmax] normalized 0..1000 for: ${query}`,
    );
    const m = /\[\s*(\d+)\s*,\s*(\d+)\s*,\s*(\d+)\s*,\s*(\d+)\s*\]/.exec(raw);
    if (!m) return undefined;
    const [ymin, xmin, ymax, xmax] = [Number(m), Number(m), Number(m), Number(m)];
    const { readVideoSettings } = await import("./video-settings.js");
    const cfg = await readVideoSettings();
    const feather = Math.max(2, Number(cfg.cloneFeatherPx) || 8);
    const { stdout } = await execFileAsync("ffprobe", [
      "-v",
      "error",
      "-select_streams",
      "v:0",
      "-show_entries",
      "stream=width,height",
      "-of",
      "csv=p=0:s=x",
      absImg,
    ]);
    const [wStr, hStr] = stdout.trim().split("x");
    const w = Number(wStr) || 1024;
    const h = Number(hStr) || 1024;
    const pad = invert ? 0.02 : -0.02;
    const x1 = Math.max(0, Math.round((xmin / 1000 - pad) * w));
    const y1 = Math.max(0, Math.round((ymin / 1000 - pad) * h));
    const x2 = Math.min(w, Math.round((xmax / 1000 + pad) * w));
    const y2 = Math.min(h, Math.round((ymax / 1000 + pad) * h));
    const maskPath = join(GEN_DIR, `.mask-${Date.now()}.png`);
    const bgAlpha = invert ? "0x00" : "0xFF";
    const boxAlpha = invert ? "0xFF" : "0x00";
    await execFileAsync("ffmpeg", [
      "-y",
      "-f",
      "lavfi",
      "-i",
      `color=c=black@${bgAlpha}:s=${w}x${h},format=rgba`,
      "-vf",
      `drawbox=x=${x1}:y=${y1}:w=${Math.max(8, x2 - x1)}:h=${Math.max(8, y2 - y1)}:color=black@${boxAlpha}:t=fill,gblur=sigma=${feather}`,
      "-frames:v",
      "1",
      maskPath,
    ]);
    return maskPath;
  } catch {
    return undefined;
  }
}

export function createVisionTools() {
  return [
    defineTool({
      name: "inspect_image",
      description:
        "Visually inspect a local image using the local Qwen2.5-VL vision model to describe details or locate exact [x1, y1, x2, y2] bounding boxes (0-1000 scale) of anatomical features, objects, or people.",
      parameters: z.object({
        imagePath: z
          .string()
          .min(1)
          .describe(
            "Filename in /home/cowboy/openmuse/generated/ (e.g. maleForm.png) or full path",
          ),
        question: z
          .string()
          .min(1)
          .max(1000)
          .describe(
            "What to inspect or locate in the image, including requesting [x1, y1, x2, y2] coordinates",
          ),
      }),
      execute: async ({ imagePath, question }) => {
        try {
          const analysis = await runLocalVisionInspect(imagePath, question);
          return { ok: true, analysis };
        } catch (err) {
          return { ok: false, error: err instanceof Error ? err.message : String(err) };
        }
      },
    }),

    defineTool({
      name: "copy_region",
      description:
        "Copy a specific visual region/feature (such as a belly button, tattoo, or facial detail) from one person/location in an image onto another person/location in the same image (or another image), automatically matching skin tone, lighting, and shadow gradients via Poisson seamless cloning.",
      parameters: z.object({
        sourceImagePath: z
          .string()
          .min(1)
          .describe("Source image filename in generated/ or full path"),
        sourceBox: z
          .array(z.number())
          .length(4)
          .describe(
            "Source bounding box [x1, y1, x2, y2] (0-1000 normalized scale from inspect_image)",
          ),
        targetImagePath: z
          .string()
          .optional()
          .describe("Target image path; omit to copy from one person to another in the same image"),
        targetBox: z
          .array(z.number())
          .length(4)
          .describe(
            "Target destination bounding box [x1, y1, x2, y2] (0-1000 normalized scale from inspect_image)",
          ),
        scaleMultiplier: z.number().min(0.4).max(2.5).optional(),
        rotationDeg: z.number().min(-180).max(180).optional(),
        blendMode: z.enum(["normal", "mixed"]).optional(),
      }),
      execute: async (params) => {
        try {
          const savedPath = await runCopyRegionClone({
            ...params,
            sourceBox: params.sourceBox as [number, number, number, number],
            targetBox: params.targetBox as [number, number, number, number],
          });
          return { ok: true, savedPath };
        } catch (err) {
          return { ok: false, error: err instanceof Error ? err.message : String(err) };
        }
      },
    }),

    defineTool({
      name: "generate_image",
      description:
        "Extract the user request into a structured sceneSpec and compile it into a deterministic ComfyUI generation prompt to render a new local image. ONLY call when the user explicitly requests creating a new image—NEVER call when the user asks why an existing image looks wrong or asks a diagnostic question.",
      parameters: z.object({
        prompt: z.string().min(1).max(2000).describe("Original user image request"),
        sceneSpec: sceneSpecSchema.describe(
          "Structured breakdown of subject, attire/nudity state, pose, framing, lighting, style, and exclusions",
        ),
        aspectRatio: z.enum(["1:1", "16:9", "9:16", "4:3", "3:4"]).default("1:1"),
      }),
      execute: async ({ prompt, sceneSpec, aspectRatio }) => {
        try {
          const { positivePrompt, negativePrompt } = compileSceneSpec(sceneSpec, prompt);
          const png = await renderLocalZImage(positivePrompt, aspectRatio, negativePrompt);
          const savedPath = await saveGenerated("image", "png", png);
          await appendPromptHistory({
            tool: "generate_image",
            prompt: `${positivePrompt}${negativePrompt ? ` [NEG: ${negativePrompt}]` : ""}`,
            savedPath,
          });
          return {
            ok: true,
            savedPath,
            sceneSpec,
            compiledPrompt: positivePrompt,
            negativePrompt,
          };
        } catch (err) {
          return {
            ok: false,
            error: `Local ComfyUI image error: ${err instanceof Error ? err.message : String(err)}`,
          };
        }
      },
    }),

    defineTool({
      name: "edit_image",
      description:
        "ONLY call when the user explicitly asks to visually modify or edit an existing image—NEVER call when the user asks a question, requests file/app info, or discusses workflow steps." +
        "Modify or restyle an existing local image file. Automatically masks and preserves the full body and face when exact subject preservation or background/region masking is requested.",
      parameters: z.object({
        imagePath: z
          .string()
          .min(1)
          .describe("Filename in /home/cowboy/openmuse/generated/ or full local path"),
        prompt: z.string().min(1).max(2000),
        maskTarget: z
          .string()
          .optional()
          .describe(
            "Optional region to edit exclusively (e.g. background, jacket, hat), keeping the rest untouched.",
          ),
      }),
      execute: async ({ imagePath, prompt, maskTarget }) => {
        const abs = resolveMediaPath(imagePath);
        const maskPath = await buildInpaintMask(abs, prompt, maskTarget);
        const cleanupMask = async () => {
          if (maskPath)
            await import("node:fs/promises")
              .then(({ rm }) => rm(maskPath, { force: true }))
              .catch(() => {});
        };
        try {
          const png = await editLocalZImage(abs, prompt, undefined, maskPath);
          const savedPath = await saveGenerated("edited", "png", png);
          await appendPromptHistory({ tool: "edit_image", prompt, savedPath });
          await cleanupMask();
          return { ok: true, maskedInpaint: Boolean(maskPath), savedPath };
        } catch (err) {
          await cleanupMask();
          return {
            ok: false,
            error: `Local ComfyUI edit_image error: ${err instanceof Error ? err.message : String(err)}`,
          };
        }
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
          await appendPromptHistory({
            tool: "generate_video",
            prompt: prompt,
            savedPath: savedPath,
          });
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
          await appendPromptHistory({
            tool: "animate_image",
            prompt: prompt,
            savedPath: savedPath,
          });
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
      name: "extend_video",
      description:
        "Use an existing local video (MP4/WebM) as a reference to generate a continuation video clip via LTX-2.3 Image-to-Video. Automatically extracts the final frame (or a specific timestampSeconds frame) of the reference video, animates it with your new prompt, and optionally stitches the original and new clips together into one seamless MP4.",
      parameters: z.object({
        videoPath: z
          .string()
          .min(1)
          .describe("Reference video filename in generated/ or full path"),
        prompt: z
          .string()
          .min(1)
          .max(2000)
          .describe("Action/scene prompt for the continuation clip"),
        timestampSeconds: z
          .number()
          .min(0)
          .optional()
          .describe(
            "Optional timestamp in seconds to extract as the seed frame; defaults to the last frame",
          ),
        stitchWithOriginal: z
          .boolean()
          .default(true)
          .describe(
            "When true, concatenates the reference video and new continuation into one seamless MP4",
          ),
        aspectRatio: z.enum(["16:9", "9:16", "1:1"]).optional(),
        durationSeconds: z.number().int().min(4).max(180).optional(),
        fastMode: z.boolean().optional(),
      }),
      execute: async ({
        videoPath,
        prompt,
        timestampSeconds,
        stitchWithOriginal,
        aspectRatio,
        durationSeconds,
        fastMode,
      }) => {
        const { unlink } = await import("node:fs/promises");
        await mkdir(GEN_DIR, { recursive: true });
        const absVideo = videoPath.startsWith("/")
          ? videoPath
          : join(GEN_DIR, videoPath.replace("generated/", ""));
        const framePath = join(GEN_DIR, `.ref-frame-${Date.now()}.png`);
        try {
          const extractArgs =
            typeof timestampSeconds === "number"
              ? [
                  "-y",
                  "-ss",
                  String(timestampSeconds),
                  "-i",
                  absVideo,
                  "-frames:v",
                  "1",
                  "-q:v",
                  "2",
                  framePath,
                ]
              : ["-y", "-sseof", "-0.1", "-i", absVideo, "-frames:v", "1", "-q:v", "2", framePath];
          await execFileAsync("ffmpeg", extractArgs);
          const nextClipPath = await renderLocalVideo(
            framePath,
            prompt,
            aspectRatio,
            durationSeconds,
            fastMode,
          );
          let finalPath = nextClipPath;
          if (stitchWithOriginal) {
            const stitchedPath = join(GEN_DIR, `extended-${Date.now()}.mp4`);
            await execFileAsync("ffmpeg", [
              "-y",
              "-i",
              absVideo,
              "-i",
              nextClipPath,
              "-filter_complex",
              "[0:v:0][1:v:0]concat=n=2:v=1:a=0[vout]",
              "-map",
              "[vout]",
              "-c:v",
              "libx264",
              "-pix_fmt",
              "yuv420p",
              "-movflags",
              "+faststart",
              stitchedPath,
            ]);
            finalPath = stitchedPath;
          }
          await appendPromptHistory({ tool: "extend_video", prompt: prompt, savedPath: finalPath });
          return {
            ok: true,
            model: "ltx-2.3-extend-rtx3090",
            stitched: Boolean(stitchWithOriginal),
            savedPath: finalPath,
          };
        } catch (err) {
          return {
            ok: false,
            error: err instanceof Error ? err.message : "Video extension failed",
          };
        } finally {
          await unlink(framePath).catch(() => {});
        }
      },
    }),

    defineTool({
      name: "restyle_video",
      description:
        "Video-to-Video motion and style transfer. Takes a reference MP4/WebM video in generated/ and restyles its frames consistently using local Z-Image-Turbo image-to-image while preserving the original subject pose, motion trajectory, and audio track.",
      parameters: z.object({
        videoPath: z
          .string()
          .min(1)
          .describe("Reference video filename in generated/ or full path"),
        prompt: z
          .string()
          .min(1)
          .max(2000)
          .describe("Target visual style, lighting, or scene transformation prompt"),
        fps: z
          .number()
          .int()
          .min(4)
          .max(24)
          .default(8)
          .describe("Frame sampling rate for restyling (default 8 fps for fast, smooth output)"),
        maxSeconds: z
          .number()
          .int()
          .min(1)
          .max(15)
          .default(6)
          .describe("Maximum seconds of the source video to restyle (default 6s)"),
      }),
      execute: async ({ videoPath, prompt, fps, maxSeconds }) => {
        const { readdir, rm } = await import("node:fs/promises");
        await mkdir(GEN_DIR, { recursive: true });
        const absVideo = videoPath.startsWith("/")
          ? videoPath
          : join(GEN_DIR, videoPath.replace("generated/", ""));
        const workDir = join(GEN_DIR, `.v2v-${Date.now()}`);
        const framesDir = join(workDir, "in");
        const styledDir = join(workDir, "out");
        await mkdir(framesDir, { recursive: true });
        await mkdir(styledDir, { recursive: true });
        try {
          await execFileAsync("ffmpeg", [
            "-y",
            "-t",
            String(maxSeconds),
            "-i",
            absVideo,
            "-vf",
            `fps=${fps}`,
            join(framesDir, "frame_%04d.png"),
          ]);
          const frames = (await readdir(framesDir)).filter((f) => f.endsWith(".png")).sort();
          if (frames.length === 0) throw new Error("Could not extract frames from reference video");
          for (let i = 0; i < frames.length; i += 1) {
            const styledPath = await editLocalZImage(join(framesDir, frames[i]), prompt);
            const { rename, writeFile } = await import("node:fs/promises");
            const destFrame = join(styledDir, `frame_${String(i + 1).padStart(4, "0")}.png`);
            if (typeof styledPath === "string") await rename(styledPath, destFrame);
            else await writeFile(destFrame, styledPath);
          }
          const outPath = join(GEN_DIR, `restyled-${Date.now()}.mp4`);
          await execFileAsync("ffmpeg", [
            "-y",
            "-framerate",
            String(fps),
            "-i",
            join(styledDir, "frame_%04d.png"),
            "-t",
            String(maxSeconds),
            "-i",
            absVideo,
            "-map",
            "0:v:0",
            "-map",
            "1:a?",
            "-c:v",
            "libx264",
            "-pix_fmt",
            "yuv420p",
            "-c:a",
            "aac",
            "-shortest",
            "-movflags",
            "+faststart",
            outPath,
          ]);
          await appendPromptHistory({ tool: "restyle_video", prompt, savedPath: outPath });
          return {
            ok: true,
            model: "z-image-turbo-v2v-rtx3090",
            framesRestyled: frames.length,
            savedPath: outPath,
          };
        } catch (err) {
          return {
            ok: false,
            error: err instanceof Error ? err.message : "Video restyling failed",
          };
        } finally {
          await rm(workDir, { recursive: true, force: true }).catch(() => {});
        }
      },
    }),

    defineTool({
      name: "clone_voice",
      description:
        "Zero-shot voice cloning using local Qwen3-TTS-12Hz-1.7B-Base. Provide a short 3-15 second reference voice clip (filename in generated/ or full path) and any new dialogue text to generate a high-quality MP3 in that exact voice.",
      parameters: z.object({
        referenceAudioPath: z
          .string()
          .min(1)
          .describe("Reference audio filename in generated/ (e.g. my_voice.wav) or full path"),
        text: z
          .string()
          .min(1)
          .describe("The new dialogue or narration text to speak in the cloned voice"),
        referenceText: z
          .string()
          .optional()
          .describe(
            "Optional exact transcript of what is spoken in the reference audio clip for higher accuracy",
          ),
        language: z
          .enum([
            "Auto",
            "English",
            "Chinese",
            "Japanese",
            "Korean",
            "French",
            "German",
            "Spanish",
            "Portuguese",
            "Russian",
            "Italian",
          ])
          .default("Auto"),
        instruct: z
          .string()
          .optional()
          .describe("Optional delivery style or emotion instruction, e.g. calm, excited, dramatic"),
      }),
      execute: async ({ referenceAudioPath, text, referenceText, language, instruct }) => {
        try {
          const savedPath = await cloneVoiceLocal({
            referenceAudioPath,
            text,
            referenceText,
            language,
            instruct,
          });
          await appendPromptHistory({ tool: "clone_voice", prompt: text, savedPath });
          await appendPromptHistory({ tool: "clone_voice", prompt: text, savedPath: savedPath });
          return { ok: true, model: "qwen3-tts-12hz-1.7b-base", savedPath };
        } catch (err) {
          return {
            ok: false,
            error: err instanceof Error ? err.message : "Local voice cloning failed",
          };
        }
      },
    }),

    defineTool({
      name: "add_audio_to_video",
      description:
        "Add or mix a generated voiceover/audio track onto a video file using ffmpeg, saving a ready-to-play MP4 into generated/.",
      parameters: z.object({
        videoPath: z
          .string()
          .min(1)
          .describe("Video filename in generated/ (e.g. video-123.mp4) or full path"),
        audioPath: z
          .string()
          .min(1)
          .describe("Audio filename in generated/ (e.g. voice-456.mp3) or full path"),
        mixOriginalAudio: z
          .boolean()
          .default(false)
          .describe(
            "Set true to mix the new voiceover over the video existing audio; false replaces the audio track",
          ),
      }),
      execute: async ({ videoPath, audioPath, mixOriginalAudio }) => {
        await mkdir(GEN_DIR, { recursive: true });
        const absVideo = videoPath.startsWith("/")
          ? videoPath
          : join(GEN_DIR, videoPath.replace("generated/", ""));
        const absAudio = audioPath.startsWith("/")
          ? audioPath
          : join(GEN_DIR, audioPath.replace("generated/", ""));
        const outPath = join(GEN_DIR, `voiced-${Date.now()}.mp4`);
        const args = mixOriginalAudio
          ? [
              "-y",
              "-i",
              absVideo,
              "-i",
              absAudio,
              "-filter_complex",
              "[0:a][1:a]amix=inputs=2:duration=first:dropout_transition=2[aout]",
              "-map",
              "0:v:0",
              "-map",
              "[aout]",
              "-c:v",
              "copy",
              "-c:a",
              "aac",
              "-b:a",
              "192k",
              "-movflags",
              "+faststart",
              outPath,
            ]
          : [
              "-y",
              "-i",
              absVideo,
              "-i",
              absAudio,
              "-map",
              "0:v:0",
              "-map",
              "1:a:0",
              "-c:v",
              "copy",
              "-c:a",
              "aac",
              "-b:a",
              "192k",
              "-shortest",
              "-movflags",
              "+faststart",
              outPath,
            ];
        try {
          await execFileAsync("ffmpeg", args);
          return { ok: true, savedPath: outPath };
        } catch (err) {
          return {
            ok: false,
            error: err instanceof Error ? err.message : "ffmpeg audio mux failed",
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
        const preInputArgs: string[] = [];
        const postInputArgs: string[] = [];
        for (let i = 0; i < ffmpegArgs.length; i += 1) {
          const arg = ffmpegArgs[i];
          if (arg === "-stream_loop" && i + 1 < ffmpegArgs.length) {
            preInputArgs.push("-stream_loop", String(ffmpegArgs[i + 1]));
            i += 1;
          } else if (arg !== undefined) {
            postInputArgs.push(arg);
          }
        }
        const mp4Defaults =
          outputExt === "mp4" && !postInputArgs.includes("-c:v")
            ? ["-c:v", "libx264", "-pix_fmt", "yuv420p", "-movflags", "+faststart"]
            : [];
        try {
          await execFileAsync("ffmpeg", [
            "-y",
            ...preInputArgs,
            "-i",
            resolveMediaPath(inputPath),
            ...postInputArgs,
            ...mp4Defaults,
            outPath,
          ]);
          let durationSeconds: number | undefined;
          let resolution: string | undefined;
          try {
            const { stdout } = await execFileAsync("ffprobe", [
              "-v",
              "error",
              "-select_streams",
              "v:0",
              "-show_entries",
              "stream=width,height:format=duration",
              "-of",
              "json",
              outPath,
            ]);
            const probe = JSON.parse(stdout) as {
              streams?: Array<{ width?: number; height?: number }>;
              format?: { duration?: string };
            };
            const dur = Number(probe.format?.duration);
            if (Number.isFinite(dur) && dur > 0) durationSeconds = Math.round(dur * 100) / 100;
            const st = probe.streams?.[0];
            if (st?.width && st?.height) resolution = `${st.width}x${st.height}`;
          } catch {}
          return {
            ok: true,
            savedPath: outPath,
            ...(durationSeconds !== undefined ? { durationSeconds } : {}),
            ...(resolution ? { resolution } : {}),
          };
        } catch (err) {
          return { ok: false, error: err instanceof Error ? err.message : "ffmpeg failed" };
        }
      },
    }),
  ];
}

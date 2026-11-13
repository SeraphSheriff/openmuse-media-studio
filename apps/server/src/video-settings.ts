import { readFile, writeFile } from "node:fs/promises";
import { resolve } from "node:path";

export interface WorkflowTemplateDef {
  id: string;
  label: string;
  mode: "t2v" | "i2v";
  file: string;
  nodes: Record<string, [string, string]>;
}

export const WORKFLOW_TEMPLATES: Record<string, WorkflowTemplateDef> = {
  ltx23_t2v: {
    id: "ltx23_t2v",
    label: "LTX-2.3 Text-to-Video (22B Distilled)",
    mode: "t2v",
    file: "video-workflow.json",
    nodes: {
      prompt: ["267:266", "value"],
      negativePrompt: ["267:247", "text"],
      width: ["267:257", "value"],
      height: ["267:258", "value"],
      fps: ["267:260", "value"],
      duration: ["267:225", "value"],
      llmSwitch: ["267:330", "value"],
      llmMaxLen: ["267:327", "max_length"],
      llmTemp: ["267:327", "sampling_mode.temperature"],
      llmTopP: ["267:327", "sampling_mode.top_p"],
      llmTopK: ["267:327", "sampling_mode.top_k"],
      llmRepPen: ["267:327", "sampling_mode.repetition_penalty"],
      llmThinking: ["267:327", "thinking"],
      baseSampler: ["267:209", "sampler_name"],
      upscaleSampler: ["267:246", "sampler_name"],
      baseSigmas: ["267:252", "sigmas"],
      upscaleSigmas: ["267:211", "sigmas"],
      baseCfg: ["267:231", "cfg"],
      upscaleCfg: ["267:213", "cfg"],
      loraName: ["267:232", "lora_name"],
      loraStrength: ["267:232", "strength_model"],
      baseSeed: ["267:216", "noise_seed"],
      upscaleSeed: ["267:237", "noise_seed"],
      llmSeed: ["267:327", "sampling_mode.seed"],
      outPrefix: ["75", "filename_prefix"],
    },
  },
  ltx23_i2v: {
    id: "ltx23_i2v",
    label: "LTX-2.3 Image-to-Video (22B Distilled)",
    mode: "i2v",
    file: "video_ltx2_3_i2v.json",
    nodes: {
      image: ["269", "image"],
      prompt: ["320:319", "value"],
      negativePrompt: ["320:313", "text"],
      width: ["320:312", "value"],
      height: ["320:299", "value"],
      fps: ["320:300", "value"],
      duration: ["320:301", "value"],
      llmSwitch: ["320:328", "value"],
      llmMaxLen: ["320:325", "max_length"],
      llmTemp: ["320:325", "sampling_mode.temperature"],
      llmTopP: ["320:325", "sampling_mode.top_p"],
      llmTopK: ["320:325", "sampling_mode.top_k"],
      llmRepPen: ["320:325", "sampling_mode.repetition_penalty"],
      llmThinking: ["320:325", "thinking"],
      baseSampler: ["320:291", "sampler_name"],
      upscaleSampler: ["320:280", "sampler_name"],
      baseSigmas: ["320:306", "sigmas"],
      upscaleSigmas: ["320:281", "sigmas"],
      baseCfg: ["320:314", "cfg"],
      upscaleCfg: ["320:282", "cfg"],
      loraName: ["320:285", "lora_name"],
      loraStrength: ["320:285", "strength_model"],
      i2vBaseStrength: ["320:296", "strength"],
      i2vUpscaleStrength: ["320:288", "strength"],
      i2vImgCompression: ["320:289", "img_compression"],
      baseSeed: ["320:276", "noise_seed"],
      upscaleSeed: ["320:277", "noise_seed"],
      llmSeed: ["320:325", "sampling_mode.seed"],
      outPrefix: ["75", "filename_prefix"],
    },
  },
};

export type FieldDef =
  | { key: string; label: string; hint?: string; kind: "bool" }
  | { key: string; label: string; hint?: string; kind: "number"; min?: number; max?: number }
  | {
      key: string;
      label: string;
      hint?: string;
      kind: "text";
      multiline?: boolean;
      presets?: string[];
    }
  | {
      key: string;
      label: string;
      hint?: string;
      kind: "choice";
      options: Array<{ value: string; label: string }>;
    };

const samplers = ["euler", "euler_ancestral", "dpmpp_2m", "res_multistep"].map((v) => ({
  value: v,
  label: v,
}));

export const STUDIO_SCHEMA: Array<{ section: string; fields: FieldDef[] }> = [
  {
    section: "1. Workflow Templates & Prompt Guardrails",
    fields: [
      {
        key: "t2vTemplate",
        label: "Active Text-to-Video Template",
        kind: "choice",
        options: Object.values(WORKFLOW_TEMPLATES)
          .filter((t) => t.mode === "t2v")
          .map((t) => ({ value: t.id, label: t.label })),
      },
      {
        key: "i2vTemplate",
        label: "Active Image-to-Video Template",
        kind: "choice",
        options: Object.values(WORKFLOW_TEMPLATES)
          .filter((t) => t.mode === "i2v")
          .map((t) => ({ value: t.id, label: t.label })),
      },
      { key: "autoEnhancePrompt", label: "Auto-Apply Camera & Identity Guardrails", kind: "bool" },
      {
        key: "cameraPrefix",
        label: "Default Camera Prefix",
        kind: "text",
        presets: [
          "steady tripod camera",
          "slow cinematic dolly in",
          "smooth pan left to right",
          "aerial drone tracking shot",
          "",
        ],
      },
      {
        key: "styleSuffix",
        label: "Default Stability & Style Suffix",
        kind: "text",
        multiline: true,
      },
      {
        key: "negativePrompt",
        label: "Negative Prompt (T2V & I2V)",
        kind: "text",
        multiline: true,
      },
    ],
  },
  {
    section: "2. Image-to-Video Character & Hat Lock",
    fields: [
      {
        key: "i2vBaseStrength",
        label: "Base Pass Image Lock",
        hint: "Node 320:296 (0.92 locks faces/hats)",
        kind: "number",
        min: 0.5,
        max: 1,
      },
      {
        key: "i2vUpscaleStrength",
        label: "Upscale Pass Image Lock",
        hint: "Node 320:288 (1.0 preserves detail)",
        kind: "number",
        min: 0.5,
        max: 1,
      },
      {
        key: "i2vImgCompression",
        label: "Preprocess Compression",
        hint: "Node 320:289 (0–35, lower = sharper)",
        kind: "number",
        min: 0,
        max: 35,
      },
    ],
  },
  {
    section: "3. Duration, Resolution & Multi-Clip Chaining",
    fields: [
      {
        key: "aspectRatio",
        label: "Default Aspect Ratio",
        kind: "choice",
        options: [
          { value: "16:9", label: "16:9 Widescreen" },
          { value: "9:16", label: "9:16 Vertical" },
          { value: "1:1", label: "1:1 Square" },
        ],
      },
      {
        key: "resolutionMode",
        label: "Resolution Profile",
        kind: "choice",
        options: [
          { value: "fast_960x544", label: "Fast 960×544 (2x HD)" },
          { value: "hd_1280x720", label: "Native 1280×720" },
          { value: "custom", label: "Custom W×H" },
        ],
      },
      {
        key: "customWidth",
        label: "Custom Width",
        hint: "Multiple of 32",
        kind: "number",
        min: 256,
        max: 1920,
      },
      {
        key: "customHeight",
        label: "Custom Height",
        hint: "Multiple of 32",
        kind: "number",
        min: 256,
        max: 1920,
      },
      {
        key: "defaultDurationSeconds",
        label: "Default Duration (s)",
        hint: "4–180s (3 min max)",
        kind: "number",
        min: 4,
        max: 180,
      },
      {
        key: "maxChunkSeconds",
        label: "Max Single-Pass Chunk (s)",
        hint: "8s optimal for 24GB VRAM",
        kind: "number",
        min: 4,
        max: 10,
      },
      {
        key: "chainOverlapOffset",
        label: "Tail Frame Seek (s)",
        hint: "0.08s before clip end",
        kind: "number",
        min: 0.04,
        max: 0.5,
      },
      {
        key: "fps",
        label: "Frame Rate (FPS)",
        hint: "Default 25",
        kind: "number",
        min: 12,
        max: 60,
      },
    ],
  },
  {
    section: "4. LTX-2.3 Sampler, LoRA & CFG",
    fields: [
      { key: "baseSampler", label: "Base Pass Sampler", kind: "choice", options: samplers },
      { key: "upscaleSampler", label: "Upscale Pass Sampler", kind: "choice", options: samplers },
      {
        key: "baseCfg",
        label: "Base CFG Scale",
        hint: "Default 1.0",
        kind: "number",
        min: 1,
        max: 6,
      },
      {
        key: "upscaleCfg",
        label: "Upscale CFG Scale",
        hint: "Default 1.0",
        kind: "number",
        min: 1,
        max: 6,
      },
      {
        key: "loraStrength",
        label: "Distilled LoRA Strength",
        hint: "Default 0.5",
        kind: "number",
        min: 0,
        max: 1.5,
      },
      { key: "loraName", label: "Distilled LoRA Filename", kind: "text" },
      { key: "baseSigmas", label: "Base Pass Sigmas", kind: "text" },
      { key: "upscaleSigmas", label: "Upscale Pass Sigmas", kind: "text" },
    ],
  },
  {
    section: "5. Gemma-3 Expander, Seed & FFmpeg Output",
    fields: [
      { key: "fastMode", label: "Fast Mode (Bypass Gemma-3 2048-Token Expander)", kind: "bool" },
      {
        key: "llmMaxLen",
        label: "Gemma-3 Max Tokens",
        hint: "Used when Fast Mode is Off",
        kind: "number",
        min: 256,
        max: 2048,
      },
      {
        key: "llmTemp",
        label: "Gemma-3 Temperature",
        hint: "Default 0.7",
        kind: "number",
        min: 0.1,
        max: 1.5,
      },
      {
        key: "llmTopP",
        label: "Gemma-3 Top-P",
        hint: "Default 0.95",
        kind: "number",
        min: 0.1,
        max: 1,
      },
      {
        key: "llmTopK",
        label: "Gemma-3 Top-K",
        hint: "Default 64",
        kind: "number",
        min: 1,
        max: 200,
      },
      {
        key: "llmRepPen",
        label: "Gemma-3 Repetition Penalty",
        hint: "Default 1.05",
        kind: "number",
        min: 1,
        max: 1.5,
      },
      { key: "llmThinking", label: "Gemma-3 Thinking Mode", kind: "bool" },
      {
        key: "seedMode",
        label: "Seed Mode",
        kind: "choice",
        options: [
          { value: "random", label: "Random Seed" },
          { value: "fixed", label: "Fixed Seed" },
        ],
      },
      { key: "fixedSeed", label: "Fixed Seed Value", kind: "number", min: 0, max: 999999999999 },
      {
        key: "outputCodec",
        label: "FFmpeg Stitch Codec",
        kind: "choice",
        options: [
          { value: "libx264", label: "H.264 (MP4)" },
          { value: "libx265", label: "H.265 (HEVC)" },
        ],
      },
      {
        key: "outputCrf",
        label: "FFmpeg Quality (CRF)",
        hint: "12 = near-lossless, 28 = compact",
        kind: "number",
        min: 12,
        max: 28,
      },
    ],
  },
];

export type VideoSettings = Record<string, string | number | boolean>;

export const DEFAULT_VIDEO_SETTINGS: VideoSettings = {
  t2vTemplate: "ltx23_t2v",
  i2vTemplate: "ltx23_i2v",
  autoEnhancePrompt: true,
  cameraPrefix: "steady tripod camera",
  styleSuffix:
    "smooth natural motion, consistent faces, hats, and outfits, crisp photorealistic detail",
  negativePrompt: "pc game, console game, video game, cartoon, childish, ugly",
  aspectRatio: "16:9",
  resolutionMode: "fast_960x544",
  customWidth: 960,
  customHeight: 544,
  defaultDurationSeconds: 8,
  maxChunkSeconds: 8,
  chainOverlapOffset: 0.08,
  fps: 25,
  i2vBaseStrength: 0.92,
  i2vUpscaleStrength: 1.0,
  i2vImgCompression: 8,
  baseSampler: "euler",
  upscaleSampler: "euler",
  baseCfg: 1.0,
  upscaleCfg: 1.0,
  loraName: "ltx_2.3_22b_distilled_1.1_lora_dynamic_fro09_avg_rank_111_bf16.safetensors",
  loraStrength: 0.5,
  baseSigmas: "1.0, 0.99375, 0.9875, 0.98125, 0.975, 0.909375, 0.725, 0.421875, 0.0",
  upscaleSigmas: "0.85, 0.7250, 0.4219, 0.0",
  fastMode: true,
  llmMaxLen: 2048,
  llmTemp: 0.7,
  llmTopP: 0.95,
  llmTopK: 64,
  llmRepPen: 1.05,
  llmThinking: false,
  seedMode: "random",
  fixedSeed: 42,
  outputCodec: "libx264",
  outputCrf: 18,
};

const SETTINGS_PATH = resolve(process.cwd(), "video-defaults.json");

export async function readVideoSettings(): Promise<VideoSettings> {
  try {
    return { ...DEFAULT_VIDEO_SETTINGS, ...JSON.parse(await readFile(SETTINGS_PATH, "utf8")) };
  } catch {
    return { ...DEFAULT_VIDEO_SETTINGS };
  }
}

export async function writeVideoSettings(patch: Partial<VideoSettings>): Promise<VideoSettings> {
  const clean = Object.fromEntries(
    Object.entries(patch).filter(([, val]) => val !== undefined),
  ) as VideoSettings;
  const next: VideoSettings = { ...(await readVideoSettings()), ...clean };
  await writeFile(SETTINGS_PATH, JSON.stringify(next, null, 2), "utf8");
  return next;
}

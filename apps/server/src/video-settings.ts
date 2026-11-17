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
  ltx23_uncensored_t2v: {
    id: "ltx23_uncensored_t2v",
    label: "LTX-2.3 Uncensored v1.4 T2V (Q6_K GGUF)",
    mode: "t2v",
    file: "video_ltx2_3_uncensored_t2v.json",
    nodes: {
      prompt: ["19", "prompt"],
      negativePrompt: ["19", "negative_prompt"],
      width: ["19", "width"],
      height: ["19", "height"],
      fps: ["19", "frame_rate"],
      decodeFps: ["22", "fps"],
      frameLength: ["19", "length"],
      baseSampler: ["21", "sampler_name"],
      baseCfg: ["21", "cfg"],
      baseSeed: ["21", "seed"],
      upscaleSeed: ["21", "refine_seed"],
      outPrefix: ["75", "filename_prefix"],
    },
  },
  ltx23_uncensored_i2v: {
    id: "ltx23_uncensored_i2v",
    label: "LTX-2.3 Uncensored v1.4 I2V (Q6_K GGUF)",
    mode: "i2v",
    file: "video_ltx2_3_uncensored_i2v.json",
    nodes: {
      image: ["269", "image"],
      prompt: ["19", "prompt"],
      negativePrompt: ["19", "negative_prompt"],
      width: ["19", "width"],
      height: ["19", "height"],
      fps: ["19", "frame_rate"],
      decodeFps: ["22", "fps"],
      frameLength: ["19", "length"],
      i2vBaseStrength: ["19", "image_strength"],
      baseSampler: ["21", "sampler_name"],
      baseCfg: ["21", "cfg"],
      baseSeed: ["21", "seed"],
      upscaleSeed: ["21", "refine_seed"],
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

export type StudioTab = "video" | "image" | "audio" | "vision";
export const STUDIO_SCHEMA: Array<{ tab: StudioTab; section: string; fields: FieldDef[] }> = [
  {
    tab: "video",
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
    tab: "video",
    section: "2. Image Conditioning & Reference Fidelity",
    fields: [
      {
        key: "i2vBaseStrength",
        label: "Base Pass Image Lock",
        hint: "Node 320:296 (0.85–0.95 locks subject & silhouette)",
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
    tab: "video",
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
    tab: "video",
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
      {
        key: "motionGuidance",
        label: "Motion Scale",
        hint: "0.7 = subtle, 1.3 = dynamic",
        kind: "number",
        min: 0.3,
        max: 2.0,
      },
      { key: "audioEnabled", label: "Generate Native Video Audio Track", kind: "bool" },
      {
        key: "audioGuidance",
        label: "Audio Sync Guidance",
        hint: "Default 1.0",
        kind: "number",
        min: 0,
        max: 3.0,
      },
      { key: "loraName", label: "Distilled LoRA Filename", kind: "text" },
      { key: "baseSigmas", label: "Base Pass Sigmas", kind: "text" },
      { key: "upscaleSigmas", label: "Upscale Pass Sigmas", kind: "text" },
    ],
  },
  {
    tab: "video",
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
  {
    tab: "image",
    section: "1. Image Generation & Model Depth (Z-Image-Turbo / Studio)",
    fields: [
      {
        key: "imageEngine",
        label: "Active Image Pipeline",
        kind: "choice",
        options: [
          { value: "z_image_turbo", label: "Z-Image-Turbo (Fast Local)" },
          { value: "flux_dev", label: "FLUX.1-dev (High-Depth)" },
          { value: "flux_kontext", label: "FLUX.1-Kontext-dev (Pixel-Locked Edit)" },
        ],
      },
      {
        key: "imageSteps",
        label: "Denoising Steps",
        hint: "8 for Turbo, 24–32 for Studio Depth",
        kind: "number",
        min: 4,
        max: 50,
      },
      {
        key: "imageCfg",
        label: "Guidance Scale (CFG)",
        hint: "1.0 for Turbo, 3.5 for FLUX",
        kind: "number",
        min: 1.0,
        max: 10.0,
      },
      {
        key: "imageDenoise",
        label: "Edit / Restyle Denoise",
        hint: "0.35 subtle, 0.75 strong restyle",
        kind: "number",
        min: 0.1,
        max: 1.0,
      },
      {
        key: "imageAutoEnhance",
        label: "Auto-Expand Short Prompts (Cinematic Lighting & Lens)",
        kind: "bool",
      },
      {
        key: "imageNegativePrompt",
        label: "Default Image Negative Prompt",
        kind: "text",
        multiline: true,
      },
    ],
  },
  {
    tab: "audio",
    section: "1. Qwen3-TTS Voice Cloning & FFmpeg Audio Muxing",
    fields: [
      {
        key: "ttsLanguage",
        label: "Default Voice Language",
        kind: "choice",
        options: ["Auto", "English", "Japanese", "Spanish", "French", "German"].map((v) => ({
          value: v,
          label: v,
        })),
      },
      {
        key: "ttsExpressiveness",
        label: "Voice Expressiveness",
        hint: "0.5 calm, 1.0 natural, 1.3 dramatic",
        kind: "number",
        min: 0.2,
        max: 1.5,
      },
      {
        key: "audioMixVoiceGain",
        label: "Voiceover Mix Gain",
        hint: "Default 1.0",
        kind: "number",
        min: 0.2,
        max: 2.0,
      },
      {
        key: "audioMixBgGain",
        label: "Background Audio Gain",
        hint: "0.25 ducks music under voice",
        kind: "number",
        min: 0.0,
        max: 1.5,
      },
    ],
  },
  {
    tab: "vision",
    section: "1. Qwen2.5-VL Inspection & Poisson Feature Cloning",
    fields: [
      {
        key: "visionAutoUnload",
        label: "Auto-Free VRAM Immediately After Vision Inspection",
        kind: "bool",
      },
      {
        key: "cloneBlendMode",
        label: "Poisson Seamless Clone Mode",
        kind: "choice",
        options: [
          { value: "normal", label: "Normal Clone (Preserve Texture)" },
          { value: "mixed", label: "Mixed Clone (Blend Lighting)" },
        ],
      },
      {
        key: "cloneFeatherPx",
        label: "Mask Edge Feather (px)",
        hint: "0–32 px soft transition",
        kind: "number",
        min: 0,
        max: 32,
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
  motionGuidance: 1.0,
  audioEnabled: true,
  audioGuidance: 1.0,
  imageEngine: "flux_dev",
  editEngine: "flux_kontext",
  imageSteps: 8,
  imageCfg: 1.0,
  imageDenoise: 0.3,
  imageAutoEnhance: true,
  imageNegativePrompt: "blurry, lowres, plastic skin, deformed hands, watermark, text",
  ttsLanguage: "Auto",
  ttsExpressiveness: 1.0,
  audioMixVoiceGain: 1.0,
  audioMixBgGain: 0.25,
  visionAutoUnload: true,
  cloneBlendMode: "normal",
  cloneFeatherPx: 8,
  customModelDirs: "",
};

const SETTINGS_PATH = resolve(process.cwd(), "video-defaults.json");
const USER_DEFAULTS_PATH = resolve(process.cwd(), "user-video-defaults.json");

export async function saveUserVideoDefaults(settings: VideoSettings): Promise<VideoSettings> {
  const saved = await writeVideoSettings(settings);
  await writeFile(USER_DEFAULTS_PATH, `${JSON.stringify(saved, null, 2)}\n`, "utf8");
  return saved;
}

export async function resetVideoSettings(factory = false): Promise<{
  settings: VideoSettings;
  source: "user" | "factory";
}> {
  if (!factory) {
    try {
      const userRaw = JSON.parse(await readFile(USER_DEFAULTS_PATH, "utf8")) as VideoSettings;
      return {
        settings: await writeVideoSettings({ ...DEFAULT_VIDEO_SETTINGS, ...userRaw }),
        source: "user",
      };
    } catch {}
  }
  return { settings: await writeVideoSettings(DEFAULT_VIDEO_SETTINGS), source: "factory" };
}

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
  await writeFile(SETTINGS_PATH, `${JSON.stringify(next, null, 2)}\n`, "utf8");
  if (typeof next.customModelDirs === "string") await syncCustomModelSymlinks(next.customModelDirs);
  return next;
}

export interface ComponentCategoryScan {
  id: string;
  label: string;
  settingKey: string;
  dirs: string[];
  installNote: string;
  files: string[];
}

const COMFY_MODELS_ROOT = "/home/cowboy/ComfyUI/models";

const COMPONENT_DEFS: Array<{
  id: string;
  label: string;
  settingKey: string;
  dirs: string[];
  installNote: string;
}> = [
  {
    id: "text_encoders",
    label: "Text Encoders (CLIP / T5 / Other)",
    settingKey: "activeTextEncoder",
    dirs: ["text_encoders", "clip", "clip_projections"],
    installNote:
      "Place .safetensors or .gguf CLIP/T5 encoders in ~/ComfyUI/models/text_encoders/ or ~/ComfyUI/models/clip/ (from Hugging Face Comfy-Org or Kijai repos).",
  },
  {
    id: "vae",
    label: "VAE (Variational Autoencoders)",
    settingKey: "activeVae",
    dirs: ["vae", "vae_approx"],
    installNote:
      "Place .safetensors VAE files (e.g. ae.safetensors, sdxl_vae.safetensors) in ~/ComfyUI/models/vae/.",
  },
  {
    id: "loras",
    label: "LoRA Adapters",
    settingKey: "activeImageLora",
    dirs: ["loras"],
    installNote:
      "Place .safetensors LoRA weights in ~/ComfyUI/models/loras/ (available from Civitai or Hugging Face).",
  },
  {
    id: "controlnet",
    label: "ControlNet / Control Adapters",
    settingKey: "activeControlNet",
    dirs: ["controlnet", "model_patches", "gligen"],
    installNote:
      "None found. Place ControlNet / Union / Depth / Canny .safetensors models in ~/ComfyUI/models/controlnet/ (from Hugging Face InstantX, Shakker-Labs, or lllyasviel).",
  },
  {
    id: "ipadapter",
    label: "IP-Adapter / Image Encoders (CLIP Vision)",
    settingKey: "activeIpAdapter",
    dirs: ["ipadapter", "clip_vision", "style_models", "photomaker"],
    installNote:
      "None found. Place IP-Adapter .safetensors/.bin files in ~/ComfyUI/models/ipadapter/ and CLIP-Vision encoders in ~/ComfyUI/models/clip_vision/.",
  },
  {
    id: "embeddings",
    label: "Textual Inversion Embeddings",
    settingKey: "activeEmbedding",
    dirs: ["embeddings", "hypernetworks"],
    installNote:
      "None found. Place .safetensors or .pt embedding tokens in ~/ComfyUI/models/embeddings/.",
  },
  {
    id: "upscalers",
    label: "Upscalers (Pixel & Latent)",
    settingKey: "activeUpscaler",
    dirs: ["upscale_models", "latent_upscale_models"],
    installNote:
      "Place ESRGAN / RealESRGAN / SwinIR .pth or .safetensors models in ~/ComfyUI/models/upscale_models/ (or latent upscalers in latent_upscale_models/).",
  },
  {
    id: "video_motion",
    label: "Video / Motion & Diffusion Checkpoints",
    settingKey: "activeVideoComponent",
    dirs: [
      "diffusion_models",
      "checkpoints",
      "unet",
      "frame_interpolation",
      "optical_flow",
      "audio_encoders",
    ],
    installNote:
      "Place LTX / Wan / Hunyuan / FLUX .safetensors checkpoints in ~/ComfyUI/models/diffusion_models/ or checkpoints/.",
  },
];

async function walkModelFiles(
  dirPath: string,
  prefix = "",
  visited = new Set<string>(),
  depth = 0,
): Promise<string[]> {
  if (depth > 4) return [];
  const { readdir, realpath } = await import("node:fs/promises");
  const out: string[] = [];
  try {
    const real = await realpath(dirPath);
    if (visited.has(real)) return [];
    visited.add(real);
    const entries = await readdir(dirPath, { withFileTypes: true });
    for (const ent of entries) {
      if (ent.name.startsWith(".")) continue;
      const rel = prefix ? `${prefix}/${ent.name}` : ent.name;
      const full = resolve(dirPath, ent.name);
      if (ent.isDirectory() || ent.isSymbolicLink()) {
        out.push(...(await walkModelFiles(full, rel, visited, depth + 1)));
      } else if (/\.(safetensors|ckpt|pt|pth|bin|gguf)$/i.test(ent.name)) {
        out.push(rel);
      }
    }
  } catch {}
  return out;
}

export async function scanComfyInventory(): Promise<ComponentCategoryScan[]> {
  const curCfg = await readVideoSettings();
  await syncCustomModelSymlinks(String(curCfg.customModelDirs ?? "/mnt/a/AI_Models"));
  const results: ComponentCategoryScan[] = [];
  for (const def of COMPONENT_DEFS) {
    const found = new Set<string>();
    for (const sub of def.dirs) {
      const files = await walkModelFiles(resolve(COMFY_MODELS_ROOT, sub));
      for (const f of files) found.add(f);
    }
    results.push({
      ...def,
      files: [...found].sort((a, b) => a.localeCompare(b)),
    });
  }
  return results;
}

export async function verifyComfyInventory(autoSync = false) {
  const inventory = await scanComfyInventory();
  const cfg = await readVideoSettings();
  const issues: string[] = [];
  const patch: Record<string, string> = {};
  for (const cat of inventory) {
    const cur = typeof cfg[cat.settingKey] === "string" ? String(cfg[cat.settingKey]) : "";
    if (cur && cur !== "none" && !cat.files.includes(cur)) {
      issues.push(`${cat.label}: selected "${cur}" was not found on disk.`);
      if (autoSync) patch[cat.settingKey] = cat.files.at(0) || "none";
    }
    if (
      cat.id === "loras" &&
      typeof cfg.loraName === "string" &&
      cfg.loraName &&
      !cat.files.includes(cfg.loraName)
    ) {
      issues.push(`Video LoRA: "${cfg.loraName}" not found in ~/ComfyUI/models/loras/.`);
    }
  }
  const updatedSettings =
    autoSync && Object.keys(patch).length > 0 ? await writeVideoSettings(patch) : cfg;
  return {
    ok: issues.length === 0,
    checkedAt: new Date().toISOString(),
    totalFiles: inventory.reduce((acc, c) => acc + c.files.length, 0),
    issues,
    inventory,
    settings: updatedSettings,
  };
}

export function normalizeModelRoot(raw: string): string {
  const t = raw.trim().replace(/\\/g, "/").replace(/\/+$/, "");
  const win = /^([a-zA-Z]):\/(.*)$/.exec(t);
  return win ? `/mnt/${win.at(1)?.toLowerCase()}/${win.at(2) ?? ""}` : t;
}

export async function syncCustomModelSymlinks(rawDirs: string): Promise<string[]> {
  const { mkdir, symlink, lstat, unlink, realpath } = await import("node:fs/promises");
  const { existsSync } = await import("node:fs");
  const comfyBase = "/home/cowboy/ComfyUI/models";
  const subdirs = [
    "loras",
    "checkpoints",
    "diffusion_models",
    "unet",
    "text_encoders",
    "clip",
    "vae",
    "controlnet",
    "ipadapter",
    "clip_vision",
    "embeddings",
    "upscale_models",
  ];
  const roots = rawDirs
    .split(/[\n,;]+/)
    .map(normalizeModelRoot)
    .filter(Boolean);
  const linked: string[] = [];
  for (let i = 0; i < roots.length; i++) {
    const root = roots[i];
    if (!existsSync(root)) continue;
    for (const sub of subdirs) {
      const src = `${root}/${sub}`;
      if (!existsSync(src)) continue;
      const dstDir = `${comfyBase}/${sub}`;
      await mkdir(dstDir, { recursive: true });
      try {
        if ((await realpath(src)) === (await realpath(dstDir))) continue;
      } catch {}
      const linkPath = `${dstDir}/custom_${i}`;
      await mkdir(dstDir, { recursive: true });
      try {
        const st = await lstat(linkPath);
        if (st.isSymbolicLink()) await unlink(linkPath);
      } catch {}
      try {
        await symlink(src, linkPath, "dir");
        linked.push(linkPath);
      } catch {}
    }
  }
  return linked;
}

export type ModelFamily =
  | "FLUX"
  | "Z-Image"
  | "LTX-2.3"
  | "Gemma-3"
  | "SDXL"
  | "SD1.5"
  | "Wan / Hunyuan"
  | "Universal";

export async function detectModelFamily(absPath: string, relName: string): Promise<ModelFamily> {
  let headerKeys = "";
  if (/\.safetensors$/i.test(absPath)) {
    try {
      const { open } = await import("node:fs/promises");
      const fh = await open(absPath, "r");
      try {
        const lenBuf = Buffer.alloc(8);
        await fh.read(lenBuf, 0, 8, 0);
        const headerLen = Number(lenBuf.readBigUInt64LE(0));
        if (headerLen > 0 && headerLen < 16_000_000) {
          const sliceLen = Math.min(headerLen, 65536);
          const hdrBuf = Buffer.alloc(sliceLen);
          await fh.read(hdrBuf, 0, sliceLen, 8);
          headerKeys = hdrBuf.toString("utf8").toLowerCase();
        }
      } finally {
        await fh.close();
      }
    } catch {}
  }
  const sig = `${relName.toLowerCase()} ${headerKeys}`;
  if (/\bltx|ltxv|ltx_2\.3/.test(sig)) return "LTX-2.3";
  if (/\bgemma/.test(sig)) return "Gemma-3";
  if (/qwen_3_4b|z_image|z-image|nextdit|lumina/.test(sig)) return "Z-Image";
  if (/double_blocks|single_blocks|\bflux\b|kontext|ae\.safetensors|t5xxl|clip_l/.test(sig))
    return "FLUX";
  if (/wan2|hunyuan/.test(sig)) return "Wan / Hunyuan";
  if (/conditioner\.embedders|sdxl|pony|illustrious/.test(sig)) return "SDXL";
  if (/cond_stage_model\.transformer|sd15|v1-5/.test(sig)) return "SD1.5";
  return "Universal";
}

export interface SettingConflict {
  id: string;
  severity: "error" | "warning";
  title: string;
  detail: string;
  fixLabel?: string;
  fixPatch?: Record<string, string | number | boolean>;
}

export async function detectSettingConflicts(
  cfg: Record<string, unknown>,
  inventory?: ComponentCategoryScan[],
): Promise<{
  families: Record<string, ModelFamily>;
  conflicts: SettingConflict[];
}> {
  const inv = inventory ?? (await scanComfyInventory());
  const families: Record<string, ModelFamily> = {};
  for (const grp of inv) {
    for (const f of grp.files) {
      if (families[f]) continue;
      for (const sub of grp.dirs) {
        const p = resolve(COMFY_MODELS_ROOT, sub, f);
        const { existsSync } = await import("node:fs");
        if (existsSync(p)) {
          families[f] = await detectModelFamily(p, f);
          break;
        }
      }
    }
  }

  const conflicts: SettingConflict[] = [];
  const imgEngine = String(cfg.imageEngine || "z_image_turbo");
  const lora = String(cfg.loraName || "");
  const vae = String(cfg.activeVae || "");
  const enc = String(cfg.activeTextEncoder || "");
  const cn = String(cfg.activeControlNet || "");

  if (lora) {
    const lf = families[lora] || (await detectModelFamily("", lora));
    if (lf === "SDXL" || lf === "SD1.5") {
      conflicts.push({
        id: "lora_sd_arch",
        severity: "error",
        title: `Incompatible LoRA Architecture (${lf})`,
        detail: `"${lora}" is built for ${lf}, which cannot load into FLUX.1-dev, Z-Image-Turbo, or LTX-2.3.`,
        fixLabel: "Clear Incompatible LoRA",
        fixPatch: { loraName: "" },
      });
    } else if (lf === "FLUX" && imgEngine === "z_image_turbo") {
      conflicts.push({
        id: "lora_flux_on_zimage",
        severity: "warning",
        title: "FLUX LoRA Selected While Image Engine Is Z-Image-Turbo",
        detail: `"${lora}" targets FLUX.1-dev. Switch Image Engine to FLUX.1-dev so image renders apply this LoRA.`,
        fixLabel: "Switch Image Engine to FLUX.1-dev",
        fixPatch: { imageEngine: "flux_dev", imageSteps: 28, imageCfg: 3.5 },
      });
    } else if (lf === "Z-Image" && imgEngine === "flux_dev") {
      conflicts.push({
        id: "lora_zimage_on_flux",
        severity: "warning",
        title: "Z-Image LoRA Selected While Image Engine Is FLUX.1-dev",
        detail: `"${lora}" targets Z-Image-Turbo. Switch Image Engine to Z-Image-Turbo to use it.`,
        fixLabel: "Switch Image Engine to Z-Image-Turbo",
        fixPatch: { imageEngine: "z_image_turbo", imageSteps: 8, imageCfg: 1.0 },
      });
    }
  }

  if (vae) {
    const vf = families[vae] || (await detectModelFamily("", vae));
    if (vf === "LTX-2.3" && (imgEngine === "flux_dev" || imgEngine === "z_image_turbo")) {
      conflicts.push({
        id: "vae_ltx_on_image",
        severity: "warning",
        title: "LTX-2.3 Video/Audio VAE Selected in General VAE Slot",
        detail: `"${vae}" is a video/audio VAE for LTX-2.3. Image pipelines require ae.safetensors.`,
        fixLabel: "Set VAE to ae.safetensors",
        fixPatch: { activeVae: "ae.safetensors" },
      });
    }
  }

  if (enc) {
    const ef = families[enc] || (await detectModelFamily("", enc));
    if ((ef === "LTX-2.3" || ef === "Gemma-3") && imgEngine === "flux_dev") {
      conflicts.push({
        id: "enc_ltx_on_flux",
        severity: "warning",
        title: `${ef} Encoder Selected While Image Engine Is FLUX.1-dev`,
        detail: `"${enc}" belongs to LTX-2.3 video generation. FLUX.1-dev uses clip_l + t5xxl.`,
        fixLabel: "Reset Encoder to Default",
        fixPatch: { activeTextEncoder: "" },
      });
    }
  }

  if (cn) {
    const cf = families[cn] || (await detectModelFamily("", cn));
    if (
      (cf === "SDXL" || cf === "SD1.5") &&
      (imgEngine === "flux_dev" || imgEngine === "z_image_turbo")
    ) {
      conflicts.push({
        id: "cn_arch_mismatch",
        severity: "error",
        title: `Incompatible ControlNet Architecture (${cf})`,
        detail: `"${cn}" is for ${cf} and will fail on ${imgEngine}.`,
        fixLabel: "Clear Incompatible ControlNet",
        fixPatch: { activeControlNet: "" },
      });
    }
  }

  return { families, conflicts };
}

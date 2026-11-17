# OpenMuse Media Studio (OMS)

Local-first AI media production workstation combining a symmetric 3-column studio UI, multi-engine ComfyUI pipelines, offline vision grounding, RTX 3090 Whisper dictation, and live model inventory management.

## Symmetric 3-Column Workstation

| Dock / Area | Key Controls & Features |
| :--- | :--- |
| **Left Dock (`ComfyUI Control & Console`)** | Live GPU VRAM monitor, **Stop Render**, **Free VRAM**, adjustable **Agent Step Limit**, storage selector, and color-coded **Console Log** (`ComfyUI`, `LLM`, `Vision`, `Studio`) with severity filters. |
| **Center Workspace (`Chat & Studio Bar`)** | 1-click LLM switcher (**Gemini**, **Qwen3 8B**, **Qwen3 14B**), image engine pill, **Studio Settings · All Pipelines**, live **Agent Avatar** uploader, **Whisper** voice dictation (`Mic`), and pre-send prompt guardrails. |
| **Right Dock (`Media Studio & Prompts`)** | Collapsible **Input Dropzone** (`generated/`), 1-click **Record Voice Sample**, inline gallery with **Prompt**, **Copy Filename**, **Copy Prompt**, **Avatar**, **↗**, and **Del**, plus a persistent **Prompts** drawer. |

## AI Media, Vision & Audio Tools

| Tool Name | Backend Engine | Core Capability |
| :--- | :--- | :--- |
| `generate_image` | `FLUX.1-dev` / `Z-Image-Turbo` | 100% local text-to-image generation (no silent cloud fallbacks or watermarks) with automatic prompt logging. |
| `edit_image` | `FLUX.1-Kontext-dev` + `SetLatentNoiseMask` | Pixel-locked attribute/style editing with `ReferenceLatent` and `ImageCompositeMasked`. |
| `remove_object` | `Qwen2.5-VL` + `FLUX.1-dev` (`denoise: 1.0`) | Clean-plate object/watermark removal without `ReferenceLatent` ghosting. |
| `generate_video` / `animate_image` | `LTX-2.3` (22B Distilled) | T2V and I2V MP4 generation with audio up to 180s and `"exact"` identity lock. |
| `extend_video` / `restyle_video` | `LTX-2.3` + `FFmpeg` | Frame-anchored clip extension and frame-by-frame restyling with audio muxing. |
| `inspect_image` / `copy_region` | `Qwen2.5-VL` + `OpenCV` | Normalized bounding-box grounding and Poisson seamless feature cloning. |
| `clone_voice` / `add_audio_to_video` | `Qwen3-TTS-1.7B` + `FFmpeg` | Zero-shot voice cloning from 3–15s reference clips and video audio muxing/mixing. |

## Studio Settings & Quality Presets

| Preset / Control | Image & Video Parameters | Intended Use |
| :--- | :--- | :--- |
| **`Draft (8-Step)`** | `960x544`, `imageSteps: 8`, `loraStrength: 0.5`, `i2vImgCompression: 8` | Fast iteration, layout checks, and quick motion previews. |
| **`Cinema Quality`** | `1280x720`, `imageSteps: 28`, `loraStrength: 0.25`, `i2vImgCompression: 0` | High-detail final renders with maximum subject and face identity lock. |
| **`Verify & Sync Filesystem`** | Live `realpath`-safe recursive disk scan + `.safetensors` header inspector | Tags components (`[FLUX]`, `[Z-Image]`, `[LTX-2.3]`, `[SDXL]`) and flags conflicts with 1-click Auto-Fix. |
| **`LLM & Presets` + Dirty Guard** | Dedicated LLM/preset tab, live header pill sync, deep-diff unsaved guard | Switches `Qwen3 8B`/`14B`/`Gemini` cleanly and warns before discarding unsaved edits. |

## ComfyUI Model Directories & Custom Storage

Custom Windows (`A:\AI_Models`) or Linux (`/mnt/a/AI_Models`) storage roots configured in **Models & Components** are automatically symlinked (`custom_0`, `custom_1`, ...) into `~/ComfyUI/models/` with loop protection:

| Component Category | Scanned ComfyUI Subfolders | Setting Key | Supported Formats |
| :--- | :--- | :--- | :--- |
| **Text Encoders** | `text_encoders`, `clip`, `clip_projections` | `activeTextEncoder` | `.safetensors`, `.gguf`, `.bin` |
| **VAE** | `vae`, `vae_approx` | `activeVae` | `.safetensors`, `.pt` |
| **LoRA** | `loras` | `loraName` | `.safetensors` |
| **ControlNet** | `controlnet`, `model_patches`, `gligen` | `activeControlNet` | `.safetensors`, `.pth` |
| **IP-Adapter / Vision** | `ipadapter`, `clip_vision`, `style_models`, `photomaker` | `activeIpAdapter` | `.safetensors`, `.bin` |
| **Embeddings** | `embeddings`, `hypernetworks` | `activeEmbedding` | `.safetensors`, `.pt` |
| **Upscalers** | `upscale_models`, `latent_upscale_models` | `activeUpscaler` | `.pth`, `.safetensors` |
| **Video & Checkpoints** | `diffusion_models`, `checkpoints`, `unet`, `frame_interpolation`, `optical_flow` | `activeVideoComponent` | `.safetensors`, `.gguf`, `.ckpt` |

## Quick Start

1. Install dependencies and generate local keys: `pnpm install && ./generateOpenmuseKeys`
2. Copy `.env.example` to `.env` and configure your local `llama.cpp`, `ComfyUI`, and optional cloud keys.
3. Launch OpenMuse Media Studio (`:8081`), API (`:8787`), and ComfyUI (`:8188`): `./start-studio`
4. Stop all services and free GPU VRAM: `./stop-studio`

# OpenMuse Media Studio

**OpenMuse Media Studio** is a local-first AI media production workstation combining a symmetric 3-column studio UI, live `llama.cpp` model & VRAM switching, local `Z-Image-Turbo` image generation/editing, local `LTX-2.3` long-form video chaining, offline `Qwen2.5-VL` vision inspection & Poisson feature cloning, `Qwen3-TTS` zero-shot voice cloning with 1-click USB mic recording, and an interactive **Help & Prompts** guide.

## Key Features

- **Symmetric 3-Column Studio Workstation:**
  - **Left Dock (`ComfyUI Control` & `Console Log`):** Live GPU VRAM monitor, **Stop Render**, **Free VRAM**, adjustable **Agent Step Limit (`− / +`)**, dynamic **Download & Save Models To:** storage selector, process color-coded **Console Log** (`ComfyUI`, `LLM`, `Vision`, `Studio`) with `All / Info / Warn / Error` severity filters, and a smooth drag-to-resize slider.
  - **Center Workspace:** 1-click live model switcher (**Gemini**, **Qwen3 8B**, **Qwen3 14B**), centered header with **ComfyUI ↗** launcher, **Video Studio** template drawer (`T2V` / `I2V`), live on-the-fly **Agent Avatar** uploader, and a built-in **Help** tab with 1-click copyable example prompts.
  - **Right Dock (`Media Studio`):** Drag-and-drop **Input Dropzone** (`generated/`), 1-click **Record Voice Sample (Mic)** with automatic `24kHz` mono `.wav` conversion, live **Generated & Uploaded** gallery with inline image/video/audio playback, 1-click **Copy**, **Avatar**, **↗**, and **Del** buttons, plus a matching drag-to-resize slider.
- **Local Image, Video, Vision & Voice Pipelines:**
  - **`Z-Image-Turbo` (`generate_image` & `edit_image`):** 8-step local text-to-image and image-to-image editing via ComfyUI with automatic cloud fallback.
  - **`LTX-2.3` Video Chaining (`generate_video` / `animate_image`):** Pluggable T2V and I2V workflow templates supporting clips up to 180 seconds.
  - **Local Vision & Seamless Feature Cloning (`inspect_image` & `copy_region`):** On-demand `Qwen2.5-VL` coordinate grounding paired with OpenCV `seamlessClone` Poisson blending for same-image or cross-image feature transfer.
  - **Zero-Shot Voice Cloning & Audio Muxing (`clone_voice` & `add_audio_to_video`):** Local `Qwen3-TTS-12Hz-1.7B-Base` voice cloning from any 3–15s reference clip plus `ffmpeg` voiceover muxing/mixing onto `.mp4` videos.

## Quick Start

1. Install dependencies and generate local keys:
   ```bash
   pnpm install && ./generateOpenmuseKeys
   ```
2. Copy `.env.example` to `.env` and configure your local model paths / optional cloud keys.
3. Launch OpenMuse Media Studio and ComfyUI:
   ```bash
   ./start-studio
   ```
4. Stop all services and free GPU VRAM:
   ```bash
   ./stop-studio
   ```

## Documentation

- See `CHANGELOG.md` for release history.
- See `REQUIREMENTS.md` for system requirements.
- See `UPSTREAM_README.md` for upstream OpenMuse architecture.

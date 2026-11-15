# OpenMuse Media Studio

**OpenMuse Media Studio** is a local-first AI media production workstation combining a symmetric 3-column studio UI, live `llama.cpp` model & VRAM switching, local `Z-Image-Turbo` image generation/editing, local `LTX-2.3` long-form video chaining, offline `Qwen2.5-VL` vision inspection & Poisson feature cloning, and on-the-fly avatar customization.

## Key Features

- **Symmetric 3-Column Studio Workstation:**
  - **Left Dock (`ComfyUI Control`):** Live GPU VRAM monitor, **Stop Render**, **Free VRAM**, adjustable **Agent Step Limit (`− / +`)**, dynamic **Download & Save Models To:** storage selector (auto-detecting shared drives + local ComfyUI models), and collapsible live **Console Log**.
  - **Center Workspace:** 1-click live model switcher (**Gemini**, **Qwen3 8B**, **Qwen3 14B**), centered header with quick **ComfyUI ↗** launcher, **Video Studio** template drawer (`T2V` / `I2V`), and live on-the-fly **Agent Avatar** uploader.
  - **Right Dock (`Media Studio`):** Drag-and-drop / file-picker **Input Dropzone** (`generated/`) and live **Generated & Uploaded** gallery with inline image previews, HTTP `206` playable video scrubbing, 1-click **Copy** filename, **Avatar** quick-set, and **↗** pop-out.
- **Local Image, Video, Vision & Cloning Pipelines:**
  - **`Z-Image-Turbo` (`generate_image` & `edit_image`):** 8-step local text-to-image and image-to-image editing via ComfyUI with automatic cloud fallback.
  - **`LTX-2.3` Video Chaining (`generate_video`):** Pluggable T2V and I2V workflow templates supporting clips up to 180 seconds.
  - **Local Vision & Seamless Feature Cloning (`inspect_image` & `copy_region`):** On-demand `Qwen2.5-VL` coordinate grounding paired with OpenCV `seamlessClone` Poisson blending for same-image or cross-image feature transfer.

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

# System & Software Requirements

OpenMuse Media Studio runs natively on **Linux**, **macOS**, and **Windows (via WSL2)**.

## 1. Included Automatically via `pnpm install`
All application frameworks and libraries—including **CopilotKit** (`@copilotkit/runtime`, `@copilotkit/react-native`), Hono, Expo Web, and Zod—are declared in `package.json` and installed automatically when you run `pnpm install` on any OS.

## 2. Core System Prerequisites (All Platforms)
- **OS:** Any Unix-like environment (Ubuntu/Debian/Fedora/Arch Linux, macOS, or Windows 10/11 via **WSL2**).
- **Node.js & Package Manager:** Node.js `22+` and `pnpm`.
- **Docker:** Required for OpenMuse's sandboxed computer workspace and PostgreSQL database.
- **FFmpeg:** `ffmpeg` binary available in your system `PATH` (used for extracting tail frames and stitching multi-chunk videos up to 180s).
- **LLM API Key:** Configured in `.env` (see [UPSTREAM_README.md](./UPSTREAM_README.md) for supported providers).

## 3. Local Video Generation Backend (Required for Video Studio)
- **ComfyUI:** Installed locally (default `$HOME/ComfyUI`, or set `COMFYUI_DIR` in `.env`) and listening on `http://127.0.0.1:8188`.
- **GPU / VRAM:**
  - **NVIDIA GPU (Linux / WSL2):** 24 GB VRAM recommended for full-speed 8-second chunks at `960×544` with 2x spatial upscale (e.g., RTX 3090 / 4090). Lower VRAM GPUs can reduce `maxChunkSeconds` to `4`–`5` in **Video studio**.
  - **Apple Silicon (macOS):** Supported via ComfyUI MPS backend (adjust chunk duration in **Video studio** to match unified memory).
- **Default Models (for included LTX-2.3 templates):**
  - LTX-2.3 22B checkpoint + `ltx_2.3_22b_distilled_1.1_lora_dynamic_fro09_avg_rank_111_bf16.safetensors` + Gemma-3 text encoder.
  - *Using other models?* You do **not** need LTX-2.3 if you register your own ComfyUI API workflow JSON in `WORKFLOW_TEMPLATES` (`apps/server/src/video-settings.ts`).

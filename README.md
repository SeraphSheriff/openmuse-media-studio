# OpenMuse Media Studio (OMS)

**OpenMuse Media Studio (OMS)** is a local-first AI media production workstation featuring a symmetric 3-column studio UI, multi-engine ComfyUI image/video pipelines, offline vision grounding, local Whisper voice dictation, and live filesystem model inventory management.

---

## Overview of Matrices

* **Symmetric 3-Column Workstation Matrix**: Outlines controls and features across the Left Dock (`ComfyUI Control & Console`), Center Workspace (`Chat & Studio Bar`), and Right Dock (`Media Studio & Prompts`).
* **AI Media, Vision & Audio Tools Matrix**: Covers backend engines and core capabilities for tools ranging from `generate_image` and `edit_image` to `generate_video`, `clone_voice`, and `inspect_image`.
* **Studio Settings & Quality Presets Matrix**: Details resolutions, steps, denoise settings, and use cases for modes like `⚡ Draft (8-Step)` and `🎬 Cinema Quality`.
* **ComfyUI Model Directories & Custom Storage Matrix**: Details scanned subfolders, setting keys, and supported formats across categories such as Text Encoders, VAE, LoRA, ControlNet, IP-Adapter, Embeddings, Upscalers, and Video/Motion checkpoints.

---

## Quick Start

1. **Install dependencies & generate local keys:**
   ```bash
   pnpm install && ./generateOpenmuseKeys
   ```
2. **Configure environment:** Copy `.env.example` to `.env` and configure your local `llama.cpp`, `ComfyUI`, and optional cloud API keys.
3. **Start OpenMuse Media Studio + ComfyUI:**
   ```bash
   ./start-studio
   ```
   - **OpenMuse Studio UI:** `http://localhost:8081`
   - **OpenMuse API Server:** `http://localhost:8787`
   - **ComfyUI Backend:** `http://localhost:8188`
4. **Stop all services & free GPU VRAM:**
   ```bash
   ./stop-studio
   ```

# OpenMuse Media Studio (OMS)

**OpenMuse Media Studio (OMS)** is a local-first AI media production workstation featuring a 3-column studio UI, multi-engine ComfyUI image/video pipelines, offline vision grounding, and live filesystem inventory management.

---

## Overview

OpenMuse Media Studio provides a comprehensive suite of local AI tools, including a symmetric 3-column workstation layout (ComfyUI control/console, chat/studio controls, media/history), an AI media/vision/audio tools matrix, configurable quality presets (`Draft` and `Cinema Quality`), ComfyUI model directory auto-symlinking, and streamlined shell scripts for setup, execution, and teardown.

---

## Quick Start

1. **Install dependencies & generate local keys:**
   ```bash
   pnpm install && ./generateOpenmuseKeys
   ```
2. **Configure environment:** Copy `.env.example` to `.env` and set your local `llama.cpp`, `ComfyUI`, and optional cloud API keys.
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

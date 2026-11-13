# OpenMuse Media Studio

OpenMuse media production suite featuring a native ComfyUI Video Studio drawer, pluggable workflow templates (T2V/I2V included as defaults), long-form video chaining, and Dark Mode.

> **Upstream Base Build:** OpenMuse `v0.1.0` (commit [`a4944f4`](https://github.com{fullCommit})) — see [UPSTREAM_README.md](./UPSTREAM_README.md) for base OpenMuse documentation and [REQUIREMENTS.md](./REQUIREMENTS.md) for full system & platform requirements.

## What's Added in Media Studio

- **Native ComfyUI Video Studio Drawer (`≡ -> Video studio`):** Schema-driven UI exposing 29 live node-level parameters saved to `video-defaults.json` without code edits or restarts.
- **Pluggable Workflow Templates (T2V & I2V):** Ships with LTX-2.3 22B Text-to-Video (`video-workflow.json`) and Image-to-Video (`video_ltx2_3_i2v.json`). Add future ComfyUI API workflows anytime by registering `[nodeId, inputField]` mappings in `WORKFLOW_TEMPLATES` inside `apps/server/src/video-settings.ts`.
- **Long-Form Video Chaining (Up to 180 Seconds):** Automatically splits renders into GPU-safe chunks, extracts tail frames via `ffmpeg`, and chains segments into a single seamless `.mp4`.
- **Native Dark & Light Theme (`≡ -> Dark mode`):** Built-in theme toggle persisted in browser `localStorage`.
- **Portable Launcher Helpers:** Includes `./start-studio`, `./stop-studio`, `./startdocker`, and `./generateOpenmuseKeys` (configurable via `OPENMUSE_AGENT_NAME`, `OPENMUSE_OWNER`, and `COMFYUI_DIR` in `.env`).

## Quick Start

1. Review [REQUIREMENTS.md](./REQUIREMENTS.md) and complete base setup from [UPSTREAM_README.md](./UPSTREAM_README.md) (`pnpm install` + `./generateOpenmuseKeys`).
2. Start **ComfyUI** and OpenMuse together via `./start-studio` (or start services individually with `pnpm dev`).
3. Open `http://localhost:8081` and configure your defaults in `≡ -> Video studio`.

## How to Add Future ComfyUI Workflow Templates Anytime

1. **Export from ComfyUI:** Enable **Dev Mode Options** in ComfyUI and export your workflow using **File -> Export (API)** into `apps/server/src/your_new_workflow.json`.
2. **Register the Template:** Add one entry to `WORKFLOW_TEMPLATES` in `apps/server/src/video-settings.ts` mapping your desired setting keys (`prompt`, `width`, `height`, `duration`, `fps`, `baseSeed`, `outPrefix`, etc.) to `[nodeId, inputField]`—the **Video studio** UI dropdown and backend runner automatically pick it up with zero React changes!
3. **Reload & Test:** Refresh `http://localhost:8081` (`Ctrl + Shift + R`), open the three-line burger menu (`≡`) -> **Video studio**, select your new template, and render.

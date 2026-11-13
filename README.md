# OpenMuse Media Studio

OpenMuse media production suite featuring a native ComfyUI Video Studio drawer, pluggable workflow templates, long-form video chaining, a 1-click live cloud/local `llama.cpp` model & VRAM switcher, and Dark Mode.

---

## Key Features

* **Native ComfyUI Video Studio:** Includes a parameter drawer, pluggable workflow templates, and long-form video chaining up to 180 seconds.
* **1-Click Live Cloud / Local Model & VRAM Switcher:** Seamlessly toggle between Google Gemini Cloud API and local `llama-server` instances (`Qwen Q4` and `Qwen Q5`) to manage GPU VRAM.
* **Workspace & Dark Mode Polish:** Features persistent dark/light themes, notification controls, and session/identity management.

---

## Quick Start

1. Install dependencies and generate keys:
   ```bash
   pnpm install
   ./generateOpenmuseKeys
   ```
2. Configure your `.env` file based on `.env.example`.
3. Launch OpenMuse and ComfyUI:
   ```bash
   ./start-studio
   ```
4. Stop all services and free GPU VRAM:
   ```bash
   ./stop-studio
   ```

---

## Documentation
* See `CHANGELOG.md` for release history.
* See `REQUIREMENTS.md` for system requirements.
* See `UPSTREAM_README.md` for upstream architecture.

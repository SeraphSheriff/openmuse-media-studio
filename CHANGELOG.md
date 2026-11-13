# Changelog

## [Media Studio 1.0.0] - 2026-11-13
### Added
- **ComfyUI Video Studio UI (`≡ -> Video studio`):** Schema-driven modal exposing 29 live node-level parameters saved to `video-defaults.json`.
- **Pluggable Workflow Templates:** Added `WORKFLOW_TEMPLATES` registry in `apps/server/src/video-settings.ts` with default LTX-2.3 22B Text-to-Video and Image-to-Video templates.
- **Long-Form Video Chaining:** Added automatic GPU-safe chunk splitting and `ffmpeg` tail-frame continuity stitching up to 180 seconds.
- **Native Dark & Light Theme:** Added persistent `Dark mode` toggle in the sidebar menu.
- **Portable Launcher Scripts:** Added `.env`-driven `start-studio`, `stop-studio`, `startdocker`, and `generateOpenmuseKeys` helpers.

---

## 0.1.0-alpha — 2026-09-15

Initial public OpenMuse alpha.

- Native/web interface using CopilotKit React Native and AG-UI.
- Persistent browser computer, inline PDFs, structured artifacts, and optional Rich Threads integration.
- Durable delegated tasks, reviews/receipts, Ideas, Goals, Tracking, and editable memory.
- Google adapters, supported PDF workflows, and CSV spending summaries.
- Disabled, contract-tested OpenBot adapter for future backend integration.
- Native walkthrough recording, contributor docs, and CI for tests, builds, and real Chromium.
- Fixed Ideas suggesting sent replies or already completed matching work; restored task delegation in the persistent menu.

See [verification](docs/VERIFICATION.md) for actual coverage and [roadmap](ROADMAP.md) for incomplete integrations.

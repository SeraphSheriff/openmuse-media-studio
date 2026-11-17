import { execFile } from "node:child_process";
import { existsSync } from "node:fs";
import { access, copyFile, mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { homedir } from "node:os";
import { basename, extname, join, resolve } from "node:path";
import { promisify } from "node:util";
import { readVideoSettings, type VideoSettings, WORKFLOW_TEMPLATES } from "./video-settings.js";

const execFileAsync = promisify(execFile);
const GEN_DIR = resolve(process.cwd(), "generated");
const SRC_DIR = resolve(process.cwd(), "apps/server/src");
const COMFY_INPUT_DIR = join(homedir(), "ComfyUI", "input");
const COMFY_OUTPUT_DIR = join(homedir(), "ComfyUI", "output");

export interface VideoProgressState {
  id: string;
  active: boolean;
  status: "idle" | "running" | "done" | "error";
  stage: string;
  node: string;
  step: number;
  maxSteps: number;
  percent: number;
  segment: number;
  totalSegments: number;
  startedAt: number;
  logs: Array<{ atSec: number; text: string; isError?: boolean }>;
  errorDetail?: string;
}
let prog: VideoProgressState = {
  id: "",
  active: false,
  status: "idle",
  stage: "",
  node: "",
  step: 0,
  maxSteps: 0,
  percent: 0,
  segment: 0,
  totalSegments: 0,
  startedAt: 0,
  logs: [],
};
export const getVideoProgress = () => ({ ...prog, logs: [...prog.logs] });
export const clearVideoProgress = () => {
  prog = { ...prog, status: "idle", active: false, logs: [], errorDetail: undefined };
};
const addLog = (text: string, isError = false) => {
  const atSec = prog.startedAt ? Math.max(0, Math.round((Date.now() - prog.startedAt) / 1000)) : 0;
  if (prog.logs.at(-1)?.text !== text || isError)
    prog = { ...prog, logs: [...prog.logs.slice(-39), { atSec, text, isError }] };
};
const setProg = (p: Partial<VideoProgressState>) => {
  prog = { ...prog, ...p };
  if (p.stage) addLog(p.stage, p.status === "error");
};
function comfyUrl(path: string): string {
  return ["http://", "127.0.0.1", ":", "8188", path].join("");
}

function buildPrompt(raw: string, cfg: VideoSettings): string {
  const p = raw.trim();
  if (!cfg.autoEnhancePrompt) return p;
  const hasCam =
    /\b(tripod|pan|panning|zoom|tracking|dolly|drone|handheld|orbit|crane|gimbal)\b/i.test(p);
  const pre =
    !hasCam && String(cfg.cameraPrefix).trim() ? `${String(cfg.cameraPrefix).trim()}, ` : "";
  const sufStr = String(cfg.styleSuffix).trim();
  const suf = sufStr && !p.includes(sufStr.slice(0, 16)) ? `, ${sufStr}` : "";
  return `${pre}${p}${suf}`;
}

function resolveDims(aspectRatio: string, cfg: VideoSettings) {
  if (cfg.resolutionMode === "custom") {
    return {
      width: Math.round(Number(cfg.customWidth) / 32) * 32,
      height: Math.round(Number(cfg.customHeight) / 32) * 32,
    };
  }
  const hd = cfg.resolutionMode === "hd_1280x720";
  if (aspectRatio === "9:16")
    return hd ? { width: 720, height: 1280 } : { width: 544, height: 960 };
  if (aspectRatio === "1:1") return hd ? { width: 960, height: 960 } : { width: 768, height: 768 };
  return hd ? { width: 1280, height: 720 } : { width: 960, height: 544 };
}

async function runWorkflow(
  workflow: Record<string, { inputs: Record<string, unknown> }>,
): Promise<string> {
  const clientId = `om_${Date.now()}_${Math.floor(Math.random() * 1e5)}`;
  let ws: WebSocket | null = null;
  try {
    ws = new WebSocket(`ws://127.0.0.1:8188/ws?clientId=${clientId}`);
    ws.onmessage = (ev) => {
      try {
        const m = JSON.parse(String(ev.data)) as {
          type?: string;
          data?: { value?: number; max?: number; node?: string };
        };
        if (m.type === "execution_error") {
          const d = m.data as { node_id?: string; node_type?: string; exception_message?: string };
          const msg = `Node ${d.node_id ?? "?"} (${d.node_type ?? "?"}): ${(d.exception_message ?? "Error").trim()}`;
          setProg({ status: "error", stage: msg, errorDetail: msg });
        } else if (m.type === "executing" && m.data?.node) {
          const nd = workflow[m.data.node] as
            | { _meta?: { title?: string }; class_type?: string }
            | undefined;
          const t = nd?._meta?.title ?? nd?.class_type ?? `Node ${m.data.node}`;
          setProg({ node: t, stage: `Running ${t}` });
        } else if (
          m.type === "progress_state" &&
          (m.data as { nodes?: Record<string, { state?: string; value?: number; max?: number }> })
            ?.nodes
        ) {
          const entries = Object.entries(
            (m.data as { nodes: Record<string, { state?: string; value?: number; max?: number }> })
              .nodes,
          );
          const active = entries.find(([, st]) => st.state === "running");
          if (active) {
            const [nid, st] = active;
            const meta = workflow[nid] as
              | { _meta?: { title?: string }; class_type?: string }
              | undefined;
            const title = meta?._meta?.title ?? meta?.class_type ?? `Node ${nid}`;
            const pct = st.max
              ? Math.min(99, Math.round(((st.value ?? 0) / st.max) * 100))
              : prog.percent;
            const stepTxt = st.max ? ` · Step ${st.value ?? 0}/${st.max} (${pct}%)` : "";
            setProg({ node: title, percent: pct, stage: `${title}${stepTxt}` });
          }
        } else if (m.type === "progress" && m.data?.value && m.data?.max) {
          const pct = Math.min(99, Math.round((m.data.value / m.data.max) * 100));
          setProg({
            step: m.data.value,
            maxSteps: m.data.max,
            percent: pct,
            stage: `Step ${m.data.value}/${m.data.max} (${pct}%)`,
          });
        }
      } catch {}
    };
  } catch {}
  try {
    const qRes = await fetch(comfyUrl("/prompt"), {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ prompt: workflow, client_id: clientId }),
    });
    if (!qRes.ok) throw new Error(`ComfyUI queue error (${qRes.status}): ${await qRes.text()}`);
    const { prompt_id } = (await qRes.json()) as { prompt_id: string };

    for (let i = 0; i < 360; i++) {
      await new Promise((r) => setTimeout(r, 5000));
      const hRes = await fetch(comfyUrl(`/history/${prompt_id}`));
      if (!hRes.ok) continue;
      const hist = (await hRes.json()) as Record<
        string,
        {
          status?: { completed?: boolean; status_str?: string };
          outputs?: Record<
            string,
            {
              videos?: Array<{ filename: string; subfolder?: string }>;
              gifs?: Array<{ filename: string; subfolder?: string }>;
              images?: Array<{ filename: string; subfolder?: string }>;
            }
          >;
        }
      >;
      const item = hist[prompt_id];
      if (!item) continue;
      if (item.status?.status_str === "error") throw new Error("ComfyUI video execution failed");
      if (item.status?.completed || item.outputs?.["75"]) {
        const o75 = item.outputs?.["75"];
        const vid = o75?.videos?.at(0) ?? o75?.gifs?.at(0) ?? o75?.images?.at(0);
        if (!vid?.filename) throw new Error("No video file in ComfyUI output");
        return join(COMFY_OUTPUT_DIR, vid.subfolder ?? "", vid.filename);
      }
    }
    throw new Error("ComfyUI video generation timed out");
  } finally {
    try {
      ws?.close();
    } catch {}
  }
}

async function renderSegment(
  imagePath: string | null,
  prompt: string,
  ar: string,
  fm: boolean,
  clipSec: number,
  cfg: VideoSettings,
  idx: number,
): Promise<string> {
  const tplId = String(imagePath ? cfg.i2vTemplate : cfg.t2vTemplate);
  const tpl =
    WORKFLOW_TEMPLATES[tplId] ??
    (imagePath ? WORKFLOW_TEMPLATES.ltx23_i2v : WORKFLOW_TEMPLATES.ltx23_t2v);
  const w = JSON.parse(await readFile(join(SRC_DIR, tpl.file), "utf8")) as Record<
    string,
    { inputs: Record<string, unknown> }
  >;
  const { width, height } = resolveDims(ar, cfg);
  const seed =
    cfg.seedMode === "fixed" ? Number(cfg.fixedSeed) + idx * 10 : Math.floor(Math.random() * 1e12);
  let inputName = "";
  if (imagePath) {
    await mkdir(COMFY_INPUT_DIR, { recursive: true });
    inputName = `openmuse_${Date.now()}_${Math.floor(Math.random() * 1e5)}${extname(imagePath) || ".png"}`;
    let srcPath = resolve(imagePath);
    for (const candidate of [
      resolve(imagePath),
      join(GEN_DIR, imagePath),
      join(COMFY_INPUT_DIR, imagePath),
      join(COMFY_OUTPUT_DIR, imagePath),
    ]) {
      try {
        await access(candidate);
        srcPath = candidate;
        break;
      } catch {}
    }
    await copyFile(srcPath, join(COMFY_INPUT_DIR, inputName));
  }
  const exactLock = Boolean(inputName) && /\b(exact|same|preserve|keep|identical)\b/i.test(prompt);
  const vals: Record<string, unknown> = {
    ...cfg,
    ...(exactLock
      ? {
          i2vBaseStrength: Math.max(Number(cfg.i2vBaseStrength) || 0.92, 0.97),
          i2vUpscaleStrength: Math.max(Number(cfg.i2vUpscaleStrength) || 0.75, 0.88),
          i2vImgCompression: 0,
        }
      : {}),
    image: inputName,
    prompt,
    width,
    height,
    duration: clipSec,
    frameLength: Math.max(9, Math.round((clipSec * Number(cfg.fps || 24)) / 8) * 8 + 1),
    decodeFps: Number(cfg.fps || 24),
    llmSwitch: !fm,
    baseSeed: seed,
    upscaleSeed: seed + 1,
    llmSeed: seed,
    outPrefix: `openmuse/${tpl.mode}_${Date.now()}`,
  };
  for (const [k, [nodeId, field]] of Object.entries(tpl.nodes)) {
    if (w[nodeId] && vals[k] !== undefined && vals[k] !== "") w[nodeId].inputs[field] = vals[k];
  }
  return runWorkflow(w);
}

export async function renderLocalVideo(
  initialImagePath: string | null,
  prompt: string,
  aspectRatio?: string,
  durationSeconds?: number,
  fastMode?: boolean,
): Promise<string> {
  const cfg = await readVideoSettings();
  const ar = aspectRatio || String(cfg.aspectRatio);
  const dur = durationSeconds ?? Number(cfg.defaultDurationSeconds);
  const fm = fastMode ?? Boolean(cfg.fastMode);
  const styledPrompt = buildPrompt(prompt, cfg);
  const chunkMax = Math.max(4, Math.min(10, Number(cfg.maxChunkSeconds)));
  const numChunks = Math.max(1, Math.ceil(dur / chunkMax));
  const segments: string[] = [];
  let nextImage =
    initialImagePath &&
    !existsSync(initialImagePath) &&
    existsSync(join(process.cwd(), "generated", basename(initialImagePath)))
      ? join(process.cwd(), "generated", basename(initialImagePath))
      : initialImagePath;

  setProg({
    active: true,
    stage: initialImagePath ? "Preparing image..." : "Queuing ComfyUI...",
    node: "",
    step: 0,
    maxSteps: 0,
    percent: 2,
    segment: 1,
    totalSegments: numChunks,
    startedAt: Date.now(),
  });
  try {
    for (let idx = 0; idx < numChunks; idx++) {
      const clipSec = Math.min(chunkMax, Math.max(4, dur - idx * chunkMax));
      setProg({
        segment: idx + 1,
        totalSegments: numChunks,
        step: 0,
        maxSteps: 0,
        stage: `Segment ${idx + 1}/${numChunks} (${clipSec}s)...`,
      });
      const seg = await renderSegment(nextImage, styledPrompt, ar, fm, clipSec, cfg, idx);
      segments.push(seg);
      if (idx < numChunks - 1) {
        await mkdir(GEN_DIR, { recursive: true });
        const frame = join(GEN_DIR, `tail-${Date.now()}-${idx}.png`);
        await execFileAsync("ffmpeg", [
          "-y",
          "-sseof",
          `-${Number(cfg.chainOverlapOffset).toFixed(2)}`,
          "-i",
          seg,
          "-frames:v",
          "1",
          frame,
        ]);
        nextImage = frame;
      }
    }

    setProg({ stage: "Encoding MP4...", percent: 98 });
    await mkdir(GEN_DIR, { recursive: true });
    const finalPath = join(GEN_DIR, `${initialImagePath ? "animated" : "video"}-${Date.now()}.mp4`);
    if (segments.length === 1) {
      await execFileAsync("ffmpeg", [
        "-y",
        "-i",
        segments[0],
        "-t",
        String(dur),
        "-c",
        "copy",
        finalPath,
      ]);
      return finalPath;
    }
    const listPath = join(GEN_DIR, `concat-${Date.now()}.txt`);
    await writeFile(
      listPath,
      segments.map((p) => `file '${p.replace(/'/g, "'\\''")}'`).join("\n"),
      "utf8",
    );
    try {
      await execFileAsync("ffmpeg", [
        "-y",
        "-f",
        "concat",
        "-safe",
        "0",
        "-i",
        listPath,
        "-t",
        String(dur),
        "-c:v",
        String(cfg.outputCodec),
        "-crf",
        String(cfg.outputCrf),
        "-pix_fmt",
        "yuv420p",
        "-c:a",
        "aac",
        "-movflags",
        "+faststart",
        finalPath,
      ]);
    } finally {
      await rm(listPath, { force: true });
    }
    setProg({
      active: false,
      status: "done",
      stage: `Completed: ${finalPath.split("/").pop()}`,
      percent: 100,
    });
    return finalPath;
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    setProg({
      active: false,
      status: "error",
      stage: prog.errorDetail || msg,
      errorDetail: prog.errorDetail || msg,
    });
    throw e;
  }
}

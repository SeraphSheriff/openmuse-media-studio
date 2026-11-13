import { spawn } from "node:child_process";
import { openSync } from "node:fs";
import { readFile, writeFile } from "node:fs/promises";
import { homedir } from "node:os";
import { resolve } from "node:path";

export type ModelMode = "cloud" | "q4" | "q5";

export interface ModelSettings {
  mode: ModelMode;
  q4Model: string;
  q4ModelPath: string;
  q4BaseUrl: string;
  q5Model: string;
  q5ModelPath: string;
  q5BaseUrl: string;
}

const SETTINGS_PATH = resolve(process.cwd(), "model-settings.json");

export const DEFAULT_MODEL_SETTINGS: ModelSettings = {
  mode: "cloud",
  q4Model: process.env.LOCAL_QWEN_Q4_MODEL?.trim() || "openai/qwen2.5-coder-7b-instruct-q4_k_m",
  q4ModelPath:
    process.env.LOCAL_QWEN_Q4_PATH?.trim() ||
    resolve(homedir(), "models/qwen2.5-coder-7b-instruct-q4_k_m.gguf"),
  q4BaseUrl: process.env.LOCAL_QWEN_Q4_URL?.trim() || "http://127.0.0.1:8080/v1",
  q5Model: process.env.LOCAL_QWEN_Q5_MODEL?.trim() || "openai/qwen2.5-coder-14b-instruct-q5_k_m",
  q5ModelPath:
    process.env.LOCAL_QWEN_Q5_PATH?.trim() ||
    resolve(homedir(), "models/qwen2.5-coder-14b-instruct-q5_k_m.gguf"),
  q5BaseUrl: process.env.LOCAL_QWEN_Q5_URL?.trim() || "http://127.0.0.1:8080/v1",
};

function parseMode(val: unknown): ModelMode {
  return val === "q4" || val === "q5" ? val : "cloud";
}

function strOr(val: unknown, fallback: string): string {
  return typeof val === "string" && val.trim() ? val.trim() : fallback;
}

export async function readModelSettings(): Promise<ModelSettings> {
  try {
    const raw = JSON.parse(await readFile(SETTINGS_PATH, "utf8")) as Partial<ModelSettings>;
    return {
      mode: parseMode(raw.mode),
      q4Model: strOr(raw.q4Model, DEFAULT_MODEL_SETTINGS.q4Model),
      q4ModelPath: strOr(raw.q4ModelPath, DEFAULT_MODEL_SETTINGS.q4ModelPath),
      q4BaseUrl: strOr(raw.q4BaseUrl, DEFAULT_MODEL_SETTINGS.q4BaseUrl),
      q5Model: strOr(raw.q5Model, DEFAULT_MODEL_SETTINGS.q5Model),
      q5ModelPath: strOr(raw.q5ModelPath, DEFAULT_MODEL_SETTINGS.q5ModelPath),
      q5BaseUrl: strOr(raw.q5BaseUrl, DEFAULT_MODEL_SETTINGS.q5BaseUrl),
    };
  } catch {
    return { ...DEFAULT_MODEL_SETTINGS };
  }
}

async function stopLlamaServer(): Promise<void> {
  try {
    const { execFile } = await import("node:child_process");
    const { promisify } = await import("node:util");
    await promisify(execFile)("pkill", ["-f", "llama-server"]);
    await new Promise((r) => setTimeout(r, 600));
  } catch {
    // Ignore if llama-server was not running
  }
}

async function ensureLlamaServer(modelPath: string, baseUrl: string): Promise<void> {
  const url = new URL(baseUrl);
  const port = url.port || "8080";
  const host = url.hostname || "127.0.0.1";
  const healthUrl = `http://${host}:${port}/health`;

  await stopLlamaServer();

  const logFd = openSync("/tmp/openmuse-llama.log", "a");
  const child = spawn(
    "llama-server",
    ["-m", modelPath, "--host", host, "--port", port, "-ngl", "99", "-c", "16384", "--jinja"],
    { detached: true, stdio: ["ignore", logFd, logFd] },
  );
  child.unref();

  const deadline = Date.now() + 45_000;
  while (Date.now() < deadline) {
    try {
      const res = await fetch(healthUrl);
      if (res.ok) return;
    } catch {
      // Server still loading GGUF into VRAM
    }
    await new Promise((r) => setTimeout(r, 500));
  }
  throw new Error(
    `Timed out waiting for llama-server on ${healthUrl}. Check /tmp/openmuse-llama.log`,
  );
}

export async function writeModelSettings(patch: Partial<ModelSettings>): Promise<ModelSettings> {
  const current = await readModelSettings();
  const next: ModelSettings = {
    mode: patch.mode ? parseMode(patch.mode) : current.mode,
    q4Model: strOr(patch.q4Model, current.q4Model),
    q4ModelPath: strOr(patch.q4ModelPath, current.q4ModelPath),
    q4BaseUrl: strOr(patch.q4BaseUrl, current.q4BaseUrl),
    q5Model: strOr(patch.q5Model, current.q5Model),
    q5ModelPath: strOr(patch.q5ModelPath, current.q5ModelPath),
    q5BaseUrl: strOr(patch.q5BaseUrl, current.q5BaseUrl),
  };

  if (next.mode === "cloud") {
    await stopLlamaServer();
  } else if (next.mode === "q4") {
    await ensureLlamaServer(next.q4ModelPath, next.q4BaseUrl);
  } else if (next.mode === "q5") {
    await ensureLlamaServer(next.q5ModelPath, next.q5BaseUrl);
  }

  await writeFile(SETTINGS_PATH, JSON.stringify(next, null, 2), "utf8");
  return next;
}

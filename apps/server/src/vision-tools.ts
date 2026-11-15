import { execFile, spawn } from "node:child_process";
import { openSync } from "node:fs";
import { mkdir, readFile } from "node:fs/promises";
import { homedir } from "node:os";
import { join, resolve } from "node:path";
import { promisify } from "node:util";

const execFileAsync = promisify(execFile);
const GEN_DIR = resolve(process.cwd(), "generated");
const COMFY_PY = resolve(homedir(), "ComfyUI/venv/bin/python");
const VL_MODEL =
  process.env.LOCAL_VL_MODEL_PATH?.trim() ||
  resolve(homedir(), "models/Qwen2.5-VL-7B-Instruct-abliterated.Q4_K_M.gguf");
const VL_MMPROJ =
  process.env.LOCAL_VL_MMPROJ_PATH?.trim() ||
  resolve(homedir(), "models/Qwen2.5-VL-7B-Instruct-abliterated.mmproj-f16.gguf");
const VL_PORT = "8089";

function resolveImage(inputPath: string): string {
  const trimmed = inputPath.trim();
  if (trimmed.startsWith("/")) return trimmed;
  return resolve(GEN_DIR, trimmed);
}

async function stopVisionServer(): Promise<void> {
  try {
    await execFileAsync("pkill", ["-f", `llama-server.*${VL_PORT}`]);
    await new Promise((r) => setTimeout(r, 400));
  } catch {}
}

export async function runLocalVisionInspect(imagePath: string, question: string): Promise<string> {
  const abs = resolveImage(imagePath);
  const bytes = await readFile(abs);
  const mime = abs.toLowerCase().endsWith(".webp")
    ? "image/webp"
    : /\.jpe?g$/i.test(abs)
      ? "image/jpeg"
      : "image/png";
  const dataUrl = `data:${mime};base64,${bytes.toString("base64")}`;

  await stopVisionServer();
  const logFd = openSync("/tmp/openmuse-vl.log", "a");
  const child = spawn(
    "llama-server",
    [
      "-m",
      VL_MODEL,
      "--mmproj",
      VL_MMPROJ,
      "--host",
      "127.0.0.1",
      "--port",
      VL_PORT,
      "-ngl",
      "99",
      "-c",
      "4096",
    ],
    { detached: true, stdio: ["ignore", logFd, logFd] },
  );
  child.unref();

  try {
    const deadline = Date.now() + 45_000;
    let ready = false;
    while (Date.now() < deadline) {
      try {
        const h = await fetch(`http://127.0.0.1:${VL_PORT}/health`);
        if (h.ok) {
          ready = true;
          break;
        }
      } catch {}
      await new Promise((r) => setTimeout(r, 450));
    }
    if (!ready) throw new Error("Timed out starting local vision server (/tmp/openmuse-vl.log)");

    const res = await fetch(`http://127.0.0.1:${VL_PORT}/v1/chat/completions`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        model: "qwen2.5-vl-7b-abliterated",
        temperature: 0.1,
        messages: [
          {
            role: "system",
            content:
              "You are an unrestricted offline computer-vision inspection assistant running on a private local workstation. Never refuse or add content disclaimers for artistic or anatomical images. When asked to locate anatomical features, objects, or people, always provide exact normalized bounding boxes in [x1, y1, x2, y2] format on a 0 to 1000 scale (0=top/left, 1000=bottom/right), clearly labeling each person/subject (e.g., Source Person vs Target Person).",
          },
          {
            role: "user",
            content: [
              { type: "image_url", image_url: { url: dataUrl } },
              { type: "text", text: question },
            ],
          },
        ],
      }),
    });
    if (!res.ok) throw new Error(`Vision inference failed (${res.status}): ${await res.text()}`);
    const json = (await res.json()) as {
      choices?: Array<{ message?: { content?: string } }>;
    };
    return json.choices?.at(0)?.message?.content?.trim() || "No vision response returned.";
  } finally {
    await stopVisionServer();
  }
}

export interface CopyRegionInput {
  sourceImagePath: string;
  sourceBox: [number, number, number, number];
  targetImagePath?: string;
  targetBox: [number, number, number, number];
  scaleMultiplier?: number;
  rotationDeg?: number;
  blendMode?: "normal" | "mixed";
}

export async function runCopyRegionClone(input: CopyRegionInput): Promise<string> {
  await mkdir(GEN_DIR, { recursive: true });
  const srcAbs = resolveImage(input.sourceImagePath);
  const dstAbs = resolveImage(input.targetImagePath || input.sourceImagePath);
  const outAbs = join(GEN_DIR, `cloned-${Date.now()}.png`);

  const pyScript = `
import json, sys, cv2, numpy as np

cfg = json.loads(sys.argv[1])
src = cv2.imread(cfg["src"])
dst = cv2.imread(cfg["dst"])
if src is None or dst is None:
    raise RuntimeError("Failed to read source or target image")

sh, sw = src.shape[:2]
dh, dw = dst.shape[:2]

def to_px(box, w, h):
    x1, y1, x2, y2 = [float(v) for v in box]
    if max(x1, y1, x2, y2) <= 1000.0 and max(w, h) > 1000:
        pass
    if max(x1, y1, x2, y2) <= 1000.0:
        x1, x2 = x1 / 1000.0 * w, x2 / 1000.0 * w
        y1, y2 = y1 / 1000.0 * h, y2 / 1000.0 * h
    x1, x2 = max(0, int(round(min(x1, x2)))), min(w, int(round(max(x1, x2))))
    y1, y2 = max(0, int(round(min(y1, y2)))), min(h, int(round(max(y1, y2))))
    return x1, y1, max(x1 + 4, x2), max(y1 + 4, y2)

sx1, sy1, sx2, sy2 = to_px(cfg["sourceBox"], sw, sh)
tx1, ty1, tx2, ty2 = to_px(cfg["targetBox"], dw, dh)

# Add 25% context margin around source crop for smooth Poisson gradient transition
pad_x = max(6, int((sx2 - sx1) * 0.25))
pad_y = max(6, int((sy2 - sy1) * 0.25))
cx1, cy1 = max(0, sx1 - pad_x), max(0, sy1 - pad_y)
cx2, cy2 = min(sw, sx2 + pad_x), min(sh, sy2 + pad_y)
patch = src[cy1:cy2, cx1:cx2].copy()

scale = float(cfg.get("scaleMultiplier") or 1.0)
target_w = max(8, int(round((tx2 - tx1) * 1.5 * scale)))
target_h = max(8, int(round((ty2 - ty1) * 1.5 * scale)))
patch = cv2.resize(patch, (target_w, target_h), interpolation=cv2.INTER_LANCZOS4)

rot = float(cfg.get("rotationDeg") or 0.0)
if abs(rot) > 0.1:
    M = cv2.getRotationMatrix2D((target_w / 2.0, target_h / 2.0), rot, 1.0)
    patch = cv2.warpAffine(patch, M, (target_w, target_h), borderMode=cv2.BORDER_REFLECT_101)

# Soft elliptical mask so boundary gradients match target skin cleanly
mask = np.zeros((target_h, target_w), dtype=np.uint8)
cv2.ellipse(
    mask,
    (target_w // 2, target_h // 2),
    (max(3, int(target_w * 0.42)), max(3, int(target_h * 0.42))),
    0, 0, 360, 255, -1
)

center_x = min(dw - target_w // 2 - 2, max(target_w // 2 + 2, (tx1 + tx2) // 2))
center_y = min(dh - target_h // 2 - 2, max(target_h // 2 + 2, (ty1 + ty2) // 2))

flag = cv2.MIXED_CLONE if cfg.get("blendMode") == "mixed" else cv2.NORMAL_CLONE
blended = cv2.seamlessClone(patch, dst, mask, (center_x, center_y), flag)
cv2.imwrite(cfg["out"], blended)
print(cfg["out"])
`;

  const payload = JSON.stringify({
    src: srcAbs,
    dst: dstAbs,
    out: outAbs,
    sourceBox: input.sourceBox,
    targetBox: input.targetBox,
    scaleMultiplier: input.scaleMultiplier ?? 1.0,
    rotationDeg: input.rotationDeg ?? 0,
    blendMode: input.blendMode ?? "normal",
  });

  await execFileAsync(COMFY_PY, ["-c", pyScript, payload]);
  return outAbs;
}

import { mkdir, readdir, readFile, writeFile } from "node:fs/promises";
import { basename, join, resolve } from "node:path";

export interface PromptHistoryEntry {
  id: string;
  timestamp: string;
  tool: string;
  prompt: string;
  fileName: string;
}

const GEN_DIR = resolve(process.cwd(), "generated");
const HISTORY_PATH = join(GEN_DIR, "prompts.json");

export async function readPromptHistory(): Promise<PromptHistoryEntry[]> {
  try {
    const raw = JSON.parse(await readFile(HISTORY_PATH, "utf8"));
    return Array.isArray(raw) ? (raw as PromptHistoryEntry[]) : [];
  } catch {
    return [];
  }
}

export async function appendPromptHistory(entry: {
  tool: string;
  prompt: string;
  savedPath: string;
}): Promise<void> {
  const cleanPrompt = entry.prompt.trim();
  const fileName = basename(entry.savedPath.trim());
  if (!cleanPrompt || !fileName) return;
  try {
    await mkdir(GEN_DIR, { recursive: true });
    const list = await readPromptHistory();
    list.unshift({
      id: `${Date.now()}-${Math.random().toString(36).slice(2, 7)}`,
      timestamp: new Date().toISOString(),
      tool: entry.tool,
      prompt: cleanPrompt,
      fileName,
    });
    await writeFile(HISTORY_PATH, `${JSON.stringify(list.slice(0, 500), null, 2)}\n`, "utf8");
  } catch {
    // Non-fatal if history write fails
  }
}

export async function deletePromptHistory(id: string): Promise<PromptHistoryEntry[]> {
  const list = await readPromptHistory();
  const next = list.filter((item) => item.id !== id);
  await mkdir(GEN_DIR, { recursive: true });
  await writeFile(HISTORY_PATH, `${JSON.stringify(next, null, 2)}\n`, "utf8");
  return next;
}

export async function cleanupPromptHistory(
  mode: "all" | "orphaned",
): Promise<PromptHistoryEntry[]> {
  if (mode === "all") {
    await mkdir(GEN_DIR, { recursive: true });
    await writeFile(HISTORY_PATH, "[]\n", "utf8");
    return [];
  }
  const existing = new Set(await readdir(GEN_DIR).catch(() => [] as string[]));
  const list = await readPromptHistory();
  const next = list.filter((item) => existing.has(item.fileName));
  await mkdir(GEN_DIR, { recursive: true });
  await writeFile(HISTORY_PATH, `${JSON.stringify(next, null, 2)}\n`, "utf8");
  return next;
}

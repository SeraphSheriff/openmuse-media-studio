import type { Dirent } from "node:fs";
import { readdir, readFile, stat } from "node:fs/promises";
import { homedir } from "node:os";
import { join, resolve } from "node:path";
import { defineTool } from "@copilotkit/runtime/v2";
import { z } from "zod";

const SKIP_DIRS = new Set([
  "node_modules",
  ".git",
  "venv",
  ".venv",
  "__pycache__",
  ".cache",
  ".next",
  "dist",
  "build",
  "$Recycle.Bin",
  "System Volume Information",
  "Windows",
  "Program Files",
  "Program Files (x86)",
  "ProgramData",
]);

function expandHome(inputPath: string): string {
  if (inputPath === "~") return homedir();
  if (inputPath.startsWith("~/")) return join(homedir(), inputPath.slice(2));
  return inputPath;
}

export const hostFileTools = [
  defineTool({
    name: "search_host_files",
    description:
      "Search files on the user's local Predator PC (Linux /home/cowboy or Windows /mnt/c/Users, /mnt/d, etc.) by filename substring or optional text content query.",
    parameters: z.object({
      query: z.string().min(1).max(200).describe("Case-insensitive filename substring to match"),
      rootDir: z
        .string()
        .optional()
        .describe(
          "Directory to search (defaults to /home/cowboy; use /mnt/c/Users for Windows files)",
        ),
      containsText: z
        .string()
        .optional()
        .describe("Optional case-insensitive text substring to match inside small text files"),
      maxResults: z.number().int().min(1).max(50).optional(),
    }),
    execute: async ({ query, rootDir, containsText, maxResults = 25 }) => {
      const base = resolve(expandHome(rootDir?.trim() || homedir()));
      const needle = query.toLowerCase();
      const textNeedle = containsText?.toLowerCase();
      const matches: Array<{ path: string; sizeBytes: number; modifiedAt: string }> = [];
      let scanned = 0;
      const MAX_SCAN = 15_000;

      async function walk(dir: string, depth: number) {
        if (depth > 7 || matches.length >= maxResults || scanned >= MAX_SCAN) return;
        let entries: Dirent[];
        try {
          entries = await readdir(dir, { withFileTypes: true });
        } catch {
          return;
        }
        for (const entry of entries) {
          if (matches.length >= maxResults || scanned >= MAX_SCAN) break;
          if (entry.name.startsWith(".") || SKIP_DIRS.has(entry.name)) continue;
          const full = join(dir, entry.name);
          scanned++;
          if (entry.isDirectory()) {
            await walk(full, depth + 1);
          } else if (entry.isFile() && entry.name.toLowerCase().includes(needle)) {
            try {
              const info = await stat(full);
              if (textNeedle) {
                if (info.size > 512_000) continue;
                const body = await readFile(full, "utf8");
                if (!body.toLowerCase().includes(textNeedle)) continue;
              }
              matches.push({
                path: full,
                sizeBytes: info.size,
                modifiedAt: info.mtime.toISOString(),
              });
            } catch {
              // Skip unreadable files
            }
          }
        }
      }

      if (!rootDir) await walk(join(homedir(), "openmuse", "generated"), 0);
      if (matches.length < maxResults) await walk(base, 0);
      return {
        searchedRoot: base,
        scannedEntries: scanned,
        truncated: scanned >= MAX_SCAN || matches.length >= maxResults,
        matches,
      };
    },
  }),
  defineTool({
    name: "read_host_file",
    description:
      "Read a text, code, markdown, JSON, or log file from the user's local Predator PC (/home/cowboy or /mnt/c/...).",
    parameters: z.object({
      filePath: z.string().min(1).max(500).describe("Full path to the local file to read"),
      maxChars: z.number().int().min(200).max(32000).optional(),
    }),
    execute: async ({ filePath, maxChars = 16000 }) => {
      const full = resolve(expandHome(filePath.trim()));
      const info = await stat(full);
      const raw = await readFile(full, "utf8");
      return {
        path: full,
        sizeBytes: info.size,
        truncated: raw.length > maxChars,
        content: raw.slice(0, maxChars),
      };
    },
  }),
];

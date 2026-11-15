import { getVideoProgress } from "./comfy-video.ts";
import { readModelSettings, writeModelSettings } from "./model-settings.ts";
import {
  DEFAULT_VIDEO_SETTINGS,
  readVideoSettings,
  STUDIO_SCHEMA,
  writeVideoSettings,
} from "./video-settings.ts";
import "./config.ts";
import { randomUUID } from "node:crypto";
import { MessageSchema } from "@ag-ui/core";
import { CopilotKitIntelligence } from "@copilotkit/runtime/v2";
import { Hono } from "hono";
import { bodyLimit } from "hono/body-limit";
import { cors } from "hono/cors";
import { z } from "zod";
import {
  calendarRangeSchema,
  emailDraftSchema,
  proposalSchema,
} from "../../../packages/domain/src/index.ts";
import { ActionService } from "./actions.ts";
import { agentConfigured, makeRuntime } from "./agent.ts";
import { createAuth } from "./auth.ts";
import { BrowserService } from "./browser.ts";
import { ComputerService, type DockerRunner, resolveComputerDeployment } from "./computer.ts";
import { computerRoutes } from "./computer-routes.ts";
import { assertApiDeploymentConfig, type Config } from "./config.ts";
import type { Store } from "./db.ts";
import { agentRoutes } from "./engine/routes.ts";
import { AgentService } from "./engine/service.ts";
import { AppError } from "./errors.ts";
import { Files } from "./files.ts";
import { GoogleAuth } from "./google-auth.ts";
import { rateLimit } from "./rate-limit.ts";
import { WorkspaceService } from "./workspace.ts";

export async function createApp(
  db: Store,
  config: Config,
  options: { docker?: DockerRunner } = {},
) {
  assertApiDeploymentConfig(config);
  await resolveComputerDeployment(config);
  const auth = await createAuth(db, config),
    files = new Files(db, config, auth),
    google = new GoogleAuth(db, config),
    workspace = new WorkspaceService(db, config, files, google);
  const actions = new ActionService(db, {
    execute: (owner, input, connectionId, targetVersion) =>
      workspace.execute(owner, input, connectionId, targetVersion),
    prepare: (owner, input, connectionId) => workspace.prepare(owner, input, connectionId),
    connected: (owner) => workspace.connected(owner),
    connection: (owner) => workspace.connection(owner),
  });
  const browser = new BrowserService(db, config, auth, files);
  const computer = new ComputerService(db, config, options.docker);
  const agent = new AgentService(db, config, workspace, files, actions, browser, computer);
  const intelligence =
    config.intelligenceApiKey && config.intelligenceApiKey !== "local-studio-mode"
      ? new CopilotKitIntelligence({ apiKey: config.intelligenceApiKey })
      : undefined;
  const runtime = makeRuntime(config, agent, auth, intelligence);
  const app = new Hono<{ Variables: { owner: string } }>();
  const origins = new Set([...config.allowedOrigins, new URL(config.publicUrl).origin]);
  app.use("*", async (c, next) => {
    const origin = c.req.header("origin");
    if (origin && !origins.has(origin)) return c.json({ error: "Origin is not allowed" }, 403);
    c.header("X-Content-Type-Options", "nosniff");
    c.header("Referrer-Policy", "no-referrer");
    c.header("Cache-Control", "no-store");
    await next();
  });
  app.use(
    "*",
    cors({
      origin: (origin) => (origins.has(origin) ? origin : undefined),
      allowHeaders: ["Content-Type", "Authorization"],
      allowMethods: ["GET", "POST", "PUT", "PATCH", "DELETE", "OPTIONS"],
      credentials: true,
    }),
  );
  app.use(
    "*",
    bodyLimit({
      maxSize: 12 * 1024 * 1024,
      onError: (c) => c.json({ error: "Request is too large; PDFs must be 10 MB or smaller" }, 413),
    }),
  );
  const apiRateLimit = rateLimit(Boolean(config.trustProxy));
  app.use("/api/*", async (c, next) => {
    const p = c.req.path;
    if (
      p === "/api/comfy-control" ||
      p === "/api/media-gallery" ||
      p === "/api/video-progress" ||
      p.startsWith("/media-file/")
    )
      return next();
    return apiRateLimit(c, next);
  });
  app.onError((error, c) => {
    if (error instanceof z.ZodError)
      return c.json({ error: error.issues.map((i) => i.message).join("; ") }, 422);
    if (error instanceof AppError) return c.json({ error: error.message }, error.status);
    if (error.name === "PdfError" || error.name === "RecurringEventError")
      return c.json({ error: error.message }, 422);
    if (error instanceof SyntaxError) return c.json({ error: "Invalid request data" }, 400);
    // Provider and document errors are useful, but raw stack traces and token-bearing responses are not.
    console.error(`[OpenMuse] ${error.name}`);
    return c.json(
      {
        error:
          error.name === "PdfError" || error.name === "GoogleApiError"
            ? error.message
            : "Request failed. Check the server setup and try again.",
      },
      502,
    );
  });
  app.get("/api/health", (c) =>
    c.json({
      ok: true,
      mode: config.mode,
      agentConfigured: agentConfigured(config),
      browserConfigured: Boolean(config.workerUrl && config.workerToken),
    }),
  );
  let loginWindow = 0,
    loginAttempts = 0;
  app.post("/api/session", async (c) => {
    if (Date.now() - loginWindow > 60000) {
      loginWindow = Date.now();
      loginAttempts = 0;
    }
    if (++loginAttempts > 30)
      throw new AppError("Too many sign-in attempts. Try again in a minute.", 429);
    const body = z.object({ accessKey: z.string().optional() }).parse(await c.req.json());
    const session = await auth.session(body.accessKey);
    await workspace.ensureSample(
      process.env.OPENMUSE_OWNER || process.env.OPENMUSE_OWNER || "local-user",
      actions,
    );
    await agent.ensure(process.env.OPENMUSE_OWNER || "local-user");
    if (config.mode === "sample")
      await agent.refreshIdeas(process.env.OPENMUSE_OWNER || "local-user");
    return c.json(session);
  });
  app.get("/api/google/callback", async (c) => {
    if (c.req.query("error"))
      return c.html("<h1>Google connection cancelled</h1><p>You can return to OpenMuse.</p>", 400);
    const state = c.req.query("state"),
      code = c.req.query("code");
    if (!state || !code) throw new AppError("Google callback is incomplete");
    await google.callback(state, code);
    return c.html(
      "<h1>Google is connected</h1><p>Return to OpenMuse and refresh your workspace.</p>",
    );
  });
  app.use("/api/*", async (c, next) => {
    // A signed URL grants only the requests its page makes: reads, and the console's input.
    const method = c.req.method === "HEAD" ? "GET" : c.req.method;
    const signedRoute =
      (method === "GET" &&
        /^\/api\/files\/[^/]+\/content$|^\/api\/browsers\/[^/]+\/(?:preview|console)$/.test(
          c.req.path,
        )) ||
      (method === "POST" && /^\/api\/browsers\/[^/]+\/console$/.test(c.req.path));
    const owner =
      signedRoute && c.req.query("signature")
        ? auth.verify(new URL(c.req.url))
        : await auth.owner(c.req.header("authorization"));
    c.set("owner", owner);
    await next();
  });
  app.delete("/api/session", async (c) => {
    await auth.revoke(c.req.header("authorization"));
    return c.json({ ok: true });
  });
  app.get("/api/workspace", async (c) => {
    const [snapshot, reachable] = await Promise.all([
      workspace.snapshot(c.get("owner"), c.req.query("q")),
      browser.reachable(),
    ]);
    snapshot.browsers = snapshot.browsers.map((s) => browser.decorate(c.get("owner"), s));
    // A configured worker that does not answer is offline, not ready.
    snapshot.connections = snapshot.connections.map((connection) =>
      connection.id === "browser" && connection.status === "connected" && !reachable
        ? { ...connection, status: "unavailable" }
        : connection,
    );
    return c.json(snapshot);
  });
  app.route("/api/agent", agentRoutes(agent));
  app.route("/api/computer", computerRoutes(computer, files));
  app.get("/api/calendars", async (c) => c.json(await workspace.calendars(c.get("owner"))));
  app.get("/api/calendar/events", async (c) => {
    const query = z
      .object({
        calendarId: z.string().min(1).max(1024).optional(),
        timeMin: z.iso.datetime({ offset: true }).optional(),
        timeMax: z.iso.datetime({ offset: true }).optional(),
      })
      .parse(c.req.query());
    if (query.timeMin && query.timeMax) calendarRangeSchema.parse(query);
    return c.json(await workspace.events(c.get("owner"), query));
  });
  app.get("/api/mail/threads/:id", async (c) =>
    c.json(await workspace.thread(c.get("owner"), c.req.param("id"))),
  );
  app.post("/api/actions", async (c) => {
    const input = proposalSchema.parse(await c.req.json());
    if (input.kind === "email.send")
      for (const id of input.data.attachmentIds) await files.get(c.get("owner"), id);
    return c.json(await actions.propose(c.get("owner"), input), 201);
  });
  app.post("/api/actions/:id/decide", async (c) => {
    const body = z
      .object({ hash: z.string(), decision: z.enum(["approve", "deny"]) })
      .parse(await c.req.json());
    return c.json(
      await actions.decide(c.get("owner"), c.req.param("id"), body.hash, body.decision),
    );
  });
  app.get("/api/drafts", async (c) => c.json(await db.list(c.get("owner"), "drafts")));
  app.post("/api/drafts", async (c) => {
    const body = emailDraftSchema
      .extend({ id: z.string().uuid().optional() })
      .parse(await c.req.json());
    const existing = body.id
      ? await db.get<{ createdAt: string }>(c.get("owner"), "drafts", body.id)
      : null;
    if (body.id && !existing) throw new AppError("Draft not found", 404);
    return c.json(
      await db.put(c.get("owner"), "drafts", {
        ...body,
        id: body.id ?? randomUUID(),
        createdAt: existing?.createdAt ?? new Date().toISOString(),
      }),
      201,
    );
  });
  app.post("/api/main-thread/reset", async (c) => {
    const owner = c.get("owner");
    const nextId = randomUUID();
    await db.put(owner, "conversation-settings", {
      id: "main",
      threadId: nextId,
      existing: false,
    });
    if (intelligence) {
      try {
        await intelligence.getOrCreateThread({
          threadId: nextId,
          userId: owner,
          agentId: "default",
        });
      } catch {
        // Thread will be initialized lazily on first run if intelligence service is offline
      }
    }
    return c.json({ threadId: nextId, existing: false });
  });
  app.get("/api/main-thread", async (c) => {
    const owner = c.get("owner");
    await db.insertIfAbsent(owner, "conversation-settings", {
      id: "main",
      threadId: randomUUID(),
      existing: false,
    });
    const main = await db.get<{ threadId: string }>(owner, "conversation-settings", "main");
    if (!main) throw new AppError("Main conversation could not be loaded", 503);
    if (intelligence) {
      try {
        await intelligence.getOrCreateThread({
          threadId: main.threadId,
          userId: owner,
          agentId: "default",
        });
      } catch {
        throw new AppError(
          "Main conversation is unavailable. Check the Rich Threads connection and try again.",
          502,
        );
      }
    }
    return c.json({ threadId: main.threadId, existing: true });
  });
  app.get("/api/conversation", async (c) =>
    c.json((await db.get(c.get("owner"), "conversations", "default")) ?? { messages: [] }),
  );
  app.put("/api/conversation", async (c) => {
    const body = await c.req.json();
    const messages = z.array(z.unknown()).max(1000).parse(body.messages);
    for (const message of messages) MessageSchema.parse(message);
    await db.put(c.get("owner"), "conversations", { id: "default", messages });
    return c.json({ ok: true });
  });
  app.post("/api/files", async (c) => {
    const data = await c.req.parseBody();
    const file = data.file;
    if (!(file instanceof File)) throw new AppError("Choose a PDF file");
    return c.json(
      await files.import(
        c.get("owner"),
        file.name,
        new Uint8Array(await file.arrayBuffer()),
        "Uploaded by you",
      ),
      201,
    );
  });
  app.get("/api/files/:id/content", async (c) => {
    const file = await files.get(c.get("owner"), c.req.param("id"));
    c.header("Content-Type", "application/pdf");
    c.header("Content-Disposition", `inline; filename*=UTF-8''${encodeURIComponent(file.name)}`);
    return c.body(await files.bytes(c.get("owner"), file.id));
  });
  app.post("/api/files/:id/fill", async (c) => {
    const body = z
      .object({ fields: z.record(z.string(), z.union([z.string(), z.boolean()])) })
      .parse(await c.req.json());
    return c.json(await files.fill(c.get("owner"), c.req.param("id"), body.fields), 201);
  });
  app.post("/api/mail/import-attachment", async (c) => {
    const body = z.object({ reference: z.string() }).parse(await c.req.json());
    return c.json(await workspace.importAttachment(c.get("owner"), body.reference), 201);
  });
  app.post("/api/google/connect", async (c) => {
    const body = z.object({ capability: z.enum(["read", "write"]) }).parse(await c.req.json());
    if (config.mode === "sample") {
      await db.put(c.get("owner"), "settings", {
        id: "google",
        enabled: true,
        connectionId: randomUUID(),
      });
      return c.json({ url: null, connected: true });
    }
    return c.json(await google.connect(c.get("owner"), body.capability === "write"));
  });
  app.post("/api/google/disconnect", async (c) => {
    if (config.mode === "sample")
      await db.put(c.get("owner"), "settings", { id: "google", enabled: false });
    else await google.disconnect(c.get("owner"));
    return c.json({ ok: true });
  });
  app.post("/api/browsers", async (c) => {
    const body = z.object({ url: z.url().max(4096) }).parse(await c.req.json());
    return c.json(await browser.create(c.get("owner"), body.url), 201);
  });
  app.get("/api/browsers/:id", async (c) => {
    const owner = c.get("owner");
    return c.json(browser.decorate(owner, await browser.get(owner, c.req.param("id"))));
  });
  app.post("/api/browsers/:id/navigate", async (c) => {
    const body = z.object({ url: z.url().max(4096) }).parse(await c.req.json());
    return c.json(await browser.navigate(c.get("owner"), c.req.param("id"), body.url));
  });
  app.post("/api/browsers/:id/close", async (c) =>
    c.json(await browser.close(c.get("owner"), c.req.param("id"))),
  );
  app.get("/api/browsers/:id/read", async (c) =>
    c.json(await browser.read(c.get("owner"), c.req.param("id"))),
  );
  app.post("/api/browsers/:id/reopen", async (c) => {
    const raw = await c.req.text();
    const body = z.object({ url: z.url().max(4096).optional() }).parse(raw ? JSON.parse(raw) : {});
    return c.json(await browser.reopen(c.get("owner"), c.req.param("id"), body.url));
  });
  app.post("/api/browsers/:id/import-downloads", async (c) =>
    c.json(await browser.imports(c.get("owner"), c.req.param("id"))),
  );
  app.get("/api/browsers/:id/preview", async (c) => {
    const response = await browser.preview(c.get("owner"), c.req.param("id"));
    c.header("Content-Type", "image/png");
    return c.body(await response.arrayBuffer());
  });
  app.get("/api/browsers/:id/console", async (c) => {
    await browser.get(c.get("owner"), c.req.param("id"));
    c.header(
      "Content-Security-Policy",
      "default-src 'self'; img-src 'self' blob:; script-src 'unsafe-inline'; style-src 'unsafe-inline'; connect-src 'self'",
    );
    return c.html(browser.console(c.get("owner"), c.req.param("id")));
  });
  app.post("/api/browsers/:id/console", async (c) => {
    await browser.input(c.get("owner"), c.req.param("id"), await c.req.json());
    return c.json({ ok: true });
  });
  app.all("/api/copilotkit/*", async (c) => {
    if (!agentConfigured(config))
      throw new AppError(
        "Configure a model and provider API key, or a valid AG-UI endpoint, to start chat",
        503,
      );
    const response = await runtime.fetch(c.req.raw);
    // Runtime 1.70 emits SSE strings; a WHATWG Response body requires byte chunks.
    const encoder = new TextEncoder();
    const body = response.body?.pipeThrough(
      new TransformStream({
        transform(chunk, controller) {
          controller.enqueue(typeof chunk === "string" ? encoder.encode(chunk) : chunk);
        },
      }),
    );
    return new Response(body, { status: response.status, headers: response.headers });
  });
  app.get("/api/video-progress", (c) => c.json(getVideoProgress()));
  app.get("/api/comfy-control", async (c) => {
    const { readFile } = await import("node:fs/promises");
    const { homedir } = await import("node:os");
    const { resolve } = await import("node:path");
    let lines: Array<{ id: string; text: string }> = [];
    try {
      const txt = await readFile(resolve(homedir(), "ComfyUI/comfy.log"), "utf8");
      const raw = txt
        .replace(new RegExp(`${String.fromCharCode(27)}\\[[0-9;]*m`, "g"), "")
        .split(/\r?\n/)
        .filter(Boolean);
      const start = Math.max(0, raw.length - 85);
      lines = raw.slice(start).map((text, idx) => ({ id: `L${start + idx}`, text }));
    } catch {
      lines = [{ id: "L0", text: "Waiting for ~/ComfyUI/comfy.log..." }];
    }
    let vramUsedGb = 0;
    let vramTotalGb = 0;
    let running = 0;
    let pending = 0;
    try {
      const [stRes, qRes] = await Promise.all([
        fetch("http://127.0.0.1:8188/system_stats"),
        fetch("http://127.0.0.1:8188/queue"),
      ]);
      if (stRes.ok) {
        const st = (await stRes.json()) as {
          devices?: Array<{ vram_total?: number; vram_free?: number }>;
        };
        const dev = st.devices?.at(0);
        if (dev?.vram_total) {
          vramTotalGb = +(dev.vram_total / 1024 ** 3).toFixed(1);
          vramUsedGb = +((dev.vram_total - (dev.vram_free ?? 0)) / 1024 ** 3).toFixed(1);
        }
      }
      if (qRes.ok) {
        const q = (await qRes.json()) as { queue_running?: unknown[]; queue_pending?: unknown[] };
        running = q.queue_running?.length ?? 0;
        pending = q.queue_pending?.length ?? 0;
      }
    } catch {}
    return c.json({ lines, vramUsedGb, vramTotalGb, running, pending });
  });

  app.post("/api/comfy-control", async (c) => {
    const body = (await c.req.json().catch(() => ({}))) as { action?: string };
    if (body.action === "interrupt") {
      await fetch("http://127.0.0.1:8188/interrupt", { method: "POST" });
    } else if (body.action === "clear") {
      await fetch("http://127.0.0.1:8188/queue", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ clear: true }),
      });
    } else if (body.action === "free") {
      await fetch("http://127.0.0.1:8188/free", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ unload_models: true, free_memory: true }),
      });
    }
    return c.json({ ok: true });
  });

  app.get("/api/model-storage", async (c) => {
    const { readFile, stat } = await import("node:fs/promises");
    const { homedir } = await import("node:os");
    const { resolve } = await import("node:path");
    const localDefault = resolve(homedir(), "ComfyUI/models");
    let sharedPath = process.env.COMFY_SHARED_MODELS_DIR?.trim() || "";
    if (!sharedPath) {
      for (const d of ["a", "d", "e", "f", "g", "c"]) {
        for (const folder of ["AI_Models", "Models"]) {
          const cand = `/mnt/${d}/${folder}`;
          try {
            if ((await stat(cand)).isDirectory()) {
              sharedPath = cand;
              break;
            }
          } catch {}
        }
        if (sharedPath) break;
      }
    }
    const formatLabel = (p: string) => {
      const m = p.match(/^\/mnt\/([a-z])\/(.*)$/i);
      return m
        ? `${m[1].toUpperCase()}:\\${m[2].replaceAll("/", "\\")}`
        : p.replace(homedir(), "~");
    };
    let active = sharedPath || localDefault;
    try {
      const raw = JSON.parse(
        await readFile(resolve(process.cwd(), "model-storage.json"), "utf8"),
      ) as { path?: string };
      if (raw.path) active = raw.path;
    } catch {}
    return c.json({
      path: active,
      sharedPath,
      sharedLabel: sharedPath ? formatLabel(sharedPath) : "",
      localDefault,
      localLabel: formatLabel(localDefault),
    });
  });

  app.post("/api/model-storage", async (c) => {
    const { mkdir, writeFile } = await import("node:fs/promises");
    const { homedir } = await import("node:os");
    const { join, resolve } = await import("node:path");
    const body = (await c.req.json().catch(() => ({}))) as { path?: string };
    const localDefault = resolve(homedir(), "ComfyUI/models");
    const target = (body.path || localDefault).trim().replace(/[/]+$/, "");
    for (const sub of [
      "checkpoints",
      "diffusion_models",
      "text_encoders",
      "vae",
      "loras",
      "clip_vision",
      "upscale_models",
      "latent_upscale_models",
    ]) {
      await mkdir(join(target, sub), { recursive: true });
    }
    const isComfyDefault = target === localDefault;
    const yaml = isComfyDefault
      ? ""
      : [
          "shared_models:",
          `  base_path: ${target}/`,
          "  is_default: true",
          "  checkpoints: checkpoints/",
          "  diffusion_models: diffusion_models/",
          "  text_encoders: text_encoders/",
          "  vae: vae/",
          "  loras: loras/",
          "  clip_vision: clip_vision/",
          "  upscale_models: upscale_models/",
          "",
        ].join("\n");
    await writeFile(resolve(homedir(), "ComfyUI/extra_model_paths.yaml"), yaml, "utf8");
    await writeFile(
      resolve(process.cwd(), "model-storage.json"),
      `${JSON.stringify({ path: target }, null, 2)}\n`,
      "utf8",
    );
    return c.json({ ok: true, path: target, localDefault });
  });

  app.get("/api/media-gallery", async (c) => {
    const { readdir, stat } = await import("node:fs/promises");
    const { resolve } = await import("node:path");
    const genDir = resolve(process.cwd(), "generated");
    try {
      const names = await readdir(genDir);
      const items: Array<{
        name: string;
        kind: "image" | "video" | "audio";
        sizeKb: number;
        mtimeMs: number;
        url: string;
      }> = [];
      for (const name of names) {
        if (!/\.(png|jpe?g|webp|gif|mp4|webm|mp3|wav|ogg|m4a|flac)$/i.test(name)) continue;
        const st = await stat(resolve(genDir, name));
        if (!st.isFile()) continue;
        items.push({
          name,
          kind: /\.(mp4|webm)$/i.test(name)
            ? "video"
            : /\.(mp3|wav|ogg|m4a|flac)$/i.test(name)
              ? "audio"
              : "image",
          sizeKb: Math.round(st.size / 1024),
          mtimeMs: st.mtimeMs,
          url: `/media-file/${encodeURIComponent(name)}`,
        });
      }
      items.sort((a, b) => b.mtimeMs - a.mtimeMs);
      return c.json({ items: items.slice(0, 60) });
    } catch {
      return c.json({ items: [] });
    }
  });

  app.get("/avatar-image", async (_c) => {
    const { readFile } = await import("node:fs/promises");
    const { resolve } = await import("node:path");
    const custom = resolve(process.cwd(), "generated/custom-avatar.png");
    const fallback = resolve(process.cwd(), "apps/mobile/assets/capybara.png");
    let buf: Buffer;
    try {
      buf = await readFile(custom);
    } catch {
      buf = await readFile(fallback);
    }
    return new Response(new Uint8Array(buf), {
      status: 200,
      headers: { "Content-Type": "image/png", "Cache-Control": "no-store" },
    });
  });

  app.post("/api/avatar", async (c) => {
    const { copyFile, mkdir, rm, writeFile } = await import("node:fs/promises");
    const { basename, resolve } = await import("node:path");
    const body = (await c.req.json()) as {
      dataBase64?: string;
      existingName?: string;
      reset?: boolean;
    };
    const custom = resolve(process.cwd(), "generated/custom-avatar.png");
    if (body.reset) {
      await rm(custom, { force: true });
      return c.json({ ok: true, ts: Date.now() });
    }
    await mkdir(resolve(process.cwd(), "generated"), { recursive: true });
    if (body.existingName) {
      const src = resolve(process.cwd(), "generated", basename(body.existingName));
      await copyFile(src, custom);
      return c.json({ ok: true, ts: Date.now() });
    }
    const b64 = (body.dataBase64 || "").replace(/^data:[^;]+;base64,/, "");
    if (!b64) return c.json({ ok: false, error: "No image provided" }, 400);
    await writeFile(custom, Buffer.from(b64, "base64"));
    return c.json({ ok: true, ts: Date.now() });
  });
  app.get("/media-file/:name", async (c) => {
    const { readFile } = await import("node:fs/promises");
    const { basename, resolve } = await import("node:path");
    const safeName = basename(decodeURIComponent(c.req.param("name")));
    try {
      const buf = await readFile(resolve(process.cwd(), "generated", safeName));
      const ext = safeName.split(".").pop()?.toLowerCase() ?? "";
      const ct =
        ext === "mp4"
          ? "video/mp4"
          : ext === "webm"
            ? "video/webm"
            : ext === "webp"
              ? "image/webp"
              : ext === "gif"
                ? "image/gif"
                : ext === "jpg" || ext === "jpeg"
                  ? "image/jpeg"
                  : "image/png";
      const bytes = new Uint8Array(buf.buffer, buf.byteOffset, buf.byteLength);
      const range = c.req.header("range");
      if (range?.startsWith("bytes=")) {
        const [sStr, eStr] = range.slice(6).split("-");
        const start = Math.max(0, Number.parseInt(sStr || "0", 10) || 0);
        const end = Math.min(
          bytes.byteLength - 1,
          eStr ? Number.parseInt(eStr, 10) : bytes.byteLength - 1,
        );
        const chunk = bytes.slice(start, end + 1);
        return new Response(chunk, {
          status: 206,
          headers: {
            "Content-Type": ct,
            "Content-Range": `bytes ${start}-${end}/${bytes.byteLength}`,
            "Accept-Ranges": "bytes",
            "Content-Length": String(chunk.byteLength),
          },
        });
      }
      return new Response(bytes, {
        status: 200,
        headers: {
          "Content-Type": ct,
          "Accept-Ranges": "bytes",
          "Content-Length": String(bytes.byteLength),
          "Cache-Control": "no-cache",
        },
      });
    } catch {
      return c.json({ error: "Not found" }, 404);
    }
  });

  app.post("/api/media-upload", async (c) => {
    const { mkdir, writeFile } = await import("node:fs/promises");
    const { basename, resolve } = await import("node:path");
    const body = (await c.req.json()) as { name?: string; dataBase64?: string };
    const rawName = basename(
      (body.name || `upload-${Date.now()}.png`).replace(/[^a-zA-Z0-9._-]/g, "_"),
    );
    const b64 = (body.dataBase64 || "").replace(/^data:[^;]+;base64,/, "");
    if (!b64) return c.json({ ok: false, error: "Empty file" }, 400);
    const genDir = resolve(process.cwd(), "generated");
    await mkdir(genDir, { recursive: true });
    const full = resolve(genDir, rawName);
    await writeFile(full, Buffer.from(b64, "base64"));
    if (/^mic-.*\.webm$/i.test(rawName)) {
      const { execFile } = await import("node:child_process");
      const { promisify } = await import("node:util");
      const { unlink } = await import("node:fs/promises");
      const wavName = rawName.replace(/\.webm$/i, ".wav");
      const wavFull = resolve(genDir, wavName);
      try {
        await promisify(execFile)("ffmpeg", [
          "-y",
          "-i",
          full,
          "-ar",
          "24000",
          "-ac",
          "1",
          wavFull,
        ]);
        await unlink(full).catch(() => {});
        return c.json({ ok: true, name: wavName, savedPath: wavFull });
      } catch {}
    }
    return c.json({ ok: true, name: rawName, savedPath: full });
  });

  app.delete("/api/media-file/:name", async (c) => {
    const { rm } = await import("node:fs/promises");
    const { basename, resolve } = await import("node:path");
    const safeName = basename(decodeURIComponent(c.req.param("name")));
    if (!safeName) return c.json({ ok: false, error: "Invalid filename" }, 400);
    try {
      await rm(resolve(process.cwd(), "generated", safeName), { force: true });
      return c.json({ ok: true, deleted: safeName });
    } catch (err) {
      return c.json({ ok: false, error: err instanceof Error ? err.message : String(err) }, 500);
    }
  });
  app.get("/api/model-settings", async (c) => c.json(await readModelSettings()));
  app.post("/api/model-settings", async (c) => {
    const body = z
      .object({
        mode: z.enum(["cloud", "q4", "q5"]).optional(),
        q4Model: z.string().min(1).max(200).optional(),
        q4ModelPath: z.string().min(1).max(400).optional(),
        q4BaseUrl: z.string().min(1).max(300).optional(),
        q5Model: z.string().min(1).max(200).optional(),
        q5ModelPath: z.string().min(1).max(400).optional(),
        q5BaseUrl: z.string().min(1).max(300).optional(),
        maxSteps: z.number().int().min(4).max(50).optional(),
      })
      .parse(await c.req.json());
    return c.json(await writeModelSettings(body));
  });
  app.get("/api/video-settings", async (c) =>
    c.json({ settings: await readVideoSettings(), schema: STUDIO_SCHEMA }),
  );
  app.post("/api/video-settings", async (c) =>
    c.json({ settings: await writeVideoSettings(await c.req.json()), schema: STUDIO_SCHEMA }),
  );
  app.post("/api/video-settings/reset", async (c) =>
    c.json({ settings: await writeVideoSettings(DEFAULT_VIDEO_SETTINGS), schema: STUDIO_SCHEMA }),
  );
  app.get("/", (c) =>
    c.json({ name: "OpenMuse", app: "http://localhost:8081", health: "/api/health" }),
  );
  return { app, auth, files, actions, workspace, agent, computer };
}

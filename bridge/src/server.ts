import {
  createServer,
  type IncomingMessage,
  type ServerResponse,
} from "node:http";
import { createHash, randomUUID, timingSafeEqual } from "node:crypto";
import type {
  PiHealth,
  PiJobSnapshot,
  PiRequest,
  PiUsage,
} from "../../shared/piProtocol.js";

export interface GenerationEngine {
  health(): Promise<{ models: string[]; authReady: boolean }>;
  generate(
    request: PiRequest,
    signal: AbortSignal,
    onText: (text: string) => void,
  ): Promise<PiUsage | undefined>;
}
interface Job {
  id: string;
  fingerprint: string;
  text: string;
  bytes: number;
  state: PiJobSnapshot["state"];
  controller: AbortController;
  usage?: PiUsage;
  error?: string;
  expiresAt?: number;
  timer: ReturnType<typeof setTimeout>;
}
export interface BridgeOptions {
  token: string;
  engine: GenerationEngine;
  maxBodyBytes?: number;
  maxOutputBytes?: number;
  maxJobs?: number;
  maxConcurrent?: number;
  deadlineMs?: number;
  retentionMs?: number;
  creationWindowMs?: number;
  now?: () => number;
}
class HttpError extends Error {
  constructor(
    public status: number,
    message: string,
  ) {
    super(message);
  }
}
const digest = (value: string) => createHash("sha256").update(value).digest();
const thinkingLevels = new Set([
  "off",
  "minimal",
  "low",
  "medium",
  "high",
  "xhigh",
]);
function validateRequest(value: unknown): PiRequest {
  if (!value || typeof value !== "object")
    throw new HttpError(400, "Invalid request.");
  const r = value as Record<string, unknown>;
  if (
    typeof r.model !== "string" ||
    !/^openai-codex\/[a-zA-Z0-9._-]+$/.test(r.model) ||
    typeof r.system !== "string" ||
    typeof r.user !== "string" ||
    !r.user.trim() ||
    typeof r.thinking !== "string" ||
    !thinkingLevels.has(r.thinking)
  ) {
    throw new HttpError(
      400,
      "Expected a Codex model, system/user text and supported thinking level.",
    );
  }
  return {
    model: r.model,
    system: r.system,
    user: r.user,
    thinking: r.thinking as PiRequest["thinking"],
  };
}
async function body(req: IncomingMessage, maxBytes: number): Promise<unknown> {
  if (!req.headers["content-type"]?.startsWith("application/json"))
    throw new HttpError(415, "JSON required.");
  const chunks: Buffer[] = [];
  let size = 0;
  for await (const chunk of req) {
    size += chunk.length;
    if (size > maxBytes) throw new HttpError(413, "Request too large.");
    chunks.push(chunk);
  }
  try {
    return JSON.parse(Buffer.concat(chunks).toString("utf8"));
  } catch {
    throw new HttpError(400, "Invalid JSON.");
  }
}

/** Loopback HTTP only; use private Tailscale Serve to terminate HTTPS. */
export function createBridge(options: BridgeOptions) {
  if (!/^[A-Za-z0-9_-]{43,}$/.test(options.token))
    throw new Error(
      "SCHOLIA_BRIDGE_TOKEN must be at least 43 URL-safe random characters.",
    );
  const { engine } = options;
  const now = options.now ?? Date.now;
  const retention = options.retentionMs ?? 10 * 60_000;
  const creationWindow = options.creationWindowMs ?? 60_000;
  if (retention < creationWindow + 30_000)
    throw new Error(
      "Retention must cover the creation window and clock skew allowance.",
    );
  const instanceId = randomUUID();
  const jobs = new Map<string, Job>();
  let active = 0;
  let closing = false;
  const expectedToken = digest(`Bearer ${options.token}`);
  const sweep = () => {
    for (const [id, job] of jobs)
      if (job.expiresAt !== undefined && job.expiresAt <= now())
        jobs.delete(id);
  };
  const cleanup = setInterval(sweep, 30_000);
  cleanup.unref();
  const finish = (job: Job, state: Job["state"], error?: string) => {
    if (job.state !== "running") return;
    job.state = state;
    job.error = error;
    job.expiresAt = now() + retention;
    clearTimeout(job.timer);
  };
  const stop = (job: Job, state: "error" | "cancelled", message: string) => {
    finish(job, state, message);
    job.controller.abort(new Error(message));
  };
  const snapshot = (job: Job, offset: number): PiJobSnapshot => ({
    id: job.id,
    state: job.state,
    offset,
    text: job.text.slice(offset),
    nextOffset: job.text.length,
    usage: job.usage,
    error: job.error,
    expiresAt: job.expiresAt,
  });
  const respond = (res: ServerResponse, status: number, data: unknown) => {
    res.writeHead(status, {
      "Content-Type": "application/json",
      "Cache-Control": "no-store",
      "X-Content-Type-Options": "nosniff",
    });
    res.end(JSON.stringify(data));
  };
  const server = createServer(async (req, res) => {
    try {
      // No CORS: browser origins cannot access this privileged API. Obsidian uses requestUrl.
      if (req.headers.origin)
        throw new HttpError(403, "Browser-origin requests are not supported.");
      if (
        !timingSafeEqual(digest(req.headers.authorization ?? ""), expectedToken)
      )
        throw new HttpError(401, "Bridge authentication failed.");
      sweep();
      const url = new URL(req.url ?? "/", "http://localhost");
      if (req.method === "GET" && url.pathname === "/v1/health") {
        const health: PiHealth = {
          version: 1,
          instanceId,
          ...(await engine.health()),
        };
        respond(res, 200, health);
        return;
      }
      if (req.method === "POST" && url.pathname === "/v1/jobs") {
        const input = (await body(
          req,
          options.maxBodyBytes ?? 512 * 1024,
        )) as Record<string, unknown>;
        if (
          !input ||
          typeof input !== "object" ||
          input.instanceId !== instanceId
        )
          throw new HttpError(
            409,
            "Bridge restarted. Start a new run manually.",
          );
        const id = input.id;
        if (typeof id !== "string" || !/^\d{13}-[a-f0-9-]{36}$/.test(id))
          throw new HttpError(400, "Invalid job ID.");
        const request = validateRequest(input.request);
        const fingerprint = digest(JSON.stringify(request)).toString("hex");
        const existing = jobs.get(id);
        if (existing) {
          if (existing.fingerprint !== fingerprint)
            throw new HttpError(409, "Job ID already has a different request.");
          respond(res, 200, { id });
          return;
        }
        const createdAt = Number(id.slice(0, 13));
        if (createdAt > now() + 30_000 || createdAt < now() - creationWindow)
          throw new HttpError(
            410,
            "Job ID expired. Start a new run manually; check device clocks.",
          );
        if (
          jobs.size >= (options.maxJobs ?? 32) ||
          active >= (options.maxConcurrent ?? 2)
        )
          throw new HttpError(429, "Bridge is busy. Try again later.");
        const health = await engine.health();
        if (!health.authReady)
          throw new HttpError(
            503,
            "Sign into OpenAI Codex using Pi on the Mac.",
          );
        if (!health.models.includes(request.model))
          throw new HttpError(
            400,
            "Codex model not available. Check Test Connection and Pi /model.",
          );
        // Recheck after asynchronous authentication/model lookup: concurrent POSTs can share an ID.
        if (jobs.has(id)) {
          if (jobs.get(id)!.fingerprint !== fingerprint)
            throw new HttpError(409, "Job ID already has a different request.");
          respond(res, 200, { id });
          return;
        }
        if (
          jobs.size >= (options.maxJobs ?? 32) ||
          active >= (options.maxConcurrent ?? 2)
        )
          throw new HttpError(429, "Bridge is busy. Try again later.");
        if (closing) throw new HttpError(503, "Bridge stopping.");
        if (createdAt > now() + 30_000 || createdAt < now() - creationWindow)
          throw new HttpError(
            410,
            "Job ID expired during authentication. Start a new run manually.",
          );
        const job: Job = {
          id,
          fingerprint,
          text: "",
          bytes: 0,
          state: "running",
          controller: new AbortController(),
          timer: undefined!,
        };
        job.timer = setTimeout(
          () => stop(job, "error", "Generation deadline exceeded."),
          options.deadlineMs ?? 5 * 60_000,
        );
        job.timer.unref();
        jobs.set(id, job);
        active++;
        void (async () => {
          try {
            const usage = await engine.generate(
              request,
              job.controller.signal,
              (text) => {
                if (job.state !== "running") return;
                job.bytes += Buffer.byteLength(text);
                if (job.bytes > (options.maxOutputBytes ?? 1024 * 1024)) {
                  stop(job, "error", "Output size limit exceeded.");
                  return;
                }
                job.text += text;
              },
            );
            if (job.state === "running") {
              job.usage = usage;
              finish(job, "complete");
            }
          } catch {
            // Provider errors can include prompts/credentials: never return or log them.
            finish(
              job,
              "error",
              "Pi generation failed. Check Codex login, model access and subscription limits on the Mac.",
            );
          } finally {
            active--;
          }
        })();
        respond(res, 202, { id });
        return;
      }
      const match = /^\/v1\/jobs\/([0-9a-f-]+)$/.exec(url.pathname);
      if (match && (req.method === "GET" || req.method === "DELETE")) {
        let job = jobs.get(match[1]);
        if (
          !job &&
          req.method === "DELETE" &&
          /^\d{13}-[a-f0-9-]{36}$/.test(match[1])
        ) {
          const createdAt = Number(match[1].slice(0, 13));
          if (
            createdAt <= now() + 30_000 &&
            createdAt >= now() - creationWindow
          ) {
            // A cancellation may overtake an uncertain/in-flight POST. Reserve the ID so that
            // a late POST cannot start generation after the phone has already cancelled it.
            if (jobs.size >= (options.maxJobs ?? 32))
              throw new HttpError(429, "Bridge is busy.");
            job = {
              id: match[1],
              fingerprint: "cancelled",
              text: "",
              bytes: 0,
              state: "cancelled",
              controller: new AbortController(),
              error: "Generation cancelled.",
              expiresAt: now() + retention,
              timer: undefined!,
            };
            jobs.set(job.id, job);
          }
        }
        if (!job)
          throw new HttpError(
            410,
            "Job missing or expired (possibly bridge restart). No replacement was started.",
          );
        if (req.method === "DELETE") {
          if (job.state === "running")
            stop(job, "cancelled", "Generation cancelled.");
          respond(res, 200, { id: job.id });
          return;
        }
        const offset = Number(url.searchParams.get("offset") ?? "0");
        if (
          !Number.isSafeInteger(offset) ||
          offset < 0 ||
          offset > job.text.length
        )
          throw new HttpError(400, "Invalid cursor.");
        respond(res, 200, snapshot(job, offset));
        return;
      }
      throw new HttpError(404, "Not found.");
    } catch (error) {
      respond(res, error instanceof HttpError ? error.status : 500, {
        error:
          error instanceof HttpError ? error.message : "Bridge request failed.",
      });
    }
  });
  server.maxConnections = 32;
  server.requestTimeout = 15_000;
  server.headersTimeout = 10_000;
  const close = server.close.bind(server);
  server.close = (...args: Parameters<typeof close>) => {
    closing = true;
    for (const job of jobs.values())
      if (job.state === "running") stop(job, "cancelled", "Bridge stopping.");
    return close(...args);
  };
  server.on("close", () => {
    clearInterval(cleanup);
    for (const job of jobs.values())
      if (job.state === "running") stop(job, "cancelled", "Bridge stopping.");
  });
  return server;
}

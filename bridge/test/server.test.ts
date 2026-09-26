import { test } from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { once } from "node:events";
import {
  createBridge,
  type BridgeOptions,
  type GenerationEngine,
} from "../src/server.js";
import type { PiRequest, PiUsage } from "../../shared/piProtocol.js";

const token = "a".repeat(43);
const model = "openai-codex/test-model";
const request: PiRequest = {
  model,
  system: "Study",
  user: "Context",
  thinking: "medium",
};
function fakeEngine() {
  const calls: {
    signal: AbortSignal;
    text: (text: string) => void;
    finish: (usage?: PiUsage) => void;
    fail: (error: Error) => void;
  }[] = [];
  const engine: GenerationEngine = {
    health: async () => ({ authReady: true, models: [model] }),
    generate: async (_, signal, text) =>
      new Promise((finish, fail) => {
        calls.push({ signal, text, finish, fail });
        signal.addEventListener("abort", () => fail(signal.reason), {
          once: true,
        });
      }),
  };
  return { engine, calls };
}
async function fixture(
  t: { after: (fn: () => Promise<void>) => void },
  opts: Partial<BridgeOptions> = {},
) {
  const fake = fakeEngine();
  const server = createBridge({ token, engine: fake.engine, ...opts });
  server.listen(0, "127.0.0.1");
  await once(server, "listening");
  const address = server.address() as { port: number };
  t.after(async () => {
    if (server.listening) {
      const closed = once(server, "close");
      server.closeAllConnections();
      server.close();
      await closed;
    }
  });
  const api = async (
    path: string,
    method = "GET",
    data?: unknown,
    headers: Record<string, string> = {},
  ) => {
    const response = await fetch(`http://127.0.0.1:${address.port}${path}`, {
      method,
      headers: {
        Authorization: `Bearer ${token}`,
        "Content-Type": "application/json",
        ...headers,
      },
      body: data === undefined ? undefined : JSON.stringify(data),
    });
    return { status: response.status, data: (await response.json()) as any };
  };
  const health = await api("/v1/health");
  const instanceId = health.data.instanceId;
  const id = () => `${(opts.now ?? Date.now)()}-${randomUUID()}`;
  const start = (jobId = id(), req = request) =>
    api("/v1/jobs", "POST", { id: jobId, instanceId, request: req });
  return { ...fake, api, start, id, instanceId, server };
}

test("authenticated health, subscription status and routing; no prompt required", async (t) => {
  const f = await fixture(t);
  assert.equal((await f.api("/v1/health")).data.version, 1);
  assert.equal(
    (
      await f.api("/v1/health", "GET", undefined, {
        Authorization: "Bearer wrong",
      })
    ).status,
    401,
  );
  assert.equal(
    (
      await f.api("/v1/health", "GET", undefined, {
        Origin: "https://hostile.example",
      })
    ).status,
    403,
  );
  assert.equal((await f.api("/v1/rpc", "POST", {})).status, 404);
  assert.equal(f.calls.length, 0);
});

test("create, duplicate POST, cursor polling after disconnect, completion metadata", async (t) => {
  const f = await fixture(t);
  const id = f.id();
  const results = await Promise.all([f.start(id), f.start(id)]);
  assert.deepEqual(results.map((r) => r.status).sort(), [200, 202]);
  assert.equal(f.calls.length, 1);
  f.calls[0].text("First ");
  const first = (await f.api(`/v1/jobs/${id}?offset=0`)).data;
  assert.equal(first.text, "First ");
  // No requests while offline: generation continues and the next snapshot starts at the saved cursor.
  f.calls[0].text("second");
  f.calls[0].finish({ totalTokens: 17 });
  const next = (await f.api(`/v1/jobs/${id}?offset=${first.nextOffset}`)).data;
  assert.equal(next.text, "second");
  assert.equal(next.state, "complete");
  assert.deepEqual(next.usage, { totalTokens: 17 });
  assert.equal((await f.api(`/v1/jobs/${id}?offset=999`)).status, 400);
  assert.equal(
    (await f.start(id, { ...request, user: "different" })).status,
    409,
  );
});

test("rejects wrong provider, missing/unknown models, restarted instance and expired IDs", async (t) => {
  const f = await fixture(t);
  assert.equal(
    (await f.start(f.id(), { ...request, model: "openrouter/test" })).status,
    400,
  );
  assert.equal(
    (await f.start(f.id(), { ...request, model: "openai-codex/unknown" }))
      .status,
    400,
  );
  assert.equal(
    (await f.start(f.id(), { ...request, thinking: "unsupported" as any }))
      .status,
    400,
  );
  assert.equal(
    (
      await f.api("/v1/jobs", "POST", {
        id: f.id(),
        instanceId: "old",
        request,
      })
    ).status,
    409,
  );
  assert.equal(
    (await f.start(`${Date.now() - 120_000}-${randomUUID()}`)).status,
    410,
  );
  assert.equal(f.calls.length, 0);
});

test("does not fall back when Codex auth missing", async (t) => {
  const f = await fixture(t, {
    engine: {
      health: async () => ({ authReady: false, models: [model] }),
      generate: async () => {
        assert.fail("must not generate");
      },
    },
  });
  assert.equal((await f.start()).status, 503);
});

test("body, output, concurrent and retained-job memory limits", async (t) => {
  const f = await fixture(t, {
    maxBodyBytes: 512,
    maxOutputBytes: 5,
    maxConcurrent: 1,
    maxJobs: 1,
  });
  assert.equal(
    (await f.start(f.id(), { ...request, user: "a".repeat(1024) })).status,
    413,
  );
  const id = f.id();
  assert.equal((await f.start(id)).status, 202);
  assert.equal((await f.start()).status, 429);
  f.calls[0].text("oversized");
  const job = (await f.api(`/v1/jobs/${id}`)).data;
  assert.equal(job.state, "error");
  assert.equal(job.text, "");
  assert.equal(f.calls[0].signal.aborted, true);
  assert.equal((await f.start()).status, 429);
});

test("cancel aborts engine; cancellation overtaking POST prevents late generation", async (t) => {
  const f = await fixture(t);
  const id = f.id();
  await f.start(id);
  assert.equal((await f.api(`/v1/jobs/${id}`, "DELETE")).status, 200);
  assert.equal(f.calls[0].signal.aborted, true);
  assert.equal((await f.api(`/v1/jobs/${id}`)).data.state, "cancelled");
  const late = f.id();
  await f.api(`/v1/jobs/${late}`, "DELETE");
  assert.equal((await f.start(late)).status, 409);
  assert.equal(f.calls.length, 1);
});

test("deadline aborts provider and does not leak raw provider errors", async (t) => {
  const f = await fixture(t, { deadlineMs: 15 });
  const id = f.id();
  await f.start(id);
  await new Promise((resolve) => setTimeout(resolve, 25));
  assert.equal(f.calls[0].signal.aborted, true);
  assert.equal(
    (await f.api(`/v1/jobs/${id}`)).data.error,
    "Generation deadline exceeded.",
  );
  const second = f.id();
  await f.start(second);
  f.calls[1].fail(new Error("secret-token and private prompt"));
  const error = (await f.api(`/v1/jobs/${second}`)).data;
  assert.equal(error.state, "error");
  assert.doesNotMatch(error.error, /secret-token|private prompt/);
});

test("expired jobs free memory and an old creation ID cannot regenerate", async (t) => {
  let now = Date.now();
  const f = await fixture(t, {
    now: () => now,
    retentionMs: 31_000,
    creationWindowMs: 1000,
    maxJobs: 1,
  });
  const id = f.id();
  await f.start(id);
  f.calls[0].finish();
  await f.api(`/v1/jobs/${id}`);
  now += 31_001;
  assert.equal((await f.api(`/v1/jobs/${id}`)).status, 410);
  assert.equal((await f.start(id)).status, 410);
  assert.equal((await f.start()).status, 202);
  assert.equal(f.calls.length, 2);
});

test("requires strong token configuration", () => {
  assert.throws(
    () => createBridge({ token: "weak", engine: fakeEngine().engine }),
    /43/,
  );
});

test("expired POST cannot start after delayed health and an overtaking DELETE", async (t) => {
  let now = Date.now();
  const f = await fixture(t, { now: () => now });
  let release!: () => void, entered!: () => void;
  const barrier = new Promise<void>((r) => (release = r));
  const entering = new Promise<void>((r) => (entered = r));
  f.engine.health = async () => {
    entered();
    await barrier;
    return { authReady: true, models: [model] };
  };
  const id = f.id();
  const pending = f.start(id);
  await entering;
  now += 60_001;
  assert.equal((await f.api(`/v1/jobs/${id}`, "DELETE")).status, 410);
  release();
  assert.equal((await pending).status, 410);
  assert.equal(f.calls.length, 0);
});

test("closing the server prevents pending health continuation from starting generation", async (t) => {
  const f = await fixture(t);
  let release!: () => void, entered!: () => void;
  const barrier = new Promise<void>((r) => (release = r));
  const entering = new Promise<void>((r) => (entered = r));
  f.engine.health = async () => {
    entered();
    await barrier;
    return { authReady: true, models: [model] };
  };
  const pending = f.start();
  await entering;
  const closed = once(f.server, "close");
  f.server.close();
  release();
  assert.equal((await pending).status, 503);
  await closed;
  assert.equal(f.calls.length, 0);
});

test("health finishing after server close cannot create an orphan generation", async (t) => {
  const f = await fixture(t);
  let release!: () => void, entered!: () => void;
  const barrier = new Promise<void>((r) => (release = r));
  const entering = new Promise<void>((r) => (entered = r));
  f.engine.health = async () => {
    entered();
    await barrier;
    return { authReady: true, models: [model] };
  };
  const pending = f.start().catch(() => undefined);
  await entering;
  const closed = once(f.server, "close");
  f.server.close();
  f.server.closeAllConnections();
  await closed;
  await pending;
  release();
  await new Promise<void>((r) => setImmediate(r));
  assert.equal(f.calls.length, 0);
});

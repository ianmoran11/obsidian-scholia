import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, mkdir, writeFile, rm, readFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  createAgentSession,
  AgentSession,
  ModelRuntime,
  SessionManager,
  SettingsManager,
} from "@earendil-works/pi-coding-agent";
import {
  createPiEngine,
  isolatedResources,
  oauthCredentials,
} from "../src/pi.js";

test("real SDK session has no tools, extensions, project context or persisted session", async (t) => {
  const dir = await mkdtemp(join(tmpdir(), "scholia-sdk-"));
  t.after(() => rm(dir, { recursive: true, force: true }));
  await mkdir(join(dir, ".pi", "extensions"), { recursive: true });
  await writeFile(join(dir, "AGENTS.md"), "UNTRUSTED PROJECT INSTRUCTIONS");
  await writeFile(
    join(dir, ".pi", "extensions", "bad.ts"),
    'throw new Error("MUST NOT LOAD");',
  );
  const runtime = await ModelRuntime.create({
    authPath: join(dir, "auth.json"),
    modelsPath: null,
    refreshOnCreate: false,
  });
  const model = runtime.getModels("openai-codex")[0];
  assert.ok(model);
  const { session } = await createAgentSession({
    cwd: dir,
    agentDir: dir,
    modelRuntime: runtime,
    model,
    noTools: "all",
    tools: [],
    customTools: [],
    resourceLoader: isolatedResources("Only this system prompt"),
    sessionManager: SessionManager.inMemory(dir),
    settingsManager: SettingsManager.inMemory(),
  });
  try {
    assert.deepEqual(session.getActiveToolNames(), []);
    assert.match(session.systemPrompt, /Only this system prompt/);
    assert.doesNotMatch(session.systemPrompt, /UNTRUSTED PROJECT INSTRUCTIONS/);
    assert.equal(session.sessionManager.getSessionFile(), undefined);
  } finally {
    session.dispose();
  }
});

test("health uses Codex OAuth metadata, not stale runtime snapshot or API-key auth", async (t) => {
  const dir = await mkdtemp(join(tmpdir(), "scholia-auth-test-"));
  t.after(() => rm(dir, { recursive: true, force: true }));
  const auth = join(dir, "auth.json");
  const engine = await createPiEngine(dir, dir);
  assert.equal((await engine.health()).authReady, false);
  await writeFile(
    auth,
    JSON.stringify({
      "openai-codex": {
        type: "oauth",
        access: "test-only",
        refresh: "test-only",
        expires: Date.now() + 3600_000,
      },
    }),
  );
  const health = await engine.health();
  assert.equal(health.authReady, true);
  assert.ok(health.models.length > 0);
  assert.ok(health.models.every((model) => model.startsWith("openai-codex/")));
  await writeFile(
    auth,
    JSON.stringify({ "openai-codex": { type: "api_key", key: "test-only" } }),
  );
  assert.equal((await engine.health()).authReady, false);
});

test("OAuth adapter rejects command keys and preserves locked concurrent refresh updates", async (t) => {
  const dir = await mkdtemp(join(tmpdir(), "scholia-oauth-"));
  t.after(() => rm(dir, { recursive: true, force: true }));
  const auth = join(dir, "auth.json");
  const marker = join(dir, "must-not-exist");
  await writeFile(
    auth,
    JSON.stringify({
      "openai-codex": { type: "api_key", key: `!touch ${marker}` },
    }),
  );
  const store = await oauthCredentials(auth);
  assert.equal(await store.read("openai-codex"), undefined);
  assert.deepEqual(await store.list(), []);
  assert.equal(
    (await (await createPiEngine(dir, dir)).health()).authReady,
    false,
  );
  await assert.rejects(readFile(marker), { code: "ENOENT" });
  await assert.rejects(
    store.modify("openai-codex", async (value) => value),
    /OAuth/,
  );
  await writeFile(
    auth,
    JSON.stringify({
      "openai-codex": {
        type: "oauth",
        access: "synthetic",
        refresh: "synthetic",
        expires: 1,
      },
      other: { type: "api_key", key: "untouched" },
    }),
  );
  const second = await oauthCredentials(auth);
  await Promise.all(
    [store, second].map((s) =>
      s.modify("openai-codex", async (current) => {
        assert.equal(current?.type, "oauth");
        return {
          ...current!,
          type: "oauth",
          expires: (current as any).expires + 1,
        };
      }),
    ),
  );
  assert.equal(((await store.read("openai-codex")) as any).expires, 3);
  assert.equal(JSON.parse(await readFile(auth, "utf8")).other.key, "untouched");
  assert.equal(await store.read("other"), undefined);
});

test("cancellation during real SDK authentication preflight never starts the agent", async (t) => {
  const dir = await mkdtemp(join(tmpdir(), "scholia-preflight-"));
  t.after(() => rm(dir, { recursive: true, force: true }));
  await writeFile(
    join(dir, "auth.json"),
    JSON.stringify({
      "openai-codex": {
        type: "oauth",
        access: "synthetic",
        refresh: "synthetic",
        expires: Date.now() + 3600_000,
      },
    }),
  );
  const engine = await createPiEngine(dir, dir);
  const model = (await engine.health()).models.find((m) =>
    m.endsWith("/gpt-5.5"),
  )!;
  let release!: () => void, entered!: () => void;
  const barrier = new Promise<void>((r) => (release = r));
  const entering = new Promise<void>((r) => (entered = r));
  let upstream = 0;
  const original = AgentSession.prototype.prompt;
  t.mock.method(
    AgentSession.prototype,
    "prompt",
    function (this: AgentSession, ...args: Parameters<AgentSession["prompt"]>) {
      const check = this.modelRuntime.checkAuth.bind(this.modelRuntime);
      t.mock.method(this.modelRuntime, "hasConfiguredAuth", () => false);
      t.mock.method(
        this.modelRuntime,
        "checkAuth",
        async (...params: Parameters<ModelRuntime["checkAuth"]>) => {
          entered();
          await barrier;
          return check(...params);
        },
      );
      t.mock.method(this.agent, "prompt", async () => {
        upstream++;
      });
      return original.apply(this, args);
    },
  );
  const controller = new AbortController();
  const run = engine.generate(
    { model, system: "Study", user: "Hello", thinking: "medium" },
    controller.signal,
    () => {},
  );
  await entering;
  controller.abort(new Error("Cancelled in preflight"));
  release();
  await assert.rejects(run, /Cancelled in preflight/);
  assert.equal(upstream, 0);
});

import { afterEach, expect, it, vi } from "vitest";
vi.mock("obsidian", async (original) => ({
  ...(await original<object>()),
  requestUrl: vi.fn(),
  MarkdownView: class {},
}));
import { Editor } from "../mocks/obsidian";
import { DEFAULT_SETTINGS } from "../../src/settings";
import { TemplateRegistry } from "../../src/templates/registry";
import { CustomProbeModal } from "../../src/ui/modal";
import { PiBridgeClient } from "../../src/llm/piBridge";
import { OpenRouterClient } from "../../src/llm/openrouter";
import { StreamManager } from "../../src/stream/manager";

function setup() {
  const files = new Map<string, string>([
    [
      "templates/Study.md",
      "---\ncontext_scope: full-note\noutput_destination: inline\n---\nYou are a tutor.",
    ],
  ]);
  const editor = new Editor() as any;
  editor.setValue("Original context");
  let cursor = 0;
  editor.getCursor = () => editor.offsetToPos(cursor);
  editor.getLine = (line: number) => editor.getValue().split("\n")[line] ?? "";
  editor.setCursor = (offset: number) => {
    cursor = offset;
  };
  const view = { editor, file: { path: "note.md" } };
  const app = {
    workspace: { getActiveViewOfType: () => view },
    metadataCache: { getFileCache: () => null },
    vault: {
      getMarkdownFiles: () =>
        Array.from(files.keys()).map((path) => ({ path, stat: { mtime: 1 } })),
      getFileByPath: (path: string) =>
        files.has(path) ? { path, stat: { mtime: 1 } } : null,
      read: async (file: { path: string }) => files.get(file.path)!,
      create: async (path: string, content: string) => files.set(path, content),
      modify: async (file: { path: string }, content: string) =>
        files.set(file.path, content),
      getFolderByPath: () => ({}),
    },
  } as any;
  const plugin = {
    app,
    addCommand: vi.fn(),
    settings: {
      ...DEFAULT_SETTINGS,
      llmBackend: "pi" as const,
      piBridgeToken: "d".repeat(43),
      piBridgeUrl: "https://mac.tailnet.ts.net",
      piModel: "openai-codex/fake",
      openRouterApiKey: "",
    },
  };
  const manager = new StreamManager(plugin);
  const registry = new TemplateRegistry(app, plugin, manager);
  vi.spyOn(CustomProbeModal.prototype, "openAndWait").mockResolvedValue({
    query: "Why?",
    scope: "full-note",
    attachedNotePaths: [],
    alsoAppendToCentral: false,
    reasoningEnabled: false,
    reasoningEffort: "low",
    tokenBudget: 1024,
    outputMode: "callout",
    sectionLevel: 2,
    inPlaceScope: "full-note",
    headingLevel: 0,
  });
  const pi = vi
    .spyOn(PiBridgeClient.prototype, "stream")
    .mockImplementation(async function* () {
      yield { type: "content", text: "Codex answer" };
      yield { type: "metadata", usage: { totalTokens: 12 } };
    });
  const openrouter = vi.spyOn(OpenRouterClient.prototype, "stream");
  const config = {
    contextScope: "full-note",
    outputDestination: "inline",
    systemPrompt: "Study",
    customProbe: true,
  };
  const run = (overrides = {}) =>
    (registry as any).runTemplateCommand(
      "templates/Study.md",
      { ...config, ...overrides },
      "Study",
    );
  return { registry, files, editor, pi, openrouter, run, view, app, manager };
}
afterEach(() => vi.restoreAllMocks());

it("runs Pi inline + capture, follows up, and regenerates without an OpenRouter key", async () => {
  const f = setup();
  await f.run({ alsoAppendTo: "captures.md" });
  expect(f.editor.getValue()).toContain("Codex answer");
  expect(f.editor.getValue()).toContain("provider=openai-codex");
  expect(f.files.get("captures.md")).toContain("provider=openai-codex");
  f.editor.setCursor(f.editor.getValue().indexOf("Codex answer"));
  await f.run();
  expect(f.editor.getValue()).toContain("**Follow-up:** Why?");
  expect(f.pi.mock.calls[1][0].user).toContain("Existing Scholia conversation");
  await f.registry.regenerateActiveCallout();
  expect(f.pi).toHaveBeenCalledTimes(3);
  expect(
    f.pi.mock.calls.every(
      ([req]) =>
        req.provider === "openai-codex" &&
        req.model === "openai-codex/fake" &&
        req.reasoningEffort === "medium",
    ),
  ).toBe(true);
  expect(f.openrouter).not.toHaveBeenCalled();
});

it("routes file-append output to Pi and rejects incompatible overrides before editing", async () => {
  const f = setup();
  await f.run({ outputDestination: "append.md" });
  expect(f.files.get("append.md")).toContain("Codex answer");
  expect(f.files.get("append.md")).toContain("cost=unavailable");
  await f.run({ model: "openai/gpt-test" });
  expect(f.editor.getValue()).toBe("Original context");
  expect(f.pi).toHaveBeenCalledTimes(1);
  expect(f.openrouter).not.toHaveBeenCalled();
});

function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((r) => (resolve = r));
  return { promise, resolve };
}

it("Pi callout snapshots omit unsupported tuning and can still regenerate", async () => {
  const f = setup();
  await f.run();
  const json = /<!-- scholia:run (.*?) -->/.exec(f.editor.getValue())![1];
  const snapshot = JSON.parse(json);
  expect(snapshot.provider).toBe("openai-codex");
  expect(snapshot).not.toHaveProperty("temperature");
  expect(snapshot).not.toHaveProperty("maxTokens");
  f.editor.setCursor(f.editor.getValue().indexOf("Codex answer"));
  await f.registry.regenerateActiveCallout();
  expect(f.pi).toHaveBeenCalledTimes(2);
});

it.each(["edit", "switch", "unload"])(
  "rejects delayed follow-up initial mutation after %s",
  async (action) => {
    const f = setup();
    await f.run();
    f.editor.setCursor(f.editor.getValue().indexOf("Codex answer"));
    const result = await CustomProbeModal.prototype.openAndWait();
    const modal = deferred<typeof result>();
    vi.mocked(CustomProbeModal.prototype.openAndWait).mockReturnValueOnce(
      modal.promise,
    );
    const running = f.run();
    if (action === "edit") f.editor.setValue("Changed document");
    if (action === "switch") f.view.file.path = "other.md";
    if (action === "unload") f.manager.dispose();
    const before = f.editor.getValue();
    modal.resolve(result);
    await running;
    expect(f.editor.getValue()).toBe(before);
    expect(f.pi).toHaveBeenCalledTimes(1);
  },
);

it.each(["edit", "switch", "unload"])(
  "rejects regeneration after %s during attachment reads",
  async (action) => {
    const f = setup();
    await f.run();
    f.editor.setCursor(f.editor.getValue().indexOf("Codex answer"));
    const attachment = deferred<{
      context: string;
      attachedNotePaths: string[];
    }>();
    const entered = deferred<void>();
    vi.spyOn(
      f.registry as any,
      "buildContextWithAttachments",
    ).mockImplementation(() => {
      entered.resolve();
      return attachment.promise;
    });
    const running = f.registry.regenerateActiveCallout();
    await entered.promise;
    if (action === "edit") f.editor.setValue("Changed document");
    if (action === "switch") f.view.file.path = "other.md";
    if (action === "unload") f.manager.dispose();
    const before = f.editor.getValue();
    attachment.resolve({ context: "read result", attachedNotePaths: [] });
    await running;
    expect(f.editor.getValue()).toBe(before);
    expect(f.pi).toHaveBeenCalledTimes(1);
  },
);

it("rejects rendered regeneration when the active note changes during openFile", async () => {
  const f = setup();
  await f.run();
  const original = f.editor.getValue();
  f.files.set("note.md", original);
  const otherEditor = new Editor();
  otherEditor.setValue(original);
  const otherView = { editor: otherEditor, file: { path: "other.md" } };
  const opened = deferred<void>();
  const openFile = vi.fn(() => opened.promise);
  f.app.workspace.getLeaf = () => ({ openFile });
  const lineStart = original.split("\n").findIndex((line: string) => line.startsWith("> [!"));
  expect(lineStart).toBeGreaterThanOrEqual(0);
  f.pi.mockClear();

  const running = f.registry.regenerateRenderedCallout("note.md", lineStart);
  expect(openFile).toHaveBeenCalledOnce();
  f.app.workspace.getActiveViewOfType = () => otherView;
  opened.resolve();
  await running;

  expect(f.editor.getValue()).toBe(original);
  expect(otherEditor.getValue()).toBe(original);
  expect(f.pi).not.toHaveBeenCalled();
  expect(f.openrouter).not.toHaveBeenCalled();
});

it.each(["inline", "capture", "append"])(
  "unload cancels %s and ignores successful late provider response",
  async (mode) => {
    const f = setup();
    const entered = deferred<AbortSignal>();
    const response = deferred<void>();
    f.pi.mockImplementation(async function* (_, signal) {
      entered.resolve(signal);
      await response.promise;
      yield { type: "content", text: "late result" };
    });
    const running = f.run(
      mode === "append"
        ? { outputDestination: "append.md" }
        : mode === "capture"
          ? { alsoAppendTo: "captures.md" }
          : {},
    );
    const signal = await entered.promise;
    f.manager.dispose();
    const before = f.editor.getValue();
    response.resolve();
    await running;
    expect(signal.aborted).toBe(true);
    expect(f.editor.getValue()).toBe(before);
    expect(f.files.has("append.md")).toBe(false);
    expect(f.files.has("captures.md")).toBe(false);
  },
);

it.each(["section", "in-place", "append"])(
  "does not begin %s after source changes during initial context read",
  async (mode) => {
    const f = setup();
    const result = await CustomProbeModal.prototype.openAndWait();
    vi.mocked(CustomProbeModal.prototype.openAndWait).mockResolvedValue({
      ...result!,
      outputMode: mode === "append" ? "callout" : (mode as any),
    });
    const attachment = deferred<{
      context: string;
      attachedNotePaths: string[];
    }>();
    const entered = deferred<void>();
    vi.spyOn(
      f.registry as any,
      "buildContextWithAttachments",
    ).mockImplementation(() => {
      entered.resolve();
      return attachment.promise;
    });
    const running = f.run(
      mode === "append" ? { outputDestination: "append.md" } : {},
    );
    await entered.promise;
    f.editor.setValue("Replacement");
    attachment.resolve({ context: "stale", attachedNotePaths: [] });
    await running;
    expect(f.editor.getValue()).toBe("Replacement");
    expect(f.pi).not.toHaveBeenCalled();
    expect(f.files.has("append.md")).toBe(false);
  },
);

it("unload during an actual bridge poll sends DELETE and discards its late successful response", async () => {
  const f = setup();
  f.pi.mockRestore();
  const obsidian = await import("obsidian");
  const entered = deferred<void>();
  const poll = deferred<any>();
  let id = "";
  const transport = vi
    .spyOn(obsidian, "requestUrl")
    .mockImplementation(async (options: any) => {
      if (options.url.endsWith("/v1/health"))
        return {
          status: 200,
          json: {
            version: 1,
            instanceId: "instance",
            models: ["openai-codex/fake"],
            authReady: true,
          },
        } as any;
      if (options.method === "POST") {
        id = JSON.parse(options.body).id;
        return { status: 202, json: { id } } as any;
      }
      if (options.method === "DELETE")
        return { status: 200, json: { id } } as any;
      entered.resolve();
      return poll.promise;
    });
  const run = f.run({ alsoAppendTo: "captures.md" });
  await entered.promise;
  const before = f.editor.getValue();
  f.manager.dispose();
  poll.resolve({
    status: 200,
    json: { id, state: "complete", offset: 0, nextOffset: 4, text: "late" },
  });
  await run;
  expect(
    transport.mock.calls.some(
      ([options]) => typeof options !== "string" && options.method === "DELETE",
    ),
  ).toBe(true);
  expect(f.editor.getValue()).toBe(before);
  expect(f.files.has("captures.md")).toBe(false);
});

import { afterEach, describe, expect, it, vi } from "vitest";
import * as obsidian from "obsidian";
import { TemplateRegistry } from "../../src/templates/registry";
import { CustomProbeModal } from "../../src/ui/modal";
import { DEFAULT_SETTINGS } from "../../src/settings";
import { PiBridgeClient } from "../../src/llm/piBridge";
import { OpenRouterClient } from "../../src/llm/openrouter";

const path = "Edu-Templates/Clarify.md";
const yaml = (model?: string, extra = "") =>
  `---\ncontext_scope: selection\noutput_destination: inline\n${model ? `model: ${model}\n` : ""}${extra}---\nFresh prompt`;

async function fixture() {
  const file = {
    path,
    stat: { mtime: 1 },
    content: yaml("openrouter/old").replace("Fresh prompt", "Cached prompt"),
  };
  const files = new Map([[path, file]]);
  const commands = new Map<string, any>();
  const editor = {
    getValue: vi.fn(() => "Selected note"),
    getSelection: () => "Selected note",
    getCursor: () => ({ line: 0, ch: 0 }),
    getLine: () => "Selected note",
    posToOffset: () => 0,
    offsetToPos: () => ({ line: 0, ch: 0 }),
    replaceRange: vi.fn(),
  };
  const view = { file: { path: "Reading/Note.md" }, editor };
  const app = {
    vault: {
      getFolderByPath: () => ({}),
      getMarkdownFiles: () => [...files.values()],
      // Obsidian mutates this SAME TFile in place, not a synthetic copy.
      getFileByPath: (p: string) => files.get(p) ?? null,
      read: vi.fn(async (f: typeof file) => f.content),
    },
    metadataCache: {
      getFileCache: () => ({
        frontmatter: {
          context_scope: "selection",
          output_destination: "inline",
          model: "openrouter/old",
        },
      }),
    },
    workspace: { getActiveViewOfType: vi.fn(() => view) },
    commands: { removeCommand: vi.fn((id: string) => commands.delete(id)) },
  };
  const settings = {
    ...DEFAULT_SETTINGS,
    templatesFolder: "Edu-Templates",
    llmBackend: "pi" as const,
    piBridgeUrl: "http://127.0.0.1:3210",
    piBridgeToken: "x".repeat(43),
    piModel: "openai-codex/gpt-5.5",
    enableHotReloadOfTemplates: false,
  };
  const manager = { isDisposed: false };
  const registry = new TemplateRegistry(
    app as any,
    {
      app: app as any,
      settings,
      addCommand: (cmd) => {
        commands.set(cmd.id, cmd);
        return cmd;
      },
    },
    manager as any,
  );
  vi.spyOn(CustomProbeModal.prototype, "openAndWait").mockResolvedValue({
    query: "",
    scope: "selection",
    attachedNotePaths: [],
    alsoAppendToCentral: false,
    reasoningEnabled: true,
    reasoningEffort: "medium",
    tokenBudget: 1024,
    outputMode: "callout",
    sectionLevel: 2,
    inPlaceScope: "selection",
    headingLevel: 0,
  });
  const pi = vi
    .spyOn(PiBridgeClient.prototype, "stream")
    .mockImplementation(async function* () {});
  const openrouter = vi
    .spyOn(OpenRouterClient.prototype, "stream")
    .mockImplementation(async function* () {});
  const run = vi
    .spyOn(registry as any, "runInline")
    .mockImplementation(async (...args: any[]) => {
      for await (const _ of args[6].stream(
        args[7],
        new AbortController().signal,
      )) {
        /* fake only */
      }
    });
  const notices = vi.spyOn(console, "log").mockImplementation(() => {});
  await registry.load();
  const callback = [...commands.values()][0].callback;
  const invoke = async (cb = callback) => {
    await cb();
    // Also drain callbacks from the pre-fix command, which returned void.
    for (let i = 0; i < 20; i++) await Promise.resolve();
  };
  return {
    file,
    files,
    commands,
    editor,
    view,
    app,
    settings,
    manager,
    registry,
    pi,
    openrouter,
    run,
    notices,
    invoke,
  };
}

afterEach(() => vi.restoreAllMocks());

describe("registered template command freshness", () => {
  it("preserves the mobile selection while awaiting the fresh template read", async () => {
    const f = await fixture();
    f.file.content = yaml(undefined, "requires_selection: true\n");
    f.app.vault.read.mockImplementationOnce(async () => {
      // Opening the palette/keyboard can clear the editor selection without
      // changing the note while the template read is pending.
      f.editor.getSelection = () => "";
      return f.file.content;
    });
    await f.invoke();
    expect(f.pi).toHaveBeenCalledWith(
      expect.objectContaining({
        model: "openai-codex/gpt-5.5",
        user: "Selected note",
      }),
      expect.any(AbortSignal),
    );
    expect(f.openrouter).not.toHaveBeenCalled();
  });

  it("reconciles an in-place TFile edit despite stale metadata, then runs Pi default", async () => {
    const f = await fixture();
    f.file.content = yaml(undefined, "command_prefix: Updated\n");
    f.file.stat.mtime++;
    await f.registry.doReconcile();
    expect(
      f.registry.getRegisteredCommands().get(path)?.config.model,
    ).toBeUndefined();
    expect([...f.commands.values()][0].name).toBe("Updated: Clarify");
    await f.invoke([...f.commands.values()][0].callback);
    expect(f.pi).toHaveBeenCalledWith(
      expect.objectContaining({
        model: "openai-codex/gpt-5.5",
        provider: "openai-codex",
      }),
      expect.any(AbortSignal),
    );
    expect(f.openrouter).not.toHaveBeenCalled();
  });

  it.each([false, true])(
    "refreshes a retained callback with hot reload disabled (reconcile=%s)",
    async (reconcile) => {
      const f = await fixture();
      f.file.content = yaml();
      f.file.stat.mtime++;
      if (reconcile) await f.registry.doReconcile();
      await f.invoke();
      expect(f.pi).toHaveBeenCalledWith(
        expect.objectContaining({ model: "openai-codex/gpt-5.5" }),
        expect.any(AbortSignal),
      );
      expect(f.openrouter).not.toHaveBeenCalled();
    },
  );

  it("uses current valid explicit override and fresh prompt, not Pi default", async () => {
    const f = await fixture();
    f.file.content = yaml("openai-codex/explicit");
    await f.invoke();
    expect(f.pi).toHaveBeenCalledWith(
      expect.objectContaining({
        model: "openai-codex/explicit",
        system: "Fresh prompt",
      }),
      expect.any(AbortSignal),
    );
    expect(f.openrouter).not.toHaveBeenCalled();
  });
});

function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((r) => {
    resolve = r;
  });
  return { promise, resolve };
}

function expectNoRun(f: Awaited<ReturnType<typeof fixture>>) {
  expect(f.run).not.toHaveBeenCalled();
  expect(f.pi).not.toHaveBeenCalled();
  expect(f.openrouter).not.toHaveBeenCalled();
  expect(f.editor.replaceRange).not.toHaveBeenCalled();
}

describe("registered command fail-closed behavior", () => {
  it.each([
    "deleted",
    "unreadable",
    "missing frontmatter",
    "invalid config",
    "invalid YAML",
    "null YAML",
    "array YAML",
    "scalar YAML",
  ])("does not reuse cached config for %s", async (failure) => {
    const f = await fixture();
    f.file.content = yaml("openai-codex/valid");
    if (failure === "deleted") f.files.delete(path);
    if (failure === "unreadable")
      f.app.vault.read.mockRejectedValueOnce(
        new Error("private prompt sk-secret"),
      );
    if (failure === "missing frontmatter") f.file.content = "No YAML";
    if (failure === "invalid config")
      f.file.content =
        "---\ncontext_scope: invalid\noutput_destination: inline\n---\nPrompt";
    if (failure === "invalid YAML")
      vi.spyOn(obsidian, "parseYaml").mockImplementationOnce(() => {
        throw new Error("private prompt sk-secret");
      });
    if (failure === "null YAML")
      vi.spyOn(obsidian, "parseYaml").mockReturnValueOnce(null as any);
    if (failure === "array YAML")
      vi.spyOn(obsidian, "parseYaml").mockReturnValueOnce([] as any);
    if (failure === "scalar YAML")
      vi.spyOn(obsidian, "parseYaml").mockReturnValueOnce("secret" as any);
    await f.invoke();
    expectNoRun(f);
    expect(CustomProbeModal.prototype.openAndWait).not.toHaveBeenCalled();
    expect(f.notices).toHaveBeenCalled();
    expect(JSON.stringify(f.notices.mock.calls)).not.toMatch(
      /private prompt|sk-secret/,
    );
  });

  it.each([
    "content",
    "path",
    "editor",
    "active view",
    "unload",
    "template deleted",
    "template modified",
    "template renamed",
  ])("stops when %s changes during template read", async (change) => {
    const f = await fixture();
    const read = deferred<string>();
    f.app.vault.read.mockReturnValueOnce(read.promise);
    const running = f.invoke();
    if (change === "content")
      f.editor.getValue.mockReturnValue("Edited source");
    if (change === "path") f.view.file.path = "Other.md";
    if (change === "editor") f.view.editor = { ...f.editor };
    if (change === "active view")
      f.app.workspace.getActiveViewOfType.mockReturnValue({ ...f.view });
    if (change === "unload") f.manager.isDisposed = true;
    if (change === "template deleted") f.files.delete(path);
    if (change === "template modified") f.file.stat.mtime++;
    if (change === "template renamed") f.file.path = "Edu-Templates/Renamed.md";
    read.resolve(yaml());
    await running;
    expectNoRun(f);
    expect(CustomProbeModal.prototype.openAndWait).not.toHaveBeenCalled();
  });

  it("does not read or run a retained callback after unload", async () => {
    const f = await fixture();
    f.app.vault.read.mockClear();
    f.manager.isDisposed = true;
    await f.invoke();
    expect(f.app.vault.read).not.toHaveBeenCalled();
    expectNoRun(f);
  });

  it("uses the pre-read mtime snapshot so edits during registration are reconciled", async () => {
    const f = await fixture();
    f.file.stat.mtime = 2;
    f.file.content = yaml("openai-codex/first");
    const read = deferred<string>();
    f.app.vault.read.mockReturnValueOnce(read.promise);
    const reloading = f.registry.doReconcile();
    const oldContent = f.file.content;
    f.file.stat.mtime = 3;
    f.file.content = yaml("openai-codex/second");
    read.resolve(oldContent);
    await reloading;
    expect(f.registry.getRegisteredCommands().get(path)?.config.model).toBe(
      "openai-codex/first",
    );
    await f.registry.doReconcile();
    expect(f.registry.getRegisteredCommands().get(path)?.config.model).toBe(
      "openai-codex/second",
    );
  });

  it("catches registration read errors and does not register stale content", async () => {
    const f = await fixture();
    f.file.stat.mtime++;
    f.app.vault.read.mockRejectedValueOnce(
      new Error("sk-secret private prompt"),
    );
    await f.registry.doReconcile();
    expect(f.registry.getRegisteredCommands().size).toBe(0);
    expect(f.commands.size).toBe(0);
    expect(JSON.stringify(f.notices.mock.calls)).toContain(
      "could not read the template",
    );
    expect(JSON.stringify(f.notices.mock.calls)).not.toContain("sk-secret");
  });

  it("keeps command IDs, fresh names, and configured hotkeys when reloading", async () => {
    const f = await fixture();
    const id = [...f.commands.keys()][0];
    const hotkey = [{ modifiers: ["Mod", "Shift"], key: "C" }];
    // Obsidian's YAML parser returns nested structures (the test shim is scalar-only).
    vi.spyOn(obsidian, "parseYaml").mockReturnValueOnce({
      context_scope: "selection",
      output_destination: "inline",
      command_prefix: "Study",
      hotkey,
    });
    f.file.stat.mtime++;
    await f.registry.doReconcile();
    expect([...f.commands.keys()]).toEqual([id]);
    expect(f.commands.get(id)).toMatchObject({
      name: "Study: Clarify",
      hotkeys: hotkey,
    });
  });
});

describe("model source diagnostics through registered commands", () => {
  it("distinguishes invalid Pi settings from incompatible YAML without echoing models", async () => {
    const f = await fixture();
    f.file.content = yaml();
    f.settings.piModel = "sk-secret-invalid";
    await f.invoke();
    expectNoRun(f);
    expect(JSON.stringify(f.notices.mock.calls)).toContain(
      "Invalid Pi default model setting",
    );
    expect(JSON.stringify(f.notices.mock.calls)).not.toContain(
      "sk-secret-invalid",
    );
    f.notices.mockClear();
    f.settings.piModel = "openai-codex/gpt-5.5";
    f.file.content = yaml("sk-secret-override");
    await f.invoke();
    expectNoRun(f);
    expect(JSON.stringify(f.notices.mock.calls)).toContain(
      "template's model override",
    );
    expect(JSON.stringify(f.notices.mock.calls)).not.toContain(
      "sk-secret-override",
    );
  });

  it("uses the current Pi setting on each run without injecting defaults into config", async () => {
    const f = await fixture();
    f.file.content = yaml();
    f.file.stat.mtime++;
    await f.registry.doReconcile();
    expect(
      f.registry.getRegisteredCommands().get(path)?.config.model,
    ).toBeUndefined();
    await f.invoke();
    f.settings.piModel = "openai-codex/current";
    await f.invoke();
    expect(f.pi.mock.calls.map(([req]) => req.model)).toEqual([
      "openai-codex/gpt-5.5",
      "openai-codex/current",
    ]);
    expect(f.openrouter).not.toHaveBeenCalled();
  });
});

it("honors a refreshed OpenRouter override only when OpenRouter is explicitly selected", async () => {
  const f = await fixture();
  Object.assign(f.settings, {
    llmBackend: "openrouter",
    openRouterApiKey: "fake",
  });
  f.file.content = yaml("openrouter/current");
  await f.invoke();
  expect(f.openrouter).toHaveBeenCalledWith(
    expect.objectContaining({
      model: "openrouter/current",
      provider: "openrouter",
    }),
    expect.any(AbortSignal),
  );
  expect(f.pi).not.toHaveBeenCalled();
});

it("honors a valid explicit Pi override even when the unused Pi default is invalid", async () => {
  const f = await fixture();
  f.settings.piModel = "invalid-default";
  f.file.content = yaml("openai-codex/explicit");
  await f.invoke();
  expect(f.pi).toHaveBeenCalledWith(
    expect.objectContaining({ model: "openai-codex/explicit" }),
    expect.any(AbortSignal),
  );
  expect(f.openrouter).not.toHaveBeenCalled();
});

import { describe, it, expect, vi, beforeEach } from "vitest";
import { TemplateRegistry } from "../../src/templates/registry";
import { CustomProbeModal } from "../../src/ui/modal";
import { buildSkeleton } from "../../src/stream/callout";
import { findScholiaCalloutAt } from "../../src/stream/calloutParser";

interface MockFile {
  path: string;
  stat: { mtime: number };
  content?: string;
}

function createMockApp(
  files: Map<string, MockFile>,
  templatesFolder = "Edu-Templates",
  frontmatterByPath = new Map<string, Record<string, unknown>>(),
) {
  const commands: Map<string, { id: string; name: string }> = new Map();
  let getFileByPathCallCount = 0;

  return {
    vault: {
      templatesFolder,
      getFolderByPath: (path: string) => {
        if (path === templatesFolder) return { path };
        return null;
      },
      getMarkdownFiles: () => Array.from(files.values()),
      getFileByPath: (path: string) => {
        const file = files.get(path);
        if (!file) return null;
        getFileByPathCallCount++;
        return {
          path: file.path,
          stat: { mtime: file.stat.mtime + getFileByPathCallCount },
          content: file.content,
        } as MockFile;
      },
      read: async (file: MockFile) => file.content || "",
    },
    metadataCache: {
      getFileCache: (file: MockFile) => ({
        frontmatter: frontmatterByPath.get(file.path) ?? null,
      }),
    },
    commands: {
      addCommand: (cmd: { id: string; name: string }) => {
        commands.set(cmd.id, cmd);
      },
      removeCommand: (id: string) => {
        commands.delete(id);
      },
      getAllCommands: () => Array.from(commands.values()),
    },
    workspace: {
      on: vi.fn(),
      getActiveViewOfType: vi.fn(),
    },
    _commands: commands,
  };
}

const mockStreamManager = {
  addStream: vi.fn().mockReturnValue(true),
  removeStream: vi.fn(),
  handleEditorChange: vi.fn(),
};

describe("TemplateRegistry", () => {
  const createPlugin = (app: ReturnType<typeof createMockApp>, overrides = {}) => ({
    app: app as any,
    addCommand: (cmd: { id: string; name: string }) => {
      app._commands.set(cmd.id, cmd);
      return cmd;
    },
    settings: {
      templatesFolder: "Edu-Templates",
      defaultCalloutType: "ai",
      defaultModel: "test-model",
      defaultTemperature: 0.7,
      defaultMaxTokens: 1024,
      defaultReasoningEnabled: true,
      defaultReasoningEffort: "medium",
      centralCaptureFile: "_System/Central-Flashcards.md",
      enableHotReloadOfTemplates: true,
      showRunMetadata: true,
      ...overrides,
    },
  });

  describe("load", () => {
    it("loads no templates when folder does not exist", async () => {
      const app = createMockApp(new Map());
      app.vault.getFolderByPath = () => null;

      const registry = new TemplateRegistry(app as any, createPlugin(app), mockStreamManager as any);

      await registry.load();
      expect(registry.getRegisteredCommands().size).toBe(0);
    });

    it("loads a single valid template", async () => {
      const files = new Map<string, MockFile>();
      files.set("Edu-Templates/Clarify.md", {
        path: "Edu-Templates/Clarify.md",
        stat: { mtime: 1000 },
        content: `---\ncontext_scope: selection\noutput_destination: inline\n---\nYou are a tutor.`,
      });

      const app = createMockApp(files);

      const registry = new TemplateRegistry(app as any, createPlugin(app), mockStreamManager as any);

      await registry.load();

      const commands = registry.getRegisteredCommands();
      expect(commands.size).toBe(1);
      expect(commands.has("Edu-Templates/Clarify.md")).toBe(true);
      const cmd = app._commands.get(
        "scholia.template.Edu-Templates-Clarify.md",
      );
      expect(cmd).toBeDefined();
      expect(cmd?.name).toBe("Run: Clarify");
    });

    it("prefers metadata cache frontmatter over YAML fallback", async () => {
      const files = new Map<string, MockFile>();
      files.set("Edu-Templates/Clarify.md", {
        path: "Edu-Templates/Clarify.md",
        stat: { mtime: 1000 },
        content: `---\ncontext_scope: selection\noutput_destination: inline\nhotkey: []\n---\nYou are a tutor.`,
      });
      const frontmatterByPath = new Map<string, Record<string, unknown>>();
      frontmatterByPath.set("Edu-Templates/Clarify.md", {
        context_scope: "selection",
        output_destination: "inline",
        hotkey: [{ modifiers: ["Mod", "Shift"], key: "C" }],
      });

      const app = createMockApp(files, "Edu-Templates", frontmatterByPath);
      const registry = new TemplateRegistry(
        app as any,
        createPlugin(app),
        mockStreamManager as any,
      );

      await registry.load();

      const registered = registry
        .getRegisteredCommands()
        .get("Edu-Templates/Clarify.md");
      expect(registered?.config.hotkey).toEqual([
        { modifiers: ["Mod", "Shift"], key: "C" },
      ]);
    });

    it("skips invalid templates with missing frontmatter", async () => {
      const files = new Map<string, MockFile>();
      files.set("Edu-Templates/Bad.md", {
        path: "Edu-Templates/Bad.md",
        stat: { mtime: 1000 },
        content: `No frontmatter here`,
      });

      const app = createMockApp(files);

      const registry = new TemplateRegistry(app as any, createPlugin(app), mockStreamManager as any);

      await registry.load();
      expect(registry.getRegisteredCommands().size).toBe(0);
    });

    it("skips files outside templates folder", async () => {
      const files = new Map<string, MockFile>();
      files.set("Other/Clarify.md", {
        path: "Other/Clarify.md",
        stat: { mtime: 1000 },
        content: `---\ncontext_scope: selection\noutput_destination: inline\n---\nYou are a tutor.`,
      });

      const app = createMockApp(files);

      const registry = new TemplateRegistry(app as any, createPlugin(app), mockStreamManager as any);

      await registry.load();
      expect(registry.getRegisteredCommands().size).toBe(0);
    });
  });

  describe("reconcile - add", () => {
    it("adds new template on create", async () => {
      const files = new Map<string, MockFile>();
      files.set("Edu-Templates/Clarify.md", {
        path: "Edu-Templates/Clarify.md",
        stat: { mtime: 1000 },
        content: `---\ncontext_scope: selection\noutput_destination: inline\n---\nYou are a tutor.`,
      });

      const app = createMockApp(files);

      const registry = new TemplateRegistry(app as any, createPlugin(app), mockStreamManager as any);

      await registry.load();
      expect(registry.getRegisteredCommands().size).toBe(1);

      // Simulate adding a new file
      files.set("Edu-Templates/Flashcard.md", {
        path: "Edu-Templates/Flashcard.md",
        stat: { mtime: 2000 },
        content: `---\ncontext_scope: selection\noutput_destination: inline\ncallout_type: scholia-flashcard\n---\nMake a flashcard.`,
      });

      await registry.doReconcile();
      expect(registry.getRegisteredCommands().size).toBe(2);
      expect(
        registry.getRegisteredCommands().has("Edu-Templates/Flashcard.md"),
      ).toBe(true);
    });
  });

  describe("reconcile - modify", () => {
    it("reloads modified template", async () => {
      const files = new Map<string, MockFile>();
      files.set("Edu-Templates/Clarify.md", {
        path: "Edu-Templates/Clarify.md",
        stat: { mtime: 1000 },
        content: `---\ncontext_scope: selection\noutput_destination: inline\ntemperature: 0.5\n---\nYou are a tutor.`,
      });

      const app = createMockApp(files);

      const registry = new TemplateRegistry(app as any, createPlugin(app), mockStreamManager as any);

      await registry.load();

      // Verify initial temperature
      const initial = registry
        .getRegisteredCommands()
        .get("Edu-Templates/Clarify.md");
      expect(initial?.config.temperature).toBe(0.5);

      // Simulate file modification
      const file = files.get("Edu-Templates/Clarify.md")!;
      file.stat.mtime = 2000;
      file.content = `---\ncontext_scope: selection\noutput_destination: inline\ntemperature: 0.9\n---\nYou are a tutor.`;

      await registry.doReconcile();

      const updated = registry
        .getRegisteredCommands()
        .get("Edu-Templates/Clarify.md");
      expect(updated?.config.temperature).toBe(0.9);
    });
  });

  describe("reconcile - delete", () => {
    it("removes deleted template", async () => {
      const files = new Map<string, MockFile>();
      files.set("Edu-Templates/Clarify.md", {
        path: "Edu-Templates/Clarify.md",
        stat: { mtime: 1000 },
        content: `---\ncontext_scope: selection\noutput_destination: inline\n---\nYou are a tutor.`,
      });

      const app = createMockApp(files);

      const registry = new TemplateRegistry(app as any, createPlugin(app), mockStreamManager as any);

      await registry.load();
      expect(registry.getRegisteredCommands().size).toBe(1);

      // Simulate file deletion
      files.delete("Edu-Templates/Clarify.md");

      await registry.doReconcile();
      expect(registry.getRegisteredCommands().size).toBe(0);
    });
  });

  describe("reconcile - rename", () => {
    it("handles rename as delete + add", async () => {
      const files = new Map<string, MockFile>();
      files.set("Edu-Templates/OldName.md", {
        path: "Edu-Templates/OldName.md",
        stat: { mtime: 1000 },
        content: `---\ncontext_scope: selection\noutput_destination: inline\n---\nYou are a tutor.`,
      });

      const app = createMockApp(files);

      const registry = new TemplateRegistry(app as any, createPlugin(app), mockStreamManager as any);

      await registry.load();
      expect(
        registry.getRegisteredCommands().has("Edu-Templates/OldName.md"),
      ).toBe(true);

      // Simulate rename: delete old, add new
      files.delete("Edu-Templates/OldName.md");
      files.set("Edu-Templates/NewName.md", {
        path: "Edu-Templates/NewName.md",
        stat: { mtime: 2000 },
        content: `---\ncontext_scope: selection\noutput_destination: inline\n---\nYou are a tutor.`,
      });

      await registry.doReconcile();
      expect(
        registry.getRegisteredCommands().has("Edu-Templates/OldName.md"),
      ).toBe(false);
      expect(
        registry.getRegisteredCommands().has("Edu-Templates/NewName.md"),
      ).toBe(true);
    });
  });

  describe("handleCreate/Modify/Delete", () => {
    it("triggers reconcile on create", async () => {
      const files = new Map<string, MockFile>();

      const app = createMockApp(files);

      const registry = new TemplateRegistry(app as any, createPlugin(app), mockStreamManager as any);

      files.set("Edu-Templates/Clarify.md", {
        path: "Edu-Templates/Clarify.md",
        stat: { mtime: 1000 },
        content: `---\ncontext_scope: selection\noutput_destination: inline\n---\nYou are a tutor.`,
      });

      registry.handleCreate(files.get("Edu-Templates/Clarify.md") as any);

      // wait for debounce
      await new Promise((r) => setTimeout(r, 400));

      expect(registry.getRegisteredCommands().size).toBe(1);
    });

    it("triggers reconcile on modify", async () => {
      const files = new Map<string, MockFile>();
      files.set("Edu-Templates/Clarify.md", {
        path: "Edu-Templates/Clarify.md",
        stat: { mtime: 1000 },
        content: `---\ncontext_scope: selection\noutput_destination: inline\n---\nYou are a tutor.`,
      });

      const app = createMockApp(files);

      const registry = new TemplateRegistry(app as any, createPlugin(app), mockStreamManager as any);

      await registry.load();
      expect(registry.getRegisteredCommands().size).toBe(1);

      const file = files.get("Edu-Templates/Clarify.md")!;
      file.stat.mtime = 2000;

      registry.handleModify(file as any);
      await new Promise((r) => setTimeout(r, 400));

      expect(registry.getRegisteredCommands().size).toBe(1);
    });

    it("removes template on delete", async () => {
      const files = new Map<string, MockFile>();
      files.set("Edu-Templates/Clarify.md", {
        path: "Edu-Templates/Clarify.md",
        stat: { mtime: 1000 },
        content: `---\ncontext_scope: selection\noutput_destination: inline\n---\nYou are a tutor.`,
      });

      const app = createMockApp(files);

      const registry = new TemplateRegistry(app as any, createPlugin(app), mockStreamManager as any);

      await registry.load();
      expect(registry.getRegisteredCommands().size).toBe(1);

      registry.handleDelete(files.get("Edu-Templates/Clarify.md") as any);
      expect(registry.getRegisteredCommands().size).toBe(0);
    });

    it("skips hot reload handlers when the setting is disabled", async () => {
      const files = new Map<string, MockFile>();
      const app = createMockApp(files);
      const registry = new TemplateRegistry(
        app as any,
        createPlugin(app, { enableHotReloadOfTemplates: false }),
        mockStreamManager as any,
      );

      files.set("Edu-Templates/Clarify.md", {
        path: "Edu-Templates/Clarify.md",
        stat: { mtime: 1000 },
        content: `---\ncontext_scope: selection\noutput_destination: inline\n---\nYou are a tutor.`,
      });

      registry.handleCreate(files.get("Edu-Templates/Clarify.md") as any);
      await new Promise((r) => setTimeout(r, 400));

      expect(registry.getRegisteredCommands().size).toBe(0);
    });
  });

  describe("command execution regressions", () => {
    it("allows custom probe to override selection scope without an initial selection", async () => {
      const files = new Map<string, MockFile>();
      const app = createMockApp(files);
      const view = {
        file: { path: "Reading/Note.md" },
        editor: {
          getSelection: () => "",
          getValue: () => "# Heading\n\nBody",
          getCursor: () => ({ line: 0, ch: 0 }),
          getLine: () => "# Heading",
          replaceRange: vi.fn(),
          posToOffset: () => 0,
          offsetToPos: () => ({ line: 0, ch: 0 }),
        },
      };
      app.workspace.getActiveViewOfType = vi.fn(() => view);

      const registry = new TemplateRegistry(
        app as any,
        createPlugin(app, { openRouterApiKey: "test-key" }),
        mockStreamManager as any,
      );
      const runAppend = vi
        .spyOn(registry as any, "runAppend")
        .mockResolvedValue(undefined);
      vi.spyOn(CustomProbeModal.prototype, "openAndWait").mockResolvedValue({
        query: "Explain this section",
        scope: "full-note",
        alsoAppendToCentral: false,
        reasoningEnabled: true,
        reasoningEffort: "medium",
        tokenBudget: 1024,
      });

      await (registry as any).runTemplateCommand(
        "Edu-Templates/Probe.md",
        {
          contextScope: "selection",
          outputDestination: "_System/Log.md",
          customProbe: true,
          requiresSelection: false,
          systemPrompt: "prompt",
        },
        "Probe",
      );

      expect(runAppend).toHaveBeenCalledOnce();
    });

    it("does not insert a skeleton when the stream cap is exceeded", async () => {
      const files = new Map<string, MockFile>();
      const app = createMockApp(files);
      const registry = new TemplateRegistry(
        app as any,
        createPlugin(app),
        {
          ...mockStreamManager,
          addStream: vi.fn().mockReturnValue(false),
        } as any,
      );

      const content = "Selected text";
      const editor = {
        value: content,
        getCursor: () => ({ line: 0, ch: content.length }),
        getLine: () => content,
        replaceRange(this: { value: string }, text: string) {
          this.value += text;
        },
        getValue(this: { value: string }) {
          return this.value;
        },
        posToOffset: () => content.length,
        offsetToPos: () => ({ line: 0, ch: content.length }),
      };
      const view = { file: { path: "Reading/Note.md" } };

      await (registry as any).runInline(
        "Edu-Templates/Clarify.md",
        "Clarify",
        {
          contextScope: "selection",
          outputDestination: "inline",
          systemPrompt: "prompt",
        },
        view,
        editor,
        "Selected text",
        {} as any,
        {} as any,
      );

      expect(editor.getValue()).toBe(content);
    });

    it("uses an hourglass callout while streaming and restores the final type", async () => {
      const files = new Map<string, MockFile>();
      const app = createMockApp(files);
      const registry = new TemplateRegistry(
        app as any,
        createPlugin(app),
        mockStreamManager as any,
      );

      const editor = {
        value: "Selected text",
        getCursor: () => ({ line: 0, ch: "Selected text".length }),
        getLine: () => "Selected text",
        replaceRange(this: { value: string }, text: string, start: { line: number; ch: number }, end?: { line: number; ch: number }) {
          const startOffset = this.posToOffset(start);
          const endOffset = end ? this.posToOffset(end) : startOffset;
          this.value =
            this.value.slice(0, startOffset) + text + this.value.slice(endOffset);
        },
        getValue(this: { value: string }) {
          return this.value;
        },
        posToOffset(this: { value: string }, pos: { line: number; ch: number }) {
          const lines = this.value.split("\n");
          let offset = 0;
          for (let i = 0; i < pos.line && i < lines.length; i++) {
            offset += lines[i].length + 1;
          }
          return offset + pos.ch;
        },
        offsetToPos(this: { value: string }, offset: number) {
          const lines = this.value.slice(0, offset).split("\n");
          return { line: lines.length - 1, ch: lines[lines.length - 1].length };
        },
      };
      const view = { file: { path: "Reading/Note.md" } };
      const sequence: string[] = [];
      const llmClient = {
        stream: async function* () {
          sequence.push(editor.getValue());
          yield { type: "content", text: "Answer" };
        },
      };

      await (registry as any).runInline(
        "Edu-Templates/Clarify.md",
        "Clarify",
        {
          contextScope: "selection",
          outputDestination: "inline",
          calloutType: "scholia-clarify",
          calloutLabel: "AI Clarification",
          systemPrompt: "prompt",
        },
        view,
        editor,
        "Selected text",
        llmClient as any,
        {} as any,
      );

      expect(sequence[0]).toContain("[!scholia-pending]-");
      expect(editor.getValue()).toContain("[!scholia-clarify]-");
      expect(editor.getValue()).toContain("Answer");
    });

    it("passes the custom probe query into inline skeleton rendering", async () => {
      const files = new Map<string, MockFile>();
      const app = createMockApp(files);
      const view = {
        file: { path: "Reading/Note.md" },
        editor: {
          getSelection: () => "",
          getValue: () => "# Heading\n\nBody",
          getCursor: () => ({ line: 0, ch: 0 }),
          getLine: () => "# Heading",
          replaceRange: vi.fn(),
          posToOffset: () => 0,
          offsetToPos: () => ({ line: 0, ch: 0 }),
        },
      };
      app.workspace.getActiveViewOfType = vi.fn(() => view);
      const registry = new TemplateRegistry(
        app as any,
        createPlugin(app, { openRouterApiKey: "test-key" }),
        mockStreamManager as any,
      );
      const runInline = vi
        .spyOn(registry as any, "runInline")
        .mockResolvedValue(undefined);
      vi.spyOn(CustomProbeModal.prototype, "openAndWait").mockResolvedValue({
        query: "Why does this matter?\nUse plain language.",
        scope: "full-note",
        alsoAppendToCentral: false,
        reasoningEnabled: true,
        reasoningEffort: "medium",
        tokenBudget: 1024,
      });

      await (registry as any).runTemplateCommand(
        "Edu-Templates/Probe.md",
        {
          contextScope: "full-note",
          outputDestination: "inline",
          customProbe: true,
          requiresSelection: false,
          systemPrompt: "prompt",
        },
        "Probe",
      );

      expect(runInline).toHaveBeenCalledOnce();
      expect(runInline.mock.calls[0][8]).toBe(
        "Why does this matter?\nUse plain language.",
      );
    });

    it("renders the custom probe query in the inserted inline skeleton", async () => {
      const files = new Map<string, MockFile>();
      const app = createMockApp(files);
      const editor = {
        value: "Selected text",
        getValue(this: { value: string }) {
          return this.value;
        },
        getCursor: () => ({ line: 0, ch: 0 }),
        getLine: () => "Selected text",
        replaceRange(
          this: { value: string },
          text: string,
          start: { line: number; ch: number },
          end?: { line: number; ch: number },
        ) {
          const startOffset = this.posToOffset(start);
          const endOffset = end ? this.posToOffset(end) : startOffset;
          this.value =
            this.value.slice(0, startOffset) +
            text +
            this.value.slice(endOffset);
        },
        posToOffset(
          this: { value: string },
          pos: { line: number; ch: number },
        ) {
          const lines = this.value.split("\n");
          let offset = 0;
          for (let i = 0; i < pos.line && i < lines.length; i++) {
            offset += lines[i].length + 1;
          }
          return offset + pos.ch;
        },
        offsetToPos(this: { value: string }, offset: number) {
          const lines = this.value.slice(0, offset).split("\n");
          return { line: lines.length - 1, ch: lines[lines.length - 1].length };
        },
      };
      const view = { file: { path: "Reading/Note.md" } };
      const registry = new TemplateRegistry(
        app as any,
        createPlugin(app),
        mockStreamManager as any,
      );
      const llmClient = {
        stream: async function* () {
          yield { type: "content", text: "Answer" };
        },
      };

      await (registry as any).runInline(
        "Edu-Templates/Probe.md",
        "Probe",
        {
          contextScope: "selection",
          outputDestination: "inline",
          systemPrompt: "prompt",
        },
        view,
        editor,
        "Selected text",
        llmClient as any,
        {} as any,
        "Why does this matter?\nUse plain language.",
      );

      expect(editor.getValue()).toContain("**Question:** Why does this matter?");
      expect(editor.getValue()).toContain("> Use plain language.");
      expect(editor.getValue()).toContain("**Response:**");
      expect(editor.getValue()).toContain("Answer");
    });

    it("appends chat follow-ups inside an existing generated callout", async () => {
      const files = new Map<string, MockFile>();
      const app = createMockApp(files);
      const registry = new TemplateRegistry(
        app as any,
        createPlugin(app),
        mockStreamManager as any,
      );
      const skeleton = buildSkeleton({
        calloutType: "ai",
        calloutLabel: "Probe",
        folded: true,
        commandName: "Probe",
        selectionText: "Original context",
        questionText: "Original question?",
        runSnapshot: {
          id: "scholia-test",
          schemaVersion: 1,
          templatePath: "Edu-Templates/Probe.md",
          templateName: "Probe",
          sourcePath: "Reading/Note.md",
          question: "Original question?",
          contextScope: "heading",
          model: "test-model",
          temperature: 0.7,
          maxTokens: 1024,
          reasoningEnabled: true,
          reasoningEffort: "medium",
          calloutType: "ai",
          calloutLabel: "Probe",
          calloutFolded: true,
          outputDestination: "inline",
          createdAt: "2026-05-03T00:00:00.000Z",
        },
      });
      const editor = {
        value: `# Note${skeleton}Original answer\n> \n> **Metadata:** model=test`,
        getValue(this: { value: string }) {
          return this.value;
        },
        getCursor() {
          return this.offsetToPos(this.value.indexOf("Original answer"));
        },
        getLine(this: { value: string }, line: number) {
          return this.value.split("\n")[line] ?? "";
        },
        replaceRange(
          this: { value: string },
          text: string,
          start: { line: number; ch: number },
          end?: { line: number; ch: number },
        ) {
          const startOffset = this.posToOffset(start);
          const endOffset = end ? this.posToOffset(end) : startOffset;
          this.value =
            this.value.slice(0, startOffset) +
            text +
            this.value.slice(endOffset);
        },
        posToOffset(
          this: { value: string },
          pos: { line: number; ch: number },
        ) {
          const lines = this.value.split("\n");
          let offset = 0;
          for (let i = 0; i < pos.line && i < lines.length; i++) {
            offset += lines[i].length + 1;
          }
          return offset + pos.ch;
        },
        offsetToPos(this: { value: string }, offset: number) {
          const lines = this.value.slice(0, offset).split("\n");
          return { line: lines.length - 1, ch: lines[lines.length - 1].length };
        },
      };
      const parsed = findScholiaCalloutAt(editor as any);
      const view = { file: { path: "Reading/Note.md" } };
      let sentUserMessage = "";
      const llmClient = {
        stream: async function* (request: { user: string }) {
          sentUserMessage = request.user;
          yield { type: "content", text: "Follow-up answer" };
        },
      };

      await (registry as any).runChatFollowup(
        "Probe",
        {
          contextScope: "heading",
          outputDestination: "inline",
          systemPrompt: "prompt",
        },
        view,
        editor,
        parsed,
        llmClient as any,
        {
          model: "test-model",
          temperature: 0.7,
          maxTokens: 1024,
          reasoningEnabled: true,
          reasoningEffort: "medium",
          system: "prompt\n\nUser request: Follow-up question?",
          user: "context and history",
        },
        "Follow-up question?",
      );

      expect(editor.getValue()).toContain("[!ai]-");
      expect(editor.getValue()).toContain("> ---");
      expect(editor.getValue()).toContain("**Follow-up:** Follow-up question?");
      expect(editor.getValue()).toContain("Follow-up answer");
      expect(sentUserMessage).toBe("context and history");
    });
  });
});

import { describe, it, expect, vi, beforeEach } from "vitest";
import { TemplateRegistry } from "../../src/templates/registry";

interface MockFile {
  path: string;
  stat: { mtime: number };
  content?: string;
}

function createMockApp(
  files: Map<string, MockFile>,
  templatesFolder = "Edu-Templates",
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
    },
    _commands: commands,
  };
}

describe("TemplateRegistry", () => {
  const createPlugin = (overrides = {}) => ({
    app: null as any,
    settings: {
      templatesFolder: "Edu-Templates",
      defaultCalloutType: "ai",
      defaultModel: "test-model",
      defaultTemperature: 0.7,
      defaultMaxTokens: 1024,
      ...overrides,
    },
  });

  describe("load", () => {
    it("loads no templates when folder does not exist", async () => {
      const app = createMockApp(new Map());
      app.vault.getFolderByPath = () => null;

      const registry = new TemplateRegistry(
        app as any,
        createPlugin(),
        vi.fn(),
      );

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

      const registry = new TemplateRegistry(
        app as any,
        createPlugin(),
        vi.fn(),
      );

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

    it("skips invalid templates with missing frontmatter", async () => {
      const files = new Map<string, MockFile>();
      files.set("Edu-Templates/Bad.md", {
        path: "Edu-Templates/Bad.md",
        stat: { mtime: 1000 },
        content: `No frontmatter here`,
      });

      const app = createMockApp(files);

      const registry = new TemplateRegistry(
        app as any,
        createPlugin(),
        vi.fn(),
      );

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

      const registry = new TemplateRegistry(
        app as any,
        createPlugin(),
        vi.fn(),
      );

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

      const registry = new TemplateRegistry(
        app as any,
        createPlugin(),
        vi.fn(),
      );

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

      const registry = new TemplateRegistry(
        app as any,
        createPlugin(),
        vi.fn(),
      );

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

      const registry = new TemplateRegistry(
        app as any,
        createPlugin(),
        vi.fn(),
      );

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

      const registry = new TemplateRegistry(
        app as any,
        createPlugin(),
        vi.fn(),
      );

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

      const registry = new TemplateRegistry(
        app as any,
        createPlugin(),
        vi.fn(),
      );

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

      const registry = new TemplateRegistry(
        app as any,
        createPlugin(),
        vi.fn(),
      );

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

      const registry = new TemplateRegistry(
        app as any,
        createPlugin(),
        vi.fn(),
      );

      await registry.load();
      expect(registry.getRegisteredCommands().size).toBe(1);

      registry.handleDelete(files.get("Edu-Templates/Clarify.md") as any);
      expect(registry.getRegisteredCommands().size).toBe(0);
    });
  });
});

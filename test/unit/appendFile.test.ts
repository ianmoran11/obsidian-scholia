import { describe, it, expect, beforeEach } from "vitest";
import { appendToVault } from "../../src/storage/appendFile";

interface MockFile {
  path: string;
  stat: { mtime: number };
  content: string;
}

interface MockVault {
  folders: Set<string>;
  files: Map<string, MockFile>;
  getFolderByPath: (path: string) => { path: string } | null;
  getFileByPath: (path: string) => MockFile | null;
  read: (file: MockFile) => Promise<string>;
  createFolder: (path: string) => Promise<void>;
  create: (path: string, content: string) => Promise<MockFile>;
  modify: (file: MockFile, content: string) => Promise<void>;
}

function createMockVault(): MockVault {
  const folders = new Set<string>();
  const files = new Map<string, MockFile>();

  return {
    folders,
    files,
    getFolderByPath: (path: string) => {
      const folder = folders.has(path) ? { path } : null;
      return folder;
    },
    getFileByPath: (path: string) => {
      return files.get(path) ?? null;
    },
    read: async (file: MockFile) => {
      return file.content;
    },
    createFolder: async (path: string) => {
      folders.add(path);
    },
    create: async (path: string, content: string) => {
      const file: MockFile = {
        path,
        stat: { mtime: Date.now() },
        content,
      };
      files.set(path, file);
      return file;
    },
    modify: async (file: MockFile, content: string) => {
      file.content = content;
      file.stat.mtime = Date.now();
    },
  };
}

describe("storage.appendFile", () => {
  let vault: MockVault;

  beforeEach(() => {
    vault = createMockVault();
  });

  describe("appendToVault markdown format", () => {
    it("creates file with header if it does not exist", async () => {
      await appendToVault(vault as never, {
        relativePath: "_System/Captures.md",
        content: "Test capture content",
        format: "markdown",
        sourcePath: "Reading/Note.md",
        templateName: "Clarify",
      });

      const file = vault.getFileByPath("_System/Captures.md");
      expect(file).not.toBeNull();
      expect(file?.content).toContain("# Captures");
      expect(file?.content).toContain("<!-- scholia:captured:");
      expect(file?.content).toContain(":Note -->");
      expect(file?.content).toContain("Test capture content");
    });

    it("appends to existing file with markdown format", async () => {
      vault.files.set("_System/Captures.md", {
        path: "_System/Captures.md",
        stat: { mtime: Date.now() },
        content: "# Captures\n\nPrevious entry",
      });

      await appendToVault(vault as never, {
        relativePath: "_System/Captures.md",
        content: "New capture content",
        format: "markdown",
        sourcePath: "Reading/Note.md",
        templateName: "Clarify",
      });

      const file = vault.getFileByPath("_System/Captures.md");
      expect(file?.content).toContain("Previous entry");
      expect(file?.content).toContain("New capture content");
      expect(file?.content).toContain("<!-- scholia:captured:");
    });

    it("auto-creates parent folders when they do not exist", async () => {
      await appendToVault(vault as never, {
        relativePath: "_System/Subfolder/Captures.md",
        content: "Content in nested folder",
        format: "markdown",
      });

      expect(vault.folders.has("_System")).toBe(true);
      expect(vault.folders.has("_System/Subfolder")).toBe(true);
      const file = vault.getFileByPath("_System/Subfolder/Captures.md");
      expect(file).not.toBeNull();
    });

    it("does not duplicate folders if parent already exists", async () => {
      vault.folders.add("_System");

      await appendToVault(vault as never, {
        relativePath: "_System/Captures.md",
        content: "Content",
        format: "markdown",
      });

      expect(vault.folders.has("_System")).toBe(true);
    });

    it("handles top-level file without parent folders", async () => {
      await appendToVault(vault as never, {
        relativePath: "Captures.md",
        content: "Top level content",
        format: "markdown",
      });

      const file = vault.getFileByPath("Captures.md");
      expect(file).not.toBeNull();
      expect(file?.content).toContain("Top level content");
    });
  });

  describe("appendToVault json-line format", () => {
    it("creates file with single json-line entry", async () => {
      await appendToVault(vault as never, {
        relativePath: "_System/Captures.jsonl",
        content: "JSON capture content",
        format: "json-line",
        sourcePath: "Reading/Note.md",
        templateName: "Flashcard",
      });

      const file = vault.getFileByPath("_System/Captures.jsonl");
      expect(file).not.toBeNull();
      const parsed = JSON.parse(file!.content.trim());
      expect(parsed.ts).toBeDefined();
      expect(parsed.source).toBe("Reading/Note.md");
      expect(parsed.template).toBe("Flashcard");
      expect(parsed.content).toBe("JSON capture content");
    });

    it("appends json-line to existing file", async () => {
      vault.files.set("_System/Captures.jsonl", {
        path: "_System/Captures.jsonl",
        stat: { mtime: Date.now() },
        content:
          '{"ts":"2024-01-01T00:00:00.000Z","source":"Old.md","template":"T","content":"Old"}',
      });

      await appendToVault(vault as never, {
        relativePath: "_System/Captures.jsonl",
        content: "New content",
        format: "json-line",
        sourcePath: "Reading/Note.md",
        templateName: "Flashcard",
      });

      const file = vault.getFileByPath("_System/Captures.jsonl");
      const lines = file!.content.trim().split("\n");
      expect(lines).toHaveLength(2);
      expect(JSON.parse(lines[0]).content).toBe("Old");
      expect(JSON.parse(lines[1]).content).toBe("New content");
    });

    it("auto-creates parent folders for json-line", async () => {
      await appendToVault(vault as never, {
        relativePath: "_Logs/Data.jsonl",
        content: "Log entry",
        format: "json-line",
      });

      expect(vault.folders.has("_Logs")).toBe(true);
      const file = vault.getFileByPath("_Logs/Data.jsonl");
      expect(file).not.toBeNull();
    });
  });

  describe("appendToVault edge cases", () => {
    it("handles empty content", async () => {
      await appendToVault(vault as never, {
        relativePath: "Captures.md",
        content: "",
        format: "markdown",
      });

      const file = vault.getFileByPath("Captures.md");
      expect(file).not.toBeNull();
      expect(file?.content).toContain("<!-- scholia:captured:");
    });

    it("handles content with newlines in markdown format", async () => {
      await appendToVault(vault as never, {
        relativePath: "Captures.md",
        content: "Line 1\nLine 2\nLine 3",
        format: "markdown",
      });

      const file = vault.getFileByPath("Captures.md");
      expect(file?.content).toContain("Line 1");
      expect(file?.content).toContain("Line 2");
      expect(file?.content).toContain("Line 3");
    });

    it("uses empty string for sourcePath when not provided", async () => {
      await appendToVault(vault as never, {
        relativePath: "Captures.md",
        content: "Content",
        format: "markdown",
      });

      const file = vault.getFileByPath("Captures.md");
      expect(file?.content).toContain("scholia:captured:");
    });

    it("uses empty string for templateName when not provided", async () => {
      await appendToVault(vault as never, {
        relativePath: "Captures.jsonl",
        content: "Content",
        format: "json-line",
      });

      const file = vault.getFileByPath("Captures.jsonl");
      const parsed = JSON.parse(file!.content.trim());
      expect(parsed.template).toBe("");
    });
  });
});

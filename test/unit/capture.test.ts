import { describe, it, expect, beforeEach, vi } from "vitest";
import { CaptureRunner } from "../../src/commands/capture";
import type { OpenRouterClient } from "../../src/llm/openrouter";
import type { LlmRequest, LlmStreamEvent } from "../../src/llm/client";
import type { TemplateConfig } from "../../src/templates/types";

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

function createMockApp(vault: MockVault) {
  return {
    vault,
  } as unknown as { vault: MockVault };
}

function createMockLlmClient(chunks: string[], shouldThrow?: boolean) {
  return {
    stream: async function* (
      _req: LlmRequest,
      _signal: AbortSignal,
    ): AsyncGenerator<LlmStreamEvent> {
      if (shouldThrow) {
        throw new Error("Stream error");
      }
      for (const chunk of chunks) {
        yield { type: "content", text: chunk };
      }
    },
  } as unknown as OpenRouterClient;
}

function createAbortSignal(): AbortSignal {
  return new AbortController().signal;
}

describe("commands.capture CaptureRunner", () => {
  let vault: MockVault;
  let mockApp: { vault: MockVault };

  beforeEach(() => {
    vault = createMockVault();
    mockApp = createMockApp(vault);
  });

  describe("runWithCapture markdown format", () => {
    it("accumulates streamed content and appends on success", async () => {
      const runner = new CaptureRunner(mockApp as never);
      const chunks = ["Hello ", "world!"];
      const llmClient = createMockLlmClient(chunks);
      const onChunk = vi.fn();

      const config: TemplateConfig = {
        name: "Test",
        filePath: "Test.md",
        contextScope: "selection",
        outputDestination: "inline",
        alsoAppendTo: "_System/Captures.md",
        appendFormat: "markdown",
        requiresSelection: true,
        commandPrefix: "Run",
        hotkey: [],
      };

      await runner.runWithCapture(
        llmClient,
        {} as LlmRequest,
        config,
        createAbortSignal(),
        onChunk,
        "Reading/Note.md",
        "Test",
      );

      expect(onChunk).toHaveBeenCalledTimes(2);
      expect(onChunk).toHaveBeenCalledWith("Hello ");
      expect(onChunk).toHaveBeenCalledWith("world!");

      const file = vault.getFileByPath("_System/Captures.md");
      expect(file).not.toBeNull();
      expect(file?.content).toContain("Hello world!");
      expect(file?.content).toContain("<!-- scholia:captured:");
      expect(file?.content).toContain(":Note -->");
    });

    it("creates file with header when appending markdown to new file", async () => {
      const runner = new CaptureRunner(mockApp as never);
      const llmClient = createMockLlmClient(["Captured content"]);
      const onChunk = vi.fn();

      const config: TemplateConfig = {
        name: "Flashcard",
        filePath: "Flashcard.md",
        contextScope: "selection",
        outputDestination: "inline",
        alsoAppendTo: "_System/Central-Flashcards.md",
        appendFormat: "markdown",
        requiresSelection: true,
        commandPrefix: "Run",
        hotkey: [],
      };

      await runner.runWithCapture(
        llmClient,
        {} as LlmRequest,
        config,
        createAbortSignal(),
        onChunk,
        "Reading/Chapter.md",
        "Flashcard",
      );

      const file = vault.getFileByPath("_System/Central-Flashcards.md");
      expect(file).not.toBeNull();
      expect(file?.content).toContain("# Captures");
      expect(file?.content).toContain("Captured content");
      expect(file?.content).toContain("<!-- scholia:captured:");
      expect(file?.content).toContain(":Chapter -->");
    });

    it("includes the custom probe question in markdown captures", async () => {
      const runner = new CaptureRunner(mockApp as never);
      const llmClient = createMockLlmClient(["Captured answer"]);
      const config: TemplateConfig = {
        name: "Probe",
        filePath: "Probe.md",
        contextScope: "full-note",
        outputDestination: "inline",
        alsoAppendTo: "_System/Captures.md",
        appendFormat: "markdown",
        requiresSelection: false,
        commandPrefix: "Run",
        hotkey: [],
      };

      await runner.runWithCapture(
        llmClient,
        {} as LlmRequest,
        config,
        createAbortSignal(),
        vi.fn(),
        "Reading/Note.md",
        "Probe",
        "What should I remember?",
      );

      const file = vault.getFileByPath("_System/Captures.md");
      expect(file?.content).toContain("**Question:** What should I remember?");
      expect(file?.content).toContain("Captured answer");
    });

    it("appends to existing markdown file without duplicating header", async () => {
      vault.files.set("_System/Central-Flashcards.md", {
        path: "_System/Central-Flashcards.md",
        stat: { mtime: Date.now() },
        content:
          "# Captures\n\n<!-- scholia:captured:2024-01-01T00:00:00.000Z:Old -->Old content",
      });

      const runner = new CaptureRunner(mockApp as never);
      const llmClient = createMockLlmClient(["New flashcard content"]);
      const onChunk = vi.fn();

      const config: TemplateConfig = {
        name: "Flashcard",
        filePath: "Flashcard.md",
        contextScope: "selection",
        outputDestination: "inline",
        alsoAppendTo: "_System/Central-Flashcards.md",
        appendFormat: "markdown",
        requiresSelection: true,
        commandPrefix: "Run",
        hotkey: [],
      };

      await runner.runWithCapture(
        llmClient,
        {} as LlmRequest,
        config,
        createAbortSignal(),
        onChunk,
        "Reading/Note.md",
        "Flashcard",
      );

      const file = vault.getFileByPath("_System/Central-Flashcards.md");
      expect(file?.content).toContain("Old content");
      expect(file?.content).toContain("New flashcard content");
    });
  });

  describe("runWithCapture json-line format", () => {
    it("appends json-line entry on success", async () => {
      const runner = new CaptureRunner(mockApp as never);
      const llmClient = createMockLlmClient(["Flashcard Q and A"]);
      const onChunk = vi.fn();

      const config: TemplateConfig = {
        name: "Flashcard",
        filePath: "Flashcard.md",
        contextScope: "selection",
        outputDestination: "inline",
        alsoAppendTo: "_System/Captures.jsonl",
        appendFormat: "json-line",
        requiresSelection: true,
        commandPrefix: "Run",
        hotkey: [],
      };

      await runner.runWithCapture(
        llmClient,
        {} as LlmRequest,
        config,
        createAbortSignal(),
        onChunk,
        "Reading/Note.md",
        "Flashcard",
      );

      const file = vault.getFileByPath("_System/Captures.jsonl");
      expect(file).not.toBeNull();
      const parsed = JSON.parse(file!.content.trim());
      expect(parsed.ts).toBeDefined();
      expect(parsed.source).toBe("Reading/Note.md");
      expect(parsed.template).toBe("Flashcard");
      expect(parsed.content).toBe("Flashcard Q and A");
      expect(parsed.metadata.model).toBeUndefined();
    });

    it("records metadata in json-line captures when the stream reports usage", async () => {
      const runner = new CaptureRunner(mockApp as never);
      const llmClient = {
        stream: async function* (): AsyncGenerator<LlmStreamEvent> {
          yield { type: "content", text: "Answer" };
          yield {
            type: "metadata",
            usage: { promptTokens: 8, completionTokens: 4, totalTokens: 12 },
            cost: { amount: 0.0001, currency: "USD", estimated: false },
          };
        },
      } as unknown as OpenRouterClient;

      const config: TemplateConfig = {
        name: "Test",
        filePath: "Test.md",
        contextScope: "heading",
        outputDestination: "inline",
        alsoAppendTo: "_System/Captures.jsonl",
        appendFormat: "json-line",
        requiresSelection: false,
        commandPrefix: "Run",
        hotkey: [],
      };

      await runner.runWithCapture(
        llmClient,
        {
          model: "z-ai/glm-5.1",
          temperature: 0.7,
          maxTokens: 30000,
          reasoningEnabled: true,
          reasoningEffort: "medium",
          system: "system",
          user: "user",
        },
        config,
        createAbortSignal(),
        vi.fn(),
        "Reading/Note.md",
        "Test",
      );

      const parsed = JSON.parse(vault.getFileByPath("_System/Captures.jsonl")!.content.trim());
      expect(parsed.metadata.totalTokens).toBe(12);
      expect(parsed.metadata.cost.amount).toBe(0.0001);
      expect(parsed.metadata.provider).toBe("openrouter");
    });

    it("appends to existing json-line file", async () => {
      vault.files.set("_System/Captures.jsonl", {
        path: "_System/Captures.jsonl",
        stat: { mtime: Date.now() },
        content:
          '{"ts":"2024-01-01T00:00:00.000Z","source":"Old.md","template":"T","content":"Old"}\n',
      });

      const runner = new CaptureRunner(mockApp as never);
      const llmClient = createMockLlmClient(["New entry"]);
      const onChunk = vi.fn();

      const config: TemplateConfig = {
        name: "Test",
        filePath: "Test.md",
        contextScope: "selection",
        outputDestination: "inline",
        alsoAppendTo: "_System/Captures.jsonl",
        appendFormat: "json-line",
        requiresSelection: true,
        commandPrefix: "Run",
        hotkey: [],
      };

      await runner.runWithCapture(
        llmClient,
        {} as LlmRequest,
        config,
        createAbortSignal(),
        onChunk,
        "Reading/Note.md",
        "Test",
      );

      const file = vault.getFileByPath("_System/Captures.jsonl");
      const lines = file!.content
        .trim()
        .split("\n")
        .filter((l) => l.length > 0);
      expect(lines).toHaveLength(2);
      expect(JSON.parse(lines[0]).content).toBe("Old");
      expect(JSON.parse(lines[1]).content).toBe("New entry");
    });

    it("creates new json-line file without header", async () => {
      const runner = new CaptureRunner(mockApp as never);
      const llmClient = createMockLlmClient(["Entry content"]);
      const onChunk = vi.fn();

      const config: TemplateConfig = {
        name: "Test",
        filePath: "Test.md",
        contextScope: "selection",
        outputDestination: "inline",
        alsoAppendTo: "Captures.jsonl",
        appendFormat: "json-line",
        requiresSelection: true,
        commandPrefix: "Run",
        hotkey: [],
      };

      await runner.runWithCapture(
        llmClient,
        {} as LlmRequest,
        config,
        createAbortSignal(),
        onChunk,
        "Reading/Note.md",
        "Test",
      );

      const file = vault.getFileByPath("Captures.jsonl");
      expect(file).not.toBeNull();
      expect(file?.content).not.toContain("# Captures");
      const parsed = JSON.parse(file!.content.trim());
      expect(parsed.content).toBe("Entry content");
    });

    it("includes the custom probe question in json-line captures", async () => {
      const runner = new CaptureRunner(mockApp as never);
      const llmClient = createMockLlmClient(["Entry answer"]);
      const config: TemplateConfig = {
        name: "Probe",
        filePath: "Probe.md",
        contextScope: "full-note",
        outputDestination: "inline",
        alsoAppendTo: "Captures.jsonl",
        appendFormat: "json-line",
        requiresSelection: false,
        commandPrefix: "Run",
        hotkey: [],
      };

      await runner.runWithCapture(
        llmClient,
        {} as LlmRequest,
        config,
        createAbortSignal(),
        vi.fn(),
        "Reading/Note.md",
        "Probe",
        "Why does it matter?",
      );

      const parsed = JSON.parse(vault.getFileByPath("Captures.jsonl")!.content.trim());
      expect(parsed.question).toBe("Why does it matter?");
      expect(parsed.content).toBe("Entry answer");
    });
  });

  describe("runWithCapture error path", () => {
    it("does not append to vault when stream throws error", async () => {
      const runner = new CaptureRunner(mockApp as never);
      const llmClient = createMockLlmClient([], true);
      const onChunk = vi.fn();

      const config: TemplateConfig = {
        name: "Test",
        filePath: "Test.md",
        contextScope: "selection",
        outputDestination: "inline",
        alsoAppendTo: "_System/Captures.md",
        appendFormat: "markdown",
        requiresSelection: true,
        commandPrefix: "Run",
        hotkey: [],
      };

      await expect(
        runner.runWithCapture(
          llmClient,
          {} as LlmRequest,
          config,
          createAbortSignal(),
          onChunk,
          "Reading/Note.md",
          "Test",
        ),
      ).rejects.toThrow("Stream error");

      const file = vault.getFileByPath("_System/Captures.md");
      expect(file).toBeNull();
    });

    it("does not append json-line when stream throws error", async () => {
      const runner = new CaptureRunner(mockApp as never);
      const llmClient = createMockLlmClient([], true);
      const onChunk = vi.fn();

      const config: TemplateConfig = {
        name: "Test",
        filePath: "Test.md",
        contextScope: "selection",
        outputDestination: "inline",
        alsoAppendTo: "_System/Captures.jsonl",
        appendFormat: "json-line",
        requiresSelection: true,
        commandPrefix: "Run",
        hotkey: [],
      };

      await expect(
        runner.runWithCapture(
          llmClient,
          {} as LlmRequest,
          config,
          createAbortSignal(),
          onChunk,
          "Reading/Note.md",
          "Test",
        ),
      ).rejects.toThrow("Stream error");

      const file = vault.getFileByPath("_System/Captures.jsonl");
      expect(file).toBeNull();
    });

    it("calls onChunk for partial content before error", async () => {
      const runner = new CaptureRunner(mockApp as never);
      const errorClient = {
        stream: async function* (
          _req: LlmRequest,
          _signal: AbortSignal,
        ): AsyncGenerator<LlmStreamEvent> {
          yield { type: "content", text: "Partial " };
          yield { type: "content", text: "content " };
          throw new Error("Stream interrupted");
        },
      } as unknown as OpenRouterClient;
      const onChunk = vi.fn();

      const config: TemplateConfig = {
        name: "Test",
        filePath: "Test.md",
        contextScope: "selection",
        outputDestination: "inline",
        alsoAppendTo: "_System/Captures.md",
        appendFormat: "markdown",
        requiresSelection: true,
        commandPrefix: "Run",
        hotkey: [],
      };

      await expect(
        runner.runWithCapture(
          errorClient,
          {} as LlmRequest,
          config,
          createAbortSignal(),
          onChunk,
          "Reading/Note.md",
          "Test",
        ),
      ).rejects.toThrow("Stream interrupted");

      expect(onChunk).toHaveBeenCalledWith("Partial ");
      expect(onChunk).toHaveBeenCalledWith("content ");
      const file = vault.getFileByPath("_System/Captures.md");
      expect(file).toBeNull();
    });

    it("does not append when no alsoAppendTo is set", async () => {
      const runner = new CaptureRunner(mockApp as never);
      const llmClient = createMockLlmClient(["Some content"]);
      const onChunk = vi.fn();

      const config: TemplateConfig = {
        name: "Test",
        filePath: "Test.md",
        contextScope: "selection",
        outputDestination: "inline",
        alsoAppendTo: undefined,
        appendFormat: "markdown",
        requiresSelection: true,
        commandPrefix: "Run",
        hotkey: [],
      };

      await runner.runWithCapture(
        llmClient,
        {} as LlmRequest,
        config,
        createAbortSignal(),
        onChunk,
        "Reading/Note.md",
        "Test",
      );

      expect(onChunk).toHaveBeenCalled();
      expect(vault.files.size).toBe(0);
    });

    it("does not append after an abort raised during chunk handling", async () => {
      const runner = new CaptureRunner(mockApp as never);
      const abortController = new AbortController();
      const llmClient = createMockLlmClient(["Partial ", "content"]);
      const onChunk = vi.fn(async () => {
        abortController.abort(new Error("User edited inside the callout"));
      });

      const config: TemplateConfig = {
        name: "Test",
        filePath: "Test.md",
        contextScope: "selection",
        outputDestination: "inline",
        alsoAppendTo: "_System/Captures.md",
        appendFormat: "markdown",
        requiresSelection: true,
        commandPrefix: "Run",
        hotkey: [],
      };

      await expect(
        runner.runWithCapture(
          llmClient,
          { model: "test-model" } as LlmRequest,
          config,
          abortController.signal,
          onChunk,
          "Reading/Note.md",
          "Test",
        ),
      ).rejects.toThrow("User edited inside the callout");

      expect(onChunk).toHaveBeenCalledTimes(1);
      expect(vault.getFileByPath("_System/Captures.md")).toBeNull();
    });
  });
});

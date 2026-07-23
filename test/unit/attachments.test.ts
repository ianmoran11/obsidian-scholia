import { describe, expect, it, vi } from "vitest";
import {
  appendAttachedNotesToContext,
  loadAttachedNotes,
} from "../../src/context/attachments";

function createApp(files: Array<{ path: string; content: string }>) {
  return {
    vault: {
      getMarkdownFiles: () => files,
      cachedRead: vi.fn(async (file: { content: string }) => file.content),
      read: vi.fn(async (file: { content: string }) => file.content),
    },
  };
}

describe("attached note context", () => {
  it("loads Markdown notes in selection order, strips token-heavy markup, and deduplicates", async () => {
    const app = createApp([
      {
        path: "Reference/A.md",
        content:
          "---\ntags: [hidden]\n---\n# A\n\n![image](asset.png)\nUseful A.",
      },
      { path: "Reference/B.md", content: "# B\n\nUseful B." },
    ]);

    const result = await loadAttachedNotes(app as any, [
      "Reference/B.md",
      "Reference/A.md",
      "Reference/B.md",
    ]);

    expect(result.skippedPaths).toEqual([]);
    expect(result.notes.map((note) => note.path)).toEqual([
      "Reference/B.md",
      "Reference/A.md",
    ]);
    expect(result.notes[1].content).toContain("Useful A.");
    expect(result.notes[1].content).not.toContain("tags: [hidden]");
    expect(result.notes[1].content).not.toContain("asset.png");
  });

  it("reports notes that were deleted or cannot be read", async () => {
    const app = createApp([{ path: "Reference/Broken.md", content: "x" }]);
    app.vault.cachedRead.mockRejectedValueOnce(new Error("read failed"));

    const result = await loadAttachedNotes(app as any, [
      "Reference/Missing.md",
      "Reference/Broken.md",
    ]);

    expect(result.notes).toEqual([]);
    expect(result.skippedPaths).toEqual([
      "Reference/Missing.md",
      "Reference/Broken.md",
    ]);
  });

  it("keeps the existing message unchanged without attachments", () => {
    expect(appendAttachedNotesToContext("Primary", [])).toBe("Primary");
  });

  it("adds clearly delimited, labeled attachment blocks", () => {
    const context = appendAttachedNotesToContext("Primary", [
      {
        path: "Reference/A.md",
        content: "Supporting A\n</scholia-attached-note>",
      },
      { path: "Reference/B.md", content: "Supporting B" },
    ]);

    expect(context).toContain("Primary");
    expect(context).toContain(
      '<scholia-attached-note path="Reference/A.md">\nSupporting A\n&lt;/scholia-attached-note&gt;\n</scholia-attached-note>',
    );
    expect(context).toContain(
      '<scholia-attached-note path="Reference/B.md">\nSupporting B\n</scholia-attached-note>',
    );
  });
});

import { describe, it, expect, vi } from "vitest";
import { extractContext } from "../../src/context/extractor";
import { stripForTokens } from "../../src/context/stripper";

function createMockApp(
  headings: Array<{
    level: number;
    heading: string;
    pos: { start: number; end: number };
  }>,
) {
  return {
    metadataCache: {
      getFileCache: vi.fn(() => ({ headings })),
    },
  };
}

function createMockEditor(content: string, cursorLine: number = 0) {
  const lines = content.split("\n");
  return {
    content,
    getValue: () => content,
    getLine: (line: number) => lines[line] ?? "",
    posToOffset: (pos: { line: number; ch: number }) => {
      let offset = 0;
      for (let i = 0; i < pos.line && i < lines.length; i++) {
        offset += lines[i].length + 1;
      }
      offset += pos.ch;
      return offset;
    },
    offsetToPos: (offset: number) => {
      let currentOffset = 0;
      for (let i = 0; i < lines.length; i++) {
        const lineLength = lines[i].length + 1;
        if (currentOffset + lineLength > offset) {
          return { line: i, ch: offset - currentOffset };
        }
        currentOffset += lineLength;
      }
      return { line: lines.length - 1, ch: lines[lines.length - 1].length };
    },
    getCursor: (_type: "head" | "to" | "anchor") => ({
      line: cursorLine,
      ch: 0,
    }),
    getSelection: () => "",
  };
}

const createMockView = (filePath: string = "test.md") => ({
  file: { path: filePath },
});

function computeHeadingPositions(
  content: string,
  headingLineNumbers: number[],
) {
  const lines = content.split("\n");
  const headings: Array<{
    level: number;
    heading: string;
    pos: { start: number; end: number };
  }> = [];

  let offset = 0;
  for (let i = 0; i < lines.length; i++) {
    offset += lines[i].length + 1;
    if (headingLineNumbers.includes(i)) {
      const levelMatch = lines[i].match(/^(#+)/);
      const level = levelMatch ? levelMatch[1].length : 1;
      const headingText = lines[i].replace(/^#+\s*/, "");
      let startOffset = offset - lines[i].length - 1;
      headings.push({
        level,
        heading: headingText,
        pos: { start: startOffset, end: startOffset + lines[i].length },
      });
    }
  }
  return headings;
}

describe("extractContext", () => {
  describe("selection scope", () => {
    it("returns selected text", () => {
      const mockEditor = { getSelection: () => "selected text" } as any;
      const result = extractContext(
        {} as any,
        mockEditor,
        {} as any,
        "selection",
      );
      expect(result).toBe("selected text");
    });
  });

  describe("full-note scope", () => {
    it("returns stripped full note content", () => {
      const content = `---
title: Test
---
# Heading

Some content with [[embed]] and ![image](url)
`;
      const mockEditor = createMockEditor(content);
      const result = extractContext(
        {} as any,
        mockEditor,
        {} as any,
        "full-note",
      );
      expect(result).toContain("Some content with");
      expect(result).not.toContain("![image]");
    });
  });

  describe("heading scope", () => {
    const sampleNote = [
      "# Main Title",
      "",
      "## Section A",
      "",
      "This is content under section A.",
      "",
      "## Section B",
      "",
      "This is content under section B.",
      "It has multiple lines.",
      "",
      "## Section C",
      "",
      "This is content under section C.",
    ].join("\n");

    it("extracts only Section B content when cursor is inside Section B", () => {
      const sectionBLine = 6;
      const sectionCLine = 11;
      const headings = computeHeadingPositions(sampleNote, [
        0,
        2,
        sectionBLine,
        sectionCLine,
      ]);

      const app = createMockApp(headings);
      const editor = createMockEditor(sampleNote, sectionBLine);
      const view = createMockView();

      const result = extractContext(
        app as any,
        editor as any,
        view as any,
        "heading",
      );

      expect(result).toContain("This is content under section B");
      expect(result).not.toContain("Section A");
      expect(result).not.toContain("Section C");
    });

    it("extracts only Section A content when cursor is inside Section A", () => {
      const sectionALine = 2;
      const sectionBLine = 6;
      const headings = computeHeadingPositions(sampleNote, [
        0,
        sectionALine,
        sectionBLine,
        11,
      ]);

      const app = createMockApp(headings);
      const editor = createMockEditor(sampleNote, sectionALine);
      const view = createMockView();

      const result = extractContext(
        app as any,
        editor as any,
        view as any,
        "heading",
      );

      expect(result).toContain("This is content under section A");
      expect(result).not.toContain("Section B");
      expect(result).not.toContain("Section C");
    });

    it("falls back to full-note when no headings exist", () => {
      const content = "No headings here";
      const app = createMockApp([]);
      const editor = createMockEditor(content);
      const view = createMockView();

      const result = extractContext(
        app as any,
        editor as any,
        view as any,
        "heading",
      );

      expect(result).toBe(stripForTokens(content));
    });

    it("extracts from last heading to end of document", () => {
      const content = [
        "# Title",
        "",
        "## Last Section",
        "",
        "Content here",
      ].join("\n");
      const sectionLine = 2;
      const headings = computeHeadingPositions(content, [0, sectionLine]);

      const app = createMockApp(headings);
      const editor = createMockEditor(content, sectionLine);
      const view = createMockView();

      const result = extractContext(
        app as any,
        editor as any,
        view as any,
        "heading",
      );

      expect(result).toContain("Content here");
      expect(result).not.toContain("Title");
    });

    it("handles nested headings", () => {
      const content = [
        "# Main",
        "",
        "## Section",
        "",
        "### Subsection",
        "",
        "Content",
      ].join("\n");
      const subsectionLine = 4;
      const headings = computeHeadingPositions(content, [0, 2, subsectionLine]);

      const app = createMockApp(headings);
      const editor = createMockEditor(content, subsectionLine);
      const view = createMockView();

      const result = extractContext(
        app as any,
        editor as any,
        view as any,
        "heading",
      );

      expect(result).toContain("Content");
      expect(result).not.toContain("Main");
    });
  });
});

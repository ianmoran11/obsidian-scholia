import { describe, expect, it } from "vitest";
import { buildSkeleton } from "../../src/stream/callout";
import {
  findScholiaCalloutAtCursorOrSelection,
  findScholiaCalloutAt,
  stripCalloutForChat,
} from "../../src/stream/calloutParser";
import { Editor } from "../mocks/obsidian";

describe("findScholiaCalloutAt", () => {
  it("finds a generated callout from a cursor inside the response", () => {
    const skeleton = buildSkeleton({
      calloutType: "ai",
      calloutLabel: "Probe",
      folded: true,
      commandName: "Probe",
      selectionText: "Context",
      questionText: "Question?",
      runSnapshot: {
        id: "scholia-test",
        schemaVersion: 1,
        templatePath: "Edu-Templates/Probe.md",
        templateName: "Probe",
        sourcePath: "Reading/Note.md",
        question: "Question?",
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
    const editor = new Editor();
    editor.setValue(`# Note${skeleton}Old answer\n> \n> **Metadata:** tokens=1\n\nAfter`);

    const cursorOffset = editor.getValue().indexOf("Old answer") + 2;
    const parsed = findScholiaCalloutAt(editor, editor.offsetToPos(cursorOffset));

    expect(parsed?.runSnapshot?.templatePath).toBe("Edu-Templates/Probe.md");
    expect(parsed?.calloutType).toBe("ai");
    expect(parsed?.responseStartOffset).toBeLessThan(cursorOffset);
    expect(parsed?.responseEndOffset).toBe(editor.getValue().indexOf("\n> \n> **Metadata:**"));
  });

  it("falls back to known legacy callout types without a snapshot", () => {
    const editor = new Editor();
    editor.setValue("> [!scholia-clarify]- Clarify\n> **Response:**\n> Legacy");

    const parsed = findScholiaCalloutAt(editor, { line: 2, ch: 3 });

    expect(parsed?.runSnapshot).toBeUndefined();
    expect(parsed?.calloutType).toBe("scholia-clarify");
  });

  it("ignores ordinary blockquotes", () => {
    const editor = new Editor();
    editor.setValue("> A quoted passage\n> with two lines");

    expect(findScholiaCalloutAt(editor, { line: 1, ch: 2 })).toBeNull();
  });

  it("finds a generated callout from a selection even when head is outside", () => {
    const skeleton = buildSkeleton({
      calloutType: "ai",
      calloutLabel: "Probe",
      folded: true,
      commandName: "Probe",
      selectionText: "Context",
      runSnapshot: {
        id: "scholia-test",
        schemaVersion: 1,
        templatePath: "Edu-Templates/Probe.md",
        templateName: "Probe",
        sourcePath: "Reading/Note.md",
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
    const editor = new Editor();
    editor.setValue(`# Note${skeleton}Old answer\n\nAfter`);
    const selectionStart = editor.offsetToPos(
      editor.getValue().indexOf("Old answer"),
    );
    const selectionEnd = editor.offsetToPos(
      editor.getValue().indexOf("Old answer") + "Old answer".length,
    );
    const outside = editor.offsetToPos(editor.getValue().indexOf("After"));
    const selectionEditor = Object.assign(editor, {
      getSelection: () => "Old answer",
      getCursor: (name?: string) => {
        if (name === "from") return selectionStart;
        if (name === "to") return selectionEnd;
        return outside;
      },
    });

    const parsed = findScholiaCalloutAtCursorOrSelection(
      selectionEditor as never,
    );

    expect(parsed?.runSnapshot?.id).toBe("scholia-test");
  });
});

describe("stripCalloutForChat", () => {
  it("removes run comments and metadata while preserving conversation turns", () => {
    const stripped = stripCalloutForChat(
      [
        '<!-- scholia:run {"id":"scholia-test"} -->',
        "**Context:** *A passage*",
        "",
        "**Question:** What matters?",
        "",
        "**Response:**",
        "It matters because...",
        "",
        "**Metadata:** model=test; tokens=12",
        "---",
        "**Follow-up:** Why?",
        "",
        "**Response:**",
        "Because recall strengthens memory.",
      ].join("\n"),
    );

    expect(stripped).not.toContain("scholia:run");
    expect(stripped).not.toContain("**Metadata:**");
    expect(stripped).toContain("**Question:** What matters?");
    expect(stripped).toContain("**Follow-up:** Why?");
    expect(stripped).toContain("Because recall strengthens memory.");
  });
});

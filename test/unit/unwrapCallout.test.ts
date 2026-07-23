import { describe, expect, it } from "vitest";
import {
  findCalloutPlainTextRange,
  unwrapCalloutAtCursor,
} from "../../src/commands/unwrapCallout";
import { Editor } from "../mocks/obsidian";

function editorAt(content: string, line: number, ch = 0): Editor {
  const editor = new Editor();
  editor.setValue(content);
  return Object.assign(editor, {
    getCursor: () => ({ line, ch }),
  });
}

describe("unwrapCalloutAtCursor", () => {
  it("removes callout markers and keeps a custom title as plain text", () => {
    const editor = editorAt(
      [
        "Before",
        "> [!note]- Important context",
        "> First paragraph.",
        ">",
        "> - list item",
        "> > nested quote",
        "After",
      ].join("\n"),
      4,
    );

    expect(unwrapCalloutAtCursor(editor)).toBe(true);
    expect(editor.getValue()).toBe(
      [
        "Before",
        "Important context",
        "First paragraph.",
        "",
        "- list item",
        "> nested quote",
        "After",
      ].join("\n"),
    );
  });

  it("drops a titleless callout header and preserves the body", () => {
    const editor = editorAt("> [!warning]+\n> Be careful.", 1);

    expect(unwrapCalloutAtCursor(editor)).toBe(true);
    expect(editor.getValue()).toBe("Be careful.");
  });

  it("only unwraps the adjacent callout containing the cursor", () => {
    const editor = editorAt(
      [
        "> [!note] First",
        "> First body",
        "> [!tip] Second",
        "> Second body",
      ].join("\n"),
      3,
    );

    expect(unwrapCalloutAtCursor(editor)).toBe(true);
    expect(editor.getValue()).toBe(
      ["> [!note] First", "> First body", "Second", "Second body"].join("\n"),
    );
  });

  it("does nothing for an ordinary blockquote", () => {
    const content = "> Quoted text\n> More quoted text";
    const editor = editorAt(content, 1);

    expect(findCalloutPlainTextRange(editor)).toBeNull();
    expect(unwrapCalloutAtCursor(editor)).toBe(false);
    expect(editor.getValue()).toBe(content);
  });

  it("does nothing when the cursor is outside the callout", () => {
    const content = "> [!note] Title\n> Body\nOutside";
    const editor = editorAt(content, 2);

    expect(unwrapCalloutAtCursor(editor)).toBe(false);
    expect(editor.getValue()).toBe(content);
  });
});

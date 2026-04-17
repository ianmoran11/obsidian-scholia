import type { App, Editor, MarkdownView } from "obsidian";
import type { Scope } from "../templates/types";
import { stripForTokens } from "./stripper";

export function extractContext(
  app: App,
  editor: Editor,
  view: MarkdownView,
  scope: Scope,
): string {
  switch (scope) {
    case "selection":
      return editor.getSelection();
    case "heading":
      return extractHeadingSection(app, editor, view);
    case "full-note":
      return stripForTokens(editor.getValue());
  }
}

function extractHeadingSection(
  app: App,
  editor: Editor,
  view: MarkdownView,
): string {
  if (!view.file) return stripForTokens(editor.getValue());

  const cache = app.metadataCache.getFileCache(view.file);
  const headings = cache?.headings ?? [];

  if (headings.length === 0) {
    return stripForTokens(editor.getValue());
  }

  const cursorOffset = editor.posToOffset(editor.getCursor("head"));

  let startHeading: {
    level: number;
    heading: string;
    pos: { start: number; end: number };
  } | null = null;
  let endHeading: {
    level: number;
    heading: string;
    pos: { start: number; end: number };
  } | null = null;

  for (const heading of headings) {
    if (heading.pos.start <= cursorOffset) {
      startHeading = heading;
    }
    if (heading.pos.start > cursorOffset && !endHeading) {
      endHeading = heading;
      break;
    }
  }

  if (!startHeading) {
    return stripForTokens(editor.getValue());
  }

  const startOffset = startHeading.pos.start;
  const endOffset = endHeading
    ? endHeading.pos.start
    : editor.getValue().length;

  const startPos = editor.offsetToPos(startOffset);
  const endPos = endHeading
    ? editor.offsetToPos(endOffset)
    : { line: editor.getValue().split("\n").length, ch: 0 };

  const lines: string[] = [];
  for (let i = startPos.line; i < endPos.line; i++) {
    lines.push(editor.getLine(i));
  }

  return lines.join("\n").trim();
}

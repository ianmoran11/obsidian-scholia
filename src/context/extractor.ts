import type { App, Editor, HeadingCache, MarkdownView } from "obsidian";
import type { ContextScope } from "../templates/types";
import { stripForTokens } from "./stripper";

export function extractContext(
  app: App,
  editor: Editor,
  view: MarkdownView,
  scope: ContextScope,
): string {
  switch (scope) {
    case "selection":
      return editor.getSelection();
    case "heading":
      return extractHeadingSection(app, editor, view);
    case "full-note":
      return stripForTokens(editor.getValue());
    default:
      return editor.getSelection();
  }
}

export interface ScopeRange {
  startOffset: number;
  endOffset: number;
}

/**
 * Resolve the editor offset range a scope refers to, for output modes that
 * replace existing content (e.g. in-place edit). Mirrors extractContext's
 * notion of each scope's region.
 */
export function resolveScopeRange(
  app: App,
  editor: Editor,
  view: MarkdownView,
  scope: ContextScope,
): ScopeRange {
  switch (scope) {
    case "selection":
      return {
        startOffset: editor.posToOffset(editor.getCursor("from")),
        endOffset: editor.posToOffset(editor.getCursor("to")),
      };
    case "heading":
      return resolveHeadingRange(app, editor, view);
    case "full-note":
      return { startOffset: 0, endOffset: editor.getValue().length };
    default:
      return {
        startOffset: editor.posToOffset(editor.getCursor("from")),
        endOffset: editor.posToOffset(editor.getCursor("to")),
      };
  }
}

function resolveHeadingRange(
  app: App,
  editor: Editor,
  view: MarkdownView,
): ScopeRange {
  const fullRange = { startOffset: 0, endOffset: editor.getValue().length };
  if (!view.file) return fullRange;

  const cache = app.metadataCache.getFileCache(view.file);
  const headings: HeadingCache[] = cache?.headings ?? [];
  if (headings.length === 0) return fullRange;

  const cursorOffset = editor.posToOffset(editor.getCursor("head"));

  let startHeading: HeadingCache | null = null;
  let endHeading: HeadingCache | null = null;
  for (const heading of headings) {
    if (heading.position.start.offset <= cursorOffset) {
      startHeading = heading;
    }
    if (heading.position.start.offset > cursorOffset && !endHeading) {
      endHeading = heading;
      break;
    }
  }

  if (!startHeading) return fullRange;

  return {
    startOffset: startHeading.position.start.offset,
    endOffset: endHeading
      ? endHeading.position.start.offset
      : editor.getValue().length,
  };
}

function extractHeadingSection(
  app: App,
  editor: Editor,
  view: MarkdownView,
): string {
  if (!view.file) return stripForTokens(editor.getValue());

  const cache = app.metadataCache.getFileCache(view.file);
  const headings: HeadingCache[] = cache?.headings ?? [];

  if (headings.length === 0) {
    return stripForTokens(editor.getValue());
  }

  const cursorOffset = editor.posToOffset(editor.getCursor("head"));

  let startHeading: HeadingCache | null = null;
  let endHeading: HeadingCache | null = null;

  for (const heading of headings) {
    if (heading.position.start.offset <= cursorOffset) {
      startHeading = heading;
    }
    if (heading.position.start.offset > cursorOffset && !endHeading) {
      endHeading = heading;
      break;
    }
  }

  if (!startHeading) {
    return stripForTokens(editor.getValue());
  }

  const startOffset = startHeading.position.start.offset;
  const endOffset = endHeading
    ? endHeading.position.start.offset
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

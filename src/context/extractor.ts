import type { App, Editor, HeadingCache, MarkdownView } from "obsidian";
import type { ContextScope } from "../templates/types";
import { stripForTokens } from "./stripper";

/**
 * For "heading" scope, which heading level bounds the section. 0 (the default)
 * means "nearest" — the innermost section containing the cursor, bounded by a
 * heading of any level. A value N (1–6) bounds the section by headings of level
 * ≤ N, so deeper subsections are folded into the enclosing block.
 */
export type HeadingLevel = number;

export function extractContext(
  app: App,
  editor: Editor,
  view: MarkdownView,
  scope: ContextScope,
  headingLevel: HeadingLevel = 0,
): string {
  switch (scope) {
    case "selection":
      return editor.getSelection();
    case "heading":
      return extractHeadingSection(app, editor, view, headingLevel);
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
  headingLevel: HeadingLevel = 0,
): ScopeRange {
  switch (scope) {
    case "selection":
      return {
        startOffset: editor.posToOffset(editor.getCursor("from")),
        endOffset: editor.posToOffset(editor.getCursor("to")),
      };
    case "heading":
      return resolveHeadingRange(app, editor, view, headingLevel);
    case "full-note":
      return { startOffset: 0, endOffset: editor.getValue().length };
    default:
      return {
        startOffset: editor.posToOffset(editor.getCursor("from")),
        endOffset: editor.posToOffset(editor.getCursor("to")),
      };
  }
}

/**
 * Headings that act as section boundaries for the given level. Level 0 (nearest)
 * treats every heading as a boundary; level N keeps only headings of level ≤ N.
 */
function boundaryHeadings(
  headings: HeadingCache[],
  headingLevel: HeadingLevel,
): HeadingCache[] {
  if (headingLevel <= 0) return headings;
  return headings.filter((h) => h.level <= headingLevel);
}

function resolveHeadingRange(
  app: App,
  editor: Editor,
  view: MarkdownView,
  headingLevel: HeadingLevel,
): ScopeRange {
  const fullRange = { startOffset: 0, endOffset: editor.getValue().length };
  if (!view.file) return fullRange;

  const cache = app.metadataCache.getFileCache(view.file);
  const headings = boundaryHeadings(cache?.headings ?? [], headingLevel);
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
  headingLevel: HeadingLevel,
): string {
  if (!view.file) return stripForTokens(editor.getValue());

  const cache = app.metadataCache.getFileCache(view.file);
  const headings = boundaryHeadings(cache?.headings ?? [], headingLevel);

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

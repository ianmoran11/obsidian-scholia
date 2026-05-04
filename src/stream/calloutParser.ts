import type { Editor, EditorPosition } from "obsidian";
import {
  SCHOLIA_RUN_MARKER,
  type ScholiaRunSnapshot,
} from "./callout";

export interface ParsedScholiaCallout {
  startLine: number;
  endLine: number;
  startOffset: number;
  endOffset: number;
  header: string;
  body: string;
  calloutType: string;
  runSnapshot?: ScholiaRunSnapshot;
  responseStartOffset?: number;
  responseEndOffset?: number;
  metadataStartOffset?: number;
}

const LEGACY_CALLOUT_TYPES = new Set([
  "ai",
  "scholia-clarify",
  "scholia-example",
  "scholia-flashcard",
  "scholia-pending",
]);

function lineStartOffset(lines: string[], line: number): number {
  let offset = 0;
  for (let i = 0; i < line; i++) {
    offset += lines[i].length + 1;
  }
  return offset;
}

function unquote(line: string): string {
  return line.replace(/^>\s?/, "");
}

function parseSnapshot(body: string): ScholiaRunSnapshot | undefined {
  const markerIndex = body.indexOf(SCHOLIA_RUN_MARKER);
  if (markerIndex === -1) return undefined;

  const jsonStart = body.indexOf("{", markerIndex);
  const commentEnd = body.indexOf("-->", markerIndex);
  if (jsonStart === -1 || commentEnd === -1 || jsonStart > commentEnd) {
    return undefined;
  }

  try {
    return JSON.parse(body.slice(jsonStart, commentEnd).trim());
  } catch {
    return undefined;
  }
}

export function stripCalloutForChat(body: string): string {
  return body
    .split("\n")
    .filter((line) => {
      const trimmed = line.trim();
      return (
        !trimmed.startsWith("<!-- scholia:run") &&
        !trimmed.startsWith("**Metadata:**")
      );
    })
    .join("\n")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

function getCursorSafely(
  editor: Editor,
  name: "head" | "anchor" | "from" | "to",
): EditorPosition | undefined {
  try {
    return editor.getCursor(name);
  } catch {
    return undefined;
  }
}

function comparePositions(a: EditorPosition, b: EditorPosition): number {
  if (a.line !== b.line) return a.line - b.line;
  return a.ch - b.ch;
}

export function findScholiaCalloutAtCursorOrSelection(
  editor: Editor,
): ParsedScholiaCallout | null {
  const positions = [
    getCursorSafely(editor, "head"),
    getCursorSafely(editor, "anchor"),
    getCursorSafely(editor, "from"),
    getCursorSafely(editor, "to"),
  ].filter((pos): pos is EditorPosition => !!pos);

  for (const position of positions) {
    const parsed = findScholiaCalloutAt(editor, position);
    if (parsed) return parsed;
  }

  if (!editor.getSelection()) return null;

  const from = getCursorSafely(editor, "from");
  const to = getCursorSafely(editor, "to");
  if (!from || !to) return null;

  const start = comparePositions(from, to) <= 0 ? from : to;
  const end = comparePositions(from, to) <= 0 ? to : from;
  const endLine =
    end.ch === 0 && end.line > start.line ? end.line - 1 : end.line;

  for (let line = start.line; line <= endLine; line++) {
    const parsed = findScholiaCalloutAt(editor, { line, ch: 0 });
    if (parsed) return parsed;
  }

  return null;
}

export function findScholiaCalloutAt(
  editor: Editor,
  position?: EditorPosition,
): ParsedScholiaCallout | null {
  const content = editor.getValue();
  const lines = content.split("\n");
  const cursor = position ?? editor.getCursor("head");
  let line = Math.min(cursor.line, lines.length - 1);

  if (line > 0 && !lines[line].startsWith(">") && cursor.ch === 0) {
    line -= 1;
  }

  while (line >= 0 && lines[line].startsWith(">")) {
    line -= 1;
  }
  const startLine = line + 1;
  if (startLine >= lines.length || !lines[startLine].startsWith(">")) {
    return null;
  }

  let endLine = startLine;
  while (endLine + 1 < lines.length && lines[endLine + 1].startsWith(">")) {
    endLine += 1;
  }

  const startOffset = lineStartOffset(lines, startLine);
  const endOffset =
    lineStartOffset(lines, endLine) + lines[endLine].length;
  const header = lines[startLine];
  const match = header.match(/^\s*>\s*\[!([^\]]+)\]/);
  const calloutType = match?.[1] ?? "";
  const bodyLines = lines.slice(startLine + 1, endLine + 1);
  const body = bodyLines.map(unquote).join("\n");
  const runSnapshot = parseSnapshot(body);

  if (!runSnapshot && !LEGACY_CALLOUT_TYPES.has(calloutType)) {
    return null;
  }

  let responseStartOffset: number | undefined;
  let responseEndOffset: number | undefined;
  let metadataStartOffset: number | undefined;

  for (let i = startLine + 1; i <= endLine; i++) {
    const plain = unquote(lines[i]).trim();
    if (plain.startsWith("**Response:**")) {
      responseStartOffset = lineStartOffset(lines, i) + lines[i].length;
    }
    if (plain.startsWith("**Metadata:**")) {
      const previous = i > startLine ? unquote(lines[i - 1]).trim() : "";
      metadataStartOffset =
        previous === "" ? lineStartOffset(lines, i - 1) : lineStartOffset(lines, i);
      break;
    }
  }

  if (responseStartOffset !== undefined) {
    responseEndOffset = metadataStartOffset ?? endOffset;
    while (
      responseEndOffset > responseStartOffset &&
      /\s/.test(content[responseEndOffset - 1] ?? "")
    ) {
      responseEndOffset -= 1;
    }
  }

  return {
    startLine,
    endLine,
    startOffset,
    endOffset,
    header,
    body,
    calloutType,
    runSnapshot,
    responseStartOffset,
    responseEndOffset,
    metadataStartOffset,
  };
}

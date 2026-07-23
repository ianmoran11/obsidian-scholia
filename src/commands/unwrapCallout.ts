import type { Editor, EditorPosition } from "obsidian";

export interface CalloutPlainTextRange {
  startOffset: number;
  endOffset: number;
  plainText: string;
}

const CALLOUT_HEADER = /^(\s*)>[ \t]*\[![^\]\r\n]+\][+-]?[ \t]*(.*?)[ \t]*\r?$/;
const QUOTED_LINE = /^\s*>/;

/** Find the top-level Obsidian callout containing a cursor position. */
export function findCalloutPlainTextRange(
  editor: Editor,
  position: EditorPosition = editor.getCursor("head"),
): CalloutPlainTextRange | null {
  const content = editor.getValue();
  const lines = content.split("\n");
  const cursorLine = Math.min(Math.max(position.line, 0), lines.length - 1);

  if (!QUOTED_LINE.test(lines[cursorLine] ?? "")) return null;

  let startLine = cursorLine;
  let headerMatch: RegExpMatchArray | null = null;
  while (startLine >= 0 && QUOTED_LINE.test(lines[startLine])) {
    const match = lines[startLine].match(CALLOUT_HEADER);
    if (match) {
      headerMatch = match;
      break;
    }
    startLine--;
  }
  if (!headerMatch) return null;

  let endLine = startLine;
  while (endLine + 1 < lines.length && QUOTED_LINE.test(lines[endLine + 1])) {
    if (lines[endLine + 1].match(CALLOUT_HEADER)) break;
    endLine++;
  }
  if (cursorLine > endLine) return null;

  const title = headerMatch[2].trim();
  const body = lines
    .slice(startLine + 1, endLine + 1)
    .map((line) => line.replace(/^(\s*)>[ \t]?/, "$1"));
  const plainLines = title ? [`${headerMatch[1]}${title}`, ...body] : body;

  return {
    startOffset: lineStartOffset(lines, startLine),
    endOffset: lineStartOffset(lines, endLine) + lines[endLine].length,
    plainText: plainLines.join("\n"),
  };
}

/** Replace the callout under the cursor with its title/body as ordinary Markdown. */
export function unwrapCalloutAtCursor(editor: Editor): boolean {
  const range = findCalloutPlainTextRange(editor);
  if (!range) return false;

  editor.replaceRange(
    range.plainText,
    editor.offsetToPos(range.startOffset),
    editor.offsetToPos(range.endOffset),
  );
  return true;
}

function lineStartOffset(lines: string[], line: number): number {
  let offset = 0;
  for (let index = 0; index < line; index++) {
    offset += lines[index].length + 1;
  }
  return offset;
}

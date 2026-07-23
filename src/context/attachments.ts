import type { App, TFile } from "obsidian";
import { stripForTokens } from "./stripper";

export interface AttachedNoteContext {
  path: string;
  content: string;
}

export interface AttachedNoteLoadResult {
  notes: AttachedNoteContext[];
  skippedPaths: string[];
}

/**
 * Resolve and read transient Markdown-note attachments in the order selected.
 * Paths are re-resolved at run time so renamed or deleted notes fail safely.
 */
export async function loadAttachedNotes(
  app: App,
  paths: readonly string[],
): Promise<AttachedNoteLoadResult> {
  const markdownFiles = new Map(
    app.vault.getMarkdownFiles().map((file) => [file.path, file]),
  );
  const seen = new Set<string>();
  const notes: AttachedNoteContext[] = [];
  const skippedPaths: string[] = [];

  for (const path of paths) {
    if (seen.has(path)) continue;
    seen.add(path);

    const file = markdownFiles.get(path);
    if (!file) {
      skippedPaths.push(path);
      continue;
    }

    try {
      notes.push({
        path: file.path,
        content: stripForTokens(await readNote(app, file)),
      });
    } catch {
      skippedPaths.push(path);
    }
  }

  return { notes, skippedPaths };
}

async function readNote(app: App, file: TFile): Promise<string> {
  const vault = app.vault as typeof app.vault & {
    cachedRead?: (target: TFile) => Promise<string>;
  };
  return vault.cachedRead ? vault.cachedRead(file) : app.vault.read(file);
}

/** Keep the existing user message unchanged when no notes are attached. */
export function appendAttachedNotesToContext(
  currentContext: string,
  notes: readonly AttachedNoteContext[],
): string {
  if (notes.length === 0) return currentContext;

  const blocks = notes.map((note) => {
    const safeContent = note.content.replace(
      /<\/scholia-attached-note>/gi,
      "&lt;/scholia-attached-note&gt;",
    );
    return [
      `<scholia-attached-note path=${JSON.stringify(note.path)}>`,
      safeContent || "(empty note)",
      "</scholia-attached-note>",
    ].join("\n");
  });

  return [
    currentContext,
    "",
    "The following attached Markdown notes are reference material for this query:",
    ...blocks,
  ].join("\n");
}

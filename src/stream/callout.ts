import { Editor } from "obsidian";
import type { LlmRunMetadata } from "../llm/metadata";
import { formatRunMetadataLine } from "../llm/metadata";

export interface BuildSkeletonOpts {
  calloutType: string;
  calloutLabel: string;
  folded: boolean;
  commandName: string;
  selectionText: string;
}

export const STREAMING_CALLOUT_TYPE = "scholia-pending";

export function buildSkeleton(opts: BuildSkeletonOpts): string {
  const foldMarker = opts.folded ? "-" : "+";
  const safeSel = opts.selectionText.replace(/\n/g, "\n> ");
  return (
    `\n> [!${opts.calloutType}]${foldMarker} ${opts.calloutLabel}: ${opts.commandName}\n` +
    `> **Context:** *${safeSel}*\n` +
    `> \n` +
    `> **Response:**\n` +
    `> `
  );
}

export function appendToCallout(
  editor: Editor,
  writeOffset: number,
  text: string,
): number {
  const prefixed = text.replace(/\n/g, "\n> ");
  const pos = editor.offsetToPos(writeOffset);
  editor.replaceRange(prefixed, pos);
  return writeOffset + prefixed.length;
}

export function formatError(message: string): string {
  return `> \n> **Error:** ${message}`;
}

export function formatCalloutMetadata(metadata: LlmRunMetadata): string {
  return `\n\n**Metadata:** ${formatRunMetadataLine(metadata)}`;
}

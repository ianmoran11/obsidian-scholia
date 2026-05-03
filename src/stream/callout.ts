import { Editor } from "obsidian";
import type { LlmRunMetadata } from "../llm/metadata";
import { formatRunMetadataLine } from "../llm/metadata";
import type { ContextScope, ReasoningEffort } from "../templates/types";

export interface BuildSkeletonOpts {
  calloutType: string;
  calloutLabel: string;
  folded: boolean;
  commandName: string;
  selectionText: string;
  questionText?: string;
  runSnapshot?: ScholiaRunSnapshot;
}

export const STREAMING_CALLOUT_TYPE = "scholia-pending";
export const SCHOLIA_RUN_MARKER = "scholia:run";

export interface ScholiaRunSnapshot {
  id: string;
  schemaVersion: 1;
  templatePath: string;
  templateName: string;
  sourcePath?: string;
  question?: string;
  contextScope: ContextScope;
  model: string;
  temperature: number;
  maxTokens: number;
  reasoningEnabled: boolean;
  reasoningEffort: ReasoningEffort;
  calloutType: string;
  calloutLabel: string;
  calloutFolded: boolean;
  outputDestination: string;
  createdAt: string;
  lastRegeneratedAt?: string;
}

export function serializeRunSnapshot(snapshot: ScholiaRunSnapshot): string {
  const json = JSON.stringify(snapshot).replace(/-->/g, "--\\u003e");
  return `<!-- ${SCHOLIA_RUN_MARKER} ${json} -->`;
}

export function buildSkeleton(opts: BuildSkeletonOpts): string {
  const foldMarker = opts.folded ? "-" : "+";
  const safeSel = opts.selectionText.replace(/\n/g, "\n> ");
  const safeQuestion = opts.questionText?.trim().replace(/\n/g, "\n> ");
  const questionSection = safeQuestion
    ? `> **Question:** ${safeQuestion}\n` + `> \n`
    : "";
  const snapshotLine = opts.runSnapshot
    ? `> ${serializeRunSnapshot(opts.runSnapshot)}\n`
    : "";
  return (
    `\n> [!${opts.calloutType}]${foldMarker} ${opts.calloutLabel}: ${opts.commandName}\n` +
    snapshotLine +
    `> **Context:** *${safeSel}*\n` +
    `> \n` +
    questionSection +
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

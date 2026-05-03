import { Editor, MarkdownView } from "obsidian";
import { buildSkeleton, appendToCallout } from "./callout";
import type { BuildSkeletonOpts } from "./callout";
import type { LlmStreamEvent } from "../llm/client";

export class Stream {
  public streamId: string;
  public filePath: string;
  public writeOffset: number = 0;
  public skeletonStart: number = 0;
  public skeletonEnd: number = 0;
  public lastKnownLength: number = 0;
  public lastKnownContent: string = "";
  public inRangeWriteInProgress: boolean = false;
  public abort: AbortController;
  public isAborted: boolean = false;

  private editor: Editor;
  private view: MarkdownView;

  constructor(
    streamId: string,
    filePath: string,
    editor: Editor,
    view: MarkdownView,
  ) {
    this.streamId = streamId;
    this.filePath = filePath;
    this.editor = editor;
    this.view = view;
    this.abort = new AbortController();
    this.lastKnownContent = editor.getValue();
    this.lastKnownLength = this.lastKnownContent.length;
  }

  insertSkeleton(
    opts: BuildSkeletonOpts,
    posAfterSelection: { line: number; ch: number },
  ): void {
    const skeleton = buildSkeleton(opts);
    this.editor.replaceRange(skeleton, posAfterSelection);

    const offset = this.editor.posToOffset(posAfterSelection);
    this.skeletonStart = offset;
    this.skeletonEnd = offset + skeleton.length;
    this.writeOffset = this.skeletonEnd;
    this.lastKnownContent = this.editor.getValue();
    this.lastKnownLength = this.lastKnownContent.length;
  }

  async writeChunk(raw: string): Promise<void> {
    this.inRangeWriteInProgress = true;
    try {
      const prefixed = raw.replace(/\n/g, "\n> ");
      const pos = this.editor.offsetToPos(this.writeOffset);
      this.editor.replaceRange(prefixed, pos);
      this.writeOffset += prefixed.length;
      this.lastKnownContent = this.editor.getValue();
      this.lastKnownLength = this.lastKnownContent.length;
    } finally {
      this.inRangeWriteInProgress = false;
    }
  }

  setCalloutType(calloutType: string): void {
    const content = this.editor.getValue();
    const headerStart =
      content[this.skeletonStart] === "\n"
        ? this.skeletonStart + 1
        : this.skeletonStart;
    const headerEnd = content.indexOf("\n", headerStart);
    if (headerEnd === -1) return;

    const header = content.slice(headerStart, headerEnd);
    const nextHeader = header.replace(/\[![^\]]+\]/, `[!${calloutType}]`);
    if (nextHeader === header) return;

    this.inRangeWriteInProgress = true;
    try {
      this.editor.replaceRange(
        nextHeader,
        this.editor.offsetToPos(headerStart),
        this.editor.offsetToPos(headerEnd),
      );

      const delta = nextHeader.length - header.length;
      this.skeletonEnd += delta;
      this.writeOffset += delta;
      this.lastKnownContent = this.editor.getValue();
      this.lastKnownLength = this.lastKnownContent.length;
    } finally {
      this.inRangeWriteInProgress = false;
    }
  }

  async start(
    generator: AsyncGenerator<LlmStreamEvent>,
    onMetadata?: (event: Extract<LlmStreamEvent, { type: "metadata" }>) => void,
  ): Promise<void> {
    for await (const event of generator) {
      if (this.abort.signal.aborted) {
        throw this.getAbortError();
      }
      if (event.type === "content") {
        await this.writeChunk(event.text);
      } else {
        onMetadata?.(event);
      }
    }

    if (this.abort.signal.aborted) {
      throw this.getAbortError();
    }
  }

  abortWithError(message: string): void {
    this.abort.abort(new Error(message));
    this.isAborted = true;
  }

  private getAbortError(): Error {
    const { reason } = this.abort.signal;
    return reason instanceof Error ? reason : new Error("Stream aborted");
  }

  applyExternalEdit(
    delta: number,
    changePos: number,
  ): "shift" | "abort" | "none" {
    if (this.inRangeWriteInProgress) return "none";
    if (changePos >= this.skeletonStart && changePos < this.skeletonEnd) {
      this.abortWithError("User edited inside the callout");
      return "abort";
    }
    if (changePos < this.skeletonStart) {
      this.writeOffset += delta;
      this.skeletonStart += delta;
      this.skeletonEnd += delta;
      return "shift";
    }
    return "none";
  }
}

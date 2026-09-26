import { App, Editor, MarkdownView } from "obsidian";
import { Stream } from "./stream";

export class StreamManager {
  private streams: Map<string, Stream> = new Map();
  private plugin: { app: App };
  private maxConcurrentStreams: number = 8;
  private controllers = new Set<AbortController>();
  public isDisposed = false;

  track(controller: AbortController): () => void {
    if (this.isDisposed) controller.abort(new Error("Scholia unloaded."));
    else this.controllers.add(controller);
    return () => this.controllers.delete(controller);
  }

  dispose(): void {
    this.isDisposed = true;
    for (const stream of this.streams.values())
      stream.abortWithError("Scholia unloaded.");
    for (const controller of this.controllers)
      controller.abort(new Error("Scholia unloaded."));
    this.controllers.clear();
    this.streams.clear();
  }

  constructor(plugin: { app: App }) {
    this.plugin = plugin;
  }

  private findFirstDifference(a: string, b: string): number {
    const minLen = Math.min(a.length, b.length);
    for (let i = 0; i < minLen; i++) {
      if (a[i] !== b[i]) return i;
    }
    return minLen;
  }

  handleEditorChange(editor: Editor, filePath: string): void {
    for (const s of this.streams.values()) {
      if (s.filePath !== filePath) continue;
      const current = editor.getValue();
      const delta = current.length - s.lastKnownLength;
      if (current === s.lastKnownContent) continue;
      const changePos = this.findFirstDifference(s.lastKnownContent, current);
      // Bound the entire changed range in the OLD document, not just its start.
      // Multiple changes become one conservative span: cancellation is safer than
      // treating a replacement across the output as an edit wholly before it.
      let oldEnd = s.lastKnownContent.length;
      let newEnd = current.length;
      while (
        oldEnd > changePos &&
        newEnd > changePos &&
        s.lastKnownContent[oldEnd - 1] === current[newEnd - 1]
      ) {
        oldEnd--;
        newEnd--;
      }
      s.applyExternalEdit(delta, changePos, oldEnd);
      s.lastKnownLength = current.length;
      s.lastKnownContent = current;
    }
  }

  addStream(stream: Stream): boolean {
    if (this.isDisposed || this.streams.size >= this.maxConcurrentStreams) {
      return false;
    }
    this.streams.set(stream.streamId, stream);
    return true;
  }

  removeStream(streamId: string): void {
    this.streams.delete(streamId);
  }

  getStream(streamId: string): Stream | undefined {
    return this.streams.get(streamId);
  }

  get activeStreamCount(): number {
    return this.streams.size;
  }
}

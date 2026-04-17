import { App, Editor, MarkdownView } from "obsidian";
import { Stream } from "./stream";

export class StreamManager {
  private streams: Map<string, Stream> = new Map();
  private plugin: { app: App };
  private maxConcurrentStreams: number = 8;

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
      if (delta === 0) continue;
      const changePos = this.findFirstDifference(s.lastKnownContent, current);
      const result = s.applyExternalEdit(delta, changePos);
      s.lastKnownLength = current.length;
      s.lastKnownContent = current;
    }
  }

  addStream(stream: Stream): boolean {
    if (this.streams.size >= this.maxConcurrentStreams) {
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

import { describe, it, expect } from "vitest";
import { Stream } from "../../src/stream/stream";
import { StreamManager } from "../../src/stream/manager";
import { Editor } from "../mocks/obsidian";
import { MarkdownView } from "../mocks/obsidian";

function createMockView(filePath: string): MarkdownView {
  return {
    file: { path: filePath },
  } as unknown as MarkdownView;
}

function createStreamWithState(
  streamId: string,
  filePath: string,
  editor: Editor,
  view: MarkdownView,
  skeletonStart: number,
  skeletonEnd: number,
  writeOffset: number,
): Stream {
  const stream = new Stream(streamId, filePath, editor, view);
  stream.skeletonStart = skeletonStart;
  stream.skeletonEnd = skeletonEnd;
  stream.writeOffset = writeOffset;
  stream.lastKnownLength = editor.getValue().length;
  stream.lastKnownContent = editor.getValue();
  return stream;
}

describe("Stream", () => {
  it("creates with initial state", () => {
    const editor = new Editor();
    editor.setValue("test");
    const view = createMockView("test.md");
    const stream = new Stream("s1", "test.md", editor, view);

    expect(stream.streamId).toBe("s1");
    expect(stream.filePath).toBe("test.md");
    expect(stream.isAborted).toBe(false);
  });

  it("can be aborted with error", () => {
    const editor = new Editor();
    editor.setValue("test");
    const view = createMockView("test.md");
    const stream = new Stream("s1", "test.md", editor, view);

    stream.abortWithError("Test error");

    expect(stream.isAborted).toBe(true);
    expect(stream.abort.signal.aborted).toBe(true);
  });
});

describe("StreamManager", () => {
  it("adds streams correctly", () => {
    const editor = new Editor();
    editor.setValue("content");
    const view = createMockView("test.md");
    const manager = new StreamManager({ app: { workspace: {} } as any });

    const stream = new Stream("s1", "test.md", editor, view);
    const added = manager.addStream(stream);

    expect(added).toBe(true);
    expect(manager.activeStreamCount).toBe(1);
  });

  it("rejects stream when at capacity (8 streams)", () => {
    const editor = new Editor();
    editor.setValue("content");
    const view = createMockView("test.md");
    const manager = new StreamManager({ app: { workspace: {} } as any });

    for (let i = 0; i < 8; i++) {
      const stream = new Stream(`s${i}`, "test.md", editor, view);
      expect(manager.addStream(stream)).toBe(true);
    }

    const overflowStream = new Stream("overflow", "test.md", editor, view);
    expect(manager.addStream(overflowStream)).toBe(false);
  });

  it("removes stream correctly", () => {
    const editor = new Editor();
    editor.setValue("content");
    const view = createMockView("test.md");
    const manager = new StreamManager({ app: { workspace: {} } as any });

    const stream = new Stream("s1", "test.md", editor, view);
    manager.addStream(stream);
    expect(manager.activeStreamCount).toBe(1);

    manager.removeStream("s1");
    expect(manager.activeStreamCount).toBe(0);
  });

  it("gets stream by id", () => {
    const editor = new Editor();
    editor.setValue("content");
    const view = createMockView("test.md");
    const manager = new StreamManager({ app: { workspace: {} } as any });

    const stream = new Stream("s1", "test.md", editor, view);
    manager.addStream(stream);

    expect(manager.getStream("s1")).toBe(stream);
    expect(manager.getStream("nonexistent")).toBeUndefined();
  });
});

describe("Stream.applyExternalEdit", () => {
  it("returns 'shift' when edit is before write point", () => {
    const editor = new Editor();
    editor.setValue("AAAAFFFF");
    const view = createMockView("test.md");
    const stream = createStreamWithState(
      "s1",
      "test.md",
      editor,
      view,
      5,
      10,
      10,
    );

    const result = stream.applyExternalEdit(4, 0);

    expect(result).toBe("shift");
    expect(stream.writeOffset).toBe(14);
  });

  it("returns 'shift' when edit is just before writeOffset", () => {
    const editor = new Editor();
    editor.setValue("AAAAFFFF");
    const view = createMockView("test.md");
    const stream = createStreamWithState(
      "s1",
      "test.md",
      editor,
      view,
      4,
      8,
      10,
    );

    const result = stream.applyExternalEdit(3, 0);

    expect(result).toBe("shift");
    expect(stream.writeOffset).toBe(13);
  });

  it("returns 'abort' when edit is inside skeleton range", () => {
    const editor = new Editor();
    editor.setValue("Hello world");
    const view = createMockView("test.md");
    const stream = createStreamWithState(
      "s1",
      "test.md",
      editor,
      view,
      5,
      67,
      70,
    );

    const result = stream.applyExternalEdit(3, 30);

    expect(result).toBe("abort");
    expect(stream.isAborted).toBe(true);
    expect(stream.abort.signal.aborted).toBe(true);
  });

  it("returns 'none' when edit is after write point", () => {
    const editor = new Editor();
    editor.setValue("Hello world");
    const view = createMockView("test.md");
    const stream = createStreamWithState(
      "s1",
      "test.md",
      editor,
      view,
      5,
      67,
      67,
    );

    const originalWriteOffset = stream.writeOffset;
    const result = stream.applyExternalEdit(5, 100);

    expect(result).toBe("none");
    expect(stream.writeOffset).toBe(originalWriteOffset);
  });

  it("returns 'none' when inRangeWriteInProgress is true", () => {
    const editor = new Editor();
    editor.setValue("Hello world");
    const view = createMockView("test.md");
    const stream = createStreamWithState(
      "s1",
      "test.md",
      editor,
      view,
      5,
      67,
      67,
    );
    stream.inRangeWriteInProgress = true;

    const result = stream.applyExternalEdit(4, 0);

    expect(result).toBe("none");
  });

  it("handles deletion (negative delta) before write point", () => {
    const editor = new Editor();
    editor.setValue("AAAAFFFF");
    const view = createMockView("test.md");
    const stream = createStreamWithState(
      "s1",
      "test.md",
      editor,
      view,
      4,
      8,
      8,
    );

    const result = stream.applyExternalEdit(-4, 0);

    expect(result).toBe("shift");
    expect(stream.writeOffset).toBe(4);
    expect(stream.skeletonStart).toBe(0);
    expect(stream.skeletonEnd).toBe(4);
  });

  it("returns 'shift' for edit at skeletonStart but before writeOffset", () => {
    const editor = new Editor();
    editor.setValue("AAAAFFFF");
    const view = createMockView("test.md");
    const stream = createStreamWithState(
      "s1",
      "test.md",
      editor,
      view,
      4,
      10,
      10,
    );

    const result = stream.applyExternalEdit(2, 0);

    expect(result).toBe("shift");
    expect(stream.writeOffset).toBe(12);
    expect(stream.skeletonStart).toBe(6);
    expect(stream.skeletonEnd).toBe(12);
  });
});

describe("StreamManager.handleEditorChange", () => {
  it("shifts offsets when edit is before write point", () => {
    const editor = new Editor();
    editor.setValue("AAAA");
    const view = createMockView("test.md");
    const stream = createStreamWithState(
      "s1",
      "test.md",
      editor,
      view,
      4,
      15,
      15,
    );

    const manager = new StreamManager({ app: { workspace: {} } as any });
    manager.addStream(stream);

    editor.replaceRange(">>> ", { line: 0, ch: 0 });
    manager.handleEditorChange(editor, "test.md");

    expect(stream.writeOffset).toBe(19);
    expect(stream.skeletonStart).toBe(8);
  });

  it("aborts stream when edit is inside skeleton range", () => {
    const editor = new Editor();
    editor.setValue("AAAA");
    const view = createMockView("test.md");
    const stream = createStreamWithState(
      "s1",
      "test.md",
      editor,
      view,
      4,
      15,
      20,
    );

    const manager = new StreamManager({ app: { workspace: {} } as any });
    manager.addStream(stream);

    editor.replaceRange("XXX", { line: 0, ch: 8 });
    manager.handleEditorChange(editor, "test.md");

    expect(stream.isAborted).toBe(true);
  });

  it("does not change offsets when edit is between writeOffset and skeletonEnd", () => {
    const editor = new Editor();
    editor.setValue("AAAA");
    const view = createMockView("test.md");
    const stream = createStreamWithState(
      "s1",
      "test.md",
      editor,
      view,
      4,
      8,
      8,
    );

    const manager = new StreamManager({ app: { workspace: {} } as any });
    manager.addStream(stream);

    const originalWriteOffset = stream.writeOffset;
    const originalSkeletonStart = stream.skeletonStart;
    const originalSkeletonEnd = stream.skeletonEnd;

    editor.replaceRange("XX", { line: 0, ch: 10 });
    manager.handleEditorChange(editor, "test.md");

    expect(stream.writeOffset).toBe(originalWriteOffset);
    expect(stream.skeletonStart).toBe(originalSkeletonStart);
    expect(stream.skeletonEnd).toBe(originalSkeletonEnd);
  });

  it("ignores edits from different file", () => {
    const editor1 = new Editor();
    editor1.setValue("AAAA");
    const editor2 = new Editor();
    editor2.setValue("BBBB");

    const view1 = createMockView("doc1.md");
    const view2 = createMockView("doc2.md");

    const stream1 = createStreamWithState(
      "s1",
      "doc1.md",
      editor1,
      view1,
      4,
      15,
      15,
    );
    const stream2 = createStreamWithState(
      "s2",
      "doc2.md",
      editor2,
      view2,
      0,
      10,
      10,
    );

    const manager = new StreamManager({ app: { workspace: {} } as any });
    manager.addStream(stream1);
    manager.addStream(stream2);

    editor1.replaceRange("XXX", { line: 0, ch: 0 });
    manager.handleEditorChange(editor1, "doc1.md");

    expect(stream1.writeOffset).toBe(18);
    expect(stream2.writeOffset).toBe(10);
  });

  it("two streams in different notes do not affect each other", () => {
    const editor1 = new Editor();
    editor1.setValue("AAAA");
    const editor2 = new Editor();
    editor2.setValue("BBBB");

    const view1 = createMockView("doc1.md");
    const view2 = createMockView("doc2.md");

    const stream1 = createStreamWithState(
      "s1",
      "doc1.md",
      editor1,
      view1,
      4,
      15,
      15,
    );
    const stream2 = createStreamWithState(
      "s2",
      "doc2.md",
      editor2,
      view2,
      0,
      10,
      10,
    );

    const manager = new StreamManager({ app: { workspace: {} } as any });
    manager.addStream(stream1);
    manager.addStream(stream2);

    const originalOffset1 = stream1.writeOffset;
    const originalOffset2 = stream2.writeOffset;

    editor1.replaceRange("XXX", { line: 0, ch: 0 });
    manager.handleEditorChange(editor1, "doc1.md");

    expect(stream1.writeOffset).toBe(originalOffset1 + 3);
    expect(stream2.writeOffset).toBe(originalOffset2);
  });
});

import { describe, it, expect } from "vitest";
import { parseSseStream } from "../../src/llm/sse.ts";

async function collectChunks(chunks: string[]): Promise<string[]> {
  const stream = new ReadableStream<Uint8Array>({
    pull(controller) {
      if (chunks.length === 0) {
        controller.close();
        return;
      }
      const chunk = chunks.shift()!;
      controller.enqueue(new TextEncoder().encode(chunk));
      if (chunks.length === 0) {
        controller.close();
      }
    },
  });

  const resp = new Response(stream);
  const result: string[] = [];
  for await (const chunk of parseSseStream(resp)) {
    result.push(chunk);
  }
  return result;
}

describe("parseSseStream", () => {
  it("yields content from a single SSE event", async () => {
    const chunks = await collectChunks([
      'data: {"choices":[{"delta":{"content":"hello"}}]}\n\n',
    ]);
    expect(chunks).toEqual(["hello"]);
  });

  it("handles [DONE] event and stops", async () => {
    const chunks = await collectChunks([
      'data: {"choices":[{"delta":{"content":"hello"}}]}\n\n',
      "data: [DONE]\n\n",
    ]);
    expect(chunks).toEqual(["hello"]);
  });

  it("ignores malformed JSON and continues", async () => {
    const chunks = await collectChunks([
      "data: not-json\n\n",
      'data: {"choices":[{"delta":{"content":"hello"}}]}\n\n',
    ]);
    expect(chunks).toEqual(["hello"]);
  });

  it("ignores empty delta", async () => {
    const chunks = await collectChunks([
      'data: {"choices":[{"delta":{"content":""}}]}\n\n',
      'data: {"choices":[{"delta":{"content":"hello"}}]}\n\n',
    ]);
    expect(chunks).toEqual(["hello"]);
  });

  it("handles two complete events in sequence", async () => {
    const chunks = await collectChunks([
      'data: {"choices":[{"delta":{"content":"hello"}}]}\n\n',
      'data: {"choices":[{"delta":{"content":"world"}}]}\n\n',
    ]);
    expect(chunks).toEqual(["hello", "world"]);
  });

  it("handles two data lines within one event (joined per SSE spec)", async () => {
    const chunks = await collectChunks([
      'data: {"choices":[{"delta":{"content":"one"}}]}\ndata: {"choices":[{"delta":{"content":"two"}}]}\n\n',
    ]);
    expect(chunks).toEqual(["one", "two"]);
  });

  it("yields from deeply nested delta content", async () => {
    const chunks = await collectChunks([
      'data: {"choices":[{"delta":{"content":"nested"}}]}\n\n',
    ]);
    expect(chunks).toEqual(["nested"]);
  });

  it("skips lines not starting with data:", async () => {
    const chunks = await collectChunks([
      'event: message\ndata: {"choices":[{"delta":{"content":"hello"}}]}\n\n',
    ]);
    expect(chunks).toEqual(["hello"]);
  });

  it("handles JSON split across chunks without \\n\\n until end", async () => {
    const chunks = await collectChunks([
      'data: {"choices":[{"delta":{"content":"hel',
      'lo"}}]}\n\n',
    ]);
    expect(chunks).toEqual(["hello"]);
  });

  it("handles multiple network chunks completing one event", async () => {
    const chunks = await collectChunks([
      "da",
      "ta: ",
      '{"choices":[{"delta":{"content":"hi',
      '"}}]',
      "}\n\n",
    ]);
    expect(chunks).toEqual(["hi"]);
  });

  it("handles CRLF-delimited SSE events", async () => {
    const chunks = await collectChunks([
      'data: {"choices":[{"delta":{"content":"hello"}}]}\r\n\r\n',
      'data: {"choices":[{"delta":{"content":"world"}}]}\r\n\r\n',
    ]);
    expect(chunks).toEqual(["hello", "world"]);
  });

  it("flushes a final buffered event at EOF without a trailing blank line", async () => {
    const chunks = await collectChunks([
      'data: {"choices":[{"delta":{"content":"tail"}}]}',
    ]);
    expect(chunks).toEqual(["tail"]);
  });
});

/** End-to-end mobile adapter -> real HTTP routes -> fake generation (no paid calls). */
import { expect, it, vi } from "vitest";
import { once } from "node:events";
vi.mock("obsidian", async (original) => ({
  ...(await original<object>()),
  requestUrl: async (opts: any) => {
    const result = await fetch(opts.url, {
      method: opts.method,
      headers: opts.headers,
      body: opts.body,
    });
    const json = await result.json();
    // Simulate a dropped POST response after the server has already generated the result.
    if (opts.method === "POST" && result.status === 202)
      throw new Error("connection lost");
    return { status: result.status, json };
  },
}));
import { createBridge } from "../../bridge/src/server";
import { PiBridgeClient } from "../../src/llm/piBridge";

it("recovers a lost create response through actual HTTP without a second generation", async () => {
  const token = "c".repeat(43);
  const model = "openai-codex/fake";
  let generations = 0;
  const server = createBridge({
    token,
    engine: {
      health: async () => ({ authReady: true, models: [model] }),
      generate: async (req, _signal, onText) => {
        generations++;
        expect(req.user).toBe("Selected note");
        onText("Answer from Mac");
        return { totalTokens: 4 };
      },
    },
  });
  server.listen(0, "127.0.0.1");
  await once(server, "listening");
  try {
    const port = (server.address() as { port: number }).port;
    const client = new PiBridgeClient(token, `http://127.0.0.1:${port}`);
    const events = [];
    for await (const event of client.stream(
      {
        model,
        system: "Study",
        user: "Selected note",
        temperature: 1,
        maxTokens: 1000,
        reasoningEnabled: true,
        reasoningEffort: "medium",
      },
      new AbortController().signal,
    ))
      events.push(event);
    expect(generations).toBe(1);
    expect(events).toEqual([
      { type: "content", text: "Answer from Mac" },
      { type: "metadata", usage: { totalTokens: 4 } },
    ]);
  } finally {
    server.closeAllConnections();
    server.close();
    await once(server, "close");
  }
});

import { afterEach, describe, expect, it, vi } from "vitest";
import { OpenRouterClient } from "../../src/llm/openrouter";

describe("OpenRouterClient", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
  });

  it("disables reasoning and uses max_completion_tokens", async () => {
    const fetchMock = vi.fn().mockResolvedValue(
      new Response(
        new ReadableStream<Uint8Array>({
          start(controller) {
            controller.enqueue(
              new TextEncoder().encode(
                'data: {"choices":[{"delta":{"content":"hello"}}]}\n\n' +
                  "data: [DONE]\n\n",
              ),
            );
            controller.close();
          },
        }),
      ),
    );

    vi.stubGlobal("fetch", fetchMock);

    const client = new OpenRouterClient("test-key");
    const chunks: string[] = [];
    for await (const chunk of client.stream(
      {
        model: "z-ai/glm-5.1",
        temperature: 0.7,
        maxTokens: 512,
        reasoningEnabled: false,
        reasoningEffort: "medium",
        system: "system prompt",
        user: "user prompt",
      },
      new AbortController().signal,
    )) {
      chunks.push(chunk);
    }

    expect(chunks).toEqual(["hello"]);
    expect(fetchMock).toHaveBeenCalledTimes(1);

    const [, init] = fetchMock.mock.calls[0];
    const body = JSON.parse(String(init?.body));

    expect(body.max_completion_tokens).toBe(512);
    expect(body.max_tokens).toBeUndefined();
    expect(body.reasoning).toEqual({ effort: "none", exclude: true });
  });
});

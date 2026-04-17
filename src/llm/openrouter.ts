import { LlmClient, LlmRequest } from "./client";
import { parseSseStream } from "./sse";

export class OpenRouterClient implements LlmClient {
  constructor(private apiKey: string) {}

  async *stream(req: LlmRequest, signal: AbortSignal): AsyncGenerator<string> {
    const resp = await fetch("https://openrouter.ai/api/v1/chat/completions", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${this.apiKey}`,
        "Content-Type": "application/json",
        "HTTP-Referer": "https://obsidian.md/plugins/scholia",
        "X-Title": "Scholia",
      },
      body: JSON.stringify({
        model: req.model,
        temperature: req.temperature,
        max_tokens: req.maxTokens,
        stream: true,
        messages: [
          { role: "system", content: req.system },
          { role: "user", content: req.user },
        ],
      }),
      signal,
    });
    if (!resp.ok)
      throw new Error(`OpenRouter ${resp.status}: ${await resp.text()}`);
    yield* parseSseStream(resp);
  }
}

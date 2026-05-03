import type { LlmCost, LlmStreamEvent, LlmUsage } from "./client";

function toNumber(value: unknown): number | undefined {
  if (typeof value === "number" && Number.isFinite(value)) return value;
  if (typeof value === "string" && value.trim() !== "") {
    const parsed = Number(value);
    return Number.isFinite(parsed) ? parsed : undefined;
  }
  return undefined;
}

function extractUsage(json: unknown): LlmUsage | undefined {
  const usage = (json as { usage?: Record<string, unknown> })?.usage;
  if (!usage) return undefined;

  const promptTokens = toNumber(usage.prompt_tokens);
  const completionTokens = toNumber(usage.completion_tokens);
  const totalTokens = toNumber(usage.total_tokens);
  const details = usage.completion_tokens_details as Record<string, unknown> | undefined;
  const promptDetails = usage.prompt_tokens_details as Record<string, unknown> | undefined;

  return {
    promptTokens,
    completionTokens,
    totalTokens,
    reasoningTokens: toNumber(details?.reasoning_tokens),
    cachedTokens: toNumber(promptDetails?.cached_tokens),
  };
}

function extractCost(json: unknown): LlmCost | undefined {
  const raw = json as Record<string, unknown>;
  const usage = raw.usage as Record<string, unknown> | undefined;
  const amount =
    toNumber(raw.cost) ??
    toNumber(raw.total_cost) ??
    toNumber(raw.totalCost) ??
    toNumber(usage?.cost) ??
    toNumber(usage?.total_cost);
  if (amount === undefined) return undefined;

  return {
    amount,
    currency:
      typeof raw.currency === "string"
        ? raw.currency
        : typeof usage?.currency === "string"
          ? usage.currency
          : "USD",
    estimated:
      typeof raw.estimated === "boolean"
        ? raw.estimated
        : typeof usage?.estimated === "boolean"
          ? usage.estimated
          : false,
  };
}

async function* processEvent(event: string): AsyncGenerator<LlmStreamEvent> {
  for (const rawLine of event.split("\n")) {
    const line = rawLine.replace(/\r$/, "");
    if (!line.startsWith("data:")) continue;

    const payload = line.slice(5).trimStart();
    if (payload === "[DONE]") return;

    try {
      const json = JSON.parse(payload);
      const delta = json?.choices?.[0]?.delta?.content;
      if (typeof delta === "string" && delta.length > 0) {
        yield { type: "content", text: delta };
      }
      const usage = extractUsage(json);
      const cost = extractCost(json);
      if (usage || cost) {
        yield { type: "metadata", usage, cost, providerRaw: json };
      }
    } catch {
      // Ignore malformed JSON payloads and continue.
    }
  }
}

export async function* parseSseStream(resp: Response): AsyncGenerator<LlmStreamEvent> {
  const reader = resp.body!.getReader();
  const decoder = new TextDecoder("utf-8");
  let buffer = "";

  while (true) {
    const { done, value } = await reader.read();
    if (done) {
      buffer += decoder.decode();
      break;
    }

    buffer += decoder.decode(value, { stream: true });

    let eventEnd = buffer.search(/\r?\n\r?\n/);
    while (eventEnd !== -1) {
      const separatorMatch = buffer.slice(eventEnd).match(/^\r?\n\r?\n/);
      const separatorLength = separatorMatch?.[0].length ?? 2;
      const event = buffer.slice(0, eventEnd);
      buffer = buffer.slice(eventEnd + separatorLength);

      for await (const chunk of processEvent(event)) {
        yield chunk;
      }

      eventEnd = buffer.search(/\r?\n\r?\n/);
    }
  }

  if (buffer.trim().length > 0) {
    for await (const chunk of processEvent(buffer)) {
      yield chunk;
    }
  }
}

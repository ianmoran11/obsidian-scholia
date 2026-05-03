export interface LlmRequest {
  model: string;
  temperature: number;
  maxTokens: number;
  reasoningEnabled: boolean;
  reasoningEffort: "none" | "minimal" | "low" | "medium" | "high" | "xhigh";
  system: string;
  user: string;
}

export interface LlmUsage {
  promptTokens?: number;
  completionTokens?: number;
  totalTokens?: number;
  reasoningTokens?: number;
  cachedTokens?: number;
}

export interface LlmCost {
  amount?: number;
  currency?: string;
  estimated?: boolean;
}

export type LlmStreamEvent =
  | { type: "content"; text: string }
  | { type: "metadata"; usage?: LlmUsage; cost?: LlmCost; providerRaw?: unknown };

export interface LlmClient {
  stream(req: LlmRequest, signal: AbortSignal): AsyncGenerator<LlmStreamEvent>;
}

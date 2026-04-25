export interface LlmRequest {
  model: string;
  temperature: number;
  maxTokens: number;
  reasoningEnabled: boolean;
  reasoningEffort: "none" | "minimal" | "low" | "medium" | "high" | "xhigh";
  system: string;
  user: string;
}

export interface LlmClient {
  stream(req: LlmRequest, signal: AbortSignal): AsyncGenerator<string>;
}

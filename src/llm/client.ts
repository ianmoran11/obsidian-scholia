export interface LlmRequest {
  model: string;
  temperature: number;
  maxTokens: number;
  system: string;
  user: string;
}

export interface LlmClient {
  stream(req: LlmRequest, signal: AbortSignal): AsyncGenerator<string>;
}

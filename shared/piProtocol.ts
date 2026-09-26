/** Version 1 of the private Scholia bridge protocol. No provider credentials cross it. */
export interface PiRequest {
  model: string; // openai-codex/<model-id>
  system: string;
  user: string;
  thinking: "off" | "minimal" | "low" | "medium" | "high" | "xhigh";
}
export interface PiUsage {
  promptTokens?: number;
  completionTokens?: number;
  totalTokens?: number;
  cachedTokens?: number;
}
export interface PiHealth {
  version: 1;
  instanceId: string;
  authReady: boolean;
  models: string[];
}
export interface PiJobSnapshot {
  id: string;
  state: "running" | "complete" | "error" | "cancelled";
  offset: number;
  text: string;
  nextOffset: number;
  usage?: PiUsage;
  error?: string;
  expiresAt?: number;
}

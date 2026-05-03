import type { LlmCost, LlmRequest, LlmUsage } from "./client";
import type { ContextScope, ReasoningEffort } from "../templates/types";

export interface LlmRunMetadata {
  id: string;
  timestamp: string;
  provider: "openrouter";
  model: string;
  temperature: number;
  maxTokens: number;
  reasoningEnabled: boolean;
  reasoningEffort: ReasoningEffort;
  contextScope: ContextScope;
  templateName: string;
  promptTokens?: number;
  completionTokens?: number;
  totalTokens?: number;
  reasoningTokens?: number;
  cachedTokens?: number;
  cost?: LlmCost;
  durationMs: number;
}

export function buildRunMetadata(
  req: LlmRequest,
  opts: {
    id: string;
    timestamp: string;
    contextScope: ContextScope;
    templateName: string;
    durationMs: number;
    usage?: LlmUsage;
    cost?: LlmCost;
  },
): LlmRunMetadata {
  return {
    id: opts.id,
    timestamp: opts.timestamp,
    provider: "openrouter",
    model: req.model,
    temperature: req.temperature,
    maxTokens: req.maxTokens,
    reasoningEnabled: req.reasoningEnabled,
    reasoningEffort: req.reasoningEffort,
    contextScope: opts.contextScope,
    templateName: opts.templateName,
    promptTokens: opts.usage?.promptTokens,
    completionTokens: opts.usage?.completionTokens,
    totalTokens: opts.usage?.totalTokens,
    reasoningTokens: opts.usage?.reasoningTokens,
    cachedTokens: opts.usage?.cachedTokens,
    cost: opts.cost,
    durationMs: opts.durationMs,
  };
}

function fmtNum(value: number | undefined): string {
  return value === undefined ? "unavailable" : String(value);
}

function fmtCost(cost: LlmCost | undefined): string {
  if (cost?.amount === undefined) return "unavailable";
  const currency = cost.currency ?? "USD";
  const prefix = currency.toUpperCase() === "USD" ? "$" : `${currency} `;
  const amount = cost.amount < 0.01 ? cost.amount.toFixed(6) : cost.amount.toFixed(4);
  return `${cost.estimated ? "estimated " : ""}${prefix}${amount}`;
}

export function formatRunMetadataLine(metadata: LlmRunMetadata): string {
  const duration = `${(metadata.durationMs / 1000).toFixed(1)}s`;
  return [
    `model=${metadata.model}`,
    `prompt_tokens=${fmtNum(metadata.promptTokens)}`,
    `completion_tokens=${fmtNum(metadata.completionTokens)}`,
    `tokens=${fmtNum(metadata.totalTokens)}`,
    `cost=${fmtCost(metadata.cost)}`,
    `duration=${duration}`,
    `provider=${metadata.provider}`,
  ].join("; ");
}

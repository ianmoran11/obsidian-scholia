import type { ScholiaSettings } from "../settings";
import type { LlmClient, LlmRequest } from "./client";
import { OpenRouterClient } from "./openrouter";
import {
  PiBridgeClient,
  validateBridgeToken,
  validateBridgeUrl,
} from "./piBridge";

export function backendError(settings: ScholiaSettings): string | undefined {
  try {
    if (
      settings.llmBackend !== undefined &&
      settings.llmBackend !== "openrouter" &&
      settings.llmBackend !== "pi"
    ) {
      return "Unknown AI backend. Select OpenRouter or Pi in Settings.";
    }
    if (settings.llmBackend === "pi") {
      validateBridgeUrl(settings.piBridgeUrl);
      validateBridgeToken(settings.piBridgeToken);
    } else if (!settings.openRouterApiKey)
      return "OpenRouter API key not set. Configure in Settings.";
  } catch (error) {
    return error instanceof Error ? error.message : "Invalid backend settings.";
  }
}
export function createLlmClient(settings: ScholiaSettings): LlmClient {
  const error = backendError(settings);
  if (error) throw new Error(error);
  return settings.llmBackend === "pi"
    ? new PiBridgeClient(settings.piBridgeToken, settings.piBridgeUrl)
    : new OpenRouterClient(settings.openRouterApiKey);
}
export function resolveModel(
  settings: ScholiaSettings,
  override?: string,
): string {
  const pi = settings.llmBackend === "pi";
  const model = (
    override ?? (pi ? settings.piModel : settings.defaultModel)
  ).trim();
  if (
    pi
      ? !/^openai-codex\/[a-zA-Z0-9._-]+$/.test(model)
      : model.startsWith("openai-codex/")
  ) {
    throw new Error(
      pi
        ? "Pi requires openai-codex/<model>. Remove the OpenRouter model override from this template, or choose OpenRouter in Settings."
        : "This template/callout uses a Pi Codex model. Select Pi in Settings or remove its model override.",
    );
  }
  return model;
}
export function applyBackend(
  settings: ScholiaSettings,
  request: LlmRequest,
): LlmRequest {
  const pi = settings.llmBackend === "pi";
  return {
    ...request,
    provider: pi ? "openai-codex" : "openrouter",
    ...(pi
      ? { reasoningEnabled: true, reasoningEffort: "medium" as const }
      : {}),
  };
}

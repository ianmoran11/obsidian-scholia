import type { ScholiaSettings } from "../settings";
import type { LlmClient, LlmProvider, LlmRequest } from "./client";
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
  source: "template" | "callout" = "template",
  snapshotProvider?: LlmProvider,
): string {
  const pi = settings.llmBackend === "pi";
  const model = (
    override ?? (pi ? settings.piModel : settings.defaultModel)
  ).trim();
  if (
    (source === "callout" &&
      snapshotProvider !== undefined &&
      snapshotProvider !== (pi ? "openai-codex" : "openrouter")) ||
    (pi
      ? !/^openai-codex\/[a-zA-Z0-9._-]+$/.test(model)
      : model.startsWith("openai-codex/"))
  ) {
    if (source === "callout") {
      throw new Error(
        "This old callout snapshot is incompatible with the selected backend. Restore its original backend in Settings to regenerate, or run the template anew to use your current model. Editing a template does not change old snapshots.",
      );
    }
    if (override === undefined) {
      throw new Error(
        pi
          ? "Invalid Pi default model setting. Set Pi model in Settings to openai-codex/<model> (for example openai-codex/gpt-5.5)."
          : "Invalid OpenRouter default model setting: a Pi Codex model requires Pi. Update the OpenRouter model or select Pi in Settings.",
      );
    }
    throw new Error(
      pi
        ? "This template's model override is incompatible with Pi (requires openai-codex/<model>). Remove or update the model in the template YAML to use Pi, or select OpenRouter in Settings."
        : "This template's model override uses a Pi Codex model. Select Pi in Settings or update/remove the template model override.",
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

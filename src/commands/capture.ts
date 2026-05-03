import { App, Notice } from "obsidian";
import type { OpenRouterClient } from "../llm/openrouter";
import type { LlmCost, LlmRequest, LlmUsage } from "../llm/client";
import { buildRunMetadata } from "../llm/metadata";
import type { LlmRunMetadata } from "../llm/metadata";
import type { TemplateConfig } from "../templates/types";
import { appendToVault } from "../storage/appendFile";
import { NoopSqliteStore } from "../storage/sqlite";

const sqliteStore = new NoopSqliteStore();

export class CaptureRunner {
  private app: App;

  constructor(app: App) {
    this.app = app;
  }

  async runWithCapture(
    llmClient: OpenRouterClient,
    llmRequest: LlmRequest,
    config: TemplateConfig,
    abortSignal: AbortSignal,
    onChunk: (chunk: string) => Promise<void>,
    sourcePath: string | undefined,
    templateName: string | undefined,
    question?: string,
  ): Promise<LlmRunMetadata> {
    let accumulatedContent = "";
    let usage: LlmUsage | undefined;
    let cost: LlmCost | undefined;
    const runId = `scholia-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
    const startedAt = Date.now();
    const timestamp = new Date(startedAt).toISOString();

    try {
      for await (const event of llmClient.stream(llmRequest, abortSignal)) {
        if (abortSignal.aborted) {
          throw abortSignal.reason instanceof Error
            ? abortSignal.reason
            : new Error("Stream aborted");
        }
        if (event.type === "content") {
          accumulatedContent += event.text;
          await onChunk(event.text);
        } else {
          usage = event.usage ?? usage;
          cost = event.cost ?? cost;
        }
      }

      if (abortSignal.aborted) {
        throw abortSignal.reason instanceof Error
          ? abortSignal.reason
          : new Error("Stream aborted");
      }

      const metadata = buildRunMetadata(llmRequest, {
        id: runId,
        timestamp,
        contextScope: config.contextScope,
        templateName: templateName ?? "",
        durationMs: Date.now() - startedAt,
        usage,
        cost,
      });

      if (config.alsoAppendTo) {
        await appendToVault(this.app.vault, {
          relativePath: config.alsoAppendTo,
          content: accumulatedContent,
          format: config.appendFormat ?? "markdown",
          sourcePath,
          templateName,
          metadata,
          question,
        });
        new Notice(`Scholia: captured to ${config.alsoAppendTo}`);
      }

      await sqliteStore.insertCapture({
        id: runId,
        ts: new Date().toISOString(),
        sourcePath: sourcePath ?? "",
        template: templateName ?? "",
        content: accumulatedContent,
        scope: config.contextScope,
        model: llmRequest.model,
      });

      return metadata;
    } catch (err) {
      if (!abortSignal.aborted) {
        new Notice(
          `Scholia: ${err instanceof Error ? err.message : "Stream failed"}`,
        );
      }
      throw err;
    }
  }
}

import { App, Notice } from "obsidian";
import type { OpenRouterClient } from "../llm/openrouter";
import type { LlmRequest } from "../llm/client";
import type { TemplateConfig } from "../templates/types";
import { appendToVault } from "../storage/appendFile";

export class CaptureRunner {
  private app: App;

  constructor(app: App) {
    this.app = app;
  }

  async runWithCapture(
    llmClient: OpenRouterClient,
    llmRequest: LlmRequest,
    config: TemplateConfig,
    onChunk: (chunk: string) => Promise<void>,
    sourcePath: string | undefined,
    templateName: string | undefined,
  ): Promise<void> {
    let accumulatedContent = "";
    const abortController = new AbortController();

    try {
      for await (const chunk of llmClient.stream(
        llmRequest,
        abortController.signal,
      )) {
        accumulatedContent += chunk;
        await onChunk(chunk);
      }

      if (config.alsoAppendTo) {
        await appendToVault(this.app.vault, {
          relativePath: config.alsoAppendTo,
          content: accumulatedContent,
          format: config.appendFormat ?? "markdown",
          sourcePath,
          templateName,
        });
        new Notice(`Scholia: captured to ${config.alsoAppendTo}`);
      }
    } catch (err) {
      if (!abortController.signal.aborted) {
        new Notice(
          `Scholia: ${err instanceof Error ? err.message : "Stream failed"}`,
        );
      }
      throw err;
    }
  }
}

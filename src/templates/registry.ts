import {
  App,
  Command,
  MarkdownView,
  Notice,
  TFile,
  parseYaml,
} from "obsidian";
import { debounce } from "../util/debounce";
import { removeCommand } from "../util/removeCommand";
import { buildCommandId } from "../util/ids";
import { parseFrontmatter, ParseResult } from "./frontmatter";
import type { TemplateConfig } from "./types";
import { Stream } from "../stream/stream";
import { StreamManager } from "../stream/manager";
import { OpenRouterClient } from "../llm/openrouter";
import { LlmRequest } from "../llm/client";
import { extractContext } from "../context/extractor";
import { appendToVault } from "../storage/appendFile";
import { formatError } from "../stream/callout";
import { CustomProbeModal } from "../ui/modal";
import { CaptureRunner } from "../commands/capture";

interface PluginRef {
  app: App;
  addCommand: (command: Command) => Command;
  settings: {
    openRouterApiKey: string;
    templatesFolder: string;
    defaultCalloutType: string;
    defaultModel: string;
    defaultTemperature: number;
    defaultMaxTokens: number;
    centralCaptureFile: string;
    enableHotReloadOfTemplates: boolean;
  };
}

interface RegisteredTemplate {
  file: TFile;
  config: TemplateConfig;
  commandId: string;
}

export class TemplateRegistry {
  private templates: Map<string, RegisteredTemplate> = new Map();
  private app: App;
  private plugin: PluginRef;
  private streamManager: StreamManager;

  constructor(app: App, plugin: PluginRef, streamManager: StreamManager) {
    this.app = app;
    this.plugin = plugin;
    this.streamManager = streamManager;
  }

  async load(): Promise<void> {
    const folder = this.app.vault.getFolderByPath(
      this.plugin.settings.templatesFolder,
    );
    if (!folder) {
      return;
    }

    const files = this.app.vault.getMarkdownFiles();
    for (const file of files) {
      if (this.isInTemplatesFolder(file)) {
        await this.loadTemplate(file);
      }
    }
  }

  private isInTemplatesFolder(file: TFile): boolean {
    const folderPath = this.plugin.settings.templatesFolder;
    return file.path.startsWith(folderPath + "/");
  }

  private async loadTemplate(file: TFile): Promise<boolean> {
    const result = await this.parseTemplate(file);
    if (!result || !result.isValid) {
      return false;
    }

    const { config } = result;
    const rawCommandId = buildCommandId(file.path);
    const templateName = this.getTemplateName(file.path);

    const command: Command = {
      id: rawCommandId,
      name: `${config.commandPrefix}: ${templateName}`,
      callback: () => {
        this.runTemplateCommand(file.path, config, templateName);
      },
    };

    if (config.hotkey && config.hotkey.length > 0) {
      (command as Command & { hotkeys: unknown[] }).hotkeys = config.hotkey;
    }

    const registered = this.plugin.addCommand(command);
    // Plugin.addCommand prefixes the id with the plugin id (e.g. "scholia:...")
    const commandId = registered.id;

    this.templates.set(file.path, {
      file,
      config,
      commandId,
    });

    return true;
  }

  private async parseTemplate(file: TFile): Promise<ParseResult | null> {
    const content = await this.app.vault.read(file);
    const parts = content.split(/^---$/m);
    if (parts.length < 3) {
      new Notice(
        `Scholia template invalid: ${file.path} — missing frontmatter separator`,
      );
      return null;
    }

    let rawFrontmatter: Record<string, unknown> = {};
    try {
      const cachedFrontmatter = this.app.metadataCache.getFileCache(file)?.frontmatter;
      if (cachedFrontmatter) {
        rawFrontmatter = cachedFrontmatter;
      } else {
        rawFrontmatter = parseYaml(parts[1]);
      }
    } catch {
      new Notice(
        `Scholia template invalid: ${file.path} — invalid YAML frontmatter`,
      );
      return null;
    }

    const systemPrompt = parts.slice(2).join("---").trim();

    return parseFrontmatter(
      rawFrontmatter as Parameters<typeof parseFrontmatter>[0],
      systemPrompt,
      file.path,
      this.plugin.settings.defaultCalloutType,
    );
  }

  private getTemplateName(filePath: string): string {
    const parts = filePath.split("/");
    const fileName = parts[parts.length - 1];
    return fileName.replace(/\.md$/, "");
  }

  reconcile = debounce(async () => {
    await this.doReconcile();
  }, 300);

  async doReconcile(): Promise<void> {
    const currentPaths = new Set<string>();
    const files = this.app.vault.getMarkdownFiles();

    for (const file of files) {
      if (this.isInTemplatesFolder(file)) {
        currentPaths.add(file.path);
      }
    }

    const registeredPaths = new Set(this.templates.keys());

    for (const path of registeredPaths) {
      if (!currentPaths.has(path)) {
        const existing = this.templates.get(path);
        if (existing) {
          removeCommand(this.app, existing.commandId);
          this.templates.delete(path);
        }
      }
    }

    for (const path of currentPaths) {
      if (!registeredPaths.has(path)) {
        const file = this.app.vault.getFileByPath(path);
        if (file) {
          await this.loadTemplate(file);
        }
      } else {
        const existing = this.templates.get(path);
        const file = this.app.vault.getFileByPath(path);
        if (existing && file && existing.file.stat.mtime !== file.stat.mtime) {
          removeCommand(this.app, existing.commandId);
          this.templates.delete(path);
          await this.loadTemplate(file);
        }
      }
    }
  }

  private async runTemplateCommand(
    templatePath: string,
    config: TemplateConfig,
    templateName: string,
  ): Promise<void> {
    const apiKey = this.plugin.settings.openRouterApiKey;
    if (!apiKey) {
      new Notice("Scholia: OpenRouter API key not set. Configure in Settings.");
      return;
    }

    const view = this.app.workspace.getActiveViewOfType(MarkdownView);
    if (!view) {
      new Notice("Scholia: No active note editor.");
      return;
    }

    const editor = view.editor;
    let effectiveScope = config.contextScope;
    let systemPrompt = config.systemPrompt;
    const effectiveConfig: TemplateConfig = { ...config };

    if (effectiveConfig.customProbe) {
      const modal = new CustomProbeModal(this.app, effectiveConfig);
      const result = await modal.openAndWait();

      if (!result) {
        return;
      }

      effectiveScope = result.scope;
      systemPrompt = `${effectiveConfig.systemPrompt}\n\nUser request: ${result.query}`;

      if (result.alsoAppendToCentral && !effectiveConfig.alsoAppendTo) {
        effectiveConfig.alsoAppendTo = this.plugin.settings.centralCaptureFile;
      }
    }

    const selection = editor.getSelection();

    if (effectiveConfig.requiresSelection && !selection) {
      new Notice("Scholia: Select text first.");
      return;
    }

    if (effectiveScope === "selection" && !selection) {
      new Notice("Scholia: Select text first.");
      return;
    }

    const contextText = extractContext(this.app, editor, view, effectiveScope);

    const model = effectiveConfig.model ?? this.plugin.settings.defaultModel;
    const temperature =
      effectiveConfig.temperature ?? this.plugin.settings.defaultTemperature;
    const maxTokens =
      effectiveConfig.maxTokens ?? this.plugin.settings.defaultMaxTokens;

    const llmClient = new OpenRouterClient(apiKey);
    const llmRequest: LlmRequest = {
      model,
      temperature,
      maxTokens,
      system: systemPrompt,
      user: contextText,
    };

    if (effectiveConfig.outputDestination === "inline") {
      await this.runInline(
        templateName,
        effectiveConfig,
        view,
        editor,
        selection,
        llmClient,
        llmRequest,
      );
    } else {
      await this.runAppend(
        templateName,
        effectiveConfig,
        view,
        llmClient,
        llmRequest,
      );
    }
  }

  private async runInline(
    templateName: string,
    config: TemplateConfig,
    view: MarkdownView,
    editor: import("obsidian").Editor,
    selection: string,
    llmClient: OpenRouterClient,
    llmRequest: LlmRequest,
  ): Promise<void> {
    const calloutType =
      config.calloutType ?? this.plugin.settings.defaultCalloutType;
    const calloutLabel = config.calloutLabel ?? templateName;
    const calloutFolded = config.calloutFolded ?? true;

    const selectionEnd = editor.getCursor("to");
    const posAfterSelection = {
      line: selectionEnd.line,
      ch: editor.getLine(selectionEnd.line).length,
    };

    const streamId = `scholia-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
    const stream = new Stream(streamId, view.file?.path ?? "", editor, view);

    if (!this.streamManager.addStream(stream)) {
      new Notice("Scholia: Too many concurrent streams. Please wait.");
      return;
    }

    stream.insertSkeleton(
      {
        calloutType,
        calloutLabel,
        folded: calloutFolded,
        commandName: templateName,
        selectionText: selection,
      },
      posAfterSelection,
    );

    const cleanup = () => this.streamManager.removeStream(streamId);

    if (config.alsoAppendTo) {
      const captureRunner = new CaptureRunner(this.app);
      try {
        await captureRunner.runWithCapture(
          llmClient,
          llmRequest,
          config,
          stream.abort.signal,
          async (chunk) => {
            await stream.writeChunk(chunk);
          },
          view.file?.path,
          templateName,
        );
      } catch (err) {
        const msg = err instanceof Error ? err.message : "Stream failed";
        await this.writeStreamError(stream, msg);
        new Notice(`Scholia: ${msg}`);
      } finally {
        cleanup();
      }
    } else {
      try {
        await stream.start(llmClient.stream(llmRequest, stream.abort.signal));
      } catch (err) {
        const msg = err instanceof Error ? err.message : "Stream failed";
        await this.writeStreamError(stream, msg);
        new Notice(`Scholia: ${msg}`);
      } finally {
        cleanup();
      }
    }
  }

  private async writeStreamError(stream: Stream, message: string): Promise<void> {
    try {
      await stream.writeChunk(formatError(message));
    } catch {
      // editor may be unavailable; swallow
    }
  }

  private async runAppend(
    templateName: string,
    config: TemplateConfig,
    view: MarkdownView,
    llmClient: OpenRouterClient,
    llmRequest: LlmRequest,
  ): Promise<void> {
    const abortController = new AbortController();
    let accumulatedContent = "";

    try {
      for await (const chunk of llmClient.stream(
        llmRequest,
        abortController.signal,
      )) {
        accumulatedContent += chunk;
      }

      const destPath = config.outputDestination as string;
      const appendFormat = config.appendFormat ?? "markdown";

      await appendToVault(this.app.vault, {
        relativePath: destPath,
        content: accumulatedContent,
        format: appendFormat,
        sourcePath: view.file?.path,
        templateName,
      });

      new Notice(`Scholia: appended to ${destPath}`);
    } catch (err) {
      if (!abortController.signal.aborted) {
        new Notice(
          `Scholia: ${err instanceof Error ? err.message : "Append failed"}`,
        );
      }
    }
  }

  handleCreate(file: TFile): void {
    if (
      this.plugin.settings.enableHotReloadOfTemplates &&
      this.isInTemplatesFolder(file)
    ) {
      this.reconcile();
    }
  }

  handleModify(file: TFile): void {
    if (
      this.plugin.settings.enableHotReloadOfTemplates &&
      this.isInTemplatesFolder(file)
    ) {
      this.reconcile();
    }
  }

  handleRename(file: TFile, oldPath: string): void {
    const oldInTemplates = oldPath.startsWith(
      this.plugin.settings.templatesFolder + "/",
    );
    const newInTemplates = this.isInTemplatesFolder(file);

    if (
      this.plugin.settings.enableHotReloadOfTemplates &&
      (oldInTemplates || newInTemplates)
    ) {
      if (oldInTemplates && !newInTemplates) {
        const existing = this.templates.get(oldPath);
        if (existing) {
          removeCommand(this.app, existing.commandId);
          this.templates.delete(oldPath);
        }
      }
      this.reconcile();
    }
  }

  handleDelete(file: TFile): void {
    if (
      this.plugin.settings.enableHotReloadOfTemplates &&
      this.isInTemplatesFolder(file)
    ) {
      const existing = this.templates.get(file.path);
      if (existing) {
        removeCommand(this.app, existing.commandId);
        this.templates.delete(file.path);
      }
    }
  }

  getRegisteredCommands(): Map<string, RegisteredTemplate> {
    return this.templates;
  }
}

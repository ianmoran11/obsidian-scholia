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
import { LlmCost, LlmRequest, LlmUsage } from "../llm/client";
import { buildRunMetadata } from "../llm/metadata";
import { extractContext } from "../context/extractor";
import { appendToVault } from "../storage/appendFile";
import {
  formatCalloutMetadata,
  formatError,
  formatFollowupSkeleton,
  type ScholiaRunSnapshot,
  STREAMING_CALLOUT_TYPE,
} from "../stream/callout";
import {
  findScholiaCalloutAt,
  stripCalloutForChat,
} from "../stream/calloutParser";
import { CustomProbeModal } from "../ui/modal";
import { CaptureRunner } from "../commands/capture";
import type { ReasoningEffort } from "./types";
import { DeepInfraTtsClient } from "../audio/deepinfra";
import {
  assertTtsTextWithinLimit,
  extractTtsTextFromCallout,
  extractTtsTextFromNote,
} from "../audio/text";
import { saveAudioToVault } from "../audio/storage";
import { formatGeneratedForSpacedRepetition } from "../spacedRepetition/format";

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
      defaultReasoningEnabled: boolean;
      defaultReasoningEffort: ReasoningEffort;
      centralCaptureFile: string;
      enableHotReloadOfTemplates: boolean;
      showRunMetadata: boolean;
      chatFollowupsEnabled: boolean;
      spacedRepetitionIntegrationEnabled: boolean;
      deepInfraApiKey: string;
      enableAudioGeneration: boolean;
      ttsModel: string;
      ttsVoice: string;
      audioOutputFolder: string;
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

  registerRegenerateCommand(): void {
    this.plugin.addCommand({
      id: "scholia.regenerate-current-callout",
      name: "Scholia: Regenerate current callout",
      callback: () => {
        this.regenerateActiveCallout();
      },
    });
  }

  registerAudioCommand(): void {
    this.plugin.addCommand({
      id: "scholia.generate-audio-current-note-or-callout",
      name: "Scholia: Generate audio for current note/callout",
      callback: () => {
        this.generateAudioForActiveScope();
      },
    });
  }

  registerRegeneratePostProcessor(
    register: (processor: (el: HTMLElement, ctx: unknown) => void) => void,
  ): void {
    register((el, ctx) => {
      const callouts = el.querySelectorAll<HTMLElement>(".callout");
      callouts.forEach((callout) => {
        if (!callout.innerHTML.includes("scholia:run")) return;
        if (callout.querySelector(".scholia-regenerate-button")) return;

        const button = callout.createEl("button", {
          cls: "scholia-regenerate-button",
          text: "Regenerate",
        });
        button.type = "button";
        button.addEventListener("click", () => {
          const section = (
            ctx as {
              sourcePath?: string;
              getSectionInfo?: (el: HTMLElement) => { lineStart: number } | null;
            }
          ).getSectionInfo?.(callout);
          const sourcePath = (ctx as { sourcePath?: string }).sourcePath;
          if (sourcePath && section) {
            this.regenerateRenderedCallout(sourcePath, section.lineStart);
          } else {
            this.regenerateActiveCallout();
          }
        });
      });
    });
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
    const modal = new CustomProbeModal(this.app, effectiveConfig, {
      defaultReasoningEnabled:
        effectiveConfig.reasoningEnabled ??
        this.plugin.settings.defaultReasoningEnabled,
      defaultReasoningEffort:
        effectiveConfig.reasoningEffort ??
        this.plugin.settings.defaultReasoningEffort,
      defaultTokenBudget:
        effectiveConfig.maxTokens ?? this.plugin.settings.defaultMaxTokens,
    });
    const result = await modal.openAndWait();

    if (!result) {
      return;
    }

    effectiveScope = result.scope;
    effectiveConfig.reasoningEnabled = result.reasoningEnabled;
    effectiveConfig.reasoningEffort = result.reasoningEffort;
    effectiveConfig.maxTokens = result.tokenBudget;
    if (!this.plugin.settings.spacedRepetitionIntegrationEnabled) {
      effectiveConfig.spacedRepetition = false;
    }

    if (effectiveConfig.customProbe) {
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
    const reasoningEnabled =
      effectiveConfig.reasoningEnabled ??
      this.plugin.settings.defaultReasoningEnabled;
    const reasoningEffort =
      effectiveConfig.reasoningEffort ??
      this.plugin.settings.defaultReasoningEffort;

    const llmClient = new OpenRouterClient(apiKey);
    const llmRequest: LlmRequest = {
      model,
      temperature,
      maxTokens,
      reasoningEnabled,
      reasoningEffort,
      system: systemPrompt,
      user: contextText,
    };

    if (effectiveConfig.outputDestination === "inline") {
      if (
        effectiveConfig.customProbe &&
        this.plugin.settings.chatFollowupsEnabled
      ) {
        const parsed = findScholiaCalloutAt(editor);
        if (parsed?.runSnapshot) {
          await this.runChatFollowup(
            templateName,
            effectiveConfig,
            view,
            editor,
            parsed,
            llmClient,
            {
              ...llmRequest,
              user: this.buildChatFollowupUserMessage({
                contextText,
                priorConversation: stripCalloutForChat(parsed.body),
                followupQuestion: result.query,
              }),
            },
            result.query,
          );
          return;
        }
      }

      await this.runInline(
        templatePath,
        templateName,
        effectiveConfig,
        view,
        editor,
        selection,
        llmClient,
        llmRequest,
        effectiveConfig.customProbe ? result.query : undefined,
      );
    } else {
      await this.runAppend(
        templateName,
        effectiveConfig,
        view,
        llmClient,
        llmRequest,
        effectiveConfig.customProbe ? result.query : undefined,
      );
    }
  }

  private buildChatFollowupUserMessage(opts: {
    contextText: string;
    priorConversation: string;
    followupQuestion: string;
  }): string {
    return [
      "Use the selected/current note context and the existing Scholia conversation to answer the follow-up.",
      "",
      "Current note context:",
      opts.contextText || "(none)",
      "",
      "Existing Scholia conversation:",
      opts.priorConversation || "(none)",
      "",
      `Follow-up question: ${opts.followupQuestion}`,
    ].join("\n");
  }

  private async runChatFollowup(
    templateName: string,
    config: TemplateConfig,
    view: MarkdownView,
    editor: import("obsidian").Editor,
    parsed: NonNullable<ReturnType<typeof findScholiaCalloutAt>>,
    llmClient: OpenRouterClient,
    llmRequest: LlmRequest,
    questionText: string,
  ): Promise<void> {
    const snapshot = parsed.runSnapshot;
    if (!snapshot) return;

    const streamId = `scholia-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
    const stream = new Stream(streamId, view.file?.path ?? "", editor, view);
    const startedAt = Date.now();
    const timestamp = new Date(startedAt).toISOString();
    let usage: LlmUsage | undefined;
    let cost: LlmCost | undefined;

    if (!this.streamManager.addStream(stream)) {
      new Notice("Scholia: Too many concurrent streams. Please wait.");
      return;
    }

    const followupSkeleton = formatFollowupSkeleton(questionText);
    stream.skeletonStart = parsed.startOffset;
    stream.skeletonEnd = parsed.endOffset + followupSkeleton.length;
    stream.writeOffset = parsed.endOffset + followupSkeleton.length;
    stream.inRangeWriteInProgress = true;
    try {
      editor.replaceRange(followupSkeleton, editor.offsetToPos(parsed.endOffset));
      stream.lastKnownContent = editor.getValue();
      stream.lastKnownLength = stream.lastKnownContent.length;
    } finally {
      stream.inRangeWriteInProgress = false;
    }
    stream.setCalloutType(STREAMING_CALLOUT_TYPE);

    try {
      await stream.start(llmClient.stream(llmRequest, stream.abort.signal), (event) => {
        usage = event.usage ?? usage;
        cost = event.cost ?? cost;
      });
      if (this.plugin.settings.showRunMetadata) {
        await stream.writeChunk(
          formatCalloutMetadata(
            buildRunMetadata(llmRequest, {
              id: streamId,
              timestamp,
              contextScope: config.contextScope,
              templateName,
              durationMs: Date.now() - startedAt,
              usage,
              cost,
            }),
          ),
        );
      }
    } catch (err) {
      const msg = err instanceof Error ? err.message : "Stream failed";
      await this.writeStreamError(stream, msg);
      new Notice(`Scholia: ${msg}`);
    } finally {
      stream.setCalloutType(snapshot.calloutType);
      this.streamManager.removeStream(streamId);
    }
  }

  private async runInline(
    templatePath: string,
    templateName: string,
    config: TemplateConfig,
    view: MarkdownView,
    editor: import("obsidian").Editor,
    selection: string,
    llmClient: OpenRouterClient,
    llmRequest: LlmRequest,
    questionText?: string,
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
    const startedAt = Date.now();
    const timestamp = new Date(startedAt).toISOString();
    let usage: LlmUsage | undefined;
    let cost: LlmCost | undefined;
    let accumulatedContent = "";

    if (!this.streamManager.addStream(stream)) {
      new Notice("Scholia: Too many concurrent streams. Please wait.");
      return;
    }

    stream.insertSkeleton(
      {
        calloutType: STREAMING_CALLOUT_TYPE,
        calloutLabel,
        folded: calloutFolded,
        commandName: templateName,
        selectionText: selection,
        questionText,
        runSnapshot: this.buildRunSnapshotForCallout({
          id: streamId,
          templatePath,
          templateName,
          sourcePath: view.file?.path,
          questionText,
          contextScope: config.contextScope,
          llmRequest,
          calloutType,
          calloutLabel,
          calloutFolded,
          outputDestination: config.outputDestination,
          createdAt: timestamp,
        }),
      },
      posAfterSelection,
    );

    const cleanup = () => this.streamManager.removeStream(streamId);

    if (config.alsoAppendTo) {
      const captureRunner = new CaptureRunner(this.app);
      try {
        const metadata = await captureRunner.runWithCapture(
          llmClient,
          llmRequest,
          config,
          stream.abort.signal,
          async (chunk) => {
            await stream.writeChunk(chunk);
          },
          view.file?.path,
          templateName,
          questionText,
        );
        if (this.plugin.settings.showRunMetadata) {
          await stream.writeChunk(formatCalloutMetadata(metadata));
        }
      } catch (err) {
        const msg = err instanceof Error ? err.message : "Stream failed";
        await this.writeStreamError(stream, msg);
        new Notice(`Scholia: ${msg}`);
      } finally {
        stream.setCalloutType(calloutType);
        cleanup();
      }
    } else {
      try {
        await stream.start(
          llmClient.stream(llmRequest, stream.abort.signal),
          (event) => {
            usage = event.usage ?? usage;
            cost = event.cost ?? cost;
          },
          (chunk) => {
            accumulatedContent += chunk;
          },
        );
        if (this.plugin.settings.showRunMetadata) {
          await stream.writeChunk(
            formatCalloutMetadata(
              buildRunMetadata(llmRequest, {
                id: streamId,
                timestamp,
                contextScope: config.contextScope,
                templateName,
                durationMs: Date.now() - startedAt,
                usage,
                cost,
              }),
            ),
          );
        }
      } catch (err) {
        const msg = err instanceof Error ? err.message : "Stream failed";
        await this.writeStreamError(stream, msg);
        new Notice(`Scholia: ${msg}`);
      } finally {
        stream.setCalloutType(calloutType);
        if (!stream.isAborted && config.spacedRepetition) {
          this.insertSrCardAfterInlineCallout(editor, stream.writeOffset, accumulatedContent, config);
        }
        cleanup();
      }
    }
  }

  private insertSrCardAfterInlineCallout(
    editor: import("obsidian").Editor,
    offset: number,
    content: string,
    config: TemplateConfig,
  ): void {
    const formatted = this.formatSpacedRepetitionContent(content, config);
    if (!formatted) return;
    const card = `\n\n<!-- scholia:sr-card -->\n${formatted}\n`;
    editor.replaceRange(card, editor.offsetToPos(offset));
  }

  private formatSpacedRepetitionContent(
    content: string,
    config: TemplateConfig,
  ): string {
    return formatGeneratedForSpacedRepetition(content, {
      format: config.srFormat ?? "basic",
      deck: config.srDeck,
      tags: config.srTags,
    });
  }

  private buildRunSnapshotForCallout(opts: {
    id: string;
    templatePath: string;
    templateName: string;
    sourcePath?: string;
    questionText?: string;
    contextScope: TemplateConfig["contextScope"];
    llmRequest: LlmRequest;
    calloutType: string;
    calloutLabel: string;
    calloutFolded: boolean;
    outputDestination: TemplateConfig["outputDestination"];
    createdAt: string;
    lastRegeneratedAt?: string;
  }): ScholiaRunSnapshot {
    return {
      id: opts.id,
      schemaVersion: 1,
      templatePath: opts.templatePath,
      templateName: opts.templateName,
      sourcePath: opts.sourcePath,
      question: opts.questionText,
      contextScope: opts.contextScope,
      model: opts.llmRequest.model,
      temperature: opts.llmRequest.temperature,
      maxTokens: opts.llmRequest.maxTokens,
      reasoningEnabled: opts.llmRequest.reasoningEnabled,
      reasoningEffort: opts.llmRequest.reasoningEffort,
      calloutType: opts.calloutType,
      calloutLabel: opts.calloutLabel,
      calloutFolded: opts.calloutFolded,
      outputDestination: String(opts.outputDestination),
      createdAt: opts.createdAt,
      lastRegeneratedAt: opts.lastRegeneratedAt,
    };
  }

  async regenerateActiveCallout(): Promise<void> {
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

    await this.regenerateCalloutInView(view);
  }

  async regenerateRenderedCallout(
    sourcePath: string,
    lineStart: number,
  ): Promise<void> {
    const file = this.app.vault.getFileByPath(sourcePath);
    if (!file) {
      new Notice(`Scholia: note not found: ${sourcePath}`);
      return;
    }

    await this.app.workspace.getLeaf().openFile(file);
    const view = this.app.workspace.getActiveViewOfType(MarkdownView);
    if (!view) {
      new Notice("Scholia: No active note editor.");
      return;
    }

    await this.regenerateCalloutInView(view, { line: lineStart, ch: 0 });
  }

  private async regenerateCalloutInView(
    view: MarkdownView,
    position?: { line: number; ch: number },
  ): Promise<void> {
    const apiKey = this.plugin.settings.openRouterApiKey;
    if (!apiKey) {
      new Notice("Scholia: OpenRouter API key not set. Configure in Settings.");
      return;
    }

    const editor = view.editor;
    const parsed = findScholiaCalloutAt(editor, position);
    if (!parsed?.runSnapshot) {
      new Notice("Scholia: place the cursor inside a generated callout.");
      return;
    }
    if (
      parsed.responseStartOffset === undefined ||
      parsed.responseEndOffset === undefined
    ) {
      new Notice("Scholia: this callout has no response section to regenerate.");
      return;
    }

    const templateFile = this.app.vault.getFileByPath(
      parsed.runSnapshot.templatePath,
    );
    if (!templateFile) {
      new Notice(`Scholia: template not found: ${parsed.runSnapshot.templatePath}`);
      return;
    }

    const parsedTemplate = await this.parseTemplate(templateFile);
    if (!parsedTemplate?.isValid) {
      return;
    }

    const snapshot = parsed.runSnapshot;
    const config: TemplateConfig = {
      ...parsedTemplate.config,
      contextScope: snapshot.contextScope,
      outputDestination: "inline",
      model: snapshot.model,
      temperature: snapshot.temperature,
      maxTokens: snapshot.maxTokens,
      reasoningEnabled: snapshot.reasoningEnabled,
      reasoningEffort: snapshot.reasoningEffort,
      calloutType: snapshot.calloutType,
      calloutLabel: snapshot.calloutLabel,
      calloutFolded: snapshot.calloutFolded,
    };
    const system = snapshot.question
      ? `${parsedTemplate.config.systemPrompt}\n\nUser request: ${snapshot.question}`
      : parsedTemplate.config.systemPrompt;
    const llmRequest: LlmRequest = {
      model: snapshot.model,
      temperature: snapshot.temperature,
      maxTokens: snapshot.maxTokens,
      reasoningEnabled: snapshot.reasoningEnabled,
      reasoningEffort: snapshot.reasoningEffort,
      system,
      user: extractContext(this.app, editor, view, snapshot.contextScope),
    };

    await this.regenerateParsedCallout(
      view,
      editor,
      parsed,
      config,
      new OpenRouterClient(apiKey),
      llmRequest,
    );
  }

  private async regenerateParsedCallout(
    view: MarkdownView,
    editor: import("obsidian").Editor,
    parsed: NonNullable<ReturnType<typeof findScholiaCalloutAt>>,
    config: TemplateConfig,
    llmClient: OpenRouterClient,
    llmRequest: LlmRequest,
  ): Promise<void> {
    const snapshot = parsed.runSnapshot;
    if (!snapshot || parsed.responseStartOffset === undefined) return;

    const streamId = `scholia-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
    const stream = new Stream(streamId, view.file?.path ?? "", editor, view);
    const startedAt = Date.now();
    const timestamp = new Date(startedAt).toISOString();
    let usage: LlmUsage | undefined;
    let cost: LlmCost | undefined;

    if (!this.streamManager.addStream(stream)) {
      new Notice("Scholia: Too many concurrent streams. Please wait.");
      return;
    }

    stream.replaceCalloutResponse({
      startOffset: parsed.startOffset,
      endOffset: parsed.endOffset,
      responseStartOffset: parsed.responseStartOffset,
      responseEndOffset: parsed.responseEndOffset ?? parsed.endOffset,
    });
    stream.setCalloutType(STREAMING_CALLOUT_TYPE);

    try {
      await stream.start(llmClient.stream(llmRequest, stream.abort.signal), (event) => {
        usage = event.usage ?? usage;
        cost = event.cost ?? cost;
      });
      if (this.plugin.settings.showRunMetadata) {
        await stream.writeChunk(
          formatCalloutMetadata(
            buildRunMetadata(llmRequest, {
              id: streamId,
              timestamp,
              contextScope: config.contextScope,
              templateName: snapshot.templateName,
              durationMs: Date.now() - startedAt,
              usage,
              cost,
            }),
          ),
        );
      }
    } catch (err) {
      const msg = err instanceof Error ? err.message : "Stream failed";
      await this.writeStreamError(stream, msg);
      new Notice(`Scholia: ${msg}`);
    } finally {
      stream.setCalloutType(snapshot.calloutType);
      this.streamManager.removeStream(streamId);
    }
  }

  private async writeStreamError(stream: Stream, message: string): Promise<void> {
    try {
      await stream.writeChunk(formatError(message));
    } catch {
      // editor may be unavailable; swallow
    }
  }

  async generateAudioForActiveScope(): Promise<void> {
    if (!this.plugin.settings.enableAudioGeneration) {
      new Notice("Scholia: audio generation is disabled in settings.");
      return;
    }

    const apiKey = this.plugin.settings.deepInfraApiKey;
    if (!apiKey) {
      new Notice("Scholia: DeepInfra API key not set. Configure in Settings.");
      return;
    }

    const view = this.app.workspace.getActiveViewOfType(MarkdownView);
    if (!view) {
      new Notice("Scholia: No active note editor.");
      return;
    }

    const editor = view.editor;
    const parsed = findScholiaCalloutAt(editor);
    const text = parsed
      ? extractTtsTextFromCallout(parsed)
      : extractTtsTextFromNote(editor.getValue());

    try {
      assertTtsTextWithinLimit(text);
      const generated = await new DeepInfraTtsClient(apiKey).generateSpeech({
        text,
        model: this.plugin.settings.ttsModel,
        voice: this.plugin.settings.ttsVoice,
      });
      const saved = await saveAudioToVault(this.app.vault, {
        audio: generated.audio,
        sourceFile: view.file,
        calloutId: parsed?.runSnapshot?.id,
        audioOutputFolder: this.plugin.settings.audioOutputFolder,
        extension: generated.extension,
      });

      if (parsed) {
        this.insertOrUpdateCalloutAudio(editor, parsed, saved.path);
      } else {
        this.insertOrUpdateNoteAudio(editor, saved.path);
      }

      new Notice(`Scholia: audio saved to ${saved.path}`);
    } catch (err) {
      new Notice(
        `Scholia: ${err instanceof Error ? err.message : "Audio generation failed"}`,
      );
    }
  }

  private insertOrUpdateCalloutAudio(
    editor: import("obsidian").Editor,
    parsed: NonNullable<ReturnType<typeof findScholiaCalloutAt>>,
    audioPath: string,
  ): void {
    const content = editor.getValue();
    const lines = content.split("\n");
    const audioLine = `> **Audio:** ![[${audioPath}]]`;

    for (let i = parsed.startLine + 1; i <= parsed.endLine; i++) {
      if (lines[i]?.replace(/^>\s?/, "").trim().startsWith("**Audio:**")) {
        editor.replaceRange(
          audioLine,
          { line: i, ch: 0 },
          { line: i, ch: lines[i].length },
        );
        return;
      }
    }

    editor.replaceRange(`\n${audioLine}`, editor.offsetToPos(parsed.endOffset));
  }

  private insertOrUpdateNoteAudio(
    editor: import("obsidian").Editor,
    audioPath: string,
  ): void {
    const content = editor.getValue();
    const section = "## Scholia Audio";
    const embed = `![[${audioPath}]]`;
    const sectionIndex = content.indexOf(section);
    if (sectionIndex === -1) {
      const spacer = content.endsWith("\n") ? "\n" : "\n\n";
      editor.replaceRange(`${spacer}${section}\n\n${embed}\n`, editor.offsetToPos(content.length));
      return;
    }

    const afterSection = sectionIndex + section.length;
    const nextHeading = content.slice(afterSection).search(/\n##\s+/);
    const sectionEnd =
      nextHeading === -1 ? content.length : afterSection + nextHeading;
    editor.replaceRange(
      `\n\n${embed}`,
      editor.offsetToPos(afterSection),
      editor.offsetToPos(sectionEnd),
    );
  }

  private async runAppend(
    templateName: string,
    config: TemplateConfig,
    view: MarkdownView,
    llmClient: OpenRouterClient,
    llmRequest: LlmRequest,
    questionText?: string,
  ): Promise<void> {
    const abortController = new AbortController();
    let accumulatedContent = "";
    let usage: LlmUsage | undefined;
    let cost: LlmCost | undefined;
    const startedAt = Date.now();
    const timestamp = new Date(startedAt).toISOString();

    try {
      for await (const event of llmClient.stream(
        llmRequest,
        abortController.signal,
      )) {
        if (event.type === "content") {
          accumulatedContent += event.text;
        } else {
          usage = event.usage ?? usage;
          cost = event.cost ?? cost;
        }
      }

      const destPath = config.outputDestination as string;
      const appendFormat = config.appendFormat ?? "markdown";

      await appendToVault(this.app.vault, {
        relativePath: destPath,
        content: config.spacedRepetition
          ? this.formatSpacedRepetitionContent(accumulatedContent, config)
          : accumulatedContent,
        format: appendFormat,
        sourcePath: view.file?.path,
        templateName,
        metadata: buildRunMetadata(llmRequest, {
          id: `scholia-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
          timestamp,
          contextScope: config.contextScope,
          templateName,
          durationMs: Date.now() - startedAt,
          usage,
          cost,
        }),
        question: questionText,
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

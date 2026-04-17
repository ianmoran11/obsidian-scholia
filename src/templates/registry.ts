import { App, Command, MarkdownView, Notice, TFile, TFolder } from "obsidian";
import { debounce } from "../util/debounce";
import { removeCommand } from "../util/removeCommand";
import { buildCommandId } from "../util/ids";
import { parseFrontmatter, ParseResult } from "./frontmatter";
import type { TemplateConfig } from "./types";
import { Stream } from "../stream/stream";
import { OpenRouterClient } from "../llm/openrouter";
import { LlmRequest } from "../llm/client";
import { extractContext } from "../context/extractor";

interface RegisteredTemplate {
  file: TFile;
  config: TemplateConfig;
  commandId: string;
}

export class TemplateRegistry {
  private templates: Map<string, RegisteredTemplate> = new Map();
  private app: App;
  private plugin: {
    app: App;
    settings: {
      openRouterApiKey: string;
      templatesFolder: string;
      defaultCalloutType: string;
      defaultModel: string;
      defaultTemperature: number;
      defaultMaxTokens: number;
    };
  };
  private onSettingsChange: () => void;

  constructor(
    app: App,
    plugin: {
      app: App;
      settings: {
        openRouterApiKey: string;
        templatesFolder: string;
        defaultCalloutType: string;
        defaultModel: string;
        defaultTemperature: number;
        defaultMaxTokens: number;
      };
    },
    onSettingsChange: () => void,
  ) {
    this.app = app;
    this.plugin = plugin;
    this.onSettingsChange = onSettingsChange;
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
    if (!result) {
      return false;
    }

    const { config } = result;
    const commandId = buildCommandId(file.path);
    const templateName = this.getTemplateName(file.path);

    const command: Command = {
      id: commandId,
      name: `${config.commandPrefix}: ${templateName}`,
      callback: () => {
        this.runTemplateCommand(file.path, config, templateName);
      },
    };

    if (config.hotkey && config.hotkey.length > 0) {
      (command as Command & { hotkeys: unknown[] }).hotkeys = config.hotkey;
    }

    (
      this.app as unknown as {
        commands: { addCommand: (cmd: Command) => void };
      }
    ).commands.addCommand(command);

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
      const yamlContent = parts[1];
      rawFrontmatter = this.parseYaml(yamlContent);
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

  private parseYaml(yaml: string): Record<string, unknown> {
    const result: Record<string, unknown> = {};
    const lines = yaml.split("\n");

    for (const line of lines) {
      const match = line.match(/^(\w+):\s*(.*)$/);
      if (match) {
        const [, key, value] = match;
        const trimmedValue = value.trim();

        if (trimmedValue === "true") {
          result[key] = true;
        } else if (trimmedValue === "false") {
          result[key] = false;
        } else if (/^\d+$/.test(trimmedValue)) {
          result[key] = parseInt(trimmedValue, 10);
        } else if (/^\d+\.\d+$/.test(trimmedValue)) {
          result[key] = parseFloat(trimmedValue);
        } else if (trimmedValue.startsWith('"') && trimmedValue.endsWith('"')) {
          result[key] = trimmedValue.slice(1, -1);
        } else if (trimmedValue.startsWith("'") && trimmedValue.endsWith("'")) {
          result[key] = trimmedValue.slice(1, -1);
        } else {
          result[key] = trimmedValue;
        }
      }
    }

    return result;
  }

  private getTemplateName(filePath: string): string {
    const parts = filePath.split("/");
    const fileName = parts[parts.length - 1];
    return fileName.replace(/\.md$/, "");
  }

  private getTemplateFolder(): TFolder | null {
    return this.app.vault.getFolderByPath(this.plugin.settings.templatesFolder);
  }

  reconcile = debounce(async () => {
    await this.doReconcile();
  }, 300);

  private async doReconcile(): Promise<void> {
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
    const selection = editor.getSelection();

    if (config.requiresSelection && !selection) {
      new Notice("Scholia: Select text first.");
      return;
    }

    if (config.contextScope === "selection" && !selection) {
      new Notice("Scholia: Select text first.");
      return;
    }

    const contextText = extractContext(
      this.app,
      editor,
      view,
      config.contextScope,
    );

    const calloutType =
      config.calloutType ?? this.plugin.settings.defaultCalloutType;
    const calloutLabel = config.calloutLabel ?? templateName;
    const calloutFolded = config.calloutFolded ?? true;

    const posAfterSelection = editor.getCursor("to");

    const streamId = `scholia-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
    const stream = new Stream(streamId, view.file?.path ?? "", editor, view);

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

    const model = config.model ?? this.plugin.settings.defaultModel;
    const temperature =
      config.temperature ?? this.plugin.settings.defaultTemperature;
    const maxTokens = config.maxTokens ?? this.plugin.settings.defaultMaxTokens;

    const llmClient = new OpenRouterClient(apiKey);
    const llmRequest: LlmRequest = {
      model,
      temperature,
      maxTokens,
      system: config.systemPrompt,
      user: contextText,
    };

    try {
      await stream.start(llmClient.stream(llmRequest, stream.abort.signal));
    } catch (err) {
      stream.abortWithError(
        err instanceof Error ? err.message : "Stream failed",
      );
    }
  }

  handleCreate(file: TFile): void {
    if (this.isInTemplatesFolder(file)) {
      this.reconcile();
    }
  }

  handleModify(file: TFile): void {
    if (this.isInTemplatesFolder(file)) {
      this.reconcile();
    }
  }

  handleRename(file: TFile, oldPath: string): void {
    const oldInTemplates = oldPath.startsWith(
      this.plugin.settings.templatesFolder + "/",
    );
    const newInTemplates = this.isInTemplatesFolder(file);

    if (oldInTemplates || newInTemplates) {
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
    if (this.isInTemplatesFolder(file)) {
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

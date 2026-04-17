import { App, Notice, Setting, Suggest, TFolder } from "obsidian";

export interface ScholiaSettings {
  openRouterApiKey: string;
  defaultModel: string;
  defaultTemperature: number;
  defaultMaxTokens: number;
  templatesFolder: string;
  centralCaptureFile: string;
  defaultCalloutType: string;
  debugLogging: boolean;
  enableHotReloadOfTemplates: boolean;
}

export const DEFAULT_SETTINGS: ScholiaSettings = {
  openRouterApiKey: "",
  defaultModel: "z-ai/glm-5.1",
  defaultTemperature: 0.7,
  defaultMaxTokens: 1024,
  templatesFolder: "Edu-Templates",
  centralCaptureFile: "_System/Central-Flashcards.md",
  defaultCalloutType: "ai",
  debugLogging: false,
  enableHotReloadOfTemplates: true,
};

class FolderSuggest extends Suggest<TFolder> {
  private folders: TFolder[] = [];
  private onSelect: (folder: TFolder) => void;

  constructor(app: App, onSelect: (folder: TFolder) => void) {
    super(app);
    this.onSelect = onSelect;
  }

  parseTemplates: (value: string) => TFolder | null = (
    value: string,
  ): TFolder | null => {
    return this.app.vault.getAllFolders().find((f) => f.path === value) ?? null;
  };

  getSuggestions(query: string): TFolder[] {
    const lower = query.toLowerCase();
    return this.app.vault
      .getAllFolders()
      .filter((f) => f.path.toLowerCase().contains(lower));
  }

  renderSuggestion(folder: TFolder, el: HTMLElement): void {
    el.setText(folder.path);
  }

  selectSuggestion(folder: TFolder): void {
    this.onSelect(folder);
  }
}

export class ScholiaSettingTab {
  plugin: {
    settings: ScholiaSettings;
    saveSettings: () => Promise<void>;
    app: App;
  };

  constructor(
    app: App,
    plugin: {
      settings: ScholiaSettings;
      saveSettings: () => Promise<void>;
      app: App;
    },
  ) {
    this.plugin = plugin;
  }

  display(): void {
    const { containerEl } = this;
    containerEl.empty();
    containerEl.createEl("h2", { text: "Scholia Settings" });

    new Setting(containerEl)
      .setName("OpenRouter API Key")
      .setDesc("API key for OpenRouter (https://openrouter.ai)")
      .addText(
        (text) =>
          (text.inputEl.type = "password"
            .setValue(this.plugin.settings.openRouterApiKey)
            .onChange(async (value) => {
              this.plugin.settings.openRouterApiKey = value;
              await this.plugin.saveSettings();
            })),
      );

    const modelDatalist = containerEl.createEl("datalist", {
      attr: { id: "model-datalist" },
    });
    const modelSlugs = [
      "z-ai/glm-5.1",
      "anthropic/claude-3-haiku",
      "openai/gpt-4o-mini",
      "google/gemini-pro",
    ];
    modelDatalist.setText(modelSlugs.join("\n"));

    new Setting(containerEl)
      .setName("Default Model")
      .setDesc("OpenRouter model slug")
      .addText(
        (text) =>
          (text.inputEl.list = "model-datalist"
            .setValue(this.plugin.settings.defaultModel)
            .onChange(async (value) => {
              this.plugin.settings.defaultModel = value;
              await this.plugin.saveSettings();
            })),
      );

    new Setting(containerEl)
      .setName("Default Temperature")
      .setDesc("Sampling temperature (0.0–2.0)")
      .addSlider((slider) =>
        slider
          .setLimits(0, 2, 0.1)
          .setValue(this.plugin.settings.defaultTemperature)
          .onChange(async (value) => {
            this.plugin.settings.defaultTemperature = value;
            await this.plugin.saveSettings();
          })
          .showTooltip(),
      );

    new Setting(containerEl)
      .setName("Default Max Tokens")
      .setDesc("Maximum tokens in response (128–8192)")
      .addText(
        (text) =>
          (text.inputEl.type = "number"
            .setValue(String(this.plugin.settings.defaultMaxTokens))
            .onChange(async (value) => {
              const num = Math.min(
                8192,
                Math.max(128, parseInt(value) || 1024),
              );
              this.plugin.settings.defaultMaxTokens = num;
              await this.plugin.saveSettings();
            })),
      );

    let templatesFolderValue = this.plugin.settings.templatesFolder;
    new Setting(containerEl)
      .setName("Templates Folder")
      .setDesc("Folder containing template markdown files")
      .addText((text) => {
        text.setValue(templatesFolderValue);
        text.inputEl.placeholder = "Edu-Templates";
        new FolderSuggest(this.plugin.app, (folder) => {
          templatesFolderValue = folder.path;
          text.setValue(folder.path);
          this.plugin.settings.templatesFolder = folder.path;
          this.plugin.saveSettings();
        });
        text.onChange(async (value) => {
          templatesFolderValue = value;
          this.plugin.settings.templatesFolder = value;
          await this.plugin.saveSettings();
        });
      });

    new Setting(containerEl)
      .setName("Central Capture File")
      .setDesc("Default file for dual-write captures")
      .addText((text) =>
        text
          .setValue(this.plugin.settings.centralCaptureFile)
          .onChange(async (value) => {
            this.plugin.settings.centralCaptureFile = value;
            await this.plugin.saveSettings();
          }),
      );

    new Setting(containerEl)
      .setName("Default Callout Type")
      .setDesc("Callout style for AI responses")
      .addDropdown((dropdown) =>
        dropdown
          .addOption("ai", "AI")
          .addOption("faq", "FAQ")
          .addOption("scholia-clarify", "Scholia Clarify")
          .addOption("scholia-example", "Scholia Example")
          .addOption("scholia-flashcard", "Scholia Flashcard")
          .setValue(this.plugin.settings.defaultCalloutType)
          .onChange(async (value) => {
            this.plugin.settings.defaultCalloutType = value;
            await this.plugin.saveSettings();
          }),
      );

    new Setting(containerEl)
      .setName("Hot-reload templates")
      .setDesc("Automatically update commands when templates change")
      .addToggle((toggle) =>
        toggle
          .setValue(this.plugin.settings.enableHotReloadOfTemplates)
          .onChange(async (value) => {
            this.plugin.settings.enableHotReloadOfTemplates = value;
            await this.plugin.saveSettings();
          }),
      );

    new Setting(containerEl)
      .setName("Debug logging")
      .setDesc("Log detailed debug information to console")
      .addToggle((toggle) =>
        toggle
          .setValue(this.plugin.settings.debugLogging)
          .onChange(async (value) => {
            this.plugin.settings.debugLogging = value;
            await this.plugin.saveSettings();
          }),
      );

    new Setting(containerEl)
      .setName("Open templates folder")
      .addButton((button) =>
        button.setButtonText("Open").onClick(async () => {
          const folder = this.plugin.app.vault.getFolderByPath(
            this.plugin.settings.templatesFolder,
          );
          if (folder) {
            this.plugin.app.workspace.getLeaf(true).openFolder(folder);
          } else {
            new Notice(
              `Templates folder "${this.plugin.settings.templatesFolder}" not found`,
            );
          }
        }),
      );

    new Setting(containerEl)
      .setName("Create sample templates")
      .addButton((button) =>
        button.setButtonText("Create").onClick(async () => {
          await this.createSampleTemplates();
        }),
      );
  }

  private async createSampleTemplates(): Promise<void> {
    const templatesFolder = this.plugin.settings.templatesFolder;
    let folder = this.plugin.app.vault.getFolderByPath(templatesFolder);

    if (!folder) {
      try {
        folder = await this.plugin.app.vault.createFolder(templatesFolder);
      } catch (e) {
        new Notice(`Could not create templates folder: ${templatesFolder}`);
        return;
      }
    }

    const templates = [
      {
        name: "Clarify",
        content: `---
context_scope: selection
output_destination: inline
model: z-ai/glm-5.1
temperature: 0.6
max_tokens: 768
callout_type: scholia-clarify
callout_label: "AI Clarification"
callout_folded: true
requires_selection: true
command_prefix: "Run"
hotkey: []
---
You are a patient tutor. Explain the selection below in plain language suitable for an undergraduate. Be concise (≤120 words). Do not restate the selection.`,
      },
      {
        name: "Real-World Example",
        content: `---
context_scope: heading
output_destination: inline
model: z-ai/glm-5.1
temperature: 0.8
max_tokens: 512
callout_type: scholia-example
callout_label: "Real-world example"
callout_folded: true
requires_selection: false
command_prefix: "Run"
hotkey: []
---
Using the section context below, provide one concrete real-world example that illustrates the concept. Keep it under 100 words.`,
      },
      {
        name: "Flashcard",
        content: `---
context_scope: selection
output_destination: inline
model: z-ai/glm-5.1
temperature: 0.4
max_tokens: 512
callout_type: scholia-flashcard
callout_label: "Flashcard"
callout_folded: true
requires_selection: true
command_prefix: "Run"
hotkey: []
also_append_to: "_System/Central-Flashcards.md"
append_format: markdown
---
You are a study assistant. Convert the selection into one Anki-style flashcard.
Output exactly:

Q: <single-sentence question>
A: <single-sentence answer>`,
      },
    ];

    for (const tmpl of templates) {
      const path = `${templatesFolder}/${tmpl.name}.md`;
      const existing = this.plugin.app.vault.getFileByPath(path);
      if (!existing) {
        await this.plugin.app.vault.create(path, tmpl.content);
      }
    }

    new Notice(`Sample templates created in ${templatesFolder}`);
  }
}

import {
  AbstractInputSuggest,
  App,
  Notice,
  Plugin,
  PluginSettingTab,
  Setting,
  TFolder,
} from "obsidian";
import type ScholiaPlugin from "./main";
import { PiBridgeClient } from "./llm/piBridge";
import type { ReasoningEffort } from "./templates/types";

export interface ScholiaSettings {
  llmBackend: "openrouter" | "pi";
  piBridgeUrl: string;
  piBridgeToken: string;
  piModel: string;
  openRouterApiKey: string;
  defaultModel: string;
  defaultTemperature: number;
  defaultMaxTokens: number;
  defaultReasoningEnabled: boolean;
  defaultReasoningEffort: ReasoningEffort;
  templatesFolder: string;
  centralCaptureFile: string;
  defaultCalloutType: string;
  debugLogging: boolean;
  enableHotReloadOfTemplates: boolean;
  showRunMetadata: boolean;
  chatFollowupsEnabled: boolean;
  spacedRepetitionIntegrationEnabled: boolean;
}

export const DEFAULT_SETTINGS: ScholiaSettings = {
  llmBackend: "openrouter",
  piBridgeUrl: "",
  piBridgeToken: "",
  piModel: "openai-codex/gpt-5.5",
  openRouterApiKey: "",
  defaultModel: "z-ai/glm-5.1",
  defaultTemperature: 0.7,
  defaultMaxTokens: 30000,
  defaultReasoningEnabled: true,
  defaultReasoningEffort: "medium",
  templatesFolder: "scholia/templates",
  centralCaptureFile: "scholia/flashcards.md",
  defaultCalloutType: "ai",
  debugLogging: false,
  enableHotReloadOfTemplates: true,
  showRunMetadata: true,
  chatFollowupsEnabled: true,
  spacedRepetitionIntegrationEnabled: true,
};

class FolderSuggest extends AbstractInputSuggest<TFolder> {
  constructor(
    app: App,
    inputEl: HTMLInputElement,
    private onSelectCb: (folder: TFolder) => void,
  ) {
    super(app, inputEl);
  }

  getSuggestions(query: string): TFolder[] {
    const lower = query.toLowerCase();
    return this.app.vault
      .getAllFolders()
      .filter((f) => f.path.toLowerCase().includes(lower));
  }

  renderSuggestion(folder: TFolder, el: HTMLElement): void {
    el.setText(folder.path);
  }

  selectSuggestion(folder: TFolder): void {
    this.setValue(folder.path);
    this.close();
    this.onSelectCb(folder);
  }
}

export class ScholiaSettingTab extends PluginSettingTab {
  declare plugin: ScholiaPlugin;

  constructor(app: App, plugin: ScholiaPlugin) {
    super(app, plugin as unknown as Plugin);
    this.plugin = plugin;
  }

  display(): void {
    const { containerEl } = this;
    containerEl.empty();
    containerEl.createEl("h2", { text: "Scholia Settings" });

    const piBackend = this.plugin.settings.llmBackend === "pi";
    new Setting(containerEl)
      .setName("AI backend")
      .setDesc(
        "Pi uses your Mac's Codex subscription. No automatic OpenRouter fallback.",
      )
      .addDropdown((dropdown) =>
        dropdown
          .addOption("openrouter", "OpenRouter")
          .addOption("pi", "Pi on Mac (Codex subscription)")
          .setValue(this.plugin.settings.llmBackend)
          .onChange(async (value) => {
            this.plugin.settings.llmBackend = value as "openrouter" | "pi";
            await this.plugin.saveSettings();
            this.display();
          }),
      );
    if (piBackend) {
      new Setting(containerEl)
        .setName("Pi bridge URL")
        .setDesc(
          "Private Tailscale HTTPS origin, e.g. https://mac-mini.your-tailnet.ts.net (no path).",
        )
        .addText((text) =>
          text
            .setValue(this.plugin.settings.piBridgeUrl)
            .onChange(async (value) => {
              this.plugin.settings.piBridgeUrl = value.trim();
              await this.plugin.saveSettings();
            }),
        );
      new Setting(containerEl)
        .setName("Pi bridge access token")
        .setDesc(
          "Bridge token only, not your OpenAI credentials. Stored in plugin data; protect synced copies.",
        )
        .addText((text) => {
          text.inputEl.type = "password";
          text
            .setValue(this.plugin.settings.piBridgeToken)
            .onChange(async (value) => {
              this.plugin.settings.piBridgeToken = value.trim();
              await this.plugin.saveSettings();
            });
        });
      new Setting(containerEl)
        .setName("Pi Codex model")
        .setDesc(
          "Use openai-codex/<model-id>. Test Connection lists the Mac's supported model IDs.",
        )
        .addText((text) =>
          text
            .setValue(this.plugin.settings.piModel)
            .onChange(async (value) => {
              this.plugin.settings.piModel = value.trim();
              await this.plugin.saveSettings();
            }),
        );
      new Setting(containerEl)
        .setName("Test Connection")
        .setDesc(
          "Checks the bridge, subscription login and model list without generating text.",
        )
        .addButton((button) =>
          button.setButtonText("Test Connection").onClick(async () => {
            button.setDisabled(true);
            try {
              const client = new PiBridgeClient(
                this.plugin.settings.piBridgeToken,
                this.plugin.settings.piBridgeUrl,
              );
              const health = await client.testConnection();
              const selected = health.models.includes(
                this.plugin.settings.piModel,
              );
              new Notice(
                `Scholia: Pi connected. ${selected ? "Selected model available." : "Selected model not found."} Models: ${health.models.join(", ")}`,
                15000,
              );
            } catch (error) {
              new Notice(`Scholia: ${(error as Error).message}`, 10000);
            } finally {
              button.setDisabled(false);
            }
          }),
        );
      containerEl.createEl("p", {
        text: "Pi uses medium reasoning. Temperature and output token budgets (including template overrides) are not applied. The Mac enforces a 5-minute deadline and 1 MiB output limit. Subscription usage limits still apply.",
      });
    }

    if (!piBackend) {
      new Setting(containerEl)
        .setName("OpenRouter API Key")
        .setDesc("API key for OpenRouter (https://openrouter.ai)")
        .addText((text) => {
          text.inputEl.type = "password";
          text
            .setValue(this.plugin.settings.openRouterApiKey)
            .onChange(async (value) => {
              this.plugin.settings.openRouterApiKey = value;
              await this.plugin.saveSettings();
            });
        });

      const modelDatalist = containerEl.createEl("datalist");
      modelDatalist.id = "scholia-model-datalist";
      const modelSlugs = [
        "z-ai/glm-5.1",
        "anthropic/claude-3-haiku",
        "openai/gpt-4o-mini",
        "google/gemini-pro",
      ];
      for (const slug of modelSlugs) {
        modelDatalist.createEl("option", { value: slug });
      }

      new Setting(containerEl)
        .setName("Default Model")
        .setDesc("OpenRouter model slug")
        .addText((text) => {
          text.inputEl.setAttribute("list", "scholia-model-datalist");
          text
            .setValue(this.plugin.settings.defaultModel)
            .onChange(async (value) => {
              this.plugin.settings.defaultModel = value;
              await this.plugin.saveSettings();
            });
        });

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
        .setName("Default Token Budget")
        .setDesc("Maximum output token budget per run")
        .addText((text) => {
          text.inputEl.type = "number";
          text
            .setValue(String(this.plugin.settings.defaultMaxTokens))
            .onChange(async (value) => {
              const num = Math.min(
                65536,
                Math.max(
                  128,
                  parseInt(value) || DEFAULT_SETTINGS.defaultMaxTokens,
                ),
              );
              this.plugin.settings.defaultMaxTokens = num;
              await this.plugin.saveSettings();
            });
        });

      new Setting(containerEl)
        .setName("Default Reasoning")
        .setDesc("Enable reasoning by default for Scholia runs")
        .addToggle((toggle) =>
          toggle
            .setValue(this.plugin.settings.defaultReasoningEnabled)
            .onChange(async (value) => {
              this.plugin.settings.defaultReasoningEnabled = value;
              await this.plugin.saveSettings();
            }),
        );

      new Setting(containerEl)
        .setName("Default Reasoning Effort")
        .setDesc("Reasoning strength when reasoning is enabled")
        .addDropdown((dropdown) =>
          dropdown
            .addOption("minimal", "Minimal")
            .addOption("low", "Low")
            .addOption("medium", "Medium")
            .addOption("high", "High")
            .addOption("xhigh", "Extra high")
            .setValue(this.plugin.settings.defaultReasoningEffort)
            .onChange(async (value) => {
              this.plugin.settings.defaultReasoningEffort =
                value as ReasoningEffort;
              await this.plugin.saveSettings();
            }),
        );
    }

    new Setting(containerEl)
      .setName("Templates Folder")
      .setDesc("Folder containing template markdown files")
      .addText((text) => {
        text.setValue(this.plugin.settings.templatesFolder);
        text.inputEl.placeholder = "scholia/templates";
        new FolderSuggest(this.plugin.app, text.inputEl, (folder) => {
          text.setValue(folder.path);
          this.plugin.settings.templatesFolder = folder.path;
          this.plugin.saveSettings();
        });
        text.onChange(async (value) => {
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
      .setName("Show run metadata")
      .setDesc("Show model, tokens, cost, and duration in generated callouts")
      .addToggle((toggle) =>
        toggle
          .setValue(this.plugin.settings.showRunMetadata)
          .onChange(async (value) => {
            this.plugin.settings.showRunMetadata = value;
            await this.plugin.saveSettings();
          }),
      );

    new Setting(containerEl)
      .setName("Chat follow-ups")
      .setDesc(
        "Append custom-probe follow-up questions inside the current Scholia callout",
      )
      .addToggle((toggle) =>
        toggle
          .setValue(this.plugin.settings.chatFollowupsEnabled)
          .onChange(async (value) => {
            this.plugin.settings.chatFollowupsEnabled = value;
            await this.plugin.saveSettings();
          }),
      );

    new Setting(containerEl)
      .setName("Spaced Repetition integration")
      .setDesc(
        "Format enabled templates as Obsidian Spaced Repetition flashcards",
      )
      .addToggle((toggle) =>
        toggle
          .setValue(this.plugin.settings.spacedRepetitionIntegrationEnabled)
          .onChange(async (value) => {
            this.plugin.settings.spacedRepetitionIntegrationEnabled = value;
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
            const explorerLeaves =
              this.plugin.app.workspace.getLeavesOfType("file-explorer");
            if (explorerLeaves.length > 0) {
              await this.plugin.app.workspace.revealLeaf(explorerLeaves[0]);
            } else {
              new Notice(
                `Templates folder: ${this.plugin.settings.templatesFolder}`,
              );
            }
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
token_budget: 30000
reasoning: true
reasoning_effort: medium
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
token_budget: 30000
reasoning: true
reasoning_effort: medium
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
        name: "Scholia Note",
        content: `---
context_scope: heading
output_destination: inline
model: z-ai/glm-5.1
temperature: 0.5
token_budget: 30000
reasoning: true
reasoning_effort: medium
custom_probe: true
callout_type: ai
callout_label: "Scholia Note"
callout_folded: true
requires_selection: false
command_prefix: "Run"
hotkey: []
---
You are a helpful study partner. Use the provided note context and the user's prompt to produce a concise scholia note that captures the key idea, important nuance, and why it matters. Keep it readable and well-structured without repeating the source text verbatim.`,
      },
      {
        name: "Flashcard",
        content: `---
context_scope: selection
output_destination: inline
model: z-ai/glm-5.1
temperature: 0.4
token_budget: 30000
reasoning: true
reasoning_effort: medium
callout_type: scholia-flashcard
callout_label: "Flashcard"
callout_folded: true
requires_selection: true
command_prefix: "Run"
hotkey: []
also_append_to: "scholia/flashcards.md"
append_format: markdown
spaced_repetition: true
sr_format: basic
sr_deck: "#flashcards/scholia"
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

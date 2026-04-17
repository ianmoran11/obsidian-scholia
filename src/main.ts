import { App, Plugin, TAbstractFile, TFile } from "obsidian";
import {
  ScholiaSettings,
  DEFAULT_SETTINGS,
  ScholiaSettingTab,
} from "./settings";
import { TemplateRegistry } from "./templates/registry";

export default class ScholiaPlugin extends Plugin {
  settings: ScholiaSettings;
  registry!: TemplateRegistry;

  async onload() {
    await this.loadSettings();
    this.addSettingTab(new ScholiaSettingTab(this.app, this));

    this.registry = new TemplateRegistry(
      this.app,
      this as unknown as {
        app: App;
        settings: {
          templatesFolder: string;
          defaultCalloutType: string;
          defaultModel: string;
          defaultTemperature: number;
          defaultMaxTokens: number;
        };
      },
      () => {
        this.loadTemplates();
      },
    );

    await this.loadTemplates();
    this.registerTemplateEvents();
  }

  private async loadTemplates(): Promise<void> {
    await this.registry.load();
  }

  private registerTemplateEvents(): void {
    this.registerEvent(
      this.app.vault.on("create", (file: TFile) => {
        this.registry.handleCreate(file);
      }),
    );

    this.registerEvent(
      this.app.vault.on("modify", (file: TFile) => {
        this.registry.handleModify(file);
      }),
    );

    this.registerEvent(
      this.app.vault.on("rename", (file: TAbstractFile, oldPath: string) => {
        if (file instanceof TFile) {
          this.registry.handleRename(file, oldPath);
        }
      }),
    );

    this.registerEvent(
      this.app.vault.on("delete", (file: TAbstractFile) => {
        if (file instanceof TFile) {
          this.registry.handleDelete(file);
        }
      }),
    );
  }

  async loadSettings() {
    this.settings = Object.assign({}, DEFAULT_SETTINGS, await this.loadData());
  }

  async saveSettings() {
    await this.saveData(this.settings);
  }
}

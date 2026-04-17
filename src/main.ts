import { App, Plugin, PluginSettingTab, Setting } from "obsidian";
import { ScholiaSettings, DEFAULT_SETTINGS } from "./settings";

export default class ScholiaPlugin extends Plugin {
  settings: ScholiaSettings;

  async onload() {
    await this.loadSettings();
    this.addSettingTab(new ScholiaSettingTab(this.app, this));
  }

  async loadSettings() {
    this.settings = Object.assign({}, DEFAULT_SETTINGS, await this.loadData());
  }

  async saveSettings() {
    await this.saveData(this.settings);
  }
}

class ScholiaSettingTab extends PluginSettingTab {
  plugin: ScholiaPlugin;

  constructor(app: App, plugin: ScholiaPlugin) {
    super(app, plugin);
    this.plugin = plugin;
  }

  display(): void {
    const { containerEl } = this;
    containerEl.empty();
    containerEl.createEl("h2", { text: "Scholia Settings" });
  }
}

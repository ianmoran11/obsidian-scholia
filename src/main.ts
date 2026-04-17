import { App, Plugin } from "obsidian";
import {
  ScholiaSettings,
  DEFAULT_SETTINGS,
  ScholiaSettingTab,
} from "./settings";

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

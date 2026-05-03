import { Editor, MarkdownFileInfo, MarkdownView, Plugin, TAbstractFile, TFile } from "obsidian";
import {
  ScholiaSettings,
  DEFAULT_SETTINGS,
  ScholiaSettingTab,
} from "./settings";
import { TemplateRegistry } from "./templates/registry";
import { StreamManager } from "./stream/manager";

export default class ScholiaPlugin extends Plugin {
  settings!: ScholiaSettings;
  registry!: TemplateRegistry;
  streamManager!: StreamManager;

  async onload() {
    await this.loadSettings();
    this.addSettingTab(new ScholiaSettingTab(this.app, this));

    this.streamManager = new StreamManager(this);

    this.registry = new TemplateRegistry(this.app, this, this.streamManager);
    this.registry.registerRegenerateCommand();
    this.registry.registerRegeneratePostProcessor((processor) => {
      this.registerMarkdownPostProcessor(processor);
    });

    await this.loadTemplates();
    this.registerTemplateEvents();
    this.registerEditorChangeEvent();
  }

  private async loadTemplates(): Promise<void> {
    await this.registry.load();
  }

  private registerTemplateEvents(): void {
    this.registerEvent(
      this.app.vault.on("create", (file: TAbstractFile) => {
        if (file instanceof TFile) this.registry.handleCreate(file);
      }),
    );

    this.registerEvent(
      this.app.vault.on("modify", (file: TAbstractFile) => {
        if (file instanceof TFile) this.registry.handleModify(file);
      }),
    );

    this.registerEvent(
      this.app.vault.on("rename", (file: TAbstractFile, oldPath: string) => {
        if (file instanceof TFile) this.registry.handleRename(file, oldPath);
      }),
    );

    this.registerEvent(
      this.app.vault.on("delete", (file: TAbstractFile) => {
        if (file instanceof TFile) this.registry.handleDelete(file);
      }),
    );
  }

  private registerEditorChangeEvent(): void {
    this.registerEvent(
      this.app.workspace.on(
        "editor-change",
        (editor: Editor, info: MarkdownView | MarkdownFileInfo) => {
          const filePath =
            info instanceof MarkdownView
              ? info.file?.path
              : (info as MarkdownFileInfo).file?.path;
          if (filePath) {
            this.streamManager.handleEditorChange(editor, filePath);
          }
        },
      ),
    );
  }

  async loadSettings() {
    this.settings = Object.assign({}, DEFAULT_SETTINGS, await this.loadData());
  }

  async saveSettings() {
    await this.saveData(this.settings);
  }
}

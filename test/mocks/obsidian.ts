export class Notice {
  constructor(message: string) {
    console.log(`[Notice] ${message}`);
  }
}

export class Command {
  id: string = "";
  name: string = "";
  callback: () => void = () => {};
  hotkeys?: { modifiers: string[]; key: string }[];
}

export interface Hotkey {
  modifiers: string[];
  key: string;
}

export interface TFile {
  path: string;
  stat: { mtime: number };
}

export interface TFolder {
  path: string;
}

export interface App {
  vault: Vault;
  metadataCache: MetadataCache;
  commands: {
    addCommand: (cmd: Command) => void;
    removeCommand: (id: string) => void;
  };
  workspace: {
    on: (event: string, callback: (...args: unknown[]) => void) => void;
  };
}

export interface Vault {
  getFolderByPath: (path: string) => TFolder | null;
  getMarkdownFiles: () => TFile[];
  getFileByPath: (path: string) => TFile | null;
  read: (file: TFile) => Promise<string>;
}

export interface MetadataCache {
  getFileCache: (file: TFile) => {
    frontmatter: Record<string, unknown> | null;
  };
}

export class Editor {
  private content: string = "";

  getValue(): string {
    return this.content;
  }

  setValue(value: string): void {
    this.content = value;
  }

  replaceRange(
    text: string,
    start: { line: number; ch: number },
    end?: { line: number; ch: number },
  ): void {
    const startOffset = this.posToOffset(start);
    const endOffset = end ? this.posToOffset(end) : startOffset;
    this.content =
      this.content.slice(0, startOffset) + text + this.content.slice(endOffset);
  }

  offsetToPos(offset: number): { line: number; ch: number } {
    const lines = this.content.slice(0, offset).split("\n");
    return {
      line: lines.length - 1,
      ch: lines[lines.length - 1].length,
    };
  }

  posToOffset(pos: { line: number; ch: number }): number {
    const lines = this.content.split("\n");
    let offset = 0;
    for (let i = 0; i < pos.line && i < lines.length; i++) {
      offset += lines[i].length + 1;
    }
    offset += pos.ch;
    return offset;
  }

  getSelection(): string {
    return this.content;
  }
}

export class Modal {
  open(): void {}
  close(): void {}
}

export class PluginSettingTab {
  constructor(app: App, plugin: unknown) {}
  addText(cb: (setting: unknown) => void): void {}
  addDropdown(cb: (setting: unknown) => void): void {}
  addSlider(cb: (setting: unknown) => void): void {}
  addToggle(cb: (setting: unknown) => void): void {}
  addButton(cb: (setting: unknown) => void): void {}
}

export class Setting {
  constructor(containerEl: HTMLElement) {}
  setName(name: string): this {
    return this;
  }
  setDesc(desc: string): this {
    return this;
  }
  addText(cb: (text: unknown) => void): this {
    return this;
  }
  addDropdown(cb: (dropdown: unknown) => void): this {
    return this;
  }
  addSlider(cb: (slider: unknown) => void): this {
    return this;
  }
  addToggle(cb: (toggle: unknown) => void): this {
    return this;
  }
  addButton(cb: (button: unknown) => void): this {
    return this;
  }
}

export function parseYaml(yaml: string): Record<string, unknown> {
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

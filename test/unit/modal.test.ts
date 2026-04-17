import { describe, it, expect, vi, beforeEach } from "vitest";
import type { TemplateConfig } from "../../src/templates/types";

function createMockObsidianEl(): any {
  const domEl = document.createElement("div");

  function attachMethods(el: HTMLElement): any {
    const wrapped = el as any;
    wrapped.setAttr = function (key: string, val: string) {
      el.setAttribute(key, val);
      return wrapped;
    };
    wrapped.setText = function (text: string) {
      el.textContent = text;
      return wrapped;
    };
    wrapped.createEl = function (
      tagName: string,
      options?: {
        cls?: string;
        text?: string;
        attr?: Record<string, string>;
        [key: string]: string | undefined;
      },
    ) {
      const child = document.createElement(tagName);
      if (options?.cls) child.className = options.cls;
      if (options?.text) child.textContent = options.text;
      if (options?.attr) {
        for (const [key, value] of Object.entries(options.attr)) {
          child.setAttribute(key, value);
        }
      }
      for (const [key, value] of Object.entries(options ?? {})) {
        if (
          key !== "cls" &&
          key !== "text" &&
          key !== "attr" &&
          value !== undefined
        ) {
          child.setAttribute(key, value);
        }
      }
      el.appendChild(child);
      return attachMethods(child);
    };
    wrapped.createDiv = function (cls?: string) {
      const div = document.createElement("div");
      if (cls) div.className = cls;
      el.appendChild(div);
      return attachMethods(div);
    };
    wrapped.empty = function () {
      while (el.firstChild) {
        el.removeChild(el.firstChild);
      }
    };
    return wrapped;
  }

  return attachMethods(domEl);
}

vi.mock("obsidian", async () => {
  const actual = await vi.importActual("../../test/mocks/obsidian");
  return {
    ...actual,
    Modal: class extends actual.Modal {
      contentEl: HTMLElement = createMockObsidianEl();

      open(): void {
        this.onOpen();
      }

      close(): void {
        this.onClose();
      }

      onOpen(): void {}
      onClose(): void {}
    },
  };
});

import { CustomProbeModal } from "../../src/ui/modal";

function createMockApp() {
  return {
    vault: {
      getFolderByPath: vi.fn(),
      getMarkdownFiles: vi.fn(),
      getFileByPath: vi.fn(),
      read: vi.fn(),
    },
    metadataCache: {
      getFileCache: vi.fn(),
    },
    commands: {
      addCommand: vi.fn(),
      removeCommand: vi.fn(),
    },
    workspace: {
      on: vi.fn(),
    },
  };
}

function createMockTemplate(): TemplateConfig {
  return {
    id: "test-template",
    name: "Test Template",
    filePath: "/test/Test.md",
    systemPrompt: "You are a helpful tutor.",
    contextScope: "heading",
    outputDestination: "inline",
    model: "test/model",
    temperature: 0.7,
    maxTokens: 1024,
    calloutType: "ai",
    calloutLabel: "Test",
    calloutFolded: true,
    requiresSelection: false,
    commandPrefix: "Run",
    hotkey: [],
  };
}

describe("CustomProbeModal", () => {
  let modal: CustomProbeModal;
  let app: ReturnType<typeof createMockApp>;
  let templateConfig: TemplateConfig;

  beforeEach(() => {
    app = createMockApp();
    templateConfig = createMockTemplate();
    modal = new CustomProbeModal(app as any, templateConfig);
  });

  it("renders heading with template calloutLabel", () => {
    modal.open();
    const h2 = modal.contentEl.querySelector("h2");
    expect(h2).not.toBeNull();
    expect(h2?.textContent).toBe("Custom Probe: Test");
    modal.close();
  });

  it("renders textarea with class custom-probe-textarea", () => {
    modal.open();
    const textarea = modal.contentEl.querySelector(
      ".custom-probe-textarea",
    ) as HTMLTextAreaElement;
    expect(textarea).not.toBeNull();
    expect(textarea.tagName).toBe("TEXTAREA");
    expect(textarea.rows).toBe(4);
    modal.close();
  });

  it("renders error element with class custom-probe-error", () => {
    modal.open();
    const errorEl = modal.contentEl.querySelector(".custom-probe-error");
    expect(errorEl).not.toBeNull();
    expect(errorEl?.style.display).toBe("none");
    modal.close();
  });

  it("renders three radio buttons for context scope", () => {
    modal.open();
    const radios = modal.contentEl.querySelectorAll(
      'input[type="radio"][name="context-scope"]',
    );
    expect(radios.length).toBe(3);
    const values = Array.from(radios).map((r) => (r as HTMLInputElement).value);
    expect(values).toContain("selection");
    expect(values).toContain("heading");
    expect(values).toContain("full-note");
    modal.close();
  });

  it("defaults to template contextScope radio button", () => {
    templateConfig.contextScope = "full-note";
    modal = new CustomProbeModal(app as any, templateConfig);
    modal.open();
    const checkedRadio = modal.contentEl.querySelector(
      'input[type="radio"][name="context-scope"]:checked',
    ) as HTMLInputElement;
    expect(checkedRadio?.value).toBe("full-note");
    modal.close();
  });

  it("renders checkbox for central capture", () => {
    modal.open();
    const checkbox = modal.contentEl.querySelector(
      "#also-append-central",
    ) as HTMLInputElement;
    expect(checkbox).not.toBeNull();
    expect(checkbox.type).toBe("checkbox");
    modal.close();
  });

  it("renders Cancel and Submit buttons", () => {
    modal.open();
    const buttons = modal.contentEl.querySelectorAll("button");
    const buttonTexts = Array.from(buttons).map((b) => b.textContent);
    expect(buttonTexts).toContain("Cancel");
    expect(buttonTexts).toContain("Submit");
    modal.close();
  });

  it("Submit button has mod-cta class", () => {
    modal.open();
    const submitBtn = modal.contentEl.querySelector(
      "button.mod-cta",
    ) as HTMLButtonElement;
    expect(submitBtn).not.toBeNull();
    expect(submitBtn?.textContent).toBe("Submit");
    modal.close();
  });

  it("shows error when submitting empty query", () => {
    modal.open();
    const submitBtn = modal.contentEl.querySelector(
      "button.mod-cta",
    ) as HTMLButtonElement;
    submitBtn.click();
    const errorEl = modal.contentEl.querySelector(
      ".custom-probe-error",
    ) as HTMLElement;
    expect(errorEl.style.display).toBe("block");
    expect(errorEl.textContent).toBe("Please enter a question or request.");
    modal.close();
  });

  it("textarea has placeholder text", () => {
    modal.open();
    const textarea = modal.contentEl.querySelector(
      ".custom-probe-textarea",
    ) as HTMLTextAreaElement;
    expect(textarea?.placeholder).toBe("Enter your question or request...");
    modal.close();
  });

  it("has label for textarea", () => {
    modal.open();
    const labels = modal.contentEl.querySelectorAll("label");
    const labelTexts = Array.from(labels).map((l) => l.textContent);
    expect(labelTexts).toContain("Your question or request:");
    modal.close();
  });

  it("has label for context scope section", () => {
    modal.open();
    const labels = modal.contentEl.querySelectorAll("label");
    const labelTexts = Array.from(labels).map((l) => l.textContent);
    expect(labelTexts).toContain("Context scope:");
    modal.close();
  });

  it("has label for also append checkbox", () => {
    modal.open();
    const labels = modal.contentEl.querySelectorAll("label");
    const labelTexts = Array.from(labels).map((l) => l.textContent);
    expect(labelTexts).toContain("Also append to central capture file");
    modal.close();
  });

  it("renders radio labels for each scope", () => {
    modal.open();
    const radioLabels = modal.contentEl.querySelectorAll(
      'label[for^="scope-"]',
    );
    const texts = Array.from(radioLabels).map((l) => l.textContent);
    expect(texts).toContain("selection");
    expect(texts).toContain("heading");
    expect(texts).toContain("full-note");
    modal.close();
  });

  it("clears contentEl on close", () => {
    modal.open();
    expect(modal.contentEl.children.length).toBeGreaterThan(0);
    modal.close();
    expect(modal.contentEl.children.length).toBe(0);
  });
});

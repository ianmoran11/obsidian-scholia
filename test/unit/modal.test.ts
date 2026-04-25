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

function createMockTemplate(overrides: Partial<TemplateConfig> = {}): TemplateConfig {
  return {
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
    ...overrides,
  };
}

const modalDefaults = {
  defaultReasoningEnabled: true,
  defaultReasoningEffort: "medium" as const,
  defaultTokenBudget: 30000,
};

describe("CustomProbeModal", () => {
  let app: ReturnType<typeof createMockApp>;

  beforeEach(() => {
    app = createMockApp();
  });

  it("renders the standard run modal without a custom prompt textarea", () => {
    const modal = new CustomProbeModal(
      app as any,
      createMockTemplate(),
      modalDefaults,
    );

    modal.open();

    expect(modal.contentEl.querySelector("h2")?.textContent).toBe("Run: Test");
    expect(modal.contentEl.querySelector(".custom-probe-textarea")).toBeNull();
    expect(
      modal.contentEl.querySelector("#also-append-central"),
    ).toBeNull();
  });

  it("renders custom probe controls when enabled", () => {
    const modal = new CustomProbeModal(
      app as any,
      createMockTemplate({ customProbe: true, alsoAppendTo: "_System/Central.md" }),
      modalDefaults,
    );

    modal.open();

    expect(modal.contentEl.querySelector("h2")?.textContent).toBe(
      "Custom Probe: Test",
    );
    expect(
      modal.contentEl.querySelector(".custom-probe-textarea"),
    ).not.toBeNull();
    expect(
      modal.contentEl.querySelector("#also-append-central"),
    ).not.toBeNull();
  });

  it("shows reasoning and token budget controls for every run", () => {
    const modal = new CustomProbeModal(
      app as any,
      createMockTemplate(),
      modalDefaults,
    );

    modal.open();

    const reasoningCheckbox = modal.contentEl.querySelector(
      "#reasoning-enabled",
    ) as HTMLInputElement;
    const effortSelect = modal.contentEl.querySelector(
      "#reasoning-effort",
    ) as HTMLSelectElement;
    const tokenBudget = modal.contentEl.querySelector(
      "#token-budget",
    ) as HTMLInputElement;

    expect(reasoningCheckbox.checked).toBe(true);
    expect(effortSelect.value).toBe("medium");
    expect(effortSelect.disabled).toBe(false);
    expect(tokenBudget.value).toBe("30000");
  });

  it("disables reasoning effort when reasoning is turned off", () => {
    const modal = new CustomProbeModal(
      app as any,
      createMockTemplate(),
      modalDefaults,
    );

    modal.open();

    const reasoningCheckbox = modal.contentEl.querySelector(
      "#reasoning-enabled",
    ) as HTMLInputElement;
    const effortSelect = modal.contentEl.querySelector(
      "#reasoning-effort",
    ) as HTMLSelectElement;

    reasoningCheckbox.checked = false;
    reasoningCheckbox.dispatchEvent(new Event("change"));

    expect(effortSelect.disabled).toBe(true);
  });

  it("requires a query for custom probe runs", () => {
    const modal = new CustomProbeModal(
      app as any,
      createMockTemplate({ customProbe: true }),
      modalDefaults,
    );

    modal.open();
    (modal.contentEl.querySelector("button.mod-cta") as HTMLButtonElement).click();

    const errorEl = modal.contentEl.querySelector(
      ".custom-probe-error",
    ) as HTMLElement;
    expect(errorEl.style.display).toBe("block");
    expect(errorEl.textContent).toBe("Please enter a question or request.");
  });

  it("submits a normal run without a custom query", async () => {
    const modal = new CustomProbeModal(
      app as any,
      createMockTemplate(),
      modalDefaults,
    );

    const resultPromise = modal.openAndWait();
    const reasoningCheckbox = modal.contentEl.querySelector(
      "#reasoning-enabled",
    ) as HTMLInputElement;
    const effortSelect = modal.contentEl.querySelector(
      "#reasoning-effort",
    ) as HTMLSelectElement;
    const tokenBudget = modal.contentEl.querySelector(
      "#token-budget",
    ) as HTMLInputElement;

    reasoningCheckbox.checked = false;
    reasoningCheckbox.dispatchEvent(new Event("change"));
    effortSelect.value = "high";
    effortSelect.dispatchEvent(new Event("change"));
    tokenBudget.value = "4096";
    (modal.contentEl.querySelector("button.mod-cta") as HTMLButtonElement).click();

    await expect(resultPromise).resolves.toEqual({
      query: "",
      scope: "heading",
      alsoAppendToCentral: false,
      reasoningEnabled: false,
      reasoningEffort: "high",
      tokenBudget: 4096,
    });
  });

  it("submits a custom probe on Enter", async () => {
    const modal = new CustomProbeModal(
      app as any,
      createMockTemplate({ customProbe: true }),
      modalDefaults,
    );

    const resultPromise = modal.openAndWait();
    const textarea = modal.contentEl.querySelector(
      ".custom-probe-textarea",
    ) as HTMLTextAreaElement;
    textarea.value = "Explain this";
    textarea.dispatchEvent(
      new KeyboardEvent("keydown", { key: "Enter", bubbles: true }),
    );

    await expect(resultPromise).resolves.toMatchObject({
      query: "Explain this",
      scope: "heading",
      reasoningEnabled: true,
      reasoningEffort: "medium",
      tokenBudget: 30000,
    });
  });

  it("clamps the submitted token budget", async () => {
    const modal = new CustomProbeModal(
      app as any,
      createMockTemplate(),
      modalDefaults,
    );

    const resultPromise = modal.openAndWait();
    const tokenBudget = modal.contentEl.querySelector(
      "#token-budget",
    ) as HTMLInputElement;
    tokenBudget.value = "999999";
    (modal.contentEl.querySelector("button.mod-cta") as HTMLButtonElement).click();

    await expect(resultPromise).resolves.toMatchObject({
      tokenBudget: 65536,
    });
  });
});

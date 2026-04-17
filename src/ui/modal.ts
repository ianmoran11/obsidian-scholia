import { App, Modal } from "obsidian";
import type { ContextScope, TemplateConfig } from "../templates/types";

export interface CustomProbeResult {
  query: string;
  scope: ContextScope;
  alsoAppendToCentral: boolean;
}

export class CustomProbeModal extends Modal {
  private query: string = "";
  private contextScope: ContextScope;
  private alsoAppendToCentral: boolean = false;
  private errorEl: HTMLElement | null = null;
  private resolvePromise: ((result: CustomProbeResult | null) => void) | null =
    null;

  constructor(
    app: App,
    private templateConfig: TemplateConfig,
  ) {
    super(app);
    this.contextScope = templateConfig.contextScope;
    this.alsoAppendToCentral = !!templateConfig.alsoAppendTo;
  }

  async openAndWait(): Promise<CustomProbeResult | null> {
    return new Promise((resolve) => {
      this.resolvePromise = resolve;
      this.open();
    });
  }

  onOpen(): void {
    const { contentEl } = this;
    contentEl.empty();

    contentEl.createEl("h2", {
      text: `Custom Probe: ${this.templateConfig.calloutLabel ?? "Custom"}`,
    });

    const formEl = contentEl.createDiv("custom-probe-form");

    formEl.createEl("label", { text: "Your question or request:" });

    const textarea = formEl.createEl("textarea", {
      cls: "custom-probe-textarea",
    });
    textarea.setAttr("rows", "4");
    textarea.setAttr("placeholder", "Enter your question or request...");
    textarea.focus();

    this.errorEl = formEl.createDiv("custom-probe-error");
    this.errorEl.style.color = "var(--text-error)";
    this.errorEl.style.display = "none";

    formEl.createEl("label", { text: "Context scope:" });

    const scopeContainer = formEl.createDiv("custom-probe-scopes");
    const scopes: ContextScope[] = ["selection", "heading", "full-note"];
    for (const s of scopes) {
      const radioWrapper = scopeContainer.createDiv("radio-wrapper");
      const radio = radioWrapper.createEl("input", {
        type: "radio",
        value: s,
      });
      radio.setAttr("name", "context-scope");
      radio.id = `scope-${s}`;
      if (s === this.contextScope) {
        radio.setAttr("checked", "checked");
      }
      radioWrapper.createEl("label", {
        text: s,
        attr: { for: `scope-${s}` },
      });

      radio.onclick = () => {
        this.contextScope = s;
      };
    }

    const checkboxWrapper = formEl.createDiv("checkbox-wrapper");
    const checkbox = checkboxWrapper.createEl("input", {
      type: "checkbox",
    });
    checkbox.id = "also-append-central";
    checkbox.checked = this.alsoAppendToCentral;
    checkboxWrapper.createEl("label", {
      text: "Also append to central capture file",
      attr: { for: "also-append-central" },
    });

    checkbox.onchange = () => {
      this.alsoAppendToCentral = checkbox.checked;
    };

    const buttonRow = formEl.createDiv("button-row");

    const cancelBtn = buttonRow.createEl("button", { text: "Cancel" });
    cancelBtn.onclick = () => {
      this.close();
      this.resolvePromise?.(null);
    };

    const submitBtn = buttonRow.createEl("button", {
      text: "Submit",
      cls: "mod-cta",
    });
    submitBtn.onclick = () => {
      this.handleSubmit();
    };

    textarea.addEventListener("keydown", (e) => {
      if (e.key === "Enter" && !e.shiftKey) {
        e.preventDefault();
        this.handleSubmit();
      } else if (e.key === "Escape") {
        this.close();
        this.resolvePromise?.(null);
      }
    });

    contentEl.addEventListener("keydown", (e) => {
      if (e.key === "Escape") {
        this.close();
        this.resolvePromise?.(null);
      }
    });
  }

  private handleSubmit(): void {
    const textarea = this.contentEl.querySelector(
      ".custom-probe-textarea",
    ) as HTMLTextAreaElement;
    const query = textarea?.value.trim() ?? "";

    if (!query) {
      if (this.errorEl) {
        this.errorEl.setText("Please enter a question or request.");
        this.errorEl.style.display = "block";
      }
      return;
    }

    this.query = query;
    this.close();
    this.resolvePromise?.({
      query: this.query,
      scope: this.contextScope,
      alsoAppendToCentral: this.alsoAppendToCentral,
    });
  }

  onClose(): void {
    const { contentEl } = this;
    contentEl.empty();
  }
}

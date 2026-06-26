import { App, Modal } from "obsidian";
import type {
  ContextScope,
  OutputMode,
  ReasoningEffort,
  TemplateConfig,
} from "../templates/types";

export interface CustomProbeResult {
  query: string;
  scope: ContextScope;
  alsoAppendToCentral: boolean;
  reasoningEnabled: boolean;
  reasoningEffort: ReasoningEffort;
  tokenBudget: number;
  outputMode: OutputMode;
  sectionLevel: number;
}

export interface RunModalDefaults {
  defaultReasoningEnabled: boolean;
  defaultReasoningEffort: ReasoningEffort;
  defaultTokenBudget: number;
}

export class CustomProbeModal extends Modal {
  private query: string = "";
  private contextScope: ContextScope;
  private alsoAppendToCentral: boolean = false;
  private reasoningEnabled: boolean;
  private reasoningEffort: ReasoningEffort;
  private tokenBudget: number;
  private outputMode: OutputMode = "callout";
  private sectionLevel: number = 2;
  /** Output mode only applies to inline templates (not file-append ones). */
  private readonly outputModeApplies: boolean;
  private errorEl: HTMLElement | null = null;
  private resolvePromise: ((result: CustomProbeResult | null) => void) | null =
    null;

  constructor(
    app: App,
    private templateConfig: TemplateConfig,
    private defaults: RunModalDefaults,
  ) {
    super(app);
    this.contextScope = templateConfig.contextScope;
    this.alsoAppendToCentral = !!templateConfig.alsoAppendTo;
    this.reasoningEnabled = defaults.defaultReasoningEnabled;
    this.reasoningEffort = defaults.defaultReasoningEffort;
    this.tokenBudget = defaults.defaultTokenBudget;
    this.outputModeApplies = templateConfig.outputDestination === "inline";
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
      text: `${
        this.templateConfig.customProbe ? "Custom Probe" : "Run"
      }: ${this.templateConfig.calloutLabel ?? "Scholia"}`,
    });

    const formEl = contentEl.createDiv("custom-probe-form");

    let textarea: HTMLTextAreaElement | null = null;
    if (this.templateConfig.customProbe) {
      formEl.createEl("label", { text: "Your question or request:" });

      textarea = formEl.createEl("textarea", {
        cls: "custom-probe-textarea",
      });
      textarea.setAttr("rows", "4");
      textarea.setAttr("placeholder", "Enter your question or request...");
      textarea.focus();
    }

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

    if (this.outputModeApplies) {
      this.renderOutputModeControls(formEl);
    }

    if (this.templateConfig.customProbe) {
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
    }

    const reasoningWrapper = formEl.createDiv("checkbox-wrapper");
    const reasoningCheckbox = reasoningWrapper.createEl("input", {
      type: "checkbox",
    });
    reasoningCheckbox.id = "reasoning-enabled";
    reasoningCheckbox.checked = this.reasoningEnabled;
    reasoningWrapper.createEl("label", {
      text: "Enable reasoning",
      attr: { for: "reasoning-enabled" },
    });

    const effortLabel = formEl.createEl("label", { text: "Reasoning effort:" });
    effortLabel.setAttr("for", "reasoning-effort");
    const effortSelect = formEl.createEl("select");
    effortSelect.id = "reasoning-effort";
    const reasoningEfforts: Array<{ value: ReasoningEffort; label: string }> = [
      { value: "minimal", label: "Minimal" },
      { value: "low", label: "Low" },
      { value: "medium", label: "Medium" },
      { value: "high", label: "High" },
      { value: "xhigh", label: "Extra high" },
    ];
    for (const option of reasoningEfforts) {
      const optionEl = effortSelect.createEl("option", {
        text: option.label,
        value: option.value,
      });
      optionEl.value = option.value;
    }
    effortSelect.value = this.reasoningEffort;
    effortSelect.disabled = !this.reasoningEnabled;

    reasoningCheckbox.onchange = () => {
      this.reasoningEnabled = reasoningCheckbox.checked;
      effortSelect.disabled = !this.reasoningEnabled;
    };
    effortSelect.onchange = () => {
      this.reasoningEffort = effortSelect.value as ReasoningEffort;
    };

    const tokenLabel = formEl.createEl("label", { text: "Token budget:" });
    tokenLabel.setAttr("for", "token-budget");
    const tokenInput = formEl.createEl("input", {
      cls: "token-budget-input",
      type: "number",
    });
    tokenInput.id = "token-budget";
    tokenInput.value = String(this.tokenBudget);
    tokenInput.min = "128";
    tokenInput.max = "65536";
    tokenInput.step = "1";

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

    textarea?.addEventListener("keydown", (e) => {
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

  private renderOutputModeControls(formEl: HTMLElement): void {
    const modeLabel = formEl.createEl("label", { text: "Output:" });
    modeLabel.setAttr("for", "output-mode");
    const modeSelect = formEl.createEl("select");
    modeSelect.id = "output-mode";
    const modes: Array<{ value: OutputMode; label: string }> = [
      { value: "callout", label: "Callout" },
      { value: "section", label: "New section" },
      { value: "in-place", label: "Edit in place" },
    ];
    for (const m of modes) {
      const optionEl = modeSelect.createEl("option", {
        text: m.label,
        value: m.value,
      });
      optionEl.value = m.value;
    }
    modeSelect.value = this.outputMode;

    // Header level — only relevant for the "New section" mode.
    const levelLabel = formEl.createEl("label", { text: "Header level:" });
    levelLabel.setAttr("for", "section-level");
    const levelSelect = formEl.createEl("select");
    levelSelect.id = "section-level";
    for (let level = 1; level <= 6; level++) {
      const optionEl = levelSelect.createEl("option", {
        text: `${"#".repeat(level)} (H${level})`,
        value: String(level),
      });
      optionEl.value = String(level);
    }
    levelSelect.value = String(this.sectionLevel);

    // Hint — explains that the context scope above is the region rewritten.
    const inPlaceHint = formEl.createEl("p", {
      text: "Edit in place replaces the region chosen under Context scope above.",
      cls: "output-mode-hint",
    });
    inPlaceHint.style.color = "var(--text-muted)";
    inPlaceHint.style.fontSize = "var(--font-ui-smaller)";

    const syncVisibility = () => {
      const isSection = this.outputMode === "section";
      const isInPlace = this.outputMode === "in-place";
      levelLabel.style.display = isSection ? "" : "none";
      levelSelect.style.display = isSection ? "" : "none";
      inPlaceHint.style.display = isInPlace ? "" : "none";
    };
    syncVisibility();

    modeSelect.onchange = () => {
      this.outputMode = modeSelect.value as OutputMode;
      syncVisibility();
    };
    levelSelect.onchange = () => {
      this.sectionLevel = parseInt(levelSelect.value, 10);
    };
  }

  private handleSubmit(): void {
    const textarea = this.contentEl.querySelector(
      ".custom-probe-textarea",
    ) as HTMLTextAreaElement | null;
    const tokenInput = this.contentEl.querySelector(
      ".token-budget-input",
    ) as HTMLInputElement | null;
    const query = textarea?.value.trim() ?? "";
    const parsedBudget = parseInt(tokenInput?.value ?? "", 10);

    if (this.templateConfig.customProbe && !query) {
      if (this.errorEl) {
        this.errorEl.setText("Please enter a question or request.");
        this.errorEl.style.display = "block";
      }
      return;
    }

    if (!Number.isFinite(parsedBudget)) {
      if (this.errorEl) {
        this.errorEl.setText("Please enter a valid token budget.");
        this.errorEl.style.display = "block";
      }
      return;
    }

    this.query = query;
    this.tokenBudget = Math.min(65536, Math.max(128, parsedBudget));
    this.close();
    this.resolvePromise?.({
      query: this.query,
      scope: this.contextScope,
      alsoAppendToCentral: this.alsoAppendToCentral,
      reasoningEnabled: this.reasoningEnabled,
      reasoningEffort: this.reasoningEffort,
      tokenBudget: this.tokenBudget,
      outputMode: this.outputModeApplies ? this.outputMode : "callout",
      sectionLevel: this.sectionLevel,
    });
  }

  onClose(): void {
    const { contentEl } = this;
    contentEl.empty();
  }
}

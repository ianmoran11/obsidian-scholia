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
  /** Region replaced when outputMode is "in-place" (independent of scope). */
  inPlaceScope: ContextScope;
  /** For "heading" scope: which level bounds the section. 0 = nearest. */
  headingLevel: number;
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
  private inPlaceScope: ContextScope;
  private headingLevel: number = 0;
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
    this.inPlaceScope = templateConfig.contextScope;
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
    contentEl.classList.add("scholia-run-modal");
    this.modalEl?.classList.add("scholia-run-modal-wrapper");

    contentEl.createEl("h2", {
      cls: "scholia-modal-title",
      text: `${
        this.templateConfig.customProbe ? "Custom Probe" : "Run"
      }: ${this.templateConfig.calloutLabel ?? "Scholia"}`,
    });

    const formEl = contentEl.createDiv("scholia-form custom-probe-form");

    let textarea: HTMLTextAreaElement | null = null;
    if (this.templateConfig.customProbe) {
      const field = this.createField(formEl, "Your question or request");
      textarea = field.createEl("textarea", {
        cls: "scholia-textarea custom-probe-textarea",
      });
      textarea.setAttr("rows", "4");
      textarea.setAttr("placeholder", "Enter your question or request…");
      textarea.focus();
    }

    this.errorEl = formEl.createDiv("scholia-error custom-probe-error");
    this.errorEl.style.display = "none";

    // Context scope — segmented pill group.
    const scopeField = this.createField(formEl, "Context scope");
    const scopeContainer = scopeField.createDiv(
      "scholia-segmented custom-probe-scopes",
    );
    const scopes: Array<{ value: ContextScope; label: string }> = [
      { value: "selection", label: "Selection" },
      { value: "heading", label: "Heading" },
      { value: "full-note", label: "Full note" },
    ];
    for (const s of scopes) {
      const radioWrapper = scopeContainer.createEl("label", {
        cls: "scholia-segment radio-wrapper",
        attr: { for: `scope-${s.value}` },
      });
      const radio = radioWrapper.createEl("input", {
        type: "radio",
        value: s.value,
      });
      radio.setAttr("name", "context-scope");
      radio.id = `scope-${s.value}`;
      if (s.value === this.contextScope) {
        radio.checked = true;
        radioWrapper.classList.add("is-active");
      }
      radioWrapper.createEl("span", { text: s.label });

      radio.onchange = () => {
        this.contextScope = s.value;
        scopeContainer
          .querySelectorAll(".scholia-segment")
          .forEach((el) => el.classList.remove("is-active"));
        radioWrapper.classList.add("is-active");
        syncHeadingLevel();
      };
    }

    // Heading level — only meaningful when the context scope is "heading".
    // "Nearest" keeps the innermost section; a level bounds it more broadly.
    const headingLevelField = this.createField(formEl, "Heading level");
    const headingLevelSelect = headingLevelField.createEl("select", {
      cls: "scholia-select",
    });
    headingLevelSelect.id = "context-heading-level";
    const headingLevelOptions: Array<{ value: number; label: string }> = [
      { value: 0, label: "Nearest" },
      { value: 1, label: "# (H1)" },
      { value: 2, label: "## (H2)" },
      { value: 3, label: "### (H3)" },
      { value: 4, label: "#### (H4)" },
      { value: 5, label: "##### (H5)" },
      { value: 6, label: "###### (H6)" },
    ];
    for (const option of headingLevelOptions) {
      const optionEl = headingLevelSelect.createEl("option", {
        text: option.label,
        value: String(option.value),
      });
      optionEl.value = String(option.value);
    }
    headingLevelSelect.value = String(this.headingLevel);
    headingLevelSelect.onchange = () => {
      this.headingLevel = parseInt(headingLevelSelect.value, 10);
    };
    const syncHeadingLevel = () => {
      headingLevelField.style.display =
        this.contextScope === "heading" ? "" : "none";
    };
    syncHeadingLevel();

    if (this.outputModeApplies) {
      this.renderOutputModeControls(formEl);
    }

    // Toggle options grouped together.
    const optionsGroup = formEl.createDiv("scholia-options");

    if (this.templateConfig.customProbe) {
      this.createToggle(
        optionsGroup,
        "also-append-central",
        "Also append to central capture file",
        this.alsoAppendToCentral,
        (checked) => {
          this.alsoAppendToCentral = checked;
        },
      );
    }

    this.createToggle(
      optionsGroup,
      "reasoning-enabled",
      "Enable reasoning",
      this.reasoningEnabled,
      (checked) => {
        this.reasoningEnabled = checked;
        effortSelect.disabled = !checked;
        effortField.classList.toggle("is-disabled", !checked);
      },
    );

    // Reasoning effort + token budget side by side.
    const tuningRow = formEl.createDiv("scholia-field-row");

    const effortField = this.createField(tuningRow, "Reasoning effort");
    const effortSelect = effortField.createEl("select", {
      cls: "scholia-select",
    });
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
    effortField.classList.toggle("is-disabled", !this.reasoningEnabled);
    effortSelect.onchange = () => {
      this.reasoningEffort = effortSelect.value as ReasoningEffort;
    };

    const tokenField = this.createField(tuningRow, "Token budget");
    const tokenInput = tokenField.createEl("input", {
      cls: "scholia-input token-budget-input",
      type: "number",
    });
    tokenInput.id = "token-budget";
    tokenInput.value = String(this.tokenBudget);
    tokenInput.min = "128";
    tokenInput.max = "65536";
    tokenInput.step = "1";

    const buttonRow = formEl.createDiv("scholia-button-row button-row");

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

  /** A labeled field group: a small caption label above a control slot. */
  private createField(parent: HTMLElement, labelText: string): HTMLDivElement {
    const field = parent.createDiv("scholia-field");
    field.createEl("label", { cls: "scholia-field-label", text: labelText });
    return field;
  }

  /** A checkbox + label row that toggles a boolean. Returns the row element. */
  private createToggle(
    parent: HTMLElement,
    id: string,
    labelText: string,
    initial: boolean,
    onChange: (checked: boolean) => void,
  ): HTMLLabelElement {
    const row = parent.createEl("label", {
      cls: "scholia-toggle checkbox-wrapper",
      attr: { for: id },
    });
    const checkbox = row.createEl("input", { type: "checkbox" });
    checkbox.id = id;
    checkbox.checked = initial;
    row.createEl("span", { text: labelText });
    checkbox.onchange = () => onChange(checkbox.checked);
    return row;
  }

  private renderOutputModeControls(formEl: HTMLElement): void {
    const row = formEl.createDiv("scholia-field-row");

    const modeField = this.createField(row, "Output");
    const modeSelect = modeField.createEl("select", { cls: "scholia-select" });
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
    const levelField = this.createField(row, "Header level");
    const levelSelect = levelField.createEl("select", { cls: "scholia-select" });
    levelSelect.id = "section-level";
    for (let level = 1; level <= 6; level++) {
      const optionEl = levelSelect.createEl("option", {
        text: `${"#".repeat(level)} (H${level})`,
        value: String(level),
      });
      optionEl.value = String(level);
    }
    levelSelect.value = String(this.sectionLevel);

    // Edit region — the region replaced in "Edit in place" mode. Independent
    // of the context scope above (you can read one region and rewrite another).
    const regionField = this.createField(row, "Edit region");
    const regionSelect = regionField.createEl("select", {
      cls: "scholia-select",
    });
    regionSelect.id = "in-place-scope";
    const regions: Array<{ value: ContextScope; label: string }> = [
      { value: "selection", label: "Selection" },
      { value: "heading", label: "Heading section" },
      { value: "full-note", label: "Whole note" },
    ];
    for (const r of regions) {
      const optionEl = regionSelect.createEl("option", {
        text: r.label,
        value: r.value,
      });
      optionEl.value = r.value;
    }
    regionSelect.value = this.inPlaceScope;

    const syncVisibility = () => {
      const isSection = this.outputMode === "section";
      const isInPlace = this.outputMode === "in-place";
      levelField.style.display = isSection ? "" : "none";
      regionField.style.display = isInPlace ? "" : "none";
    };
    syncVisibility();

    modeSelect.onchange = () => {
      this.outputMode = modeSelect.value as OutputMode;
      syncVisibility();
    };
    levelSelect.onchange = () => {
      this.sectionLevel = parseInt(levelSelect.value, 10);
    };
    regionSelect.onchange = () => {
      this.inPlaceScope = regionSelect.value as ContextScope;
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
      inPlaceScope: this.inPlaceScope,
      headingLevel: this.headingLevel,
    });
  }

  onClose(): void {
    const { contentEl } = this;
    contentEl.empty();
  }
}

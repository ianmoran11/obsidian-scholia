import { Notice } from "obsidian";
import type { Hotkey } from "obsidian";
import type {
  ContextScope,
  OutputDestination,
  AppendFormat,
  TemplateConfig,
  RawTemplateFrontmatter,
} from "./types";

const VALID_CONTEXT_SCOPES: ContextScope[] = [
  "selection",
  "heading",
  "full-note",
];

const VALID_MODIFIERS = new Set(["Mod", "Ctrl", "Alt", "Shift", "Meta"]);

const CALLOUT_TYPE_REGEX = /^[a-z][a-z0-9-]*$/;
const TOOLBAR_ICON_REGEX = /^[a-z0-9-]+$/;

export interface ParseResult {
  config: TemplateConfig;
  warnings: string[];
  isValid: boolean;
}

export function parseFrontmatter(
  raw: RawTemplateFrontmatter,
  systemPrompt: string,
  filePath: string,
  defaultCalloutType: string,
): ParseResult {
  const warnings: string[] = [];
  const config: Partial<TemplateConfig> = { systemPrompt };

  const contextScope = raw.context_scope;
  if (
    typeof contextScope === "string" &&
    VALID_CONTEXT_SCOPES.includes(contextScope as ContextScope)
  ) {
    config.contextScope = contextScope as ContextScope;
  } else {
    new Notice(
      `Scholia template invalid: ${filePath} — context_scope must be selection|heading|full-note`,
    );
    return {
      config: {
        ...config,
        contextScope: "selection",
        outputDestination: "inline",
        systemPrompt,
      } as TemplateConfig,
      warnings,
      isValid: false,
    };
  }

  const outputDestination = raw.output_destination;
  if (
    outputDestination === "inline" ||
    (typeof outputDestination === "string" &&
      outputDestination.endsWith(".md") &&
      !outputDestination.startsWith("/"))
  ) {
    config.outputDestination = outputDestination as OutputDestination;
  } else {
    new Notice(
      `Scholia template invalid: ${filePath} — output_destination must be inline or a relative .md path`,
    );
    return {
      config: {
        ...config,
        contextScope: config.contextScope!,
        outputDestination: "inline",
        systemPrompt,
      } as TemplateConfig,
      warnings,
      isValid: false,
    };
  }

  if (typeof raw.model === "string" && raw.model.length > 0) {
    config.model = raw.model;
  }

  if (typeof raw.toolbar_icon === "string") {
    const toolbarIcon = raw.toolbar_icon.trim();
    if (toolbarIcon.length > 0 && TOOLBAR_ICON_REGEX.test(toolbarIcon)) {
      config.toolbarIcon = toolbarIcon;
    } else if (toolbarIcon.length > 0) {
      warnings.push(
        `Ignored invalid toolbar_icon: ${toolbarIcon}. Use a lowercase Obsidian icon id like lightbulb or message-square.`,
      );
    }
  }

  if (
    typeof raw.temperature === "number" ||
    typeof raw.temperature === "string"
  ) {
    const temp =
      typeof raw.temperature === "string"
        ? parseFloat(raw.temperature)
        : raw.temperature;
    if (!isNaN(temp)) {
      config.temperature = Math.min(2, Math.max(0, temp));
    }
  }

  if (
    typeof raw.max_tokens === "number" ||
    typeof raw.max_tokens === "string"
  ) {
    const tokens =
      typeof raw.max_tokens === "string"
        ? parseInt(raw.max_tokens)
        : raw.max_tokens;
    if (!isNaN(tokens)) {
      config.maxTokens = Math.min(8192, Math.max(128, tokens));
    }
  }

  const calloutType = raw.callout_type;
  if (typeof calloutType === "string") {
    if (CALLOUT_TYPE_REGEX.test(calloutType)) {
      config.calloutType = calloutType;
    } else {
      config.calloutType = defaultCalloutType;
    }
  } else {
    config.calloutType = defaultCalloutType;
  }

  if (typeof raw.callout_label === "string") {
    config.calloutLabel = raw.callout_label;
  }

  if (typeof raw.callout_folded === "boolean") {
    config.calloutFolded = raw.callout_folded;
  } else {
    config.calloutFolded = true;
  }

  if (typeof raw.requires_selection === "boolean") {
    config.requiresSelection = raw.requires_selection;
  } else {
    config.requiresSelection = true;
  }

  if (typeof raw.command_prefix === "string") {
    config.commandPrefix = raw.command_prefix;
  } else {
    config.commandPrefix = "Run";
  }

  if (Array.isArray(raw.hotkey)) {
    const validHotkeys: { modifiers: string[]; key: string }[] = [];
    for (const hk of raw.hotkey) {
      if (
        hk &&
        typeof hk === "object" &&
        Array.isArray(hk.modifiers) &&
        typeof hk.key === "string"
      ) {
        const validMods = hk.modifiers.filter((m: unknown) =>
          VALID_MODIFIERS.has(m as string),
        );
        const invalidMods = hk.modifiers.filter(
          (m: unknown) => !VALID_MODIFIERS.has(m as string),
        );
        if (invalidMods.length > 0) {
          warnings.push(
            `Dropped invalid hotkey modifiers: ${invalidMods.join(", ")}`,
          );
        }
        if (validMods.length > 0) {
          validHotkeys.push({ modifiers: validMods, key: hk.key });
        }
      }
    }
    if (validHotkeys.length > 0) {
      config.hotkey = validHotkeys as unknown as Hotkey[];
    } else {
      config.hotkey = [];
    }
  } else {
    config.hotkey = [];
  }

  if (typeof raw.custom_probe === "boolean") {
    config.customProbe = raw.custom_probe;
  }

  if (typeof raw.also_append_to === "string") {
    config.alsoAppendTo = raw.also_append_to;
  }

  if (raw.append_format === "markdown" || raw.append_format === "json-line") {
    config.appendFormat = raw.append_format as AppendFormat;
  } else {
    config.appendFormat = "markdown";
  }

  return { config: config as TemplateConfig, warnings, isValid: true };
}

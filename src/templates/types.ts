import type { Hotkey } from "obsidian";

export type ContextScope = "selection" | "heading" | "full-note";
export type OutputDestination = "inline" | string;
export type AppendFormat = "markdown" | "json-line";

export interface TemplateConfig {
  contextScope: ContextScope;
  outputDestination: OutputDestination;
  model?: string;
  temperature?: number;
  maxTokens?: number;
  toolbarIcon?: string;
  calloutType?: string;
  calloutLabel?: string;
  calloutFolded?: boolean;
  requiresSelection?: boolean;
  commandPrefix?: string;
  hotkey?: Hotkey[];
  customProbe?: boolean;
  alsoAppendTo?: string;
  appendFormat?: AppendFormat;
  systemPrompt: string;
}

export interface RawTemplateFrontmatter {
  context_scope?: unknown;
  output_destination?: unknown;
  model?: unknown;
  temperature?: unknown;
  max_tokens?: unknown;
  toolbar_icon?: unknown;
  callout_type?: unknown;
  callout_label?: unknown;
  callout_folded?: unknown;
  requires_selection?: unknown;
  command_prefix?: unknown;
  hotkey?: unknown;
  custom_probe?: unknown;
  also_append_to?: unknown;
  append_format?: unknown;
}

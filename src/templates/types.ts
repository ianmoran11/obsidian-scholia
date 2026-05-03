import type { Hotkey } from "obsidian";

export type ContextScope = "selection" | "heading" | "full-note";
export type OutputDestination = "inline" | string;
export type AppendFormat = "markdown" | "json-line";
export type ReasoningEffort =
  | "none"
  | "minimal"
  | "low"
  | "medium"
  | "high"
  | "xhigh";
export type SpacedRepetitionFormat = "basic" | "multiline" | "cloze";

export interface TemplateConfig {
  contextScope: ContextScope;
  outputDestination: OutputDestination;
  model?: string;
  temperature?: number;
  maxTokens?: number;
  reasoningEnabled?: boolean;
  reasoningEffort?: ReasoningEffort;
  calloutType?: string;
  calloutLabel?: string;
  calloutFolded?: boolean;
  requiresSelection?: boolean;
  commandPrefix?: string;
  hotkey?: Hotkey[];
  customProbe?: boolean;
  alsoAppendTo?: string;
  appendFormat?: AppendFormat;
  spacedRepetition?: boolean;
  srFormat?: SpacedRepetitionFormat;
  srDeck?: string;
  srTags?: string[];
  systemPrompt: string;
}

export interface RawTemplateFrontmatter {
  context_scope?: unknown;
  output_destination?: unknown;
  model?: unknown;
  temperature?: unknown;
  max_tokens?: unknown;
  token_budget?: unknown;
  reasoning?: unknown;
  reasoning_effort?: unknown;
  callout_type?: unknown;
  callout_label?: unknown;
  callout_folded?: unknown;
  requires_selection?: unknown;
  command_prefix?: unknown;
  hotkey?: unknown;
  custom_probe?: unknown;
  also_append_to?: unknown;
  append_format?: unknown;
  spaced_repetition?: unknown;
  sr_format?: unknown;
  sr_deck?: unknown;
  sr_tags?: unknown;
}

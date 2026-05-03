import type { SpacedRepetitionFormat } from "../templates/types";

export interface SrFormatOptions {
  format: SpacedRepetitionFormat;
  deck?: string;
  tags?: string[];
}

export interface ParsedFlashcard {
  question: string;
  answer: string;
}

const DEFAULT_DECK = "#flashcards";

function cleanInline(text: string): string {
  return text
    .replace(/\s+/g, " ")
    .replace(/\s*::+\s*/g, " ")
    .trim();
}

function cleanBlock(text: string): string {
  return text
    .split("\n")
    .map((line) => line.trim())
    .join("\n")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

export function normalizeSrTag(value: string): string {
  const trimmed = value.trim();
  if (!trimmed) return "";
  return trimmed.startsWith("#") ? trimmed : `#${trimmed}`;
}

export function buildDeckLine(options: Pick<SrFormatOptions, "deck" | "tags">): string {
  const parts = [
    normalizeSrTag(options.deck ?? DEFAULT_DECK),
    ...(options.tags ?? []).map(normalizeSrTag),
  ].filter(Boolean);
  return Array.from(new Set(parts)).join(" ");
}

export function parseGeneratedFlashcard(content: string): ParsedFlashcard | null {
  const trimmed = content.trim();
  const singleLine = trimmed.match(/^(.+?)::([^:][\s\S]*)$/);
  if (singleLine) {
    return {
      question: cleanBlock(singleLine[1]),
      answer: cleanBlock(singleLine[2]),
    };
  }

  const qIndex = trimmed.search(/^Q(?:uestion)?\s*:/im);
  const aIndex = trimmed.search(/^A(?:nswer)?\s*:/im);
  if (qIndex !== -1 && aIndex !== -1 && aIndex > qIndex) {
    const questionBlock = trimmed
      .slice(qIndex, aIndex)
      .replace(/^Q(?:uestion)?\s*:/i, "");
    const answerBlock = trimmed
      .slice(aIndex)
      .replace(/^A(?:nswer)?\s*:/i, "");
    const question = cleanBlock(questionBlock);
    const answer = cleanBlock(answerBlock);
    if (question && answer) return { question, answer };
  }

  return null;
}

export function formatBasicCard(
  question: string,
  answer: string,
  options: Pick<SrFormatOptions, "deck" | "tags"> = {},
): string {
  return `${buildDeckLine(options)}\n${cleanInline(question)}::${cleanInline(answer)}`;
}

export function formatMultilineCard(
  question: string,
  answer: string,
  options: Pick<SrFormatOptions, "deck" | "tags"> = {},
): string {
  return `${buildDeckLine(options)}\n${cleanBlock(question)}\n?\n${cleanBlock(answer)}`;
}

export function formatClozeCard(content: string, options: Pick<SrFormatOptions, "deck" | "tags"> = {}): string {
  return `${buildDeckLine(options)}\n${cleanBlock(content)}`;
}

export function formatGeneratedForSpacedRepetition(
  content: string,
  options: SrFormatOptions,
): string {
  if (options.format === "cloze") {
    return formatClozeCard(content, options);
  }

  const parsed = parseGeneratedFlashcard(content);
  if (!parsed) return content.trim();

  if (options.format === "multiline") {
    return formatMultilineCard(parsed.question, parsed.answer, options);
  }

  return formatBasicCard(parsed.question, parsed.answer, options);
}

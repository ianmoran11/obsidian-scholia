import type { ParsedScholiaCallout } from "../stream/calloutParser";

export const MAX_TTS_CHARACTERS = 12000;

function stripMarkdownNoise(text: string): string {
  return text
    .replace(/^---\n[\s\S]*?\n---\n?/, "")
    .replace(/<!--[\s\S]*?-->/g, "")
    .replace(/!\[\[[^\]]+\]\]/g, "")
    .replace(/!\[[^\]]*]\([^)]*\)/g, "")
    .replace(/^\s*#{1,6}\s+/gm, "")
    .replace(/^\s*>\s?/gm, "")
    .replace(/\*\*Metadata:\*\*.*$/gm, "")
    .replace(/\*\*(Context|Question|Follow-up|Response|Audio):\*\*/g, "$1:")
    .replace(/[*_`~]/g, "")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

export function extractTtsTextFromCallout(
  parsed: ParsedScholiaCallout,
): string {
  const responseLines: string[] = [];
  let collecting = false;

  for (const line of parsed.body.split("\n")) {
    const trimmed = line.trim();
    if (trimmed.startsWith("**Response:**")) {
      collecting = true;
      continue;
    }
    if (trimmed.startsWith("**Metadata:**") || trimmed.startsWith("**Audio:**")) {
      collecting = false;
      continue;
    }
    if (trimmed.startsWith("**Follow-up:**")) {
      responseLines.push(line);
      collecting = false;
      continue;
    }
    if (collecting) {
      responseLines.push(line);
    }
  }

  return stripMarkdownNoise(responseLines.join("\n"));
}

export function extractTtsTextFromNote(note: string): string {
  return stripMarkdownNoise(note);
}

export function assertTtsTextWithinLimit(text: string): void {
  if (!text.trim()) {
    throw new Error("No readable text found for audio generation.");
  }

  if (text.length > MAX_TTS_CHARACTERS) {
    throw new Error(
      `Audio text is too long (${text.length} characters). Limit is ${MAX_TTS_CHARACTERS}.`,
    );
  }
}

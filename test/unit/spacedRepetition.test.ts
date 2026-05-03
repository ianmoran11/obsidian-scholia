import { describe, expect, it } from "vitest";
import {
  buildDeckLine,
  formatGeneratedForSpacedRepetition,
  parseGeneratedFlashcard,
} from "../../src/spacedRepetition/format";

describe("spacedRepetition.format", () => {
  it("parses generated Q/A flashcards", () => {
    expect(parseGeneratedFlashcard("Q: What is Scholia?\nA: A study helper.")).toEqual({
      question: "What is Scholia?",
      answer: "A study helper.",
    });
  });

  it("formats basic cards with an SR deck tag", () => {
    expect(
      formatGeneratedForSpacedRepetition("Q: What is photosynthesis?\nA: Plants making sugar.", {
        format: "basic",
        deck: "#flashcards/biology",
      }),
    ).toBe("#flashcards/biology\nWhat is photosynthesis?::Plants making sugar.");
  });

  it("formats multiline cards using the documented separator", () => {
    expect(
      formatGeneratedForSpacedRepetition("Q: Name two uses\nof mitochondria.\nA: ATP production\nsignaling.", {
        format: "multiline",
        deck: "flashcards/cell-biology",
        tags: ["#exam"],
      }),
    ).toBe(
      "#flashcards/cell-biology #exam\nName two uses\nof mitochondria.\n?\nATP production\nsignaling.",
    );
  });

  it("keeps cloze text and prefixes deck tags", () => {
    expect(
      formatGeneratedForSpacedRepetition("The capital of France is ==Paris==.", {
        format: "cloze",
        deck: "#flashcards/geography",
      }),
    ).toBe("#flashcards/geography\nThe capital of France is ==Paris==.");
  });

  it("deduplicates deck and extra tags", () => {
    expect(buildDeckLine({ deck: "flashcards", tags: ["#flashcards", "exam"] })).toBe(
      "#flashcards #exam",
    );
  });
});

import { describe, it, expect } from "vitest";
import { parseFrontmatter } from "../../src/templates/frontmatter";
import type { RawTemplateFrontmatter } from "../../src/templates/types";

describe("frontmatter.parseFrontmatter", () => {
  const minimalFrontmatter: RawTemplateFrontmatter = {
    context_scope: "selection",
    output_destination: "inline",
  };

  it("parses valid minimal frontmatter", () => {
    const result = parseFrontmatter(
      minimalFrontmatter,
      "You are a tutor.",
      "test.md",
      "ai",
    );
    expect(result.config.contextScope).toBe("selection");
    expect(result.config.outputDestination).toBe("inline");
    expect(result.config.systemPrompt).toBe("You are a tutor.");
    expect(result.warnings).toHaveLength(0);
  });

  it("returns error Notice for invalid context_scope", () => {
    const frontmatter: RawTemplateFrontmatter = {
      context_scope: "invalid",
      output_destination: "inline",
    };
    const result = parseFrontmatter(frontmatter, "Prompt", "test.md", "ai");
    expect(result.config.contextScope).toBe("selection");
    expect(result.config.outputDestination).toBe("inline");
  });

  it("returns error Notice for invalid output_destination", () => {
    const frontmatter: RawTemplateFrontmatter = {
      context_scope: "selection",
      output_destination: "/absolute/path.md",
    };
    const result = parseFrontmatter(frontmatter, "Prompt", "test.md", "ai");
    expect(result.config.outputDestination).toBe("inline");
  });

  it("accepts relative .md path as output_destination", () => {
    const frontmatter: RawTemplateFrontmatter = {
      context_scope: "selection",
      output_destination: "_System/Captures.md",
    };
    const result = parseFrontmatter(frontmatter, "Prompt", "test.md", "ai");
    expect(result.config.outputDestination).toBe("_System/Captures.md");
  });

  it("clamps temperature to 0-2 range", () => {
    const highTemp: RawTemplateFrontmatter = {
      context_scope: "selection",
      output_destination: "inline",
      temperature: 5,
    };
    const result1 = parseFrontmatter(highTemp, "Prompt", "test.md", "ai");
    expect(result1.config.temperature).toBe(2);

    const lowTemp: RawTemplateFrontmatter = {
      context_scope: "selection",
      output_destination: "inline",
      temperature: -1,
    };
    const result2 = parseFrontmatter(lowTemp, "Prompt", "test.md", "ai");
    expect(result2.config.temperature).toBe(0);
  });

  it("clamps token budget to 128-65536 range", () => {
    const highTokens: RawTemplateFrontmatter = {
      context_scope: "selection",
      output_destination: "inline",
      token_budget: 100000,
    };
    const result1 = parseFrontmatter(highTokens, "Prompt", "test.md", "ai");
    expect(result1.config.maxTokens).toBe(65536);

    const lowTokens: RawTemplateFrontmatter = {
      context_scope: "selection",
      output_destination: "inline",
      max_tokens: 50,
    };
    const result2 = parseFrontmatter(lowTokens, "Prompt", "test.md", "ai");
    expect(result2.config.maxTokens).toBe(128);
  });

  it("accepts temperature as string", () => {
    const frontmatter: RawTemplateFrontmatter = {
      context_scope: "selection",
      output_destination: "inline",
      temperature: "0.8",
    };
    const result = parseFrontmatter(frontmatter, "Prompt", "test.md", "ai");
    expect(result.config.temperature).toBe(0.8);
  });

  it("accepts max_tokens as string", () => {
    const frontmatter: RawTemplateFrontmatter = {
      context_scope: "selection",
      output_destination: "inline",
      max_tokens: "2048",
    };
    const result = parseFrontmatter(frontmatter, "Prompt", "test.md", "ai");
    expect(result.config.maxTokens).toBe(2048);
  });

  it("accepts token_budget as string", () => {
    const frontmatter: RawTemplateFrontmatter = {
      context_scope: "selection",
      output_destination: "inline",
      token_budget: "30000",
    };
    const result = parseFrontmatter(frontmatter, "Prompt", "test.md", "ai");
    expect(result.config.maxTokens).toBe(30000);
  });

  it("parses reasoning options", () => {
    const frontmatter: RawTemplateFrontmatter = {
      context_scope: "selection",
      output_destination: "inline",
      reasoning: true,
      reasoning_effort: "high",
    };
    const result = parseFrontmatter(frontmatter, "Prompt", "test.md", "ai");
    expect(result.config.reasoningEnabled).toBe(true);
    expect(result.config.reasoningEffort).toBe("high");
  });

  it("validates callout_type with valid pattern", () => {
    const frontmatter: RawTemplateFrontmatter = {
      context_scope: "selection",
      output_destination: "inline",
      callout_type: "scholia-clarify",
    };
    const result = parseFrontmatter(frontmatter, "Prompt", "test.md", "ai");
    expect(result.config.calloutType).toBe("scholia-clarify");
  });

  it("falls back to defaultCalloutType for invalid callout_type", () => {
    const frontmatter: RawTemplateFrontmatter = {
      context_scope: "selection",
      output_destination: "inline",
      callout_type: "Invalid_CamelCase",
    };
    const result = parseFrontmatter(
      frontmatter,
      "Prompt",
      "test.md",
      "scholia-example",
    );
    expect(result.config.calloutType).toBe("scholia-example");
  });

  it("defaults callout_folded to true", () => {
    const frontmatter: RawTemplateFrontmatter = {
      context_scope: "selection",
      output_destination: "inline",
    };
    const result = parseFrontmatter(frontmatter, "Prompt", "test.md", "ai");
    expect(result.config.calloutFolded).toBe(true);
  });

  it("parses callout_folded when explicitly set", () => {
    const frontmatter: RawTemplateFrontmatter = {
      context_scope: "selection",
      output_destination: "inline",
      callout_folded: false,
    };
    const result = parseFrontmatter(frontmatter, "Prompt", "test.md", "ai");
    expect(result.config.calloutFolded).toBe(false);
  });

  it("defaults requiresSelection to true", () => {
    const frontmatter: RawTemplateFrontmatter = {
      context_scope: "selection",
      output_destination: "inline",
    };
    const result = parseFrontmatter(frontmatter, "Prompt", "test.md", "ai");
    expect(result.config.requiresSelection).toBe(true);
  });

  it("parses requiresSelection when explicitly set", () => {
    const frontmatter: RawTemplateFrontmatter = {
      context_scope: "selection",
      output_destination: "inline",
      requires_selection: false,
    };
    const result = parseFrontmatter(frontmatter, "Prompt", "test.md", "ai");
    expect(result.config.requiresSelection).toBe(false);
  });

  it("defaults commandPrefix to Run", () => {
    const frontmatter: RawTemplateFrontmatter = {
      context_scope: "selection",
      output_destination: "inline",
    };
    const result = parseFrontmatter(frontmatter, "Prompt", "test.md", "ai");
    expect(result.config.commandPrefix).toBe("Run");
  });

  it("normalises hotkey modifiers", () => {
    const frontmatter: RawTemplateFrontmatter = {
      context_scope: "selection",
      output_destination: "inline",
      hotkey: [
        { modifiers: ["Mod", "Shift", "InvalidMod"], key: "C" },
        { modifiers: ["Mod", "Ctrl"], key: "K" },
      ],
    };
    const result = parseFrontmatter(frontmatter, "Prompt", "test.md", "ai");
    expect(result.config.hotkey).toHaveLength(2);
    expect(result.config.hotkey![0].modifiers).toEqual(["Mod", "Shift"]);
    expect(result.warnings[0]).toContain("InvalidMod");
  });

  it("filters out hotkeys with no valid modifiers", () => {
    const frontmatter: RawTemplateFrontmatter = {
      context_scope: "selection",
      output_destination: "inline",
      hotkey: [{ modifiers: ["InvalidMod"], key: "C" }],
    };
    const result = parseFrontmatter(frontmatter, "Prompt", "test.md", "ai");
    expect(result.config.hotkey).toHaveLength(0);
  });

  it("parses custom_probe boolean", () => {
    const frontmatter: RawTemplateFrontmatter = {
      context_scope: "selection",
      output_destination: "inline",
      custom_probe: true,
    };
    const result = parseFrontmatter(frontmatter, "Prompt", "test.md", "ai");
    expect(result.config.customProbe).toBe(true);
  });

  it("parses also_append_to", () => {
    const frontmatter: RawTemplateFrontmatter = {
      context_scope: "selection",
      output_destination: "inline",
      also_append_to: "_System/Captures.md",
    };
    const result = parseFrontmatter(frontmatter, "Prompt", "test.md", "ai");
    expect(result.config.alsoAppendTo).toBe("_System/Captures.md");
  });

  it("defaults appendFormat to markdown", () => {
    const frontmatter: RawTemplateFrontmatter = {
      context_scope: "selection",
      output_destination: "inline",
    };
    const result = parseFrontmatter(frontmatter, "Prompt", "test.md", "ai");
    expect(result.config.appendFormat).toBe("markdown");
  });

  it("parses append_format json-line", () => {
    const frontmatter: RawTemplateFrontmatter = {
      context_scope: "selection",
      output_destination: "inline",
      append_format: "json-line",
    };
    const result = parseFrontmatter(frontmatter, "Prompt", "test.md", "ai");
    expect(result.config.appendFormat).toBe("json-line");
  });

  it("parses spaced repetition options", () => {
    const frontmatter: RawTemplateFrontmatter = {
      context_scope: "selection",
      output_destination: "inline",
      spaced_repetition: true,
      sr_format: "multiline",
      sr_deck: "#flashcards/scholia",
      sr_tags: ["#exam", "ai-generated"],
    };
    const result = parseFrontmatter(frontmatter, "Prompt", "test.md", "ai");
    expect(result.config.spacedRepetition).toBe(true);
    expect(result.config.srFormat).toBe("multiline");
    expect(result.config.srDeck).toBe("#flashcards/scholia");
    expect(result.config.srTags).toEqual(["#exam", "ai-generated"]);
  });

  it("enables spaced repetition for legacy scholia flashcard templates", () => {
    const frontmatter: RawTemplateFrontmatter = {
      context_scope: "selection",
      output_destination: "inline",
      callout_type: "scholia-flashcard",
    };
    const result = parseFrontmatter(
      frontmatter,
      "Prompt",
      "Edu-Templates/Flashcard.md",
      "ai",
    );
    expect(result.config.spacedRepetition).toBe(true);
    expect(result.config.srFormat).toBe("basic");
  });

  it("allows flashcard templates to opt out of spaced repetition", () => {
    const frontmatter: RawTemplateFrontmatter = {
      context_scope: "selection",
      output_destination: "inline",
      callout_type: "scholia-flashcard",
      spaced_repetition: false,
    };
    const result = parseFrontmatter(
      frontmatter,
      "Prompt",
      "Edu-Templates/Flashcard.md",
      "ai",
    );
    expect(result.config.spacedRepetition).toBe(false);
  });

  it("parses generate_audio boolean", () => {
    const frontmatter: RawTemplateFrontmatter = {
      context_scope: "heading",
      output_destination: "inline",
      generate_audio: true,
    };
    const result = parseFrontmatter(frontmatter, "Prompt", "test.md", "ai");
    expect(result.config.generateAudio).toBe(true);
  });

  it("defaults invalid spaced repetition format to basic", () => {
    const frontmatter: RawTemplateFrontmatter = {
      context_scope: "selection",
      output_destination: "inline",
      sr_format: "invalid",
    };
    const result = parseFrontmatter(frontmatter, "Prompt", "test.md", "ai");
    expect(result.config.srFormat).toBe("basic");
  });

  it("accepts all valid context_scope values", () => {
    const scopes: RawTemplateFrontmatter["context_scope"][] = [
      "selection",
      "heading",
      "full-note",
    ];
    for (const scope of scopes) {
      const frontmatter: RawTemplateFrontmatter = {
        context_scope: scope,
        output_destination: "inline",
      };
      const result = parseFrontmatter(frontmatter, "Prompt", "test.md", "ai");
      expect(result.config.contextScope).toBe(scope);
    }
  });

  it("ignores unknown keys (forward-compatibility)", () => {
    const frontmatter: RawTemplateFrontmatter = {
      context_scope: "selection",
      output_destination: "inline",
      unknown_field: "some value",
      another_unknown: 123,
    } as RawTemplateFrontmatter;
    const result = parseFrontmatter(frontmatter, "Prompt", "test.md", "ai");
    expect(result.config.contextScope).toBe("selection");
    expect(result.warnings).toHaveLength(0);
  });
});

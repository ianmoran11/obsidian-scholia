import { describe, it, expect } from "vitest";
import {
  buildSkeleton,
  appendToCallout,
  formatError,
} from "../../src/stream/callout.ts";
import { Editor } from "../mocks/obsidian";

describe("buildSkeleton", () => {
  it("creates folded callout with correct structure", () => {
    const skeleton = buildSkeleton({
      calloutType: "scholia-clarify",
      calloutLabel: "AI Clarification",
      folded: true,
      commandName: "Clarify",
      selectionText: "Hello world",
    });

    expect(skeleton).toContain("[!scholia-clarify]-");
    expect(skeleton).toContain("**Context:**");
    expect(skeleton).toContain("**Response:**");
    expect(skeleton).toContain("Hello world");
  });

  it("creates expanded callout when folded is false", () => {
    const skeleton = buildSkeleton({
      calloutType: "ai",
      calloutLabel: "AI Response",
      folded: false,
      commandName: "Probe",
      selectionText: "Test",
    });

    expect(skeleton).toContain("[!ai]+");
    expect(skeleton).not.toContain("[!ai]-");
  });

  it("escapes newlines in selection with > prefix", () => {
    const skeleton = buildSkeleton({
      calloutType: "scholia-example",
      calloutLabel: "Example",
      folded: true,
      commandName: "Example",
      selectionText: "Line one\nLine two\nLine three",
    });

    expect(skeleton).toContain("**Context:** *Line one");
    expect(skeleton).toContain("> Line two");
    expect(skeleton).toContain("> Line three*");
  });

  it("handles empty selection", () => {
    const skeleton = buildSkeleton({
      calloutType: "ai",
      calloutLabel: "AI",
      folded: true,
      commandName: "Run",
      selectionText: "",
    });

    expect(skeleton).toContain("[!ai]-");
    expect(skeleton).toContain("**Context:**");
  });

  it("includes command name in label", () => {
    const skeleton = buildSkeleton({
      calloutType: "scholia-flashcard",
      calloutLabel: "Flashcard",
      folded: true,
      commandName: "Flashcard",
      selectionText: "What is 2+2?",
    });

    expect(skeleton).toContain("Flashcard: Flashcard");
  });
});

describe("appendToCallout", () => {
  it("appends text with > prefix on newlines", () => {
    const editor = new Editor();
    editor.setValue("Hello world");

    const newOffset = appendToCallout(editor, 11, "Answer: yes\nIt is true");

    expect(editor.getValue()).toContain("Answer: yes\n> It is true");
  });

  it("returns updated offset after append", () => {
    const editor = new Editor();
    editor.setValue("Hello world");

    const text = "Answer";
    const newOffset = appendToCallout(editor, 11, text);

    expect(newOffset).toBe(11 + text.length);
  });

  it("handles text without newlines", () => {
    const editor = new Editor();
    editor.setValue("Hello world");

    appendToCallout(editor, 11, "Simple answer");

    expect(editor.getValue()).toContain("Simple answer");
  });

  it("handles multiple newlines", () => {
    const editor = new Editor();
    editor.setValue("Start");

    appendToCallout(editor, 5, "A\nB\nC");

    expect(editor.getValue()).toContain("A\n> B\n> C");
  });
});

describe("formatError", () => {
  it("formats error message with callout syntax", () => {
    const error = formatError("API key missing");
    expect(error).toContain("**Error:**");
    expect(error).toContain("API key missing");
    expect(error).toContain("> ");
  });

  it("preserves full error message", () => {
    const error = formatError("Network timeout after 30000ms");
    expect(error).toBe("> \n> **Error:** Network timeout after 30000ms");
  });
});

import { describe, expect, it } from "vitest";
import { Editor } from "../mocks/obsidian";
import { saveAudioToVault } from "../../src/audio/storage";
import {
  extractTtsTextFromCallout,
  extractTtsTextFromNote,
} from "../../src/audio/text";
import { buildSkeleton } from "../../src/stream/callout";
import { findScholiaCalloutAt } from "../../src/stream/calloutParser";
import { TemplateRegistry } from "../../src/templates/registry";

describe("audio text extraction", () => {
  it("strips comments, metadata, and audio embeds from note text", () => {
    const text = extractTtsTextFromNote(
      [
        "---",
        "title: Test",
        "---",
        "# Heading",
        "<!-- hidden -->",
        "Visible **text**.",
        "![[old.mp3]]",
        "**Metadata:** model=test",
      ].join("\n"),
    );

    expect(text).toBe("Heading\n\nVisible text.");
  });

  it("uses only response and follow-up content for callout audio", () => {
    const skeleton = buildSkeleton({
      calloutType: "ai",
      calloutLabel: "Scholia Note",
      folded: true,
      commandName: "Scholia Note",
      selectionText: "Do not read context",
      questionText: "Do not read question?",
    });
    const editor = new Editor();
    editor.setValue(
      `${skeleton}Main answer\n> \n> **Metadata:** tokens=1\n> ---\n> **Follow-up:** Why?\n> \n> **Response:**\n> Follow-up answer`,
    );
    const parsed = findScholiaCalloutAt(editor, { line: 5, ch: 4 });

    const text = extractTtsTextFromCallout(parsed!);

    expect(text).toContain("Main answer");
    expect(text).toContain("Follow-up answer");
    expect(text).not.toContain("Do not read context");
    expect(text).not.toContain("Do not read question");
    expect(text).not.toContain("tokens=1");
  });
});

describe("audio storage", () => {
  it("creates folders and writes binary audio", async () => {
    const folders = new Set<string>();
    const writes = new Map<string, ArrayBuffer>();
    const vault = {
      getFolderByPath: (path: string) => (folders.has(path) ? { path } : null),
      createFolder: async (path: string) => {
        folders.add(path);
      },
      getFileByPath: () => null,
      createBinary: async (path: string, data: ArrayBuffer) => {
        writes.set(path, data);
      },
    };

    const saved = await saveAudioToVault(vault as any, {
      audioOutputFolder: "_System/Scholia Audio",
      sourceFile: { path: "Reading/My Note.md", stat: { mtime: 1 } } as any,
      calloutId: "scholia-test",
      audio: new Uint8Array([1]).buffer,
      now: new Date("2026-05-03T05:06:07"),
    });

    expect(folders.has("_System")).toBe(true);
    expect(folders.has("_System/Scholia Audio")).toBe(true);
    expect(folders.has("_System/Scholia Audio/My Note")).toBe(true);
    expect(saved.path).toBe(
      "_System/Scholia Audio/My Note/scholia-test-20260503-050607.mp3",
    );
    expect(writes.has(saved.path)).toBe(true);
  });
});

describe("audio embed insertion", () => {
  it("inserts a blockquoted audio embed in a callout", () => {
    const registry = new TemplateRegistry({} as any, {} as any, {} as any);
    const editor = new Editor();
    editor.setValue("> [!ai]- Note\n> **Response:**\n> Answer");
    const parsed = findScholiaCalloutAt(editor, { line: 2, ch: 2 });

    (registry as any).insertOrUpdateCalloutAudio(
      editor,
      parsed,
      "_System/Scholia Audio/Note/audio.mp3",
    );

    expect(editor.getValue()).toContain(
      "> **Audio:** ![[_System/Scholia Audio/Note/audio.mp3]]",
    );
  });

  it("inserts a note-level audio section outside blockquotes", () => {
    const registry = new TemplateRegistry({} as any, {} as any, {} as any);
    const editor = new Editor();
    editor.setValue("# Note\n\nBody");

    (registry as any).insertOrUpdateNoteAudio(
      editor,
      "_System/Scholia Audio/Note/audio.mp3",
    );

    expect(editor.getValue()).toContain(
      "## Scholia Audio\n\n![[_System/Scholia Audio/Note/audio.mp3]]",
    );
    expect(editor.getValue()).not.toContain("> **Audio:**");
  });
});

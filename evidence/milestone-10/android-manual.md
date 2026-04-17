# Scholia — Android Foldable Manual Verification Checklist

**Device:** Android foldable (large screen)  
**Platform:** Obsidian for Android  
**Date:** ******\_\_\_******  
**Tester:** ******\_\_\_******

---

## Pre-flight

1. Install Scholia from community plugins (or sideload `main.js` + `manifest.json` + `styles.css`)
2. Open Obsidian → Settings → Scholia
3. Configure:
   - [ ] OpenRouter API Key set
   - [ ] Default Model: `z-ai/glm-5.1`
   - [ ] Templates Folder: `Edu-Templates`
4. Verify `test-vault/Edu-Templates/` is synced to device (Clarify.md, Real-World Example.md, Flashcard.md, Probe (Custom).md)

---

## F1 — Hotkey Probing (Inline Clarification)

1. Open `test-vault/Reading/Sample Chapter.md`
2. Select a sentence of text
3. Run **Run: Clarify** from the mobile toolbar (or command palette)
4. Observe:
   - [ ] Skeleton callout appears within ~100ms (collapsed, folded `[-]`)
   - [ ] First chunk arrives before completion
   - [ ] Original text unchanged
   - [ ] No popups or focus changes

---

## F2 — Custom Probing (Modal)

1. With cursor inside a section heading
2. Run **Run: Probe (Custom)**
3. Observe:
   - [ ] Modal appears centered with autofocus on textarea
   - [ ] Type a question (e.g. "What does this concept mean in practice?")
   - [ ] Press Ctrl+Enter / Cmd+Enter to submit
   - [ ] Modal closes, streaming callout appears
4. Try error path:
   - [ ] Open modal, press Escape → modal closes without action
   - [ ] Submit with empty textarea → inline error shown, no submission

---

## F3 — Capture (Dual-write)

1. Open `test-vault/Reading/Sample Chapter.md`
2. Select text
3. Run **Run: Flashcard**
4. Wait for stream to complete
5. Check:
   - [ ] Inline callout present in note
   - [ ] `_System/Central-Flashcards.md` has new entry with `<!-- scholia:captured:... -->` comment
   - [ ] Notice shown exactly once

---

## Visual / UX

- [ ] Light theme: callout colors readable, icons visible
- [ ] Dark theme: callout colors readable, icons visible
- [ ] Folded callout expands on tap/click
- [ ] Refolded callout preserves streamed content

---

## Concurrent Streams

1. Run Clarify on Section A
2. Before it completes, run Real-World Example on Section B
3. Verify:
   - [ ] Both streams render independently
   - [ ] Editing in one note does not abort the other

---

## Error Path

1. Disconnect network (airplane mode)
2. Select text and run Clarify
3. Verify:
   - [ ] Error callout appears with `**Error:** <message>`
   - [ ] Notice shown: "Scholia: <message>"
   - [ ] No content appended to `_System/Central-Flashcards.md`

---

## Notes

_Record any issues, observations, or deviations from expected behaviour:_

---

---

_Last updated: 2026-04-18_

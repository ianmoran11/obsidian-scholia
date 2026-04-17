# Project: Scholia — Obsidian Plugin PRD

> **Read this file in full at the start of every ralph iteration.**
> Log progress in `progress.txt`. Tick completed tasks by changing `- [ ]` to `- [x]`.
> Auto-commit at each milestone close per §17.

---

## 1. Overview

Scholia is an Obsidian community plugin that turns passive reading of educational markdown into an active, local-first, AI-assisted learning environment. It lets users annotate, clarify, and extract knowledge from notes without breaking reading flow — primarily through the Mobile Toolbar, with all output streamed back into the document as native Obsidian callouts.

Target platform: **Obsidian Desktop (macOS) with mobile emulation enabled**, with correctness expected on **Android foldable (large screen)** as the real end-user device. iOS is untested but should not be blocked by architectural choices.

## 2. Problem Statement

Obsidian users studying technical material routinely context-switch out of their note to look things up, generate examples, or create study aids — which breaks attention and leaves the knowledge scattered across tools. Existing AI plugins either depend on heavyweight custom CodeMirror rendering (fragile across Obsidian updates), or surface AI output in pop-ups/side panels that disrupt the reading flow. There is no zero-friction way to inline-clarify, inline-exemplify, and capture flashcards without leaving the page.

## 3. Solution

A plugin that:

1. Dynamically compiles **one Obsidian command per markdown file** under a user-defined `Edu-Templates` folder. File name → command name. YAML frontmatter → execution config. File body → LLM system prompt.
2. Streams LLM responses from OpenRouter **directly into the active note** as collapsible callouts, using only Obsidian's high-level `Editor` API (no CodeMirror StateFields, no Decorations, no custom inline widgets).
3. Routes outputs to (a) inline only, (b) inline + a central capture file, or (c) inline + a future SQLite store.
4. Works identically from Command Palette, Mobile Toolbar, and user-assigned hotkeys.

## 4. Scope

### In scope (MVP, covered by milestones M1–M10)

- Plugin scaffold, settings, CSS
- Template discovery with hot reload
- OpenRouter SSE streaming
- `context_scope`: `selection` | `heading` | `full-note`
- `output_destination`: `inline` | relative filepath
- Hotkey Probing, Custom Probing (modal), Capture flows
- Pin-to-range during streaming
- Concurrent streams (multiple in-flight)
- SQLite interface design (stub only — no implementation)
- CSS callouts (`scholia-clarify`, `scholia-example`, etc.)
- Ralph-loop evidence artifacts (HTML + mp4 per iteration)

### Out of scope (defer)

- Excalidraw integration
- Local inference endpoints (architecture must not preclude, but no MVP work)
- iOS verification
- Actual SQLite persistence (interface only)
- Cost/token telemetry inside the plugin (ralph handles loop-level cost)

### Future extensibility (must be designed-for, not built)

- Local LLM endpoint (OpenAI-compatible base URL + optional API key)
- DuckDB routing (SQLite interface already abstracts this)
- Per-template Excalidraw output mode

## 5. Architectural Constraints (non-negotiable)

These constraints exist to minimise long-term maintenance burden. Ralph MUST NOT violate them to "make a test pass":

1. **No CodeMirror 6 internals.** No `StateField`, `StateEffect`, `Decoration`, `ViewPlugin`, `EditorView` subclassing, or `editor.cm.*` access. Use only `Editor`, `MarkdownView`, `Workspace`, `Vault`, `MetadataCache`, `Notice`, `Modal`, `PluginSettingTab`, `Setting`, `TFile`, `TFolder`, and `Command` from the `obsidian` module.
2. **Configuration is data-driven.** User-authored markdown files define commands. The plugin's Settings menu holds only _global_ preferences (API key, default model, folder paths, debug toggle).
3. **LLM-agnostic client.** All LLM calls go through a single `LlmClient` abstraction. v1 implements OpenRouter via `fetch` + SSE. Must be trivially extensible to a local endpoint (same OpenAI-compatible wire format).
4. **SSE via `fetch` + `ReadableStream`.** Do not use `requestUrl` (no streaming support). Do not use EventSource (no custom headers).
5. **No native Node modules.** No `better-sqlite3`, no `fs` outside the `Vault` API, no `child_process`. All persistence goes through `this.app.vault.*` or WASM.
6. **Mobile-safe.** All code paths must run in the Android WebView. No DOM APIs beyond what Obsidian exposes via `MarkdownView.contentEl`.

## 6. Target Environment & Verification Surface

| Concern                         | Choice                                                                                                  |
| ------------------------------- | ------------------------------------------------------------------------------------------------------- |
| Plugin API floor                | Obsidian 1.5.0                                                                                          |
| Runtime                         | Obsidian Desktop (macOS) with `app.emulateMobile(true)` toggled on                                      |
| Device under test (manual only) | Android foldable, large screen                                                                          |
| Dev node version                | 20.x LTS                                                                                                |
| TypeScript                      | 5.4+                                                                                                    |
| Bundler                         | esbuild (as used by `obsidian-sample-plugin`)                                                           |
| Test runner                     | vitest (jsdom env) for unit; manual + screen-recorded runs for e2e                                      |
| Recording tool                  | `ffmpeg avfoundation` (macOS) — see §16                                                                 |
| Automation                      | AppleScript for Obsidian window control; PyAutoGUI for keyboard/mouse where AppleScript is insufficient |

The ralph loop MUST run in **host mode** (not container) because screen recording requires host macOS access.

## 7. Technical Stack & Tooling

**Dependencies (runtime):**

- `obsidian` (peer dep, no bundle)
- No other runtime deps for MVP

**Dev dependencies:**

- `typescript`, `esbuild`, `@types/node`, `obsidian` (types), `builtin-modules`
- `vitest`, `@types/jsdom`, `jsdom`
- `eslint` + `@typescript-eslint/*` (style)
- `prettier` (formatting, tabs, 100 col)

**Build targets:**

- `main.js` (bundled, CommonJS, `platform=browser`, `target=es2020`, external: `obsidian`, `electron`, `@codemirror/*`)
- `styles.css` (copied verbatim from `src/styles.css`)
- `manifest.json` (source of truth)

## 8. Directory Layout

```
obsidian-scholia/
├── .gitignore              # includes *.mp4, evidence/**/*.mp4, test-vault/.obsidian/workspace*.json, main.js (dev build), costs.jsonl
├── .gitmodules             # ralph submodule
├── PRD.md                  # this file
├── progress.txt            # ralph progress log
├── manifest.json           # Obsidian plugin manifest (id, version, minAppVersion)
├── versions.json           # Obsidian compat map
├── package.json
├── tsconfig.json
├── esbuild.config.mjs
├── vitest.config.ts
├── .eslintrc.cjs
├── .prettierrc
├── styles.css              # output of copying src/styles.css (built)
├── main.js                 # built (gitignored)
├── src/
│   ├── main.ts             # Plugin entry (extends Plugin)
│   ├── settings.ts         # ScholiaSettings + default + PluginSettingTab
│   ├── templates/
│   │   ├── registry.ts     # TemplateRegistry: load, parse, hot-reload
│   │   ├── frontmatter.ts  # parseFrontmatter, validate, apply defaults
│   │   └── types.ts        # TemplateConfig interface
│   ├── context/
│   │   ├── extractor.ts    # getSelection/getHeading/getFullNote
│   │   └── stripper.ts     # regex preprocessors for full-note
│   ├── llm/
│   │   ├── client.ts       # LlmClient interface
│   │   ├── openrouter.ts   # OpenRouterClient (fetch + SSE)
│   │   └── sse.ts          # parseSseStream async iterator
│   ├── stream/
│   │   ├── manager.ts      # StreamManager (concurrent streams)
│   │   ├── stream.ts       # Stream class: skeleton, pin-to-range, write loop
│   │   └── callout.ts      # buildSkeleton, appendToCallout, formatError
│   ├── commands/
│   │   ├── register.ts     # buildCommandFromTemplate
│   │   ├── hotkey.ts       # HotkeyProbeRunner
│   │   ├── custom.ts       # CustomProbeRunner + CustomProbeModal
│   │   └── capture.ts      # CaptureRunner (dual-write)
│   ├── storage/
│   │   ├── sqlite.ts       # SqliteStore interface (no impl)
│   │   └── appendFile.ts   # vault.append + auto-create parents
│   ├── ui/
│   │   ├── modal.ts        # CustomProbeModal
│   │   └── suggest.ts      # FolderSuggest for settings
│   ├── util/
│   │   ├── debounce.ts
│   │   ├── ids.ts          # deterministic command IDs
│   │   └── log.ts          # debug-gated logger
│   └── styles.css          # source; copied to repo root during build
├── test/
│   ├── unit/
│   │   ├── frontmatter.test.ts
│   │   ├── stripper.test.ts
│   │   ├── sse.test.ts
│   │   ├── callout.test.ts
│   │   ├── stream.test.ts
│   │   └── registry.test.ts
│   └── fixtures/
│       ├── templates/      # sample Edu-Templates
│       └── notes/          # sample notes for context extraction
├── test-vault/             # checked-in Obsidian vault used for manual + automated runs
│   ├── .obsidian/
│   │   ├── plugins/scholia/ # symlink → ../../ (or copy of main.js + manifest + styles)
│   │   ├── community-plugins.json
│   │   └── app.json
│   ├── Edu-Templates/
│   │   ├── Clarify.md
│   │   ├── Real-World Example.md
│   │   ├── Flashcard.md
│   │   └── Probe (Custom).md
│   ├── _System/
│   │   └── Central-Flashcards.md
│   └── Reading/
│       └── Sample Chapter.md
├── scripts/
│   ├── install-to-vault.sh   # symlinks dist to test-vault plugin dir
│   ├── emulate-mobile.applescript
│   ├── record.sh             # ffmpeg avfoundation wrapper
│   └── evidence.py           # generates index.html from screenshots + mp4s
├── evidence/
│   └── milestone-N/
│       ├── index.html
│       ├── iteration-K/
│       │   ├── recording.mp4        # gitignored
│       │   ├── screenshot-before.png
│       │   ├── screenshot-after.png
│       │   └── log.txt
│       └── summary.md
└── ralph/                    # submodule (do not modify from this project)
```

## 9. Settings Schema

```ts
// src/settings.ts
export interface ScholiaSettings {
  openRouterApiKey: string; // password field
  defaultModel: string; // default: "z-ai/glm-5.1"
  defaultTemperature: number; // default: 0.7
  defaultMaxTokens: number; // default: 1024
  templatesFolder: string; // default: "Edu-Templates"
  centralCaptureFile: string; // default: "_System/Central-Flashcards.md"
  defaultCalloutType: string; // default: "ai"
  debugLogging: boolean; // default: false
  enableHotReloadOfTemplates: boolean; // default: true
}

export const DEFAULT_SETTINGS: ScholiaSettings = {
  openRouterApiKey: "",
  defaultModel: "z-ai/glm-5.1",
  defaultTemperature: 0.7,
  defaultMaxTokens: 1024,
  templatesFolder: "Edu-Templates",
  centralCaptureFile: "_System/Central-Flashcards.md",
  defaultCalloutType: "ai",
  debugLogging: false,
  enableHotReloadOfTemplates: true,
};
```

**Settings tab controls (in this order):**

1. OpenRouter API Key — `Setting.addText` with `inputEl.type = "password"`
2. Default Model — text with datalist of common slugs
3. Default Temperature — slider 0.0–2.0 step 0.1
4. Default Max Tokens — number 128–8192
5. Templates Folder — text + `FolderSuggest` dropdown
6. Central Capture File — text
7. Default Callout Type — dropdown (`ai`, `faq`, `scholia-clarify`, `scholia-example`, `scholia-flashcard`)
8. Hot-reload templates — toggle
9. Debug logging — toggle
10. Button: "Open templates folder"
11. Button: "Create sample templates" (writes three starter templates if folder empty)

Persisted via `this.saveData(settings)` / `this.loadData()`. No secrets outside `data.json`.

## 10. Template Engine

### 10.1 Discovery

On `onload`: scan `<vault root>/<templatesFolder>/**/*.md`. For each file:

1. Parse frontmatter via `app.metadataCache.getFileCache(file).frontmatter` (preferred; falls back to `parseYaml` from `obsidian`).
2. Validate (§10.3). If invalid → `new Notice("Scholia template invalid: ${path} — ${reason}")`, skip; do not throw.
3. Build a `TemplateConfig` object; register a `Command` via `this.addCommand(...)`.

### 10.2 Hot reload

Register `this.registerEvent(this.app.vault.on('create', ...))`, `'modify'`, `'rename'`, `'delete'`. Debounce (300ms) and call `TemplateRegistry.reconcile()`:

- New file under templates folder → add command
- Modified file → re-parse, update command (call `removeCommand` then `addCommand`)
- Renamed: old-id removeCommand, new-id addCommand
- Deleted → removeCommand

**Note on `removeCommand`:** Obsidian has no public `removeCommand` API. Scholia uses the undocumented `(app as any).commands.removeCommand(commandId)`. This works in 1.5.0+ but could break. If it throws, catch and log a `Notice`: "Template removed — please reload Obsidian to fully unregister the command." Wrap in a single helper: `src/util/removeCommand.ts`.

### 10.3 Frontmatter schema

All fields optional except `context_scope` and `output_destination`. Unknown keys are preserved but ignored (forward-compat).

```yaml
---
# REQUIRED
context_scope: selection # selection | heading | full-note
output_destination: inline # inline | <relative-filepath.md>

# LLM (optional — falls back to global Settings)
model: z-ai/glm-5.1 # OpenRouter slug
temperature: 0.7 # 0.0 – 2.0
max_tokens: 1024 # 128 – 8192

# Callout styling (optional)
callout_type: scholia-clarify # ai | faq | scholia-clarify | scholia-example | scholia-flashcard | <custom>
callout_label: "AI Clarification" # appears after the callout type
callout_folded: true # true (default) starts collapsed, false starts expanded

# UX behavior (optional)
requires_selection: true # default: true. When true + no selection → Notice + abort
command_prefix: "Run" # default: "Run". Command name = "<prefix>: <filename-without-ext>"
hotkey: [] # Obsidian Hotkey[]; default []. e.g. [{ modifiers: ["Mod","Shift"], key: "C" }]

# Capture flow only (optional)
also_append_to: "_System/Central-Flashcards.md" # when set, dual-writes. Supersedes central default.
append_format: "markdown" # markdown | json-line. Default: markdown
---
You are a concise tutor. Explain the following selection in plain language …
```

**Template "Flashcard.md" (full pre-filled example — ship this as a sample):**

```yaml
---
context_scope: selection
output_destination: inline
model: z-ai/glm-5.1
temperature: 0.4
max_tokens: 512
callout_type: scholia-flashcard
callout_label: "Flashcard"
callout_folded: true
requires_selection: true
command_prefix: "Run"
hotkey: []
also_append_to: "_System/Central-Flashcards.md"
append_format: markdown
---
You are a study assistant. Convert the selection into one Anki-style flashcard.
Output exactly:

Q: <single-sentence question>
A: <single-sentence answer>
```

### 10.4 Validation rules

| Field                | Rule                                            | Failure mode                                 |
| -------------------- | ----------------------------------------------- | -------------------------------------------- |
| `context_scope`      | must be `selection`/`heading`/`full-note`       | skip template, Notice                        |
| `output_destination` | `inline` or valid relative path ending `.md`    | skip, Notice                                 |
| `temperature`        | 0 ≤ n ≤ 2                                       | clamp, no Notice                             |
| `max_tokens`         | 128 ≤ n ≤ 8192                                  | clamp, no Notice                             |
| `callout_type`       | matches `[a-z][a-z0-9-]*`                       | fall back to `defaultCalloutType`, no Notice |
| `hotkey[].modifiers` | subset of `["Mod","Ctrl","Alt","Shift","Meta"]` | drop invalid entries, Notice                 |

## 11. Feature Specifications

### 11.1 F1 — Hotkey Probing (Inline Clarification)

**User story:** User selects text, taps a toolbar button, gets a collapsed AI callout below the selection with streaming content.

**Trigger path:** Command Palette / Mobile Toolbar button / assigned hotkey → `HotkeyProbeRunner.run(template, editor, view)`.

**Flow:**

1. Resolve context per `context_scope`.
2. If `requires_selection: true` and selection is empty → `new Notice("Select text first")`, return.
3. Build LLM request (system = template body, user = context).
4. Insert skeleton (§12.1) immediately below the selection's end-of-line.
5. Open a new `Stream` in `StreamManager`. Stream starts writing chunks into the skeleton's response body.
6. On completion → optionally append to `also_append_to` per §11.3.

**Acceptance criteria (F1):**

- [ ] With a selection present, invoking the command produces a `[!<callout_type>]-` callout within 1.5s TTFT (network-dependent; assert skeleton insertion within 100ms, first chunk arrival before completion).
- [ ] Callout is folded by default, with `**Context:**` showing the original selection and `**Response:**` showing streamed text.
- [ ] The original selected text remains unmodified in the document.
- [ ] No popups, no focus changes, no scrolling jumps.
- [ ] Works in Obsidian Desktop with mobile emulation ON and from the Mobile Toolbar.

### 11.2 F2 — Custom Probing (Modal)

**Trigger:** A special template whose frontmatter includes `custom_probe: true` (new key — validated in 10.3 as optional bool).

**Flow:**

1. Open `CustomProbeModal` (extends `Modal`):
   - textarea for the user query (autofocus)
   - radio group: Context scope = `selection` | `heading` | `full-note` (default = the template's `context_scope`)
   - checkbox: "Also append to central file"
   - Submit button (Enter submits; Esc cancels)
2. On submit: run as F1, but use user-provided query concatenated to the template body as the system prompt suffix: `{template_body}\n\nUser request: {modal_input}`.

**Acceptance criteria (F2):**

- [ ] Modal appears centered, autofocuses the textarea, closes on Esc.
- [ ] Submitting with empty textarea is blocked with an inline error message (no Notice).
- [ ] Selected scope overrides the template scope for this invocation only.
- [ ] Streaming behaviour identical to F1 afterwards.

### 11.3 F3 — Capture (dual-write)

**Applies whenever a template has `also_append_to: <path>` set** (regardless of `custom_probe`).

**Flow:**

1. Run F1 (or F2) as normal — response streams inline.
2. On stream completion (not during), read the accumulated response text.
3. Append to `also_append_to` via `appendFile.ts`:
   - Create parent folders if missing (`vault.createFolder`).
   - If file does not exist: `vault.create(path, "# Captures\n\n" + entry)`.
   - If exists: `vault.append(path, "\n\n" + entry)`.
4. Entry format when `append_format: markdown` (default):
   ```
   ---
   <!-- scholia:captured:<ISO8601>:<source-note-basename> -->
   <response text>
   ```
5. Entry format when `append_format: json-line`:
   ```
   {"ts":"<ISO8601>","source":"<path>","template":"<name>","content":"<response>"}
   ```
6. Show `new Notice("Captured to <path>")`.

**Acceptance criteria (F3):**

- [ ] Inline callout appears AND central file contains the new entry after stream end.
- [ ] Parent folders auto-created.
- [ ] Notice shown exactly once per capture.
- [ ] If stream errors mid-way, **no** central-file append happens.

## 12. Streaming Implementation

### 12.1 Skeleton insertion

On trigger, at cursor-after-selection (or end-of-selection line if no cursor movement desired), call:

```ts
export function buildSkeleton(opts: {
  calloutType: string; // "ai", "scholia-clarify", ...
  calloutLabel: string; // "AI Clarification"
  folded: boolean;
  commandName: string;
  selectionText: string;
}): string {
  const foldMarker = opts.folded ? "-" : "+";
  const safeSel = opts.selectionText.replace(/\n/g, "\n> ");
  return (
    `\n> [!${opts.calloutType}]${foldMarker} ${opts.calloutLabel}: ${opts.commandName}\n` +
    `> **Context:** *${safeSel}*\n` +
    `> \n` +
    `> **Response:**\n` +
    `> `
  );
}
```

After the selection's line, call `editor.replaceRange(skeleton, posAfterSelection)`. Record the absolute offset of the **end of the skeleton** (the trailing `> `) as the stream's `writeOffset`.

### 12.2 Streaming loop (per chunk)

```ts
// stream/stream.ts
async function writeChunk(
  editor: Editor,
  offset: number,
  raw: string,
): Promise<number> {
  // Preserve callout formatting: every newline inside the stream body must be followed by "> "
  const prefixed = raw.replace(/\n/g, "\n> ");
  const pos = editor.offsetToPos(offset);
  editor.replaceRange(prefixed, pos);
  return offset + prefixed.length;
}
```

### 12.3 Pin-to-range

The stream must survive the user editing elsewhere in the document. Since we cannot use CodeMirror StateFields, we track offsets via the workspace's editor-change event:

```ts
// stream/manager.ts
this.plugin.registerEvent(
  this.plugin.app.workspace.on(
    "editor-change",
    (editor: Editor, info: MarkdownView) => {
      if (!info.file) return;
      for (const s of this.streams.values()) {
        if (s.filePath !== info.file.path) continue;
        // Compare previous content length to current; find change position by diffing
        const current = editor.getValue();
        const delta = current.length - s.lastKnownLength;
        if (delta === 0) continue;
        const changePos = findFirstDifference(s.lastKnownContent, current);
        if (changePos <= s.writeOffset && !s.inRangeWriteInProgress) {
          // External edit BEFORE our write point → shift write offset
          s.writeOffset += delta;
          s.skeletonStart += delta;
          s.skeletonEnd += delta;
        } else if (
          changePos >= s.skeletonStart &&
          changePos <= s.skeletonEnd &&
          !s.inRangeWriteInProgress
        ) {
          // External edit INSIDE our callout → abort
          s.abort.abort(new Error("User edited inside the callout"));
        }
        s.lastKnownLength = current.length;
        s.lastKnownContent = current;
      }
    },
  ),
);
```

`findFirstDifference(a, b)` = smallest index i where `a[i] !== b[i]`. O(n). For performance, use the hint `editor.cm.state.doc` length diff — but **NOT** direct CodeMirror API, only length comparison.

Set `s.inRangeWriteInProgress = true` around each `writeChunk` call to avoid re-entering the handler on our own writes.

### 12.4 Concurrent streams (policy: allow many)

`StreamManager` holds a `Map<streamId, Stream>`. Each stream has its own `AbortController`. Each stream pins to its own range. New triggers never block existing streams. Limit: soft cap at 8; beyond that, `Notice("Too many concurrent streams")` and abort new.

### 12.5 Error handling

On any stream error (network, SSE parse, abort, edit-in-range):

1. Stop reading the stream body.
2. Append to the callout: `> \n> **Error:** <message>` using the same offset-tracking machinery.
3. `new Notice("Scholia: <message>")`.
4. Remove the stream from the manager.
5. Do NOT dual-write to central file (per §11.3 acceptance).

### 12.6 SSE

OpenAI-compatible SSE: lines beginning `data: ` terminated by blank line; `data: [DONE]` signals completion; each payload is JSON with `choices[0].delta.content`.

```ts
// llm/sse.ts
export async function* parseSseStream(resp: Response): AsyncGenerator<string> {
  const reader = resp.body!.getReader();
  const decoder = new TextDecoder("utf-8");
  let buffer = "";
  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    buffer += decoder.decode(value, { stream: true });
    let idx;
    while ((idx = buffer.indexOf("\n\n")) !== -1) {
      const event = buffer.slice(0, idx);
      buffer = buffer.slice(idx + 2);
      for (const line of event.split("\n")) {
        if (!line.startsWith("data: ")) continue;
        const payload = line.slice(6);
        if (payload === "[DONE]") return;
        try {
          const json = JSON.parse(payload);
          const delta = json?.choices?.[0]?.delta?.content;
          if (typeof delta === "string" && delta.length > 0) yield delta;
        } catch {
          /* ignore malformed */
        }
      }
    }
  }
}
```

### 12.7 OpenRouter client

```ts
// llm/openrouter.ts
export class OpenRouterClient implements LlmClient {
  constructor(private apiKey: string) {}
  async *stream(req: LlmRequest, signal: AbortSignal): AsyncGenerator<string> {
    const resp = await fetch("https://openrouter.ai/api/v1/chat/completions", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${this.apiKey}`,
        "Content-Type": "application/json",
        "HTTP-Referer": "https://obsidian.md/plugins/scholia",
        "X-Title": "Scholia",
      },
      body: JSON.stringify({
        model: req.model,
        temperature: req.temperature,
        max_tokens: req.maxTokens,
        stream: true,
        messages: [
          { role: "system", content: req.system },
          { role: "user", content: req.user },
        ],
      }),
      signal,
    });
    if (!resp.ok)
      throw new Error(`OpenRouter ${resp.status}: ${await resp.text()}`);
    yield* parseSseStream(resp);
  }
}
```

## 13. Context Extraction

```ts
// context/extractor.ts
export type Scope = "selection" | "heading" | "full-note";

export function extractContext(
  app: App,
  editor: Editor,
  view: MarkdownView,
  scope: Scope,
): string {
  switch (scope) {
    case "selection":
      return editor.getSelection();
    case "heading":
      return extractHeadingSection(app, editor, view);
    case "full-note":
      return stripForTokens(editor.getValue());
  }
}
```

### 13.1 `heading` extraction

Use `app.metadataCache.getFileCache(view.file!).headings` to find the nearest heading at or above the cursor, and the next heading below. Return the text between them (trimmed). Fallback to full-note if no headings.

### 13.2 `full-note` stripper

```ts
// context/stripper.ts
export function stripForTokens(md: string): string {
  return md
    .replace(/^---\n[\s\S]*?\n---\n/, "") // leading YAML
    .replace(/!\[\[[^\]]+\]\]/g, "") // Obsidian embeds
    .replace(/!\[[^\]]*\]\([^)]+\)/g, "") // images
    .replace(/\[([^\]]+)\]\(https?:\/\/[^)]+\)/g, "$1") // links → text
    .replace(/\n{3,}/g, "\n\n") // collapse blank runs
    .trim();
}
```

## 14. CSS Snippets (shipped in `styles.css`)

Ship four custom callout types matching the frontmatter enum plus a generic `ai`. Use subdued academic palette (desaturated blue, ochre, sage, plum). Ensure both light and dark themes covered via `.theme-light` / `.theme-dark` scoping.

Example (abridged — fill all four + ai):

```css
.callout[data-callout="scholia-clarify"] {
  --callout-color: 92, 116, 140; /* muted slate-blue */
  --callout-icon: lucide-lightbulb;
}
.callout[data-callout="scholia-example"] {
  --callout-color: 140, 116, 80;
  --callout-icon: lucide-beaker;
}
.callout[data-callout="scholia-flashcard"] {
  --callout-color: 96, 128, 104;
  --callout-icon: lucide-layers;
}
.callout[data-callout="scholia-error"] {
  --callout-color: 160, 72, 72;
  --callout-icon: lucide-alert-triangle;
}
```

## 15. SQLite Interface (design only — no impl)

```ts
// src/storage/sqlite.ts
export interface SqliteStore {
  init(): Promise<void>;
  insertCapture(row: CaptureRow): Promise<void>;
  queryCaptures(filter: CaptureFilter): Promise<CaptureRow[]>;
  close(): Promise<void>;
}

export interface CaptureRow {
  id: string; // uuid
  ts: string; // ISO8601
  sourcePath: string;
  template: string;
  content: string;
  scope: "selection" | "heading" | "full-note";
  model: string;
}

export interface CaptureFilter {
  since?: string;
  template?: string;
  sourcePath?: string;
}

// Planned implementation: sql.js (pure WASM), DB file stored at
// <vault>/.obsidian/plugins/scholia/captures.sqlite, loaded via
// app.vault.adapter.readBinary / writeBinary. NOT implemented in MVP.
export class NoopSqliteStore implements SqliteStore {
  async init() {}
  async insertCapture() {}
  async queryCaptures() {
    return [];
  }
  async close() {}
}
```

The design is **committed** to MVP; the implementation is **deferred**. Capture flow writes ONLY to the markdown file in MVP.

## 16. Verification & Evidence

Every ralph iteration MUST produce:

1. A directory `evidence/milestone-<N>/iteration-<K>/` containing:
   - `recording.mp4` — 30–60s screen capture of the feature exercised (gitignored)
   - `screenshot-before.png`, `screenshot-after.png`
   - `log.txt` — stdout of the automation driver
2. Updated `evidence/milestone-<N>/index.html` — a static page linking all iterations' assets with captions.
3. An entry in `progress.txt` referencing the iteration number.

### 16.1 Recording

`scripts/record.sh`:

```bash
#!/usr/bin/env bash
# Usage: record.sh <output.mp4> <seconds>
set -euo pipefail
OUT="$1"; DUR="${2:-45}"
mkdir -p "$(dirname "$OUT")"
ffmpeg -y -f avfoundation -framerate 30 -i "1:none" -t "$DUR" \
    -vcodec libx264 -preset veryfast -pix_fmt yuv420p "$OUT"
```

macOS Screen Recording permission must be granted to the terminal running ralph. Setup wizard should surface this.

### 16.2 Driving Obsidian

`scripts/emulate-mobile.applescript`:

```applescript
tell application "Obsidian" to activate
tell application "System Events"
    keystroke "p" using {command down}
    delay 0.4
    keystroke "Toggle mobile emulation"
    delay 0.2
    key code 36 -- return
end tell
```

PyAutoGUI is used when we need pixel-precise drag for the Mobile Toolbar button. Scripts live under `scripts/` as `.py` and expose `__main__` for direct invocation.

### 16.3 index.html format

Single-file HTML, no external deps. Template:

```html
<!doctype html>
<html>
  <head>
    <meta charset="utf-8" />
    <title>Scholia M{N} evidence</title>
    <style>
      body {
        font: 14px/1.4 system-ui;
        max-width: 860px;
        margin: 2em auto;
      }
      video {
        width: 100%;
      }
    </style>
  </head>
  <body>
    <h1>Milestone {N}: {title}</h1>
    <ol id="iters"></ol>
  </body>
</html>
```

`scripts/evidence.py` regenerates this file from directory contents at the end of each iteration.

## 17. Ralph Loop Operating Rules

Every iteration:

1. Read `PRD.md` fully.
2. Find the first unchecked task in the earliest open milestone.
3. Implement it. Constraint violations (§5) are loop-failing bugs, not feature choices.
4. Run `npm test` (unit tests must pass).
5. Run `npm run build` (must succeed, no TS errors).
6. Exercise the feature in `test-vault` via AppleScript/PyAutoGUI with `scripts/record.sh` running.
7. Save artefacts to `evidence/milestone-<N>/iteration-<K>/`.
8. Update `evidence/milestone-<N>/index.html` via `scripts/evidence.py`.
9. Append a block to `progress.txt` with: iteration, task touched, files changed, verification result, any deviations.
10. Tick the task `- [x]` in PRD.md.
11. `git add -A && git commit -m "iter: <task summary>"`.
12. If the task closed a milestone (all its tasks ticked):
    - Bump `manifest.json` version to `0.M.0` where M = milestone number
    - Update `versions.json`
    - `git tag v0.M.0`
    - Write `evidence/milestone-<N>/summary.md` (3-bullet recap)
    - Commit as `milestone: M<N> close`.

Never commit `main.js`, `*.mp4`, `test-vault/.obsidian/workspace*.json`, or `costs.jsonl`.

## 18. Test Plan

### 18.1 Unit (vitest, jsdom)

| File                  | Coverage target                                                            |
| --------------------- | -------------------------------------------------------------------------- |
| `frontmatter.test.ts` | Valid / invalid schema, clamping, defaulting, hotkey normalisation         |
| `stripper.test.ts`    | Each regex in isolation + combined on a 500-line fixture                   |
| `sse.test.ts`         | Partial chunks across message boundaries, `[DONE]`, malformed JSON ignored |
| `callout.test.ts`     | `buildSkeleton` with newlines in selection; foldMarker correctness         |
| `stream.test.ts`      | Pin-to-range offset shift on edit-before, abort on edit-in-range           |
| `registry.test.ts`    | Discovery, hot-reload reconciliation (add/modify/rename/delete)            |

Mock `obsidian` with a minimal in-memory stand-in at `test/mocks/obsidian.ts`. The `Editor` mock stores a string and exposes `getValue`, `replaceRange`, `offsetToPos`, `posToOffset`, `getSelection`.

### 18.2 Integration (run against real Obsidian via test-vault)

Each feature (F1, F2, F3) gets a scripted walk-through (AppleScript + PyAutoGUI) that:

1. Opens `test-vault/Reading/Sample Chapter.md`
2. Selects a known paragraph
3. Triggers the command
4. Waits for stream completion (polls file for `✓ scholia:done:<id>` marker? — simpler: sleep 10s, assert callout presence with `grep`)
5. Takes before/after screenshots
6. Diffs the file for expected structural change

### 18.3 Manual on Android

Tracked as a one-time checklist in `evidence/milestone-10/android-manual.md`. Not part of the loop.

## 19. Milestones

Each milestone's tasks must be completed in order. Check items off by changing `- [ ]` to `- [x]`. Do not skip tasks. Do not batch tasks into one commit.

### Milestone M1 — Plugin scaffold & settings

**Goal:** Installable plugin loads in test-vault, settings UI renders, CSS snippets visible.

- [x] 1. Initialise from `obsidian-sample-plugin` (copy `main.ts`, `manifest.json`, `styles.css`, `esbuild.config.mjs`, `tsconfig.json`, `package.json` into this repo root where missing).
- [x] 2. Set `manifest.json`: `id: "scholia"`, `name: "Scholia"`, `version: "0.1.0"`, `minAppVersion: "1.5.0"`, `description: "Active-reading AI annotations for Obsidian."`, `isDesktopOnly: false`.
- [x] 3. Create `src/settings.ts` with `ScholiaSettings`, `DEFAULT_SETTINGS`, `ScholiaSettingTab` wired per §9.
- [x] 4. Create `src/styles.css` with callout palette per §14; copy to repo root in build step.
- [x] 5. Create `scripts/install-to-vault.sh` that symlinks `./` into `test-vault/.obsidian/plugins/scholia/`.
- [x] 6. Create `test-vault/` with `.obsidian/community-plugins.json` enabling "scholia".
- [x] 7. Verify: Open Obsidian → test-vault loads → Scholia appears in Settings → all 11 controls render.
- [x] 8. Evidence: record 30s video scrolling through settings tab.

**Acceptance:** Plugin loads without console errors; settings persist across reload; callout CSS applies when a `[!scholia-clarify]` block is manually added to a note.

### Milestone M2 — Template discovery & dynamic commands (no LLM)

**Goal:** Commands appear in palette derived from template files; hot-reload works.

- [x] 9. Implement `src/templates/frontmatter.ts` (parse + validate + clamp + defaults).
- [x] 10. Implement `src/templates/registry.ts` with `load()`, `reconcile()`, debounced vault watchers.
- [x] 11. Implement `src/util/removeCommand.ts` wrapper with try/catch + Notice fallback.
- [x] 12. Wire registry into `main.ts` `onload`. Each template registers a `Command` whose callback `new Notice("<template name>: context=<resolved scope length>")` (stub — no LLM yet).
- [x] 13. Seed `test-vault/Edu-Templates/` with `Clarify.md`, `Real-World Example.md`, `Flashcard.md`, `Probe (Custom).md` — all with full frontmatter.
- [x] 14. Unit tests for `frontmatter` and `registry`.
- [x] 15. Verify: add/edit/rename/delete a template → palette updates within 500ms.
- [x] 16. Evidence: 45s screencast demonstrating all four reconcile paths.

**Acceptance:** Four commands visible in palette; hot-reload demonstrated on video; unit tests green.

### Milestone M3 — OpenRouter streaming end-to-end (single hardcoded command)

**Goal:** One template (`Clarify.md`) streams from OpenRouter into an inline callout.

- [x] 17. Implement `src/llm/sse.ts` (async generator, unit-tested).
- [x] 18. Implement `src/llm/openrouter.ts`.
- [x] 19. Implement `src/stream/callout.ts` (`buildSkeleton`, `appendToCallout`, `formatError`).
- [x] 20. Implement `src/stream/stream.ts` minimal (no pin-to-range yet — static offset).
- [x] 21. Wire `Clarify.md` command to: extract selection, build skeleton, call OpenRouter, pipe chunks to callout.
- [x] 22. Error path: if API key missing → Notice + abort before skeleton.
- [x] 23. Verify with live OpenRouter key: select text → run Clarify → see streamed callout.
- [x] 24. Evidence: 60s video with audible narration describing what's happening.

**Acceptance:** Visible streaming (chunk-by-chunk) into a folded callout; response preserved after refold.

### Milestone M4 — `context_scope` variants

**Goal:** All three scopes work; full-note stripper reduces tokens.

- [x] 25. Implement `src/context/stripper.ts` with unit tests per §13.2.
- [x] 26. Implement `src/context/extractor.ts` with heading-range logic using `MetadataCache`.
- [x] 27. Wire extractor into the generic command runner.
- [x] 28. Update all four test-vault templates to exercise each scope at least once.
- [x] 29. Verify: run a `heading`-scoped template with cursor inside `## Section B` → LLM prompt contains only that section (assert via debug log).
- [x] 30. Evidence: split-screen video showing three commands, one per scope, against the same note.

**Acceptance:** Each scope verified in both unit tests and recorded evidence.

### Milestone M5 — `output_destination` routing

**Goal:** Inline vs filepath routing works; capture appends silently.

- [x] 31. Implement `src/storage/appendFile.ts` with parent auto-create, idempotent existence check.
- [x] 32. Extend runner to branch on `output_destination === "inline"` vs a path.
- [x] 33. Notice after non-inline append: `"Scholia: appended to <path>"`.
- [x] 34. Unit tests for `appendFile.ts` (non-existent file, existing file, nested path).
- [x] 35. Verify: template routing to `_System/Log.md` creates file + Notice.
- [x] 36. Evidence: 30s video showing the file being created.

**Acceptance:** Pure-append templates never insert inline; dual-write templates still insert inline (per F3, that's F3's job — pure route-elsewhere templates do NOT insert inline).

### Milestone M6 — Custom Probing modal (F2)

**Goal:** Modal-based custom query flow.

- [x] 37. Implement `src/ui/modal.ts` (`CustomProbeModal`).
- [x] 38. Wire `custom_probe: true` templates to open modal instead of immediate run.
- [x] 39. Submitted query appended to system prompt as described in §11.2.
- [x] 40. Modal keyboard behaviours: autofocus, Enter submit, Esc cancel, empty-input inline error.
- [x] 41. Unit test: modal renders expected DOM (jsdom).
- [x] 42. Verify on mobile-emulated desktop; verify on Android foldable (manual checklist).
- [x] 43. Evidence: 45s video covering happy path + empty-input error.

**Acceptance:** Modal ergonomics match §11.2 acceptance criteria.

### Milestone M7 — Capture flow (F3)

**Goal:** Dual-write (inline + central file) for flashcard-style templates.

- [x] 44. Implement `src/commands/capture.ts` (thin wrapper over runner + appendFile).
- [x] 45. Honour `also_append_to` + `append_format` (markdown, json-line).
- [x] 46. No append on stream error (§11.3).
- [ ] 47. Unit tests for both formats + error path.
- [ ] 48. Verify: run Flashcard template → note has collapsed callout AND `_System/Central-Flashcards.md` has new entry.
- [ ] 49. Evidence: 60s video; screenshot diff of central file.

**Acceptance:** Dual-write works; Notice appears once; error path suppresses append.

### Milestone M8 — Stream robustness

**Goal:** Pin-to-range, concurrent streams, abort-on-edit-in-range, error display.

- [ ] 50. Implement pin-to-range offset tracking per §12.3 with unit tests covering: edit-before, edit-inside, edit-after, multi-line edit.
- [ ] 51. Implement concurrent `StreamManager` with soft cap 8.
- [ ] 52. Implement error rendering in-callout per §12.5.
- [ ] 53. Unit test: two streams in different notes, edits in one do not affect the other.
- [ ] 54. Unit test: edit-inside triggers abort + error callout.
- [ ] 55. Verify with manual multi-stream session (run three templates quickly).
- [ ] 56. Evidence: 90s video showing two simultaneous streams + one pinned through a paragraph insertion elsewhere.

**Acceptance:** All §12 behaviour observable on video and exercised by tests.

### Milestone M9 — SQLite interface (design only) & CSS polish

**Goal:** Interface committed; CSS looks correct in light + dark.

- [ ] 57. Implement `src/storage/sqlite.ts` interface + `NoopSqliteStore` per §15.
- [ ] 58. Wire capture runner to call `NoopSqliteStore.insertCapture` (no-op) so future swap is trivial.
- [ ] 59. Finalise `styles.css` — all five callout types styled in both themes.
- [ ] 60. Verify visually: toggle between light/dark themes; each callout readable.
- [ ] 61. Evidence: side-by-side light/dark screenshots.

**Acceptance:** `NoopSqliteStore` reachable from the capture code path; CSS passes visual review.

### Milestone M10 — Evidence tooling & documentation

**Goal:** Scripts, README, manifest-ready bundle.

- [ ] 62. Harden `scripts/record.sh`, `scripts/evidence.py`, `scripts/emulate-mobile.applescript`.
- [ ] 63. Write project `README.md` for plugin users (install, configure, write a template).
- [ ] 64. Run a full loop pass on all milestones to regenerate `evidence/milestone-*/index.html`.
- [ ] 65. Prepare release artefact set: `manifest.json`, `main.js`, `styles.css` zipped under `dist/scholia-v0.10.0.zip`.
- [ ] 66. Verify on Android foldable (manual checklist, documented).
- [ ] 67. Evidence: compiled HTML index linking all milestone pages.

**Acceptance:** A non-technical user can, following README, install the plugin into their vault and run Clarify on a sentence.

## 20. Notes & Non-Goals

- **No telemetry** ships with the plugin. Debug logging is local console only, off by default.
- **No secret storage** beyond `data.json`; this is acceptable because Obsidian's plugin sandbox is the trust boundary users have accepted.
- **No automatic OpenRouter model list fetch at runtime.** The settings UI offers a datalist of common slugs but accepts any free-text value.
- **No stream cancellation UI** in MVP beyond Esc-to-close modal. Streams can be aborted programmatically but not from the UI.

---

## Appendix A — Sample templates (ship these in `test-vault/Edu-Templates/`)

### `Clarify.md`

```yaml
---
context_scope: selection
output_destination: inline
model: z-ai/glm-5.1
temperature: 0.6
max_tokens: 768
callout_type: scholia-clarify
callout_label: "AI Clarification"
callout_folded: true
requires_selection: true
command_prefix: "Run"
hotkey: []
---
You are a patient tutor. Explain the selection below in plain language suitable for an undergraduate. Be concise (≤120 words). Do not restate the selection.
```

### `Real-World Example.md`

```yaml
---
context_scope: heading
output_destination: inline
model: z-ai/glm-5.1
temperature: 0.8
max_tokens: 512
callout_type: scholia-example
callout_label: "Real-world example"
callout_folded: true
requires_selection: false
command_prefix: "Run"
hotkey: []
---
Using the section context below, provide one concrete real-world example that illustrates the concept. Keep it under 100 words.
```

### `Probe (Custom).md`

```yaml
---
context_scope: heading
output_destination: inline
model: z-ai/glm-5.1
temperature: 0.7
max_tokens: 1024
callout_type: ai
callout_label: "Custom Probe"
callout_folded: true
requires_selection: false
command_prefix: "Run"
hotkey: []
custom_probe: true
---
You are a helpful study partner. Use the provided section context to answer the user's question below.
```

## Appendix B — esbuild.config.mjs (starting point)

```js
import esbuild from "esbuild";
import process from "process";
import builtins from "builtin-modules";
import { copyFileSync } from "fs";

const prod = process.argv.includes("--prod");

const ctx = await esbuild.context({
  entryPoints: ["src/main.ts"],
  bundle: true,
  external: [
    "obsidian",
    "electron",
    "@codemirror/autocomplete",
    "@codemirror/collab",
    "@codemirror/commands",
    "@codemirror/language",
    "@codemirror/lint",
    "@codemirror/search",
    "@codemirror/state",
    "@codemirror/view",
    ...builtins,
  ],
  format: "cjs",
  target: "es2020",
  logLevel: "info",
  sourcemap: prod ? false : "inline",
  treeShaking: true,
  outfile: "main.js",
  minify: prod,
});

copyFileSync("src/styles.css", "styles.css");

if (prod) {
  await ctx.rebuild();
  process.exit(0);
} else {
  await ctx.watch();
}
```

## Appendix C — Tasks index (for ralph)

Tasks 1–67 above, in order. Ralph must pick the lowest-numbered `- [ ]` task and complete it before moving on.

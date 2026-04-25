# Scholia

Active-reading AI annotations for Obsidian. Scholia lets you annotate, clarify, and extract knowledge from notes without breaking reading flow — AI responses stream directly into your note as native Obsidian callouts.

## Installation

1. **Download the latest release** from the Releases page
2. **Copy `main.js`, `manifest.json`, and `styles.css`** to `<your-vault>/.obsidian/plugins/scholia/`
3. **Enable the plugin** in Obsidian: Settings → Community Plugins → Scholia

Or use the development version:

```bash
npm install
npm run build
# Then symlink: scripts/install-to-vault.sh
```

## Configuration

Open **Settings → Scholia** to configure:

| Setting                  | Description                           | Default                         |
| ------------------------ | ------------------------------------- | ------------------------------- |
| OpenRouter API Key       | Your OpenRouter API key               | (required)                      |
| Default Model            | OpenRouter model slug                 | `z-ai/glm-5.1`                  |
| Default Temperature      | LLM temperature (0.0–2.0)             | `0.7`                           |
| Default Token Budget     | Maximum output token budget           | `30000`                         |
| Default Reasoning        | Enable reasoning for runs by default  | `true`                          |
| Default Reasoning Effort | Reasoning strength when enabled       | `medium`                        |
| Templates Folder         | Where your templates live             | `Edu-Templates`                 |
| Central Capture File     | Default capture destination           | `_System/Central-Flashcards.md` |
| Default Callout Type     | Visual style for responses            | `ai`                            |
| Hot-reload templates     | Update commands when templates change | `true`                          |
| Debug logging            | Log to developer console              | `false`                         |

## Writing a Template

Templates live in your `Edu-Templates` folder (or whatever you configured). Each template is a markdown file with YAML frontmatter:

```yaml
---
# Required
context_scope: selection # selection | heading | full-note
output_destination: inline # inline | <relative-path.md>

# LLM options (optional — falls back to global settings)
model: z-ai/glm-5.1
temperature: 0.7
token_budget: 30000
reasoning: true
reasoning_effort: medium

# Callout styling (optional)
callout_type: scholia-clarify # ai | faq | scholia-clarify | scholia-example | scholia-flashcard
callout_label: "AI Clarification"
callout_folded: true

# UX behavior (optional)
requires_selection: true
command_prefix: "Run"

# Capture to central file (optional)
also_append_to: "_System/Central-Flashcards.md"
append_format: markdown # markdown | json-line
---
Your system prompt goes here. The user's selected text (or heading/section) becomes the user message.
```

### Example Templates

**Clarify.md** — explain a selection in plain language:

```yaml
---
context_scope: selection
output_destination: inline
callout_type: scholia-clarify
callout_label: "AI Clarification"
callout_folded: true
requires_selection: true
---
You are a patient tutor. Explain the selection below in plain language suitable for an undergraduate. Be concise (≤120 words). Do not restate the selection.
```

**Flashcard.md** — create a flashcard from a selection:

```yaml
---
context_scope: selection
output_destination: inline
callout_type: scholia-flashcard
callout_label: "Flashcard"
callout_folded: true
also_append_to: "_System/Central-Flashcards.md"
append_format: markdown
---
Convert the selection into one Anki-style flashcard. Output exactly:

Q: <single-sentence question>
A: <single-sentence answer>
```

**Real-World Example.md** — illustrate a heading section:

```yaml
---
context_scope: heading
output_destination: inline
callout_type: scholia-example
callout_label: "Real-world example"
callout_folded: true
---
Using the section context below, provide one concrete real-world example that illustrates the concept. Keep it under 100 words.
```

**Scholia Note.md** — create a general-purpose study note from a selection:

```yaml
---
context_scope: heading
output_destination: inline
custom_probe: true
callout_type: ai
callout_label: "Scholia Note"
callout_folded: true
requires_selection: false
---
You are a helpful study partner. Use the provided note context and the user's prompt to produce a concise scholia note that captures the key idea, important nuance, and why it matters. Keep it readable and well-structured without repeating the source text verbatim.
```

### Custom Probe Template

For free-form questions, use `custom_probe: true`:

```yaml
---
context_scope: heading
output_destination: inline
custom_probe: true
callout_type: ai
callout_label: "Custom Probe"
callout_folded: true
---
You are a helpful study partner. Use the provided section context to answer the user's question below.
```

When triggered, a modal appears letting the user type a custom query. The query is appended to the system prompt and sent to the LLM.

## Commands

Once templates are in place, Scholia registers commands in the **Command Palette**. Look for commands prefixed with your `command_prefix` setting (default: "Run").

Commands are also accessible from:

- **Command Palette** (`Ctrl/Cmd+P`)
- **Mobile Toolbar** (when enabled)
- **Hotkeys** (if configured in template frontmatter)

## Callout Types

Scholia ships with five custom callout styles:

| Type                | Color        | Use                  |
| ------------------- | ------------ | -------------------- |
| `ai`                | muted purple | General AI responses |
| `faq`               | muted violet | Q&A content          |
| `scholia-clarify`   | slate blue   | Explanations         |
| `scholia-example`   | ochre        | Real-world examples  |
| `scholia-flashcard` | sage green   | Flashcards           |
| `scholia-error`     | muted red    | Error messages       |

All callouts work in both light and dark themes.

## How It Works

1. **Select text** (or place cursor in a heading/section)
2. **Run a Scholia command** from palette, toolbar, or hotkey
3. **AI response streams** into a collapsible callout inserted below your selection
4. **If configured**, the response is also appended to a central capture file

The plugin uses OpenRouter for LLM access. Your API key is stored locally in Obsidian's plugin data.

## Uninstalling

1. Disable the plugin in Settings → Community Plugins
2. Remove the plugin folder: `<vault>/.obsidian/plugins/scholia/`
3. Templates in `Edu-Templates/` are just regular markdown files — delete them if you no longer need them

## Troubleshooting

**No commands appearing?**

- Make sure your templates folder contains `.md` files with valid frontmatter
- Check the console for template validation errors (`Ctrl/Cmd+Shift+I`)

**Streaming is slow?**

- Check your network connection
- Try a lower `token_budget` or reduce reasoning effort

**API errors?**

- Verify your OpenRouter API key is correct in Settings
- Check that you have credits in your OpenRouter account

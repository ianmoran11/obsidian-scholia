# Scholia Implementation Plan

This plan is intended as handoff guidance for another LLM implementing the next Scholia features. The repository is an Obsidian plugin written in TypeScript. The most relevant files are:

- `src/templates/registry.ts`: registers template commands, opens the run modal, builds `LlmRequest`, and chooses inline vs append output.
- `src/stream/callout.ts` and `src/stream/stream.ts`: create and mutate inline Scholia callouts while responses stream.
- `src/llm/openrouter.ts`, `src/llm/client.ts`, and `src/llm/sse.ts`: call OpenRouter and parse streaming chat completion chunks.
- `src/settings.ts`: stores plugin settings and renders the settings tab.
- `src/ui/modal.ts`: captures custom questions, context scope, reasoning, and token budget.
- `src/storage/appendFile.ts` and `src/commands/capture.ts`: append generated content to a central note or capture store.
- `test/unit/*`: Vitest coverage for current callout, stream, modal, template, LLM, and storage behavior.

Before implementing, preserve existing local user files and avoid broad refactors. The safest approach is to add small modules for metadata, callout parsing, regeneration, chat append, TTS, and spaced-repetition formatting, then wire those modules into `TemplateRegistry`.

## Shared Foundation

Several tasks need the plugin to understand an existing Scholia callout after it has been written. Implement this foundation first.

Why it is needed:

- Regeneration, chat followups, metadata updates, and spaced-repetition formatting all need stable callout boundaries and run metadata.
- Current streaming only tracks a callout while the stream is active. After generation finishes, Scholia has no durable identifier or structured metadata in the note.

How to implement:

- Add `src/stream/calloutParser.ts` with helpers to locate the Scholia callout at a cursor position or selection range.
- Detect Scholia callouts primarily by a durable Scholia-owned marker inside the callout, not by a fixed list of callout types. Templates may define arbitrary valid `callout_type` values, so callout type should be treated as display data only.
- Use callout header matching only as a fallback for legacy callouts that do not yet contain metadata. The fallback can recognize known types such as `[!ai]`, `[!scholia-clarify]`, `[!scholia-example]`, `[!scholia-flashcard]`, and `[!scholia-pending]`.
- Return `{ startLine, endLine, startOffset, endOffset, header, body, calloutType, runSnapshot }`.
- Add a stable HTML comment inside each generated callout with a structured JSON run snapshot. Keep it compact and single-line so it can be parsed safely:

  ```md
  > <!-- scholia:run {"id":"scholia-...","schemaVersion":1,"templatePath":"Edu-Templates/Scholia Note.md","templateName":"Scholia Note","sourcePath":"Reading/Sample Chapter.md","question":"...","contextScope":"heading","model":"z-ai/glm-5.1","temperature":0.7,"maxTokens":30000,"reasoningEnabled":true,"reasoningEffort":"medium","calloutType":"ai","calloutLabel":"Scholia Note","createdAt":"2026-05-03T00:00:00.000Z"} -->
  ```

- The run snapshot should contain everything needed to replay or continue a run:
  - id and schema version
  - template path and template name
  - source path
  - user question, if any
  - context scope
  - model, temperature, token budget, reasoning enabled, and reasoning effort
  - callout type, label, folded state, and output destination
  - timestamps for created and last regenerated, if available
- Add a visible metadata block convention that is easy for Markdown users to read and easy for code to update:

  ```md
  > **Metadata:** model=z-ai/glm-5.1; tokens=1234; cost=$0.0012; duration=4.2s
  ```

- Prefer small serialization helpers over ad hoc string replacement throughout the codebase. Escape JSON for HTML comments and add parser tests for malformed or missing snapshots.
- Add tests in `test/unit/calloutParser.test.ts` for folded callouts, nested quoted content, cursor-at-boundary cases, and callouts followed by normal Markdown.

## Tasks

### - [x] Scholia: record price, tokens, etc and include metadata

Add information on the tokens used, costs, and other metadata associated with Scholia generation.

Why this is needed:

- Users need to understand the cost and size of generated notes, especially with high token budgets and reasoning-enabled models.
- Metadata makes later regeneration auditable: future runs can show which model, prompt, context scope, temperature, reasoning effort, and token budget produced the content.
- Capture files and future analytics need structured generation records.

How to implement:

- Extend `LlmClient` so streaming can return both content chunks and a final usage summary. A practical shape is:

  ```ts
  export type LlmStreamEvent =
    | { type: "content"; text: string }
    | { type: "metadata"; usage?: LlmUsage; cost?: LlmCost; providerRaw?: unknown };
  ```

- Update `OpenRouterClient.stream` to request usage data from OpenRouter if supported. OpenRouter streaming responses may include usage or accounting data near the end of the stream depending on API options and model support, so the implementation should tolerate missing fields.
- Extend `parseSseStream` to preserve final non-content payload data instead of only yielding `choices[0].delta.content`.
- Define `LlmUsage` with `promptTokens`, `completionTokens`, `totalTokens`, and optional reasoning/cache fields if available.
- Define `LlmRunMetadata` with:
  - run id and timestamp
  - model
  - temperature
  - max tokens / token budget
  - reasoning enabled and effort
  - context scope
  - template name
  - prompt token count, completion token count, total tokens
  - estimated or reported cost
  - duration milliseconds
  - provider name (`openrouter`)
- In `TemplateRegistry.runInline`, collect metadata while streaming and write a final metadata line into the callout before changing the pending callout type to the final type.
- In `CaptureRunner.runWithCapture` and `runAppend`, store the same metadata in appended Markdown or JSON-line captures.
- If exact cost is unavailable, display `cost=unavailable` rather than inventing a value. If OpenRouter returns a precise charge, use it. If only pricing and token counts are available, label the result as estimated.
- Add a setting such as `showRunMetadata: boolean`, default `true`, so users can hide metadata in callouts while still recording it in machine-readable comments or JSON captures.
- Tests:
  - `test/unit/sse.test.ts`: parses content plus final usage payload.
  - `test/unit/openrouter.test.ts`: sends the correct request option for usage if required.
  - `test/unit/callout.test.ts`: formats metadata lines safely inside callouts.
  - `test/unit/capture.test.ts`: appends metadata to Markdown and JSON-line captures.

### - [ ] Scholia: repeat questions in callout, not just context

Questions that allow user input do not currently record the question in the callout box. The question should be included.

Why this is needed:

- Custom-probe responses are hard to understand later because the visible callout contains context and response but not the user's actual question.
- This is especially important once chat followups and regeneration exist; each answer must be tied to the prompt that caused it.

How to implement:

- Extend `BuildSkeletonOpts` in `src/stream/callout.ts` with optional `questionText?: string`.
- When `effectiveConfig.customProbe` is true, pass `result.query` from `TemplateRegistry.runTemplateCommand` into `runInline`.
- Update `buildSkeleton` to include a visible question section before the response:

  ```md
  > **Question:** ...
  >
  > **Response:**
  ```

- Preserve the existing context section. If there is no selection/context preview, still show the question.
- Sanitize newlines in the question using the same blockquote-prefixing behavior used for context and streamed chunks.
- For non-custom templates, omit the question section unless future frontmatter explicitly supplies one.
- Update `CaptureRunner` and append output to include question metadata if the generated content is also captured centrally.
- Tests:
  - `test/unit/callout.test.ts`: skeleton includes a question for custom-probe runs and omits it otherwise.
  - `test/unit/registry.test.ts` or modal-related tests: custom probe passes the query into inline generation.

### - [x] Scholia: add regenerate option

Add a button that regenerates the content.

Why this is needed:

- Users frequently want a better or shorter answer without rebuilding the prompt manually.
- Regeneration becomes reliable only if the original template, question, context scope, and run options are recorded with the callout.

How to implement:

- Add a shared regeneration service that can be invoked by both a UI button and a command named something like `Scholia: Regenerate current callout`.
- Add a visible regenerate button for generated Scholia callouts. Prefer an Obsidian-supported Markdown post processor or rendered-callout action in reading mode, and provide the command-palette command as the source-mode/mobile fallback. Both entry points must call the same regeneration service.
- The button should appear only for callouts with a valid `scholia:run` snapshot. If the current mode cannot render an inline button, the command should still work when the cursor is inside the callout.
- When invoked:
  - Use `calloutParser` to find the callout containing the cursor or selection.
  - Read the embedded Scholia comment and visible sections to recover template name, question, source path, context scope, and run options.
  - Re-extract fresh context from the current note using the stored context scope. This is usually better than reusing stale context because the source note may have changed.
  - Re-run the same template via a new internal method such as `TemplateRegistry.runResolvedRequest(...)`.
  - Replace only the response and metadata sections inside the existing callout. Preserve the header, question, and context sections unless the user changes the question.
- Use the same streaming code path as first-generation inline output. Avoid creating a parallel streaming implementation.
- During regeneration, temporarily set the callout type to `scholia-pending` and restore it to the configured final type at completion.
- Add cancellation behavior consistent with current streams: if the user edits inside the callout while regeneration streams, abort with a visible error.
- Tests:
  - `calloutParser` can find and split response sections.
  - Regeneration replacement preserves question/context and only changes response/metadata.
  - External edits inside the regenerating callout abort the stream.

### - [x] Scholia: allow for chat

If the user's cursor or selection is in the Scholia callout box, treat the question as a followup to the current callout and append the question and response to the existing content within the callout box.

Why this is needed:

- Scholia should support an iterative study flow: ask a clarifying question, read the answer, then ask a followup without creating disconnected callouts.
- Keeping the conversation in one callout preserves context and makes the note easier to review.

How to implement:

- Reuse `calloutParser` to detect when the cursor or selected text is inside a Scholia callout.
- In `TemplateRegistry.runTemplateCommand`, after the modal returns a custom-probe question, check whether the cursor is inside a Scholia callout.
- If inside a callout, switch to a chat-followup path instead of inserting a new skeleton.
- Build the LLM request from:
  - the template's system prompt
  - the current note context outside or around the callout
  - the prior callout content as conversation history
  - the new followup question
- Do not blindly send the entire note if the callout is large. Add a helper that strips metadata/comments and uses only the current callout conversation plus the selected context scope.
- Append inside the existing callout in this shape:

  ```md
  > ---
  > **Follow-up:** ...
  >
  > **Response:**
  > ...
  ```

- Stream the followup response at the end of the existing callout and update metadata after completion. The metadata can either be per-turn or cumulative. Prefer per-turn metadata so users can see which followup was expensive.
- If the cursor is not in a Scholia callout, keep current behavior and create a new callout.
- Add a setting such as `chatFollowupsEnabled: boolean`, default `true`.
- Tests:
  - detects cursor inside and outside callouts
  - appends followup sections without breaking blockquote syntax
  - sends prior question/response content in the followup request
  - handles multiple followups in one callout

### - [ ] Scholia: add audio option

Use a DeepInfra API key to optionally generate TTS audio that reads out the content of the note.

Why this is needed:

- Audio playback supports review while walking, commuting, or studying away from the screen.
- TTS is useful for generated notes and flashcards, especially when Scholia is used as a study assistant.

How to implement:

- Add settings in `src/settings.ts`:
  - `deepInfraApiKey: string`
  - `enableAudioGeneration: boolean`
  - `ttsModel: string`
  - `ttsVoice: string`
  - `audioOutputFolder: string`, default `_System/Scholia Audio`
- Add `src/audio/deepinfra.ts` with a small client responsible for TTS requests. Keep it independent from `OpenRouterClient`.
- Confirm DeepInfra's current TTS endpoint and payload shape from official DeepInfra docs before coding. The implementation should handle binary audio responses and JSON error responses.
- Add `src/audio/storage.ts` to save returned audio as an Obsidian `ArrayBuffer` using `vault.createBinary` or `vault.modifyBinary`.
- Generate stable filenames using note basename, callout id, and timestamp, for example `_System/Scholia Audio/My Note/scholia-20260503-153012.mp3`.
- Add a command such as `Scholia: Generate audio for current note/callout`.
- If the cursor is inside a Scholia callout, read only that callout's response/followups. Otherwise, read the current note with frontmatter, comments, and existing audio embeds stripped.
- Insert audio differently depending on scope.
- For callout-level audio, insert or update a blockquoted audio line inside the Scholia callout:

  ```md
  > **Audio:** ![[scholia-20260503-153012.mp3]]
  ```

- For whole-note audio, insert or update an unquoted note-level section:

  ```md
  ## Scholia Audio

  ![[scholia-20260503-153012.mp3]]
  ```

- Do not use blockquote syntax for whole-note audio unless the user explicitly requested the audio embed inside a callout.
- Respect a reasonable character limit and show a Notice if the note is too long. If needed, split text into chunks and concatenate only if DeepInfra and browser playback support the selected format safely.
- Never send the DeepInfra key to OpenRouter or include it in generated Markdown.
- Tests:
  - TTS client builds request headers without exposing keys.
  - audio text extraction strips callout metadata and Markdown comments.
  - storage creates folders and writes binary data.
  - command inserts audio embed in the expected place.

### - [ ] Scholia: integrate with Obsidian "Spaced Repetition" plugin

Ensure Scholia integrates well with the Spaced Repetition plugin.

Why this is needed:

- Scholia can generate flashcards, but they should be formatted so existing spaced-repetition workflows can discover and schedule them.
- Users should not have to manually reformat generated flashcards before review.

How to implement:

- Research the current Spaced Repetition plugin card syntax and settings before implementing. Common patterns include flashcards using `Question::Answer`, multiline cards, cloze deletions, tags, and optional scheduling metadata. Confirm against the plugin's documentation or installed plugin files.
- Add template-level options to `RawTemplateFrontmatter` and `TemplateConfig`, for example:
  - `spaced_repetition: boolean`
  - `sr_format: "basic" | "multiline" | "cloze"`
  - `sr_deck?: string`
  - `sr_tags?: string[]`
- Update the sample `Flashcard` template in `src/settings.ts` to produce SR-compatible output when enabled.
- Prefer deterministic formatting after generation rather than relying solely on the model. For example, parse generated `Q:` and `A:` lines and convert them to the configured SR format.
- Add `src/spacedRepetition/format.ts` with helpers such as `formatBasicCard(question, answer, options)`.
- For central capture files, ensure appended flashcards remain valid SR cards. Do not wrap SR cards inside a blockquote if the Spaced Repetition plugin cannot parse blockquoted cards.
- For inline callouts, keep the human-readable callout, but optionally append a hidden or separate SR-compatible card outside the callout if needed.
- Add a setting such as `spacedRepetitionIntegrationEnabled: boolean`, default `false` unless the output format is fully verified.
- If possible, detect whether the Spaced Repetition plugin is enabled through Obsidian's internal plugin registry, but make formatting useful even without detection.
- Tests:
  - frontmatter parser accepts and validates SR options.
  - formatter converts `Q:`/`A:` output to the documented SR syntax.
  - append-to-central writes parseable cards.
  - inline output does not break existing callout rendering.

## Suggested Implementation Order

1. Add callout parsing and durable callout metadata comments.
2. Show custom-probe questions in callouts.
3. Record usage/cost metadata for completed runs.
4. Add regeneration using the parser and stored metadata.
5. Add chat followups inside existing callouts.
6. Add Spaced Repetition formatting and central-capture compatibility.
7. Add DeepInfra TTS as a separate optional integration.

This order keeps the riskiest interactive features dependent on tested callout parsing rather than repeated cursor/string hacks.

## Verification Checklist

- Run `npm test` after each feature slice.
- Run `npm run build` before handoff.
- Add unit tests beside the modules being changed.
- Manually test in Obsidian source mode and reading mode where possible.
- Verify mobile toolbar / command palette behavior is still intact.
- Verify generated callouts remain valid Markdown blockquotes after multiline questions, multiline responses, errors, and user edits.
- Verify API keys are stored only in plugin data and never written into notes, metadata comments, capture files, or logs.

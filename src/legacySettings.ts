import { Notice, normalizePath, type Plugin } from "obsidian";
import { DEFAULT_SETTINGS, type ScholiaSettings } from "./settings";

type Validator<T> = (value: unknown) => value is T;
const string: Validator<string> = (value): value is string =>
  typeof value === "string";
const boolean: Validator<boolean> = (value): value is boolean =>
  typeof value === "boolean";
const number: Validator<number> = (value): value is number =>
  typeof value === "number" && Number.isFinite(value);

// An explicit, exhaustive allowlist: never copy arbitrary keys or retired settings.
const validators: {
  [K in keyof ScholiaSettings]: Validator<ScholiaSettings[K]>;
} = {
  llmBackend: (value): value is ScholiaSettings["llmBackend"] =>
    value === "openrouter" || value === "pi",
  piBridgeUrl: string,
  piBridgeToken: string,
  piModel: string,
  openRouterApiKey: string,
  defaultModel: string,
  defaultTemperature: number,
  defaultMaxTokens: number,
  defaultReasoningEnabled: boolean,
  defaultReasoningEffort: (
    value,
  ): value is ScholiaSettings["defaultReasoningEffort"] =>
    typeof value === "string" &&
    ["none", "minimal", "low", "medium", "high", "xhigh"].includes(value),
  templatesFolder: string,
  centralCaptureFile: string,
  defaultCalloutType: string,
  debugLogging: boolean,
  enableHotReloadOfTemplates: boolean,
  showRunMetadata: boolean,
  chatFollowupsEnabled: boolean,
  spacedRepetitionIntegrationEnabled: boolean,
};

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

function isOurLegacyManifest(value: unknown): boolean {
  return (
    isRecord(value) &&
    value.id === "scholia" &&
    value.name === "Scholia" &&
    value.author === "Scholia" &&
    value.description === "Active-reading AI annotations for Obsidian." &&
    value.isDesktopOnly === false &&
    typeof value.version === "string" &&
    /^0\.1\.(?:[0-9]|1[0-9]|2[0-2])$/.test(value.version)
  );
}

function validatedSettings(value: unknown): Partial<ScholiaSettings> {
  const result: Partial<ScholiaSettings> = {};
  if (!isRecord(value)) return result;
  for (const key of Object.keys(validators) as (keyof ScholiaSettings)[]) {
    const copy = <K extends keyof ScholiaSettings>(key: K) => {
      const candidate = value[key];
      if (
        Object.prototype.hasOwnProperty.call(value, key) &&
        validators[key](candidate)
      ) {
        result[key] = candidate;
      }
    };
    copy(key);
  }
  return result;
}

/** Called only when the NEW plugin has no saved data. Never writes the source. */
export async function migrateLegacySettings(
  plugin: Pick<Plugin, "app" | "saveData">,
  isUnloaded: () => boolean,
): Promise<ScholiaSettings | undefined> {
  const { adapter, configDir } = plugin.app.vault;
  const folder = normalizePath(`${configDir}/plugins/scholia`);
  try {
    if (isUnloaded()) return;
    const exists = await adapter.exists(folder);
    if (isUnloaded() || !exists) return;
    const manifestExists = await adapter.exists(`${folder}/manifest.json`);
    if (isUnloaded()) return;
    if (!manifestExists) throw new Error("Missing legacy manifest");
    const manifestText = await adapter.read(`${folder}/manifest.json`);
    if (isUnloaded()) return;
    if (!isOurLegacyManifest(JSON.parse(manifestText)))
      throw new Error("Unverified source");
    // Do not even read data from the unrelated community-store Scholia plugin.
    const dataExists = await adapter.exists(`${folder}/data.json`);
    if (isUnloaded()) return;
    if (!dataExists) throw new Error("Missing legacy settings");
    const dataText = await adapter.read(`${folder}/data.json`);
    if (isUnloaded()) return;
    const validated = validatedSettings(JSON.parse(dataText));
    if (Object.keys(validated).length === 0)
      throw new Error("No valid legacy settings");
    const settings = { ...DEFAULT_SETTINGS, ...validated };
    await plugin.saveData(settings);
    if (isUnloaded()) return;
    new Notice(
      "Scholia Reader: copied legacy plugin settings. Disable old Scholia, verify the copied settings and templates, and only then uninstall the old copy. Reassign command hotkeys and mobile toolbar bindings if needed.",
      20000,
    );
    return settings;
  } catch {
    // No settings, tokens, source text or underlying error messages in notices/logs.
    // In particular, do not save defaults here: a later load must be able to retry.
    if (!isUnloaded())
      new Notice(
        "Scholia Reader: could not safely copy legacy settings. Keep the old files and backup. Check that the source is your old ianmoran11/obsidian-scholia installation, then disable/re-enable Scholia Reader to retry before changing its settings. No legacy files were changed.",
        20000,
      );
  }
}

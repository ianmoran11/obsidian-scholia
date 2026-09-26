import { beforeEach, describe, expect, it, vi } from "vitest";
vi.mock("obsidian", async (original) => ({
  ...(await original<object>()),
  Plugin: class {},
  normalizePath: (path: string) => path.replace(/\/+/g, "/").replace(/\/$/, ""),
  Notice: vi.fn(),
}));
import { Notice } from "obsidian";
import ScholiaPlugin from "../../src/main";
import { DEFAULT_SETTINGS, type ScholiaSettings } from "../../src/settings";

const manifest = {
  id: "scholia",
  name: "Scholia",
  author: "Scholia",
  description: "Active-reading AI annotations for Obsidian.",
  isDesktopOnly: false,
  version: "0.1.22",
};
const preferences: ScholiaSettings = {
  llmBackend: "pi",
  piBridgeUrl: "https://synthetic.ts.net",
  piBridgeToken: "synthetic-bridge-token",
  piModel: "openai-codex/synthetic",
  openRouterApiKey: "synthetic-api-key",
  defaultModel: "synthetic/model",
  defaultTemperature: 1.2,
  defaultMaxTokens: 4567,
  defaultReasoningEnabled: false,
  defaultReasoningEffort: "high",
  templatesFolder: "My Templates",
  centralCaptureFile: "My Cards.md",
  defaultCalloutType: "scholia-example",
  debugLogging: true,
  enableHotReloadOfTemplates: false,
  showRunMetadata: false,
  chatFollowupsEnabled: false,
  spacedRepetitionIntegrationEnabled: false,
};

function fixture(saved: unknown = null, configDir = ".obsidian") {
  const base = `${configDir}/plugins/scholia`;
  const files = new Map([
    [`${base}/manifest.json`, JSON.stringify(manifest)],
    [`${base}/data.json`, JSON.stringify(preferences)],
  ]);
  const original = new Map(files);
  const plugin = Object.create(ScholiaPlugin.prototype) as ScholiaPlugin;
  const exists = vi.fn(async (path: string) =>
    path === base ? files.size > 0 : files.has(path),
  );
  const read = vi.fn(async (path: string) => {
    if (!files.has(path)) throw new Error("synthetic-secret-in-error");
    return files.get(path)!;
  });
  Object.assign(plugin, {
    app: { vault: { configDir, adapter: { exists, read } } },
    loadData: vi.fn(async () => saved),
    saveData: vi.fn(async (data: unknown) => {
      saved = data;
    }),
  });
  return { plugin, files, original, exists, read, base };
}

beforeEach(() => vi.clearAllMocks());

describe("legacy plugin settings migration", () => {
  it("uses fresh defaults without writing when no legacy folder exists", async () => {
    const { plugin, files, read } = fixture();
    files.clear();
    await plugin.loadSettings();
    expect(plugin.settings).toEqual(DEFAULT_SETTINGS);
    expect(read).not.toHaveBeenCalled();
    expect(plugin.saveData).not.toHaveBeenCalled();
    expect(Notice).not.toHaveBeenCalled();
  });

  it.each([".obsidian", "custom/config"])(
    "copies every meaningful setting and token under %s, once, leaving source untouched",
    async (configDir) => {
      const { plugin, files, original, read, base } = fixture(null, configDir);
      await plugin.loadSettings();
      expect(plugin.settings).toEqual(preferences);
      expect(plugin.saveData).toHaveBeenCalledTimes(1);
      expect(plugin.saveData).toHaveBeenCalledWith(preferences);
      expect(read.mock.calls.map(([path]) => path)).toEqual([
        `${base}/manifest.json`,
        `${base}/data.json`,
      ]);
      expect(files).toEqual(original);
      expect(Notice).toHaveBeenCalledTimes(1);
      expect(
        vi.mocked(plugin.saveData).mock.invocationCallOrder[0],
      ).toBeLessThan(vi.mocked(Notice).mock.invocationCallOrder[0]);
      await plugin.loadSettings();
      expect(plugin.saveData).toHaveBeenCalledTimes(1);
    },
  );

  it("also migrates when new loadData returns undefined", async () => {
    const { plugin } = fixture();
    vi.mocked(plugin.loadData).mockResolvedValue(undefined);
    await plugin.loadSettings();
    expect(plugin.settings).toEqual(preferences);
  });

  it.each([{}, { ...preferences, templatesFolder: "New settings" }, false, ""])(
    "never migrates over existing non-null new data: %j",
    async (saved) => {
      const { plugin, exists } = fixture(saved);
      await plugin.loadSettings();
      expect(plugin.settings).toEqual(
        Object.assign({}, DEFAULT_SETTINGS, saved),
      );
      expect(exists).not.toHaveBeenCalled();
      expect(plugin.saveData).not.toHaveBeenCalled();
    },
  );

  it.each([
    { isDesktopOnly: true, author: "shashanyu", version: "0.2.1" },
    { id: "other" },
    { name: "Other" },
    { author: "Other" },
    { description: "Other" },
    { isDesktopOnly: true },
    { version: "0.1.23" },
    { version: "0.1.022" },
    { version: "0.1.22-beta" },
    { version: "0.2.1" },
    { version: 22 },
  ])("rejects unproven manifest %j before reading data", async (changes) => {
    const { plugin, files, base, read } = fixture();
    files.set(
      `${base}/manifest.json`,
      JSON.stringify({ ...manifest, ...changes }),
    );
    await plugin.loadSettings();
    expect(read).not.toHaveBeenCalledWith(`${base}/data.json`);
    expect(plugin.saveData).not.toHaveBeenCalled();
    expect(plugin.settings).toEqual(DEFAULT_SETTINGS);
  });

  it.each(["0.1.0", "0.1.9", "0.1.10", "0.1.19", "0.1.22"])(
    "accepts known legacy release %s",
    async (version) => {
      const { plugin, files, base } = fixture();
      files.set(
        `${base}/manifest.json`,
        JSON.stringify({ ...manifest, version }),
      );
      await plugin.loadSettings();
      expect(plugin.saveData).toHaveBeenCalledTimes(1);
    },
  );

  it("imports only valid, known own fields, not removed settings or prototype keys", async () => {
    const { plugin, files, base } = fixture();
    files.set(
      `${base}/data.json`,
      '{"openRouterApiKey":"synthetic-key","debugLogging":false,"defaultTemperature":0,"piBridgeToken":42,"templatesFolder":null,"defaultMaxTokens":"400","defaultReasoningEnabled":1,"llmBackend":"other","defaultReasoningEffort":"invalid","unknown":"value","deepInfraApiKey":"retired","__proto__":{"polluted":true},"constructor":"bad"}',
    );
    await plugin.loadSettings();
    expect(plugin.saveData).toHaveBeenCalledWith({
      ...DEFAULT_SETTINGS,
      openRouterApiKey: "synthetic-key",
      defaultTemperature: 0,
    });
    expect(Object.prototype).not.toHaveProperty("polluted");
  });

  it.each([
    "{}",
    "[]",
    "null",
    '"string"',
    '{"unknown":true}',
    '{"defaultTemperature":1e400}',
    '{"debugLogging":"true"}',
  ])("does not import data without valid known keys: %s", async (data) => {
    const { plugin, files, base } = fixture();
    files.set(`${base}/data.json`, data);
    await plugin.loadSettings();
    expect(plugin.saveData).not.toHaveBeenCalled();
    expect(Notice).toHaveBeenCalledTimes(1);
  });

  it.each([
    "manifest parse",
    "data parse",
    "missing manifest",
    "missing data",
    "exists",
    "read",
    "save",
  ])(
    "safely retries after %s failure without saving defaults or exposing secrets",
    async (failure) => {
      const { plugin, files, original, base, exists, read } = fixture();
      if (failure === "manifest parse")
        files.set(`${base}/manifest.json`, "synthetic-secret");
      if (failure === "data parse")
        files.set(`${base}/data.json`, "synthetic-secret");
      if (failure === "missing manifest") files.delete(`${base}/manifest.json`);
      if (failure === "missing data") files.delete(`${base}/data.json`);
      if (failure === "exists")
        exists.mockRejectedValueOnce(new Error("synthetic-secret"));
      if (failure === "read")
        read.mockRejectedValueOnce(new Error("synthetic-secret"));
      if (failure === "save")
        vi.mocked(plugin.saveData).mockRejectedValueOnce(
          new Error("synthetic-secret"),
        );
      await plugin.loadSettings();
      expect(plugin.settings).toEqual(DEFAULT_SETTINGS);
      expect(plugin.saveData).toHaveBeenCalledTimes(failure === "save" ? 1 : 0);
      expect(JSON.stringify(vi.mocked(Notice).mock.calls)).not.toContain(
        "synthetic-secret",
      );
      expect(vi.mocked(Notice).mock.calls[0][0]).toContain("retry");
      for (const [path, text] of original) files.set(path, text);
      await plugin.loadSettings();
      expect(plugin.settings).toEqual(preferences);
      expect(files).toEqual(original);
    },
  );

  it.each([
    "loadData",
    "folder exists",
    "manifest exists",
    "manifest read",
    "data exists",
    "data read",
    "saveData",
  ])(
    "unload during %s prevents subsequent writes and notices",
    async (stage) => {
      const { plugin, exists, read } = fixture();
      let release!: (value: any) => void;
      const pending = new Promise<any>((resolve) => {
        release = resolve;
      });
      let reached!: () => void;
      const atAwait = new Promise<void>((resolve) => {
        reached = resolve;
      });
      const pause = () => {
        reached();
        return pending;
      };
      let result: unknown;
      if (stage === "loadData")
        vi.mocked(plugin.loadData).mockImplementationOnce(pause);
      if (stage === "folder exists") {
        exists.mockImplementationOnce(pause);
        result = true;
      }
      if (stage === "manifest exists") {
        exists.mockResolvedValueOnce(true).mockImplementationOnce(pause);
        result = true;
      }
      if (stage === "manifest read") {
        read.mockImplementationOnce(pause);
        result = JSON.stringify(manifest);
      }
      if (stage === "data exists") {
        exists
          .mockResolvedValueOnce(true)
          .mockResolvedValueOnce(true)
          .mockImplementationOnce(pause);
        result = true;
      }
      if (stage === "data read") {
        read
          .mockResolvedValueOnce(JSON.stringify(manifest))
          .mockImplementationOnce(pause);
        result = JSON.stringify(preferences);
      }
      if (stage === "saveData")
        vi.mocked(plugin.saveData).mockImplementationOnce(pause);
      const loading = plugin.loadSettings();
      await atAwait;
      plugin.onunload();
      release(result);
      await loading;
      expect(plugin.saveData).toHaveBeenCalledTimes(
        stage === "saveData" ? 1 : 0,
      );
      expect(Notice).not.toHaveBeenCalled();
      expect(plugin.settings).toBeUndefined();
    },
  );
});

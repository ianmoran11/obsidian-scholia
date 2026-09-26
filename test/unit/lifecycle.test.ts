import { expect, it, vi } from "vitest";
vi.mock("obsidian", async (original) => ({
  ...(await original<object>()),
  Plugin: class {},
}));
import ScholiaPlugin from "../../src/main";
import { StreamManager } from "../../src/stream/manager";

it("plugin unload disposes its generation manager", () => {
  const plugin = Object.create(ScholiaPlugin.prototype) as ScholiaPlugin;
  plugin.streamManager = new StreamManager({ app: {} as any });
  const controller = new AbortController();
  plugin.streamManager.track(controller);
  plugin.onunload();
  expect(controller.signal.aborted).toBe(true);
  expect(plugin.streamManager.isDisposed).toBe(true);
});

it("unload during startup prevents late initialization", async () => {
  const plugin = Object.create(ScholiaPlugin.prototype) as ScholiaPlugin;
  let release!: () => void;
  plugin.loadSettings = () => new Promise<void>((r) => (release = r));
  const init = plugin.onload();
  plugin.onunload();
  release();
  await init;
  expect(plugin.streamManager).toBeUndefined();
});

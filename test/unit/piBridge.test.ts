import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
const { http } = vi.hoisted(() => ({ http: vi.fn() }));
vi.mock("obsidian", async (original) => ({
  ...(await original<object>()),
  requestUrl: http,
}));
import { PiBridgeClient, validateBridgeUrl } from "../../src/llm/piBridge";
import {
  applyBackend,
  backendError,
  createLlmClient,
  resolveModel,
} from "../../src/llm/provider";
import { DEFAULT_SETTINGS } from "../../src/settings";
import { OpenRouterClient } from "../../src/llm/openrouter";
import { buildRunMetadata } from "../../src/llm/metadata";
import type { LlmRequest, LlmStreamEvent } from "../../src/llm/client";

const token = "b".repeat(43);
const model = "openai-codex/test-model";
const request: LlmRequest = {
  model,
  system: "Study prompt",
  user: "Note context",
  temperature: 0.7,
  maxTokens: 30000,
  reasoningEnabled: true,
  reasoningEffort: "high",
};
const health = {
  version: 1,
  instanceId: "instance-1",
  models: [model],
  authReady: true,
};
const response = (json: unknown, status = 200) => ({ status, json });
const client = () => new PiBridgeClient(token, "https://mac.tailnet.ts.net");
const consume = async (generator: AsyncGenerator<LlmStreamEvent>) => {
  const events: LlmStreamEvent[] = [];
  for await (const event of generator) events.push(event);
  return events;
};

beforeEach(() => {
  http.mockReset();
});
afterEach(() => {
  vi.useRealTimers();
});

describe("Pi bridge mobile transport", () => {
  it("tests connection without generating; rejects insecure or credential-bearing URLs", async () => {
    http.mockResolvedValue(response(health));
    expect(await client().testConnection()).toEqual(health);
    expect(http).toHaveBeenCalledTimes(1);
    expect(http.mock.calls[0][0].url).toMatch(/\/v1\/health$/);
    expect(validateBridgeUrl("http://127.0.0.1:3210/")).toBe(
      "http://127.0.0.1:3210",
    );
    for (const url of [
      "http://mac.local:3210",
      "https://token@mac",
      "https://mac/path",
      "https://mac?token=x",
      "ftp://mac",
    ]) {
      expect(() => validateBridgeUrl(url)).toThrow();
    }
    expect(() => new PiBridgeClient("weak", "https://mac")).toThrow(/token/);
  });

  it("retries uncertain POST with the same ID and returns each recovered delta exactly once", async () => {
    vi.useFakeTimers();
    const posts: any[] = [];
    let polls = 0;
    let id = "";
    http.mockImplementation(async (opts: any) => {
      if (opts.url.endsWith("/health")) return response(health);
      if (opts.method === "POST") {
        posts.push(JSON.parse(opts.body));
        id = posts[0].id;
        if (posts.length === 1)
          throw new Error("response lost AFTER server accepted");
        return response({ id }, 200);
      }
      if (opts.method === "DELETE") return response({ id });
      polls++;
      if (polls === 1)
        return response({
          id,
          state: "running",
          offset: 0,
          text: "First ",
          nextOffset: 6,
        });
      if (polls === 2) throw new Error("phone offline");
      expect(opts.url).toContain("offset=6");
      return response({
        id,
        state: "complete",
        offset: 6,
        text: "second",
        nextOffset: 12,
        usage: { totalTokens: 14 },
      });
    });
    const result = consume(
      client().stream(request, new AbortController().signal),
    );
    await vi.runAllTimersAsync();
    expect(await result).toEqual([
      { type: "content", text: "First " },
      { type: "content", text: "second" },
      { type: "metadata", usage: { totalTokens: 14 } },
    ]);
    expect(posts).toHaveLength(2);
    expect(posts[0]).toEqual(posts[1]);
    expect(posts[0].request).toEqual({
      model,
      system: request.system,
      user: request.user,
      thinking: "medium",
    });
    expect(posts[0].instanceId).toBe("instance-1");
    expect(
      http.mock.calls.filter(([opts]) => opts.method === "DELETE"),
    ).toHaveLength(0);
  });

  it.each([401, 409, 410, 429, 503])(
    "does not retry terminal HTTP %s or start a replacement",
    async (status) => {
      let id = "";
      http.mockImplementation(async (opts: any) => {
        if (opts.url.endsWith("/health")) return response(health);
        if (opts.method === "POST") {
          id = JSON.parse(opts.body).id;
          return response({ id }, 202);
        }
        if (opts.method === "DELETE") return response({ id });
        return response({}, status);
      });
      await expect(
        consume(client().stream(request, new AbortController().signal)),
      ).rejects.toThrow();
      expect(
        http.mock.calls.filter(([opts]) => opts.method === "POST"),
      ).toHaveLength(1);
    },
  );

  it("aborts during an outstanding poll and sends explicit cancellation", async () => {
    const controller = new AbortController();
    let id = "";
    let release: (value: unknown) => void = () => {};
    let entered: () => void = () => {};
    const polling = new Promise<void>((resolve) => {
      entered = resolve;
    });
    http.mockImplementation(async (opts: any) => {
      if (opts.url.endsWith("/health")) return response(health);
      if (opts.method === "POST") {
        id = JSON.parse(opts.body).id;
        return response({ id });
      }
      if (opts.method === "DELETE") return response({ id });
      entered();
      return new Promise((resolve) => {
        release = resolve;
      });
    });
    const result = consume(client().stream(request, controller.signal));
    const rejected = expect(result).rejects.toThrow("User edited");
    await polling;
    controller.abort(new Error("User edited"));
    await rejected;
    release(
      response({
        id,
        state: "complete",
        offset: 0,
        text: "must not write",
        nextOffset: 14,
      }),
    );
    expect(http.mock.calls.some(([opts]) => opts.method === "DELETE")).toBe(
      true,
    );
  });

  it("rejects unavailable models before any POST", async () => {
    http.mockResolvedValue(response(health));
    await expect(
      consume(
        client().stream(
          { ...request, model: "openai-codex/missing" },
          new AbortController().signal,
        ),
      ),
    ).rejects.toThrow(/not available/);
    expect(http).toHaveBeenCalledTimes(1);
    await expect(
      consume(
        client().stream(
          { ...request, model: "openai/gpt-test" },
          new AbortController().signal,
        ),
      ),
    ).rejects.toThrow(/openai-codex/);
  });

  it("does not silently accept a corrupt cursor or provider error", async () => {
    let id = "";
    http.mockImplementation(async (opts: any) => {
      if (opts.url.endsWith("/health")) return response(health);
      if (opts.method === "POST") {
        id = JSON.parse(opts.body).id;
        return response({ id });
      }
      if (opts.method === "DELETE") return response({ id });
      return response({
        id,
        state: "complete",
        offset: 0,
        text: "wrong",
        nextOffset: 3,
      });
    });
    await expect(
      consume(client().stream(request, new AbortController().signal)),
    ).rejects.toThrow(/Invalid Pi job/);
  });
});

describe("provider routing and metadata", () => {
  const piSettings = {
    ...DEFAULT_SETTINGS,
    llmBackend: "pi" as const,
    piBridgeToken: token,
    piBridgeUrl: "https://mac.tailnet.ts.net",
    piModel: model,
  };
  it("preserves OpenRouter default, allows Pi without OpenRouter credentials and never falls back", () => {
    expect(DEFAULT_SETTINGS.llmBackend).toBe("openrouter");
    expect(backendError(DEFAULT_SETTINGS)).toContain("OpenRouter API key");
    expect(
      createLlmClient({ ...DEFAULT_SETTINGS, openRouterApiKey: "test" }),
    ).toBeInstanceOf(OpenRouterClient);
    expect(backendError(piSettings)).toBeUndefined();
    expect(createLlmClient(piSettings)).toBeInstanceOf(PiBridgeClient);
    expect(() =>
      createLlmClient({
        ...piSettings,
        piBridgeToken: "",
        openRouterApiKey: "valid",
      }),
    ).toThrow();
  });
  it("uses backend-specific model defaults and rejects cross-provider template/regeneration models", () => {
    expect(resolveModel(piSettings)).toBe(model);
    expect(resolveModel(DEFAULT_SETTINGS)).toBe(DEFAULT_SETTINGS.defaultModel);
    expect(() =>
      resolveModel(piSettings, DEFAULT_SETTINGS.defaultModel),
    ).toThrow(/override/);
    expect(() => resolveModel(DEFAULT_SETTINGS, model)).toThrow(/Pi Codex/);
  });
  it("records Codex provider and medium thinking without unsupported controls or API charge estimates", () => {
    const req = applyBackend(piSettings, request);
    const metadata = buildRunMetadata(req, {
      id: "id",
      timestamp: "now",
      contextScope: "selection",
      templateName: "Study",
      durationMs: 100,
      cost: { amount: 9 },
      usage: { totalTokens: 12 },
    });
    expect(metadata.provider).toBe("openai-codex");
    expect(metadata.reasoningEffort).toBe("medium");
    expect(metadata.totalTokens).toBe(12);
    expect(metadata.cost).toBeUndefined();
    expect(metadata.temperature).toBeUndefined();
    expect(metadata.maxTokens).toBeUndefined();
  });
});

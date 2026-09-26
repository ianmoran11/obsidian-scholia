import { requestUrl } from "obsidian";
import type {
  PiHealth,
  PiJobSnapshot,
  PiRequest,
} from "../../shared/piProtocol";
import type { LlmClient, LlmRequest, LlmStreamEvent } from "./client";

export function validateBridgeUrl(value: string): string {
  let url: URL;
  try {
    url = new URL(value.trim());
  } catch {
    throw new Error("Set a valid Pi bridge HTTPS URL in Settings.");
  }
  const local = ["127.0.0.1", "localhost", "[::1]"].includes(url.hostname);
  if (
    (url.protocol !== "https:" && !(local && url.protocol === "http:")) ||
    url.username ||
    url.password ||
    url.search ||
    url.hash ||
    !["", "/"].includes(url.pathname)
  ) {
    throw new Error(
      "Use a private HTTPS origin (no path/query); HTTP is allowed only on localhost for Mac testing.",
    );
  }
  return url.origin;
}
export function validateBridgeToken(token: string): void {
  if (!/^[A-Za-z0-9_-]{43,}$/.test(token))
    throw new Error(
      "Set the Pi bridge's random access token in Settings (at least 43 URL-safe characters).",
    );
}
class BridgeError extends Error {
  constructor(
    message: string,
    readonly retryable = false,
  ) {
    super(message);
  }
}
function abortError(signal: AbortSignal): Error {
  return signal.reason instanceof Error
    ? signal.reason
    : new Error("Generation cancelled.");
}
function wait(ms: number, signal: AbortSignal): Promise<void> {
  return new Promise((resolve, reject) => {
    const abort = () => {
      clearTimeout(timer);
      reject(abortError(signal));
    };
    const timer = setTimeout(() => {
      signal.removeEventListener("abort", abort);
      resolve();
    }, ms);
    signal.addEventListener("abort", abort, { once: true });
    if (signal.aborted) abort();
  });
}
export class PiBridgeClient implements LlmClient {
  private readonly url: string;
  constructor(
    private token: string,
    url: string,
  ) {
    validateBridgeToken(token);
    this.url = validateBridgeUrl(url);
  }

  private async request(
    path: string,
    method: string,
    signal: AbortSignal,
    data?: unknown,
  ): Promise<unknown> {
    if (signal.aborted) throw abortError(signal);
    // requestUrl works on Android without fetch/CORS streaming assumptions. It cannot be aborted,
    // so race it locally and ignore late responses; DELETE separately stops Mac generation.
    let timer: ReturnType<typeof setTimeout> | undefined;
    let onAbort: () => void = () => {};
    try {
      const response = await Promise.race([
        requestUrl({
          url: `${this.url}${path}`,
          method,
          headers: {
            Authorization: `Bearer ${this.token}`,
            "Content-Type": "application/json",
          },
          body: data === undefined ? undefined : JSON.stringify(data),
          throw: false,
        }),
        new Promise<never>((_, reject) => {
          timer = setTimeout(
            () => reject(new BridgeError("Pi bridge did not respond.", true)),
            15_000,
          );
          onAbort = () => reject(abortError(signal));
          signal.addEventListener("abort", onAbort, { once: true });
        }),
      ]);
      if (signal.aborted) throw abortError(signal);
      if (response.status < 200 || response.status >= 300) {
        const messages: Record<number, string> = {
          400: "Invalid Pi request or unavailable Codex model. Use Test Connection in Settings.",
          401: "Pi bridge token rejected. Check Settings.",
          403: "Pi bridge access denied.",
          409: "Pi bridge restarted or job ID conflicts. Start a new run manually.",
          410: "Pi job missing or expired. No replacement was started; check device clocks and restart manually.",
          413: "Note context is too large for the Pi bridge (512 KiB limit).",
          429: "Pi bridge is busy. Try a new run later.",
          503: "Sign into OpenAI Codex using Pi on the Mac, then try again.",
        };
        throw new BridgeError(
          messages[response.status] ?? `Pi bridge HTTP ${response.status}.`,
          response.status === 502 || response.status === 504,
        );
      }
      return response.json;
    } catch (error) {
      if (signal.aborted) throw abortError(signal);
      if (error instanceof BridgeError) throw error;
      throw new BridgeError(
        "Cannot reach Pi bridge. Check Tailscale and that your Mac is awake.",
        true,
      );
    } finally {
      if (timer) clearTimeout(timer);
      signal.removeEventListener("abort", onAbort);
    }
  }

  async testConnection(
    signal = new AbortController().signal,
  ): Promise<PiHealth> {
    const health = (await this.request(
      "/v1/health",
      "GET",
      signal,
    )) as PiHealth;
    if (
      !health ||
      health.version !== 1 ||
      typeof health.instanceId !== "string" ||
      !Array.isArray(health.models) ||
      !health.models.every(
        (m) => typeof m === "string" && m.startsWith("openai-codex/"),
      )
    )
      throw new BridgeError("Incompatible Pi bridge response.");
    if (!health.authReady)
      throw new BridgeError(
        "Bridge reached. Sign into OpenAI Codex via Pi /login on the Mac.",
      );
    return health;
  }

  async *stream(
    req: LlmRequest,
    signal: AbortSignal,
  ): AsyncGenerator<LlmStreamEvent> {
    if (!/^openai-codex\/[a-zA-Z0-9._-]+$/.test(req.model))
      throw new Error(
        "Pi requires an openai-codex/<model> model, not an OpenRouter slug.",
      );
    const deadline = Date.now() + 15 * 60_000;
    const retry = async <T>(action: () => Promise<T>): Promise<T> => {
      let delay = 750;
      while (true) {
        if (Date.now() >= deadline)
          throw new Error(
            "Pi reconnection deadline exceeded. No replacement job was started.",
          );
        try {
          return await action();
        } catch (error) {
          if (
            signal.aborted ||
            !(error instanceof BridgeError) ||
            !error.retryable
          )
            throw error;
          await wait(delay, signal);
          delay = Math.min(delay * 2, 5000);
        }
      }
    };
    const health = await retry(() => this.testConnection(signal));
    if (!health.models.includes(req.model))
      throw new Error(
        "Codex model not available on the bridge. Use Test Connection in Settings.",
      );
    const id = `${Date.now()}-${crypto.randomUUID()}`;
    const path = `/v1/jobs/${id}`;
    const request: PiRequest = {
      model: req.model,
      system: req.system,
      user: req.user,
      thinking: "medium",
    };
    let completed = false;
    // Abort even during an outstanding HTTP request. DELETE is idempotent; the server deadline
    // remains the final safety net when the phone is offline or killed.
    const cancel = () => {
      void this.request(path, "DELETE", new AbortController().signal).catch(
        () => {},
      );
    };
    signal.addEventListener("abort", cancel, { once: true });
    try {
      await retry(() =>
        this.request("/v1/jobs", "POST", signal, {
          id,
          instanceId: health.instanceId,
          request,
        }),
      );
      let offset = 0;
      while (true) {
        const result = (await retry(() =>
          this.request(`${path}?offset=${offset}`, "GET", signal),
        )) as PiJobSnapshot;
        if (
          !result ||
          result.id !== id ||
          result.offset !== offset ||
          typeof result.text !== "string" ||
          result.nextOffset !== offset + result.text.length ||
          !["running", "complete", "error", "cancelled"].includes(result.state)
        )
          throw new Error("Invalid Pi job response.");
        if (signal.aborted) throw abortError(signal);
        if (result.text) {
          offset = result.nextOffset;
          yield { type: "content", text: result.text };
        }
        if (result.state === "complete") {
          completed = true;
          yield { type: "metadata", usage: result.usage };
          return;
        }
        if (result.state !== "running")
          throw new Error(result.error ?? "Pi generation failed.");
        await wait(750, signal);
      }
    } finally {
      signal.removeEventListener("abort", cancel);
      if (!completed) cancel();
    }
  }
}

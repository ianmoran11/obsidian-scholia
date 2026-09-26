import {
  createAgentSession,
  createExtensionRuntime,
  ModelRuntime,
  SessionManager,
  SettingsManager,
  type ResourceLoader,
  type CreateModelRuntimeOptions,
} from "@earendil-works/pi-coding-agent";
import { join } from "node:path";
import type { GenerationEngine } from "./server.js";
import type { PiUsage } from "../../shared/piProtocol.js";

type CredentialStore = NonNullable<CreateModelRuntimeOptions["credentials"]>;

/** Pinned Pi internal: keep its auth.json lock/refresh implementation, not key resolution. */
export async function oauthCredentials(
  authPath: string,
): Promise<CredentialStore> {
  const entry = import.meta.resolve("@earendil-works/pi-coding-agent");
  const module = await import(new URL("./core/auth-storage.js", entry).href);
  const store = module.AuthStorage?.create?.(authPath) as
    | CredentialStore
    | undefined;
  if (
    !store ||
    typeof store.modify !== "function" ||
    typeof store.list !== "function"
  )
    throw new Error("Incompatible Pi credential store.");
  const provider = "openai-codex";
  return {
    async read(id, options) {
      if (id !== provider) return undefined;
      // modify reads raw data under Pi's lock; undefined means no write. Unlike read(),
      // it never resolves !shell-command API keys. Filter the returned raw credential.
      const value = await store.modify(id, async () => undefined, options);
      return value?.type === "oauth" ? value : undefined;
    },
    async list(options) {
      return (await store.list(options)).filter(
        (v) => v.providerId === provider && v.type === "oauth",
      );
    },
    async modify(id, fn, options) {
      if (id !== provider)
        throw new Error("Only Codex OAuth credentials are supported.");
      const value = await store.modify(
        id,
        async (current) => {
          if (current?.type !== "oauth")
            throw new Error("Codex OAuth login required.");
          const next = await fn(current);
          if (next && next.type !== "oauth")
            throw new Error("Only OAuth refresh is supported.");
          return next;
        },
        options,
      );
      return value?.type === "oauth" ? value : undefined;
    },
    async delete() {
      throw new Error("Manage Codex login using Pi, not the bridge.");
    },
  };
}

/** Full-control loader: intentionally no discovery, packages, tools or project instructions. */
export function isolatedResources(system: string): ResourceLoader {
  const runtime = createExtensionRuntime();
  return {
    getExtensions: () => ({ extensions: [], errors: [], runtime }),
    getSkills: () => ({ skills: [], diagnostics: [] }),
    getPrompts: () => ({ prompts: [], diagnostics: [] }),
    getThemes: () => ({ themes: [], diagnostics: [] }),
    getAgentsFiles: () => ({ agentsFiles: [] }),
    getSystemPrompt: () => system || "You are a helpful reading assistant.",
    getSystemPromptSource: () => undefined,
    getAppendSystemPrompt: () => [],
    getAppendSystemPromptSources: () => [],
    extendResources: () => {},
    reload: async () => {},
  };
}
export async function createPiEngine(
  agentDir: string,
  cwd: string,
): Promise<GenerationEngine> {
  const modelRuntime = await ModelRuntime.create({
    credentials: await oauthCredentials(join(agentDir, "auth.json")),
    modelsPath: null, // Never load custom provider endpoints or credential commands from models.json.
    allowModelNetwork: false,
    refreshOnCreate: false,
  });
  const hasSubscription = async () => {
    const auth = await modelRuntime.checkAuth("openai-codex");
    return (
      auth?.type === "oauth" &&
      modelRuntime.getProvider("openai-codex")?.auth.oauth?.isSubscription ===
        true
    );
  };
  return {
    async health() {
      // Inspect non-secret credential metadata; stream handles refresh through Pi's locked store.
      return {
        authReady: await hasSubscription(),
        models: modelRuntime
          .getModels("openai-codex")
          .map((model) => `openai-codex/${model.id}`),
      };
    },
    async generate(request, signal, onText) {
      signal.throwIfAborted();
      if (
        !request.model.startsWith("openai-codex/") ||
        !(await hasSubscription())
      ) {
        throw new Error("Codex subscription authentication required.");
      }
      const model = modelRuntime.getModel(
        "openai-codex",
        request.model.slice("openai-codex/".length),
      );
      if (!model) throw new Error("Unknown Codex model.");
      const { session } = await createAgentSession({
        cwd,
        agentDir,
        modelRuntime,
        model,
        thinkingLevel: request.thinking,
        tools: [],
        noTools: "all",
        customTools: [],
        resourceLoader: isolatedResources(request.system),
        sessionManager: SessionManager.inMemory(cwd),
        settingsManager: SettingsManager.inMemory({
          defaultTools: [],
          compaction: { enabled: false },
          retry: { enabled: false, provider: { maxRetries: 0 } },
          cacheWarming: "off",
          enableAnalytics: false,
          enableInstallTelemetry: false,
        }),
      });
      const abort = () => {
        void session.abort().catch(() => {});
      };
      let usage: PiUsage | undefined;
      let failed = false;
      const unsubscribe = session.subscribe((event) => {
        if (
          event.type === "message_update" &&
          event.assistantMessageEvent.type === "text_delta"
        ) {
          onText(event.assistantMessageEvent.delta);
        }
        if (
          event.type === "message_end" &&
          event.message.role === "assistant"
        ) {
          const message = event.message;
          if (
            message.stopReason === "error" ||
            message.stopReason === "aborted" ||
            message.stopReason === "toolUse"
          )
            failed = true;
          usage = {
            promptTokens: message.usage.input,
            completionTokens: message.usage.output,
            totalTokens: message.usage.totalTokens,
            cachedTokens: message.usage.cacheRead,
          };
          // Pi's dollar prices are catalog estimates, not subscription charges. Never forward them.
        }
      });
      signal.addEventListener("abort", abort, { once: true });
      try {
        signal.throwIfAborted();
        if (
          session.getActiveToolNames().length ||
          session.thinkingLevel !== request.thinking
        )
          throw new Error("Unsupported session configuration.");
        await session.prompt(request.user, {
          expandPromptTemplates: false,
          // Pi abort() does not latch during asynchronous prompt preflight. This
          // synchronous boundary runs immediately before the agent/provider starts.
          preflightResult: () => signal.throwIfAborted(),
        });
        signal.throwIfAborted();
        if (failed) throw new Error("Provider failed.");
        return usage;
      } finally {
        signal.removeEventListener("abort", abort);
        unsubscribe();
        session.dispose();
      }
    },
  };
}

# Pi / Codex bridge (Mac Mini → Android)

Scholia can use the **OpenAI Codex subscription logged into Pi on your Mac**, instead of OpenRouter. The Mac runs this separate Node service; Android sends the selected note context and receives generated text over private HTTPS. There is no vault sync requirement, no shell/tool access and no automatic paid-provider fallback. Note edits remain in Obsidian.

## 1. Install and sign in on the Mac

Requires **Node.js 22.19+**. From this repository:

```sh
cd bridge
npm ci --ignore-scripts
npm run build
```

The bridge pins `@earendil-works/pi-coding-agent` **0.87.1** with its own lockfile. It is not bundled into the Obsidian/mobile plugin. The OAuth-only credential adapter uses this pinned version's internal locked auth store to preserve Pi refresh locking without resolving API-key shell commands. Upgrading Pi requires rerunning the adapter compatibility and preflight-cancellation tests; unsupported store APIs fail closed. Use your existing Pi installation, or the pinned CLI here:

```sh
./node_modules/.bin/pi
```

Inside Pi, use `/login`, select **OpenAI Codex** and complete the subscription sign-in. Use `/model` to verify your Codex model access. Do **not** supply an ordinary OpenAI API key: that uses different billing. Quit Pi after setup if desired; the bridge creates separate sessions, not your interactive session.

Pi's default auth directory is `~/.pi/agent`. If you use another one, set `PI_CODING_AGENT_DIR` for both the CLI and bridge. Do not copy `auth.json` into the vault, plugin settings, this repository, or onto your phone. Pi manages OAuth refresh through its own credential store. Authentication errors may require another `/login` on the Mac.

## 2. Create a bridge access token

This is a separate revocable credential allowing access to the bridge, **not your OpenAI token**.

```sh
mkdir -p "$HOME/.config/scholia"
chmod 700 "$HOME/.config/scholia"
(umask 077; node -e 'process.stdout.write(require("node:crypto").randomBytes(32).toString("base64url"))' > "$HOME/.config/scholia/bridge-token")
export SCHOLIA_BRIDGE_TOKEN_FILE="$HOME/.config/scholia/bridge-token"
```

Transfer this file's value privately into Scholia's **Pi bridge access token** setting on Android. Avoid screenshots, chat messages and shell arguments containing tokens. The plugin stores the bridge token in Obsidian plugin data (not an encrypted secret store); protect any synced backups. Rotate by replacing this token file, restarting the bridge, and updating the phone.

For ephemeral development, `SCHOLIA_BRIDGE_TOKEN` is also supported and takes precedence over the file. Tokens must contain at least 43 URL-safe characters (`A–Z`, `a–z`, `0–9`, `_`, `-`); always generate randomly rather than choosing a password.

## 3. Start the bridge and private HTTPS

```sh
npm start                 # production: uses the built dist/
# Or after editing source:
npm run dev               # build then start, no watch daemon
```

The listener is **127.0.0.1:3210 only**, not your LAN or public interface. Set `SCHOLIA_BRIDGE_PORT` to change it. Keep this foreground process running for initial testing.

Install Tailscale on the Mac and Android phone, sign both into the same private tailnet and connect them. Configure **Tailscale Serve, not Funnel**, on the Mac:

```sh
tailscale serve --bg http://127.0.0.1:3210
tailscale serve status
```

If the CLI requests HTTPS certificate/Serve approval, follow its instructions. Copy the resulting private URL, for example `https://mac-mini.example-tailnet.ts.net`. Use the exact URL reported by your Tailscale installation. Serve configuration/CLI availability varies by macOS installation; see [Tailscale Serve](https://tailscale.com/kb/1312/serve). These commands are manual setup instructions: the plugin does not execute them.

**Do not enable Tailscale Funnel, router port forwarding, or a public reverse proxy.** Limit tailnet access to the required devices/users with Tailscale access controls. A bridge token is still required even inside the tailnet. The bridge rejects browser `Origin` requests; Scholia uses Obsidian `requestUrl`, not browser CORS/fetch streaming. No wildcard CORS configuration is needed.

For testing Obsidian on the Mac itself, `http://127.0.0.1:3210` is accepted. On Android, `localhost` means the phone, **not the Mac**; use the private HTTPS URL. Non-loopback HTTP URLs are rejected to avoid sending your token/note contents unencrypted.

## 4. Configure Scholia on Android

Build/install the updated plugin as described in the root README. In **Settings → Scholia Reader**:

1. Choose **Pi on Mac (Codex subscription)** as AI backend.
2. Set **Pi bridge URL** to the private HTTPS origin (no path, query or token in the URL).
3. Paste the bridge token into **Pi bridge access token**.
4. Use **Test Connection**. This checks protocol compatibility, presence of Codex OAuth login, and the bridge's model catalog **without generating text**. It does not prove that your subscription currently has quota/access to every catalog model.
5. Set **Pi Codex model** using a listed `openai-codex/<model-id>`, default `openai-codex/gpt-5.5` for the pinned SDK.
6. Run a template on a small selection.

OpenRouter remains the default for existing installations and its settings are preserved when switching. Remove existing template `model:` overrides such as `z-ai/glm-5.1` to use the current backend's default. A Pi-specific template can instead specify `model: openai-codex/gpt-5.5`. Cross-provider model overrides are rejected, never silently remapped. Regeneration uses the saved model and requires the matching backend. A new follow-up uses the currently selected backend/model and includes the existing conversation as text.

### Tuning and usage

This initial Pi integration uses **medium thinking**. The Pi run modal disables reasoning and token-budget controls; temperature, token budget and reasoning template overrides are **not applied**. OpenRouter tuning remains unchanged. The bridge enforces a five-minute generation deadline and a 1 MiB text-output cap instead; these are not token quotas. Pi models that cannot honor medium thinking fail rather than silently changing it.

Metadata records provider `openai-codex` and reported token usage when available. Monetary cost is **unavailable**, not zero: Pi's API price estimates are not subscription charges. Runs consume your Codex allowance, shared with other Codex usage; subscription limits and provider availability still apply. It is not unlimited or offline inference.

## Reliability, limits and privacy

- A timestamped random job ID and a bridge-instance ID make retrying an uncertain create response idempotent. Retried requests never intentionally create a replacement generation; mismatched requests, expired IDs or a restarted bridge require a **manual new run**.
- Android polls text snapshots approximately every 750 ms and remembers a character cursor, yielding each recovered segment once. Temporary network failures retry with backoff up to 5 seconds, with a 15-minute client deadline. Each HTTP attempt has a 15-second local timeout.
- Disconnecting/locking your phone does **not** cancel a Mac job. Results remain **in memory for 10 minutes after completion/error/cancellation**, then expire. The Mac continues work while the network is down. Keep device clocks synchronized; unknown creation IDs older than 60 seconds are rejected, with 30 seconds of forward skew allowed.
- Plugin unload/disable aborts all tracked generation and prevents late preparation, polling, and capture continuations from starting new writes. Already-issued Obsidian vault operations cannot be rolled back.
- **This is not restart-persistent recovery.** If Android kills Obsidian, you unload/reload the plugin, or the Mac bridge restarts, the request cannot automatically resume. A pending/partial callout may remain. Inspect/remove it before starting a new run; a manual rerun can consume another allowance. No automatic catch-up note edits run after restart.
- If you change the target note during an interruption, Scholia refuses stale-offset writes. Reported edits wholly before the output can shift the tracked region; edits spanning or within generated content cancel it. Initial note contents/path are rechecked after modal and context reads before insertion or regeneration deletion. On a safety abort, an existing pending marker/partial output may remain rather than overwriting your edits.
- Explicit cancellation calls `DELETE` to abort the Pi session. The current UI also cancels when edits conflict with a stream. If cancellation cannot reach the Mac, its five-minute deadline remains the safety net. Obsidian `requestUrl` itself cannot physically abort an in-flight HTTP request; late responses are ignored.
- Defaults: 512 KiB JSON request body, 1 MiB text output/job, 2 active generations, 32 retained jobs, 5-minute generation deadline. Jobs are not queued; a busy bridge rejects new work. Completed-job retention can temporarily fill the job limit.
- Each run gets a tool-less, in-memory Pi session, explicit Codex provider/model, custom empty resource loader, no extensions/skills/prompt templates/context files, no disk session history, no automatic retries/compaction/cache warming and no personal settings discovery. No general Pi RPC or shell endpoint is exposed. Custom `models.json` endpoints are not loaded.
- Prompts/results live transiently in Mac memory; this service does not log them or tokens. Note contents still go to **OpenAI** for generation. Tailnet/OS/proxy logging and provider data policies are outside the bridge's control. Run as a normal macOS user, not root. Protect the Mac account and Pi credential directory.

## Optional: start on macOS login with launchd

First prove the foreground setup works. Copy `launchd.example.plist` to `~/Library/LaunchAgents/dev.scholia.pi-bridge.plist`, then **replace every `/ABSOLUTE/...` path** with your own. Use the absolute `node` path from `command -v node` (often `/opt/homebrew/bin/node` on Apple Silicon), the absolute bridge directory, and your token file/agent directory. Keep the token itself out of the plist.

```sh
plutil -lint "$HOME/Library/LaunchAgents/dev.scholia.pi-bridge.plist"
launchctl bootstrap "gui/$(id -u)" "$HOME/Library/LaunchAgents/dev.scholia.pi-bridge.plist"
launchctl kickstart -k "gui/$(id -u)/dev.scholia.pi-bridge"
# Stop/uninstall the service registration:
launchctl bootout "gui/$(id -u)" "$HOME/Library/LaunchAgents/dev.scholia.pi-bridge.plist"
```

Do not run a foreground instance on the same port. After rebuilding, restart the service. launchd does not inherit interactive shell environment; all required variables are in the example plist. Its output files contain only startup/error summaries, not request content. Review local file permissions.

A user LaunchAgent starts **after user login**, not necessarily before login after reboot. FileVault can require an interactive unlock. Tailscale must also be connected. Configure Mac energy settings to prevent system sleep when you need phone access; display sleep is fine. This feature does not remotely wake/unlock the Mac. Test reboot/login, sleep, and power/network failures before relying on unattended use.

## Tests (no subscription requests)

```sh
# Repository root
npm ci --ignore-scripts
npm test
npx tsc --noEmit
npm run build
# Bridge
cd bridge
npm ci --ignore-scripts
npm test
npm run typecheck
```

Bridge tests exercise actual HTTP routes using a fake generation engine, plus SDK isolation with temporary synthetic auth data. Plugin tests cover transport retry/cursors, real HTTP retry integration, provider selection, inline/capture/follow-up/regeneration, model mismatch, metadata and reconnect editor safety.

### Real-device smoke checklist (manual, consumes Codex allowance)

- [ ] Test Connection succeeds from Android on Wi-Fi and cellular with Tailscale connected.
- [ ] Generate one small selection and confirm `provider=openai-codex`, correct model, `cost=unavailable`, and no OpenRouter usage.
- [ ] Try attached notes, follow-up, regenerate, file append and central capture.
- [ ] Lock/switch apps briefly during generation, then return: response resumes without repeated text if Obsidian survives.
- [ ] Disconnect/reconnect Tailscale during generation; inspect one recovered response, not a second request.
- [ ] Edit the target output while waiting: generation cancels rather than overwriting the edit; switch notes and verify no answer goes to the wrong note.
- [ ] Wrong token, invalid model and exhausted/expired login produce useful errors, never a paid fallback.
- [ ] Bridge restart/result expiry does not silently launch replacement work. Confirm documented limits after killing/reopening Obsidian.
- [ ] Reboot/login and sleep/wake behave as intended for your Mac/Tailscale setup.

Actual Android background behavior, private HTTPS and live Codex quota/authentication require this checklist; automated tests do not claim to verify them.

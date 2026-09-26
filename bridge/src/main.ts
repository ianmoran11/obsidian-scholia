import { homedir } from "node:os";
import { readFile } from "node:fs/promises";
import { resolve } from "node:path";
import { createBridge } from "./server.js";
import { createPiEngine } from "./pi.js";

try {
  const port = Number(process.env.SCHOLIA_BRIDGE_PORT ?? 3210);
  if (!Number.isInteger(port) || port < 1024 || port > 65535)
    throw new Error("Invalid port.");
  const token =
    process.env.SCHOLIA_BRIDGE_TOKEN ??
    (process.env.SCHOLIA_BRIDGE_TOKEN_FILE
      ? (await readFile(process.env.SCHOLIA_BRIDGE_TOKEN_FILE, "utf8")).trim()
      : "");
  // Validate before initializing any provider runtime.
  if (!/^[A-Za-z0-9_-]{43,}$/.test(token))
    throw new Error("Missing strong bridge token.");
  const agentDir = resolve(
    process.env.PI_CODING_AGENT_DIR ?? `${homedir()}/.pi/agent`,
  );
  const engine = await createPiEngine(agentDir, process.cwd());
  const server = createBridge({ token, engine });
  server.listen(port, "127.0.0.1", () =>
    console.log(`Scholia bridge listening on 127.0.0.1:${port}`),
  );
  server.on("error", () => {
    console.error("Bridge listener failed. Check the port.");
    process.exitCode = 1;
  });
  for (const signal of ["SIGINT", "SIGTERM"] as const) {
    process.once(signal, () => {
      server.close();
      server.closeAllConnections();
    });
  }
} catch {
  console.error(
    "Bridge startup failed. Check Node version, token, port and Pi installation. No request details logged.",
  );
  process.exitCode = 1;
}

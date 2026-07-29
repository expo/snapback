import { spawn } from "node:child_process";
import { chmod, mkdir, open } from "node:fs/promises";
import path from "node:path";
import { runtimeDir, receiptsDir, target, writeJson, sha256, workDir } from "./lib.mjs";

await mkdir(runtimeDir, { recursive: true, mode: 0o700 });
const t = await target();
const rawPath = path.join(runtimeDir, "push-output.log");
const raw = await open(rawPath, "w", 0o600);
const args = ["instant-cli", "--yes", "--token", t.adminToken, "push", "all", "--app", t.appId];
const child = spawn("npx", args, {
  cwd: workDir,
  stdio: ["ignore", raw.fd, raw.fd],
  env: {
    ...process.env,
    XDG_CONFIG_HOME: path.join(runtimeDir, "xdg", "config"),
    XDG_CACHE_HOME: path.join(runtimeDir, "xdg", "cache"),
  },
});
const exitCode = await new Promise((resolve) => child.on("exit", resolve));
await raw.close();
await chmod(rawPath, 0o600);
await writeJson(path.join(receiptsDir, "config-push-redacted.json"), {
  schemaVersion: 1,
  pushedAt: new Date().toISOString(),
  exitCode,
  commandShape: "instant-cli --yes --token <redacted> push all --app <redacted>",
  targetIdSha256: sha256(t.appId),
  rawOutputLocation: "ignored mode-0600 runtime file",
  containsCredentialValues: false,
});
if (exitCode !== 0) throw new Error(`Configuration push failed (${exitCode}); inspect ignored runtime output locally.`);
process.stdout.write(JSON.stringify({ ok: true, targetIdSha256: sha256(t.appId) }) + "\n");

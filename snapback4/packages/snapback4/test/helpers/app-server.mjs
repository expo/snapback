import { signalChild, spawnTracked as spawn } from '../../../../scripts/test-signals.mjs';
import { captureStdout } from './server-output.mjs';
import { waitFor as awaitState } from './wait.mjs';
import assert from "node:assert/strict";
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";

export const binary = process.env.SNAPBACK4_BIN ?? resolve(import.meta.dirname, "../../../../target/debug/snapback4");
export const until = async (read, label = "condition", options) => { return awaitState(async () => {
    try { return await read(); }
    catch (error) {
      // Only a cancelled pooled socket is retryable; assertions still fail.
      if (error.cause?.code !== 'UND_ERR_SOCKET') throw error;
    }
  }, label, options); };
export async function server(t, residency = "sync to .owner", source, { watch = false } = {}) {
  const dir = mkdtempSync(join(tmpdir(), "sb4-app-"));
  mkdirSync(join(dir, "snapback"));
  writeFileSync(join(dir, "snapback/schema.q"), source ?? `use identity
 tablePlaceholder` .replace(' tablePlaceholder', `table notes:
  owner: principal
  body: text <=200
  by byOwner: owner, id
  read <- .owner = viewer
  insert <- .owner = viewer
  ${residency}
mutation add(body: text <=200):
  insert notes { owner: viewer, body }
query list():
  return notes[viewer] first 100 by byOwner
`));
  let output = "";
  const host = spawn(binary, ["dev", "--port", "0", ...(watch ? [] : ["--no-watch"])], { cwd: dir, stdio: ["ignore", "pipe", "pipe"] });
  const readStdout = captureStdout(host);
  host.stdout.on("data", bytes => { output += bytes; }); host.stderr.on("data", bytes => { output += bytes; });
  t.after(async () => { const done = new Promise(resolve => host.once("exit", resolve)); if (host.exitCode === null && host.signalCode === null) { signalChild(host, "SIGTERM"); await done; } rmSync(dir, { recursive: true, force: true }); });
  const url = await until(() => { assert.equal(host.exitCode, null, output); return readStdout().match(/http:\/\/127\.0\.0\.1:\d+(?=\r?\n)/)?.[0]; }, "server");
  return { url, dir };
}

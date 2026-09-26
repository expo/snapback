import assert from "node:assert/strict";
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { spawn } from "node:child_process";
import { setTimeout as delay } from "node:timers/promises";

export const binary = process.env.SNAPBACK4_BIN ?? resolve(import.meta.dirname, "../../../../target/debug/snapback4");
export const until = async (read, label = "condition") => {
  for (let n = 0; n < 500; n++) {
    try { const value = await read(); if (value) return value; }
    catch (error) {
      // Cancellation can leave an aborted pooled socket for the next probe.
      // Retry only this transport failure; assertions and refusals still fail.
      if (error.cause?.code !== "UND_ERR_SOCKET") throw error;
    }
    await delay(10);
  }
  assert.fail(`timed out: ${label}`);
};
export async function server(t, residency = "sync to .owner", source) {
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
  const host = spawn(binary, ["dev", "--port", "0", "--no-watch"], { cwd: dir, stdio: ["ignore", "pipe", "pipe"] });
  host.stdout.on("data", bytes => { output += bytes; }); host.stderr.on("data", bytes => { output += bytes; });
  t.after(async () => { const done = new Promise(resolve => host.once("exit", resolve)); if (host.exitCode === null) { host.kill("SIGTERM"); await done; } rmSync(dir, { recursive: true, force: true }); });
  const url = await until(() => { assert.equal(host.exitCode, null, output); return output.match(/http:\/\/127\.0\.0\.1:\d+/)?.[0]; }, "server");
  return { url, dir };
}

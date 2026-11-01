// Copied into a clean installed consumer, never imported from the checkout.
// @ref LLP 3000.021#3.3 — exercise the installed CLI and real client/server round trip
import assert from "node:assert/strict";
import { spawn, execFileSync } from "node:child_process";
import { resolve } from "node:path";
import { once } from "node:events";
import { setTimeout as delay } from "node:timers/promises";
import { createClient } from "snapback4/client";
assert.equal(process.env.SNAPBACK4_BIN, undefined);
let cwd = process.cwd();
const cli = (...args) => execFileSync("npx", ["--no-install", "snapback4", ...args], { cwd, encoding: "utf8", timeout: 60_000 });
assert.equal(cli("--version").trim(), `snapback4 ${process.argv[2]}`);
cli("init", "app", "--online");
cwd = resolve("app");
cli("check");
const child = spawn(resolve("node_modules/.bin/snapback4"), ["dev", "--port", "0", "--no-watch"], { cwd, stdio: ["ignore", "pipe", "pipe"], detached: true });
const exited = once(child, "exit");
let output = "", errors = "", alice, bob;
child.stdout.on("data", b => { output += b; });
child.stderr.on("data", b => { errors += b; });
try {
  const deadline = Date.now() + 30_000;
  while (!/^http:\/\/127\.0\.0\.1:\d+$/m.test(output) && child.exitCode === null && Date.now() < deadline) await delay(25);
  const url = output.match(/^http:\/\/127\.0\.0\.1:\d+$/m)?.[0];
  assert.ok(url, `dev did not start: ${errors}`);
  alice = createClient({ url, persona: "alice" }); bob = createClient({ url, persona: "bob" });
  const write = await alice.mutate({ kind: "mutation", name: "add" }, { title: "Linux consumer proof" });
  assert.equal(write.state, "sent", JSON.stringify(write));
  const read = await alice.query({ kind: "query", name: "list" }, {});
  assert.equal(read.data?.length, 1, JSON.stringify(read));
  assert.equal(read.data[0].title, "Linux consumer proof");
  const denied = await bob.query({ kind: "query", name: "list" }, {});
  assert.deepEqual(denied.data, []);
  console.log("consumer round trip passed: --version, init, check, dev, write/read and denied cross-persona read");
} finally {
  await alice?.close(); await bob?.close();
  if (child.exitCode === null) {
    try { process.kill(-child.pid, "SIGTERM"); } catch { /* already exited */ }
    const timer = setTimeout(() => { try { process.kill(-child.pid, "SIGKILL"); } catch {} }, 5000);
    await exited; clearTimeout(timer);
  }
}

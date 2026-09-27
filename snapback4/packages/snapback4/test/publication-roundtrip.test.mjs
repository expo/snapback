import test from "node:test";
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { copyFileSync, existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

// @ref LLP 3000.021#3.3 — pin the installed proof's CLI, client and disclosure assertions
function roundtrip(t, scenario = "success") {
  const root = mkdtempSync(join(tmpdir(), "snapback4-roundtrip-test-"));
  t.after(() => rmSync(root, { recursive: true, force: true }));
  copyFileSync(new URL("../../../scripts/publication-roundtrip.mjs", import.meta.url), join(root, "roundtrip.mjs"));
  copyFileSync(new URL("./helpers/publication-roundtrip-mock.mjs", import.meta.url), join(root, "mock.mjs"));
  const pkg = join(root, "node_modules/snapback4"); mkdirSync(pkg, { recursive: true });
  writeFileSync(join(pkg, "package.json"), JSON.stringify({ name: "snapback4", type: "module", exports: { "./client": "./client.mjs" } }));
  writeFileSync(join(pkg, "client.mjs"), 'export { createClient } from "../../mock.mjs";\n');
  const result = spawnSync(process.execPath, ["--import", join(root, "mock.mjs"), join(root, "roundtrip.mjs"), "0.4.5"], {
    cwd: root, encoding: "utf8", timeout: 10_000,
    env: { ROUNDTRIP_SCENARIO: scenario, ...(scenario === "override" ? { SNAPBACK4_BIN: "/host/binary" } : {}) },
  });
  const events = join(root, "events.jsonl");
  return { ...result, root, events: existsSync(events) ? readFileSync(events, "utf8").trim().split("\n").map(JSON.parse) : [] };
}

const cleanup = [
  { event: "close", persona: "alice" }, { event: "close", persona: "bob" },
  { event: "kill", pid: -424242, signal: "SIGTERM" },
];
test("unchanged round-trip proof executes version/init/check/dev, client write/read and denied cross-persona read", t => {
  const r = roundtrip(t); assert.equal(r.status, 0, r.stderr);
  assert.match(r.stdout, /consumer round trip passed/);
  const cli = (cwd, ...args) => ({ event: "cli", command: "npx", args: ["--no-install", "snapback4", ...args], cwd, encoding: "utf8", timeout: 60_000 });
  assert.deepEqual(r.events, [
    cli(r.root, "--version"), cli(r.root, "init", "app", "--online"), cli(join(r.root, "app"), "check"),
    { event: "spawn", command: join(r.root, "node_modules/.bin/snapback4"), args: ["dev", "--port", "0", "--no-watch"], cwd: join(r.root, "app"), stdio: ["ignore", "pipe", "pipe"], detached: true },
    { event: "client", url: "http://127.0.0.1:43210", persona: "alice" },
    { event: "client", url: "http://127.0.0.1:43210", persona: "bob" },
    { event: "mutate", persona: "alice", operation: { kind: "mutation", name: "add" }, args: { title: "Linux consumer proof" } },
    { event: "query", persona: "alice", operation: { kind: "query", name: "list" }, args: {} },
    { event: "query", persona: "bob", operation: { kind: "query", name: "list" }, args: {} },
    ...cleanup,
  ]);
});

for (const [scenario, message, cliCount] of [
  ["override", /\/host\/binary/, 0], ["version", /wrong-version/, 1],
  ["--version", /injected --version failure/, 1], ["init", /injected init failure/, 2], ["check", /injected check failure/, 3],
]) test(`round-trip proof propagates ${scenario} refusal before dev starts`, t => {
  const r = roundtrip(t, scenario);
  assert.equal(r.status, 1, r.stderr); assert.match(r.stderr, message);
  assert.doesNotMatch(r.stdout, /consumer round trip passed/);
  assert.deepEqual(r.events.map(e => e.event), Array(cliCount).fill("cli"));
});

test("round-trip proof propagates dev startup failure without creating clients", t => {
  const r = roundtrip(t, "dev"); assert.equal(r.status, 1, r.stderr);
  assert.match(r.stderr, /dev did not start: injected dev failure/);
  assert.doesNotMatch(r.stdout, /consumer round trip passed/);
  assert.deepEqual(r.events.map(e => e.event), ["cli", "cli", "cli", "spawn"]);
});

for (const [scenario, message] of [
  ["mutate", /injected mutate failure/], ["write-state", /pending/],
  ["alice-query", /injected alice-query failure/], ["read-count", /0 !== 1/], ["read-title", /wrong-title/],
  ["bob-query", /injected bob-query failure/], ["disclosure", /Linux consumer proof/],
]) test(`round-trip proof rejects ${scenario} and closes both clients and dev`, t => {
  const r = roundtrip(t, scenario); assert.equal(r.status, 1, r.stderr);
  assert.match(r.stderr, message); assert.doesNotMatch(r.stdout, /consumer round trip passed/);
  assert.deepEqual(r.events.slice(-3), cleanup);
});

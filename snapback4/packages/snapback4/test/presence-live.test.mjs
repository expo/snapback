// LLP 3000.017: a live query that reads connected[p] re-runs on the interval
// its server names. Alice's observed online mark for Bob turns when Bob's
// client starts polling and when his grace ends, on every client tier, and
// never falls back to loading while it refreshes.
import test from "node:test";
import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { once } from "node:events";
import { mkdtempSync, mkdirSync, readFileSync, writeFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { createClient } from "../dist/client.js";
import { createLocalClient } from "../dist/local.js";
import { processDevice } from "../dist/native.js";
import { memoryPersistence, webDevice } from "../dist/web.js";

const root = join(dirname(fileURLToPath(import.meta.url)), "../../..");
const binary = process.env.SNAPBACK4_BIN ?? join(root, "target/debug/snapback4");
const sleep = ms => new Promise(resolve => setTimeout(resolve, ms));
async function until(check, ms = 5000) {
  const start = Date.now();
  for (;;) { if (await check()) return Date.now() - start; if (Date.now() - start >= ms) return null; await sleep(20); }
}
const schema = `use personas alice, bob
use identity
table notes:
  owner: principal
  read <- .owner = viewer
  insert <- .owner = viewer
  sync to .owner
query presenceOf(p: principal):
  return { online: exists connected[p], count: connected[p] }
`;

for (const tier of ["online", "native", "web"]) test(`${tier}: a live online mark follows the principal it reads`, { timeout: 60000 }, async t => {
  const dir = mkdtempSync(join(tmpdir(), "sb4-presence-live-"));
  mkdirSync(join(dir, "snapback")); mkdirSync(join(dir, "devices"));
  writeFileSync(join(dir, "snapback/schema.q"), schema);
  const server = spawn(binary, ["dev", "--port", "0", "--no-watch"], { cwd: dir, stdio: ["ignore", "pipe", "pipe"] });
  const exited = once(server, "exit");
  let log = "", url;
  server.stdout.on("data", data => { log += data; url ??= log.match(/http:\/\/127\.0\.0\.1:\d+/)?.[0]; });
  server.stderr.on("data", data => { log += data; });
  const clients = [];
  t.after(async () => { for (const client of clients) await client.close().catch(() => {}); server.kill(); await exited; rmSync(dir, { recursive: true, force: true }); });
  assert.notEqual(await until(() => url, 30000), null, log);
  const native = processDevice({ binary, dir: join(dir, "devices"), spawn: (command, args) => spawn(command, args, { stdio: ["pipe", "pipe", "inherit"] }), writeFile: async (path, text) => writeFileSync(path, text) });
  const wasm = readFileSync(join(root, "packages/snapback4/src/wasm/snapback4_device_bg.wasm"));
  const options = persona => ({ url, persona, waitSeconds: 25 });
  const alice = tier === "online" ? createClient(options("alice"))
    : await createLocalClient({ ...options("alice"), device: tier === "native" ? native : webDevice({ wasm, persist: memoryPersistence() }) });
  clients.push(alice);
  if (tier !== "online") await alice.sync();
  const query = { kind: "query", name: "presenceOf" };
  const mark = alice.observe(query, { p: "dev:bob" });
  t.after(() => mark.close());
  const online = () => mark.getSnapshot()?.data?.online;
  assert.notEqual(await until(() => online() === false), null, "Bob starts away");

  // Bob's client holds a poll while it watches something.
  const bob = createClient(options("bob"));
  clients.push(bob);
  const bobWatch = bob.observe(query, { p: "dev:alice" });
  const cameOnline = await until(() => online() === true, 8000);
  assert.notEqual(cameOnline, null, `Alice's mark stayed ${JSON.stringify(mark.getSnapshot())} after Bob came online`);
  // The count rides along; a client that restarts its poll briefly holds two.
  assert.ok(mark.getSnapshot().data.count >= 1);
  // A refresh keeps the answer: sampled like a screen would, across a whole
  // interval with no commit, the mark never reads loading.
  let loading = 0, samples = 0, refreshes = 0;
  const stop = mark.subscribe(() => { if ("data" in mark.getSnapshot()) refreshes++; });
  for (const end = Date.now() + 6000; Date.now() < end; await sleep(50)) { samples++; if ("loading" in mark.getSnapshot()) loading++; }
  stop();
  assert.equal(loading, 0, `a presence refresh keeps its answer: ${loading} of ${samples} samples read loading`);
  assert.ok(refreshes >= 1 && online() === true, "the mark refreshed and Bob is still online");

  // Bob leaves. His grace keeps him connected until the clock passes it.
  bobWatch.close();
  await bob.close();
  clients.splice(clients.indexOf(bob), 1);
  await sleep(300);
  assert.equal(online(), true, "inside the grace Bob still counts as connected");
  // The server ends Bob's held poll at its next heartbeat (2 s); his grace
  // starts then. Advance past the grace until that has happened.
  const advance = async () => (await fetch(`${url}/dev/clock/advance`, { method: "POST", headers: { "x-snapback-persona": "alice", "content-type": "application/json" }, body: JSON.stringify({ duration: "36s" }) })).status;
  const started = Date.now();
  const wentAway = await until(async () => {
    assert.equal(await advance(), 200);
    return await until(() => online() === false, 6500) !== null;
  }, 20000);
  assert.notEqual(wentAway, null, `Alice's mark stayed ${JSON.stringify(mark.getSnapshot())} after Bob's grace ended`);
  t.diagnostic(JSON.stringify({ tier, cameOnlineMs: cameOnline, wentAwayAfterCloseMs: Date.now() - started }));
});

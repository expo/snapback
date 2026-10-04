import { captureStdout } from './helpers/server-output.mjs';
import { waitFor as awaitState, hangBudget } from './helpers/wait.mjs';
// LLP 3000.018: a live query that reads connected[p] re-runs on the interval
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
import { registerHooks } from "node:module";
import { processDevice } from "../dist/native.js";

// Only the presence scheduler uses controlled time. Real HTTP, device I/O and
// change-feed watchdogs keep their native timers. No answer or client branch is replaced.
const clockKey = Symbol.for("snapback4.test.presenceClock");
let controlledModules = 0;
const hooks = registerHooks({ load(url, context, next) {
  const loaded = next(url, context);
  if (!url.endsWith("/dist/presence-refresh.js")) return loaded;
  controlledModules++;
  return { ...loaded, source: `
    const setTimeout = (...args) => globalThis[Symbol.for("snapback4.test.presenceClock")].schedule(...args);
    const clearTimeout = timer => globalThis[Symbol.for("snapback4.test.presenceClock")].cancel(timer);
  ` + loaded.source };
} });
const { createClient } = await import("../dist/client.js");
const { createLocalClient } = await import("../dist/local.js");
const { memoryPersistence, webDevice } = await import("../dist/web.js");
hooks.deregister();
assert.equal(controlledModules, 1, "the presence timer module must load under the controlled clock");

function presenceClock() {
  let now = 0;
  const timers = new Map();
  const clock = {
    schedule(callback, ms) {
      const timer = { unref() {} };
      timers.set(timer, { at: now + ms, ms, callback });
      return timer;
    },
    cancel(timer) { timers.delete(timer); },
    pending: () => [...timers.values()],
    tick(ms) {
      const through = now + ms;
      for (;;) {
        const due = [...timers].filter(([, entry]) => entry.at <= through).sort((a, b) => a[1].at - b[1].at)[0];
        if (!due) break;
        const [timer, entry] = due;
        timers.delete(timer); now = entry.at; entry.callback();
      }
      now = through;
    },
  };
  globalThis[clockKey] = clock;
  return clock;
}

const root = join(dirname(fileURLToPath(import.meta.url)), "../../..");
const binary = process.env.SNAPBACK4_BIN ?? join(root, "target/debug/snapback4");
const sleep = ms => new Promise(resolve => setTimeout(resolve, ms));
async function until(check) {
  const start = Date.now();
  await awaitState(check);
  return Date.now() - start;
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
query withNotes(p: principal):
  return { online: exists connected[p], notes: count(notes where .owner = viewer) }
`;

for (const tier of ["online", "native", "web"]) test(`${tier}: a live online mark follows the principal it reads`, { timeout: hangBudget(14) }, async t => {
  const clock = presenceClock();
  const dir = mkdtempSync(join(tmpdir(), "sb4-presence-live-"));
  mkdirSync(join(dir, "snapback")); mkdirSync(join(dir, "devices"));
  writeFileSync(join(dir, "snapback/schema.q"), schema);
  const server = spawn(binary, ["dev", "--port", "0", "--no-watch"], { cwd: dir, stdio: ["ignore", "pipe", "pipe"] });
  const readStdout = captureStdout(server);
  const exited = once(server, "exit");
  let log = "", url;
  server.stdout.on("data", data => { log += data; url ??= readStdout().match(/http:\/\/127\.0\.0\.1:\d+(?=\r?\n)/)?.[0]; });
  server.stderr.on("data", data => { log += data; });
  const clients = [];
  t.after(async () => { for (const client of clients) await client.close().catch(() => {}); server.kill(); await exited; rmSync(dir, { recursive: true, force: true }); delete globalThis[clockKey]; });
  assert.notEqual(await until(() => url), null, log);
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
  // The same presence beside rows the device holds: an answer composed from both.
  const notes = alice.observe({ kind: "query", name: "withNotes" }, { p: "dev:bob" });
  t.after(() => notes.close());
  assert.notEqual(await until(() => online() === false && notes.getSnapshot()?.data?.online === false), null, "Bob starts away");

  // Bob's client holds a poll while it watches something.
  const bob = createClient(options("bob"));
  clients.push(bob);
  const bobWatch = bob.observe(query, { p: "dev:alice" });
  const servedPresence = async () => {
    const response = await fetch(url + "/q/presenceOf", { method: "POST", headers: { "x-snapback-persona": "alice" }, body: JSON.stringify({ args: { p: "dev:bob" } }) });
    const answer = await response.json();
    assert.equal(answer.refresh, 5000, "the real server supplies the five-second interval");
    return answer.data.online;
  };
  await until(async () => await servedPresence() === true);
  await until(() => clock.pending().length >= 3); // Both Alice watches and Bob's watch settled.
  assert.ok(clock.pending().every(timer => timer.ms === 5000), "every presence watch uses the supplied interval");
  clock.tick(4999);
  assert.equal(online(), false, "the mark does not refresh before the supplied interval");
  clock.tick(2); // The refresh window is [5000, 5001] ms, independent of host speed.
  const cameOnline = await until(() => online() === true && notes.getSnapshot()?.data?.online === true);
  assert.notEqual(cameOnline, null, `Alice's mark stayed ${JSON.stringify(mark.getSnapshot())} after Bob came online`);
  // The count rides along; a client that restarts its poll briefly holds two.
  assert.ok(mark.getSnapshot().data.count >= 1);
  // A refresh keeps the answer: across a whole interval with no commit, no
  // notification carries anything but an answer.
  let loading = 0, refreshes = 0;
  const stop = mark.subscribe(() => { if ("data" in mark.getSnapshot()) refreshes++; else loading++; });
  await until(() => clock.pending().length >= 3);
  assert.ok(clock.pending().every(timer => timer.ms === 5000), "success keeps the supplied interval");
  clock.tick(5000);
  await awaitState(() => refreshes >= 1 && notes.getSnapshot()?.data?.online === true, "presence refresh after initial answer");
  stop();
  assert.equal(loading, 0, `a presence refresh showed ${loading} snapshots other than an answer`);
  assert.ok(refreshes >= 1 && online() === true, "the mark refreshed and Bob is still online");
  assert.equal(notes.getSnapshot().data?.online, true, "an answer composed from the device and the server refreshes too");

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
  await until(async () => {
    assert.equal(await advance(), 200);
    return await servedPresence() === false;
  });
  await until(() => clock.pending().length >= 2);
  assert.ok(clock.pending().every(timer => timer.ms === 5000), "departure keeps the supplied interval");
  assert.equal(online(), true, "no refresh before advancing the client interval");
  clock.tick(5000);
  const wentAway = await until(() => online() === false && notes.getSnapshot()?.data?.online === false);
  assert.notEqual(wentAway, null, `Alice's mark stayed ${JSON.stringify(mark.getSnapshot())} after Bob's grace ended`);
  t.diagnostic(JSON.stringify({ tier, cameOnlineMs: cameOnline, wentAwayAfterCloseMs: Date.now() - started }));
});

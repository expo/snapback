// The issued device clock can stay ahead while the estimated server clock rolls back.
import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { setTimeout as delay } from "node:timers/promises";
import { createClient } from "../dist/client.js";
import { createLocalClient } from "../dist/local.js";
import { ServerClock } from "../dist/clock.js";
import { armReadExpiry } from "../dist/read-expiry.js";
import { webDevice, memoryPersistence } from "../dist/web.js";
import { processDevice } from "../dist/native.js";
import { server, binary, until } from "./helpers/app-server.mjs";
const wasm = readFileSync(new URL("../dist/wasm/snapback4_device_bg.wasm", import.meta.url));
const source = `use personas alice
table localRows:
  expiresAt: time
  expire at .expiresAt
  read <- allow
  sync public
table remoteRows:
  expiresAt: time
  expire at .expiresAt
  read <- allow
  online only
query remote():
  return exists remoteRows['private']
query idle():
  return exists remoteRows['private']
query branch():
  if exists remoteRows['private']:
    return true
  if exists localRows['private']:
    return false
  return true
`;
const parked = signal => new Promise((_, reject) => {
  if (signal.aborted) reject(Error("closed"));
  else signal.addEventListener("abort", () => reject(Error("closed")), { once: true });
});
async function fixture(t, tier) {
  const { url, dir } = await server(t, undefined, source);
  const wall = Date.now(), serverDeadline = wall + 3_600_000, deviceNow = wall + 7_200_000, deviceDeadline = deviceNow + 100;
  const seeded = await fetch(url + "/seed", { method: "POST", headers: { "x-snapback-persona": "alice" }, body: JSON.stringify([
    { table: "localRows", row: { id: "private", expiresAt: deviceDeadline } },
    { table: "remoteRows", row: { id: "private", expiresAt: serverDeadline } },
  ]) }).then(r => r.json());
  assert.equal(seeded.seeded, 2);
  const clock = new ServerClock(() => wall); clock.raiseIssued(deviceNow);
  let liveClock = clock, offline = false, hold = false, queries = 0, localQueries = 0, answerDeadline = serverDeadline;
  const fork = clock.fork.bind(clock); clock.fork = () => liveClock = fork();
  const gate = Promise.withResolvers();
  const opener = tier === "wasm" ? webDevice({ wasm, persist: memoryPersistence() }) : processDevice({ binary, dir: join(dir, "device") });
  const options = { url, persona: "alice", device: { async open(...args) {
    const core = await opener.open(...args);
    return { ...core, async call(request, committed) {
      const reply = await core.call(request); committed?.(reply);
      if (request.op === "query") { localQueries++; if (hold) await gate.promise; }
      return reply;
    } };
  } }, fetch: clock.wrap(async (input, init) => {
    const path = new URL(input).pathname;
    if (offline) throw Error("controlled offline");
    if (path === "/changes") return parked(init.signal);
    const response = await fetch(input, init), json = await response.json();
    if (path.startsWith("/q/")) {
      queries++;
      if (hold) return Response.json({ loading: true, seq: json.seq, tables: json.tables });
      json.nextExpiry = answerDeadline;
    }
    // Strip server samples: the fixture owns both clocks, and they disagree.
    return Response.json(json, { status: response.status });
  }) };
  const client = tier === "online" ? createClient(options) : await createLocalClient(options);
  t.after(async () => { hold = false; gate.resolve(); await client.close(); });
  if (client.sync) await client.sync();
  assert.equal(client.now(), deviceNow);
  assert.equal(liveClock.estimatedServerNow(), wall);
  return { client, clock: liveClock, wall, serverDeadline, deviceDeadline, queries: () => queries, localQueries: () => localQueries,
    hold: () => { hold = true; }, release: () => { hold = false; gate.resolve(); },
    answerDeadline: value => { answerDeadline = value; }, offline: async () => { offline = true; await client.sync(); } };
}

for (const tier of ["online", "wasm", "process"]) test(`${tier} keep: split-clock correction expires active and lingering answers; rollback cannot resurrect them`, async t => {
  const f = await fixture(t, tier), op = { kind: "query", name: "remote" };
  const active = f.client.observe(op, {}, { keep: true }), idle = f.client.observe({ ...op, name: "idle" }, {}, { keep: true });
  await until(() => active.getSnapshot().data === true && idle.getSnapshot().data === true);
  const initial = idle.getSnapshot(); idle.close(); f.hold();
  assert.equal(initial.fresh, true, "server answer is fresh even though issued time is past its server deadline");
  assert.ok(f.clock.deviceDelay(f.serverDeadline) === 0 && f.clock.serverDelay(f.serverDeadline) === 3_600_000);
  f.clock.sample(f.serverDeadline, f.wall, f.wall, "server:1");
  // The original timer has an hour left. Only clock correction can withdraw now.
  for (let i = 0; i < 100 && !(active.getSnapshot().loading && idle.getSnapshot().loading); i++) await delay(5);
  assert.deepEqual(active.getSnapshot(), { loading: true }, "correction must re-arm the displayed answer's timer");
  assert.deepEqual(idle.getSnapshot(), { loading: true }, "a lingering watch keeps that same clock subscription");
  f.clock.sample(f.wall, f.wall, f.wall, "server:2");
  assert.ok(f.client.now() > f.clock.estimatedServerNow(), "server rollback does not lower issued device time");
  const remount = f.client.observe({ ...op, name: "idle" }, {}, { keep: true });
  assert.deepEqual(remount.getSnapshot(), { loading: true }, "an expired answer cannot return after rollback");
  await delay(10);
  assert.deepEqual(remount.getSnapshot(), { loading: true });
});

for (const tier of ["wasm", "process"]) test(`${tier} keep: lingering remembered answer survives a device wakeup but expires on the server clock`, async t => {
  const f = await fixture(t, tier), op = { kind: "query", name: "branch" };
  assert.equal((await f.client.query(op, {})).data, true, "the server supplies the remote branch");
  await f.offline();
  const watch = f.client.observe(op, {}, { keep: true });
  await until(() => watch.getSnapshot().data === true);
  assert.equal(watch.getSnapshot().fresh, false, "offline recovery uses the ordered remembered server answer");
  watch.close(); f.hold();
  const remount = f.client.observe(op, {}, { keep: true }), before = remount.getSnapshot(); remount.close();
  assert.equal(before.data, true);
  const reads = f.localQueries();
  f.clock.raiseIssued(f.deviceDeadline);
  await until(() => f.localQueries() > reads, "the local wakeup reobserves even while lingering");
  // Wait for the zero-delay expiry timer too, while replacement device reads stay held.
  await delay(20);
  assert.equal(remount.getSnapshot().data, true, "localWakeup is not the remembered answer's expiry");
  const joined = f.client.observe(op, {}, { keep: true });
  assert.equal(joined.getSnapshot().data, true);
  f.clock.sample(f.serverDeadline, f.wall, f.wall, "server:1");
  await until(() => joined.getSnapshot().loading, "server expiry still withdraws during the held local wakeup");
});

for (const tier of ["online", "wasm", "process"]) test(`${tier} keep: one expiry subscriber's rollback cannot spare another expired watch`, async t => {
  const f = await fixture(t, tier), op = { kind: "query", name: "remote" }, idleOp = { ...op, name: "idle" };
  const active = f.client.observe(op, {}, { keep: true }), idle = f.client.observe(idleOp, {}, { keep: true });
  await until(() => active.getSnapshot().data === true && idle.getSnapshot().data === true);
  idle.close(); f.hold();
  if (tier !== "online") await f.offline();
  let duringCallback, remount, rolledBack = false;
  active.subscribe(() => {
    if (!rolledBack && active.getSnapshot().loading) {
      rolledBack = true;
      f.clock.sample(f.wall, f.wall, f.wall, "server:2");
      duringCallback = idle.getSnapshot();
      remount = f.client.observe(idleOp, {}, { keep: true });
    }
  });
  f.clock.sample(f.serverDeadline + 1, f.wall, f.wall, "server:1");
  await until(() => rolledBack);
  assert.deepEqual(duringCallback, { loading: true }, "all due snapshots withdraw before the first subscriber runs");
  assert.deepEqual(remount.getSnapshot(), { loading: true }, "rollback cannot expose the other watch on remount");
  if (tier !== "online") {
    const snapshots = [];
    remount.subscribe(() => snapshots.push(remount.getSnapshot()));
    f.release();
    await until(() => snapshots.length > 0);
    assert.ok(snapshots.every(read => !("data" in read)), JSON.stringify(snapshots));
    assert.equal((await f.client.query(idleOp, {})).denied?.code, "E_OFFLINE", "the other expired remembered entry was forgotten too");
  }
});

for (const tier of ["wasm", "process"]) for (const lingering of [false, true]) {
  test(`${tier} keep: expired remembered answer never returns after rollback and released reads (${lingering ? "lingering" : "active"})`, async t => {
    const f = await fixture(t, tier), op = { kind: "query", name: "branch" };
    assert.equal((await f.client.query(op, {})).data, true);
    await f.offline();
    const watch = f.client.observe(op, {}, { keep: true });
    await until(() => watch.getSnapshot().data === true);
    assert.equal(watch.getSnapshot().fresh, false);
    let withdrew = false;
    if (lingering) watch.close();
    else watch.subscribe(() => {
      if (!withdrew && watch.getSnapshot().loading) {
        withdrew = true;
        // Cleanup must precede notification: a subscriber can correct the clock.
        f.clock.sample(f.wall, f.wall, f.wall, "server:2");
      }
    });
    f.hold();
    const reads = f.localQueries();
    f.clock.sample(f.serverDeadline + 1, f.wall, f.wall, "server:1");
    await until(() => watch.getSnapshot().loading && f.localQueries() > reads, "expiry withdraws and starts a held replacement");
    if (lingering) f.clock.sample(f.wall, f.wall, f.wall, "server:2");
    else assert.equal(withdrew, true, "the subscriber rolled back the clock inside withdrawal");
    const joined = lingering ? f.client.observe(op, {}, { keep: true }) : watch;
    assert.deepEqual(joined.getSnapshot(), { loading: true });
    const snapshots = [];
    joined.subscribe(() => snapshots.push(joined.getSnapshot()));
    const serverReads = f.queries();
    f.release();
    await until(() => snapshots.length > 0, "held replacement finishes after rollback");
    assert.ok(snapshots.every(read => !("data" in read)), JSON.stringify(snapshots));
    assert.deepEqual(joined.getSnapshot(), { loading: true });
    assert.equal((await f.client.query(op, {})).denied?.code, "E_OFFLINE", "one-shot recovery cannot resurrect the entry either");
    assert.equal(f.queries(), serverReads, "no new server answer was supplied");
  });
}

for (const tier of ["wasm", "process"]) test(`${tier} keep: an older displayed deadline preserves a newer unexpired remembered answer`, async t => {
  const f = await fixture(t, tier), op = { kind: "query", name: "branch" };
  const watch = f.client.observe(op, {}, { keep: true });
  await until(() => watch.getSnapshot().data === true);
  f.answerDeadline(f.serverDeadline + 3_600_000);
  assert.equal((await f.client.query(op, {})).data, true, "a later one-shot answer replaces memory without replacing the watch");
  await f.offline();
  watch.close(); f.hold();
  const reads = f.localQueries();
  f.clock.sample(f.serverDeadline + 1, f.wall, f.wall, "server:1");
  await until(() => watch.getSnapshot().loading && f.localQueries() > reads);
  const joined = f.client.observe(op, {}, { keep: true });
  f.release();
  await until(() => joined.getSnapshot().data === true, "the newer answer is still recoverable");
  assert.equal(joined.getSnapshot().fresh, false);
});

for (const first of ["device", "server"]) test(`armReadExpiry: split clocks schedule the ${first} deadline in its own domain`, t => {
  let device = 1000, server = 2000;
  const timers = new Map();
  t.mock.method(globalThis, "setTimeout", (callback, delay) => { const id = { unref() {} }; timers.set(id, { callback, delay }); return id; });
  t.mock.method(globalThis, "clearTimeout", id => timers.delete(id));
  const clock = { deviceDelay: d => Math.max(0, d - device), serverDelay: d => Math.max(0, d - server) };
  const deadlines = { device: first === "device" ? 1100 : 4000, server: first === "server" ? 2100 : 2300, localWakeup: false };
  const watch = { expiryTimer: null }, expirations = [];
  armReadExpiry(watch, deadlines, clock, () => true, serverDue => expirations.push(serverDue));
  assert.equal(timers.size, 1);
  const timer = [...timers.values()][0];
  assert.equal(timer.delay, 100, "swapping deviceDelay and serverDelay schedules the wrong deadline");
  if (first === "device") device += 100; else server += 100;
  timer.callback();
  assert.deepEqual(expirations, [first === "server"]);
});

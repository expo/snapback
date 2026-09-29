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
import { peekObservation } from "../dist/observe-watch.js";
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
async function fixture(t, tier, refresh) {
  const { url, dir } = await server(t, undefined, source);
  const wall = Date.now(), serverDeadline = wall + 3_600_000, deviceNow = wall + 7_200_000, deviceDeadline = deviceNow + 100;
  const seeded = await fetch(url + "/seed", { method: "POST", headers: { "x-snapback-persona": "alice" }, body: JSON.stringify([
    { table: "localRows", row: { id: "private", expiresAt: deviceDeadline } },
    { table: "remoteRows", row: { id: "private", expiresAt: serverDeadline } },
  ]) }).then(r => r.json());
  assert.equal(seeded.seeded, 2);
  let now = wall;
  const clock = new ServerClock(() => now); clock.raiseIssued(deviceNow);
  let liveClock = clock, offline = false, hold = false, queries = 0, localQueries = 0, answerDeadline = serverDeadline;
  const fork = clock.fork.bind(clock); clock.fork = () => liveClock = fork();
  const gate = Promise.withResolvers();
  const bodyGate = Promise.withResolvers();
  let holdBody = false, bodiesHeld = 0, failedQueries = 0, failQueries = false;
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
    if (path.startsWith("/q/") && failQueries) { failedQueries++; throw Error("later query failed"); }
    if (offline) throw Error("controlled offline");
    if (path === "/changes") return parked(init.signal);
    const response = await fetch(input, init), json = await response.json();
    if (path.startsWith("/q/")) {
      queries++;
      if (hold) return Response.json({ loading: true, seq: json.seq, tables: json.tables });
      json.nextExpiry = answerDeadline;
      if (refresh !== undefined) json.refresh = refresh;
    }
    // Strip server samples: the fixture owns both clocks, and they disagree.
    const reply = Response.json(json, { status: response.status });
    if (path.startsWith("/q/") && holdBody) {
      holdBody = false; failQueries = true;
      const body = reply.json.bind(reply);
      reply.json = async () => { bodiesHeld++; await bodyGate.promise; return body(); };
    }
    return reply;
  }) };
  const client = tier === "online" ? createClient(options) : await createLocalClient(options);
  t.after(async () => { hold = false; gate.resolve(); bodyGate.resolve(); await client.close(); });
  if (client.sync) await client.sync();
  assert.equal(client.now(), deviceNow);
  assert.equal(liveClock.estimatedServerNow(), wall);
  return { client, clock: liveClock, wall, serverDeadline, deviceDeadline, advance: value => { now = value; }, queries: () => queries, localQueries: () => localQueries,
    hold: () => { hold = true; }, release: () => { hold = false; gate.resolve(); },
    holdBody: () => { holdBody = true; }, releaseBody: () => bodyGate.resolve(),
    bodiesHeld: () => bodiesHeld, failedQueries: () => failedQueries,
    answerDeadline: value => { answerDeadline = value; }, offline: async () => { offline = true; await client.sync(); } };
}

for (const keep of [undefined, true]) for (const tier of ["wasm", "process"]) for (const lingering of keep === true ? [false, true] : [false]) for (const exact of [false, true]) {
  test(`${tier} keep=${keep}: pre-expiry HTTP body cannot restore memory (${lingering ? "lingering" : "active"}, ${exact ? "exact deadline" : "rollback"})`, async t => {
    const f = await fixture(t, tier, exact ? undefined : 25), op = { kind: "query", name: "remote" };
    const watch = f.client.observe(op, {}, { keep });
    await until(() => watch.getSnapshot().data === true);
    if (lingering) watch.close();
    f.holdBody();
    const reading = exact ? f.client.query(op, {}) : undefined;
    await until(() => f.bodiesHeld() === 1, "background refetch reached its HTTP body");
    if (exact) f.hold(); // Do not let recovery itself clean memory before rollback.
    f.clock.sample(f.serverDeadline + (exact ? 0 : 1), f.wall, f.wall, "server:1");
    await until(() => watch.getSnapshot().loading, "expiry withdrew the remembered answer");
    const snapshots = [];
    const joined = lingering ? f.client.observe(op, {}, { keep }) : watch;
    joined.subscribe(() => snapshots.push(joined.getSnapshot()));
    if (!exact) f.clock.sample(f.wall, f.wall, f.wall, "server:2");
    const reads = f.queries();
    // Exact-boundary case releases at the deadline, before rolling back.
    if (exact) assert.equal(f.clock.estimatedServerNow(), f.serverDeadline);
    f.releaseBody();
    if (exact) {
      assert.deepEqual(await reading, { loading: true }, "the held body settles at the exact deadline");
      f.clock.sample(f.wall, f.wall, f.wall, "server:2");
      f.release();
    }
    await until(() => f.failedQueries() > 0 && snapshots.length > 0, "the released body and failed retry settled");
    assert.ok(snapshots.every(read => !("data" in read)), JSON.stringify(snapshots));
    assert.deepEqual(joined.getSnapshot(), { loading: true });
    assert.equal((await f.client.query(op, {})).denied?.code, "E_OFFLINE", "one-shot recovery cannot return the withdrawn answer");
    assert.equal(f.queries(), reads, "every later /q/ failed");
  });
}

for (const keep of [undefined, true]) for (const tier of ["wasm", "process"]) for (const lingering of keep === true ? [false, true] : [false]) {
  test(`${tier} keep=${keep}: displayed expiry fences an older body while preserving newer memory (${lingering ? "lingering" : "active"})`, async t => {
    const { url, dir } = await server(t, undefined, `use personas alice
table rows:
  body: text
  expiresAt: time
  expire at .expiresAt
  read <- allow
  insert <- allow
  update <- allow
  online only
query remote():
  return rows['private']
mutation put(body: text, expiresAt: time):
  upsert rows['private'] { body, expiresAt }
`);
    const wall = Date.now(), deadline = wall + 3_600_000, gate = Promise.withResolvers();
    let clock = new ServerClock(() => wall), holdBody = false, blocked = false, fail = false, failed = 0, captured;
    const fork = clock.fork.bind(clock); clock.fork = () => clock = fork();
    const put = async (body, expiresAt) => {
      const reply = await fetch(url + "/m/put", { method: "POST", headers: { "x-snapback-persona": "alice" },
        body: JSON.stringify({ id: body, args: { body, expiresAt } }) }).then(r => r.json());
      assert.equal(reply.state, "sent", JSON.stringify(reply));
    };
    await put("A", deadline);
    const client = await createLocalClient({ url, persona: "alice",
      device: tier === "wasm" ? webDevice({ wasm, persist: memoryPersistence() }) : processDevice({ binary, dir: join(dir, "device") }),
      fetch: clock.wrap(async (input, init) => {
        const path = new URL(input).pathname;
        if (path === "/changes") return parked(init.signal);
        if (path.startsWith("/q/") && fail) { failed++; throw Error("later query failed"); }
        const reply = await fetch(input, init);
        // Keep the actual server body; only the fixture controls clock samples.
        const response = new Response(reply.body, { status: reply.status });
        if (path.startsWith("/q/") && holdBody) {
          holdBody = false;
          const json = await response.json(); captured = json; blocked = true; fail = true;
          const held = Response.json(json);
          held.json = async () => { await gate.promise; return json; };
          return held;
        }
        return response;
      }) });
    t.after(async () => { gate.resolve(); await client.close(); });
    await client.sync();
    const op = { kind: "query", name: "remote" }, watch = client.observe(op, {}, { keep });
    await until(() => watch.getSnapshot().data?.body === "A");
    await put("B", deadline + 3_600_000);
    assert.equal((await client.query(op, {})).data?.body, "B", "B replaces memory without replacing displayed A");
    assert.equal(watch.getSnapshot().data.body, "A");
    if (lingering) watch.close();
    await put("old body", deadline);
    holdBody = true;
    clock.sample(wall - 100, wall, wall, "server:1"); // Begin a re-read before A expires.
    await until(() => blocked);
    assert.equal(captured.data.body, "old body");
    assert.equal(captured.nextExpiry, deadline);
    clock.sample(deadline, wall, wall, "server:2");
    assert.deepEqual(watch.getSnapshot(), { loading: true }, "displayed A withdraws at its own deadline");
    clock.sample(wall, wall, wall, "server:3");
    const joined = lingering ? client.observe(op, {}, { keep }) : watch, snapshots = [];
    joined.subscribe(() => snapshots.push(joined.getSnapshot()));
    gate.resolve();
    await until(() => failed > 0 && snapshots.some(read => read.data), "expired fetch finishes and recovery publishes");
    assert.ok(snapshots.every(read => !("data" in read) || read.data?.body === "B"), JSON.stringify(snapshots));
    assert.equal(joined.getSnapshot().data?.body, "B", "the old body cannot overwrite newer memory");
    assert.equal((await client.query(op, {})).data?.body, "B", "one-shot offline recovery preserves B too");
  });
}

for (const keep of [undefined, true]) for (const tier of ["online", "wasm", "process"]) test(`${tier} keep=${keep}: split-clock correction expires active and lingering answers; rollback cannot resurrect them`, async t => {
  const f = await fixture(t, tier), op = { kind: "query", name: "remote" };
  const active = f.client.observe(op, {}, { keep }), idle = f.client.observe({ ...op, name: "idle" }, {}, { keep });
  await until(() => active.getSnapshot().data === true && idle.getSnapshot().data === true);
  const initial = idle.getSnapshot(); if (keep === true) idle.close(); f.hold();
  assert.equal(peekObservation(f.client, { ...op, name: "idle" }, {}, { keep }), initial, "render peek sees the same lingering watch on every tier");
  assert.equal(initial.fresh, true, "server answer is fresh even though issued time is past its server deadline");
  assert.ok(f.clock.deviceDelay(f.serverDeadline) === 0 && f.clock.serverDelay(f.serverDeadline) === 3_600_000);
  f.clock.sample(f.serverDeadline, f.wall, f.wall, "server:1");
  // The original timer has an hour left. Only clock correction can withdraw now.
  for (let i = 0; i < 100 && !(active.getSnapshot().loading && idle.getSnapshot().loading); i++) await delay(5);
  assert.deepEqual(active.getSnapshot(), { loading: true }, "correction must re-arm the displayed answer's timer");
  assert.deepEqual(idle.getSnapshot(), { loading: true }, "a lingering watch keeps that same clock subscription");
  assert.deepEqual(peekObservation(f.client, { ...op, name: "idle" }, {}, { keep }), { loading: true });
  f.clock.sample(f.wall, f.wall, f.wall, "server:2");
  assert.ok(f.client.now() > f.clock.estimatedServerNow(), "server rollback does not lower issued device time");
  const remount = f.client.observe({ ...op, name: "idle" }, {}, { keep });
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

for (const entry of ["correction", "timer"]) for (const tier of ["online", "wasm", "process"]) test(`${tier} keep: one expiry subscriber's rollback cannot spare another expired watch (${entry})`, async t => {
  const timers = new Map(), setTimer = globalThis.setTimeout, clearTimer = globalThis.clearTimeout;
  if (entry === "timer") {
    t.mock.method(globalThis, "setTimeout", (callback, ms, ...args) => {
      if (ms !== 3_600_000) return setTimer(callback, ms, ...args);
      const id = { unref() {} }; timers.set(id, callback); return id;
    });
    t.mock.method(globalThis, "clearTimeout", id => { if (!timers.delete(id)) clearTimer(id); });
  }
  const f = await fixture(t, tier), op = { kind: "query", name: "remote" }, idleOp = { ...op, name: "idle" };
  const active = f.client.observe(op, {}, { keep: true });
  await until(() => active.getSnapshot().data === true);
  const idle = f.client.observe(idleOp, {}, { keep: true });
  await until(() => active.getSnapshot().data === true && idle.getSnapshot().data === true);
  idle.close(); f.hold();
  if (tier !== "online") await f.offline();
  let duringCallback, remount, rolledBack = false;
  active.subscribe(() => {
    if (!rolledBack && active.getSnapshot().loading) {
      rolledBack = true;
      const now = entry === "timer" ? f.serverDeadline + 1 : f.wall;
      f.clock.sample(f.wall, now, now, "server:2");
      duringCallback = idle.getSnapshot();
      remount = f.client.observe(idleOp, {}, { keep: true });
    }
  });
  if (entry === "timer") {
    assert.equal(timers.size, 2, "both watches have an expiry timer");
    f.advance(f.serverDeadline + 1); // Time advances without a clock-correction notification.
    const [id, fire] = timers.entries().next().value;
    timers.delete(id); fire(); // Deliver only the active watch's timer.
  } else f.clock.sample(f.serverDeadline + 1, f.wall, f.wall, "server:1");
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


test("armReadExpiry: long deadlines clamp and rearm without premature expiry", t => {
  const limit = 2_147_483_647, timers = new Map(); let now = 0, expired = 0;
  t.mock.method(globalThis, "setTimeout", (callback, delay) => { const id = { unref() {} }; timers.set(id, { callback, delay }); return id; });
  t.mock.method(globalThis, "clearTimeout", id => timers.delete(id));
  const clock = { deviceDelay: d => Math.max(0, d - now), serverDelay: d => Math.max(0, d - now) };
  const deadlines = { device: null, server: limit + 100, localWakeup: false }, watch = { expiryTimer: null };
  armReadExpiry(watch, deadlines, clock, () => true, () => { expired++; });
  const fire = () => { const [id, timer] = timers.entries().next().value; timers.delete(id); timer.callback(); };
  assert.equal(timers.get(watch.expiryTimer).delay, limit);
  now = limit; fire();
  assert.equal(expired, 0);
  assert.equal(watch.deadlines, deadlines);
  assert.equal(timers.get(watch.expiryTimer).delay, 100);
  now += 100; fire();
  assert.equal(expired, 1);
  assert.equal(watch.deadlines, deadlines, "the triggering deadline remains visible to the sweep");
});

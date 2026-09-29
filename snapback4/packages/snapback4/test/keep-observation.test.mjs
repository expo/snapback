import { readyRead } from "../dist/read-presence.js";
import test from "node:test";
import assert from "node:assert/strict";
import { setTimeout as delay } from "node:timers/promises";
import { answerIdentity, ReadObservation } from "../dist/read-observation.js";
import { LocalReads } from "../dist/local-reads.js";
import { bindWatchPeek, peekObservation, observeWatch } from "../dist/observe-watch.js";
import { guardClient } from "../dist/app-client.js";
import { createClient } from "../dist/client.js";
import { createApp } from "../dist/app.js";
import { keepSession, memorySessionStore } from "../dist/auth.js";
import { ServerClock } from "../dist/clock.js";
const ready = data => (readyRead({ data, complete: true, cut: null, fresh: true, next: null }));
const why = { code: "HIDDEN", family: "rule", message: "no longer visible" };
const deferred = () => { let resolve; const promise = new Promise(r => { resolve = r; }); return { promise, resolve }; };
async function until(check) { for (let i = 0; i < 600; i++) { if (check()) return; await delay(5); } assert.fail("read did not settle"); }
const q = { kind: "query", name: "secret" };

test("peeking a lingering watch neither acquires it nor changes its timer or expiry boundary", t => {
  let now = 0, closed = 0, blocked = false;
  const timers = new Map(), watches = new Map();
  t.mock.method(performance, "now", () => now);
  t.mock.method(globalThis, "setTimeout", (callback, delay) => { const id = { unref() {} }; timers.set(id, { callback, delay }); return id; });
  t.mock.method(globalThis, "clearTimeout", id => timers.delete(id));
  const client = { observe() { assert.fail("peek must not acquire"); } };
  bindWatchPeek(client, watches, () => blocked ? why : null);
  const handle = observeWatch(watches, 'keep:secret:{}', () => Object.assign(new ReadObservation(true), {
    key: 'keep:secret:{}', subscribers: new Set(), expiryTimer: null, presenceRefresh: null,
  }), watch => watch.publish(ready("secret")), () => { closed++; }, () => null);
  handle.close();
  const watch = watches.values().next().value, linger = watch.lingering, snapshot = handle.getSnapshot();
  now = 29_999;
  assert.equal(peekObservation(client, q, {}, { keep: true }), snapshot);
  assert.equal(peekObservation(client, q, {}, { keep: false }), undefined);
  assert.equal(peekObservation(client, q, { other: true }, { keep: true }), undefined);
  blocked = true;
  assert.equal(peekObservation(client, q, {}, { keep: true }), undefined);
  assert.equal(watch.snapshot, snapshot, "peek never invokes the mutating read/refusal path");
  blocked = false; now = 30_000;
  assert.equal(peekObservation(client, q, {}, { keep: true }), undefined, "boundary holds before the timer runs");
  assert.equal(watch.lingering, linger);
  assert.equal(timers.size, 1, "peek never cancels the linger timer");
  assert.equal(closed, 0, "peek never closes or acquires a watch");
  timers.get(linger.timer).callback();
  assert.equal(closed, 1);
  now = 0;
  assert.equal(peekObservation(client, q, {}, { keep: true }), undefined);
});

test("app peek reuses only a live authorized snapshot and cannot cross withdrawal or retirement", async t => {
  let hold = false;
  const authority = deferred(), source = new ReadObservation(true), listeners = new Set();
  source.publish(ready("secret"));
  const raw = { observe: () => ({ getSnapshot: () => source.snapshot,
    subscribe: notify => { listeners.add(notify); return () => listeners.delete(notify); }, close() {} }) };
  bindWatchPeek(raw, new Map([['keep:secret:{}', source]]), () => null);
  const facade = guardClient(raw, () => hold ? authority.promise : Promise.resolve(true), () => true, () => why);
  const watch = facade.client.observe(q, {}, { keep: true });
  t.after(() => { authority.resolve(true); watch.close(); facade.fence()(); });
  assert.equal(peekObservation(facade.client, q, {}, { keep: true }), undefined, "unapproved data is never peeked");
  await until(() => watch.getSnapshot().data === "secret");
  assert.equal(peekObservation(facade.client, q, {}, { keep: true }), source.snapshot);
  hold = true;
  const remount = facade.client.observe(q, {}, { keep: true });
  source.reset({ loading: true });
  for (const notify of listeners) notify();
  assert.deepEqual(remount.getSnapshot(), { loading: true }, "an opening facade still sees synchronous withdrawal");
  source.publish(ready("replacement"));
  for (const notify of listeners) notify();
  assert.equal(peekObservation(facade.client, q, {}, { keep: true }), undefined, "new data still needs authority");
  authority.resolve(true);
  await until(() => remount.getSnapshot().data === "replacement");
  assert.equal(peekObservation(facade.client, q, {}, { keep: true }), source.snapshot);
  facade.fence()();
  assert.equal(peekObservation(facade.client, q, {}, { keep: true }), undefined);
  remount.close();
});


test("facade approval follows freshness identity but never a new publication or reset", async t => {
  const authority = deferred(), source = new ReadObservation(true), listeners = new Set(); let hold = false;
  const data = { text: "same payload" }, publication = ready(data);
  source.publish(publication);
  const raw = { observe: () => ({ getSnapshot: () => source.snapshot,
    subscribe: notify => { listeners.add(notify); return () => listeners.delete(notify); }, close() {} }) };
  bindWatchPeek(raw, new Map([['keep:secret:{}', source]]), () => null);
  const facade = guardClient(raw, () => hold ? authority.promise : Promise.resolve(true), () => true, () => why);
  const watch = facade.client.observe(q, {}, { keep: true }), seen = [];
  watch.subscribe(() => seen.push(watch.getSnapshot()));
  t.after(() => { authority.resolve(true); watch.close(); facade.fence()(); });
  await until(() => watch.getSnapshot().data === data);
  const original = source.snapshot, identity = answerIdentity(original);
  hold = true;
  source.reload();
  for (const notify of listeners) notify();
  assert.notEqual(source.snapshot, original);
  assert.equal(answerIdentity(source.snapshot), identity);
  assert.equal(watch.getSnapshot().data, data, "freshness alone does not withdraw an approved answer");
  assert.equal(watch.getSnapshot().fresh, true, "freshness metadata reaches the facade synchronously");
  assert.equal(peekObservation(facade.client, q, {}, { keep: true }), source.snapshot);
  assert.ok(seen.every(read => "data" in read), "no loading notification for staleness");
  for (const replace of [() => source.publish(publication), () => source.reset(publication)]) {
    replace();
    for (const notify of listeners) notify();
    assert.notEqual(answerIdentity(source.snapshot), identity, "even the identical payload and Read object need new authority");
    assert.equal(answerIdentity(original), identity, "old snapshot identity is immutable");
    if (source.resetVersion === 0) {
      assert.equal(watch.getSnapshot().data, data, "the last approval stays while a publication waits");
      assert.equal(watch.getSnapshot().fresh, true);
      assert.equal(peekObservation(facade.client, q, {}, { keep: true }), watch.getSnapshot());
    } else {
      assert.equal(peekObservation(facade.client, q, {}, { keep: true }), undefined);
      assert.deepEqual(watch.getSnapshot(), { loading: true }, "a scope reset still drops the approval");
    }
  }
  authority.resolve(true);
  await until(() => watch.getSnapshot().data === data);
  assert.equal(peekObservation(facade.client, q, {}, { keep: true }), source.snapshot);
});

for (const op of ["apply", "admit", "settle", "clear_rows", "settle_exit", "adopt", "observe_store"]) {
  test(`local keep: ${op} fences in-flight answers and ${["apply", "admit", "settle"].includes(op) ? "keeps" : "drops"} active and lingering data`, async () => {
    const reads = new LocalReads(), held = deferred();
    const keep = Object.assign(new ReadObservation(true), { expiryTimer: null, presenceRefresh: null });
    const plain = Object.assign(new ReadObservation(false), { expiryTimer: null, presenceRefresh: null });
    keep.publish(ready("before")); plain.publish(ready("before"));
    const watches = new Map();
    const idleHandle = observeWatch(watches, "idle", () => Object.assign(new ReadObservation(true), {
      key: "idle", subscribers: new Set(), expiryTimer: null, presenceRefresh: null,
    }), watch => watch.publish(ready("idle")), () => {}, () => null);
    idleHandle.close();
    const idle = watches.get("idle");
    const revision = reads.revision;
    const work = keep.fetch(() => held.promise, () => {}, { accept: () => reads.revision === revision });
    if (["adopt", "observe_store"].includes(op)) reads.clear([keep, plain, idle]);
    else reads.committed([keep, plain, idle], op);
    const retained = ["apply", "admit", "settle"].includes(op);
    assert.equal("data" in keep.snapshot, retained);
    if (retained) { assert.equal(keep.snapshot.fresh, true); assert.equal(keep.snapshot.revalidating, true); }
    assert.equal("data" in idle.snapshot, retained);
    assert.deepEqual(plain.snapshot, { loading: true });
    held.resolve({ read: ready("obsolete") }); await work;
    assert.notEqual(keep.snapshot.data, "obsolete", "old evaluation cannot republish across any commit or reset");
    keep.publish({ denied: why });
    assert.deepEqual(keep.snapshot, { denied: why }, "a refusal replaces a kept answer");
    idle.lingering.close();
  });
}

test("keep carries original freshness through reload, and every published result replaces it", async () => {
  const watch = new ReadObservation(true);
  const initial = { ...ready(["old"]), fresh: false, since: Date.now() - 60_000 };
  for (const read of [{ loading: true }, ready(null), ready([]), { denied: why }]) {
    watch.publish(initial);
    const since = watch.snapshot.since;
    const held = deferred(), work = watch.fetch(() => held.promise, () => {});
    assert.equal(watch.snapshot.since, since);
    assert.equal(watch.snapshot.revalidating, true);
    assert.deepEqual(watch.snapshot.data, ["old"]);
    held.resolve({ read }); await work;
    assert.deepEqual(watch.snapshot, read);
  }
});

test("rejoining at 29 seconds cancels the old close and gives the next unsubscribe a full window", t => {
  t.mock.timers.enable({ apis: ["setTimeout", "Date"], now: 1000 });
  t.mock.method(performance, "now", () => Date.now());
  const watches = new Map(); let starts = 0, stops = 0;
  const open = () => observeWatch(watches, "key", () => Object.assign(new ReadObservation(true), {
    key: "key", subscribers: new Set(), expiryTimer: null, presenceRefresh: null,
  }), watch => { starts++; watch.publish(ready("live")); }, () => stops++, () => null);
  const first = open(), observed = watches.get("key");
  first.close();
  t.mock.timers.tick(29_000);
  const joined = open(), unsubscribe = joined.subscribe(() => {});
  t.mock.timers.tick(1_001);
  assert.equal(watches.get("key"), observed, "the original deadline cannot close a subscribed watch");
  assert.equal(joined.getSnapshot().data, "live");
  assert.equal(starts, 1); assert.equal(stops, 0);
  unsubscribe();
  t.mock.timers.tick(29_999);
  assert.equal(watches.get("key"), observed, "the next unsubscribe starts a new full window");
  assert.equal(stops, 0);
  t.mock.timers.tick(1);
  assert.equal(watches.size, 0); assert.equal(stops, 1);
  assert.deepEqual(joined.getSnapshot(), { loading: true });
});

test("lingering watches close on the 30-second timer and cannot return after clock rollback", t => {
  t.mock.timers.enable({ apis: ["setTimeout", "Date"], now: 1000 });
  const watches = new Map(); let stops = 0;
  let expired = 0, refreshed = 0;
  const open = () => observeWatch(watches, "key", () => Object.assign(new ReadObservation(true), {
    key: "key", subscribers: new Set(), expiryTimer: null, presenceRefresh: null,
  }), () => {}, () => stops++, () => null);
  const watch = open(), observed = watches.get("key");
  observed.publish(ready("old"));
  observed.expiryTimer = setTimeout(() => expired++, 60_000);
  observed.presenceRefresh = setTimeout(() => refreshed++, 60_000);
  const expiry = observed.expiryTimer, presence = observed.presenceRefresh;
  const cancel = t.mock.method(globalThis, "clearTimeout");
  watch.close();
  assert.equal(watches.size, 1);
  t.mock.timers.tick(29_999);
  assert.equal(cancel.mock.callCount(), 0, "expiry and presence stay armed while lingering");
  t.mock.timers.tick(1);
  assert.ok(cancel.mock.calls.some(call => call.arguments[0] === expiry), "close cancels the installed expiry timer");
  assert.ok(cancel.mock.calls.some(call => call.arguments[0] === presence), "close cancels the installed presence timer");
  assert.equal(observed.expiryTimer, null);
  assert.equal(observed.presenceRefresh, null);
  t.mock.timers.tick(30_000);
  assert.equal(expired, 0, "the closed watch's expiry callback never runs");
  assert.equal(refreshed, 0, "the closed watch's presence callback never runs");
  t.mock.timers.setTime(1000);
  assert.equal(watches.size, 0); assert.equal(stops, 1);
  assert.deepEqual(watch.getSnapshot(), { loading: true });
  assert.deepEqual(open().getSnapshot(), { loading: true });
});

async function online(t) {
  const polls = [], releases = [];
  let seq = 10, generation = 1, store = "A", holding = false, answer = "private", reads = 0;
  const session = { kind: "user", token: "old", principal: "alice", expiresAt: Date.now() + 90 * 86400000 };
  let nextPrincipal = "alice";
  const client = createClient({ url: "http://keep.test", session, fetch: async (input, init) => {
    const path = new URL(input).pathname;
    const head = { seq, generation, store_id: store, tables: ["secrets"] };
    if (path === "/schema") return Response.json({ generation, schema: { tables: {} }, programs: [] });
    if (path === "/changes") {
      const next = deferred(); polls.push(next);
      init.signal.addEventListener("abort", () => next.resolve(head), { once: true });
      return Response.json(await next.promise);
    }
    if (path === "/probe") return Response.json({ ok: true, ...head });
    if (path === "/auth/refresh") return Response.json({ ok: true, session: { ...session, token: "new", principal: nextPrincipal } });
    if (path === "/auth/logout") return Response.json({ ok: true });
    if (path.startsWith("/m/")) return Response.json({ state: "sent", id: JSON.parse(init.body).id, seq: ++seq, store_id: store });
    if (path.startsWith("/q/")) {
      reads++;
      const result = answer === "denied" ? { denied: why, ...head } : { ...ready(answer), ...head };
      if (holding) { const release = deferred(); releases.push(release); await release.promise; }
      return Response.json(result);
    }
    throw Error(path);
  } });
  t.after(async () => { for (const release of releases) release.resolve(); await client.close(); });
  const live = client.observe(q, {}, { keep: true }); live.subscribe(() => {});
  const idle = client.observe(q, { idle: true }, { keep: true });
  await until(() => live.getSnapshot().data === "private" && idle.getSnapshot().data === "private" && polls.length);
  // Establish the poll's generation before testing a later adoption.
  polls.shift().resolve({ seq, generation, store_id: store, tables: [] });
  await until(() => polls.length);
  idle.close();
  return { client, live, idle, polls, releases, reads: () => reads,
    hold: value => { holding = value; }, answer: value => { answer = value; },
    principal: value => { nextPrincipal = value; },
    async change(patch = {}) {
      const head = { seq: ++seq, generation, store_id: store, tables: ["secrets"], ...patch };
      generation = head.generation; store = head.store_id;
      await until(() => polls.length);
      polls.shift().resolve(head);
    },
  };
}

for (const trigger of ["mutation", "notification"]) for (const outcome of ["next", "denied"]) test(`online keep: ${trigger} waits without loading, then publishes ${outcome}`, async t => {
  const f = await online(t), values = [];
  f.live.subscribe(() => values.push(f.live.getSnapshot()));
  f.hold(true); f.answer(outcome);
  const before = f.reads();
  if (trigger === "mutation") await f.client.mutate({ kind: "mutation", name: "edit" }, {});
  else await f.change();
  await until(() => f.reads() > before);
  assert.equal(f.live.getSnapshot().data, "private", "revoked/changed answer stays until the replacement read lands");
  assert.equal(f.live.getSnapshot().fresh, true);
  assert.equal(f.live.getSnapshot().revalidating, true);
  // An ordinary notification must not evict idle opt-in answers either.
  const remount = f.client.observe(q, { idle: true }, { keep: true });
  assert.equal(remount.getSnapshot().data, "private"); remount.close();
  f.hold(false); for (const release of f.releases) release.resolve();
  await until(() => outcome === "denied" ? f.live.getSnapshot().denied?.code === why.code : f.live.getSnapshot().data === "next");
  assert.ok(values.every(read => !("loading" in read)), JSON.stringify(values));
});

for (const reset of ["adoption", "replacement", "regression", "credentials", "viewer", "sign-out", "close"]) test(`online keep: ${reset} clears active and lingering answers`, async t => {
  const f = await online(t);
  f.hold(true);
  let ending;
  if (reset === "adoption") await f.change({ generation: 2 });
  if (reset === "replacement") await f.change({ store_id: "B" });
  if (reset === "regression") await f.change({ seq: 1 });
  if (reset === "credentials" || reset === "viewer") {
    if (reset === "viewer") f.principal("bob");
    ending = f.client.refreshSession();
  }
  if (reset === "sign-out") ending = f.client.signOut();
  if (reset === "close") ending = f.client.close();
  await until(() => !("data" in f.live.getSnapshot()));
  const remount = f.client.observe(q, { idle: true }, { keep: true });
  assert.ok(!("data" in remount.getSnapshot()), "the reset also retired lingering snapshots");
  f.hold(false); for (const release of f.releases) release.resolve();
  if (ending) await ending;
  if (["adoption", "credentials"].includes(reset)) {
    await until(() => remount.getSnapshot().data === "private");
    assert.deepEqual(f.idle.getSnapshot(), { loading: true }, "scope-ending reset closes the original lingering observation");
  }
  if (["replacement", "regression", "viewer", "sign-out", "close"].includes(reset)) assert.ok(!("data" in f.live.getSnapshot()), "late replies cannot restore a revoked lifetime");
});

test("online keep: an in-flight answer read before a newer commit never replaces the kept answer", async t => {
  const f = await online(t), values = [];
  f.live.subscribe(() => values.push(f.live.getSnapshot()));
  f.answer("obsolete"); f.hold(true);
  await f.client.mutate({ kind: "mutation", name: "edit" }, {});
  await until(() => f.releases.length > 0);
  f.answer("current");
  await f.client.mutate({ kind: "mutation", name: "edit" }, {});
  assert.equal(f.live.getSnapshot().data, "private");
  f.hold(false); for (const release of f.releases) release.resolve();
  await until(() => f.live.getSnapshot().data === "current");
  assert.ok(values.every(read => read.data !== "obsolete" && !("loading" in read)), JSON.stringify(values));
});


test("the app client forwards keep while its lifetime fence still withdraws data", async t => {
  const f = await online(t);
  const facade = guardClient(f.client, async () => true, () => true, () => why);
  const watch = facade.client.observe(q, {}, { keep: true });
  await until(() => watch.getSnapshot().data === "private");
  f.hold(true); f.answer("next");
  await f.client.mutate({ kind: "mutation", name: "edit" }, {});
  await until(() => f.releases.length > 0 && watch.getSnapshot().revalidating === true);
  assert.equal(watch.getSnapshot().data, "private");
  const notify = facade.fence(); notify();
  assert.deepEqual(watch.getSnapshot(), { denied: why });
  f.hold(false); for (const release of f.releases) release.resolve();
  await delay(10);
  assert.deepEqual(watch.getSnapshot(), { denied: why });
});

test("createApp forwards source expiry while sessionStore.get is held", async t => {
  const url = "http://app-keep-expiry.test", wall = Date.now(), deadline = wall + 3_600_000;
  const clock = new ServerClock(() => wall), memory = memorySessionStore(), held = deferred();
  const session = { kind: "user", token: "kept", principal: "alice", expiresAt: wall + 90 * 86400000 };
  await keepSession(url, session, memory);
  let holding = false, blocked = 0;
  const app = createApp({ url, sessionStore: { ...memory, async get(key) {
    if (holding) { blocked++; await held.promise; }
    return memory.get(key);
  } }, fetch: clock.wrap(async (input, init) => {
    const path = new URL(input).pathname;
    if (path === "/schema") return Response.json({ schema: { tables: {} }, programs: [] });
    if (path === "/changes") return new Promise((_, reject) => init.signal.addEventListener("abort", () => reject(Error("closed")), { once: true }));
    if (path === "/probe") return Response.json({ ok: true, principal: "alice" });
    if (path.startsWith("/q/")) return Response.json({ ...ready("expires"), nextExpiry: deadline });
    throw Error(path);
  }) });
  t.after(async () => { holding = false; held.resolve(); await app.close(); });
  assert.equal((await app.ready).ok, true);
  const watch = app.client.observe(q, {}, { keep: true }), snapshots = [];
  watch.subscribe(() => snapshots.push(watch.getSnapshot()));
  await until(() => watch.getSnapshot().data === "expires" && watch.getSnapshot().fresh);
  holding = true; snapshots.length = 0;
  clock.sample(deadline + 1, wall, wall, "server:1");
  await until(() => blocked > 0);
  await delay(10);
  assert.deepEqual(watch.getSnapshot(), { loading: true }, "session storage cannot hold an expired row on screen");
  assert.ok(snapshots.some(read => read.loading), "the source withdrawal notifies the app subscriber before storage resumes");
});

for (const keep of [undefined, true, false]) test(`createApp ${keep !== false ? "keeps" : "withdraws"} a superseded answer while replacement authority is held`, async t => {
  const url = "http://app-keep-expiry.test", wall = Date.now(), deadline = wall + 3_600_000;
  const clock = new ServerClock(() => wall), memory = memorySessionStore(), held = deferred();
  const session = { kind: "user", token: "kept", principal: "alice", expiresAt: wall + 90 * 86400000 };
  await keepSession(url, session, memory);
  let holding = false, blocked = 0, queries = 0;
  const replacement = deferred();
  const app = createApp({ url, sessionStore: { ...memory, async get(key) {
    if (holding) { blocked++; await held.promise; }
    return memory.get(key);
  } }, fetch: clock.wrap(async (input, init) => {
    const path = new URL(input).pathname;
    if (path === "/schema") return Response.json({ schema: { tables: {} }, programs: [] });
    if (path === "/changes") return new Promise((_, reject) => init.signal.addEventListener("abort", () => reject(Error("closed")), { once: true }));
    if (path === "/probe") return Response.json({ ok: true, principal: "alice" });
    if (path.startsWith("/q/")) {
      if (++queries === 1) return Response.json({ ...ready("A"), nextExpiry: deadline, refresh: 250 });
      await replacement.promise;
      return Response.json({ ...ready("B"), nextExpiry: deadline + 3_600_000 });
    }
    throw Error(path);
  }) });
  t.after(async () => { holding = false; held.resolve(); replacement.resolve(); await app.close(); });
  assert.equal((await app.ready).ok, true);
  const watch = app.client.observe(q, {}, { keep }), snapshots = [];
  watch.subscribe(() => snapshots.push(watch.getSnapshot()));
  await until(() => watch.getSnapshot().data === "A" && watch.getSnapshot().fresh);
  await until(() => queries === 2); // Raw background read is already past session storage.
  holding = true; snapshots.length = 0;
  replacement.resolve();
  await until(() => blocked > 0);
  if (keep !== false) {
    assert.equal(watch.getSnapshot().data, "A");
    assert.equal(watch.getSnapshot().fresh, true);
    assert.equal(watch.getSnapshot().revalidating, true);
    assert.ok(snapshots.every(read => read.data === "A"));
    const remount = app.client.observe(q, {}, { keep });
    assert.equal(remount.getSnapshot(), watch.getSnapshot(), "remount starts with A while B waits");
    remount.close();
  } else assert.deepEqual(watch.getSnapshot(), { loading: true });
  snapshots.length = 0;
  clock.sample(deadline + 1, wall, wall, "server:1");
  await delay(10);
  assert.deepEqual(watch.getSnapshot(), { loading: true }, "superseded A cannot remain visible past its own deadline");
  if (keep !== false) assert.ok(snapshots.some(read => read.loading), "A's own expiry notifies before authority resumes");
  assert.ok(snapshots.every(read => !("data" in read)), "B still needs authority");
  holding = false; held.resolve();
  await until(() => watch.getSnapshot().data === "B");
});

for (const withdrawn of [{ loading: true }, { denied: why }]) test(`app facade forwards ${"loading" in withdrawn ? "loading" : "denied"} synchronously but gates replacement data`, async () => {
  const authority = deferred(), listeners = new Set(); let hold = false, snapshot = ready("old");
  const source = { getSnapshot: () => snapshot, subscribe(listener) { listeners.add(listener); return () => listeners.delete(listener); }, close() {} };
  const facade = guardClient({ observe: () => source }, () => hold ? authority.promise : Promise.resolve(true), () => true, () => why);
  const watch = facade.client.observe(q, {}, { keep: true }), seen = [];
  watch.subscribe(() => seen.push(watch.getSnapshot()));
  await until(() => watch.getSnapshot().data === "old");
  hold = true; snapshot = ready("waiting");
  for (const listener of listeners) listener();
  assert.deepEqual(watch.getSnapshot(), { loading: true }, "superseded data withdraws while replacement waits for authority");
  snapshot = withdrawn;
  for (const listener of listeners) listener();
  assert.deepEqual(watch.getSnapshot(), withdrawn, "withdrawal is synchronous");
  assert.deepEqual(seen.at(-1), withdrawn, "notification is synchronous too");
  snapshot = ready("new");
  for (const listener of listeners) listener();
  assert.deepEqual(watch.getSnapshot(), withdrawn, "replacement data still waits for authority");
  authority.resolve(true);
  await until(() => watch.getSnapshot().data === "new");
  watch.close(); facade.fence()();
});

test("online keep preserves the existing expiry withdrawal before a held refetch", async t => {
  let now = Date.now();
  t.mock.method(Date, "now", () => now);
  const held = deferred(); let reads = 0;
  const client = createClient({ url: "http://keep-expiry.test", persona: "alice", fetch: async (input, init) => {
    if (new URL(input).pathname === "/changes") return new Promise((_, reject) => init.signal.addEventListener("abort", () => reject(Error("closed")), { once: true }));
    if (new URL(input).pathname === "/schema") return Response.json({ schema: { tables: {} }, programs: [] });
    if (++reads === 1) return Response.json({ ...ready("expires"), nextExpiry: Date.now() + 100 });
    await held.promise; return Response.json(ready(null));
  } });
  t.after(async () => { held.resolve(); await client.close(); });
  const watch = client.observe(q, {}, { keep: true });
  await until(() => watch.getSnapshot().data === "expires");
  now += 99;
  assert.equal(watch.getSnapshot().data, "expires");
  now += 1;
  await until(() => reads === 2);
  assert.deepEqual(watch.getSnapshot(), { loading: true });
  held.resolve(); await until(() => watch.getSnapshot().data === null);
});

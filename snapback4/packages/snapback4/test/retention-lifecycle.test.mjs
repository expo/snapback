// @ref LLP 3000.023#3.4 — lifecycle withdrawals finish across peers before application callbacks.
import test from "node:test";
import assert from "node:assert/strict";
import { setTimeout as delay } from "node:timers/promises";
import { createClient } from "../dist/client.js";
import { createLocalClient } from "../dist/local.js";
import { guardClient } from "../dist/app-client.js";
import { createApp } from "../dist/app.js";
import { keepSession, memorySessionStore } from "../dist/auth.js";
import { answerIdentity, answerObservation } from "../dist/read-observation.js";
import { peekObservation } from "../dist/observe-watch.js";
import { ServerClock } from "../dist/clock.js";
import { modelBackend, modelDevice, modelPage } from "./helpers/app-model-device.mjs";

const q = { kind: "query", name: "viewer" }, peerQuery = { kind: "query", name: "peer" };
const backend = { ...modelBackend, schema: { ...modelBackend.schema, operations: { ...modelBackend.schema.operations, peer: { runs: "server" } } },
  programs: [...modelBackend.programs, { ...modelBackend.programs[0], name: "peer" }] };
const parked = signal => new Promise((_, reject) => {
  if (signal.aborted) reject(signal.reason);
  else signal.addEventListener("abort", () => reject(signal.reason), { once: true });
});
async function until(check) {
  for (let n = 0; n < 500; n++) { if (check()) return; await delay(2); }
  assert.fail("lifecycle boundary did not settle");
}
async function fixture(t, tier, appFacade = false) {
  let wall = 1000, failing = false, held = false, holdDevice = false, queries = 0, discovering = false;
  let data = "private A", nextExpiry = 5000, seq = 1, replacementDelivered = false;
  const loss = Promise.withResolvers(), deviceGate = Promise.withResolvers();
  const opener = modelDevice();
  const device = { async open(...args) {
    const core = await opener.open(...args);
    return { ...core, async call(request, notify) {
      if (holdDevice && request.op === "query") await deviceGate.promise;
      return core.call(request, notify);
    } };
  } };
  const clock = new ServerClock(() => wall);
  const options = { url: "http://read-lifecycle.test", persona: "alice", device, fetch: clock.wrap(async (input, init) => {
    const path = new URL(input).pathname;
    if (path === "/schema") {
      if (tier === "online") { discovering = true; return parked(init.signal); }
      return Response.json(backend);
    }
    if (path === "/sync") return Response.json(modelPage(1, JSON.parse(init.body)));
    if (path === "/probe") return appFacade
      ? Response.json({ ok: true, principal: "alice", store_id: "session-model-store", seq: 1 }) : parked(init.signal);
    if (path === "/changes") {
      if (replacementDelivered) return parked(init.signal);
      const event = await Promise.race([loss.promise, parked(init.signal)]);
      if (event === "offline") throw Error("controlled link loss");
      if (event === "replacement") {
        replacementDelivered = true;
        return Response.json({ seq, generation: 1, tables: ["remote"] });
      }
      return Response.json({ seq: 2, generation: 1, tables: ["remote"] }, { headers: { "x-snapback-ephemeral": "1" } });
    }
    assert.ok(path === "/q/viewer" || path === "/q/peer");
    queries++;
    if (failing) throw Error("offline after rollback");
    if (held) return parked(init.signal);
    return Response.json({ data, complete: true, tables: ["remote"], seq, nextExpiry });
  }) };
  let app, raw;
  if (appFacade) {
    const sessionStore = memorySessionStore();
    await keepSession(options.url, { token: "alice", principal: "alice", kind: "guest", expiresAt: Date.now() + 30 * 86400_000 }, sessionStore);
    app = createApp({ url: options.url, fetch: options.fetch, sessionStore, ...(tier === "wasm" ? { device } : {}) });
    assert.equal((await app.ready).ok, true);
    raw = app.client;
  } else raw = tier === "online" ? createClient(options) : await createLocalClient(options);
  t.after(async () => { deviceGate.resolve(); await (app ? app.close() : raw.close()); });
  if (raw.sync) await raw.sync();
  return { raw, wall(n) { wall = n; }, queries: () => queries, discovering: () => discovering,
    answer(value, expiry) { data = value; nextExpiry = expiry; },
    async replace() { if (raw.sync) await raw.sync(); else { seq++; loss.resolve("replacement"); } },
    holdDevice() { holdDevice = true; }, fail() { failing = true; },
    trigger(boundary) { held = true; if (boundary === "close") return raw.close(); if (boundary === "sign-out") return raw.signOut(); loss.resolve(boundary); } };
}

for (const tier of ["online", "wasm"]) for (const mode of ["guard", "createApp"]) for (const livePeer of [false, true]) for (const keep of [undefined, false, true]) {
  test(`${tier} ${mode}: closed facade honors row expiry, live peer=${livePeer}, keep=${keep}`, async t => {
    const f = await fixture(t, tier, mode === "createApp");
    const facade = mode === "guard" ? guardClient(f.raw, async () => true, () => true,
      () => ({ code: "E_AUTH", family: "auth", message: "closed" })) : undefined;
    t.after(() => facade?.fence()());
    const client = facade?.client ?? f.raw, options = keep === undefined ? undefined : { keep };
    const closed = client.observe(q, {}, options);
    await until(() => closed.getSnapshot().data === "private A");
    const peer = livePeer ? client.observe(q, {}, options) : undefined;
    if (peer) {
      await until(() => peer.getSnapshot().data === "private A");
      await delay(0); // The peek is immediate; let opening authority attach the raw subscription.
    }
    const a = closed.getSnapshot();
    closed.close();
    if (livePeer || tier === "wasm" || keep === true) assert.equal(closed.getSnapshot(), a,
      "a closed facade keeps its last answer while the same source identity remains valid");
    const seen = [];
    peer?.subscribe(() => seen.push(closed.getSnapshot()));
    f.holdDevice(); f.wall(5000);
    if (peer) {
      assert.deepEqual(peer.getSnapshot(), { loading: true });
      assert.ok(seen.length > 0, "the live peer's expiry notifies");
      for (const read of seen) assert.deepEqual(read, { loading: true }, "the closed facade is withdrawn inside peer callbacks");
    }
    const loading = closed.getSnapshot();
    assert.deepEqual(loading, { loading: true }, "a detached facade still consults its raw handle's deadlines");
    f.wall(1000);
    assert.equal(closed.getSnapshot(), loading, "rollback does not restore the private snapshot");
    peer?.close();
  });
}

for (const tier of ["online", "wasm"]) for (const mode of ["guard", "createApp"]) {
  for (const keep of [false, undefined, true]) for (const replacement of ["private B", "private A"]) {
    test(`${tier} ${mode}: closed facade withdraws when peer republishes ${replacement}, keep=${keep}`, async t => {
      const f = await fixture(t, tier, mode === "createApp");
      t.mock.method(Date, "now", () => 1000); // Isolate the row deadline from the host-time episode cap.
      const facade = mode === "guard" ? guardClient(f.raw, async () => true, () => true,
        () => ({ code: "E_AUTH", family: "auth", message: "closed" })) : undefined;
      t.after(() => facade?.fence()());
      const client = facade?.client ?? f.raw, options = keep === undefined ? undefined : { keep };
      const closed = client.observe(q, {}, options);
      await until(() => closed.getSnapshot().data === "private A");
      const peer = client.observe(q, {}, options);
      await until(() => peer.getSnapshot().data === "private A");
      await delay(0); // Attach the peer's raw subscription after its opening peek.
      assert.equal(answerObservation(closed.getSnapshot()), answerObservation(peer.getSnapshot()));
      const approved = closed.getSnapshot();
      let callbacks = 0;
      closed.subscribe(() => callbacks++);
      closed.close();
      assert.equal(closed.getSnapshot(), approved, "the same still-live raw answer remains valid after detach");
      f.answer(replacement, 8000);
      await f.replace();
      await until(() => peer.getSnapshot().data === replacement
        && answerIdentity(peer.getSnapshot()) !== answerIdentity(approved) && !peer.getSnapshot().revalidating);
      // Do not inspect the closed facade during the intervening raw loading state.
      const replaced = peer.getSnapshot();
      const loading = closed.getSnapshot();
      assert.deepEqual(loading, { loading: true }, "every closed policy withdraws as soon as the source identity differs, even with identical data");
      f.wall(4999);
      assert.equal(closed.getSnapshot(), loading);
      f.wall(5000);
      assert.equal(peer.getSnapshot(), replaced, "the replacement remains live past A's deadline");
      assert.equal(closed.getSnapshot(), loading, "A's deadline preserves the same loading snapshot");
      f.wall(1000);
      assert.equal(closed.getSnapshot(), loading, "rollback cannot restore A or adopt unchecked B");
      assert.equal(callbacks, 0, "closed facades never notify");
      peer.close();
    });
  }
}

for (const tier of ["online", "wasm"]) {
  test(`${tier}: closing a standalone withdrawing facade releases its raw owner and callbacks`, async t => {
    const f = await fixture(t, tier);
    const facade = guardClient(f.raw, async () => true, () => true,
      () => ({ code: "E_AUTH", family: "auth", message: "closed" }));
    t.after(() => facade.fence()());
    const options = { keep: false }, watch = facade.client.observe(q, {}, options);
    await until(() => watch.getSnapshot().data === "private A");
    const owner = answerObservation(watch.getSnapshot());
    assert.equal(answerObservation(peekObservation(f.raw, q, {}, options)), owner, "the raw owner is in the map");
    assert.equal(owner.subscribers.size, 1);
    assert.ok(owner.expiryTimer, "the live answer has a row expiry timer");
    let calls = 0;
    watch.subscribe(() => calls++);
    watch.close();
    assert.equal(peekObservation(f.raw, q, {}, options), undefined, "close removes the raw owner from its map");
    assert.equal(owner.subscribers.size, 0);
    assert.equal(owner.expiryTimer, null);
    assert.equal(owner.presenceRefresh, null);
    assert.equal(owner.lingering, undefined);
    assert.equal(calls, 0, "close detaches before any raw withdrawal notification");
    owner.publish({ data: "late old-owner result", complete: true, fresh: true, cut: null });
    for (const subscriber of owner.subscribers) subscriber();
    f.answer("private B", 8000);
    const replacement = facade.client.observe(q, {}, options);
    await until(() => replacement.getSnapshot().data === "private B");
    assert.notEqual(answerObservation(replacement.getSnapshot()), owner, "reopening creates a new owner");
    replacement.close();
    await delay(0);
    assert.equal(calls, 0, "late old-owner and new-owner publications never reach the closed facade");
  });
}

for (const tier of ["online", "wasm"]) for (const keep of [undefined, false, true]) for (const detached of [false, true]) {
  test(`${tier}${detached ? " detached handle" : ""}: client close keeps one denial past its row deadline, keep=${keep}`, async t => {
    const f = await fixture(t, tier), watch = f.raw.observe(q, {}, { keep });
    await until(() => watch.getSnapshot().data);
    const owner = answerObservation(watch.getSnapshot());
    if (detached) watch.close();
    await f.raw.close();
    const denied = watch.getSnapshot();
    assert.equal(denied.denied?.code, "E_CLOSED");
    f.wall(5000);
    assert.equal(watch.getSnapshot(), denied, "a due row cannot replace the terminal denial with loading");
    assert.equal(watch.getSnapshot(), denied);
    assert.equal(owner.expiryTimer, null);
    if (!detached || tier === "online" || keep === true) assert.equal(owner.deadlines, undefined);
  });
}

for (const keep of [undefined, false]) test(`wasm: resubscription applies policy and rearms row expiry without an accessor, keep=${keep}`, async t => {
  const f = await fixture(t, "wasm"), watch = f.raw.observe(q, {}, { keep });
  await until(() => watch.getSnapshot().data);
  const owner = answerObservation(watch.getSnapshot());
  const deadlines = { ...owner.deadlines };
  watch.close();
  f.holdDevice(); f.wall(4900);
  t.mock.method(Date, "now", () => 1000); // No episode timer can mask the row timer.
  t.mock.timers.enable({ apis: ["setTimeout"] });
  const seen = [];
  watch.subscribe(() => seen.push(owner.snapshot));
  assert.deepEqual(owner.deadlines, deadlines, "resubscription preserves the absolute deadlines");
  if (keep === false) assert.deepEqual(owner.snapshot, { loading: true }, "resubscription withdraws before its replacement");
  else { assert.equal(owner.snapshot.data, "private A"); assert.equal(owner.snapshot.revalidating, true); }
  const resumed = owner.snapshot;
  f.wall(4999); t.mock.timers.tick(99);
  assert.equal(owner.snapshot, resumed);
  f.wall(5000); t.mock.timers.tick(1);
  assert.deepEqual(owner.snapshot, { loading: true }, "timer delivery withdraws before any accessor");
  assert.ok(seen.some(read => read.loading), "the saved row timer notifies subscribers");
  assert.equal(new Set(seen.filter(read => read.loading)).size, 1, "expiry publishes one stable loading snapshot");
});

for (const closed of [true, false]) test(`wasm: ${closed ? "closed" : "live"} handle expiry fences memory across rollback`, async t => {
  const f = await fixture(t, "wasm"), watch = f.raw.observe(q, {});
  await until(() => watch.getSnapshot().data);
  if (closed) watch.close();
  f.wall(5000);
  assert.deepEqual(watch.getSnapshot(), { loading: true });
  f.wall(1000); f.fail();
  const recovered = await f.raw.query(q, {});
  assert.equal(recovered.denied?.code, "E_OFFLINE", "expired private A cannot be recovered after server-time rollback");
});

test("wasm: closed A expiry preserves newer unexpired B in memory across rollback", async t => {
  const f = await fixture(t, "wasm"), watch = f.raw.observe(q, {});
  await until(() => watch.getSnapshot().data === "private A");
  watch.close();
  f.answer("private B", 8000);
  assert.equal((await f.raw.query(q, {})).data, "private B", "the same query remembers newer B");
  f.wall(5000);
  assert.deepEqual(watch.getSnapshot(), { loading: true }, "closed A observes its own expiry");
  f.wall(1000); f.fail();
  const recovered = await f.raw.query(q, {});
  assert.equal(recovered.data, "private B", "A's expiry must preserve B until B's own server deadline");
  assert.equal(recovered.fresh, false, "recovery uses remembered data after transport fails");
});

const peerPolicies = [[undefined, undefined], [false, false], [true, true],
  [false, undefined], [undefined, false], [false, true], [true, false]];
for (const tier of ["online", "wasm"]) for (const boundary of tier === "online" ? ["discovery", "offline", "close", "sign-out"] : ["offline", "close", "sign-out"]) {
  for (const mode of ["raw", "guard", "opening remount"]) for (const [keep, peerKeep] of mode === "opening remount" ? [[true, undefined], [true, false], [true, true]] : peerPolicies) {
    test(`${tier} ${mode}: ${boundary} withdraws both peers before every callback, keep=${keep}, peerKeep=${peerKeep}`, async t => {
      const f = await fixture(t, tier), options = keep === undefined ? undefined : { keep };
      const peerOptions = peerKeep === undefined ? undefined : { keep: peerKeep };
      const authority = Promise.withResolvers(); let holding = false;
      const facade = guardClient(f.raw, async () => { if (holding) await authority.promise; return true; },
        () => true, () => ({ code: "E_AUTH", family: "auth", message: "closed" }));
      t.after(() => { authority.resolve(); facade.fence()(); });
      const client = mode === "raw" ? f.raw : facade.client;
      let first = client.observe(q, {}, options);
      await until(() => first.getSnapshot().data);
      const peer = client.observe(peerQuery, {}, peerOptions);
      await until(() => peer.getSnapshot().data);
      // Capture raw owners so inspecting peers cannot itself cause their withdrawal.
      const rawFirst = f.raw.observe(q, {}, options), rawPeer = f.raw.observe(peerQuery, {}, peerOptions);
      const owners = [rawFirst, rawPeer].map(watch => answerObservation(watch.getSnapshot()));
      if (mode === "opening remount") {
        first.close(); holding = true;
        first = client.observe(q, {}, options);
        assert.equal(first.getSnapshot().data, "private A");
      }
      let closing = false;
      const close = f.raw.close.bind(f.raw);
      t.mock.method(f.raw, "close", () => { closing = true; return close(); });
      const seen = [];
      const inspect = kind => seen.push({ kind, closing, raw: owners.map(owner => owner.snapshot),
        reads: [first.getSnapshot(), peer.getSnapshot()],
        peek: peekObservation(client, peerQuery, {}, peerOptions) });
      first.subscribe(() => inspect("first")); peer.subscribe(() => inspect("peer"));
      if (mode !== "opening remount") rawFirst.subscribe(() => inspect("raw"));
      f.raw.onLink(next => { if (next === "offline" || next === "signed-out") inspect("link"); });
      f.holdDevice(); // Hold local recovery so callbacks only cover this withdrawal boundary.
      await f.trigger(boundary);
      if (boundary === "offline" || boundary === "discovery") await until(() => boundary === "offline" ? f.raw.link() === "offline" : f.discovering());
      assert.ok(seen.some(event => event.kind === "first"), "the first observer is notified");
      assert.ok(seen.some(event => event.kind === "peer"), "the second observer is notified");
      if (boundary === "offline" || boundary === "sign-out") assert.ok(seen.some(event => event.kind === "link"));
      for (const event of seen) {
        for (const [i, read] of [...event.raw, ...event.reads, event.peek].entries()) {
          if (!read) continue;
          const policy = i === 4 || i % 2 ? peerKeep : keep;
          if (boundary === "offline" && policy !== false) {
            assert.equal(read.data, "private A"); assert.equal(read.fresh, false); assert.equal(read.revalidating, true);
          } else assert.ok(!("data" in read), `${event.kind} callback must see every withdrawing peer updated: ${JSON.stringify(read)}`);
        }
        if (tier === "wasm" && mode === "guard" && boundary === "sign-out") {
          for (const read of [...event.raw, ...event.reads]) assert.equal(read.denied?.code, event.closing ? "E_CLOSED" : "E_AUTH",
            `${event.kind} callback must deny with E_AUTH until signOut calls close`);
        }
      }
      if (boundary === "offline" && peerKeep !== false) assert.equal(peer.getSnapshot().data, "private A");
      else assert.ok(!peer.getSnapshot().data, "the second peer was also withdrawn");
      if (tier === "wasm" && mode === "guard" && boundary === "sign-out") {
        assert.ok(seen.some(event => !event.closing), "sign-out delivered its denial before closing");
        assert.ok(seen.some(event => event.closing), "close delivered the terminal denial");
        assert.equal(first.getSnapshot().denied?.code, "E_CLOSED");
        assert.equal(peer.getSnapshot().denied?.code, "E_CLOSED");
      }
    });
  }
}

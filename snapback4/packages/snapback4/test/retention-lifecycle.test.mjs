// @ref LLP 3000.023#3.4 — lifecycle withdrawals finish across peers before application callbacks.
import test from "node:test";
import assert from "node:assert/strict";
import { setTimeout as delay } from "node:timers/promises";
import { createClient } from "../dist/client.js";
import { createLocalClient } from "../dist/local.js";
import { guardClient } from "../dist/app-client.js";
import { answerObservation } from "../dist/read-observation.js";
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
async function fixture(t, tier) {
  let wall = 1000, failing = false, held = false, holdDevice = false, queries = 0, discovering = false;
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
    if (path === "/probe") return parked(init.signal);
    if (path === "/changes") {
      const event = await Promise.race([loss.promise, parked(init.signal)]);
      if (event === "offline") throw Error("controlled link loss");
      return Response.json({ seq: 2, generation: 1, tables: ["remote"] }, { headers: { "x-snapback-ephemeral": "1" } });
    }
    assert.ok(path === "/q/viewer" || path === "/q/peer");
    queries++;
    if (failing) throw Error("offline after rollback");
    if (held) return parked(init.signal);
    return Response.json({ data: "private A", complete: true, tables: ["remote"], seq: 1, nextExpiry: 5000 });
  }) };
  const raw = tier === "online" ? createClient(options) : await createLocalClient(options);
  t.after(async () => { deviceGate.resolve(); await raw.close(); });
  if (raw.sync) await raw.sync();
  return { raw, wall(n) { wall = n; }, queries: () => queries, discovering: () => discovering,
    holdDevice() { holdDevice = true; }, fail() { failing = true; },
    trigger(boundary) { held = true; if (boundary === "close") return raw.close(); if (boundary === "sign-out") return raw.signOut(); loss.resolve(boundary); } };
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

for (const keep of [undefined, false]) test(`wasm: resubscription delivers saved row expiry without an accessor, keep=${keep}`, async t => {
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
  assert.equal(owner.snapshot.data, "private A");
  f.wall(4999); t.mock.timers.tick(99);
  assert.equal(owner.snapshot.data, "private A");
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

for (const tier of ["online", "wasm"]) for (const boundary of tier === "online" ? ["discovery", "offline", "close", "sign-out"] : ["offline", "close", "sign-out"]) {
  for (const mode of ["raw", "guard", "opening remount"]) for (const keep of mode === "opening remount" ? [true] : [undefined, true]) {
    test(`${tier} ${mode}: ${boundary} withdraws both peers before every callback, keep=${keep}`, async t => {
      const f = await fixture(t, tier), options = keep === undefined ? undefined : { keep };
      const authority = Promise.withResolvers(); let holding = false;
      const facade = guardClient(f.raw, async () => { if (holding) await authority.promise; return true; },
        () => true, () => ({ code: "E_AUTH", family: "auth", message: "closed" }));
      t.after(() => { authority.resolve(); facade.fence()(); });
      const client = mode === "raw" ? f.raw : facade.client;
      let first = client.observe(q, {}, options);
      await until(() => first.getSnapshot().data);
      const peer = client.observe(peerQuery, {}, options);
      await until(() => peer.getSnapshot().data);
      // Capture raw owners so inspecting peers cannot itself cause their withdrawal.
      const rawFirst = f.raw.observe(q, {}, options), rawPeer = f.raw.observe(peerQuery, {}, options);
      const owners = [rawFirst, rawPeer].map(watch => answerObservation(watch.getSnapshot()));
      if (mode === "opening remount") {
        first.close(); holding = true;
        first = client.observe(q, {}, options);
        assert.equal(first.getSnapshot().data, "private A");
      }
      const seen = [];
      const inspect = kind => seen.push({ kind, raw: owners.map(owner => owner.snapshot),
        reads: [first.getSnapshot(), peer.getSnapshot()],
        peek: peekObservation(client, peerQuery, {}, options) });
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
        for (const read of [...event.raw, ...event.reads, event.peek].filter(Boolean)) {
          assert.ok(!("data" in read), `${event.kind} callback must see every peer withdrawn: ${JSON.stringify(read)}`);
        }
      }
      assert.ok(!peer.getSnapshot().data, "the second peer was also withdrawn");
    });
  }
}

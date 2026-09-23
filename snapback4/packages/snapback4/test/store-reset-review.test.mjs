// Deterministic transport barriers around the real wasm device.
import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { setImmediate as tick } from "node:timers/promises";
import { createLocalClient } from "../dist/local.js";
import { webDevice, memoryPersistence } from "../dist/web.js";
import { MediaCache } from "../dist/local-assets.js";

const wasm = readFileSync(new URL("../dist/wasm/snapback4_device_bg.wasm", import.meta.url));
const original = JSON.parse(readFileSync(new URL("./chat-schema.json", import.meta.url), "utf8"));
const ok = reply => { assert.ok(!reply.denied, JSON.stringify(reply)); return reply.ok; };
const gate = () => { let resolve; const promise = new Promise(r => { resolve = r; }); return { promise, resolve }; };
async function until(check) { for (let i = 0; i < 10000; i++) { if (await check()) return; await tick(); } assert.fail("barrier was not reached"); }
const events = (store, count = 1) => [
  { table: "conversations", id: "c1", title: store, creatorId: "dev:alice" },
  { table: "memberships", id: "m1", conversationId: "c1", principal: "dev:alice", role: "admin", joinedAt: 1 },
  ...Array.from({ length: count }, (_, i) => ({ table: "messages", id: `${store}-${i}`, conversationId: "c1", authorId: "dev:alice", body: store, at: i + 1, editedAt: null, photo: null })),
].map(({ table, ...data }) => ({ table, id: data.id, kind: "put", data }));
const backend = store => ({ ...original, programs: [...original.programs, { name: "marker", kind: "Query", args: {}, body: [{ Return: { Literal: { String: store } } }] }] });
const thread = { kind: "query", name: "thread" };
const args = { conversationId: "c1", c: null };
const snapshot = (store, count = 1) => ({ snapshot: true, store_id: store, generation: 1, events: events(store, count), watermark: 10, more: false });

async function fixture(t, count = 1) {
  const persist = memoryPersistence();
  let store = "A", generation = 1, marker = "A", offline = false, schemaFailures = 0, core, client, changes;
  let schema = original.schema;
  let queryGate, localGate, mutationGate, localStarts = 0, queryStarts = 0, schemaCalls = 0, mutationStarts = 0, syncStarts = 0;
  const reads = [], clients = [], sends = [], syncRequests = [];
  let adopting, committed, resetReadFailure, failNextResetRead = false, failureOp = "observe_store";
  const fetcher = async (input, init = {}) => {
    if (offline && !init.keepalive) throw new TypeError("offline");
    const path = new URL(input).pathname;
    if (path === "/schema") { schemaCalls++; if (schemaFailures-- > 0) throw new TypeError("schema interrupted"); return Response.json({ ...backend(marker), schema, generation }); }
    if (path === "/sync") {
      syncStarts++;
      const request = JSON.parse(init.body);
      syncRequests.push(request);
      return Response.json(request.from === 0 && !request.stream ? { ...snapshot(store, count), generation } : { snapshot: false, store_id: store, generation, events: [], watermark: 10, more: false });
    }
    if (path === "/changes") {
      const current = changes = gate();
      const abort = () => current.resolve({ seq: 10, store_id: store });
      init.signal?.addEventListener("abort", abort, { once: true });
      try { return Response.json(await current.promise); } finally { init.signal?.removeEventListener("abort", abort); }
    }
    if (path.startsWith("/q/")) {
      const captured = marker; queryStarts++;
      if (queryGate) await queryGate.promise;
      reads.push(captured);
      return Response.json({ data: captured, complete: true, tables: ["messages"] });
    }
    if (path.startsWith("/m/")) { sends.push({ ...JSON.parse(init.body), store, exit: !!init.keepalive }); mutationStarts++; if (mutationGate) await mutationGate.promise; return Response.json({ state: "sent", seq: 11 }); }
    if (path === "/probe") return Response.json({ ok: true });
    assert.fail(path);
  };
  async function open() {
    const opener = webDevice({ wasm, persist });
    client = await createLocalClient({ url: `http://reset.test/${encodeURIComponent(t.name)}`, persona: "alice", device: { async open(...a) { const opened = core = await opener.open(...a); return { ...opened, async call(request) {
      if (request.op === "sync_state" && failNextResetRead) {
        failNextResetRead = false;
        resetReadFailure();
        return { denied: { code: "E_STORE", family: "store", message: "injected post-reset read failure" } };
      }
      if (request.op === "adopt") adopting?.();
      const reply = await opened.call(request);
      if (!reply.denied) committed?.(request, reply.ok);
      if (request.op === failureOp && !reply.denied && (failureOp === "adopt" || reply.ok?.reset) && resetReadFailure) failNextResetRead = true;
      if (request.op === "query" && localGate) { localStarts++; await localGate.promise; }
      return reply;
    } }; } }, fetch: (input, init) => fetcher(String(input).replace(`/${encodeURIComponent(t.name)}`, ""), init) });
    clients.push(client); return client;
  }
  t.after(async () => { queryGate?.resolve(); localGate?.resolve(); mutationGate?.resolve(); for (const c of clients) await c.close(); });
  await open();
  return { get client() { return client; }, get core() { return core; }, open, persist, reads, sends, syncRequests,
    replace() { store = marker = "B"; }, updateBackend() { generation++; marker = "A2"; }, offline(v) { offline = v; }, failSchema(n) { schemaFailures = n; },
    widenBackend() {
      generation++; marker = "A2"; schema = structuredClone(schema);
      schema.tables.conversations.columns.tag = { Text: { max: 20 } };
      schema.tables.conversations.defaults = { tag: { Literal: { String: "default" } } };
    },
    onAdopt(callback) { adopting = callback; },
    onCommit(callback) { committed = callback; },
    failReadAfterReset(callback, op = "observe_store") { resetReadFailure = callback; failureOp = op; },
    stats() { return { queryStarts, localStarts, schemaCalls, mutationStarts, syncStarts }; },
    holdLocal() { return localGate = gate(); },
    holdQueries() { return queryGate = gate(); }, holdMutation() { return mutationGate = gate(); },
    async changed(seq = 10) { await until(() => changes); const c = changes; changes = null; c.resolve({ seq, store_id: store, generation: 1 }); await tick(); },
  };
}

test("R2 item 2: getSnapshot is cleared after validated reset and before backend adoption", async t => {
  const f = await fixture(t), watch = f.client.observe({ kind: "query", name: "marker" }, {}), notices = [];
  watch.subscribe(() => notices.push(structuredClone(watch.getSnapshot())));
  await until(() => watch.getSnapshot().fresh);
  assert.equal(watch.getSnapshot().data, "A");
  notices.length = 0;
  let during;
  f.onAdopt(() => { during ??= structuredClone(notices); });
  f.replace(); await f.client.sync();
  assert.deepEqual(during?.[0], { loading: true }, "validated reset notifies loading before adoption can start");
  assert.ok(during.every(read => read.data !== "A"), "the retired answer cannot be republished during adoption");
  await until(() => watch.getSnapshot().data === "B");
  assert.equal(watch.getSnapshot().fresh, true);
});

test("FF1: committed reset invalidates watches and acquisition before a denied sync_state read", async t => {
  const f = await fixture(t), watch = f.client.observe({ kind: "query", name: "marker" }, {});
  const notices = [], acquisition = [];
  watch.subscribe(() => notices.push(structuredClone(watch.getSnapshot())));
  f.client.onAcquired(value => acquisition.push(value));
  await until(() => watch.getSnapshot().fresh);
  assert.equal(watch.getSnapshot().data, "A");
  assert.equal(f.client.acquired, true);
  const remote = { kind: "query", name: "remote", runs: "server" };
  assert.equal((await f.client.query(remote, {})).data, "A", "prime a remembered server answer too");
  notices.length = 0; acquisition.length = 0;
  let atFailure, adoptions = 0;
  f.onAdopt(() => adoptions++);
  f.failReadAfterReset(() => { atFailure = {
    snapshot: structuredClone(watch.getSnapshot()), notices: structuredClone(notices),
    acquired: f.client.acquired, acquisition: [...acquisition],
  }; });
  f.replace(); await f.client.sync();
  const state = ok(await f.core.call({ op: "sync_state", capture: false }));
  assert.equal(state.store_id, "B", "the real device committed replacement before the injected failure");
  assert.equal(state.backend_required, true);
  assert.equal(state.acquired, false);
  assert.equal(adoptions, 0, "the failed round never reaches adoption");
  assert.ok(atFailure, "the post-reset read was actually denied");
  assert.deepEqual(atFailure.notices[0], { loading: true }, "committed reset must notify before any fallible read");
  assert.ok(atFailure.notices.every(read => read.data !== "A"), "retired answers cannot reappear");
  assert.notEqual(atFailure.snapshot.data, "A");
  assert.equal(atFailure.acquired, false);
  assert.deepEqual(atFailure.acquisition, [false]);
  assert.equal(f.client.acquired, false, "failed inspection cannot retain retired acquisition");
  f.offline(true);
  assert.equal((await f.client.query(remote, {})).denied?.code, "E_OFFLINE", "the retired server cache is empty even when identity inspection failed");
  f.offline(false);
  const retryAt = f.syncRequests.length;
  await f.client.sync();
  assert.equal(f.syncRequests[retryAt].store_id, "B", "retry captures identity from the device");
  assert.equal(f.syncRequests[retryAt].from, 0, "retry discards A's stream cursor");
  assert.equal(f.syncRequests[retryAt].after, null, "retry discards A's snapshot continuation");
  await until(() => watch.getSnapshot().data === "B" && watch.getSnapshot().fresh);
  assert.equal(f.client.acquired, true, "a healthy retry reacquires B");
  assert.ok(adoptions > 0);
  assert.deepEqual(acquisition, [false, true]);
  assert.ok(notices.every(read => read.data !== "A"));
});

for (const op of ["observe_store", "adopt"]) test(`FF1 boundary: ${op} invalidates before fallible media reconciliation`, async t => {
  const f = await fixture(t), watch = f.client.observe({ kind: "query", name: "marker" }, {}), notices = [];
  watch.subscribe(() => notices.push(structuredClone(watch.getSnapshot())));
  await until(() => watch.getSnapshot().fresh);
  assert.equal(watch.getSnapshot().data, "A");
  assert.equal(f.client.acquired, true);
  notices.length = 0;
  let fail = false, atFailure;
  f.onCommit((request, result) => { if (request.op === op && (op === "adopt" || result.reset)) fail = true; });
  const reconcile = MediaCache.prototype.reconcile;
  t.mock.method(MediaCache.prototype, "reconcile", function () {
    if (fail) {
      fail = false;
      atFailure = { notices: structuredClone(notices), acquired: f.client.acquired };
      throw new Error("injected media reconciliation failure");
    }
    return reconcile.call(this);
  });
  if (op === "adopt") f.updateBackend(); else f.replace();
  if (op === "adopt") await f.client.sync();
  else await assert.rejects(f.client.sync(), /injected media reconciliation failure/);
  const state = ok(await f.core.call({ op: "sync_state", capture: false }));
  assert.equal(state.store_id, op === "adopt" ? "A" : "B");
  assert.equal(state.generation, op === "adopt" ? 2 : 1);
  assert.equal(state.acquired, false, "the device committed the invalidating operation");
  assert.ok(atFailure, "media reconciliation actually failed after commit");
  assert.deepEqual(atFailure.notices[0], { loading: true }, "invalidation precedes fallible post-commit housekeeping");
  assert.equal(atFailure.acquired, false);
  f.onCommit(() => {});
  await f.client.sync();
  await until(() => watch.getSnapshot().data === (op === "adopt" ? "A2" : "B") && watch.getSnapshot().fresh);
  assert.equal(f.client.acquired, true);
  assert.ok(notices.every(read => read.data !== "A"));
});

test("FF1 adoption audit: committed generation invalidates before a thrown sync_state read", async t => {
  const f = await fixture(t), watch = f.client.observe({ kind: "query", name: "marker" }, {}), notices = [];
  watch.subscribe(() => notices.push(structuredClone(watch.getSnapshot())));
  await until(() => watch.getSnapshot().fresh);
  assert.equal(watch.getSnapshot().data, "A");
  assert.equal(f.client.acquired, true);
  notices.length = 0;
  let atFailure;
  f.failReadAfterReset(() => {
    atFailure = { notices: structuredClone(notices), acquired: f.client.acquired };
    throw new Error("injected post-adoption read failure");
  }, "adopt");
  f.updateBackend(); await f.client.sync();
  const state = ok(await f.core.call({ op: "sync_state", capture: false }));
  assert.equal(state.generation, 2, "the real device committed adoption");
  assert.equal(state.acquired, false);
  assert.ok(atFailure, "the post-adoption read actually failed");
  assert.deepEqual(atFailure.notices[0], { loading: true }, "adoption must invalidate before its readiness read");
  assert.equal(atFailure.acquired, false);
  f.failReadAfterReset(() => {}, "unused");
  await f.client.sync();
  await until(() => watch.getSnapshot().data === "A2" && watch.getSnapshot().fresh);
  assert.equal(f.client.acquired, true);
  assert.ok(notices.every(read => read.data !== "A"));
});

test("FF1 adoption control: compatible widening revalidates acquired images before interrupted catch-up", async t => {
  const f = await fixture(t);
  assert.equal(f.client.acquired, true);
  f.widenBackend(); f.onAdopt(() => f.offline(true));
  await f.client.sync();
  const state = ok(await f.core.call({ op: "sync_state", capture: false }));
  assert.equal(state.generation, 2);
  assert.equal(state.acquired, true, "literal-default widening preserves native acquisition");
  assert.equal(f.client.link(), "offline");
  assert.equal(f.client.acquired, true, "the successful readiness read revalidates retained acquisition");
  const read = await f.client.query({ kind: "query", name: "marker" }, {});
  assert.equal(read.data, "A2", "the adopted interpreter remains readable offline");
  assert.equal(read.fresh, false);
});

for (const mode of ["snapshot", "stream"]) for (const failure of ["healthy", "media", "host"]) {
  test(`HH1/II1: ${mode} publication preserves watch invalidation with ${failure} recovery`, async t => {
    const failMedia = failure === "media";
    const persist = memoryPersistence(), opener = webDevice({ wasm, persist });
    const url = `http://publication.test/${encodeURIComponent(t.name)}`;
    const photo = { id: "photo", type: "image/png", bytes: 1, width: 1, height: 1 };
    const image = body => {
      const rows = events("A");
      Object.assign(rows.at(-1).data, { body, photo });
      return rows;
    };
    let core, client, offline = false, updating = false, staged = false, failHome = false;
    let failures = 0, queryCalls = 0;
    const requests = [], publications = [], clients = [];
    const others = persist.others;
    persist.others = async prefix => {
      if (failure === "host" && publications.some(p => p.published) && !failures) {
        failures++;
        throw new Error("injected post-publication orphan enumeration failure");
      }
      return others(prefix);
    };
    const fetcher = async (input, init = {}) => {
      if (offline) throw new TypeError("offline");
      const path = new URL(input).pathname.slice(new URL(url).pathname.length);
      if (path === "/schema") return Response.json(original);
      if (path === "/sync") {
        const request = JSON.parse(init.body); requests.push(request);
        const base = { store_id: "A", generation: 1, more: false };
        if (request.from === 0 && !request.stream) return Response.json({ ...base, snapshot: true, events: image("A"), watermark: 10 });
        if (updating && request.from === 10) {
          staged = mode === "snapshot";
          return Response.json({ ...base, snapshot: staged, events: image("updated"), watermark: 11, images_at: 11 });
        }
        return Response.json({ ...base, snapshot: false, events: [], watermark: updating ? 11 : 10, images_at: updating ? 11 : 10 });
      }
      if (path === "/changes") return new Promise((resolve) => {
        const abort = () => resolve(Response.json({ seq: updating ? 11 : 10, store_id: "A" }));
        if (init.signal.aborted) abort(); else init.signal.addEventListener("abort", abort, { once: true });
      });
      if (path === "/assets/photo") return new Response(new Uint8Array([1]), { headers: { "content-type": "image/png", "accept-ranges": "bytes" } });
      assert.fail(`unexpected transport request: ${path}`);
    };
    async function open() {
      client = await createLocalClient({ url, persona: "alice", assets: { keep: "viewed", maxBytes: 100 }, fetch: fetcher,
        device: { async open(...args) {
          const opened = core = await opener.open(...args);
          return { ...opened, async call(request, committed) {
            if (request.op === "asset_home" && failHome) {
              failHome = false; failures++;
              return { denied: { code: "E_STORE", family: "store", message: "injected post-publication asset_home failure" } };
            }
            if (request.op === "query") queryCalls++;
            return opened.call(request, reply => {
              committed?.(reply);
              if (request.op === "apply" && updating && !reply.denied) {
                publications.push(structuredClone(reply.ok));
                if (reply.ok.published && publications.filter(p => p.published).length === 1) failHome = failMedia;
              }
            });
          } };
        } },
      });
      clients.push(client);
    }
    t.after(async () => { for (const c of clients) await c.close(); });
    await open();
    const held = { ...thread, held: true }, watch = client.observe(held, args), notices = [];
    watch.subscribe(() => notices.push(structuredClone(watch.getSnapshot())));
    await until(() => watch.getSnapshot().fresh);
    assert.equal(watch.getSnapshot().data[0].body, "A");
    const asset = await client.asset("photo");
    assert.ok("url" in asset, JSON.stringify(asset)); asset.revoke();
    assert.equal(JSON.parse(ok(await core.call({ op: "meta", key: "media:manifest" }))).length, 1, "real viewed-media retention primes reconciliation");
    notices.length = 0; updating = true;
    if (failMedia) await assert.rejects(client.sync(), /injected post-publication asset_home failure/);
    else if (failure === "host") await assert.rejects(client.sync(), /injected post-publication orphan enumeration failure/);
    else await client.sync();
    const native = ok(await core.call({ op: "sync_state", capture: false }));
    assert.equal(native.watermark, 11);
    assert.equal(native.acquired, true);
    assert.equal(ok(await core.call({ op: "query", name: "thread", viewer: "dev:alice", args, now: Date.now() })).data[0].body, "updated");
    assert.equal(failures, failure === "healthy" ? 0 : 1, "only the selected post-publication operation fails");
    assert.equal(staged, mode === "snapshot");
    assert.deepEqual(publications.map(p => p.published), mode === "snapshot" ? [false, true] : [true]);
    assert.ok(publications.at(-1).touched.includes("messages"));
    // Drain scheduled reads, then retry from the already committed watermark.
    // An empty healthy retry cannot recover a lost touched-table notification.
    for (let i = 0; i < 20; i++) await tick();
    const beforeRetry = structuredClone(watch.getSnapshot()), notifiedBeforeRetry = structuredClone(notices);
    const retryAt = requests.length;
    await client.sync();
    for (let i = 0; i < 20; i++) await tick();
    assert.equal(requests[retryAt].from, 11);
    assert.equal(requests[retryAt].after, null);
    const afterRetry = structuredClone(watch.getSnapshot());
    const readsBeforeClose = queryCalls;
    offline = true; await client.close(); await open();
    assert.equal((await client.query(held, args)).data[0].body, "updated", "offline reopen confirms durable publication");
    assert.equal(beforeRetry.data[0].body, "updated", "committed publication must rerun its watch even when reconciliation fails");
    assert.ok(notifiedBeforeRetry.some(read => read.data?.[0]?.body === "updated"), "publication must notify before a healthy retry");
    assert.equal(afterRetry.data[0].body, "updated");
    assert.ok(readsBeforeClose >= 2, "the watch was actually reevaluated");
  });
}


test("R4: a same-identity /changes head below acquisition persists the restore halt even when writes refill the head", async t => {
  const f = await fixture(t), op = { kind: "query", name: "marker" };
  assert.equal((await f.client.query(op, {})).fresh, true);
  // /changes reports the committed head. The store was restored to 5; other
  // writers then create commits 6–10, so the next /sync from 10 looks empty.
  await f.changed(5); await f.client.sync();
  assert.equal((await f.core.call({ op: "sync_state" })).ok.restore_refusal?.code, "E_STORE_RESTORE");
  const read = await f.client.query(op, {});
  assert.equal(read.denied?.code, "E_STORE_RESTORE", JSON.stringify(read));
});
test("finding 1: failed same-generation backend adoption survives retry and offline reopen", async t => {
  const f = await fixture(t);
  assert.equal((await f.client.query({ kind: "query", name: "marker" }, {})).data, "A");
  f.replace(); f.failSchema(1); await f.client.sync();
  f.offline(true); await f.client.sync(); await f.client.close(); await f.open();
  const held = ok(await f.core.call({ op: "query", name: "thread", viewer: "dev:alice", args, now: 100 }));
  assert.ok(held.denied, "offline reopen cannot acquire before adopting B");
  f.offline(false); await f.client.sync();
  const read = await f.client.query({ kind: "query", name: "marker" }, {});
  assert.equal(read.data, "B", "retry must not forget B's backend after its identity was persisted");
  assert.equal(read.fresh, true);
});

for (const mode of ["server", "horizon", "watch"]) test(`finding 2: delayed ${mode} answer cannot escape its incarnation`, async t => {
  const f = await fixture(t, mode === "horizon" ? 50 : 1);
  const op = mode === "horizon" ? thread : { kind: "query", name: "remote", runs: "server" };
  const barrier = f.holdQueries();
  const notices = [];
  const watch = mode === "watch" ? f.client.observe(op, args) : null;
  watch?.subscribe(() => notices.push(watch.getSnapshot()));
  const read = watch ? null : f.client.query(op, args);
  await until(() => f.stats().queryStarts > 0);
  f.replace(); await f.client.sync();
  barrier.resolve();
  if (watch) {
    await until(() => notices.some(r => r.data === "B"));
    assert.ok(!notices.some(r => r.data === "A"), "the running watch must discard A before notifying");
  } else assert.equal((await read).data, "B", "an old server answer must be retried");
  f.offline(true); await f.client.sync();
  const offline = await f.client.query(op, args);
  if (mode === "horizon") assert.ok(offline.data.every(row => row.body === "B"));
  else assert.equal(offline.data, "B", "remembered answers retain the current incarnation only");
});

test("finding 2: changes observation drops freshness while a mutation holds the network queue", async t => {
  const f = await fixture(t);
  assert.equal((await f.client.query(thread, args)).fresh, true);
  const barrier = f.holdMutation();
  const write = f.client.mutate({ kind: "mutation", name: "send" }, { conversationId: "c1", body: "pending" });
  await until(() => f.stats().mutationStarts > 0);
  const before = f.stats().syncStarts;
  f.replace(); await f.changed();
  const read = await f.client.query(thread, args);
  const during = f.stats().syncStarts;
  barrier.resolve(); await write;
  assert.ok(read.data === "B" || read.fresh === false, "A cannot be fresh after /changes identified B; a current server answer is allowed");
  assert.equal(before, during, "the assertion runs before queued sync can start");
});

function locks(t) {
  const previous = Object.getOwnPropertyDescriptor(globalThis, "navigator");
  Object.defineProperty(globalThis, "navigator", { configurable: true, value: { locks: { request: async (name, options, body) => body({ name }) } } });
  t.after(() => previous ? Object.defineProperty(globalThis, "navigator", previous) : delete globalThis.navigator);
}

test("finding 3: orphan import retires foreign receipts and disables unknown predictions", async t => {
  locks(t);
  const persist = memoryPersistence(), opener = webDevice({ wasm, persist }), name = "orphan-review";
  let primary = await opener.open(name, backend("B"));
  ok(await primary.call({ op: "apply", first: true, page: snapshot("B") })); await primary.close();
  const orphan = await opener.open(`${name}:tab-old`, backend("A"));
  ok(await orphan.call({ op: "apply", first: true, page: snapshot("A") }));
  for (const [i, id] of ["known-observed", "known-sent", "unknown"].entries()) ok(await orphan.call({ op: "enqueue", entry: {
    id, seq: i + 1, op: "send", args: { conversationId: "c1", body: id }, new_ids: [id], predicted: [`messages/${id}`], predictable: true,
    ...(i === 0 ? { observed_seq: 11 } : i === 1 ? { sent_seq: 12 } : {}),
  } }));
  await orphan.close(); primary = await opener.open(name, null); t.after(() => primary.close());
  const queue = ok(await primary.call({ op: "queued" }));
  assert.deepEqual(queue.map(e => e.id), ["unknown"], "known A receipts must never enter B's sendable outbox");
  assert.equal(queue[0].predictable, false); assert.deepEqual(queue[0].predicted, []); assert.deepEqual(queue[0].new_ids, ["unknown"]);
});

test("legacy clock-less predictable orphan imports without local rows and survives replay", async t => {
  locks(t);
  const persist = memoryPersistence(), opener = webDevice({ wasm, persist }), name = "legacy-clock-orphan";
  let primary = await opener.open(name, backend("A"));
  ok(await primary.call({ op: "apply", first: true, page: snapshot("A") }));
  await primary.close();
  const entry = { id: "legacy", seq: 1, op: "send", viewer: "dev:alice",
    args: { conversationId: "c1", body: "legacy" }, new_ids: ["legacy-row"],
    predictable: true, predicted: ["messages/legacy-row"] };
  // Persist the old record directly, bypassing current enqueue normalization.
  await persist.save(`${name}:tab-old`, [
    { s: "m", k: "device:store_id", v: "A" },
    { s: "o", k: entry.id, v: JSON.stringify(entry) },
  ]);
  primary = await opener.open(name, null);
  t.after(() => primary.close());
  const verify = async () => {
    const queue = ok(await primary.call({ op: "queued" }));
    assert.equal(queue.length, 1);
    assert.equal(queue[0].predictable, false);
    assert.deepEqual(queue[0].predicted, []);
    for (const key of ["id", "op", "viewer", "args", "new_ids"]) assert.deepEqual(queue[0][key], entry[key]);
    const read = ok(await primary.call({ op: "query", name: "thread", viewer: "dev:alice", args, now: 100 }));
    assert.ok(read.data.every(row => row.id !== "legacy-row"), JSON.stringify(read));
  };
  await verify();
  assert.deepEqual(await persist.load(`${name}:tab-old`), [], "the orphan transferred successfully");
  await primary.close(); primary = await opener.open(name, null);
  ok(await primary.call({ op: "apply", first: true, page: snapshot("A") }));
  await verify();
});


test("finding 2: a delayed device read is retried before returning", async t => {
  const f = await fixture(t);
  const barrier = f.holdLocal();
  const read = f.client.query({ kind: "query", name: "marker" }, {});
  await until(() => f.stats().localStarts > 0);
  f.replace(); await f.client.sync(); barrier.resolve();
  assert.equal((await read).data, "B");
});

test("orphan provenance survives an unidentified destination and resolves on sync", async t => {
  locks(t);
  const persist = memoryPersistence(), opener = webDevice({ wasm, persist }), name = "unidentified-orphan";
  const orphan = await opener.open(`${name}:tab-A`, backend("A"));
  ok(await orphan.call({ op: "apply", first: true, page: snapshot("A") }));
  for (const [i, id] of ["known", "unknown"].entries()) ok(await orphan.call({ op: "enqueue", entry: {
    id, seq: i + 1, op: "send", args: { conversationId: "c1", body: id }, new_ids: [id], predictable: true, ...(i === 0 ? { observed_seq: 11 } : {}),
  } }));
  await orphan.close();
  let primary = await opener.open(name, backend("B"));
  assert.deepEqual(ok(await primary.call({ op: "queued" })).map(e => e.id), ["unknown"]);
  const kept = await persist.load(`${name}:tab-A`);
  assert.equal(kept.find(c => c.k === "device:store_id").v, "A");
  assert.deepEqual(kept.filter(c => c.s === "o").map(c => c.k), ["known"]);
  await primary.close(); primary = await opener.open(name, null);
  ok(await primary.call({ op: "apply", first: true, page: snapshot("B") }));
  assert.deepEqual(ok(await primary.call({ op: "queued" })).map(e => e.id), ["unknown"]);
  assert.deepEqual(await persist.load(`${name}:tab-A`), []);
  await primary.close();
});

test("same-store orphan adoption preserves receipts, order and row IDs without predictions", async t => {
  locks(t);
  const persist = memoryPersistence(), opener = webDevice({ wasm, persist }), name = "same-orphan";
  const orphan = await opener.open(`${name}:tab-A`, backend("A"));
  ok(await orphan.call({ op: "apply", first: true, page: snapshot("A") }));
  for (const [i, id] of ["known", "unknown"].entries()) ok(await orphan.call({ op: "enqueue", entry: {
    id, seq: i + 1, op: "send", args: {}, new_ids: [id], predictable: true, ...(i === 0 ? { observed_seq: 11 } : {}),
  } }));
  await orphan.close();
  const primary = await opener.open(name, backend("A")); t.after(() => primary.close());
  ok(await primary.call({ op: "apply", first: true, page: snapshot("A") }));
  const entries = ok(await primary.call({ op: "queued" }));
  // Unknowns may transfer before destination identification; the deferred
  // receipt follows once same-store ownership is established.
  assert.deepEqual(entries.map(e => e.id), ["unknown", "known"]);
  assert.equal(entries[1].observed_seq, 11);
  assert.ok(entries.every(e => !e.predictable && e.predicted.length === 0 && e.new_ids[0] === e.id));
});


for (const exit of [false, true]) test(`replacement receipts use ${exit ? "exit" : "ordinary"} transport without replaying known writes`, async t => {
  const window = new EventTarget(), document = new EventTarget(); document.visibilityState = "visible";
  for (const [key, value] of Object.entries({ window, document })) {
    const previous = Object.getOwnPropertyDescriptor(globalThis, key);
    Object.defineProperty(globalThis, key, { configurable: true, value });
    t.after(() => previous ? Object.defineProperty(globalThis, key, previous) : delete globalThis[key]);
  }
  const f = await fixture(t);
  f.offline(true); await f.client.sync();
  const known = await f.client.mutate({ kind: "mutation", name: "send" }, { conversationId: "c1", body: "known" });
  const unknown = await f.client.mutate({ kind: "mutation", name: "send" }, { conversationId: "c1", body: "unknown" });
  // Simulate A's stream acknowledgement after losing the full POST reply.
  ok(await f.core.call({ op: "apply", page: { snapshot: false, store_id: "A", events: [], watermark: 10, more: false, acknowledged: { [known.id]: 10 } } }));
  const before = ok(await f.core.call({ op: "queued" }));
  const unknownIds = before.find(e => e.id === unknown.id).new_ids;
  assert.equal(before.find(e => e.id === known.id).observed_seq, 10);
  f.replace();
  if (exit) {
    ok(await f.core.call({ op: "observe_store", page: snapshot("B") }));
    window.dispatchEvent(new Event("pagehide"));
  } else { f.offline(false); await f.client.sync(); }
  await until(() => f.sends.length > 0);
  assert.equal(f.sends.filter(s => s.id === known.id).length, 0);
  assert.equal(f.sends.filter(s => s.id === unknown.id).length, 1);
  assert.deepEqual(f.sends[0].newIds, unknownIds);
  assert.equal(f.sends[0].exit, exit); assert.equal(f.sends[0].store, "B");
});

test("finding 2: a rerun started by replacement observation cannot publish the old partition", async t => {
  const f = await fixture(t), watch = f.client.observe({ kind: "query", name: "marker" }, {}), notices = [];
  watch.subscribe(() => notices.push(watch.getSnapshot()));
  await until(() => watch.getSnapshot().data === "A");
  const barrier = f.holdMutation();
  const write = f.client.mutate({ kind: "mutation", name: "send" }, { conversationId: "c1", body: "pending" });
  await until(() => f.stats().mutationStarts > 0);
  // Finish any ordinary prediction rerun before starting the observation.
  await tick(); await tick(); notices.length = 0;
  f.replace(); await f.changed(); await tick();
  const stale = notices.filter(r => r.complete && r.data === "A");
  barrier.resolve(); await write;
  assert.deepEqual(stale, [], "a new revision cannot relabel a device read still backed by A as complete");
});

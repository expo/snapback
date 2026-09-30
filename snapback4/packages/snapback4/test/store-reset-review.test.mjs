// Deterministic transport barriers around the real wasm device.
import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { setImmediate as tick } from "node:timers/promises";
import { createLocalClient } from "../dist/local.js";
import { webDevice, memoryPersistence } from "../dist/web.js";
import { MediaCache } from "../dist/local-assets.js";
import { MutationIds, WriteHistory } from "../dist/writes.js";
import { deliverAcknowledgedReceipt, readQueued, receiptBatch, retiredReceipts } from "../dist/local-receipts.js";

const wasm = readFileSync(new URL("../dist/wasm/snapback4_device_bg.wasm", import.meta.url));
const original = JSON.parse(readFileSync(new URL("./chat-schema.json", import.meta.url), "utf8"));
const ok = reply => { assert.ok(!reply.denied, JSON.stringify(reply)); return reply.ok; };
const gate = () => { let resolve; const promise = new Promise(r => { resolve = r; }); return { promise, resolve }; };
async function until(check, message = "barrier was not reached") { for (let i = 0; i < 10000; i++) { if (await check()) return; await tick(); } assert.fail(message); }
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
  let queryGate, localGate, mutationGate, syncGate, localStarts = 0, queryStarts = 0, schemaCalls = 0, mutationStarts = 0, syncStarts = 0;
  const reads = [], clients = [], sends = [], syncRequests = [];
  let queryUnavailable = false, refuseSecond = false, beforeSend, beforeCall, afterCall, exitRefusal;
  let adopting, committed, resetReadFailure, failNextResetRead = false, failureOp = "observe_store";
  const fetcher = async (input, init = {}) => {
    if (offline && !init.keepalive) throw new TypeError("offline");
    const path = new URL(input).pathname;
    if (path === "/schema") { schemaCalls++; if (schemaFailures-- > 0) throw new TypeError("schema interrupted"); return Response.json({ ...backend(marker), schema, generation }); }
    if (path === "/sync") {
      syncStarts++;
      if (syncGate) await syncGate.promise;
      const request = JSON.parse(init.body);
      syncRequests.push(request);
      if (refuseSecond && sends.length > 0 && request.from !== 0) {
        const committed = events(store).filter(e => e.table === "messages");
        committed[0].data.body = "committed first";
        return Response.json({ snapshot: false, store_id: store, generation, events: committed, watermark: 11, more: false });
      }
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
      return Response.json(queryUnavailable ? { loading: true } : { data: captured, complete: true, tables: ["messages"] });
    }
    if (path.startsWith("/m/")) { if (init.keepalive && exitRefusal) return Response.json({ state: "failed", why: exitRefusal }); sends.push({ ...JSON.parse(init.body), store, exit: !!init.keepalive }); mutationStarts++; if (mutationGate) await mutationGate.promise;
      if (refuseSecond && sends.length === 2) return Response.json({ state: "failed", why: { code: "SECOND_REFUSED", family: "application", message: "second write refused", retryable: false } });
      return Response.json({ state: "sent", seq: 11 }); }
    if (path === "/probe") return Response.json({ ok: true });
    assert.fail(path);
  };
  async function open() {
    const opener = webDevice({ wasm, persist });
    client = await createLocalClient({ url: `http://reset.test/${encodeURIComponent(t.name)}`, persona: "alice", device: { async open(...a) { const opened = core = await opener.open(...a); return { ...opened, async call(request, committedReply) {
      const intercepted = await beforeCall?.(request);
      if (intercepted) return intercepted;
      if (request.op === "begin_send" && beforeSend) {
        const reply = await beforeSend(request);
        if (reply) return reply;
      }
      if (request.op === "sync_state" && failNextResetRead) {
        failNextResetRead = false;
        resetReadFailure();
        return { denied: { code: "E_STORE", family: "store", message: "injected post-reset read failure" } };
      }
      if (request.op === "adopt") adopting?.();
      const reply = await opened.call(request, committedReply);
      if (!reply.denied) committed?.(request, reply.ok);
      if (request.op === failureOp && !reply.denied && (failureOp === "adopt" || reply.ok?.reset) && resetReadFailure) failNextResetRead = true;
      await afterCall?.(request, reply);
      if (request.op === "query" && localGate) { localStarts++; await localGate.promise; }
      return reply;
    } }; } }, fetch: (input, init) => fetcher(String(input).replace(`/${encodeURIComponent(t.name)}`, ""), init) });
    clients.push(client); return client;
  }
  t.after(async () => { queryGate?.resolve(); localGate?.resolve(); mutationGate?.resolve(); syncGate?.resolve(); for (const c of clients) await c.close(); });
  await open();
  return { get client() { return client; }, get core() { return core; }, get changesWaiting() { return !!changes; }, open, persist, reads, sends, syncRequests,
    unavailable(value) { queryUnavailable = value; },
    refuseSecond() { refuseSecond = true; },
    beforeSend(callback) { beforeSend = callback; },
    beforeCall(callback) { beforeCall = callback; }, afterCall(callback) { afterCall = callback; },
    refuseExit(why) { exitRefusal = why; },
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
    holdSync() { return syncGate = gate(); },
    holdQueries() { return queryGate = gate(); }, holdMutation() { return mutationGate = gate(); },
    async changed(seq = 10) { await until(() => changes); const c = changes; changes = null; c.resolve({ seq, store_id: store, generation: 1 }); await tick(); },
  };
}

test("review: reset delivery retains a prior emission across concurrent lookup", async t => {
  const f = await fixture(t);
  await until(() => f.client.acquired);
  const notices = [];
  f.client.onWrite(w => notices.push(w));
  const write = await f.client.mutate({ kind: "mutation", name: "send" }, { conversationId: "c1", body: "sent" });
  assert.equal(write.state, "sent");
  for (let i=0;i<50;i++) await tick();
  assert.equal(notices.filter(w => w.id === write.id).length,1);
  assert.ok(ok(await f.core.call({op:"queued"})).some(e=>e.id===write.id));
  const finishing = gate(); t.after(() => finishing.resolve());
  let reset = false;
  f.afterCall(async (req, reply) => {
    if (req.op === "observe_store" && reply.ok?.reset) { reset = true; await finishing.promise; }
  });
  f.replace();
  const sync = f.client.sync();
  await until(() => reset);
  assert.equal((await f.client.write(write.id)).state,"sent");
  finishing.resolve();
  await sync;
  for (let i=0;i<30;i++) await tick();
  assert.equal(notices.filter(w => w.id === write.id).length,1,"reset cannot emit an already-delivered success again");
});

test("review: acknowledged success retirement retains prior emission across lookup", async t => {
  const f = await fixture(t);
  await until(() => f.client.acquired);
  t.mock.timers.enable({ apis: ["setTimeout"] });
  const notices = [];
  f.client.onWrite(w => notices.push(w));
  let failed = false;
  f.beforeCall(req => {
    if (req.op === "keep_write" && !failed) { failed=true;return {denied:{code:"E_STORE",family:"store",message:"save failed"}}; }
  });
  const write = await f.client.mutate({kind:"mutation",name:"send"},{conversationId:"c1",body:"sent"});
  assert.equal(write.state,"sent");
  for(let i=0;i<30;i++) await tick();
  assert.equal(notices.filter(w=>w.id===write.id).length,1);
  ok(await f.core.call({op:"apply",page:{snapshot:false,store_id:"A",events:[],watermark:11,more:false,acknowledged:{[write.id]:11},sent:{[write.id]:11}}}));
  const entry=ok(await f.core.call({op:"queued"})).find(e=>e.id===write.id);
  assert.equal(entry.sent_seq,null); assert.equal(entry.observed_seq,11);
  const finishing=gate();t.after(()=>finishing.resolve());
  let retired=false;
  f.afterCall(async (req, reply)=>{
    if(req.op==="settle" && req.id===write.id && !reply.denied){retired=true;await finishing.promise;}
  });
  t.mock.timers.tick(1000);
  await until(()=>retired);
  assert.equal((await f.client.write(write.id)).state,"sent");
  finishing.resolve();
  for(let i=0;i<100;i++)await tick();
  assert.equal(notices.filter(w=>w.id===write.id).length,1,"known-success retirement cannot emit twice");
});

test("review: pre-dispatch receipt recovery survives post-commit host failure", async t => {
  const f=await fixture(t); await until(()=>f.client.acquired);
  t.mock.timers.enable({apis:["setTimeout"]});
  const notices=[]; f.client.onWrite(w=>notices.push(w));
  let failed=false;
  f.afterCall(async(req,reply)=>{
    if(req.op==="admit" && !reply.denied) {
      ok(await f.core.call({op:"keep_write",value:JSON.stringify({state:"failed",id:req.entry.id,why:{code:"KNOWN",family:"application",message:"known refusal"}})}));
    }
    if(req.op==="settle" && !reply.denied && !failed){failed=true;throw Error("post-settle host failure");}
  });
  let outcome;
  const pending=f.client.mutate({kind:"mutation",name:"send"},{conversationId:"c1",body:"known"}).then(w=>outcome=w);
  await until(()=>failed); for(let i=0;i<30;i++)await tick();
  assert.equal(outcome?.state,"failed");
  assert.equal(notices.length,1); assert.equal(f.sends.length,0);
  await pending;
});
test("review: pending subscriber triggers duplicate successful recovery without a host delay", async t => {
  const f = await fixture(t);
  await until(() => f.client.acquired);
  t.mock.timers.enable({ apis: ["setTimeout"] });
  const notices = [];
  f.client.onWrite(w => notices.push(w));
  let failed = false;
  f.beforeCall(req => {
    if (req.op === "keep_write" && !failed) { failed=true;return {denied:{code:"E_STORE",family:"store",message:"save failed"}}; }
  });
  const write = await f.client.mutate({kind:"mutation",name:"send"},{conversationId:"c1",body:"sent"});
  assert.equal(write.state,"sent");
  for(let i=0;i<30;i++) await tick();
  assert.equal(notices.filter(w=>w.id===write.id).length,1);
  ok(await f.core.call({op:"apply",page:{snapshot:false,store_id:"A",events:[],watermark:11,more:false,acknowledged:{[write.id]:11},sent:{[write.id]:11}}}));
  const entry=ok(await f.core.call({op:"queued"})).find(e=>e.id===write.id);
  assert.equal(entry.sent_seq,null); assert.equal(entry.observed_seq,11);
  const stop = f.client.onPendingWrites(() => { void f.client.write(write.id); }); t.after(stop);
  t.mock.timers.tick(1000);
  await until(async () => ok(await f.core.call({op:"queued"})).length === 0);
  for(let i=0;i<100;i++)await tick();
  assert.equal(notices.filter(w=>w.id===write.id).length,1,"known-success retirement cannot emit twice");
});

test("replacement cannot duplicate a success still in an older flush snapshot", async t => {
  const f = await fixture(t);
  await until(() => f.client.acquired);
  t.mock.timers.enable({ apis: ["setTimeout"] });
  const notices = [], op = { kind: "mutation", name: "send" };
  f.client.onWrite(write => notices.push(write));
  const first = await f.client.mutate(op, { conversationId: "c1", body: "first" });
  const second = await f.client.mutate(op, { conversationId: "c1", body: "second" });
  for (let i = 0; i < 50; i++) await tick();
  const held = gate(); t.after(() => held.resolve());
  let reading = false;
  f.afterCall(async request => {
    if (request.op === "meta" && request.key === "write-history" && !reading) {
      reading = true; await held.promise;
    }
  });
  const third = f.client.mutate(op, { conversationId: "c1", body: "third" });
  await until(() => reading);
  f.replace();
  await f.client.sync();
  assert.equal((await f.client.write(second.id)).state, "sent");
  held.resolve();
  await third;
  for (let i = 0; i < 50; i++) await tick();
  for (const write of [first, second]) assert.equal(notices.filter(notice => notice.id === write.id).length, 1);
});

test("a delayed queue snapshot protects emissions until its entries can own delivery", async () => {
  const history = new WriteHistory(), read = gate();
  history.firstEmission("queued"); history.firstEmission("unrelated");
  const batch = receiptBatch(() => read.promise, history);
  const next = batch.next();
  history.retainEmissions([]); // Retirement and a second lookup overtake the held queue response.
  assert.equal(history.firstEmission("queued"), false);
  read.resolve([{ id: "queued" }]);
  assert.equal((await next).value.id, "queued");
  history.retainEmissions([]);
  assert.equal(history.firstEmission("queued"), false);
  assert.equal(history.firstEmission("unrelated"), true, "known snapshot ids do not pin unrelated emissions");
  await batch.return();
  history.retainEmissions([]);
  assert.equal(history.firstEmission("queued"), true, "early flush return releases the snapshot");
});

test("a failed queue snapshot releases emission cleanup", async () => {
  const history = new WriteHistory(); history.firstEmission("failed-read");
  const batch = receiptBatch(async () => { throw Error("queue failed"); }, history);
  await assert.rejects(batch.next(), /queue failed/);
  history.retainEmissions([]);
  assert.equal(history.firstEmission("failed-read"), true);
});

test("a retired settlement keeps its emitted refusal across a queue read", async () => {
  const history = new WriteHistory({ async read() { return null; }, async save() {} });
  const ids = new MutationIds(), settling = new Set(["retired"]);
  assert.equal(history.firstEmission("retired"), true);
  await readQueued(async () => ({ ok: [] }), ids, history, settling);
  assert.equal(history.firstEmission("retired"), false, "observation cannot forget an active settlement's prior notification");
  settling.delete("retired");
  await readQueued(async () => ({ ok: [] }), ids, history, settling);
  assert.equal(history.firstEmission("retired"), true, "the finished settlement releases bounded emission history");
});

for (const order of ["replacement-first", "acknowledgement-first"]) test(`overlapping receipt notifications keep their emission marker: ${order}`, async () => {
  const history = new WriteHistory({ async read() { return null; }, async save() {} });
  const id = "overlap", retiring = gate(), finish = gate();
  let notices = 0;
  const publish = write => {
    if (write.state === "sent") assert.deepEqual(write, { state: "sent", id, seq: 11, replayed: true }, "replacement recovery preserves replayed shape without a result");
    if (history.firstEmission(write.id)) notices++;
  };
  publish({ id });
  const acknowledged = deliverAcknowledgedReceipt(history, async () => {
    retiring.resolve(); await finish.promise; return {};
  }, { id, sent_seq: null }, 11, publish);
  await retiring.promise;
  const [replacement] = retiredReceipts(history, { [id]: 11 }, publish);
  if (order === "replacement-first") replacement();
  else { finish.resolve(); await acknowledged; }
  history.retainEmissions([]); // Queue retirement is visible while another owner still owes notification.
  assert.equal(history.firstEmission(id), false, "one owner cannot release another owner's marker");
  if (order === "replacement-first") { finish.resolve(); await acknowledged; }
  else replacement();
  assert.equal(notices, 1);
  history.retainEmissions([]);
  assert.equal(history.firstEmission(id), true, "completed delivery releases its marker for bounded cleanup");
});

for (const failure of ["settle", "publish", "replacement-publish"]) test(`receipt emission protection releases after ${failure} throws`, async () => {
  const history = new WriteHistory({ async read() { return null; }, async save() {} });
  const id = "failure";
  history.firstEmission(id);
  const publish = () => { throw Error("publish failed"); };
  if (failure === "replacement-publish") {
    const [notify] = retiredReceipts(history, { [id]: 11 }, publish);
    assert.throws(notify, /publish failed/);
  } else {
    await assert.rejects(deliverAcknowledgedReceipt(history, async () => {
      if (failure === "settle") throw Error("settle failed");
      return {};
    }, { id, sent_seq: null }, 11, publish), new RegExp(`${failure} failed`));
  }
  history.retainEmissions([]);
  assert.equal(history.firstEmission(id), true, "finally releases the completed or failed owner");
});

test("a queued send follows a settled receipt without waiting for an intermediate sync", async t => {
  const f = await fixture(t);
  await until(() => f.client.acquired);
  const sending = f.holdMutation();
  const op = { kind: "mutation", name: "send" };
  const receipt = f.client.mutate(op, { conversationId: "c1", body: "first" });
  await until(() => f.sends.length === 1);
  const message = f.client.mutate(op, { conversationId: "c1", body: "second" });
  await until(async () => ok(await f.core.call({ op: "queued" })).length === 2);
  const publishing = f.holdSync();
  sending.resolve();
  await until(() => f.sends.length === 2);
  assert.deepEqual(f.sends.map(write => write.args.body), ["first", "second"], "FIFO order is preserved");
  publishing.resolve();
  assert.deepEqual((await Promise.all([receipt, message])).map(write => write.state), ["sent", "sent"]);
});

test("a success followed by a terminal refusal syncs the committed write before the batch finishes", async t => {
  const f = await fixture(t);
  await until(() => f.client.acquired);
  f.refuseSecond();
  const sending = f.holdMutation();
  const op = { kind: "mutation", name: "send" };
  const first = f.client.mutate(op, { conversationId: "c1", body: "first" });
  await until(() => f.sends.length === 1);
  const second = f.client.mutate(op, { conversationId: "c1", body: "second" });
  await until(async () => ok(await f.core.call({ op: "queued" })).length === 2);
  const publishing = f.holdSync(), syncs = f.stats().syncStarts;
  let finished = false;
  const batch = Promise.all([first, second]).then(writes => { finished = true; return writes; });
  sending.resolve();
  await until(() => f.sends.length === 2 && (f.stats().syncStarts > syncs || finished));
  assert.deepEqual(f.sends.map(write => write.args.body), ["first", "second"]);
  assert.equal(finished, false, "batch completion waits for publication, with no sync between the POSTs");
  publishing.resolve();
  assert.deepEqual((await batch).map(write => write.state), ["sent", "failed"]);
  const read = ok(await f.core.call({ op: "query", name: "thread", viewer: "dev:alice", args, now: Date.now() }));
  assert.ok(read.data?.some(row => row.body === "committed first"), "the first commit is locally visible without a /changes wake");
});

test("an early flush exit syncs an earlier success when another owner retires the tail", async t => {
  const f = await fixture(t);
  await until(() => f.client.acquired);
  t.mock.timers.enable({ apis: ["setTimeout"] }); // A later retry cannot repair the missing exit sync.
  f.refuseSecond(); // The sync fixture publishes the first commit; /changes stays held.
  const sending = f.holdMutation(), op = { kind: "mutation", name: "send" };
  const first = f.client.mutate(op, { conversationId: "c1", body: "first" });
  await until(() => f.sends.length === 1);
  const second = f.client.mutate(op, { conversationId: "c1", body: "second" });
  await until(async () => ok(await f.core.call({ op: "queued" })).length === 2);
  f.beforeSend(async request => {
    // Another owner settles a terminal refusal just before this owner's
    // begin_send: no unresolved tail remains to justify skipping the sync.
    ok(await f.core.call({ op: "settle", id: request.id }));
    return { denied: { code: "E_STORE", family: "store", message: "tail retired by another owner" } };
  });
  const syncs = f.stats().syncStarts;
  sending.resolve();
  await first;
  await until(() => f.stats().syncStarts > syncs);
  await until(async () => ok(await f.core.call({ op: "query", name: "thread", viewer: "dev:alice", args, now: Date.now() })).data?.some(row => row.body === "committed first"));
  assert.equal(f.sends.length, 1, "the retired tail was never posted");
  await f.client.close();
  await second;
});

test("repeating media failure cannot gate an already queued send and retries stay bounded", async t => {
  const f = await fixture(t);
  await until(() => f.client.acquired && f.changesWaiting);
  t.mock.timers.enable({ apis: ["setTimeout"] });
  const notices = [], op = { kind: "mutation", name: "send" }, sending = f.holdMutation();
  f.client.onWrite(write => notices.push(write));
  const first = f.client.mutate(op, { conversationId: "c1", body: "first" });
  await until(() => f.sends.length === 1);
  let secondResult;
  const second = f.client.mutate(op, { conversationId: "c1", body: "second" }).then(write => secondResult = write);
  await until(async () => ok(await f.core.call({ op: "queued" })).length === 2);
  // Both admissions finished before the fault; the tail is outside the flush snapshot.
  for (let i = 0; i < 30; i++) await tick();
  let broken = true, checks = 0;
  const reconcile = MediaCache.prototype.reconcile;
  t.mock.method(MediaCache.prototype, "reconcile", function () {
    checks++;
    if (broken) throw Error("persistent media housekeeping failure");
    return reconcile.call(this);
  });
  const delays = [], timeout = globalThis.setTimeout;
  t.mock.method(globalThis, "setTimeout", (fn, ms, ...args) => {
    delays.push(ms); return timeout(fn, ms, ...args);
  });
  sending.resolve();
  assert.equal((await first).state, "sent");
  for (let i = 0; i < 50; i++) await tick();
  assert.equal(f.sends.length, 1);
  assert.deepEqual(delays, [250]);
  const initialChecks = checks;
  t.mock.timers.tick(249);
  for (let i = 0; i < 30; i++) await tick();
  assert.equal(checks, initialChecks, "no reconciliation before the retry deadline");
  t.mock.timers.tick(1);
  for (let i = 0; i < 100; i++) await tick();
  assert.equal(f.sends.length, 2, "persistent media failure must not stop the queued tail from posting");
  assert.equal(secondResult?.state, "sent", "terminal completion survives repeated media failures too");
  await second;
  for (let attempt = 0; attempt < 8; attempt++) {
    const before = checks, timers = delays.length;
    t.mock.timers.tick(5000);
    for (let i = 0; i < 100; i++) await tick();
    assert.ok(checks > before && checks <= before + 3, "one bounded reconciliation/sync attempt per timer");
    assert.equal(delays.length, timers + 1, "one retry timer, no immediate flush loop");
    assert.equal(delays.at(-1), Math.min(5000, 250 * 2 ** attempt), "failed housekeeping retains exponential backoff");
  }
  assert.equal(delays.at(-1), 5000, "backoff reaches its existing ceiling");
  assert.ok(delays.every(ms => ms >= 250 && ms <= 5000));
  assert.deepEqual(notices.map(write => write.state), ["sent", "sent"]);
  assert.equal(f.sends.length, 2, "housekeeping retries never repost either success");
  const ids = f.sends.map(write => write.id);
  ok(await f.core.call({ op: "apply", page: { snapshot: false, store_id: "A", events: [], watermark: 11,
    more: false, acknowledged: Object.fromEntries(ids.map(id => [id, 11])), sent: Object.fromEntries(ids.map(id => [id, 11])) } }));
  broken = false;
  const beforeRepair = checks, timers = delays.length;
  t.mock.timers.tick(5000);
  for (let i = 0; i < 100; i++) await tick();
  assert.equal(checks, beforeRepair + 1, "the pending housekeeping is repaired once");
  assert.equal(delays.length, timers, "a successful reconcile stops retrying");
  const repaired = checks;
  t.mock.timers.tick(10000);
  for (let i = 0; i < 30; i++) await tick();
  assert.equal(checks, repaired);
  let checksAtBegin;
  f.beforeSend(() => { checksAtBegin = checks; });
  assert.equal((await f.client.mutate(op, { conversationId: "c1", body: "after repair" })).state, "sent");
  assert.equal(checksAtBegin, repaired + 1, "only admission reconciles; the flush flag was cleared");
  assert.equal(notices.length, 3);
});

test("a committed admission still sends when media housekeeping keeps failing", async t => {
  const f = await fixture(t);
  await until(() => f.client.acquired && f.changesWaiting);
  t.mock.timers.enable({ apis: ["setTimeout"] });
  let failures = 0, outcome;
  t.mock.method(MediaCache.prototype, "reconcile", () => { failures++; throw Error("persistent admission media failure"); });
  const notices = [];
  f.client.onWrite(write => notices.push(write));
  const pending = f.client.mutate({ kind: "mutation", name: "send" }, { conversationId: "c1", body: "admitted" }).then(write => outcome = write);
  await until(() => outcome);
  assert.ok(failures > 0);
  assert.equal(outcome.state, "sent", "a committed admission must not become a local E_STORE refusal");
  await pending;
  assert.equal(f.sends.length, 1);
  assert.deepEqual(notices.map(write => write.state), ["sent"]);
  assert.equal((await f.client.write(outcome.id)).state, "sent");
  for (let i = 0; i < 3; i++) {
    t.mock.timers.tick(5000);
    for (let j = 0; j < 50; j++) await tick();
  }
  assert.equal(f.sends.length, 1);
  assert.equal(notices.length, 1);
});

test("repeating post-commit receipt-save failure cannot gate an already queued send", async t => {
  const f = await fixture(t);
  await until(() => f.client.acquired && f.changesWaiting);
  t.mock.timers.enable({ apis: ["setTimeout"] });
  const notices = [], op = { kind: "mutation", name: "send" }, sending = f.holdMutation();
  f.client.onWrite(write => notices.push(write));
  const first = f.client.mutate(op, { conversationId: "c1", body: "first" });
  await until(() => f.sends.length === 1);
  let secondResult;
  const second = f.client.mutate(op, { conversationId: "c1", body: "second" }).then(write => secondResult = write);
  await until(async () => ok(await f.core.call({ op: "queued" })).length === 2);
  let failures = 0;
  f.afterCall((request, reply) => {
    if (request.op === "keep_write" && !reply.denied) { failures++; throw Error("host failed after durable receipt save"); }
  });
  sending.resolve();
  assert.equal((await first).state, "sent");
  for (let i = 0; i < 50; i++) await tick();
  for (let attempt = 0; attempt < 8; attempt++) {
    t.mock.timers.tick(5000);
    for (let i = 0; i < 50; i++) await tick();
  }
  assert.ok(failures >= 2, "the host fails repeatedly after the real device commits");
  assert.equal(f.sends.length, 2, "durable receipt-save housekeeping must not strand the queued tail");
  assert.equal(secondResult?.state, "sent");
  await second;
  assert.deepEqual(notices.map(write => write.state), ["sent", "sent"]);
  const saved = JSON.parse(ok(await f.core.call({ op: "meta", key: "write-history" })));
  for (const { id } of f.sends) {
    assert.equal(saved.find(write => write.id === id)?.state, "sent");
    assert.equal((await f.client.write(id)).state, "sent");
  }
});

test("the observation catch schedules the only retry that can publish an earlier success", async t => {
  const f = await fixture(t);
  await until(() => f.client.acquired && f.changesWaiting);
  t.mock.timers.enable({ apis: ["setTimeout"] });
  f.refuseSecond();
  const sending = f.holdMutation(), notices = [], op = { kind: "mutation", name: "send" };
  const first = f.client.mutate(op, { conversationId: "c1", body: "first" });
  await until(() => f.sends.length === 1);
  const second = f.client.mutate(op, { conversationId: "c1", body: "second" });
  await until(async () => ok(await f.core.call({ op: "queued" })).length === 2);
  const tail = ok(await f.core.call({ op: "queued" }))[1].id;
  let failRead = false, failures = 0, scheduledAtDelivery;
  f.onCommit(request => { if (request.op === "settle" && request.id === tail) failRead = true; });
  f.beforeCall(request => {
    if (request.op === "queued" && failRead) {
      failRead = false; failures++;
      throw Error("observation queue read failed");
    }
  });
  const delays = [], timeout = globalThis.setTimeout;
  t.mock.method(globalThis, "setTimeout", (fn, ms, ...args) => { delays.push(ms); return timeout(fn, ms, ...args); });
  f.client.onWrite(write => {
    notices.push(write);
    if (write.id === tail) {
      scheduledAtDelivery = [...delays];
      f.offline(true); // The post-loop sync fails; it cannot publish or schedule its own flush.
    }
  });
  sending.resolve();
  assert.deepEqual((await Promise.all([first, second])).map(write => write.state), ["sent", "failed"]);
  for (let i = 0; i < 50; i++) await tick();
  assert.equal(failures, 1);
  assert.deepEqual(scheduledAtDelivery, [250], "the observation catch must arm its retry before delivering the refusal");
  assert.deepEqual(delays, [250], "no alternate retry source after the failed post-loop sync");
  assert.equal(f.client.link(), "offline");
  const published = async () => ok(await f.core.call({ op: "query", name: "thread", viewer: "dev:alice", args, now: Date.now() })).data?.some(row => row.body === "committed first");
  assert.equal(await published(), false);
  f.offline(false); // Restores the transport only; /changes is still held.
  const syncs = f.stats().syncStarts;
  t.mock.timers.tick(249);
  for (let i = 0; i < 30; i++) await tick();
  assert.equal(f.stats().syncStarts, syncs);
  assert.equal(await published(), false);
  t.mock.timers.tick(1);
  await until(published);
  assert.deepEqual(notices.map(write => write.state), ["sent", "failed"]);
  assert.equal((await f.client.write(tail)).state, "failed");
  assert.equal(f.sends.length, 2);
});

// Faults after durable settlement must not change a caller or subscriber's outcome.
test("a durable refusal still completes when its observation queue read fails", async t => {
  const f = await fixture(t);
  await until(() => f.client.acquired);
  t.mock.timers.enable({ apis: ["setTimeout"] });
  f.refuseSecond();
  const sending = f.holdMutation(), notices = [], op = { kind: "mutation", name: "send" };
  f.client.onWrite(write => notices.push(write));
  const first = f.client.mutate(op, { conversationId: "c1", body: "first" });
  await until(() => f.sends.length === 1);
  let secondResult;
  const second = f.client.mutate(op, { conversationId: "c1", body: "second" }).then(write => secondResult = write);
  await until(async () => ok(await f.core.call({ op: "queued" })).length === 2);
  const secondId = ok(await f.core.call({ op: "queued" }))[1].id;
  let failRead = false, failures = 0;
  f.onCommit(request => { if (request.op === "settle" && request.id === secondId) failRead = true; });
  f.beforeCall(request => {
    if (request.op === "queued" && failRead) {
      failRead = false; failures++;
      return { denied: { code: "E_STORE", family: "store", message: "transient queue read after durable refusal" } };
    }
  });
  const publishing = f.holdSync();
  sending.resolve();
  await until(() => failures === 1);
  for (let i = 0; i < 30; i++) await tick();
  assert.equal(secondResult?.state, "failed", "terminal delivery cannot wait for observation recovery or a caller timeout");
  assert.equal(secondResult.why.code, "SECOND_REFUSED");
  assert.equal((await f.client.write(secondId)).state, "failed");
  assert.equal(notices.filter(write => write.id === secondId).length, 1);
  publishing.resolve();
  t.mock.timers.tick(1000); // Separate retry publishes the earlier success.
  await until(async () => ok(await f.core.call({ op: "query", name: "thread", viewer: "dev:alice", args, now: Date.now() })).data?.some(row => row.body === "committed first"));
  assert.deepEqual((await Promise.all([first, second])).map(write => write.state), ["sent", "failed"]);
  assert.equal(notices.filter(write => write.id === secondId).length, 1, "retry never emits the refusal twice");
});

test("receipt-save retry preserves refusal notification deduplication through observation", async t => {
  const f = await fixture(t);
  await until(() => f.client.acquired);
  t.mock.timers.enable({ apis: ["setTimeout"] });
  f.refuseSecond();
  const sending = f.holdMutation(), notices = [], op = { kind: "mutation", name: "send" };
  f.client.onWrite(write => notices.push(write));
  const first = f.client.mutate(op, { conversationId: "c1", body: "first" });
  await until(() => f.sends.length === 1);
  const second = f.client.mutate(op, { conversationId: "c1", body: "second" });
  await until(async () => ok(await f.core.call({ op: "queued" })).length === 2);
  let failures = 0;
  f.beforeCall(request => {
    if (request.op === "keep_write" && JSON.parse(request.value).state === "failed" && failures < 2) {
      failures++;
      return { denied: { code: "E_STORE", family: "store", message: "receipt save aborted" } };
    }
  });
  sending.resolve();
  const refused = await second;
  assert.equal(refused.state, "failed");
  assert.equal(notices.filter(write => write.id === refused.id).length, 1);
  for (let i = 0; i < 30; i++) await tick();
  t.mock.timers.tick(1000);
  await until(async () => failures === 2 && !ok(await f.core.call({ op: "queued" })).some(entry => entry.id === refused.id));
  await until(async () => ok(await f.core.call({ op: "query", name: "thread", viewer: "dev:alice", args, now: Date.now() })).data?.some(row => row.body === "committed first"));
  for (let i = 0; i < 30; i++) await tick();
  assert.equal(notices.filter(write => write.id === refused.id).length, 1, "observation cannot forget an active settlement's prior notification");
  assert.equal((await f.client.write(refused.id)).state, "failed");
  assert.equal((await first).state, "sent");
});

test("the final flush sync publishes an earlier success when the tail retires before its queue lookup", async t => {
  const f = await fixture(t);
  await until(() => f.client.acquired);
  t.mock.timers.enable({ apis: ["setTimeout"] });
  f.refuseSecond(); // Publish the first commit; /changes remains held.
  const sending = f.holdMutation(), op = { kind: "mutation", name: "send" };
  const first = f.client.mutate(op, { conversationId: "c1", body: "first" });
  await until(() => f.sends.length === 1);
  const second = f.client.mutate(op, { conversationId: "c1", body: "second" });
  await until(async () => ok(await f.core.call({ op: "queued" })).length === 2);
  const tail = ok(await f.core.call({ op: "queued" }))[1].id;
  let delivered = false, rereading = false, checked = false, retired = false, tailBegins = 0;
  f.client.onWrite(write => { if (write.id !== tail) delivered = true; });
  f.beforeCall(async request => {
    if (request.op === "begin_send" && request.id === tail) tailBegins++;
    // In the next FIFO snapshot, the known-success branch re-reads history
    // then checks sync eligibility. Leave the tail present through that check;
    // retire it only at the following network callback's fresh queue lookup.
    if (delivered && request.op === "meta" && request.key === "write-history") rereading = true;
    if (request.op === "queued" && rereading && !retired) {
      if (!checked) checked = true;
      else { ok(await f.core.call({ op: "settle", id: tail })); retired = true; }
    }
  });
  const publishing = f.holdSync(), syncs = f.stats().syncStarts;
  sending.resolve();
  await first;
  await until(() => retired);
  await until(() => f.stats().syncStarts > syncs, "the final post-loop guard must start sync");
  assert.equal(tailBegins, 0, "retired → continue, never the denied begin_send early exit");
  assert.equal(f.sends.length, 1);
  publishing.resolve();
  await until(async () => ok(await f.core.call({ op: "query", name: "thread", viewer: "dev:alice", args, now: Date.now() })).data?.some(row => row.body === "committed first"));
  await f.client.close(); await second;
});

for (const failure of ["media", "host"]) test(`recovered refusal delivery survives post-commit ${failure} failure`, async t => {
  const f = await fixture(t);
  await until(() => f.client.acquired);
  t.mock.timers.enable({ apis: ["setTimeout"] });
  const notices = [], why = { code: "RECOVERED_REFUSAL", family: "application", message: "known refusal" };
  f.client.onWrite(write => notices.push(write));
  f.beforeSend(async request => {
    const receipt = { state: "failed", id: request.id, why };
    ok(await f.core.call({ op: "keep_write", value: JSON.stringify(receipt) }));
    return { ok: { receipt } };
  });
  let failed = false, armed = false, repairs = 0;
  f.onCommit(request => { if (request.op === "settle") armed = true; });
  const reconcile = MediaCache.prototype.reconcile;
  t.mock.method(MediaCache.prototype, "reconcile", function () {
    if (armed) {
      if (failure === "media" && !failed) { failed = true; throw Error("post-settle media failure"); }
      repairs++;
    }
    return reconcile.call(this);
  });
  f.afterCall(request => { if (failure === "host" && request.op === "settle" && !failed) { failed = true; throw Error("post-settle host failure"); } });
  let result;
  const pending = f.client.mutate({ kind: "mutation", name: "send" }, { conversationId: "c1", body: "recover" }).then(write => result = write);
  await until(() => failed);
  for (let i = 0; i < 30; i++) await tick();
  assert.equal(result?.state, "failed", "durable recovery delivers before retry time advances");
  assert.equal(result.why.code, why.code);
  assert.equal((await f.client.write(result.id)).state, "failed");
  assert.equal(notices.filter(write => write.id === result.id).length, 1);
  assert.equal(f.sends.length, 0, "receipt recovery never reposts");
  const before = repairs;
  t.mock.timers.tick(1000);
  await until(() => repairs > before);
  assert.equal(notices.filter(write => write.id === result.id).length, 1);
  await pending;
});

for (const failure of ["state", "metadata", "media", "host"]) test(`replacement retired-success delivery survives post-commit ${failure} failure`, async t => {
  const f = await fixture(t);
  await until(() => f.client.acquired);
  f.offline(true); await f.client.sync();
  t.mock.timers.enable({ apis: ["setTimeout"] });
  const notices = [];
  f.client.onWrite(write => notices.push(write));
  const pending = await f.client.mutate({ kind: "mutation", name: "send" }, { conversationId: "c1", body: "acknowledged" });
  assert.equal(pending.state, "pending");
  ok(await f.core.call({ op: "apply", page: { snapshot: false, store_id: "A", events: [], watermark: 10, more: false, acknowledged: { [pending.id]: 10 }, sent: { [pending.id]: 10 } } }));
  let armed = false, failed = false;
  f.onCommit((request, result) => { if (request.op === "observe_store" && result.reset) armed = true; });
  f.beforeCall(request => {
    if (armed && !failed && ((failure === "state" && request.op === "sync_state") || (failure === "metadata" && request.op === "set_meta"))) {
      failed = true; throw Error(`post-reset ${failure} failure`);
    }
  });
  f.afterCall(request => { if (armed && failure === "host" && request.op === "observe_store" && !failed) { failed = true; throw Error("post-reset host failure"); } });
  const reconcile = MediaCache.prototype.reconcile;
  t.mock.method(MediaCache.prototype, "reconcile", function () {
    if (armed && failure === "media" && !failed) { failed = true; throw Error("post-reset media failure"); }
    return reconcile.call(this);
  });
  f.replace(); f.offline(false);
  await assert.rejects(f.client.sync(), /post-reset/);
  assert.equal(failed, true);
  assert.deepEqual(notices.filter(write => write.id === pending.id), [{ state: "sent", id: pending.id, seq: 10, replayed: true }], "replacement recovery preserves replayed shape without a result");
  assert.equal((await f.client.write(pending.id)).state, "sent");
  assert.equal(f.client.acquired, false, "completion never blesses the replacement partition");
  await f.client.sync();
  assert.equal(notices.filter(write => write.id === pending.id).length, 1);
});

for (const failure of ["media", "host"]) test(`keepalive refusal delivery survives post-commit ${failure} failure`, async t => {
  const window = new EventTarget(), document = new EventTarget(); document.visibilityState = "visible";
  for (const [key, value] of Object.entries({ window, document })) {
    const previous = Object.getOwnPropertyDescriptor(globalThis, key);
    Object.defineProperty(globalThis, key, { configurable: true, value });
    t.after(() => previous ? Object.defineProperty(globalThis, key, previous) : delete globalThis[key]);
  }
  const f = await fixture(t);
  await until(() => f.client.acquired);
  f.offline(true); await f.client.sync();
  t.mock.timers.enable({ apis: ["setTimeout"] });
  const notices = [], why = { code: "E_STORE_REPLACED", family: "store", message: "store replaced", retryable: false };
  f.client.onWrite(write => notices.push(write));
  const pending = await f.client.mutate({ kind: "mutation", name: "send" }, { conversationId: "c1", body: "exit" });
  f.refuseExit(why);
  let armed = false, failed = false;
  f.onCommit(request => { if (request.op === "settle_exit") armed = true; });
  const reconcile = MediaCache.prototype.reconcile;
  t.mock.method(MediaCache.prototype, "reconcile", function () {
    if (armed && failure === "media" && !failed) { failed = true; throw Error("post-exit media failure"); }
    return reconcile.call(this);
  });
  f.afterCall(request => { if (failure === "host" && request.op === "settle_exit" && !failed) { failed = true; throw Error("post-exit host failure"); } });
  window.dispatchEvent(new Event("pagehide"));
  await until(() => failed);
  for (let i = 0; i < 30; i++) await tick();
  assert.equal((await f.client.write(pending.id)).state, "failed");
  assert.deepEqual(notices.filter(write => write.id === pending.id).map(write => write.why.code), [why.code]);
  assert.equal(ok(await f.core.call({ op: "queued" })).length, 0);
});

test("receipt head observations do not rescan retained media until publication or replacement", async t => {
  const f = await fixture(t);
  await until(() => f.client.acquired);
  let observations = 0, checks = 0;
  f.onCommit(request => { if (request.op === "observe_store") observations++; });
  const reconcile = MediaCache.prototype.reconcile;
  t.mock.method(MediaCache.prototype, "reconcile", function () { checks++; return reconcile.call(this); });
  for (let peer = 0; peer < 49; peer++) {
    await f.changed();
    await until(() => observations > peer);
  }
  assert.equal(checks, 0, "authenticated head observations change no media authority or rows");
  await f.client.sync();
  assert.ok(checks > 0, "publication still revalidates retained media");
  checks = 0;
  f.replace(); await f.client.sync();
  assert.ok(checks > 0, "replacement still retires old media before acquisition");
});

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
  assert.equal((await f.client.query(remote, {})).data, "A", "prime a server answer too");
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
  assert.equal((await f.client.query(remote, {})).denied?.code, f.client.link() === "offline" ? "E_OFFLINE" : "E_QUERY_RETRY", "unavailable partitions cannot recover the retired answer");
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
      if (path === "/assets/photo") return new Response(new Uint8Array([1]), { headers: {
        "content-type": "image/png", "accept-ranges": "bytes",
        "x-snapback-asset-home": encodeURIComponent(JSON.stringify({ store_id: "A", table: "messages", row: "A-0", column: "photo" })),
      } });
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
  else assert.equal(offline.denied?.code, "E_OFFLINE", "a one-shot the device cannot run refuses offline");
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
  assert.equal(read.denied?.code, "E_QUERY_RETRY", "a reset cannot replace an unobserved prediction with either store’s server answer");
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
  ok(await f.core.call({ op: "apply", page: { snapshot: false, store_id: "A", events: [], watermark: 10, more: false, acknowledged: { [known.id]: 10 }, sent: { [known.id]: 10 } } }));
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


test("generation discovery clears retained answers even when backend adoption cannot start", async t => {
  const f = await fixture(t), watch = f.client.observe({ kind: "query", name: "marker" }, {});
  await until(() => watch.getSnapshot().data === "A");
  f.unavailable(true); f.failSchema(100); f.updateBackend();
  await f.client.sync();
  assert.deepEqual(watch.getSnapshot(), { loading: true }, "the old generation's authority cannot survive a failed schema fetch");
  watch.close();
});

test("review extra: repeating acknowledged-observation failure cannot strand queued tail", async t => {
  const f = await fixture(t);
  await until(() => f.client.acquired && f.changesWaiting);
  t.mock.timers.enable({ apis: ["setTimeout"] });
  const notices = [], op = { kind: "mutation", name: "send" };
  f.client.onWrite(w => notices.push(w));
  const first = await f.client.mutate(op, { conversationId: "c1", body: "first" });
  assert.equal(first.state, "sent");
  for (let i=0;i<50;i++) await tick();
  assert.ok(ok(await f.core.call({ op: "queued" })).some(e => e.id === first.id && e.sent_seq === 11));
  let failObservation = false, failures = 0;
  f.afterCall(req => { if (req.op === "meta" && req.key === "write-history") failObservation = true; });
  f.beforeCall(req => {
    if (req.op === "queued" && failObservation) {
      failObservation = false; failures++;
      throw Error("observation queue read failed");
    }
  });
  const second = await f.client.mutate(op, { conversationId: "c1", body: "second" }, { waitSeconds: 0 });
  for (let i=0;i<100;i++) await tick();
  for (let n=0;n<8;n++) { t.mock.timers.tick(5000); for (let i=0;i<100;i++) await tick(); }
  assert.ok(failures >= 8);
  assert.equal(f.sends.length, 2, "observation failure must not strand healthy queued tail");
  assert.deepEqual(notices.map(w => w.state), ["sent", "sent"]);
});

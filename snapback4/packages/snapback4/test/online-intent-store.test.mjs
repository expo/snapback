import test from "node:test";
import assert from "node:assert/strict";
import { createApp } from "../dist/app.js";
import { keepSession, memorySessionStore } from "../dist/auth.js";
import { storeKey } from "../dist/app-storage.js";
import { mintId } from "../dist/client.js";
import { until } from "./helpers/app-server.mjs";

const op = { kind: "mutation", name: "charge" }, page = { kind: "query", name: "page" };
async function fixture(t) {
  const url = `https://intent-${mintId().toLowerCase()}.invalid`, memory = memorySessionStore();
  const key = storeKey("writes", url, "alice"), receipts = new Map(), sends = [], executions = new Map(), apps = [];
  let store = "A", head = 0, failReceipts = false, failIdentity = false, swapOnSend = false;
  let heldProbe;
  await keepSession(url, { token: "bearer", principal: "alice", kind: "user", expiresAt: Date.now() + 30 * 86400_000 }, memory);
  const sessionStore = { ...memory, async set(k, bytes) {
    if (k === key) {
      const next = JSON.parse(bytes);
      if (failReceipts && next.receipts.length) throw Error("receipt save failed");
      if (failIdentity && next.pending.some(intent => intent.storeId)) throw Error("intent store identity save failed");
    }
    await memory.set(k, bytes);
  } };
  const fetcher = async (input, init) => {
    const path = new URL(input).pathname;
    if (path === "/auth/logout") return Response.json({ ok: true });
    if (path === "/probe") {
      if (heldProbe) { heldProbe.entered = true; await heldProbe.promise; }
      return Response.json({ ok: true, store_id: store, seq: head });
    }
    if (path.startsWith("/q/")) return Response.json({ data: [], complete: true, store_id: store, seq: head });
    assert.equal(path, "/m/charge");
    const args = JSON.parse(init.body);
    sends.push({ store, ...args });
    const saved = JSON.parse(await memory.get(key));
    const intent = saved.pending.find(entry => entry.id === args.id);
    assert.equal(intent.storeId, args.store_id, "the exact dispatch store was durable before network entry");
    assert.equal(intent.dispatched, true);
    if (swapOnSend) { swapOnSend = false; store = "B"; head = 0; }
    if (args.store_id !== store) return Response.json({ state: "failed", id: args.id, store_id: store, head,
      why: { code: "E_STORE_REPLACED", family: "store", message: "target changed before admission" } });
    const lookup = `${store}/${args.id}`;
    if (receipts.has(lookup)) return Response.json({ ...receipts.get(lookup), replayed: true, head });
    executions.set(lookup, (executions.get(lookup) ?? 0) + 1);
    const result = { state: "sent", id: args.id, seq: ++head, store_id: store, head };
    receipts.set(lookup, result);
    return Response.json(result);
  };
  const open = async () => {
    const app = createApp({ url, sessionStore, fetch: fetcher }); apps.push(app); await app.ready; return app;
  };
  t.after(async () => { heldProbe?.release(); failReceipts = false; failIdentity = false; for (const app of apps) await app.close(); });
  return { open, sends, executions, key, memory,
    replace() { store = "B"; head = 0; }, race() { swapOnSend = true; },
    failReceipts(value) { failReceipts = value; }, failIdentity(value) { failIdentity = value; },
    holdProbe() { let release; const promise = new Promise(resolve => { release = resolve; }); return heldProbe = { promise, release, entered: false }; },
    async journal() { return JSON.parse(await memory.get(key)); },
    async preload(pending, extra = {}) { await memory.set(key, JSON.stringify({ owner: "alice", backend: url, pending, receipts: [], ...extra })); },
  };
}

for (const replace of [false, true]) test(`unpersisted terminal intent reopens only on its acknowledged store; replacement=${replace}`, async t => {
  const f = await fixture(t), app = await f.open(), id = mintId(), events = [];
  app.client.onWrite(write => events.push(write)); f.failReceipts(true);
  assert.equal((await app.mutate(op, {}, { id })).state, "sent");
  assert.equal((await app.client.write(id)).state, "sent");
  assert.equal(events.length, 1);
  assert.equal((await f.journal()).pending[0].storeId, "A");
  await app.close(); f.failReceipts(false); if (replace) f.replace();
  const reopened = await f.open();
  const result = await until(async () => { const value = await reopened.client.write(id); return value?.state !== "pending" && value; });
  if (replace) {
    assert.equal(result.why.code, "E_STORE_REPLACED"); assert.match(result.why.message, /unknown/);
    assert.equal(f.sends.filter(write => write.id === id).length, 1, "old intent never reaches B");
    assert.equal((await reopened.mutate(op, {})).state, "sent", "retiring old intent leaves the new store usable");
  } else { assert.equal(result.state, "sent"); assert.equal(result.replayed, true); assert.equal(f.sends.length, 2); }
  assert.equal(f.executions.get(`A/${id}`), 1); assert.equal(f.executions.has(`B/${id}`), false);
  assert.equal((await f.journal()).pending.length, 0);
});

test("a persisted terminal receipt never reposts on reopen", async t => {
  const f = await fixture(t), app = await f.open(), id = mintId();
  assert.equal((await app.mutate(op, {}, { id })).state, "sent"); await app.close();
  const reopened = await f.open(); assert.equal((await reopened.mutate(op, {}, { id })).state, "sent");
  assert.equal(f.sends.length, 1); assert.equal(f.executions.get(`A/${id}`), 1);
});

test("the first fresh write after replacement binds B even when the pending journal is empty", async t => {
  const f = await fixture(t), app = await f.open(), oldId = mintId(), freshId = mintId();
  assert.equal((await app.mutate(op, {}, { id: oldId })).state, "sent");
  await app.close();
  assert.equal((await f.journal()).pending.length, 0);
  assert.equal((await f.journal()).firstStore, "A");
  f.replace(); const reopened = await f.open(), probe = f.holdProbe();
  // No query establishes B first: this is the builder's dev --fresh path.
  const writing = reopened.mutate(op, {}, { id: freshId });
  await until(() => probe.entered);
  assert.deepEqual((await f.journal()).pending, [], "fresh admission waits for current store discovery");
  probe.release(); assert.equal((await writing).state, "sent");
  assert.deepEqual(f.sends.map(write => [write.id, write.store_id]), [[oldId, "A"], [freshId, "B"]]);
  assert.equal(f.executions.get(`B/${freshId}`), 1);
  assert.equal((await f.journal()).changedStore, true);
});

test("retrying the first fresh replacement id recovers its receipt without retiring or executing it twice", async t => {
  const f = await fixture(t), app = await f.open(), oldId = mintId(), freshId = mintId();
  assert.equal((await app.mutate(op, {}, { id: oldId })).state, "sent"); await app.close();
  f.replace(); const reopened = await f.open();
  const first = await reopened.mutate(op, { value: "fresh" }, { id: freshId });
  assert.equal(first.state, "sent");
  const again = await reopened.mutate(op, { value: "fresh" }, { id: freshId });
  assert.deepEqual(again, { state: "sent", id: freshId, seq: first.seq, replayed: true });
  await reopened.close(); const third = await f.open();
  assert.deepEqual(await third.mutate(op, { value: "fresh" }, { id: freshId }), again);
  assert.equal((await third.mutate(op, {}, { id: oldId })).state, "sent", "the receipt from A is still recoverable without sending it to B");
  assert.equal(f.sends.length, 2); assert.equal(f.executions.get(`B/${freshId}`), 1);
});

test("failed intent identity persistence refuses admission before any dispatch", async t => {
  const f = await fixture(t), app = await f.open();
  f.failIdentity(true);
  await assert.rejects(app.mutate(op, {}), /intent store identity save failed/);
  assert.equal(f.sends.length, 0); assert.equal((await f.journal()).pending.length, 0);
  await app.close(); f.failIdentity(false); await f.open(); assert.equal(f.sends.length, 0);
});

test("close detaches a held first-store probe and preserves the pending intent for reopen", { timeout: 5000 }, async t => {
  const f = await fixture(t), app = await f.open(), id = mintId(), probe = f.holdProbe();
  const writing = app.mutate(op, {}, { id }); await until(() => probe.entered);
  await app.close();
  assert.equal((await f.journal()).pending[0].id, id, "public close finishes local admission without waiting for the probe");
  assert.deepEqual(await writing, { state: "pending", id });
  assert.equal(f.sends.length, 0);
  probe.release(); const reopened = await f.open();
  await until(async () => (await reopened.client.write(id))?.state === "sent");
  assert.equal(f.executions.get(`A/${id}`), 1);
});

for (const scenario of [
  { name: "first observed store", extra: {}, replace: false, sent: true },
  { name: "same first store", extra: { firstStore: "A" }, replace: false, sent: true },
  { name: "replacement", extra: { firstStore: "A" }, replace: true, sent: false },
  { name: "return to first store after a replacement", extra: { firstStore: "A", changedStore: true }, replace: false, sent: false },
]) for (const dispatched of [undefined, false]) test(`intent without an identity: ${scenario.name}; dispatched=${dispatched}`, async t => {
  const f = await fixture(t), id = mintId();
  // dispatched=false is the crash after observe(firstStore), before before() binds the intent.
  await f.preload([{ owner: "alice", id, op: op.name, args: {}, storeId: null, dispatched }], scenario.extra);
  if (scenario.replace) f.replace();
  const app = await f.open();
  const result = await until(async () => { const write = await app.client.write(id); return write?.state !== "pending" && write; });
  assert.equal(result.state, scenario.sent ? "sent" : "failed");
  if (!scenario.sent) assert.equal(result.why.code, "E_STORE_REPLACED");
  assert.equal(f.sends.length, scenario.sent ? 1 : 0);
});

test("store precondition prevents execution when the endpoint changes after the probe", async t => {
  const f = await fixture(t), app = await f.open(), id = mintId();
  await app.client.query(page, {}); f.race();
  const write = await app.mutate(op, {}, { id });
  assert.equal(write.why.code, "E_STORE_REPLACED"); assert.equal(f.executions.size, 0);
});

test("unpersisted receipt notifications survive the ordinary 256-receipt history window", async t => {
  const f = await fixture(t), app = await f.open(), events = [];
  app.client.onWrite(write => events.push(write.id)); f.failReceipts(true);
  for (let n = 0; n < 257; n++) assert.equal((await app.mutate(op, {})).state, "sent");
  const id = events[0]; assert.equal(events.length, 257);
  assert.equal((await app.client.write(id)).state, "sent"); assert.equal(events.length, 257);
  f.failReceipts(false); assert.equal((await app.client.write(id)).state, "sent"); assert.equal(events.length, 257);
});

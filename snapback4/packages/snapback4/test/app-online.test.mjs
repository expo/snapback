import test from "node:test";
import assert from "node:assert/strict";
import { setTimeout as delay } from "node:timers/promises";
import { onlineCustody } from "../dist/app-online.js";
import { memorySessionStore } from "../dist/auth.js";
import { mintId } from "../dist/client.js";
import { MutationIds, WRITE_HISTORY_LIMIT } from "../dist/writes.js";
import { trackDispatch } from "../dist/online-dispatch.js";

test("asynchronous settlement bounds online argument reservations, including another owner's retirement", async t => {
  const store = memorySessionStore(), instances = new Set(), emitted = [], callbacks = [];
  const original = MutationIds.prototype.run;
  t.mock.method(MutationIds.prototype, "run", function (...args) { instances.add(this); return original.apply(this, args); });
  const make = () => {
    let callback;
    const raw = { viewer: () => "alice", onWrite(fn) { callback = fn; return () => {}; },
      mutate: async (op, args, { id }) => ({ state: "pending", id }), write: async () => undefined,
      close: async () => {}, signOut: async () => {} };
    trackDispatch(raw, { store: "test-store" });
    callbacks.push(write => callback(write));
    return onlineCustody(raw, "https://bound.invalid", store, error => { throw error; });
  };
  const a = await make(), b = await make();
  t.after(async () => { await a.client.close(); await b.client.close(); });
  a.client.onWrite(write => emitted.push("a:" + write.id)); b.client.onWrite(write => emitted.push("b:" + write.id));
  const until = async check => { for (let n = 0; n < 500; n++) { if (check()) return; await delay(1); } assert.fail("settlement notification missing"); };
  for (let i = 0; i < 300; i++) {
    const id = mintId(), op = { kind: "mutation", name: "write" }, args = { body: "retained input " + i };
    await a.client.mutate(op, args, { id }); await b.client.mutate(op, args, { id });
    callbacks[0]({ state: "sent", id, seq: i + 1 });
    await until(() => emitted.includes("a:" + id));
    callbacks[1]({ state: "sent", id, seq: i + 1, replayed: true });
    await until(() => emitted.includes("b:" + id));
  }
  // Inspect internal retained state because the regression concerns memory
  // after background settlement, not the public receipt's already-correct value.
  const owners = [...instances].filter(ids => ids.seen.size === 300);
  assert.equal(owners.length, 2);
  for (const ids of owners) {
    assert.ok(ids.submissions.size <= WRITE_HISTORY_LIMIT, `${ids.submissions.size} retained argument identities`);
    assert.equal([...ids.submissions.values()].filter(entry => entry.pending).length, 0);
  }
  assert.equal(emitted.length, 600);
});

for (const state of ["sent", "failed"]) for (const source of ["mutate", "lookup", "background"]) {
  test(`online custody keeps ${state} from ${source} consistent while receipt saves fail`, async t => {
    const memory = memorySessionStore(), id = mintId(), notifications = [], errors = [];
    const outcome = state === "sent" ? { state, id, seq: 3, result: { value: "current response" } }
      : { state, id, why: { code: "E_INPUT", family: "input", message: "authoritative refusal", retryable: false } };
    let fail = true, unreadable = false, callback, available, failures = 0, key;
    const store = { ...memory, async get(k) {
      if (unreadable && k.endsWith(".writes")) throw Error("journal read unavailable");
      return memory.get(k);
    }, async set(k, text) {
      if (k.endsWith(".writes")) {
        key = k;
        if (fail && JSON.parse(text).receipts.length) { failures++; throw Error("receipt save unavailable"); }
      }
      await memory.set(k, text);
    } };
    const raw = { viewer: () => "alice", onWrite(fn) { callback = fn; return () => {}; },
      mutate: async () => source === "mutate" ? outcome : { state: "pending", id },
      write: async () => available, close: async () => {}, signOut: async () => {} };
    trackDispatch(raw, { store: "test-store" });
    const { client } = await onlineCustody(raw, "https://receipt.invalid", store, error => errors.push(error));
    t.after(() => client.close()); client.onWrite(value => notifications.push(value));
    const first = await client.mutate({ kind: "mutation", name: "write" }, { body: "one" }, { id });
    if (source === "mutate") assert.deepEqual(first, outcome);
    else {
      assert.equal(first.state, "pending");
      assert.deepEqual((await client.pendingWrites()).map(write => [write.id, write.state]), [[id, "queued"]], "custody without dispatch remains listed");
      if (source === "lookup") { available = outcome; assert.deepEqual(await client.write(id), outcome); }
      else {
        callback(outcome);
        for (let n = 0; n < 500 && !notifications.length; n++) await delay(1);
      }
    }
    assert.deepEqual(notifications, [outcome], "a known outcome notifies even when its receipt cannot be saved");
    assert.deepEqual(await client.pendingWrites(), [], "known terminal custody leaves the list even while receipt persistence fails");
    const receipt = state === "sent" ? { state, id, seq: 3, replayed: true }
      : { state, id, why: { code: "E_INPUT", family: "input", message: "write refused: E_INPUT" } };
    available = undefined; // The lower client's bounded receipt history may evict this id.
    const before = failures;
    assert.deepEqual(await client.write(id), receipt);
    assert.ok(failures > before, "lookup retried persistence while the fault was still active");
    unreadable = true;
    assert.deepEqual(await client.write(id), receipt, "memory keeps the known outcome even when the journal cannot be read");
    assert.deepEqual(notifications, [outcome], "lookup must not emit a contradictory or duplicate completion");
    assert.equal(JSON.parse(await memory.get(key)).pending[0].id, id, "failed saves preserve durable replay custody");
    unreadable = false; fail = false;
    assert.deepEqual(await client.write(id), receipt);
    assert.equal(JSON.parse(await memory.get(key)).pending.length, 0, "repair permits durable retirement");
    assert.equal((await client.write(id)).state, state); assert.ok(errors.length >= 3);
    await client.close(); assert.equal(await client.write(id), undefined, "closing fences the retained outcome");
  });
}

test("CCP zero-wait custody survives a rejected background dispatch and pre-custody storage refusal", async t => {
  const memory = memorySessionStore(), errors = [];
  let failStore = false;
  const store = { ...memory, async set(key, value) { if (failStore) throw Error("disk full"); await memory.set(key, value); } };
  const raw = { viewer: () => "alice", onWrite: () => () => {},
    mutate: async () => { throw Error("transport exploded"); }, write: async () => undefined,
    close: async () => {}, signOut: async () => {} };
  trackDispatch(raw, { store: "test-store" });
  const { client } = await onlineCustody(raw, "https://admission.invalid", store, error => errors.push(error));
  t.after(() => client.close());
  const op = { kind: "mutation", name: "write" };
  const pending = await client.mutate(op, { body: "kept" }, { waitSeconds: 0 });
  assert.equal(pending.state, "pending"); await delay(0);
  assert.equal(errors.length, 1); assert.equal((await client.write(pending.id)).state, "pending");
  failStore = true;
  const failed = await client.mutate(op, { body: "not kept" }, { waitSeconds: 0 });
  assert.equal(failed.state, "failed"); assert.equal(failed.why.code, "E_STORE");
});

test("CCP mutation waits use the action clamp and preserve omitted defaults", async () => {
  const { mutationWaitSeconds } = await import("../dist/writes.js");
  for (const [input, expected] of [[undefined, undefined], [null, undefined], [0, 0], [-2, 0], [.9, 0], [1.9, 1], [26, 25], [NaN, 25], [Infinity, 25], [-Infinity, 25]])
    assert.equal(mutationWaitSeconds(input), expected);
});

for (const waitSeconds of [undefined, 0]) test(`CCP existing custody is not replaced by a redundant save refusal (wait=${waitSeconds})`, async t => {
  const memory = memorySessionStore(); let fail = false, dispatches = 0;
  const store = { ...memory, async set(key, value) { if (fail) throw Error("disk full"); await memory.set(key, value); } };
  const raw = () => {
    const client = { viewer: () => "alice", onWrite: () => () => {},
      mutate: async (_op, _args, { id }) => { dispatches++; return { state: "pending", id }; },
      write: async () => undefined, close: async () => {}, signOut: async () => {} };
    trackDispatch(client, { store: "original-store" }); return client;
  };
  const id = mintId(), op = { kind: "mutation", name: "send" }, args = { body: "original" };
  const first = await onlineCustody(raw(), "https://reopen.invalid", store, () => {}, false);
  assert.equal((await first.client.mutate(op, args, { id, waitSeconds: 0 })).state, "pending");
  await first.client.close();
  const second = await onlineCustody(raw(), "https://reopen.invalid", store, () => {}, false);
  t.after(() => second.client.close()); fail = true;
  assert.equal((await second.client.mutate(op, args, { id, waitSeconds })).state, "pending");
  assert.equal((await second.client.write(id)).state, "pending");
  assert.equal((await second.client.mutate(op, { body: "conflicting" }, { id, waitSeconds })).why.code, "E_WRITE_ID_REUSE");
  assert.equal(dispatches, 2, "recovery keeps the original intent");
});

test("CCP two createApp instances recover the known receipt when journal saves fail", async t => {
  const { createApp } = await import("../dist/app.js");
  const { keepSession } = await import("../dist/auth.js");
  const url = "http://shared-custody.invalid", memory = memorySessionStore();
  await keepSession(url, { principal: "alice", kind: "user", token: "local-test-token", expiresAt: Date.now() + 7 * 86400_000 }, memory);
  let fail = false, executions = 0;
  const store = { ...memory, async set(key, value) { if (fail && key.endsWith(".writes")) throw Error("disk full"); await memory.set(key, value); } };
  const transport = async (input, init) => {
    const path = new URL(input).pathname;
    if (path === "/probe") return Response.json({ ok: true, store_id: "A", seq: executions });
    if (path === "/m/send") { executions++; const { id } = JSON.parse(init.body); return Response.json({ state: "sent", id, seq: executions, store_id: "A", head: executions }); }
    if (path === "/changes") return new Promise(() => {});
    throw Error(path);
  };
  const a = createApp({ url, sessionStore: store, fetch: transport }), b = createApp({ url, sessionStore: store, fetch: transport });
  t.after(async () => { fail = false; await a.close(); await b.close(); });
  await a.ready; await b.ready;
  const op = { kind: "mutation", name: "send" }, args = { body: "already executed" }, id = mintId();
  const original = await a.mutate(op, args, { id }); assert.equal(original.state, "sent");
  fail = true;
  const returned = await b.mutate(op, args, { id, waitSeconds: 0 });
  assert.deepEqual(returned, { state: "sent", id, seq: original.seq, replayed: true });
  assert.deepEqual(await b.client.write(id), returned); assert.equal(executions, 1);
  t.diagnostic(`shared journal: ${executions} execution, recovered=${returned.state}, replayed=${returned.replayed}`);
});

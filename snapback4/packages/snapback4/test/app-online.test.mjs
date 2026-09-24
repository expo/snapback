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
      if (source === "lookup") { available = outcome; assert.deepEqual(await client.write(id), outcome); }
      else {
        callback(outcome);
        for (let n = 0; n < 500 && !notifications.length; n++) await delay(1);
      }
    }
    assert.deepEqual(notifications, [outcome], "a known outcome notifies even when its receipt cannot be saved");
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

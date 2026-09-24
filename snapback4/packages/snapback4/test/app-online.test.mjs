import test from "node:test";
import assert from "node:assert/strict";
import { setTimeout as delay } from "node:timers/promises";
import { onlineCustody } from "../dist/app-online.js";
import { memorySessionStore } from "../dist/auth.js";
import { mintId } from "../dist/client.js";
import { MutationIds, WRITE_HISTORY_LIMIT } from "../dist/writes.js";

test("asynchronous settlement bounds online argument reservations, including another owner's retirement", async t => {
  const store = memorySessionStore(), instances = new Set(), emitted = [], callbacks = [];
  const original = MutationIds.prototype.run;
  t.mock.method(MutationIds.prototype, "run", function (...args) { instances.add(this); return original.apply(this, args); });
  const make = () => {
    let callback;
    const raw = { viewer: () => "alice", onWrite(fn) { callback = fn; return () => {}; },
      mutate: async (op, args, { id }) => ({ state: "pending", id }), write: async () => undefined,
      close: async () => {}, signOut: async () => {} };
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

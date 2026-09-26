// Node models IDB's atomic transaction/termination boundary. This exercises
// indexedDbPersistence itself; the model is not a real-browser witness.
import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { indexedDbPersistence, webDevice } from "../dist/web.js";

const wasm = readFileSync(new URL("../dist/wasm/snapback4_device_bg.wasm", import.meta.url));
const backend = JSON.parse(readFileSync(new URL("./chat-schema.json", import.meta.url), "utf8"));
const ok = reply => { assert.ok(!reply.denied, JSON.stringify(reply)); return reply.ok; };
const events = [
  { table: "conversations", id: "c1", title: "A", creatorId: "dev:alice" },
  { table: "memberships", id: "m1", conversationId: "c1", principal: "dev:alice", role: "admin", joinedAt: 1 },
  { table: "messages", id: "A", conversationId: "c1", authorId: "dev:alice", body: "A", at: 1, editedAt: null, photo: null },
].map(({ table, ...data }) => ({ table, id: data.id, kind: "put", data }));
const page = (store_id, events, extra = {}) => ({ snapshot: true, store_id, generation: 1, events, watermark: 10, more: false, ...extra });

function idbModel(t) {
  const previous = Object.getOwnPropertyDescriptor(globalThis, "indexedDB");
  const databases = new Map();
  let fault = null;
  const idb = {
    open(name) {
      const request = {};
      queueMicrotask(() => {
        if (!databases.has(name)) databases.set(name, new Map());
        request.result = {
          close() {},
          transaction(_name, mode, options) {
            const current = databases.get(name), staged = new Map(current), tx = { error: null };
            const isWrite = mode === "readwrite";
            if (isWrite) assert.equal(options.durability, "strict");
            tx.objectStore = () => ({
              getAll() { return { result: [...current.values()] }; },
              get([s, k]) { return { result: current.get(`${s} ${k}`) }; },
              put(change) { staged.set(`${change.s} ${change.k}`, structuredClone(change)); },
              delete([s, k]) { staged.delete(`${s} ${k}`); },
            });
            queueMicrotask(() => {
              const interrupted = isWrite ? fault : null;
              if (isWrite) fault = null;
              if (isWrite && interrupted !== "before-commit") databases.set(name, staged);
              if (interrupted) { tx.error = new Error(interrupted); tx.onabort(); }
              else tx.oncomplete();
            });
            return tx;
          },
        };
        request.onsuccess();
      });
      return request;
    },
  };
  Object.defineProperty(globalThis, "indexedDB", { configurable: true, value: idb });
  t.after(() => previous ? Object.defineProperty(globalThis, "indexedDB", previous) : delete globalThis.indexedDB);
  return { interrupt(where) { fault = where; } };
}

for (const fault of ["before-commit", "after-commit"]) test(`IndexedDB model: reset termination ${fault} preserves one complete transaction`, async t => {
  const model = idbModel(t), persist = indexedDbPersistence(), opener = webDevice({ wasm, persist }), name = `reset-${fault}`;
  let core = await opener.open(name, backend);
  ok(await core.call({ op: "apply", first: true, page: page("A", events) }));
  for (const [i, id] of ["known", "unknown"].entries()) ok(await core.call({ op: "admit", entry: {
    id, seq: i + 1, op: "send", args: { conversationId: "c1", body: id }, new_ids: [id], viewer: "dev:alice", now: 10, predictable: true,
  } }));
  ok(await core.call({ op: "settle", id: "known", seq: 11 }));
  ok(await core.call({ op: "apply", first: true, page: page("A", events.slice(0, 1), { stage_snapshot: true, more: true, next: "next" }) }));
  // Model an actual request in flight. Store-binding inspections are reads
  // and must not create this declaration as an accidental side effect.
  ok(await core.call({ op: "sync_state" }));
  const before = await persist.load(name);
  for (const kind of ["r", "m", "s", "b", "o"]) assert.ok(before.some(c => c.s === kind), `fixture must hold ${kind}`);
  model.interrupt(fault);
  await assert.rejects(core.call({ op: "observe_store", page: page("B", []) }), new RegExp(fault));
  // A new wasm device models losing all runtime state at termination.
  await core.close(); core = await opener.open(name, null); t.after(() => core.close());
  const after = await persist.load(name);
  if (fault === "before-commit") {
    // Recovery abandons the previous owner's request capture and fences its
    // replies. Every other durable record still belongs to the old transaction.
    const expected = new Map(before.map(({ s, k, v }) => [`${s} ${k}`, v]));
    assert.ok(expected.delete("m device:declaration:capture"));
    expected.set("m device:send_revision", String(Number(expected.get("m device:send_revision") ?? 0) + 1));
    assert.deepEqual(new Map(after.map(({ s, k, v }) => [`${s} ${k}`, v])), expected);
    ok(await core.call({ op: "observe_store", page: page("B", []) }));
  }
  const reset = await persist.load(name);
  assert.ok(!reset.some(c => ["r", "s", "b"].includes(c.s)));
  assert.equal(reset.find(c => c.k === "device:store_id").v, "B");
  assert.equal(reset.find(c => c.k === "device:backend-required").v, "B");
  assert.ok(!reset.some(c => c.k === "device:acquired-generation" || c.k === "device:history:groups"));
  const outbox = reset.filter(c => c.s === "o").map(c => JSON.parse(c.v));
  assert.deepEqual(outbox.map(e => e.id), ["unknown"]);
  assert.equal(outbox[0].predictable, false); assert.deepEqual(outbox[0].predicted, []);
  assert.ok((await core.call({ op: "apply", first: true, page: page("B", []) })).denied);
  model.interrupt("before-commit");
  await assert.rejects(core.call({ op: "adopt", backend }), /before-commit/);
  assert.equal(ok(await core.call({ op: "sync_state" })).backend_required, true);
  ok(await core.call({ op: "adopt", backend }));
  ok(await core.call({ op: "apply", first: true, page: page("B", []) }));
  assert.equal(ok(await core.call({ op: "sync_state" })).backend_required, false);
});

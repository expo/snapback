// The device's interpreter over the memory store, on the compiled chat
// backend: the same programs the server runs, the same words out.
import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { MemoryStore } from "../dist/replica/store.js";
import { Interpreter, Refused } from "../dist/replica/interpreter.js";
import { decodeCursor } from "../dist/replica/cursor.js";

const backend = JSON.parse(readFileSync(new URL("./chat-schema.json", import.meta.url), "utf8"));
const programs = Object.fromEntries(backend.programs.map((p) => [p.name, p]));
let minted = 0;
const ctx = (viewer, args, now = 1000) => ({ viewer, args, now, newIds: [], mint: () => `M${++minted}` });

async function seeded() {
  const store = new MemoryStore(backend.schema);
  await store.write(async (tx) => {
    await tx.put("conversations", { id: "c1", title: "General", creatorId: "dev:alice" });
    await tx.put("memberships", { id: "m1", conversationId: "c1", principal: "dev:alice", role: "admin", joinedAt: 1 });
    await tx.put("memberships", { id: "m2", conversationId: "c1", principal: "dev:bob", role: "member", joinedAt: 2 });
    for (let n = 0; n < 120; n++) await tx.put("messages", { id: `msg${String(n).padStart(3, "0")}`, conversationId: "c1", authorId: n % 2 ? "dev:alice" : "dev:bob", body: `m${n}`, at: 1000 + n, editedAt: null, photo: null });
    await tx.put("messageCounts", { id: '[{"Id":"c1"}]', conversationId: "c1", value: 120 });
  });
  return store;
}

test("thread pages through the replica with server-shaped cursors", async () => {
  const store = await seeded();
  const first = await store.read((tx) => new Interpreter(tx, backend.schema, ctx("dev:bob", { conversationId: "c1", c: null }), "query").run(programs.thread));
  assert.equal(first.data.length, 50);
  assert.equal(first.data[0].id, "msg119");
  assert.equal(first.complete, true);
  assert.ok(first.next, "a second page exists");
  const position = decodeCursor(first.next);
  assert.deepEqual(position.values, [1000 + 70, "msg070"]);
  const second = await store.read((tx) => new Interpreter(tx, backend.schema, ctx("dev:bob", { conversationId: "c1", c: first.next }), "query").run(programs.thread));
  assert.equal(second.data[0].id, "msg069");
  const third = await store.read((tx) => new Interpreter(tx, backend.schema, ctx("dev:bob", { conversationId: "c1", c: second.next }), "query").run(programs.thread));
  assert.equal(third.data.length, 20);
  assert.equal(third.next, null);
});

test("a stranger is refused with the author's code", async () => {
  const store = await seeded();
  await assert.rejects(
    store.read((tx) => new Interpreter(tx, backend.schema, ctx("dev:mallory", { conversationId: "c1", c: null }), "query").run(programs.thread)),
    (error) => error instanceof Refused && error.refusal.code === "MEMBERSHIP_REQUIRED" && error.refusal.family === "rule",
  );
});

test("inbox composes the count and the conversation locally", async () => {
  const store = await seeded();
  const inbox = await store.read((tx) => new Interpreter(tx, backend.schema, ctx("dev:bob", {}), "query").run(programs.inbox));
  assert.deepEqual(inbox.data, [{ conversationId: "c1", conversation: { id: "c1", title: "General", creatorId: "dev:alice" }, count: 120 }]);
  assert.equal(inbox.complete, true);
});

test("a send is predicted as a pending row and keeps the count honest", async () => {
  const store = await seeded();
  const writes = await store.write(async (tx) => {
    const interpreter = new Interpreter(tx, backend.schema, ctx("dev:bob", { conversationId: "c1", body: "hi" }, 5000), "mutation");
    const out = await interpreter.run(programs.send);
    assert.equal(out.data.id, "M1");
    return interpreter.writes;
  });
  assert.equal(writes.length, 1);
  const thread = await store.read((tx) => new Interpreter(tx, backend.schema, ctx("dev:bob", { conversationId: "c1", c: null }), "query").run(programs.thread));
  assert.equal(thread.data[0].id, "M1");
  assert.equal(thread.data[0].pending, true);
  const inbox = await store.read((tx) => new Interpreter(tx, backend.schema, ctx("dev:bob", {}), "query").run(programs.inbox));
  assert.equal(inbox.data[0].count, 121);
});

test("a hidden-row unsend fails typed, not silently", async () => {
  const store = await seeded();
  await assert.rejects(
    store.write((tx) => new Interpreter(tx, backend.schema, ctx("dev:bob", { messageId: "msg001" }), "mutation").run(programs.unsend)),
    (error) => error instanceof Refused && error.refusal.code === "NOT_AUTHOR",
  );
});

test("a page at the horizon is not complete", async () => {
  const store = new MemoryStore(backend.schema);
  await store.write(async (tx) => {
    await tx.put("memberships", { id: "m2", conversationId: "c1", principal: "dev:bob", role: "member", joinedAt: 2 });
    for (let n = 0; n < 500; n++) await tx.put("messages", { id: `msg${String(n).padStart(4, "0")}`, conversationId: "c1", authorId: "dev:bob", body: "x", at: 1000 + n, editedAt: null, photo: null });
  });
  let read = await store.read((tx) => new Interpreter(tx, backend.schema, ctx("dev:bob", { conversationId: "c1", c: null }), "query").run(programs.thread));
  for (let page = 0; read.next; page++) read = await store.read((tx) => new Interpreter(tx, backend.schema, ctx("dev:bob", { conversationId: "c1", c: read.next }), "query").run(programs.thread));
  assert.equal(read.complete, false, "the device holds exactly the horizon; older rows may exist on the server");
});

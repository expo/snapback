// The SQLite replica store on node:sqlite: the same interpreter tests'
// shape, so a native host reads and pages exactly as IndexedDB does.
import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { DatabaseSync } from "node:sqlite";
import { openSqlite, nodeSqliteDriver } from "../dist/replica/sqlite.js";
import { Interpreter } from "../dist/replica/interpreter.js";

const backend = JSON.parse(readFileSync(new URL("./chat-schema.json", import.meta.url), "utf8"));
const programs = Object.fromEntries(backend.programs.map((p) => [p.name, p]));
const ctx = (viewer, args, now = 1000) => ({ viewer, args, now, newIds: [], mint: () => "M1" });

test("pages, counts and predictions on SQLite", async () => {
  const store = await openSqlite(nodeSqliteDriver(new DatabaseSync(":memory:")), backend.schema);
  await store.write(async (tx) => {
    await tx.put("conversations", { id: "c1", title: "General", creatorId: "dev:alice" });
    await tx.put("memberships", { id: "m2", conversationId: "c1", principal: "dev:bob", role: "member", joinedAt: 2 });
    for (let n = 0; n < 120; n++) await tx.put("messages", { id: `msg${String(n).padStart(3, "0")}`, conversationId: "c1", authorId: "dev:bob", body: `m${n}`, at: 1000 + n, editedAt: null, photo: null });
    await tx.put("messageCounts", { id: '[{"Id":"c1"}]', conversationId: "c1", value: 120 });
    await tx.setMeta("watermark", 7);
    await tx.side("outbox").put("w1", { id: "w1" });
  });
  const first = await store.read((tx) => new Interpreter(tx, backend.schema, ctx("dev:bob", { conversationId: "c1", c: null }), "query").run(programs.thread));
  assert.equal(first.data.length, 50);
  assert.equal(first.data[0].id, "msg119");
  assert.ok(first.next);
  const second = await store.read((tx) => new Interpreter(tx, backend.schema, ctx("dev:bob", { conversationId: "c1", c: first.next }), "query").run(programs.thread));
  assert.equal(second.data[0].id, "msg069");
  const inbox = await store.read((tx) => new Interpreter(tx, backend.schema, ctx("dev:bob", {}), "query").run(programs.inbox));
  assert.equal(inbox.data[0].count, 120);
  await store.write((tx) => new Interpreter(tx, backend.schema, ctx("dev:bob", { conversationId: "c1", body: "hi" }, 5000), "mutation").run(programs.send));
  const after = await store.read((tx) => new Interpreter(tx, backend.schema, ctx("dev:bob", { conversationId: "c1", c: null }), "query").run(programs.thread));
  assert.equal(after.data[0].id, "M1");
  assert.equal(after.data[0].pending, true);
  assert.equal((await store.read((tx) => new Interpreter(tx, backend.schema, ctx("dev:bob", {}), "query").run(programs.inbox))).data[0].count, 121);
  assert.equal(await store.read((tx) => tx.getMeta("watermark")), 7);
  assert.deepEqual(await store.read((tx) => tx.side("outbox").all()), [{ key: "w1", value: { id: "w1" } }]);
  // A rolled-back write leaves nothing behind.
  await assert.rejects(store.write(async (tx) => { await tx.put("conversations", { id: "c9", title: "x", creatorId: "dev:bob" }); throw new Error("abort"); }));
  assert.equal(await store.read((tx) => tx.get("conversations", "c9")), undefined);
  await store.close();
});

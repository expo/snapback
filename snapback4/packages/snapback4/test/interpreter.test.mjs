// The device's interpreter over the memory store, on the compiled chat
// backend: the same programs the server runs, the same words out.
import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { MemoryStore } from "../dist/replica/store.js";
import { Interpreter, Refused, totalCompare } from "../dist/replica/interpreter.js";
import { decodeCursor } from "../dist/replica/cursor.js";

const backend = JSON.parse(readFileSync(new URL("./chat-schema.json", import.meta.url), "utf8"));
const programs = Object.fromEntries(backend.programs.map((p) => [p.name, p]));
let minted = 0;
const ctx = (viewer, args, now = 1000) => ({ viewer, args, now, newIds: [], mint: () => `M${++minted}` });

function merged(order = "Desc") {
  const scan = { table: "messages", index: "byConvTime", prefix: [{ Scalar: { Field: { base: { Variable: "member" }, name: "conversationId" } } }], take: { Literal: 20 }, order, after: { Variable: "c" }, before: null, range: null, opaque_cursor: true, site: "merge:1", provenance: "Shape", merge_site: "merge" };
  const source = { ...scan, table: "memberships", index: "byPrincipalConversation", prefix: [{ Scalar: { Input: "Viewer" } }], take: { Literal: 1000 }, order: "Asc", after: null, opaque_cursor: false };
  return { name: "merged", kind: "Query", args: {}, body: [{ Return: { Merge: { site: "merge", lanes: [{ scan, source, binding: "member", setup: [] }, { scan: { ...scan, prefix: [{ Scalar: { Literal: { Id: "c3" } } }] }, source: null, binding: "", setup: [] }] } } }] };
}

test("lazy merges match a sorted union across ties, overlaps and every page on memory and SQLite", async () => {
  const { openSqlite, nodeSqliteDriver } = await import("../dist/replica/sqlite.js");
  const { DatabaseSync } = await import("node:sqlite");
  const schema = structuredClone(backend.schema);
  schema.tables.messages.expire = "editedAt";
  const horizonSchema = structuredClone(schema);
  // This fixture seeds the entire partition. A horizon-limited replica
  // cannot infer that coverage from the rows currently held in its store.
  schema.tables.messages.sync.horizon = null;
  for (const store of [new MemoryStore(schema), await openSqlite(nodeSqliteDriver(new DatabaseSync(":memory:")), schema)]) {
    try {
      const expected = [];
      await store.write(async (tx) => {
        for (let c = 0; c < 10; c++) {
          await tx.put("memberships", { id: `m${c}`, conversationId: `c${c}`, principal: "dev:bob", role: "member", joinedAt: c });
          for (let n = 0; n < c * 7; n++) {
            const row = { id: `msg${c}-${String(n).padStart(2, "0")}`, conversationId: `c${c}`, authorId: "dev:bob", body: "post", at: (n * 7 + c) % 11, photo: null, editedAt: n % 13 === 0 ? 1 : null };
            if (row.editedAt === null) expected.push(row);
            await tx.put("messages", row);
          }
        }
      });
      for (const order of ["Asc", "Desc"]) {
        const program = merged(order), got = [];
        const horizonRead = await store.read((tx) => new Interpreter(tx, horizonSchema, ctx("dev:bob", { c: null }), "query").run(program));
        assert.equal(horizonRead.complete, false, "an empty merge lane may have older rows beyond its acquisition horizon");
        let c = null;
        for (let page = 0; page < 20; page++) {
          const result = await store.read((tx) => new Interpreter(tx, schema, ctx("dev:bob", { c }), "query").run(program));
          assert.equal(result.complete, true);
          got.push(...result.data.map((r) => r.id));
          c = result.next;
          if (!c) break;
        }
        assert.equal(c, null, "pagination terminates");
        assert.deepEqual(got, expected.toSorted((a, b) => (order === "Asc" ? 1 : -1) * totalCompare([a.at, a.id], [b.at, b.id])).map((r) => r.id));
        const capped = await store.read((tx) => new Interpreter(tx, schema, ctx("dev:bob", { c: null }), "query", { examined: 10, ruleProbes: 8192, steps: 1_000_000, rowsWritten: 1024 }).run(program));
        assert.equal(capped.complete, false);
      }
    } finally { await store.close(); }
  }
});

test("an empty merge still rejects a cursor from another scope", async () => {
  const store = await seeded();
  const thread = await store.read((tx) => new Interpreter(tx, backend.schema, ctx("dev:bob", { conversationId: "c1", c: null }), "query").run(programs.thread));
  const program = merged("Asc"); // thread's cursor is descending
  program.body[0].Return.Merge.lanes.pop();
  await store.clearRows();
  await assert.rejects(store.read((tx) => new Interpreter(tx, backend.schema, ctx("dev:bob", { c: thread.next }), "query").run(program)), (e) => e instanceof Refused && e.refusal.code === "E_INPUT");
});

test("nullable unique merge keys keep every equal null row", async () => {
  const schema = structuredClone(backend.schema);
  schema.tables.messages.indexes.byConvTime = { unique: true, components: [{ Column: "conversationId" }, { Column: "editedAt" }] };
  const store = new MemoryStore(schema);
  await store.write(async (tx) => {
    await tx.put("memberships", { id: "m", conversationId: "c1", principal: "dev:bob", role: "member", joinedAt: 1 });
    for (let n = 0; n < 10; n++) await tx.put("messages", { id: `m${n}`, conversationId: "c1", authorId: "dev:bob", body: "p", at: 1, editedAt: null, photo: null });
  });
  const result = await store.read((tx) => new Interpreter(tx, schema, ctx("dev:bob", { c: null }), "query").run(merged()));
  assert.equal(result.data.length, 10);
});

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

test("a range the prefix decides false is hoisted: delivered history is never counted", async () => {
  // Mallory left c1 under `delivered-history` and still holds its messages;
  // her local read of the thread is decided by one row, not by walking the
  // history against the ceiling (the meter's-cut review, M4).
  // The mechanism is exercised on an online-only table (a synced table's
  // rows are the partition and need no rule on the device): the same
  // schema with `messages` unsynced.
  const store = await seeded();
  const schema = { ...backend.schema, tables: { ...backend.schema.tables, messages: { ...backend.schema.tables.messages, sync: null } } };
  const scan = { Return: { Scan: { table: "messages", index: "byConvTime", prefix: [{ Scalar: { Literal: { Id: "c1" } } }], take: { Literal: 5 }, order: "Desc", after: null, before: null, range: null, opaque_cursor: false, site: "t:1", provenance: "Shape", merge_site: null } } };
  const program = { name: "peek", kind: "Query", args: {}, body: [scan] };
  const low = { examined: 3, ruleProbes: 3, steps: 1_000_000, rowsWritten: 1024 };
  const read = await store.read((tx) => new Interpreter(tx, schema, ctx("dev:mallory", {}), "query", low).run(program));
  assert.deepEqual(read.data, []);
  assert.equal(read.complete, false, "an online-only table is never complete on the device; the range itself cost nothing");
  const member = await store.read((tx) => new Interpreter(tx, schema, ctx("dev:bob", {}), "query", low).run(program));
  assert.equal(member.data.length, 3, "a member's read is cut by the low ceiling, typed");
  assert.equal(member.complete, false);
});

test("delivered history stays readable on the device after a leave", async () => {
  // Mallory left c1 under `retain delivered-history`: the server refuses
  // her, the device keeps what it was given and lets her read it through a
  // query that does not `require` membership. (`thread` still refuses: the
  // author's own require runs on both hosts.)
  const store = await seeded();
  const scan = { Return: { Scan: { table: "messages", index: "byConvTime", prefix: [{ Scalar: { Literal: { Id: "c1" } } }], take: { Literal: 5 }, order: "Desc", after: null, before: null, range: null, opaque_cursor: false, site: "t:1", provenance: "Shape", merge_site: null } } };
  const history = { name: "history", kind: "Query", args: {}, body: [scan] };
  const read = await store.read((tx) => new Interpreter(tx, backend.schema, ctx("dev:mallory", {}), "query").run(history));
  assert.equal(read.data.length, 5, "the retained rows are hers to read");
  assert.equal(read.complete, false, "a page of 5 over 120 rows with no cursor is not complete");
});

test("a shape over a pending row is pending", async () => {
  // The Clique lane at M6: a shaped history dropped the card's `pending`
  // word, so a screen built on a shape could not say "Sending…".
  const store = await seeded();
  await store.write((tx) => tx.put("messages", { id: "M-pending", conversationId: "c1", authorId: "dev:bob", body: "on its way", at: 9_000, editedAt: null, photo: null, pending: true }));
  const shaped = { name: "shapedThread", kind: "Query", args: {}, body: [
    { Let: { name: "$rows", value: { Array: [] } } },
    { For: { binding: "$row", domain: { Page: { table: "messages", index: "byConvTime", prefix: [{ Scalar: { Literal: { Id: "c1" } } }], take: { Literal: 3 }, order: "Desc", after: null, before: null, range: null, opaque_cursor: false, site: "t:1", provenance: "Shape", merge_site: null } }, body: [
      { Push: { target: "$rows", value: { Object: { id: { Field: { base: { Variable: "$row" }, name: "id" } }, body: { Field: { base: { Variable: "$row" }, name: "body" } } } } } },
    ] } },
    { Return: { Variable: "$rows" } },
  ] };
  const read = await store.read((tx) => new Interpreter(tx, backend.schema, ctx("dev:bob", {}), "query").run(shaped));
  assert.equal(read.data[0].id, "M-pending");
  assert.equal(read.data[0].pending, true, "the shaped row keeps the pending word");
  assert.equal(read.data[1].pending, undefined, "a confirmed row does not");
});

test("a row past its table's expire column is absent on the device", async () => {
  const store = await seeded();
  // `editedAt` stands in for an expiry column: the filter is the table's word.
  const schema = { ...backend.schema, tables: { ...backend.schema.tables, messages: { ...backend.schema.tables.messages, expire: "editedAt" } } };
  await store.write(async (tx) => {
    await tx.put("messages", { id: "msg119", conversationId: "c1", authorId: "dev:alice", body: "m119", at: 1119, editedAt: 900, photo: null });
    await tx.put("messages", { id: "msg118", conversationId: "c1", authorId: "dev:bob", body: "m118", at: 1118, editedAt: 5000, photo: null });
  });
  const page = await store.read((tx) => new Interpreter(tx, schema, ctx("dev:bob", { conversationId: "c1", c: null }, 1000), "query").run(programs.thread));
  assert.equal(page.data[0].id, "msg118", "a future time is still readable");
  assert.ok(!page.data.some((m) => m.id === "msg119"), "a past time is gone");
  assert.equal(page.data.length, 50, "the page fills past the expired row");
  // The author's edit of an expired row is not found, as on the server.
  await assert.rejects(
    store.write((tx) => new Interpreter(tx, schema, ctx("dev:alice", { messageId: "msg119", body: "late" }, 1000), "mutation").run(programs.edit)),
    (error) => error instanceof Refused && error.refusal.code === "NOT_FOUND",
  );
});

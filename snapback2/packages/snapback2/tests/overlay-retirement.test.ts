// @ref LLP 1012#7-writes-offline — committed predictions retire on authoritative
// arrival, proven forward progress, or two successful resumes, never on an
// unrelated watermark or a guessed cursor argument.
import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import { createClient } from "../dist/client.mjs";
import { indexedDbRangeStore } from "../dist/react.mjs";
import { fileRangeStore } from "../dist/test.mjs";
import { FakeIndexedDb, FakeLocks } from "./fake-indexeddb.ts";

type Store = ReturnType<ReturnType<typeof fileRangeStore>>;

const receipt = () => ({ ranges: [], absences: [], verdicts: [] });
const ref = (table: string, id: string) => ({ $row: { table, id } });
const row = (table: string, id: string) => ({ table, id, row: { id } });

function page(op: string, args: unknown, seq: number, rows: ReturnType<typeof row>[], next: string | null = null) {
  return {
    op, args, state: "complete" as const, data: rows.map((item) => ref(item.table, item.id)),
    next, seq, rows, receipt: receipt(),
  };
}

function prediction(suffix: string) {
  const intent = `grant:${suffix}`;
  const id = `message-${suffix}`;
  const common = {
    intent, grant: "grant", offset: 0, count: 1, ids: [id], op: "deliveries.post",
    args: { conversationId: "conversation-1" }, issuedSeq: 0, createdAt: 1, updatedAt: 1,
  };
  return {
    intent,
    id,
    queued: { ...common, state: "queued" as const, predicted: true },
    committed: {
      ...common, state: "committed" as const, predicted: true,
      response: { state: "committed", seq: 30, data: { id } },
    },
    overlay: [{ table: "messages", id, row: { id, body: "predicted" } }],
  };
}

const maintainedProgram = {
  generation: {
    generation: "generation", schemaHash: "schema", programs: {},
    schema: { tables: {}, maintains: [{ kind: "Count", source: "unused", by: ["group"], target: "messageCounts", readable: null }] },
  },
};

const conversationId = "conversation-1";
const countId = '[{"Id":"conversation-1"}]';
const coherenceSchema = {
  tables: {
    messages: {
      columns: { id: "Id", conversationId: "Id", body: { Text: { max: 100 } } },
      indexes: { byId: { components: [{ Column: "id" }], unique: true }, byConversation: { components: [{ Column: "conversationId" }, { Column: "id" }] } },
    },
    messageCounts: {
      columns: { id: "Id", conversationId: "Id", value: "Int" },
      indexes: { byId: { components: [{ Column: "id" }], unique: true }, byConversation: { components: [{ Column: "conversationId" }, { Column: "id" }] } },
    },
  },
  maintains: [{ kind: "Count", source: "messages", by: ["conversationId"], target: "messageCounts", readable: null }],
};
const coherenceProgram = { generation: {
  generation: "generation", schemaHash: "schema", programs: {}, schema: coherenceSchema,
} };
const message = (id: string) => ({ table: "messages", id, row: { id, conversationId, body: id } });
const count = (value: number) => ({ table: "messageCounts", id: countId, row: { id: countId, conversationId, value } });
const view = (seq: number, messages: ReturnType<typeof message>[], value: number) => ({
  op: "deliveries.conversationView", args: { conversationId }, state: "complete" as const,
  data: { messages: messages.map((item) => ref(item.table, item.id)), count: ref("messageCounts", countId), preview: [] },
  next: null, seq, rows: [...messages, count(value)], receipt: receipt(),
});

test("maintained source and target arrival orders leave an older named record partial, including cold reopen", async () => {
  await carriers(async (name, create) => {
    for (const order of ["source-first", "target-first"] as const) {
      const partition = `${name}:${order}-remote-coherence`;
      let store = create();
      try {
        await store.open(partition);
        await store.commit({ schema: coherenceSchema, deliveries: [view(7, [message("m1"), message("m2")], 2)] });
        if (order === "source-first") {
          await store.commit({ schema: coherenceSchema, tombstones: [{ table: "messages", id: "m2", seq: 8 }] });
          assert.equal((await store.answer("deliveries.conversationView", { conversationId }))?.reason, "missing-authority",
            `${name}: source-first cannot retain the old maintained target`);
          assert.equal((await store.coverage()).rows.some((item) => item.table === "messageCounts"), false);
        } else {
          await store.commit({ schema: coherenceSchema, deliveries: [{
            op: "messageCounts.byId", args: { id: countId }, state: "complete", data: ref("messageCounts", countId),
            next: null, seq: 8, rows: [count(1)], receipt: receipt(),
          }] });
          assert.equal((await store.answer("deliveries.conversationView", { conversationId }))?.reason, "maintained-coherence",
            `${name}: target-first cannot splice a new count into old messages`);
        }
        assert.equal((await store.answer("deliveries.conversationView", { conversationId }))?.state, "partial");
        await store.close?.();
        store = create();
        await store.open(partition);
        assert.equal((await store.answer("deliveries.conversationView", { conversationId }))?.state, "partial",
          `${name}: the partial coherence fence survives cold/offline reopen`);

        if (order === "source-first") await store.commit({ schema: coherenceSchema, deliveries: [{
          op: "messageCounts.byId", args: { id: countId }, state: "complete", data: ref("messageCounts", countId),
          next: null, seq: 8, rows: [count(1)], receipt: receipt(),
        }] });
        else await store.commit({ schema: coherenceSchema, tombstones: [{ table: "messages", id: "m2", seq: 8 }] });
        assert.equal((await store.answer("deliveries.conversationView", { conversationId }))?.state, "partial",
          `${name}: sibling facts do not promote the named record before its own delivery`);
        await store.commit({ schema: coherenceSchema, deliveries: [view(8, [message("m1")], 1)] });
        const current = await store.answer<any>("deliveries.conversationView", { conversationId });
        assert.equal(current?.state, "complete");
        assert.equal(current?.data.count.value, 1);
        assert.deepEqual(current?.data.messages.map((item: any) => item.id), ["m1"]);
      } finally { await store.close?.(); }
    }
  });
});

test("target-first zero-to-one invalidates named point and range absence owners", async () => {
  await carriers(async (name, create) => {
    for (const proof of ["point", "range"] as const) {
      const store = create();
      const otherConversation = "conversation-2";
      const otherCountId = '[{"Id":"conversation-2"}]';
      const targetRange = {
        site: "view.count", table: "messageCounts", index: "byConversation",
        prefix: [{ Scalar: conversationId }], order: "Asc" as const, take: 1,
        after: null, before: null, gt: null, gte: null, lt: null, lte: null,
        ruleHash: "a".repeat(64), rowIds: [] as string[], stop: "Exhausted" as const, absence: false,
      };
      const otherTargetRange = { ...targetRange, prefix: [{ Scalar: otherConversation }] };
      try {
        await store.open(`${name}:target-first-zero-${proof}`);
        await store.commit({ schema: coherenceSchema, deliveries: [
          {
            op: "deliveries.conversationView", args: { conversationId }, state: "complete", data: { messages: [], count: 0, preview: [] },
            next: null, seq: 7, rows: [], receipt: proof === "point"
              ? { ...receipt(), absences: [["messageCounts", "byId", [countId]]] }
              : { ...receipt(), ranges: [targetRange] },
          },
          {
            op: "deliveries.conversationView", args: { conversationId: otherConversation }, state: "complete",
            data: { messages: [], count: 0, preview: [] }, next: null, seq: 7, rows: [],
            receipt: proof === "point"
              ? { ...receipt(), absences: [["messageCounts", "byId", [otherCountId]]] }
              : { ...receipt(), ranges: [otherTargetRange] },
          },
        ] });
        await store.commit({ schema: coherenceSchema, deliveries: [{
          op: "messageCounts.byId", args: { id: countId }, state: "complete", data: ref("messageCounts", countId),
          next: null, seq: 8, rows: [count(1)], receipt: receipt(),
        }] });
        const held = await store.answer("deliveries.conversationView", { conversationId });
        assert.equal(held?.state, "partial", `${name} ${proof}: sparse zero cannot survive a newer target`);
        assert.equal(held?.reason, "maintained-coherence");
        assert.equal((await store.answer("deliveries.conversationView", { conversationId: otherConversation }))?.state, "complete",
          `${name} ${proof}: an exact target change does not fence another group on the same table`);
      } finally { await store.close?.(); }
    }
  });
});

test("a source change withdraws wider maintained-target range authority instead of manufacturing zero", async () => {
  await carriers(async (name, create) => {
    const store = create();
    try {
      await store.open(`${name}:maintained-range`);
      const targetRange = {
        site: "counts.range", table: "messageCounts", index: "byConversation",
        prefix: [{ Scalar: conversationId }], order: "Asc" as const, take: 50,
        after: null, before: null, gt: null, gte: null, lt: null, lte: null,
        ruleHash: "a".repeat(64), rowIds: [] as string[], stop: "Exhausted" as const, absence: false,
      };
      await store.commit({ schema: coherenceSchema, deliveries: [{
        op: "emptyCounts", args: { conversationId }, state: "complete", data: [], next: null, seq: 7,
        rows: [], receipt: { ...receipt(), ranges: [targetRange] },
      }] });
      assert.equal((await store.coverage()).ranges.length, 1);
      await store.commit({ schema: coherenceSchema, deliveries: [{
        op: "messages.byId", args: { id: "remote" }, state: "complete", data: ref("messages", "remote"),
        next: null, seq: 8, rows: [message("remote")], receipt: receipt(),
      }] });
      assert.equal((await store.coverage()).ranges.some((range) => range.table === "messageCounts"), false,
        `${name}: an old exhausted target range is not zero authority after a source insertion`);
      assert.equal((await store.answer("emptyCounts", { conversationId }))?.state, "partial");
    } finally { await store.close?.(); }
  });
});

test("bounded prediction retirement reveals missing maintained authority, never the older target", async () => {
  await carriers(async (name, create) => {
    const store = create(), item = prediction(`${name}-maintained-misses`);
    item.overlay.push(count(2));
    try {
      await store.open(`${name}:maintained-misses`);
      await store.commit({ programs: coherenceProgram, deliveries: [{
        op: "countView", args: { conversationId }, state: "complete", data: ref("messageCounts", countId),
        next: null, seq: 20, rows: [count(1)], receipt: receipt(),
      }] });
      await store.commit({
        watermark: { op: "deliveries.inbox", args: { c: null }, cursorArg: "c", watermark: "cursor-9", updatedAt: 1 },
        outbox: { put: [item.queued] }, overlay: { put: { [item.intent]: item.overlay } },
      });
      await store.commit({ outbox: { put: [item.committed] } });
      assert.equal((await store.coverage()).rows.some((held) => held.table === "messageCounts"), false,
        `${name}: commit invalidates the pre-commit target under the still-visible overlay`);
      await store.commit({ deliveries: [page("messages.byId", { id: item.id }, 30, [message(item.id)])] });
      let entry = await store.outbox.get(item.intent);
      assert.equal(entry?.arrived, true, `${name}: pinned source arrival is recorded`);
      assert.equal(entry?.predicted, true, `${name}: raw arrival does not retire the unconfirmed maintained target`);
      assert.deepEqual((await store.outbox.overlay())[item.intent], [count(2)]);
      await store.commit({ resumeSeq: 31 });
      assert.ok((await store.outbox.overlay())[item.intent]);
      await store.commit({ resumeSeq: 32 });
      assert.equal((await store.outbox.overlay())[item.intent], undefined);
      entry = await store.outbox.get(item.intent);
      assert.equal(entry?.arrived, true, `${name}: bounded retirement does not rewrite the raw arrival fact`);
      assert.equal(entry?.predicted, undefined, `${name}: the bounded path releases prediction custody`);
      const held = await store.answer("countView", { conversationId });
      assert.equal(held?.state, "partial");
      assert.equal(held?.reason, "missing-authority",
        `${name}: the patience bound cannot expose the old target after dropping prediction custody`);
    } finally { await store.close?.(); }
  });
});

test("maintained invalidation follows the aggregate contribution, not every source-row refresh", async () => {
  await carriers(async (name, create) => {
    const store = create();
    try {
      await store.open(`${name}:maintained-contribution`);
      await store.commit({ schema: coherenceSchema, deliveries: [view(7, [message("m1")], 1)] });
      await store.commit({ schema: coherenceSchema, deliveries: [{
        op: "messages.byId", args: { id: "m1" }, state: "complete", data: ref("messages", "m1"), next: null, seq: 8,
        rows: [{ ...message("m1"), row: { ...message("m1").row, body: "edited" } }], receipt: receipt(),
      }] });
      assert.equal((await store.answer("deliveries.conversationView", { conversationId }))?.state, "complete",
        `${name}: a Count source body edit leaves target authority valid`);
      assert.equal((await store.coverage()).rows.some((held) => held.table === "messageCounts"), true);

      const sumSchema = {
        ...coherenceSchema,
        tables: { ...coherenceSchema.tables, messages: {
          ...coherenceSchema.tables.messages,
          columns: { ...coherenceSchema.tables.messages.columns, score: "Int" },
        } },
        maintains: [{ kind: { Sum: { of: "score" } }, source: "messages", by: ["conversationId"], target: "messageCounts", readable: null }],
      };
      await store.commit({ resetCoverage: true, schema: sumSchema, deliveries: [{
        ...view(9, [], 5),
        data: { messages: [ref("messages", "sum")], count: ref("messageCounts", countId), preview: [] },
        rows: [{ ...message("sum"), row: { ...message("sum").row, score: 5 } }, count(5)],
      }] });
      await store.commit({ schema: sumSchema, deliveries: [{
        op: "messages.byId", args: { id: "sum" }, state: "complete", data: ref("messages", "sum"), next: null, seq: 10,
        rows: [{ ...message("sum"), row: { ...message("sum").row, score: 7 } }], receipt: receipt(),
      }] });
      assert.equal((await store.coverage()).rows.some((held) => held.table === "messageCounts"), false,
        `${name}: a Sum input update withdraws the older maintained value`);
    } finally { await store.close?.(); }
  });
});

async function carriers(run: (name: string, create: () => Store) => Promise<void>): Promise<void> {
  const root = await mkdtemp(join(tmpdir(), "snapback2-overlay-retirement-"));
  const indexed = indexedDbRangeStore({ indexedDB: new FakeIndexedDb() as any, locks: new FakeLocks() as any });
  try {
    await run("Node file", () => fileRangeStore(root)());
    await run("IndexedDB", () => indexed() as Store);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
}

async function seed(
  store: Store,
  partition: string,
  item: ReturnType<typeof prediction>,
  watermark: { op: string; args: unknown; cursorArg?: string; watermark: string | null; updatedAt: number },
): Promise<void> {
  await store.open(partition);
  await store.commit({
    watermark,
    outbox: { put: [item.queued] },
    overlay: { put: { [item.intent]: item.overlay } },
  });
  await store.commit({ outbox: { put: [item.committed] } });
}

// @ref LLP 1018.003#4-pending-rows-attribution-settlement-and-failure — arrival is
// judged after the outbox puts, so a write that was never predicted and whose
// settlement lands with its own tail rows is marked `arrived` in that same swap.
test("an unpredicted committed intent is marked arrived by the tail rows of its own settlement swap on both carriers", async () => {
  await carriers(async (name, create) => {
    const store = create();
    const item = prediction(`${name}-arrival`);
    const queued = { ...item.queued, predicted: false };
    const committed = { ...item.committed, predicted: false };
    await store.open("dev:alice");
    await store.commit({ outbox: { put: [queued] } });
    assert.equal((await store.outbox.get(item.intent))?.arrived, undefined, `${name}: nothing has arrived`);
    await store.commit({
      deliveries: [page("deliveries.thread", { conversationId: "conversation-1" }, 31, [row("messages", item.id)])],
      outbox: { put: [committed] },
    });
    const entry = await store.outbox.get(item.intent);
    assert.equal(entry?.state, "committed", `${name}: settled`);
    assert.equal(entry?.arrived, true, `${name}: the tail row carrying the pinned id is the arrival, even inside the settlement swap`);
    await store.commit({ deliveries: [page("deliveries.thread", { conversationId: "conversation-1" }, 32, [row("messages", "other")])] });
    assert.equal((await store.outbox.get(item.intent))?.arrived, true, `${name}: arrival is durable`);
    await store.close?.();
  });
});

test("tail-page retirement requires a non-empty page at a manifest-named position past the commit watermark on both carriers", async () => {
  await carriers(async (name, create) => {
    let store = create();
    const item = prediction(`${name}-tail`);
    const partition = `${name}:tail`;
    try {
      await seed(store, partition, item, {
        op: "deliveries.inbox", args: { c: null }, cursorArg: "c", watermark: "cursor-9", updatedAt: 1,
      });
      await store.close?.();
      store = create();
      await store.open(partition);
      await store.commit({ deliveries: [page("deliveries.inbox", { c: "cursor-9" }, 31, [row("deliveries", `${name}-other-conversation`)], "cursor-10")] });
      assert.ok((await store.outbox.overlay())[item.intent], `${name}: another conversation at the held position is not past the commit watermark`);
      await store.commit({
        watermark: { op: "deliveries.inbox", args: { c: null }, cursorArg: "c", watermark: "cursor-10", updatedAt: 2 },
      });
      await store.commit({ deliveries: [page("deliveries.inbox", { c: "cursor-10" }, 32, [])] });
      assert.ok((await store.outbox.overlay())[item.intent], `${name}: an empty later page is not arrival evidence`);
      await store.commit({ deliveries: [page("deliveries.inbox", { c: null }, 33, [row("deliveries", `${name}-base`)])] });
      assert.ok((await store.outbox.overlay())[item.intent], `${name}: a re-delivered base page is not past the commit watermark`);
      await store.commit({ deliveries: [page("deliveries.inbox", { c: "cursor-10" }, 34, [row("deliveries", `${name}-tail`)])] });
      assert.equal((await store.outbox.overlay())[item.intent], undefined, `${name}: the advanced non-empty tail page retires the overlay`);
    } finally {
      await store.close?.();
    }
  });
});

test("only proven forward marks of the tail chooser consume patience; duplicate and backward marks do not on both carriers", async () => {
  await carriers(async (name, create) => {
    let store = create();
    const item = prediction(`${name}-misses`);
    const partition = `${name}:misses`;
    try {
      await seed(store, partition, item, {
        op: "deliveries.inbox", args: { c: null }, cursorArg: "c", watermark: "inbox-1", updatedAt: 1,
      });
      await store.commit({ watermark: { op: "profiles.me", args: { c: null }, cursorArg: "c", watermark: "profile-1", updatedAt: 2 } });
      await store.commit({ watermark: { op: "profiles.me", args: { c: null }, cursorArg: "c", watermark: "profile-2", updatedAt: 3 } });
      assert.ok((await store.outbox.overlay())[item.intent], `${name}: two unrelated re-marks leave the overlay`);
      assert.equal((await store.outbox.get(item.intent))?.predicted, true, `${name}: unrelated re-marks keep prediction custody`);
      await store.commit({ deliveries: [page("deliveries.inbox", { c: "inbox-1" }, 30, [row("deliveries", "link")], "inbox-2")] });
      await store.commit({ watermark: { op: "deliveries.inbox", args: { c: null }, cursorArg: "c", watermark: "inbox-2", updatedAt: 4 } });
      for (const watermark of ["inbox-2", "inbox-1", "inbox-2", "unproven"]) {
        await store.commit({ watermark: { op: "deliveries.inbox", args: { c: null }, cursorArg: "c", watermark, updatedAt: 5 } });
        assert.ok((await store.outbox.overlay())[item.intent], `${name}: ${watermark} is not another advance`);
      }
      assert.ok((await store.outbox.overlay())[item.intent], `${name}: one selected-tail advance is one miss`);
      await store.close?.();
      store = create();
      await store.open(partition);
      await store.commit({ resumeSeq: 31 });
      assert.equal((await store.outbox.overlay())[item.intent], undefined, `${name}: one proven advance and one resume retire the overlay`);
      assert.equal((await store.outbox.get(item.intent))?.predicted, undefined, `${name}: bound retirement clears predicted`);
    } finally {
      await store.close?.();
    }
  });
});

test("authoritative predicted-row arrival clears predicted while retaining the committed entry and row on both carriers", async () => {
  await carriers(async (name, create) => {
    const store = create();
    const item = prediction(`${name}-arrival`);
    try {
      await seed(store, `${name}:arrival`, item, {
        op: "deliveries.inbox", args: { c: null }, cursorArg: "c", watermark: "cursor-9", updatedAt: 1,
      });
      await store.commit({ deliveries: [page("deliveries.thread", { conversationId: "conversation-1" }, 30, [
        { table: "messages", id: item.id, row: { id: item.id, body: "authoritative" } },
      ])] });
      const entry = await store.outbox.get(item.intent);
      assert.equal(entry?.state, "committed", `${name}: arrival does not dismiss the settled entry`);
      assert.equal(entry?.arrived, true, `${name}: complete predicted-row arrival permits presentation dismissal`);
      assert.equal(entry?.predicted, undefined, `${name}: arrival retires prediction custody`);
      assert.equal((await store.outbox.overlay())[item.intent], undefined, `${name}: arrival removes the overlay`);
      assert.deepEqual((await store.coverage()).rows.find((held) => held.id === item.id)?.row, {
        id: item.id, body: "authoritative",
      }, `${name}: the authoritative row is held before prediction is cleared`);
    } finally {
      await store.close?.();
    }
  });
});

test("authoritative evidence retires an ordinary group while its maintained target waits on both carriers", async () => {
  await carriers(async (name, create) => {
    for (const effect of ["insert", "delete"] as const) {
      let store = create();
      const item = prediction(`${name}-${effect}-atomic`);
      const fanout = { table: "deliveries", id: `${name}-${effect}-delivery`, row: {
        id: `${name}-${effect}-delivery`, recipient: "dev:alice", messageId: item.id,
      } };
      const count = { table: "messageCounts", id: "conversation-1", row: { id: "conversation-1", value: 2 } };
      if (effect === "delete") Object.assign(item.overlay[0]!, { removed: true });
      item.overlay.push(fanout, count);
      try {
        await store.open(`${name}:${effect}-atomic`);
        await store.commit({ programs: maintainedProgram });
        await store.commit({ deliveries: [page("counts.byId", {}, 30, [{ ...count, row: { ...count.row, value: 1 } }])] });
        await store.close?.();
        await seed(store, `${name}:${effect}-atomic`, item, {
          op: "deliveries.inbox", args: { c: null }, cursorArg: "c", watermark: "cursor-9", updatedAt: 1,
        });
        const messageEvidence = effect === "insert"
          ? page("deliveries.thread", { conversationId: "conversation-1" }, 30, [
            { table: "messages", id: item.id, row: { id: item.id, body: "authoritative" } },
          ])
          : { ...page("messages.byId", { id: item.id }, 30, []), data: null,
            receipt: { ...receipt(), absences: [["messages", "byId", [item.id]]] as Array<[string, string, unknown[]]> } };
        await store.commit({ deliveries: [messageEvidence] });
        assert.deepEqual((await store.outbox.overlay())[item.intent], [count],
          `${name} ${effect}: ordinary fan-out retires as one group while its maintained sibling remains`);
        let entry = await store.outbox.get(item.intent);
        assert.equal(entry?.predicted, true,
          `${name} ${effect}: prediction custody remains until every visible effect arrives`);
        assert.equal(entry?.arrived, effect === "insert" ? true : undefined,
          `${name} ${effect}: pinned-id arrival is orthogonal to the unconfirmed maintained target`);
        await store.close?.();
        store = create();
        await store.open(`${name}:${effect}-atomic`);
        entry = await store.outbox.get(item.intent);
        assert.equal(entry?.arrived, effect === "insert" ? true : undefined, `${name} ${effect}: raw arrival survives cold reopen`);
        assert.equal(entry?.predicted, true, `${name} ${effect}: maintained prediction custody survives cold reopen`);
        assert.deepEqual((await store.outbox.overlay())[item.intent], [count]);

        await store.commit({ deliveries: [page("counts.byId", {}, 31, [count])] });
        await assertRetired(store, item.intent, `${name} ${effect}: final maintained row arrival`);
        assert.equal((await store.outbox.get(item.intent))?.arrived, true,
          `${name} ${effect}: complete overlay confirmation records arrival without dismissing`);
      } finally {
        await store.close?.();
      }
    }
  });
});

test("ordinary prediction groups require exact evidence and retire generated fan-out together on both carriers", async () => {
  await carriers(async (name, create) => {
    for (const exact of [false, true]) {
      const store = create();
      const item = prediction(`${name}-ordinary-${exact}`);
      const fanout = ["first", "second"].map((suffix) => ({
        table: "deliveries", id: `predicted-${suffix}`, row: {
          id: `predicted-${suffix}`, recipient: "dev:bob", conversationId: "conversation-1",
          messageId: item.id, kind: "message", at: 20,
        },
      }));
      item.overlay.push(...fanout);
      try {
        await seed(store, `${name}:ordinary-${exact}`, item, {
          op: "deliveries.inbox", args: { c: null }, cursorArg: "c", watermark: "cursor-9", updatedAt: 1,
        });
        const messageId = exact ? item.id : "same-content-different-id";
        await store.commit({ deliveries: [page("deliveries.thread", { conversationId: "conversation-1" }, 30, [
          { table: "messages", id: messageId, row: { id: messageId, body: "predicted" } },
          ...fanout.map((row, index) => ({ ...row, id: `server-${index}`, row: { ...row.row, id: `server-${index}` } })),
        ])] });
        const remaining = (await store.outbox.overlay())[item.intent];
        if (exact) assert.equal(remaining, undefined,
          `${name}: exact pinned source arrival retires both differently-id'd fan-out siblings`);
        else assert.deepEqual(remaining, item.overlay,
          `${name}: matching content and fan-out bodies do not prove another prediction group arrived`);
      } finally { await store.close?.(); }
    }
  });
});

test("a proven tail page keeps a predicted maintained sibling until that row arrives on both carriers", async () => {
  await carriers(async (name, create) => {
    const store = create();
    const item = prediction(`${name}-maintained-tail`);
    const count = { table: "messageCounts", id: "conversation-1", row: { id: "conversation-1", value: 2 } };
    item.overlay.push(count);
    try {
      await store.open(`${name}:maintained-tail`);
      await store.commit({ programs: maintainedProgram });
      await store.close?.();
      await seed(store, `${name}:maintained-tail`, item, {
        op: "deliveries.inbox", args: { c: null }, cursorArg: "c", watermark: "cursor-9", updatedAt: 1,
      });
      await store.commit({ deliveries: [
        page("deliveries.inbox", { c: "cursor-9" }, 30, [row("deliveries", "authoritative-link")], "cursor-10"),
        page("deliveries.inbox", { c: "cursor-10" }, 30, [row("deliveries", "authoritative-tail")]),
      ],
        watermark: { op: "deliveries.inbox", args: { c: null }, cursorArg: "c", watermark: "cursor-10", updatedAt: 2 } });
      assert.deepEqual((await store.outbox.overlay())[item.intent], [count],
        `${name}: log progress retires ordinary fan-out rows but preserves the maintained value`);
      assert.equal((await store.outbox.get(item.intent))?.predicted, true);

      await store.commit({ deliveries: [page("counts.byId", {}, 30, [count])] });
      await assertRetired(store, item.intent, `${name}: maintained target arrival`);
    } finally {
      await store.close?.();
    }
  });
});

test("a second nullable string argument cannot impersonate the manifest cursor on either carrier", async () => {
  await carriers(async (name, create) => {
    const store = create();
    const item = prediction(`${name}-two-nullable`);
    try {
      await seed(store, `${name}:two-nullable`, item, {
        op: "deliveries.inbox", args: { after: null, before: null }, cursorArg: "after", watermark: "cursor-9", updatedAt: 1,
      });
      await store.commit({
        deliveries: [page("deliveries.inbox", { after: "cursor-9", before: null }, 30, [row("deliveries", "link")], "cursor-10")],
        watermark: { op: "deliveries.inbox", args: { after: null, before: null }, cursorArg: "after", watermark: "cursor-10", updatedAt: 2 },
      });
      await store.commit({ deliveries: [page(
        "deliveries.inbox",
        { after: "cursor-10", before: "not-the-cursor" },
        31,
        [row("deliveries", `${name}-wrong-key`)],
      )] });
      assert.ok((await store.outbox.overlay())[item.intent], `${name}: changing the other nullable argument is not a tail page`);
      await store.commit({ deliveries: [page(
        "deliveries.inbox",
        { after: "cursor-10", before: null },
        32,
        [row("deliveries", `${name}-right-key`)],
      )] });
      assert.equal((await store.outbox.overlay())[item.intent], undefined, `${name}: only the manifest cursor may differ`);
    } finally {
      await store.close?.();
    }
  });
});

async function reopen(store: Store, create: () => Store, partition: string): Promise<Store> {
  await store.close?.();
  const cold = create();
  await cold.open(partition);
  return cold;
}

async function assertRetired(store: Store, intent: string, label: string): Promise<void> {
  assert.equal((await store.outbox.overlay())[intent], undefined, `${label}: overlay retired`);
  const entry = await store.outbox.get(intent);
  assert.equal(entry?.state, "committed", `${label}: replay terminal kept`);
  assert.equal(entry?.predicted, undefined, `${label}: prediction flag cleared`);
}

for (const kind of ["primary absence", "tombstone", "predicted deletion", "conditional refresh"] as const) {
  test(`queued ${kind} survives duplicate delivery and cold reopen until settlement on both carriers`, async () => {
    await carriers(async (name, create) => {
      let store = create();
      const partition = `${name}:queued-${kind}`;
      const item = prediction(`${name}-${kind}`);
      if (kind === "predicted deletion") Object.assign(item.overlay[0]!, { removed: true });
      const absence = {
        ...page("messages.byId", { id: item.id }, kind === "conditional refresh" ? 29 : 31, []),
        validator: "absence", data: null,
        receipt: { ...receipt(), absences: [["messages", "byId", [item.id]]] as Array<[string, string, unknown[]]> },
      };
      try {
        await store.open(partition);
        await store.commit({ outbox: { put: [item.queued] }, overlay: { put: { [item.intent]: item.overlay } } });
        const negative = kind === "tombstone"
          ? { tombstones: [{ table: "messages", id: item.id, seq: 31 }] }
          : { deliveries: [absence] };
        await store.commit(negative);
        store = await reopen(store, create, partition);
        await store.commit(negative); // Deduplicated receipt must not erase provenance.
        if (kind === "conditional refresh") {
          await store.commit({ refreshes: [{ op: absence.op, args: absence.args, seq: 31, validator: "absence" }] });
        }
        assert.equal((await store.outbox.get(item.intent))?.state, "queued");
        store = await reopen(store, create, partition);
        // No negative or tail in this swap: only the delayed terminal response.
        await store.commit({ outbox: { put: [item.committed] } });
        await assertRetired(store, item.intent, name);
        assert.equal((await store.coverage()).rows.some((held) => held.id === item.id), false);
        store = await reopen(store, create, partition);
        await assertRetired(store, item.intent, `${name}: durable retirement`);
      } finally { await store.close?.(); }
    });
  });
}

test("a conditional primary absence refreshed after settlement retires at its validated seq on both carriers", async () => {
  await carriers(async (name, create) => {
    let store = create();
    const partition = `${name}:settled-refresh`;
    const item = prediction(`${name}-settled-refresh`);
    try {
      await store.open(partition);
      await store.commit({ outbox: { put: [item.queued] }, overlay: { put: { [item.intent]: item.overlay } }, deliveries: [{
        ...page("messages.byId", { id: item.id }, 29, []), data: null, validator: "absent",
        receipt: { ...receipt(), absences: [["messages", "byId", [item.id]]] },
      }] });
      await store.commit({ outbox: { put: [item.committed] } });
      assert.ok((await store.outbox.overlay())[item.intent], "pre-commit absence cannot confirm this commit");
      store = await reopen(store, create, partition);
      await store.commit({ refreshes: [{ op: "messages.byId", args: { id: item.id }, validator: "absent", seq: 31 }] });
      await assertRetired(store, item.intent, name);
    } finally { await store.close?.(); }
  });
});

for (const kind of ["absence", "tombstone"] as const) {
  test(`resetCoverage discards queued ${kind} retirement evidence but preserves intent and prediction`, async () => {
    await carriers(async (name, create) => {
      let store = create();
      const partition = `${name}:reset-negative-${kind}`;
      const item = prediction(partition);
      const negative = kind === "tombstone"
        ? { tombstones: [{ table: "messages", id: item.id, seq: 31 }] }
        : { deliveries: [{ ...page("messages.byId", { id: item.id }, 31, []), data: null,
          receipt: { ...receipt(), absences: [["messages", "byId", [item.id]]] as Array<[string, string, unknown[]]> } }] };
      try {
        await store.open(partition);
        await store.commit({ outbox: { put: [item.queued] }, overlay: { put: { [item.intent]: item.overlay } } });
        await store.commit(negative);
        store = await reopen(store, create, partition);
        await store.commit({ resetCoverage: true });
        store = await reopen(store, create, partition);
        assert.equal((await store.outbox.get(item.intent))?.state, "queued");
        await store.commit({ outbox: { put: [item.committed] } });
        assert.ok((await store.outbox.overlay())[item.intent], `${name}: prior coverage cannot confirm a later terminal`);
        assert.equal((await store.outbox.get(item.intent))?.predicted, true);
        // A fresh fact at the same data seq is valid in the new coverage.
        await store.commit(negative);
        await assertRetired(store, item.intent, name);
      } finally { await store.close?.(); }
    });
  });
}

test("a queued hidden-row eviction is not durable authoritative negative evidence on both carriers", async () => {
  await carriers(async (name, create) => {
    let store = create();
    const item = prediction(`${name}-hidden-queued`);
    const partition = `${name}:hidden-queued`;
    try {
      await store.open(partition);
      await store.commit({ outbox: { put: [item.queued] }, overlay: { put: { [item.intent]: item.overlay } },
        deliveries: [page("messages.bySlug", { slug: "private" }, 29, [row("messages", item.id)])] });
      await store.commit({ deliveries: [{ ...page("messages.bySlug", { slug: "private" }, 31, []), data: null }] });
      store = await reopen(store, create, partition);
      await store.commit({ outbox: { put: [item.committed] } });
      assert.ok((await store.outbox.overlay())[item.intent], `${name}: hidden eviction cannot settle a prediction`);
    } finally { await store.close?.(); }
  });
});

test("object and array arguments, including object-entry arrays, cannot supply another query's chain on both carriers", async () => {
  await carriers(async (name, create) => {
    for (const [selected, foreign] of [[{}, []], [{ a: 1 }, [["a", 1]]], [{ a: "1" }, [["a", "1"]]]]) {
      const store = create();
      const item = prediction(`${name}-${JSON.stringify(selected)}`);
      const mark = (watermark: string) => ({ op: "deliveries.inbox", args: { c: null, filter: selected }, cursorArg: "c", watermark, updatedAt: 1 });
      try {
        await seed(store, `${name}:${JSON.stringify(selected)}`, item, mark("a"));
        await store.commit({ deliveries: [
          page("deliveries.inbox", { c: "a", filter: foreign }, 30, [row("deliveries", "foreign-link")], "b"),
          page("deliveries.inbox", { c: "b", filter: foreign }, 30, [row("deliveries", "foreign-page")], "c"),
        ], watermark: mark("b") });
        await store.commit({ watermark: mark("c") });
        assert.ok((await store.outbox.overlay())[item.intent], `${name}: foreign arguments prove neither arrival nor progress`);
        await store.commit({ resumeSeq: 31 });
        assert.ok((await store.outbox.overlay())[item.intent], `${name}: neither foreign mark consumed patience`);
      } finally { await store.close?.(); }
    }
  });
});

test("an ambiguous link preserves the proven prefix but cannot advance beyond it on both carriers", async () => {
  await carriers(async (name, create) => {
    const store = create();
    const item = prediction(`${name}-ambiguous`);
    Object.assign(item.overlay[0]!, { removed: true }); // Only negatives or misses can retire.
    const mark = (watermark: string) => ({ op: "deliveries.inbox", args: { c: null }, cursorArg: "c", watermark, updatedAt: 1 });
    try {
      await seed(store, `${name}:ambiguous`, item, mark("a"));
      await store.commit({ deliveries: [
        { ...page("deliveries.inbox", { c: "a" }, 30, [row("deliveries", "a")], "b"), cursorArg: "c" },
        { ...page("deliveries.inbox", { c: "b" }, 30, [row("deliveries", "b")], "c"), cursorArg: "c" },
        { ...page("deliveries.inbox", { after: "b" }, 30, [row("deliveries", "alias")], "d"), cursorArg: "after" },
      ] });
      for (const position of ["c", "d", "c"]) await store.commit({ watermark: mark(position) });
      assert.ok((await store.outbox.overlay())[item.intent], "an ambiguous continuation supplies no progress");
      await store.commit({ watermark: mark("b") });
      assert.ok((await store.outbox.overlay())[item.intent], "the proven prefix consumes exactly one miss");
      await store.commit({ resumeSeq: 31 });
      await assertRetired(store, item.intent, name);
    } finally { await store.close?.(); }
  });
});

test("evicting the progress page re-anchors at surviving consumed positions on both carriers", async () => {
  await carriers(async (name, create) => {
    let store = create();
    const partition = `${name}:evicted-progress`;
    const item = prediction(`${name}-evicted-progress`);
    Object.assign(item.overlay[0]!, { removed: true });
    const mark = (watermark: string) => ({ op: "deliveries.inbox", args: { c: null }, cursorArg: "c", watermark, updatedAt: 1 });
    try {
      await seed(store, partition, item, mark("a"));
      await store.commit({ deliveries: [
        page("deliveries.inbox", { c: "a" }, 30, [row("deliveries", "a")], "b"),
        page("deliveries.inbox", { c: "b" }, 30, [row("deliveries", "b")], "c"),
      ], watermark: mark("c") });
      await store.commit({ dropAnswers: ['deliveries.inbox\u0000{"c":"b"}'] });
      store = await reopen(store, create, partition);
      await store.commit({ deliveries: [page("deliveries.inbox", { c: "b" }, 31, [row("deliveries", "new-b")], "d")] });
      await store.commit({ watermark: mark("b") });
      assert.ok((await store.outbox.overlay())[item.intent], "the surviving consumed prefix cannot count again");
      await store.commit({ watermark: mark("d") });
      await assertRetired(store, item.intent, name);
    } finally { await store.close?.(); }
  });
});

test("consumed progress survives cold reopen and a repeated position never double-counts on both carriers", async () => {
  await carriers(async (name, create) => {
    let store = create();
    const partition = `${name}:consumed`;
    const item = prediction(`${name}-consumed`);
    const mark = (watermark: string) => ({ op: "deliveries.inbox", args: { c: null }, cursorArg: "c", watermark, updatedAt: 1 });
    try {
      await seed(store, partition, item, mark("a"));
      const link = page("deliveries.inbox", { c: "a" }, 30, [row("deliveries", "link")], "b");
      await store.commit({ deliveries: [link], watermark: mark("b") });
      store = await reopen(store, create, partition);
      for (const watermark of ["b", "a", "b"]) await store.commit({ deliveries: [link], watermark: mark(watermark) });
      assert.ok((await store.outbox.overlay())[item.intent], "one consumed position remains one miss after reopen");
      await store.commit({ resumeSeq: 31 });
      await assertRetired(store, item.intent, name);
    } finally { await store.close?.(); }
  });
});

test("a re-served page replaces its next link and conditional refresh cannot renew a pre-commit link on both carriers", async () => {
  await carriers(async (name, create) => {
    let store = create();
    const partition = `${name}:link-seq`;
    const item = prediction(`${name}-link-seq`);
    const mark = (watermark: string) => ({ op: "deliveries.inbox", args: { c: null }, cursorArg: "c", watermark, updatedAt: 1 });
    try {
      await seed(store, partition, item, mark("a"));
      await store.commit({ deliveries: [{ ...page("deliveries.inbox", { c: "a" }, 29, [row("deliveries", "link")], "b"), validator: "old" }] });
      await store.commit({ refreshes: [{ op: "deliveries.inbox", args: { c: "a" }, seq: 31, validator: "old" }] });
      store = await reopen(store, create, partition);
      await store.commit({ deliveries: [page("deliveries.inbox", { c: "b" }, 31, [row("deliveries", "not-proven")])], watermark: mark("b") });
      assert.ok((await store.outbox.overlay())[item.intent], "a refreshed answer seq cannot promote an old next link");
      await store.commit({ dropAnswers: ['deliveries.inbox\u0000{"c":"b"}'] });
      await store.commit({ deliveries: [page("deliveries.inbox", { c: "a" }, 32, [row("deliveries", "link")], "b")] });
      // The page grew: a -> c replaces an eligible post-commit a -> b link.
      await store.commit({ deliveries: [page("deliveries.inbox", { c: "a" }, 33, [row("deliveries", "link")], "c")] });
      await store.commit({ deliveries: [page("deliveries.inbox", { c: "b" }, 33, [row("deliveries", "old-page")])], watermark: mark("b") });
      assert.ok((await store.outbox.overlay())[item.intent], "the old continuation no longer supplies a link or arrival");
      await store.commit({ deliveries: [page("deliveries.inbox", { c: "c" }, 33, [row("deliveries", "current-page")])] });
      await assertRetired(store, item.intent, name);
    } finally { await store.close?.(); }
  });
});

test("a full delivery at a refreshed seq renews continuation evidence only after content validation", async () => {
  await carriers(async (name, create) => {
    let store = create();
    const partition = `${name}:full-after-refresh`;
    const item = prediction(partition);
    try {
      await seed(store, partition, item, { op: "deliveries.inbox", args: { c: null }, cursorArg: "c", watermark: "a", updatedAt: 1 });
      const link = { ...page("deliveries.inbox", { c: "a" }, 29, [row("deliveries", "link")], "b"), validator: "old" };
      await store.commit({ deliveries: [link] });
      await store.commit({ refreshes: [{ op: link.op, args: link.args, seq: 31, validator: link.validator }] });
      store = await reopen(store, create, partition);
      await store.commit({ deliveries: [page("deliveries.inbox", { c: "b" }, 31, [row("deliveries", "beyond")])] });
      assert.ok((await store.outbox.overlay())[item.intent], "unchanged cannot renew a pre-commit link");
      await assert.rejects(store.commit({ deliveries: [{ ...link, seq: 31, next: "forged" }] }), /conflicting deliveries/);
      assert.ok((await store.outbox.overlay())[item.intent], "conflicting full content proves no progress");
      await store.commit({ deliveries: [{ ...link, seq: 31 }] });
      await assertRetired(store, item.intent, name);
    } finally { await store.close?.(); }
  });
});

test("nonempty scalar projections use held closure rows to prove tail progress on both carriers", async () => {
  await carriers(async (name, create) => {
    const store = create();
    const item = prediction(`${name}-projected`);
    const projected = (position: string, next: string | null) => ({
      ...page("deliveries.inbox", { c: position }, 31, [row("deliveries", position)], next), data: [position],
    });
    try {
      await seed(store, `${name}:projected`, item, { op: "deliveries.inbox", args: { c: null }, cursorArg: "c", watermark: "a", updatedAt: 1 });
      await store.commit({ deliveries: [projected("a", "b")] });
      assert.ok((await store.outbox.overlay())[item.intent], "the snapshot's own projected page is not past it");
      await store.commit({ deliveries: [projected("b", null)] });
      await assertRetired(store, item.intent, name);
    } finally { await store.close?.(); }
  });
});

test("a retained denied tail cannot prove authoritative page arrival", async () => {
  await carriers(async (name, create) => {
    let store = create();
    const item = prediction(`${name}-retained-tail`);
    const partition = `${name}:retained-tail`;
    try {
      await seed(store, partition, item, { op: "deliveries.inbox", args: { c: null }, cursorArg: "c", watermark: "a", updatedAt: 1 });
      await store.commit({ deliveries: [page("deliveries.inbox", { c: "b" }, 29, [row("deliveries", "old")])] });
      await store.commit({ retention: { deliveries: "delivered-history" }, deliveries: [{
        ...page("deliveries.inbox", { c: "b" }, 31, []), state: "denied", data: undefined,
      }] });
      store = await reopen(store, create, partition);
      assert.equal((await store.answer("deliveries.inbox", { c: "b" }))?.retained, true);
      await store.commit({ deliveries: [page("deliveries.inbox", { c: "a" }, 31, [row("deliveries", "link")], "b")] });
      assert.ok((await store.outbox.overlay())[item.intent], "retained history past a fresh link is not arrival");
      await store.commit({ deliveries: [page("deliveries.inbox", { c: "b" }, 32, [row("deliveries", "fresh")])] });
      await assertRetired(store, item.intent, name);
    } finally { await store.close?.(); }
  });
});

test("a denied delivered-history answer cannot confirm arrival of a committed edit on both carriers", async () => {
  await carriers(async (name, create) => {
    const store = create();
    const item = prediction(`${name}-retained`);
    try {
      await seed(store, `${name}:retained`, item, { op: "deliveries.inbox", args: { c: null }, cursorArg: "c", watermark: "a", updatedAt: 1 });
      await store.commit({ deliveries: [page("messages.byId", { id: item.id }, 29, [row("messages", item.id)])] });
      await store.commit({ retention: { messages: "delivered-history" }, deliveries: [{
        ...page("messages.byId", { id: item.id }, 31, []), state: "denied", data: undefined,
      }] });
      assert.ok((await store.outbox.overlay())[item.intent], "retained stale content is not an authoritative arrival");
      await store.commit({ deliveries: [page("messages.byId", { id: item.id }, 32, [row("messages", item.id)])] });
      await assertRetired(store, item.intent, name);
    } finally { await store.close?.(); }
  });
});

test("a 60-row resume followed by a 50-row-page remount cannot count the backward mark or duplicate delivery as progress on both carriers", async () => {
  await carriers(async (name, create) => {
    let store = create();
    const partition = `${name}:remount`;
    const item = prediction(`${name}-remount`);
    const rows = Array.from({ length: 60 }, (_, i) => row("deliveries", `row-${i + 1}`));
    const mark = (watermark: string) => ({ op: "deliveries.inbox", args: { c: null }, cursorArg: "c", watermark, updatedAt: 1 });
    try {
      // Resume's last-returned-row cursor, then a commit at that snapshot.
      await seed(store, partition, item, mark("row-60"));
      const base = page("deliveries.inbox", { c: null }, 31, rows.slice(0, 50), "row-50");
      const last = page("deliveries.inbox", { c: "row-50" }, 31, rows.slice(50));
      await store.commit({ deliveries: [base, last], watermark: mark("row-50") });
      assert.ok((await store.outbox.overlay())[item.intent], `${name}: remount's exhausted-page cursor is a regression`);
      await store.commit({ deliveries: [base, last], watermark: mark("row-50") });
      store = await reopen(store, create, partition);
      for (const watermark of ["row-60", "row-50", "row-60"]) {
        await store.commit({ watermark: mark(watermark) });
        assert.ok((await store.outbox.overlay())[item.intent], `${name}: repeated/backward positions never advance`);
      }
      await store.commit({ resumeSeq: 31 });
      assert.ok((await store.outbox.overlay())[item.intent], `${name}: remount and duplicate did not consume either miss`);
    } finally { await store.close?.(); }
  });
});

test("missing and pre-commit links prove nothing; a cycle keeps only its proven prefix on both carriers", async () => {
  await carriers(async (name, create) => {
    let store = create();
    const partition = `${name}:chain`;
    const item = prediction(`${name}-chain`);
    Object.assign(item.overlay[0]!, { removed: true }); // Isolate progress from positive arrival.
    const mark = (watermark: string) => ({ op: "deliveries.inbox", args: { c: null }, cursorArg: "c", watermark, updatedAt: 1 });
    try {
      await seed(store, partition, item, mark("a"));
      await store.commit({ deliveries: [page("deliveries.inbox", { c: "b" }, 30, [row("deliveries", "second")])], watermark: mark("b") });
      assert.ok((await store.outbox.overlay())[item.intent], `${name}: inequality and seq cannot replace a link`);
      await store.commit({ deliveries: [page("deliveries.inbox", { c: "a" }, 29, [row("deliveries", "first")], "b")] });
      assert.ok((await store.outbox.overlay())[item.intent], `${name}: every link must be at or after commit seq`);
      // The same opaque cursor cannot mean two successive positions.
      await store.commit({ deliveries: [
        page("deliveries.inbox", { c: "a" }, 31, [row("deliveries", "first")], "b"),
        page("deliveries.inbox", { c: "b" }, 31, [row("deliveries", "second")], "a"),
      ], watermark: mark("a") });
      store = await reopen(store, create, partition);
      await store.commit({ watermark: mark("b") });
      assert.ok((await store.outbox.overlay())[item.intent], `${name}: the cycle's proven a -> b prefix consumes one miss`);
      await store.commit({ watermark: mark("a") });
      await store.commit({ watermark: mark("b") });
      assert.ok((await store.outbox.overlay())[item.intent], `${name}: wrapping or repeating never consumes another miss`);
      await store.commit({ resumeSeq: 31 });
      await assertRetired(store, item.intent, `${name}: the prefix was kept before the cycle`);
    } finally { await store.close?.(); }
  });
});

test("the commit snapshot round-trips after the tail moved and retires against the persisted position on both carriers", async () => {
  await carriers(async (name, create) => {
    let store = create();
    const partition = `${name}:snapshot`;
    const item = prediction(`${name}-snapshot`);
    try {
      await seed(store, partition, item, {
        op: "deliveries.inbox", args: { c: null }, cursorArg: "c", watermark: "commit-position", updatedAt: 1,
      });
      // No chain yet, so this mark does not consume patience. Hold the link
      // afterwards without re-marking, then reopen with a moved current tail.
      await store.commit({ watermark: { op: "deliveries.inbox", args: { c: null }, cursorArg: "c", watermark: "new-position", updatedAt: 2 } });
      await store.commit({ deliveries: [page("deliveries.inbox", { c: "commit-position" }, 30, [row("deliveries", "link")], "new-position")] });
      store = await reopen(store, create, partition);
      await store.commit({ deliveries: [page("deliveries.inbox", { c: "new-position" }, 30, [row("deliveries", "arrived-page")])] });
      await assertRetired(store, item.intent, name);
      store = await reopen(store, create, partition);
      await assertRetired(store, item.intent, `${name}: durable retirement`);
    } finally { await store.close?.(); }
  });
});

for (const kind of ["primary absence", "tombstone", "predicted deletion"] as const) {
  test(`${kind} retires the committed overlay in its swap and after cold reopen on both carriers`, async () => {
    await carriers(async (name, create) => {
      let store = create();
      const partition = `${name}:${kind}`;
      const item = prediction(`${name}-${kind}`);
      if (kind === "predicted deletion") Object.assign(item.overlay[0]!, { removed: true });
      const absent = (seq: number) => ({
        ...page("messages.byId", { id: item.id }, seq, []), data: null,
        receipt: { ...receipt(), absences: [["messages", "byId", [item.id]]] as Array<[string, string, unknown[]]> },
      });
      try {
        await seed(store, partition, item, { op: "deliveries.inbox", args: { c: null }, cursorArg: "c", watermark: "quiet", updatedAt: 1 });
        await store.commit({ deliveries: [absent(29)] });
        assert.ok((await store.outbox.overlay())[item.intent], `${name}: pre-commit absence is not enough`);
        if (kind === "predicted deletion") {
          await store.commit({ deliveries: [page("messages.byId", { id: item.id }, 30, [row("messages", item.id)])] });
          assert.ok((await store.outbox.overlay())[item.intent], `${name}: arrival does not confirm a deletion`);
          store = await reopen(store, create, partition);
          assert.ok((await store.outbox.overlay())[item.intent], `${name}: predicted deletion survives reopen until absence`);
        }
        if (kind === "tombstone") await store.commit({ tombstones: [{ table: "messages", id: item.id, seq: 30 }] });
        else await store.commit({ deliveries: [absent(kind === "predicted deletion" ? 31 : 30)] });
        await assertRetired(store, item.intent, name);
        assert.equal((await store.coverage()).rows.some((held) => held.id === item.id), false);
        store = await reopen(store, create, partition);
        await assertRetired(store, item.intent, `${name}: cold`);
        assert.equal((await store.coverage()).rows.some((held) => held.id === item.id), false, "no deleted body to hydrate");
      } finally { await store.close?.(); }
    });
  });
}

test("empty answers and hidden alternate-key lookups are not authoritative absence on both carriers", async () => {
  await carriers(async (name, create) => {
    let store = create();
    const partition = `${name}:hidden`;
    const item = prediction(`${name}-hidden`);
    try {
      await seed(store, partition, item, { op: "deliveries.inbox", args: { c: null }, cursorArg: "c", watermark: "quiet", updatedAt: 1 });
      await store.commit({ deliveries: [page("messages.list", {}, 30, [])] });
      await store.commit({ deliveries: [{ ...page("messages.bySlug", { slug: "hidden" }, 31, []), data: null }] });
      assert.ok((await store.outbox.overlay())[item.intent]);
      await assert.rejects(store.commit({ deliveries: [{
        ...page("messages.bySlug", { slug: "hidden" }, 32, []),
        receipt: { ...receipt(), absences: [["messages", "bySlug", [item.id]]] },
      }] }), /primary byId absence/);
      store = await reopen(store, create, partition);
      assert.ok((await store.outbox.overlay())[item.intent], `${name}: no absence was invented`);
      await store.commit({ resumeSeq: 29 });
      await store.commit({ resumeSeq: 30 });
      assert.ok((await store.outbox.overlay())[item.intent], `${name}: old resume did not count`);
      await store.commit({ resumeSeq: 30 });
      assert.ok((await store.outbox.overlay())[item.intent], `${name}: repeated commit-seq resumes do not count`);
      await store.commit({ resumeSeq: 31 });
      assert.ok((await store.outbox.overlay())[item.intent], `${name}: one strictly post-commit resume`);
      await store.commit({ resumeSeq: 31 });
      await assertRetired(store, item.intent, name);
    } finally { await store.close?.(); }
  });
});

test("resetCoverage rebases the snapshot and patience for a new tail op and cursor name on both carriers", async () => {
  await carriers(async (name, create) => {
    let store = create();
    const partition = `${name}:reset`;
    const item = prediction(`${name}-reset`);
    try {
      await seed(store, partition, item, { op: "deliveries.inbox", args: { c: null }, cursorArg: "c", watermark: "old", updatedAt: 1 });
      await store.commit({ resumeSeq: 31 });
      await store.commit({ resetCoverage: true });
      store = await reopen(store, create, partition);
      // A cold drain establishes the new query's root -> last-page link.
      await store.commit({ deliveries: [
        { ...page("deliveries.newInbox", { after: null }, 31, [row("deliveries", "new-root")], "new-last"), cursorArg: "after" },
        { ...page("deliveries.newInbox", { after: "new-last" }, 31, [row("deliveries", "new-last")]), cursorArg: "after" },
      ], watermark: { op: "deliveries.newInbox", args: { after: null }, cursorArg: "after", watermark: "new-last", updatedAt: 2 } });
      assert.ok((await store.outbox.overlay())[item.intent], `${name}: the first continuation is the new snapshot head, not past it`);
      store = await reopen(store, create, partition);
      await store.commit({ resumeSeq: 31 });
      assert.ok((await store.outbox.overlay())[item.intent], `${name}: pre-reset patience was cleared`);
      await store.commit({ deliveries: [
        { ...page("deliveries.newInbox", { after: "new-last" }, 32, [row("deliveries", "link")], "later"), cursorArg: "after" },
        { ...page("deliveries.newInbox", { after: "later" }, 32, [row("deliveries", "later")]), cursorArg: "after" },
      ] });
      await assertRetired(store, item.intent, `${name}: a page strictly beyond the new head retires`);
      store = await reopen(store, create, partition);
      await assertRetired(store, item.intent, `${name}: reset retirement persists`);
    } finally { await store.close?.(); }
  });
});

const generation = "d".repeat(64);
const schemaHash = "e".repeat(64);
const planHash = "f".repeat(64);

function resumeFetch(cursor: string, log: unknown, observed?: (request: any) => void, seq = 31): typeof fetch {
  return async (input, init) => {
    const path = new URL(String(input)).pathname;
    const json = (value: unknown, status = 200) => new Response(JSON.stringify(value), { status });
    if (path === "/api/manifest") return json({
      generation: "schema-generation", programGeneration: generation, channels: {}, auth: {},
      ops: { "deliveries.inbox": { kind: "query", planHash, cursor, args: { [cursor]: { Optional: "Cursor" } } } },
    });
    if (path === "/api/program") return json({ code: "E_ROUTE", family: "op", message: "not found", guide: "op/reference" }, 404);
    if (path === "/api/resume") {
      observed?.(JSON.parse(String(init?.body)));
      return json({ seq, generation, schemaHash, authority: { principal: "dev:alice", authEpoch: 7 }, log, mounted: [] });
    }
    throw new Error(`unexpected request ${path}`);
  };
}

test("unchanged quiet-tail resumes strictly past commit consume one miss across each cold client on both carriers", async () => {
  await carriers(async (name, create) => {
    let store = create();
    const item = prediction(`${name}-quiet`);
    let resumes = 0;
    try {
      await seed(store, "dev:alice", item, { op: "deliveries.inbox", args: { c: null }, cursorArg: "c", watermark: "quiet", updatedAt: 1 });
      await store.commit({ facts: { generation, schemaHash, authEpoch: 7 } });
      await store.close?.();
      for (let count = 1; count <= 2; count++) {
        const client = createClient({ url: "http://quiet.test", persona: "alice", offline: { store: create },
          fetch: resumeFetch("c", { unchanged: true }, () => resumes++),
        });
        try { await client.ready; } finally { await client.close(); }
        store = create();
        await store.open("dev:alice");
        if (count === 1) {
          assert.ok((await store.outbox.overlay())[item.intent], `${name}: exactly one miss after first resume`);
          assert.equal((await store.outbox.get(item.intent))?.predicted, true);
        } else await assertRetired(store, item.intent, name);
        await store.close?.();
      }
      assert.equal(resumes, 2, `${name}: one validated response from each cold client`);
      store = create();
      await store.open("dev:alice");
      await assertRetired(store, item.intent, `${name}: cold after second resume`);
    } finally { await store.close?.(); }
  });
});

test("repeated online resumes at the commit seq do not consume misses in one session on both carriers", async () => {
  await carriers(async (name, create) => {
    let store = create();
    const item = prediction(`${name}-same-seq`);
    let seq = 30;
    let resumes = 0;
    await seed(store, "dev:alice", item, { op: "deliveries.inbox", args: { c: null }, cursorArg: "c", watermark: "quiet", updatedAt: 1 });
    await store.commit({ facts: { generation, schemaHash, authEpoch: 7 } });
    await store.close?.();
    const client = createClient({ url: "http://same-seq.test", persona: "alice", offline: { store: () => (store = create()) },
      fetch: (input, init) => resumeFetch("c", { unchanged: true }, () => resumes++, seq)(input, init),
    });
    try {
      await client.ready;
      await client.online();
      await client.online();
      assert.ok(resumes >= 3, "each online call performed a resume");
      assert.ok((await store.outbox.overlay())[item.intent], `${name}: repeated commit-seq resumes leave prediction intact`);
      seq = 31;
      await client.online();
      assert.ok((await store.outbox.overlay())[item.intent], `${name}: first strictly post-commit resume is one miss`);
      await client.online();
      await assertRetired(store, item.intent, `${name}: two qualifying resumes in the same session`);
    } finally { await client.close(); }
  });
});

test("a pre-manifest c snapshot needs fresh correctly named links after reopening with an after manifest on both carriers", async () => {
  await carriers(async (name, create) => {
    let store = create();
    const item = prediction(`${name}-fallback`);
    try {
      // The args are already the app's args; the runtime has not learned the
      // cursor type yet. Snapshot c, advance the tail without consuming a miss.
      await seed(store, "dev:alice", item, { op: "deliveries.inbox", args: { after: null }, watermark: "start", updatedAt: 1 });
      await store.commit({ facts: { generation, schemaHash, authEpoch: 7 }, watermark: {
        op: "deliveries.inbox", args: { after: null }, watermark: "middle", updatedAt: 2,
      } });
      await store.commit({ deliveries: [{
        ...page("deliveries.inbox", { after: "start" }, 30, [row("deliveries", "link")], "middle"), cursorArg: "c",
      }] });
      await store.close?.();
      let request: any;
      const held = row("deliveries", "authoritative-tail");
      const client = createClient({ url: "http://fallback.test", persona: "alice", offline: { store: create },
        fetch: resumeFetch("after", {
          protocol: 1, generation, schemaHash, planHash, authority: { principal: "dev:alice", authEpoch: 7 },
          state: "complete", data: [ref(held.table, held.id)], rows: [held], receipt: receipt(),
          seq: 30, next: null, validator: "1".repeat(64), watermark: "middle",
        }, (value) => { request = value; }, 30),
      });
      try { await client.ready; } finally { await client.close(); }
      assert.deepEqual(request.log.args, { after: null });
      store = create();
      await store.open("dev:alice");
      assert.ok(await store.answer("deliveries.inbox", { after: "middle" }), `${name}: live name files the tail`);
      assert.equal(await store.answer("deliveries.inbox", { after: null, c: "middle" }), undefined);
      // Exactly one resume and no proven re-mark: the two-miss bound cannot
      // conceal a lost cursor name or a snapshot rebuilt at the current tail.
      assert.ok((await store.outbox.overlay())[item.intent], `${name}: an unknown cursor name is not an ordered link`);
      await store.commit({ deliveries: [{
        ...page("deliveries.inbox", { after: "start" }, 31, [row("deliveries", "link")], "middle"), cursorArg: "after",
      }] });
      assert.ok((await store.outbox.overlay())[item.intent], `${name}: naming the persisted root does not prove progress past it`);
      await store.commit({ deliveries: [{
        ...page("deliveries.inbox", { after: "middle" }, 32, [row("deliveries", "past-link")], "tail"), cursorArg: "after",
      }] });
      await assertRetired(store, item.intent, `${name}: a fresh engine-valid link uses the persisted snapshot`);
    } finally { await store.close?.(); }
  });
});

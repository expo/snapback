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
      await store.commit({ resumeSeq: 30 });
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

test("a missing or pre-commit link and a chain using the same cursor string twice fail closed on both carriers", async () => {
  await carriers(async (name, create) => {
    let store = create();
    const partition = `${name}:chain`;
    const item = prediction(`${name}-chain`);
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
      assert.ok((await store.outbox.overlay())[item.intent], `${name}: a repeated cursor cycle has no ordered path`);
      await store.commit({ deliveries: [page("deliveries.inbox", { c: "b" }, 32, [row("deliveries", "second")])] });
      await assertRetired(store, item.intent, `${name}: a fresh acyclic chain supplies the missing proof`);
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
      await store.commit({ resumeSeq: 30 });
      await store.commit({ resetCoverage: true });
      store = await reopen(store, create, partition);
      await store.commit({ resumeSeq: 30 });
      assert.ok((await store.outbox.overlay())[item.intent], `${name}: pre-reset patience was cleared`);
      // A cold drain establishes the new query's root -> last-page link.
      await store.commit({ deliveries: [
        { ...page("deliveries.newInbox", { after: null }, 31, [row("deliveries", "new-root")], "new-last"), cursorArg: "after" },
        { ...page("deliveries.newInbox", { after: "new-last" }, 31, [row("deliveries", "new-last")]), cursorArg: "after" },
      ], watermark: { op: "deliveries.newInbox", args: { after: null }, cursorArg: "after", watermark: "new-last", updatedAt: 2 } });
      await assertRetired(store, item.intent, `${name}: first drain under the new name is judged`);
      store = await reopen(store, create, partition);
      await assertRetired(store, item.intent, `${name}: reset retirement persists`);
    } finally { await store.close?.(); }
  });
});

const generation = "d".repeat(64);
const schemaHash = "e".repeat(64);
const planHash = "f".repeat(64);

function resumeFetch(cursor: string, log: unknown, observed?: (request: any) => void): typeof fetch {
  return async (input, init) => {
    const path = new URL(String(input)).pathname;
    const json = (value: unknown, status = 200) => new Response(JSON.stringify(value), { status });
    if (path === "/api/manifest") return json({
      generation: "schema-generation", programGeneration: generation, channels: {}, auth: {},
      ops: { "deliveries.inbox": { kind: "query", planHash, args: { [cursor]: { Optional: "Cursor" } } } },
    });
    if (path === "/api/program") return json({ code: "E_ROUTE", family: "op", message: "not found", guide: "op/reference" }, 404);
    if (path === "/api/resume") {
      observed?.(JSON.parse(String(init?.body)));
      return json({ seq: 30, generation, schemaHash, authority: { principal: "dev:alice", authEpoch: 7 }, log, mounted: [] });
    }
    throw new Error(`unexpected request ${path}`);
  };
}

test("an unchanged quiet-tail resume consumes one miss even at the same seq across two cold clients on both carriers", async () => {
  await carriers(async (name, create) => {
    let store = create();
    const item = prediction(`${name}-quiet`);
    let resumes = 0;
    try {
      await seed(store, "dev:alice", item, { op: "deliveries.inbox", args: { c: null }, cursorArg: "c", watermark: "quiet", updatedAt: 1 });
      await store.commit({ facts: { generation, schemaHash, authEpoch: 7 } });
      await store.close?.();
      for (let count = 1; count <= 2; count++) {
        const client = createClient({ url: "http://quiet.test", as: "alice", offline: { store: create },
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

test("a pre-manifest c snapshot survives reopening with an after manifest and compares pages by their recorded cursor name on both carriers", async () => {
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
        ...page("deliveries.inbox", { after: null, c: "start" }, 30, [row("deliveries", "link")], "middle"), cursorArg: "c",
      }] });
      await store.close?.();
      let request: any;
      const held = row("deliveries", "authoritative-tail");
      const client = createClient({ url: "http://fallback.test", as: "alice", offline: { store: create },
        fetch: resumeFetch("after", {
          protocol: 1, generation, schemaHash, planHash, authority: { principal: "dev:alice", authEpoch: 7 },
          state: "complete", data: [ref(held.table, held.id)], rows: [held], receipt: receipt(),
          seq: 30, next: null, validator: "1".repeat(64), watermark: "middle",
        }, (value) => { request = value; }),
      });
      try { await client.ready; } finally { await client.close(); }
      assert.deepEqual(request.log.args, { after: null });
      store = create();
      await store.open("dev:alice");
      assert.ok(await store.answer("deliveries.inbox", { after: "middle" }), `${name}: live name files the tail`);
      assert.equal(await store.answer("deliveries.inbox", { after: null, c: "middle" }), undefined);
      // Exactly one resume and no proven re-mark: the two-miss bound cannot
      // conceal a lost cursor name or a snapshot rebuilt at the current tail.
      await assertRetired(store, item.intent, name);
    } finally { await store.close?.(); }
  });
});

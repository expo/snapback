// @ref LLP 1012#7-writes-offline — committed predictions retire on authoritative
// arrival or after two advances of their selected delivery-log tail, never on an
// unrelated watermark or a guessed cursor argument.
import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import { indexedDbRangeStore } from "../dist/react.mjs";
import { fileRangeStore } from "../dist/test.mjs";
import { FakeIndexedDb, FakeLocks } from "./fake-indexeddb.ts";

type Store = ReturnType<ReturnType<typeof fileRangeStore>>;

const receipt = () => ({ ranges: [], absences: [], verdicts: [] });
const ref = (table: string, id: string) => ({ $row: { table, id } });
const row = (table: string, id: string) => ({ table, id, row: { id } });

function page(op: string, args: unknown, seq: number, rows: ReturnType<typeof row>[]) {
  return {
    op, args, state: "complete" as const, data: rows.map((item) => ref(item.table, item.id)),
    next: null, seq, rows, receipt: receipt(),
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
  watermark: { op: string; args: unknown; cursorArg: string; watermark: string | null; updatedAt: number },
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
      await store.commit({ deliveries: [page("deliveries.inbox", { c: "cursor-9" }, 31, [row("deliveries", `${name}-other-conversation`)])] });
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

test("only advances of the tail chooser's own watermark consume overlay patience on both carriers", async () => {
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
      await store.commit({ watermark: { op: "deliveries.inbox", args: { c: null }, cursorArg: "c", watermark: "inbox-2", updatedAt: 4 } });
      assert.ok((await store.outbox.overlay())[item.intent], `${name}: one selected-tail advance is one miss`);
      await store.close?.();
      store = create();
      await store.open(partition);
      await store.commit({ watermark: { op: "deliveries.inbox", args: { c: null }, cursorArg: "c", watermark: "inbox-3", updatedAt: 5 } });
      assert.equal((await store.outbox.overlay())[item.intent], undefined, `${name}: the second selected-tail advance retires the overlay`);
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

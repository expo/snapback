import assert from "node:assert/strict";
import { test } from "node:test";
import { build } from "esbuild";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createClient, api, defineItems as publicItems } from "../dist/client.mjs";
import { fileRangeStore } from "../dist/test.mjs";
import { indexedDbRangeStore } from "../dist/react.mjs";
import { itemInputs as capturedInputs } from "../dist/image-runtime.mjs";
import { FakeIndexedDb, FakeLocks } from "./fake-indexeddb.ts";
import { fakeOwner } from "./fake-owner.ts";
import type { Op } from "../src/api.ts";
import type { OutboxEntry } from "../src/store/range-store.ts";
import type { ItemInputs } from "../src/client-items.ts";

// Exercise the private join without adding a public test export or a build gate.
const bundled = await build({ entryPoints: [new URL("../src/client-items.ts", import.meta.url).pathname],
  bundle: true, write: false, format: "esm", platform: "node" });
const { attachItems, itemAddress, defineItems }: typeof import("../src/client-items.ts") =
  await import(`data:text/javascript;base64,${Buffer.from(bundled.outputFiles[0]!.contents).toString("base64")}`);

type Message = { id: string; body: string; at: number };
type Query = { conversationId: string; c: string | null };
const path: typeof import("../src/api.ts").referencePath = Symbol.for("snapback.referencePath") as never;
const ref = <Args, Result>(op: string): Op<Args, Result> => ({ op, [path]: op });
const spec = defineItems(ref<Query, { message: Message | null }[]>("deliveries.thread"), {
  table: "messages", select: delivery => delivery.message, order: "reverse",
  create: {
    op: ref<{ conversationId: string; body: string }, { id: string }>("deliveries.post"),
    belongs: (args, query) => query.c === null && args.conversationId === query.conversationId,
    key: entry => entry.ids[0], draft: args => ({ body: args.body }),
  },
  update: { op: ref<{ messageId: string; body: string }, null>("deliveries.edit"), key: args => args.messageId },
  remove: { op: ref<{ messageId: string }, null>("deliveries.unsend"), key: args => args.messageId },
});
const args: Query = { conversationId: "chat", c: null };
const entry = (delta: Partial<OutboxEntry> = {}): OutboxEntry => ({
  intent: "grant:0", grant: "grant", offset: 0, count: 2, ids: ["m", "fanout"],
  op: "deliveries.post", args: { conversationId: "chat", body: "submitted" },
  issuedSeq: 40, state: "queued", order: 3, createdAt: 1, updatedAt: 1, ...delta,
});
const inputs = (entries: OutboxEntry[], extra: Partial<ItemInputs> = {}): ItemInputs => ({
  entries, observations: new Map(), predicted: new Map(), ...extra,
});
const row: Message = Object.freeze({ id: "m", body: "current", at: 7 });
const page = [{ message: row }];

test("one key survives an unpredicted send, commit without delivery, fan-out arrival, and actual row delivery", () => {
  const queued = entry();
  const first = attachItems(spec, args, undefined, inputs([queued]));
  assert.equal(first[0]?.data, undefined);
  assert.deepEqual(first[0]?.draft, { body: "submitted" });
  const committed = entry({ state: "committed", arrived: true, response: { seq: 41 } });
  const fanout = new Map([[itemAddress("deliveries", "fanout"), { through: 90 }]]);
  const waiting = attachItems(spec, args, [], inputs([committed], { observations: fanout }), first);
  assert.equal(waiting.length, 1);
  assert.equal(waiting[0]?.key, first[0]?.key);
  assert.equal(waiting[0]?.pending[0]?.state, "committed", "generic arrived/fanout is not the target");
  const observations = new Map([[itemAddress("messages", "m"), { through: 42 }]]);
  assert.equal(attachItems(spec, args, [], inputs([committed], { observations }))[0]?.pending.length, 1,
    "a row absent from this page has not been displayed here");
  const delivered = attachItems(spec, args, page, inputs([committed], { observations }), waiting);
  assert.equal(delivered.length, 1);
  assert.equal(delivered[0]?.key, first[0]?.key);
  assert.equal(delivered[0]?.data, row);
  assert.equal(delivered[0]?.draft, undefined);
  assert.deepEqual(delivered[0]?.pending, []);
  assert.equal(committed.state, "committed", "the read never dismisses or rewrites the ledger");
});

test("an edit with no created IDs waits for its exact row; a later value can confirm it beneath another prediction", () => {
  const edit = entry({ op: "deliveries.edit", ids: [], args: { messageId: "m", body: "submitted" },
    state: "committed", response: { seq: 41 } });
  const observations = new Map([[itemAddress("messages", "m"), { through: 40 }],
    [itemAddress("messages", "unrelated"), { through: 80 }]]);
  assert.equal(attachItems(spec, args, page, inputs([edit], { observations }))[0]?.pending.length, 1);
  observations.set(itemAddress("messages", "m"), { through: 42 });
  const later = entry({ ...edit, intent: "grant:2", state: "queued", response: undefined, order: 4 });
  const result = attachItems(spec, args, page, inputs([edit, later], { observations,
    predicted: new Map([[itemAddress("messages", "m"), [{ intent: later.intent, kind: "update" }]]]) }));
  assert.equal(result[0]?.data?.body, "current", "the presenter neither compares nor reapplies edit arguments");
  assert.deepEqual(result[0]?.pending.map(action => action.intent), ["grant:2"]);
  assert.equal(result[0]?.predicted, true);
});

test("a fresh answer decides page membership without borrowing proof for a displayed row", () => {
  const committed = entry({ state: "committed", response: { seq: 41 } });
  const observations = new Map([[itemAddress("messages", "m"), { through: 40 }]]);
  const oldPage = inputs([committed], { observations, selection: { through: 40 } });
  const pending = attachItems(spec, args, [], oldPage);
  assert.equal(pending.length, 1, "a commit and newer pool cannot advance the old page");
  const freshPage = inputs([committed], { observations, selection: { through: 42 } });
  assert.deepEqual(attachItems(spec, args, [], freshPage, pending), [], "an old success leaving the page is not a draft");
  assert.deepEqual(attachItems(spec, args, [], freshPage), [], "remount has no hidden display memory to recover");
  assert.equal(attachItems(spec, args, page, freshPage)[0]?.pending.length, 1,
    "page membership cannot certify the contents of an actually displayed row");
  assert.equal(attachItems(spec, args, [], inputs([entry({ state: "rejected" })], { selection: { through: 99 } })).length, 1);
  const baseline = entry({ ...committed, issuedSeq: 41 });
  assert.equal(attachItems(spec, args, [], inputs([baseline], { selection: { through: 41, order: 2 } })).length, 1);
  assert.deepEqual(attachItems(spec, args, [], inputs([baseline], { selection: { through: 41, order: 4 } })), []);
});

test("retained history is indexed once and old creates are not visited on warm page publications", () => {
  let belongs = 0, keys = 0;
  const indexed = defineItems(ref<Query, Message[]>("messages.page"), { table: "messages", select: row => row,
    create: { op: ref<{ conversationId: string; body: string }, unknown>("deliveries.post"),
      key: entry => { keys++; return entry.ids[0]; }, belongs: () => { belongs++; return true; }, draft: args => ({ body: args.body }) } });
  const entries = Array.from({ length: 10_000 }, (_, i) => entry({ intent: `old:${i}`, ids: [`old:${i}`],
    state: "committed", issuedSeq: i, response: { seq: i + 1 }, order: i }));
  const captured = inputs(entries, { selection: { through: 10_001 } });
  assert.deepEqual(attachItems(indexed, args, [], captured), []);
  assert.deepEqual(attachItems(indexed, args, [], captured), []);
  assert.equal(keys, entries.length, "stable ledger records are indexed once across publications");
  assert.equal(belongs, 0, "a fresh page does not walk old successes through application selectors");
});

test("a baseline at the commit sequence cannot confirm a write; a newly ordered unchanged observation can", () => {
  const edit = entry({ op: "deliveries.edit", args: { messageId: "m" }, issuedSeq: 41,
    state: "committed", response: { seq: 41 } });
  const observations = new Map([[itemAddress("messages", "m"), { through: 41, order: 2 }]]);
  assert.equal(attachItems(spec, args, page, inputs([edit], { observations }))[0]?.pending.length, 1);
  observations.set(itemAddress("messages", "m"), { through: 41, order: 4 });
  assert.equal(attachItems(spec, args, page, inputs([edit], { observations }))[0]?.pending.length, 0);
});

test("a fresh base does not certify an image still masked by that intent's own prediction", () => {
  const committed = entry({ state: "committed", response: { seq: 41 } });
  const state = inputs([committed], {
    observations: new Map([[itemAddress("messages", "m"), { through: 42 }]]),
    predicted: new Map([[itemAddress("messages", "m"), [{ intent: committed.intent, kind: "create" }]]]),
  });
  const masked = attachItems(spec, args, page, state);
  assert.equal(masked[0]?.pending.length, 1, "in particular the predicted creation time is not presented as server time");
  assert.deepEqual(masked[0]?.draft, { body: "submitted" }, "the owned draft remains available during a view's authorization handoff");
  assert.equal(attachItems(spec, args, page, { ...state, predicted: new Map() })[0]?.pending.length, 0);
});

test("only explicit absence resolves a deleted target; a failed create remains recoverable even after absence", () => {
  const remove = entry({ op: "deliveries.unsend", args: { messageId: "m" }, state: "committed", response: { seq: 41 } });
  const observations = new Map([[itemAddress("messages", "m"), { through: 42 }]]);
  assert.equal(attachItems(spec, args, page, inputs([remove], { observations }))[0]?.pending.length, 1);
  const absent = new Map([[itemAddress("messages", "m"), { through: 42, absent: true as const }]]);
  const committed = entry({ state: "committed", response: { seq: 41 } });
  assert.deepEqual(attachItems(spec, args, [], inputs([committed], { observations: absent })), []);
  const failed = entry({ state: "rejected", response: { message: "conflict" } });
  assert.equal(attachItems(spec, args, [], inputs([failed], { observations: absent }))[0]?.pending[0]?.dismissible, true);
});

test("head-page creates stay scoped, null rows are omitted, and reversal does not change query data", () => {
  const data = Object.freeze([{ message: Object.freeze({ ...row, id: "new" }) }, { message: null }, { message: row }]);
  const result = attachItems(spec, args, data, inputs([entry({ ids: ["draft"] })]));
  assert.deepEqual(result.map(item => item.key), ["m", "new", "draft"]);
  assert.equal(data[0]?.message?.id, "new");
  assert.deepEqual(attachItems(spec, { ...args, c: "opaque" }, [], inputs([entry()])), []);
  assert.deepEqual(attachItems(spec, { ...args, conversationId: "other" }, [], inputs([entry()])), []);
});

test("failed edits and queued changes remain ordered; missing-target changes stay in the outbox without fabricated rows", () => {
  const edits = [entry({ op: "deliveries.edit", args: { messageId: "m" }, state: "rejected" }),
    entry({ intent: "later", op: "deliveries.edit", args: { messageId: "m" } }),
    entry({ intent: "missing", op: "deliveries.unsend", args: { messageId: "absent" } })];
  const result = attachItems(spec, args, page, inputs(edits));
  assert.equal(result.length, 1);
  assert.deepEqual(result[0]?.pending.map(action => action.state), ["rejected", "queued"]);
  assert.equal(edits.length, 3, "outbox recovery keeps the change that has no readable target");
});

test("only this row's effective prediction marks it, and unchanged items preserve reference identity", () => {
  const mark = [{ intent: "other", kind: "create" as const }];
  const state = inputs([entry()], { predicted: new Map([[itemAddress("other-table", "m"), mark], [itemAddress("messages", "other-id"), mark]]) });
  const first = attachItems(spec, args, page, state);
  assert.equal(first[0]?.predicted, false);
  const second = attachItems(spec, args, page, { ...state, entries: [entry()] }, first);
  assert.equal(second, first);
  assert.equal(second[0], first[0]);
});

test("a contributing media prediction attaches its actual intent without an unpredicted draft declaration", () => {
  const media = entry({ op: "messages.postPhoto" });
  const state = inputs([media], { predicted: new Map([[itemAddress("messages", "m"), [{ intent: media.intent, kind: "create" }]]]) });
  const result = attachItems(spec, args, page, state);
  assert.equal(result[0]?.pending[0]?.op, "messages.postPhoto");
  assert.equal(result[0]?.pending[0]?.kind, "create");
  assert.equal(result[0]?.predicted, true);
  assert.deepEqual(attachItems(spec, args, [], state), [], "no unknown media draft or query membership is fabricated");
});

async function until(predicate: () => boolean, label: string): Promise<void> {
  const deadline = Date.now() + 2000;
  while (!predicate()) {
    if (Date.now() > deadline) throw new Error(`waiting for ${label}`);
    await new Promise(resolve => setTimeout(resolve, 10));
  }
}
for (const carrier of ["file", "indexeddb"]) test(`${carrier}: four shared observers resolve a no-ID edit only from the displayed target's new image`, async () => {
  const root = await mkdtemp(join(tmpdir(), "snapback-item-evidence-"));
  const store = carrier === "file" ? fileRangeStore(root)()
    : indexedDbRangeStore({ indexedDB: new FakeIndexedDb() as never, locks: new FakeLocks() as never })();
  const owner = fakeOwner({ seed: true, cursorArg: "c" });
  const client = createClient({ url: "http://items.test", as: "alice", fetch: owner.fetch, offline: { store: () => store } });
  await client.ready;
  const spec = publicItems(api.deliveries.thread, { table: "messages", select: (value: any) => value.message,
    update: { op: api.deliveries.edit, key: (args: any) => args.messageId } });
  const args = { conversationId: "conversation-1", c: null };
  const observed = Array.from({ length: 4 }, () => client.observe(api.deliveries.thread, args, { items: spec }));
  const stops = observed.map(value => value.subscribe(() => undefined));
  try {
    await client.ready;
    await until(() => observed[0]!.getSnapshot().items.length === 1, "the original target");
    const initial = observed[0]!.getSnapshot(), message = initial.items[0]!.data;
    const seq = initial.receipt!.seq;
    await client.offline();
    const edit = entry({ intent: "edit-without-new-ids", ids: [], op: "deliveries.edit", args: { messageId: message.id, body: "edited" },
      issuedSeq: seq, state: "committed", response: { seq: seq + 1 } });
    await store.commit({ outbox: { put: [edit] } });
    await until(() => observed[0]!.getSnapshot().items[0]?.pending.length === 1, "the unresolved committed edit");
    const deliver = (table: string, id: string, row: Record<string, unknown>, through: number) => store.commit({ deliveries: [{
      op: `test.${table}`, args: { id }, state: "complete", data: { $row: { table, id } },
      rows: [{ table, id, row }], seq: through, next: null, receipt: { ranges: [], absences: [], verdicts: [] },
    }] });
    await deliver("messages", "unrelated", { ...message, id: "unrelated", conversationId: "conversation-2" }, seq + 20);
    await new Promise(resolve => setTimeout(resolve, 30));
    assert.equal(observed[0]!.getSnapshot().items[0]!.pending.length, 1);
    await deliver("messages", message.id, { ...message, body: "later owner value" }, seq + 2);
    await until(() => observed[0]!.getSnapshot().items[0]?.data?.body === "later owner value", "the displayed target update");
    const settled = observed[0]!.getSnapshot();
    assert.deepEqual(settled.items[0]!.pending, [], "a newer target value supersedes the committed edit without argument equality");
    for (const other of observed) assert.strictEqual(other.getSnapshot(), settled, "one publication for all readers");
    assert.equal((await client.outbox.entries()).length, 1, "no observer deletes terminal history");
  } finally {
    stops.forEach(stop => stop()); await client.close(); await rm(root, { recursive: true, force: true });
  }
});

test("a computed lookalike cannot borrow another row's observation or prediction", () => {
  const edit = entry({ op: "deliveries.edit", args: { messageId: "m" }, state: "committed", response: { seq: 41 } });
  const state = inputs([edit], { values: new Map([[row, itemAddress("messages", "m")]]),
    observations: new Map([[itemAddress("messages", "m"), { through: 42 }]]),
    predicted: new Map([[itemAddress("messages", "m"), [{ intent: "other", kind: "update" }]]]) });
  const result = attachItems({ ...spec, select: () => ({ ...row, body: "computed" }) }, args, page, state);
  assert.equal(result[0]!.predicted, false);
  assert.equal(result[0]!.pending.length, 1);
});

for (const carrier of ["file", "indexeddb"]) test(`${carrier}: query membership survives reopen; other deliveries cannot advance it`, async () => {
  const root = await mkdtemp(join(tmpdir(), "snapback-item-membership-"));
  const factory = carrier === "file" ? fileRangeStore(root)
    : indexedDbRangeStore({ indexedDB: new FakeIndexedDb() as never, locks: new FakeLocks() as never });
  let store = factory();
  const emptyPage = (seq: number) => ({ op: "deliveries.thread", args, seq, state: "complete" as const,
    data: [], rows: [], receipt: { ranges: [], absences: [], verdicts: [] }, next: null });
  const items = async () => {
    const answer = await store.answer("deliveries.thread", args);
    return attachItems(spec, args, answer!.data, capturedInputs(answer)!);
  };
  try {
    await store.open("dev:alice");
    await store.commit({ deliveries: [emptyPage(40)] });
    await store.commit({ outbox: { put: [entry({ order: undefined, state: "committed", response: { seq: 41 } })] } });
    await store.commit({ deliveries: [{ ...emptyPage(42), op: "messages.other", args: {},
      data: { $row: { table: "messages", id: "m" } }, rows: [{ table: "messages", id: "m", row }] }] });
    assert.equal((await items()).length, 1, "the newer pool does not make the old page current");
    await store.commit({ deliveries: [emptyPage(43)] });
    assert.deepEqual(await items(), [], "the query itself now chooses a page without the committed create");
    await store.close?.(); store = factory(); await store.open("dev:alice");
    assert.deepEqual(await items(), [], "cold reopen cannot resurrect an old success");
    assert.equal((await store.outbox.all()).length, 1, "presentation has not dismissed it");
    await store.commit({ outbox: { put: [entry({ intent: "equal-baseline", order: undefined, issuedSeq: 43,
      state: "committed", response: { seq: 43 } })] } });
    assert.equal((await items()).length, 1, "an older equal-sequence read precedes admission");
    await store.commit({ deliveries: [emptyPage(43)] });
    assert.equal((await items()).length, 1, "an identical envelope replay cannot manufacture a fresh observation");
    await store.commit({ deliveries: [emptyPage(44)] });
    assert.deepEqual(await items(), [], "a fresh query observation resolves the remaining draft");
  } finally { await store.close?.(); await rm(root, { recursive: true, force: true }); }
});

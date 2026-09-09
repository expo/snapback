import assert from "node:assert/strict";
import { test } from "node:test";
import { build } from "esbuild";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createClient, api, defineItems as publicItems, mutationTarget, withHistory } from "../dist/client.mjs";
import { fileRangeStore } from "../dist/test.mjs";
import { indexedDbRangeStore } from "../dist/react.mjs";
import { itemInputs as capturedInputs } from "../dist/image-runtime.mjs";
import { FakeIndexedDb, FakeLocks } from "./fake-indexeddb.ts";
import { fakeOwner, generation, schemaHash } from "./fake-owner.ts";
import type { Op } from "../src/api.ts";
import type { OutboxEntry } from "../src/store/range-store.ts";
import type { ItemInputs } from "../src/client-items.ts";

// Exercise the private join without adding a public test export or a build gate.
const bundled = await build({ stdin: { contents: "export * from './src/client-items.ts'; export { ItemCapture, deliveredItemInputs } from './src/query-items.ts';",
  resolveDir: new URL("..", import.meta.url).pathname, loader: "ts" },
  bundle: true, write: false, format: "esm", platform: "node" });
const { attachItems, itemAddress, defineItems, ItemCapture, deliveredItemInputs }: typeof import("../src/client-items.ts") & typeof import("../src/query-items.ts") =
  await import(`data:text/javascript;base64,${Buffer.from(bundled.outputFiles[0]!.contents).toString("base64")}`);

type Message = { id: string; body: string; at: number };
type Query = { conversationId: string; c: string | null };
const path: typeof import("../src/api.ts").referencePath = Symbol.for("snapback.referencePath") as never;
const ref = <Args, Result, Kind extends "create" | "update" | "remove" = "create">(op: string): Op<Args, Result, { messages: Kind }> => ({ op, [path]: op });
const spec = defineItems(ref<Query, { message: Message | null }[]>("deliveries.thread"), {
  table: "messages", select: delivery => delivery.message, order: "reverse",
  create: {
    target: mutationTarget(ref<{ conversationId: string; body: string }, { id: string }>("deliveries.post"), "messages"),
    belongs: (args, query) => query.c == null && args.conversationId === query.conversationId,
    draft: args => ({ body: args.body }),
  },
  update: { target: mutationTarget(ref<{ messageId: string; body: string }, null, "update">("deliveries.edit"), "messages") },
  remove: { target: mutationTarget(ref<{ messageId: string }, null, "remove">("deliveries.unsend"), "messages") },
});
const args: Query = { conversationId: "chat", c: null };
const mutationProgram = { planHash: "e".repeat(64), schemaHash };
const entry = (delta: Partial<OutboxEntry> = {}): OutboxEntry => {
  const value: OutboxEntry = {
    intent: "grant:0", grant: "grant", offset: 0, count: 2, ids: ["m", "fanout"],
    op: "deliveries.post", args: { conversationId: "chat", body: "submitted" },
    issuedSeq: 40, state: "queued", order: 3, createdAt: 1, updatedAt: 1, ...delta,
  };
  const kind = value.op.endsWith("edit") ? "update" : value.op.endsWith("unsend") ? "remove" : "create";
  if (!("targets" in delta)) value.targets = { generation, ...mutationProgram, complete: false, unresolved: [],
    rows: [{ table: "messages", kind, id: kind === "create" ? value.ids[0]! : (value.args as { messageId: string }).messageId }] };
  if (value.response && !("program" in (value.response as object))) value.response = { ...(value.response as object), program: mutationProgram };
  return value;
};
const inputs = (entries: OutboxEntry[], extra: Partial<ItemInputs> = {}): ItemInputs => ({
  entries, observations: new Map(), predicted: new Map(), program: { generation, schemaHash }, ...extra,
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

test("program replacement and unsupported targets retain intent-only drafts without borrowing row identity", () => {
  const unresolved = entry({ targets: { generation, ...mutationProgram, rows: [], complete: false,
    unresolved: [{ table: "messages", kind: "create", reason: "ambiguous" }] } });
  assert.equal(attachItems(spec, args, [], inputs([unresolved]))[0]?.key, `intent:${unresolved.intent}`);
  const changed = entry({ state: "committed", response: { seq: 41, program: { ...mutationProgram, planHash: "f".repeat(64) } } });
  const items = attachItems(spec, args, page, inputs([changed], { observations: new Map([[itemAddress("messages", "m"), { through: 42 }]]) }));
  assert.deepEqual(items.find(item => item.key === "m")?.pending, []);
  assert.equal(items.find(item => item.key === `intent:${changed.intent}`)?.pending[0]?.state, "committed");
  const queued = entry();
  assert.equal(attachItems(spec, args, [], inputs([queued], { program: { generation: "other", schemaHash } }))[0]?.key, `intent:${queued.intent}`);
  const mismatchedPrediction = attachItems(spec, args, page, inputs([queued], { program: { generation: "other", schemaHash },
    predicted: new Map([[itemAddress("messages", "m"), [{ intent: queued.intent, kind: "create" }]]]) }));
  assert.deepEqual(mismatchedPrediction.find(item => item.key === "m")?.pending, []);
  assert.equal(mismatchedPrediction.find(item => item.key === `intent:${queued.intent}`)?.draft?.body, "submitted");
});

test("declared semantic targets never borrow a contributing prediction when their proof is unavailable", () => {
  for (const kind of ["create", "update", "remove"] as const) {
    const bound = entry({ op: kind === "create" ? "deliveries.post" : kind === "update" ? "deliveries.edit" : "deliveries.unsend",
      args: { conversationId: "chat", messageId: "m", body: "submitted" } });
    const unavailable: Partial<OutboxEntry>[] = [
      { targets: undefined },
      ...(["ambiguous", "repeated", "conditional", "computed"] as const).map(reason => ({ targets: {
        ...bound.targets!, rows: [], complete: false, unresolved: [{ table: "messages", kind, reason }],
      } })),
      { state: "committed", response: { seq: 41, program: { ...mutationProgram, planHash: "f".repeat(64) } } },
      { state: "committed", response: { seq: 41, program: { ...mutationProgram, schemaHash: "f".repeat(64) } } },
      { state: "committed", response: { seq: 41, program: undefined } },
    ];
    for (const delta of unavailable) {
      const intent = entry({ ...bound, ...delta });
      const result = attachItems(spec, args, page, inputs([intent], {
        predicted: new Map([[itemAddress("messages", "m"), [{ intent: intent.intent, kind }]]]),
      }));
      const selected = result.find(item => item.key === "m")!;
      assert.equal(selected.predicted, true, "the overlay still describes the selected image");
      assert.deepEqual(selected.pending, [], "prediction cannot replace the declared correspondence proof");
      assert.equal(result.length, kind === "create" ? 2 : 1);
      if (kind === "create") {
        const draft = result.find(item => item.key === `intent:${intent.intent}`)!;
        assert.deepEqual(draft.draft, { body: "submitted" });
        assert.deepEqual(draft.pending.map(action => action.intent), [intent.intent]);
      }
    }
  }
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
  let belongs = 0;
  const indexed = defineItems(ref<Query, Message[]>("messages.page"), { table: "messages", select: row => row,
    create: { target: mutationTarget(ref<{ conversationId: string; body: string }, unknown>("deliveries.post"), "messages"),
      belongs: () => { belongs++; return true; }, draft: args => ({ body: args.body }) } });
  const entries = Array.from({ length: 10_000 }, (_, i) => entry({ intent: `old:${i}`, ids: [`old:${i}`],
    state: "committed", issuedSeq: i, response: { seq: i + 1 }, order: i }));
  const captured = inputs(entries, { selection: { through: 10_001 } });
  assert.deepEqual(attachItems(indexed, args, [], captured), []);
  assert.deepEqual(attachItems(indexed, args, [], captured), []);
  assert.equal(belongs, 0, "a fresh page does not walk old successes through application selectors");
});

test("held membership survives a local hole; clock-only and unvalidated held absences cannot confirm work", async () => {
  const root = await mkdtemp(join(tmpdir(), "snapback-item-held-proof-"));
  const store = fileRangeStore(root)();
  try {
    await store.open("dev:alice");
    await store.commit({ deliveries: [{ op: "deliveries.thread", args, seq: 42, state: "complete", data: [], rows: [],
      next: null, receipt: { ranges: [], absences: [["messages", "byId", ["m"]]], verdicts: [] } }] });
    const state = (await store.changes()).snapshot!;
    const held = Object.values(state.answers)[0]!;
    const committed = entry({ state: "committed", response: { seq: 41 } });
    const captured = new ItemCapture(state, "deliveries.thread", args, new Map(), [committed]).inputs();
    assert.deepEqual(attachItems(spec, args, undefined, captured), [], "a temporary local hole does not recreate an excluded success");
    let baseline = entry({ state: "committed", issuedSeq: 42, response: { seq: 42 }, order: held.order - 1 });
    const read = () => new ItemCapture(state, "deliveries.thread", args, new Map(), [baseline]).inputs();
    assert.deepEqual(attachItems(spec, args, undefined, read()), [], "a freshly ordered checked absence resolves the create");
    const selection = { ...held.selection! };
    baseline = { ...baseline, order: held.order + 1 };
    held.order += 2;
    for (const flag of ["clockOnly", "needsFactProofs", "retained"] as const) {
      held[flag] = true;
      const unavailable = read();
      assert.deepEqual(unavailable.selection, selection, `${flag} preserves only the earlier checked membership`);
      assert.equal(unavailable.observations.get(itemAddress("messages", "m"))?.order, undefined, flag);
      assert.equal(attachItems(spec, args, undefined, unavailable).length, 1, `${flag} cannot turn the pre-admission negative into new proof`);
      delete held[flag];
    }
  } finally { await store.close?.(); await rm(root, { recursive: true, force: true }); }
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
  const media = entry({ op: "messages.postPhoto", targets: undefined });
  const state = inputs([media], { predicted: new Map([[itemAddress("messages", "m"), [{ intent: media.intent, kind: "create" }]]]) });
  const result = attachItems(spec, args, page, state);
  assert.equal(result[0]?.pending[0]?.op, "messages.postPhoto");
  assert.equal(result[0]?.pending[0]?.kind, "create");
  assert.equal(result[0]?.predicted, true);
  assert.deepEqual(attachItems(spec, args, [], state), [], "no unknown media draft or query membership is fabricated");
});

test("delivery observation preserves frozen row identities and treats escaped markers as application literals", () => {
  const literal = Object.freeze({ $row: Object.freeze({ table: "messages", id: "m" }) });
  const nested = Object.freeze({ message: row });
  const data = Object.freeze([literal, row, nested]);
  const marker = { $row: { table: "messages", id: "m" } };
  const envelope = { data: [{ $row: { $value: literal } }, marker, { message: marker }],
    seq: 42, state: "complete", generation, schemaHash, receipt: { absences: [] } };
  const captured = deliveredItemInputs(envelope as any, data, []);
  assert.equal(captured.values!.get(literal), undefined, "an application marker cannot borrow row provenance");
  assert.equal(captured.values!.get(row), itemAddress("messages", "m"));
  assert.equal(captured.values!.size, 1);
  assert.equal(data[1], row);
  assert.equal(nested.message, row);
  assert.equal(deliveredItemInputs({ ...envelope, data: marker } as any, row, []).values!.get(row), itemAddress("messages", "m"));
});

async function until(predicate: () => boolean, label: string): Promise<void> {
  const deadline = Date.now() + 2000;
  while (!predicate()) {
    if (Date.now() > deadline) throw new Error(`waiting for ${label}`);
    await new Promise(resolve => setTimeout(resolve, 10));
  }
}
for (const cursor of ["c", "after"]) test(`${cursor}: simultaneous missing/null observations share durable delivery and item membership`, async () => {
  const root = await mkdtemp(join(tmpdir(), "s2-cursor-identity-"));
  const factory = fileRangeStore(root), store = factory(), owner = fakeOwner({ seed: true, cursorArg: cursor });
  let release!: () => void, reached!: () => void;
  const delayed = new Promise<void>(resolve => { release = resolve; });
  const requested = new Promise<void>(resolve => { reached = resolve; });
  const client = createClient({ url: "http://cursor.test", persona: "alice", fetch: async (input, init) => {
    if (new URL(String(input)).pathname === "/api/manifest") { reached(); await delayed; }
    return owner.fetch(input, init);
  }, offline: { store: () => store } });
  await requested;
  const callbackArgs: unknown[] = [], membershipArgs: any[] = [];
  const missing = cursor === "after" ? { c: null } : {}, explicit = { ...missing, [cursor]: null };
  const spec = publicItems(api.deliveries.inbox, { table: "messages", select: (row: any) => row.message,
    create: { target: mutationTarget(api.deliveries.post, "messages"),
      belongs: (_write: any, query: any) => { membershipArgs.push(query); return query[cursor] === null; }, draft: (write: any) => write } });
  const declaration = withHistory(spec, { items: publicItems(api.deliveries.thread, { table: "messages", select: (row: any) => row.message }),
    args: (query: any) => {
      callbackArgs.push(query);
      return { conversationId: query[cursor] === null ? "conversation-1" : "wrong", c: null };
    } });
  const observations = [missing, explicit].map(args => client.observe(api.deliveries.inbox, args, { items: declaration }));
  const stops = observations.map(observed => observed.subscribe(() => undefined));
  try {
    assert.deepEqual(callbackArgs, [], "declaration callbacks await delayed cursor metadata");
    release();
    await client.ready;
    await until(() => observations.every(o => o.getSnapshot().items.length === 2), "both page deliveries");
    assert.strictEqual(observations[0].getSnapshot(), observations[1].getSnapshot(), "one shared observation");
    assert.deepEqual(callbackArgs, [explicit, explicit], "history selection sees the normalized declared cursor and unrelated null data");
    await Promise.all([client.query(api.deliveries.inbox, missing), client.query(api.deliveries.inbox, explicit)]).then(results => {
      for (const result of results) assert.equal(result.state, "complete");
    });
    const held = await store.answer("deliveries.inbox", missing);
    assert.deepEqual(await store.answer("deliveries.inbox", explicit), held);
    if (cursor === "after") assert.equal(await store.answer("deliveries.inbox", {}), undefined, "unrelated c: null remains data");
    await client.offline();
    await store.commit({ outbox: { put: [entry({ intent: "cursor-draft", args: { conversationId: "conversation-1", body: "draft" } })] } });
    await until(() => observations.every(o => o.getSnapshot().items.some(item => item.draft)), "canonical membership callbacks");
    assert.ok(membershipArgs.length > 0);
    for (const query of membershipArgs) assert.deepEqual(query, explicit);
    assert.strictEqual(observations[0].getSnapshot(), observations[1].getSnapshot());
  } finally { release(); stops.forEach(stop => stop()); await client.close(); }
  const reopened = factory();
  try {
    await reopened.open("dev:alice");
    assert.deepEqual(await reopened.answer("deliveries.inbox", missing), await reopened.answer("deliveries.inbox", explicit));
    await reopened.close();
    let releaseCold!: () => void;
    const coldMetadata = new Promise<void>(resolve => { releaseCold = resolve; });
    let ready = false;
    const cold = createClient({ url: "http://cursor.test", persona: "alice", offline: { store: factory }, fetch: async (input, init) => {
      if (new URL(String(input)).pathname === "/api/manifest") await coldMetadata;
      return owner.fetch(input, init);
    } });
    void cold.ready.then(() => { ready = true; }).catch(() => {});
    const held = [missing, explicit].map(args => cold.observe(api.deliveries.inbox, args, { items: declaration }));
    const off = held.map(observation => observation.subscribe(() => {}));
    try {
      await until(() => held.every(observation => observation.getSnapshot().items.some(item => item.draft)), "held observations before network readiness");
      assert.equal(ready, false);
      assert.strictEqual(held[0].getSnapshot(), held[1].getSnapshot());
    } finally { releaseCold(); off.forEach(stop => stop()); await cold.close(); }
  } finally { await reopened.close(); await rm(root, { recursive: true, force: true }); }
});
for (const carrier of ["file", "indexeddb"]) test(`${carrier}: four shared observers resolve a no-ID edit only from the displayed target's new image`, async () => {
  const root = await mkdtemp(join(tmpdir(), "snapback-item-evidence-"));
  const store = carrier === "file" ? fileRangeStore(root)()
    : indexedDbRangeStore({ indexedDB: new FakeIndexedDb() as never, locks: new FakeLocks() as never })();
  const owner = fakeOwner({ seed: true, cursorArg: "c" });
  const client = createClient({ url: "http://items.test", persona: "alice", fetch: owner.fetch, offline: { store: () => store } });
  await client.ready;
  const spec = publicItems(api.deliveries.thread, { table: "messages", select: (value: any) => value.message,
    update: { target: mutationTarget(api.deliveries.edit, "messages") } });
  const args = { conversationId: "conversation-1", c: null };
  const observed = Array.from({ length: 4 }, () => client.observe(api.deliveries.thread, args, { items: spec }));
  const once = client.observe(api.deliveries.thread, args, { live: false, items: spec });
  const stops = [...observed, once].map(value => value.subscribe(() => undefined));
  try {
    await client.ready;
    await until(() => observed[0]!.getSnapshot().items.length === 1, "the original target");
    await until(() => once.getSnapshot().items.length === 1, "the one-shot target");
    const onceData = once.getSnapshot().data;
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
    await until(() => once.getSnapshot().items[0]?.pending.length === 1, "work on the one-shot view");
    assert.strictEqual(once.getSnapshot().data, onceData, "ledger refresh does not secretly refresh a one-shot query");
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
    assert.equal(Object.hasOwn(answer!, "selection"), false, "membership metadata stays private to the frame");
    return attachItems(spec, args, answer!.data, capturedInputs(answer)!);
  };
  try {
    await store.open("dev:alice");
    await store.commit({ deliveries: [emptyPage(40)] });
    await store.commit({ outbox: { put: [entry({ order: undefined, state: "committed", response: { seq: 41 } })] } });
    await store.commit({ deliveries: [{ ...emptyPage(42), op: "messages.other", args: {},
      data: { $row: { table: "messages", id: "m" } }, rows: [{ table: "messages", id: "m", row }] }] });
    assert.equal((await items()).length, 1, "the newer pool does not make the old page current");
    await store.commit({ deliveries: [{ ...emptyPage(43),
      rows: [{ table: "messages", id: "anchor", row: { ...row, id: "anchor" } }] }] });
    assert.deepEqual(await items(), [], "the query itself now chooses a page without the committed create");
    await store.commit({ tombstones: [{ table: "messages", id: "anchor", seq: 44 }] });
    assert.equal((await store.answer("deliveries.thread", args))!.state, "partial", "coverage loss invalidates the held answer");
    assert.deepEqual(await items(), [], "coverage loss does not revoke the earlier membership observation");
    await store.close?.(); store = factory(); await store.open("dev:alice");
    assert.deepEqual(await items(), [], "cold reopen cannot resurrect an old success");
    assert.equal((await store.outbox.all()).length, 1, "presentation has not dismissed it");
    for (const [seq, state] of [[45, "partial"], [46, "denied"]] as const) {
      await store.commit({ deliveries: [{ ...emptyPage(seq), state }] });
      assert.deepEqual(await items(), [], `${state} cannot revoke an earlier membership observation`);
      await store.close?.(); store = factory(); await store.open("dev:alice");
      assert.deepEqual(await items(), [], `${state} followed by cold reopen cannot resurrect an old success`);
    }
    await store.commit({ deliveries: [emptyPage(47)] });
    await store.commit({ outbox: { put: [entry({ intent: "equal-baseline", order: undefined, issuedSeq: 47,
      state: "committed", response: { seq: 47 } })] } });
    assert.equal((await items()).length, 1, "an older equal-sequence read precedes admission");
    await store.commit({ deliveries: [emptyPage(47)] });
    assert.equal((await items()).length, 1, "an identical envelope replay cannot manufacture a fresh observation");
    await store.commit({ deliveries: [emptyPage(48)] });
    assert.deepEqual(await items(), [], "a fresh query observation resolves the remaining draft");
  } finally { await store.close?.(); await rm(root, { recursive: true, force: true }); }
});

import { subscribe } from "../src/internal.js";
import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import { api, createClient } from "../dist/client.mjs";
import { multiplexFetch } from "./live-fixture.ts";
import { ClientQueries, composeHistory, defineItems, withHistory } from "../dist/client-observed-test.mjs";
import { fileRangeStore } from "../dist/test.mjs";
import { offlineView } from "../dist/sqlite-test.mjs";

// @ref LLP 1018.006#6-checks — the derivation over every input, then the
// composition's acquisition, retirement, sharing, and identity contract
// against a stub host.

type Row = { id: string; body: string };
const offline = { freshness: { live: false, connection: "offline" }, local: { predicted: [], retained: false } };
const row = (id: string): Row => ({ id, body: id });
const item = (id: string, extra: Record<string, unknown> = {}) => ({ key: id, data: row(id), predicted: false, pending: [], ...extra });
const partial = (data?: unknown, items: unknown[] = []) => ({
  status: data === undefined ? "unavailable" : "ready", ...(data === undefined ? {} : { data }),
  receipt: { state: "partial", source: "twin", seq: 1, next: null, reason: "count" }, ...offline, items,
});
const usable = (verdict: "complete" | "capped") => ({
  status: "ready", data: { messages: [], count: 0, preview: [] }, receipt: { state: verdict, source: "server", seq: 2, next: null },
  ...offline, items: [item("server")],
});
const ready = { status: "ready", data: [], ...offline, items: [item("history")] };

test("the derivation: usable composites own the items, partial ones lend to a readable history, everything else keeps drafts only", () => {
  for (const verdict of ["complete", "capped"] as const) {
    const composed = composeHistory(usable(verdict) as any, ready as any);
    assert.equal(composed.itemsFrom, "query");
    assert.equal(composed.history, undefined, "a usable composite never republishes history");
    assert.equal(composed.items[0]?.key, "server");
  }
  const lent = composeHistory(partial() as any, ready as any);
  assert.equal(lent.itemsFrom, "history");
  assert.equal(lent.items[0]?.key, "history");
  assert.equal(lent.history, ready, "history is the independent input republished as itself");
  for (const history of [{ status: "loading", ...offline, items: [] }, { status: "unavailable", ...offline, items: [], refusal: { code: "E_TEST" } }]) {
    const waiting = composeHistory(partial({ messages: [row("unusable")], count: 0, preview: [] }, [item("unusable")]) as any, history as any);
    assert.equal(waiting.itemsFrom, "drafts", "a partial composite's own rows are never rendered");
    assert.deepEqual(waiting.items, []);
    assert.equal(waiting.history, history, "loading or refused history is still the fallback in force");
  }
  for (const primary of [
    { status: "ready", data: { messages: [row("held")], count: 1, preview: [] }, ...offline, items: [item("held")] },
    { status: "unavailable", receipt: { state: "denied", source: "server", seq: 3, next: null, rule: "r" }, ...offline, items: [] },
    { status: "unavailable", refusal: { code: "E_TEST" }, ...offline, items: [] },
    { status: "loading", ...offline, items: [] },
  ]) {
    const composed = composeHistory(primary as any, ready as any);
    assert.equal(composed.itemsFrom, "drafts", `${primary.status} without a partial receipt is not eligible`);
    assert.equal(composed.history, undefined);
    assert.deepEqual(composed.items, []);
  }
  const both = item("m", { draft: { body: "submitted" }, pending: [{ intent: "i", kind: "create", state: "queued" }] });
  const drafts = composeHistory(partial(undefined, [both, item("plain")]) as any, { status: "loading", ...offline, items: [] } as any);
  assert.deepEqual(drafts.items, [{ key: "m", draft: { body: "submitted" }, predicted: false, pending: both.pending }],
    "a draft beside a row image is republished without the image");
  const again = composeHistory(partial(undefined, [both, item("plain")]) as any, { status: "loading", ...offline, items: [] } as any, drafts as any);
  assert.equal(again.items, drafts.items, "unchanged drafts keep their identity across derivations");
  const second = item("n", { draft: { body: "second" }, pending: [] });
  const two = composeHistory(partial(undefined, [both, second]) as any, { status: "loading", ...offline, items: [] } as any);
  const changed = composeHistory(partial(undefined, [both, { ...second, pending: [{ intent: "j", kind: "create", state: "queued" }] }]) as any,
    { status: "loading", ...offline, items: [] } as any, two as any);
  assert.notEqual(changed.items, two.items);
  assert.equal(changed.items[0], two.items[0], "an untouched sibling keeps its identity when another draft changes");
  assert.notEqual(changed.items[1], two.items[1]);
});

test("withHistory refuses a different table and a second level of custody", () => {
  const path = Symbol.for("snapback.referencePath");
  const ref = (op: string) => ({ op, [path]: op });
  const thread = defineItems(ref("t") as any, { table: "messages", select: (r: any) => r });
  const view = defineItems(ref("v") as any, { table: "messages", rows: (d: any) => d.messages, select: (r: any) => r });
  const other = defineItems(ref("o") as any, { table: "deliveries", select: (r: any) => r });
  assert.throws(() => withHistory(view, { items: other, args: (a: any) => a }), /table deliveries, not messages/);
  const declared = withHistory(view, { items: thread, args: (a: any) => a });
  assert.throws(() => withHistory(declared, { items: thread, args: (a: any) => a }), /already declare/);
  assert.throws(() => withHistory(thread, { items: declared as any, args: (a: any) => a }), /history of its own/);
  assert.equal(declared.history.items, thread);
});

const threadItems = defineItems(api.messages.thread as any, { table: "messages", select: (d: any) => d.message, order: "reverse" });
const conversationItems = withHistory(defineItems(api.messages.conversationView as any, {
  table: "messages", rows: (v: any) => v.messages, select: (d: any) => d.message, order: "reverse",
}), { items: threadItems, args: ({ conversationId }: any) => ({ conversationId, c: null }) });
const viewArgs = { conversationId: "c" }, threadArgs = { conversationId: "c", c: null };

function host() {
  let identity: readonly [number, number] = [1, 1];
  const publishers = new Map<string, (event: any) => void>();
  const queries = new ClientQueries({
    identity: () => identity,
    active: (fence: readonly [number, number]) => fence[0] === identity[0] && fence[1] === identity[1],
    connection: () => "offline",
    open: (ref: any, _args: unknown, listener: (event: any) => void) => {
      publishers.set(ref.op, listener);
      return { close: () => { publishers.delete(ref.op); }, until: async () => { throw new Error("unused"); } };
    },
    query: async () => { throw new Error("unused"); },
    local: async () => { throw new Error("unused"); },
  } as any);
  const publish = (op: string, event: any) => { publishers.get(op)!(event); };
  return { queries, publish, reset: () => { identity = [2, 2]; queries.clear(); }, clear: () => { queries.clear(); } };
}
test("delayed manifest normalizes declared after before identity, items and history selection", async () => {
  let known = false, release!: () => void;
  const metadata = new Promise<void>(resolve => { release = () => { known = true; resolve(); }; });
  const opened: Array<{ op: string; args: any; publish: (event: any) => void }> = [];
  const historyArgs: any[] = [];
  const queries = new ClientQueries({
    cursor: () => known ? "after" : undefined,
    prepare: async () => { await metadata; return "after"; },
    identity: () => [1, 1], active: () => true, connection: () => "offline",
    open: (ref: any, args: any, publish: (event: any) => void) => {
      opened.push({ op: ref.op, args, publish });
      return { close() {}, until: async () => { throw new Error("unused"); } };
    },
    query: async () => { throw new Error("unused"); }, local: async () => { throw new Error("unused"); },
  } as any);
  const items = defineItems(api.messages.inbox as any, { table: "messages", select: (r: any) => r });
  const declared = withHistory(items, { items: defineItems(api.messages.thread as any, { table: "messages", select: (r: any) => r }),
    args: (args: any) => { historyArgs.push(args); return { c: args.c, after: null, selected: args.after === null ? "right" : "wrong" }; } });
  const observed = [{ c: null }, { c: null, after: null }].map(args => queries.observe(api.messages.inbox, args, { items: declared }));
  const stops = observed.map(value => value.subscribe(() => {}));
  try {
    assert.deepEqual(historyArgs, []); assert.deepEqual(opened, []);
    release();
    await new Promise(resolve => setImmediate(resolve));
    assert.equal(opened.length, 1, "only one primary subscription");
    assert.deepEqual(opened[0].args, { c: null, after: null });
    assert.deepEqual(historyArgs, [{ c: null, after: null }, { c: null, after: null }]);
    opened[0].publish({ state: "partial", seq: 1, reason: "count", live: false });
    assert.equal(opened.length, 2, "only one selected history subscription");
    assert.deepEqual(opened[1].args, { c: null, after: null, selected: "right" });
    opened[1].publish({ state: "complete", seq: 1, data: [row("history")], live: false, next: null });
    assert.strictEqual(observed[0].getSnapshot(), observed[1].getSnapshot());
    assert.equal(observed[0].getSnapshot().itemsFrom, "history");
    assert.deepEqual(observed[0].getSnapshot().items.map((item: any) => item.data.id), ["history"]);
  } finally { release(); stops.forEach(stop => stop()); queries.clear(); }
});

const message = { messageId: "m", message: row("m") };

for (const live of [true, false]) test(`public observe live=${live}: failed then recovered manifest cannot retain unnormalized history`, async t => {
  let manifests = 0;
  const opened: Array<{ op: string; args: any }> = [], historyArgs: any[] = [], selected: string[] = [];
  const client = createClient({ url: "http://metadata.test", persona: "alice", fetch: multiplexFetch(async (input, init) => {
    const url = new URL(String(input));
    if (url.pathname === "/api/manifest") {
      if (++manifests === 1) throw new TypeError("manifest connection lost");
      return Response.json({ generation: "g", programGeneration: "p", channels: {}, auth: {}, ops: Object.fromEntries(
        ["messages.inbox", "messages.thread"].map(op => [op, { kind: "query", planHash: op, args: [], cursor: "after" }])) });
    }
    const request = url.pathname === "/api/query" ? JSON.parse(String(init?.body))
      : { op: url.searchParams.get("op"), args: JSON.parse(url.searchParams.get("args")!) };
    opened.push(request);
    const data = request.op === "messages.inbox" ? { state: "partial", seq: 1, reason: "count" }
      : { state: "complete", seq: 1, next: null, data: [row(request.args.selected)] };
    if (!live) return Response.json(data);
    return new Response(new ReadableStream({ start(controller) {
      controller.enqueue(new TextEncoder().encode(`data: ${JSON.stringify(data)}\n\n`));
      init?.signal?.addEventListener("abort", () => controller.close(), { once: true });
    } }), { headers: { "Content-Type": "text/event-stream" } });
  }) });
  const select = (value: Row) => { selected.push(value.id); return value; };
  const declared = withHistory(defineItems(api.messages.inbox as any, { table: "messages", select }), {
    items: defineItems(api.messages.thread as any, { table: "messages", select }),
    args: (args: any) => { historyArgs.push(args); return { c: args.c, after: null, selected: args.after === null ? "right" : "wrong" }; },
  });
  const options = { ...(live ? {} : { live: false as const }), items: declared };
  const failed = client.observe(api.messages.inbox, { c: null }, options);
  let notifications = 0;
  const stops = [failed.subscribe(() => { notifications++; })];
  const waitFor = async (predicate: () => boolean) => {
    const deadline = Date.now() + 2000;
    while (!predicate()) {
      assert.ok(Date.now() < deadline, "observation settles");
      await new Promise(resolve => setTimeout(resolve, 5));
    }
  };
  try {
    await waitFor(() => !!failed.getSnapshot().refusal || failed.getSnapshot().itemsFrom === "history");
    const failedSnapshot = failed.getSnapshot(), failedNotifications = notifications;
    const before = { callbacks: [...historyArgs], selected: [...selected], opened: [...opened] };
    await client.manifest();
    const recovered = [{ c: null }, { c: null, after: null }].map(args => client.observe(api.messages.inbox, args, options));
    stops.push(...recovered.map(observed => observed.subscribe(() => {})));
    await waitFor(() => recovered.every(observed => observed.getSnapshot().itemsFrom === "history"));
    t.diagnostic(JSON.stringify({ live, before, recovered: recovered.map(observed => observed.getSnapshot().items.map(item => item.data?.id)), opened }));
    assert.deepEqual(before, { callbacks: [], selected: [], opened: [] }, "failed metadata invokes no declaration callback and opens no query/history");
    assert.equal(failedSnapshot.status, "unavailable");
    assert.deepEqual([failedSnapshot.refusal?.family, failedSnapshot.refusal?.code, failedSnapshot.refusal?.retryable], ["transport", "E_TRANSPORT", true]);
    assert.equal(failedSnapshot.data, undefined); assert.deepEqual(failedSnapshot.items, []);
    assert.equal(failedSnapshot.history, undefined);
    assert.ok(Object.isFrozen(failedSnapshot) && Object.isFrozen(failedSnapshot.refusal));
    assert.strictEqual(failed.getSnapshot(), failedSnapshot, "failed preparation registers no core for recovered consumers to inherit");
    assert.equal(notifications, failedNotifications, "the refused handle does not receive recovered history");
    assert.deepEqual(historyArgs, [{ c: null, after: null }, { c: null, after: null }]);
    assert.deepEqual(opened, [
      { op: "messages.inbox", args: { c: null, after: null } },
      { op: "messages.thread", args: { c: null, after: null, selected: "right" } },
    ], "one normalized primary and correct history; unrelated c: null stays data");
    assert.strictEqual(recovered[0].getSnapshot(), recovered[1].getSnapshot());
    assert.deepEqual(recovered[0].getSnapshot().items.map(item => item.data?.id), ["right"]);
    assert.ok(selected.length > 0 && selected.every(id => id === "right"));
    assert.equal(manifests, 2);
  } finally { stops.forEach(stop => stop()); await client.close(); }
});

test("retained projections stay partial while their certified page boundary and readable rows survive", async () => {
  const root = await mkdtemp(join(tmpdir(), "snapback2-retained-composite-"));
  const store = fileRangeStore(root)();
  const ref = (id: string) => ({ $row: { table: "messages", id } });
  const image = (id: string) => ({ table: "messages", id, row: row(id) });
  const data = (hidden: boolean) => [
    { position: "first", message: ref("m1") },
    { position: "second", message: hidden ? null : ref("m2") },
  ];
  const receipt = { ranges: [], absences: [], verdicts: [] };
  const { queries, publish } = host();
  const observed = queries.observe(api.messages.conversationView, viewArgs, { items: conversationItems });
  const stop = observed.subscribe(() => undefined);
  try {
    await store.open("alice");
    for (const hidden of [false, true]) await store.commit({ retention: { messages: "delivered-history" }, deliveries: [{
      op: "messages.conversationView", args: viewArgs, state: "capped", seq: hidden ? 11 : 10,
      data: { messages: data(hidden), count: hidden ? 1 : 2, preview: [data(hidden)[1]] },
      next: "composite-page-2", rows: hidden ? [image("m1")] : [image("m1"), image("m2")], receipt,
    }, {
      op: "messages.thread", args: threadArgs, state: "capped", seq: hidden ? 11 : 10,
      data: data(hidden), next: "history-page-2", rows: hidden ? [image("m1")] : [image("m1"), image("m2")], receipt,
    }] });
    const show = async (count: number | null) => {
      const held = await store.answer<any>("messages.conversationView", viewArgs);
      const history = await store.answer<any>("messages.thread", threadArgs);
      assert.equal(held?.state, "partial", "retained old bodies beside a current scalar do not form a certified composite");
      assert.equal(held?.data.count, count);
      assert.equal(offlineView({ ...held!, state: "capped" }, { state: "partial", reason: "never-held", seq: 12 }).state,
        "partial", "an older retained receipt cannot certify its locally altered projection");
      assert.equal(history?.state, "partial", "an altered array projection also loses whole-result completeness");
      assert.equal(history?.next, "history-page-2", "the old certified boundary does not depend on restored scalar fields");
      publish("messages.conversationView", offlineView(held, { state: "partial", reason: "never-held", seq: 12 }));
      publish("messages.thread", offlineView(history, { state: "denied", rule: "MEMBERSHIP_REQUIRED", seq: 12 }));
      const snapshot = observed.getSnapshot();
      assert.equal(snapshot.itemsFrom, "history", "partial custody never lends a retained count to the composite");
      assert.equal(snapshot.receipt?.state, "partial");
      assert.equal(snapshot.receipt?.next, "composite-page-2", "the primary keeps its own boundary, never history's");
      assert.equal(snapshot.history?.status, "ready", "downloaded row bodies remain readable");
      assert.equal(snapshot.history?.receipt?.state, "partial");
      assert.equal(snapshot.history?.receipt?.next, "history-page-2");
      assert.equal(snapshot.history?.local.retained, true);
      assert.equal(snapshot.items.find(item => item.key === "m1")?.data?.body, "m1");
      publish("messages.thread", { state: "partial", data: [], reason: "never-held", seq: 12, live: false, next: "unproved" });
      assert.equal(observed.getSnapshot().history?.receipt?.next, null, "an ordinary local partial cannot introduce a cursor");
    };
    await show(1);
    await store.commit({ tombstones: [{ table: "messages", id: "m2", seq: 12 }] });
    await show(null);
    await store.close?.(); await store.open("alice");
    await show(null);
    const repairedRow = { position: "first", message: row("m1") };
    const repaired = { state: "capped" as const, data: { messages: [repairedRow], count: 1, preview: [repairedRow] }, next: null, seq: 13 };
    publish("messages.conversationView", offlineView(await store.answer("messages.conversationView", viewArgs), repaired));
    assert.equal(observed.getSnapshot().itemsFrom, "query", "an exact local reconstruction restores usable composite data");
    assert.equal(observed.getSnapshot().data?.count, 1);
    assert.equal(observed.getSnapshot().history, undefined);
  } finally { stop(); await store.close?.(); await rm(root, { recursive: true, force: true }); }
});

test("the composition acquires history at subscribe time, releases it on a usable composite, and shares one object", () => {
  const { queries, publish } = host();
  const view = api.messages.conversationView, thread = api.messages.thread;
  const composed = queries.observe(view, viewArgs, { items: conversationItems });
  assert.equal(queries.consumers(view, viewArgs), 0, "obtaining a composition opens nothing");
  assert.equal(composed.getSnapshot().itemsFrom, "drafts");
  const seen: string[] = [];
  const stop = composed.subscribe(() => { seen.push(composed.getSnapshot().itemsFrom); });
  assert.equal(queries.consumers(view, viewArgs), 1);
  assert.equal(queries.consumers(thread, threadArgs), 0, "a loading composite is not eligible");
  publish("messages.conversationView", { state: "partial", live: true, seq: 1, reason: "count" });
  assert.equal(queries.consumers(thread, threadArgs), 1, "a partial receipt acquires history in the same notification");
  assert.equal(composed.getSnapshot().history?.status, "loading");
  assert.equal(composed.getSnapshot().itemsFrom, "drafts");
  publish("messages.thread", { state: "complete", live: true, seq: 1, next: null, data: [message] });
  assert.equal(composed.getSnapshot().itemsFrom, "history");
  assert.equal(composed.getSnapshot().items[0]?.key, "m");
  const before = composed.getSnapshot();
  assert.equal(composed.getSnapshot(), before, "identity is stable between input changes");
  const notified = seen.length;
  publish("messages.thread", { state: "complete", live: true, seq: 1, next: null, data: [message] });
  assert.equal(composed.getSnapshot(), before, "an identical history republication changes nothing");
  assert.equal(seen.length, notified, "and notifies nobody");
  publish("messages.conversationView", { state: "complete", live: true, seq: 2, next: null, data: { messages: [message], count: 1, preview: [message] } });
  assert.equal(queries.consumers(thread, threadArgs), 0, "a usable composite releases history and retires its entry");
  assert.equal(composed.getSnapshot().itemsFrom, "query");
  assert.equal(composed.getSnapshot().history, undefined);
  publish("messages.conversationView", { state: "partial", live: true, seq: 3, reason: "count" });
  assert.equal(queries.consumers(thread, threadArgs), 1, "a later partial reacquires history");
  assert.deepEqual(seen, ["drafts", "history", "query", "drafts"]);

  const other = queries.observe(view, viewArgs, { items: conversationItems });
  assert.equal(other.getSnapshot(), composed.getSnapshot(), "a second handle reads the held composition's record");
  const second = other.subscribe(() => undefined);
  assert.equal(queries.consumers(view, viewArgs), 1, "two consumers share one composite subscription");
  const unrelated = queries.observe(thread, threadArgs, { items: threadItems }).subscribe(() => undefined);
  publish("messages.conversationView", { state: "complete", live: true, seq: 4, next: null, data: { messages: [], count: 0, preview: [] } });
  assert.equal(queries.consumers(thread, threadArgs), 1, "the composition releases only its own history subscription");
  unrelated();
  second(); stop(); stop();
  assert.equal(queries.consumers(view, viewArgs), 0);
  assert.equal(queries.consumers(thread, threadArgs), 0);
  assert.equal(queries.observe(view, viewArgs, { items: conversationItems }).getSnapshot().itemsFrom, "drafts", "a released composition is not retained; a new handle reads fallbacks");
});

test("handles created before any subscribe join one composition, in either cleanup order", () => {
  for (const order of ["first-then-second", "second-then-first"] as const) {
    const { queries, publish } = host();
    const view = api.messages.conversationView, thread = api.messages.thread;
    const first = queries.observe(view, viewArgs, { items: conversationItems });
    const second = queries.observe(view, viewArgs, { items: conversationItems });
    const stopFirst = first.subscribe(() => undefined);
    const stopSecond = second.subscribe(() => undefined);
    assert.equal(queries.consumers(view, viewArgs), 1, `${order}: two handles share one composite subscription`);
    publish("messages.conversationView", { state: "partial", live: true, seq: 1, reason: "count" });
    assert.equal(queries.consumers(thread, threadArgs), 1, `${order}: and one history subscription`);
    assert.equal(first.getSnapshot(), second.getSnapshot(), `${order}: both handles read one record`);
    (order === "first-then-second" ? stopFirst : stopSecond)();
    assert.equal(queries.consumers(view, viewArgs), 1, `${order}: the remaining consumer keeps the composition`);
    assert.equal(queries.consumers(thread, threadArgs), 1);
    (order === "first-then-second" ? stopSecond : stopFirst)();
    assert.equal(queries.consumers(view, viewArgs), 0, `${order}: the last consumer releases everything`);
    assert.equal(queries.consumers(thread, threadArgs), 0);
  }
});

test("each subscription is its own attachment, listeners are isolated, and a listener removed mid-broadcast does not run", () => {
  const { queries, publish } = host();
  const view = api.messages.conversationView;
  const composed = queries.observe(view, viewArgs, { items: conversationItems });
  const calls: string[] = [];
  const shared = () => { calls.push("shared"); };
  const stopA = composed.subscribe(shared);
  const stopB = composed.subscribe(shared);
  stopA();
  assert.equal(queries.consumers(view, viewArgs), 1, "the second subscription of the same callback survives the first's close");
  publish("messages.conversationView", { state: "partial", live: true, seq: 1, reason: "count" });
  assert.deepEqual(calls, ["shared"]);
  let stopLate: () => void = () => undefined;
  const stopThrowing = composed.subscribe(() => { stopLate(); throw new Error("listener failure"); });
  stopLate = composed.subscribe(() => { calls.push("late"); });
  const stopAfter = composed.subscribe(() => { calls.push("after"); });
  publish("messages.conversationView", { state: "partial", live: true, seq: 2, reason: "count" });
  assert.deepEqual(calls, ["shared", "shared", "after"], "a throwing listener silences nobody; a listener removed during the broadcast does not run");
  stopB(); stopThrowing(); stopAfter(); stopB();
  assert.equal(queries.consumers(view, viewArgs), 0);
});

test("clear() retires registered compositions with and without an authority change, and a fresh handle opens again", () => {
  for (const change of [false, true]) {
    const { queries, publish, reset, clear } = host();
    const view = api.messages.conversationView, thread = api.messages.thread;
    const composed = queries.observe(view, viewArgs, { items: conversationItems });
    const states: string[] = [];
    composed.subscribe(() => { states.push(composed.getSnapshot().status); });
    publish("messages.conversationView", { state: "partial", live: true, seq: 1, reason: "count" });
    assert.equal(queries.consumers(thread, threadArgs), 1);
    if (change) reset(); else clear();
    assert.equal(queries.consumers(view, viewArgs), 0, `clear(change=${change}) released the composition's subscriptions`);
    assert.equal(queries.consumers(thread, threadArgs), 0);
    assert.equal(composed.getSnapshot().status, "loading", "a retired handle reads the underlying fallback");
    assert.equal(states.at(-1), "loading", "retirement notified the consumer once");
    assert.equal(composed.subscribe(() => undefined)(), undefined);
    assert.equal(queries.consumers(view, viewArgs), 0, "a retired handle opens nothing");
    const fresh = queries.observe(view, viewArgs, { items: conversationItems });
    const stop = fresh.subscribe(() => undefined);
    assert.equal(queries.consumers(view, viewArgs), 1, `a fresh handle after clear(change=${change}) opens the composite again`);
    stop();
  }
});

test("a composition subscribed to an already-partial composite acquires history at once; remount and reset behave", () => {
  const { queries, publish, reset } = host();
  const view = api.messages.conversationView, thread = api.messages.thread;
  const raw = queries.observe(view, viewArgs).subscribe(() => undefined);
  publish("messages.conversationView", { state: "partial", live: true, seq: 1, reason: "count" });
  const composed = queries.observe(view, viewArgs, { items: conversationItems });
  assert.equal(queries.consumers(thread, threadArgs), 0);
  const stop = composed.subscribe(() => undefined);
  assert.equal(queries.consumers(thread, threadArgs), 1, "no later change is needed to acquire history");
  stop();
  const remount = composed.subscribe(() => undefined);
  assert.equal(queries.consumers(view, viewArgs), 2, "StrictMode-style resubscription leaves one composite subscription");
  assert.equal(queries.consumers(thread, threadArgs), 1);
  reset();
  assert.equal(composed.getSnapshot().status, "loading", "a fence change shows through as the underlying fallback");
  assert.equal(composed.getSnapshot().itemsFrom, "drafts");
  assert.equal(composed.getSnapshot().history, undefined);
  remount(); raw();
});

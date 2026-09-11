import { subscribe } from "../src/internal.js";
import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import { api, createClient } from "../dist/client.mjs";
import { multiplexFetch } from "./live-fixture.ts";
import { ClientPages, ClientQueries, composeHistory, defineItems, withHistory } from "../dist/client-observed-test.mjs";
import { withItemInputs } from "../dist/image-runtime.mjs";
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

// @ref LLP 1018.008.005.000#ordering-and-pending-work — original page images
// retain their own evidence while one chain chooses display order and custody.
function pageFixture(cursors: Record<string, string> = { "messages.conversationView": "c", "messages.thread": "c" }) {
  const cells = new Map<string, { snapshot: any; listeners: Set<() => void> }>();
  const opens: Array<{ op: string; args: any; close: boolean }> = [];
  let active = true;
  const key = (op: string, cursor: unknown) => JSON.stringify([op, cursor ?? null]);
  const cell = (op: string, cursor: unknown) => {
    const id = key(op, cursor);
    if (!cells.has(id)) cells.set(id, { snapshot: { status: "loading", next: null, ...offline, items: [] }, listeners: new Set() });
    return cells.get(id)!;
  };
  const host = {
    cursor: (op: string) => cursors[op], active: () => active, connection: () => "offline",
    observe(ref: any, args: any) {
      const current = cell(ref.op, args[cursors[ref.op]]);
      return { getSnapshot: () => current.snapshot, subscribe(notify: () => void) {
        const opened = { op: ref.op, args, close: false }; opens.push(opened); current.listeners.add(notify);
        return () => { opened.close = true; current.listeners.delete(notify); };
      } };
    },
  };
  const publish = (op: string, cursor: unknown, snapshot: any) => {
    const current = cell(op, cursor);
    current.snapshot = snapshot;
    for (const notify of [...current.listeners]) notify();
  };
  const snapshot = (ids: Array<string | number>, next: string | null, options: any = {}) => Object.freeze({
    status: "ready", data: ids.map(id => row(String(id))), next,
    receipt: { state: next ? "capped" : "complete", source: "server", seq: 1, next }, ...offline,
    items: ids.map(id => item(String(id))), ...options,
  });
  return { host, opens, cell, publish, snapshot, deactivate: () => { active = false; } };
}

test("item pages undo page reversal, choose whole first images, and union durable drafts across the valid prefix", () => {
  const f = pageFixture(), binding = defineItems(api.messages.thread as any, { table: "messages", order: "reverse" });
  const pages = new ClientPages(f.host as any, api.messages.thread, {}, { items: binding });
  assert.equal(f.opens.length, 0, "constructing and reading a page resource starts no subscription");
  assert.strictEqual(pages.getSnapshot(), pages.getSnapshot());
  const stop = pages.subscribe(() => {});
  const draft = (id: string, intent: string) => ({ key: id, draft: { body: id }, predicted: false,
    pending: [{ intent, kind: "create", state: "committed", label: "Sent", dismissible: false }] });
  const d1 = draft("draft-first", "inbox:8"), d2 = draft("draft-second", "i2");
  const entries = [{ intent: "i2", order: 20 }, { intent: "i1", inbox: 8, order: 10 }];
  const framed = (page: any) => withItemInputs(page, { entries, observations: new Map(), predicted: new Map() });
  const first9 = item("9", { data: { id: "9", body: "first image" }, pending: [{ intent: "edit-9", kind: "update", state: "committed" }] });
  const head = framed(f.snapshot([7, 8, 9], "a", { items: [item("7"), item("8"), first9, d2, draft("1", "create-1")],
    data: { messages: [], count: 99, preview: [] } }));
  f.publish("messages.thread", null, head);
  pages.getSnapshot().loadMore();
  f.publish("messages.thread", "a", framed(f.snapshot([4, 5, 6], "b", { items: [item("4"), item("5"), item("6"), d1, d2] })));
  pages.getSnapshot().loadMore();
  const last = f.snapshot([1, 2, 3], null, { items: [item("1"), item("2"), item("3"), item("9", { data: { id: "9", body: "later image" } })] });
  f.publish("messages.thread", "b", last);
  const current = pages.getSnapshot();
  assert.deepEqual(current.items.map((value: any) => value.key), ["1", "2", "3", "4", "5", "6", "7", "8", "9", "draft-first", "draft-second"]);
  assert.strictEqual(current.items[8], first9, "a later observed duplicate cannot retire the selected image's update");
  assert.strictEqual(current.items[9], d1, "a draft missing from the head still survives from a valid deeper page");
  assert.equal(current.items[0].draft, undefined, "a materialized page-three row beats a page-one draft");
  assert.strictEqual(current.head, head); assert.strictEqual(current.pages[2], last);
  assert.equal(current.head.data.count, 99, "the SDK never computes summary authority from visible rows");
  assert.equal("receipt" in current, false); assert.equal("seq" in current, false);
  const unchanged = pages.getSnapshot(); assert.strictEqual(unchanged, current);
  stop(); assert.ok(f.opens.every(open => open.close));
});

for (const reverse of [false, true]) test(`three original pages preserve ${reverse ? "reverse" : "forward"} scan order`, () => {
  const f = pageFixture(), binding = defineItems(api.messages.thread as any, { table: "messages", ...(reverse ? { order: "reverse" } : {}) });
  const resource = new ClientPages(f.host as any, api.messages.thread, {}, { items: binding });
  const stop = resource.subscribe(() => {});
  for (const [index, raw] of [[9, 8, 7], [6, 5, 4], [3, 2, 1]].entries()) {
    f.publish("messages.thread", index ? String(index) : null, f.snapshot(reverse ? [...raw].reverse() : raw, index < 2 ? String(index + 1) : null));
    if (index < 2) resource.getSnapshot().loadMore();
  }
  assert.deepEqual(resource.getSnapshot().items.map((value: any) => Number(value.key)), reverse ? [1, 2, 3, 4, 5, 6, 7, 8, 9] : [9, 8, 7, 6, 5, 4, 3, 2, 1]);
  stop();
});

test("changed continuations discard the suffix before publication, ignore late frames, and retain unchanged links", () => {
  const f = pageFixture(), resource = new ClientPages(f.host as any, api.messages.thread, {});
  const stop = resource.subscribe(() => {});
  f.publish("messages.thread", null, f.snapshot([9, 8, 7], "a")); resource.getSnapshot().loadMore();
  f.publish("messages.thread", "a", f.snapshot([6, 5, 4], "b")); resource.getSnapshot().loadMore();
  f.publish("messages.thread", "b", f.snapshot([3, 2, 1], null));
  const opens = f.opens.length;
  f.publish("messages.thread", null, f.snapshot([10, 8, 7], "a"));
  assert.equal(f.opens.length, opens, "an unrelated edit with the same cursor never reopens pages");
  const late = [...f.cell("messages.thread", "b").listeners];
  f.publish("messages.thread", null, f.snapshot([10, 9, 8], "new-a"));
  assert.deepEqual(resource.getSnapshot().items.map((value: Row) => value.id), ["10", "9", "8"]);
  assert.equal(resource.getSnapshot().status, "loading");
  const waiting = f.opens.length;
  resource.getSnapshot().loadMore(); resource.getSnapshot().loadMore(); assert.equal(f.opens.length, waiting);
  assert.ok(f.opens.filter(open => ["a", "b"].includes(open.args.c)).every(open => open.close));
  f.publish("messages.thread", "b", f.snapshot(["abandoned"], null)); late.forEach(notify => notify());
  assert.deepEqual(resource.getSnapshot().items.map((value: Row) => value.id), ["10", "9", "8"]);
  f.publish("messages.thread", "new-a", f.snapshot([7, 6, 5], "new-b"));
  f.publish("messages.thread", "new-b", f.snapshot([4, 3, 2], null));
  assert.equal(resource.getSnapshot().pages.length, 3, "replacement retains requested depth");
  f.publish("messages.thread", "new-b", f.snapshot([], null, { status: "unavailable", data: undefined, reason: { code: "refused", message: "no" } }));
  assert.equal(resource.getSnapshot().status, "unavailable"); assert.equal(resource.getSnapshot().reason.code, "refused");
  assert.equal(resource.getSnapshot().items.length, 6, "a refused tail leaves only the valid readable prefix");
  stop();
});

test("history handover preserves depth with independent normalized cursors and releases ineligible observations", () => {
  const f = pageFixture({ "messages.conversationView": "after", "messages.thread": "before" });
  const mapped: any[] = [];
  const history = defineItems(api.messages.thread as any, { table: "messages" });
  const binding = withHistory(defineItems(api.messages.conversationView as any, { table: "messages", rows: (value: any) => value.messages }), {
    items: history, args: (args: any) => { mapped.push(args); return { conversationId: args.conversationId, before: null }; },
  });
  const resource = new ClientPages(f.host as any, api.messages.conversationView, { conversationId: "chat", c: "unrelated" }, { items: binding });
  const stop = resource.subscribe(() => {});
  f.publish("messages.conversationView", null, f.snapshot([9], "p1")); resource.getSnapshot().loadMore();
  f.publish("messages.conversationView", "p1", f.snapshot([8], "p2")); resource.getSnapshot().loadMore();
  f.publish("messages.conversationView", "p2", f.snapshot([7], null));
  assert.deepEqual(mapped, [{ conversationId: "chat", c: "unrelated", after: null }]);
  f.publish("messages.conversationView", null, f.snapshot([], null, { status: "unavailable", data: undefined,
    receipt: { state: "partial", source: "twin", seq: 2, next: null }, reason: { code: "partial", message: "count missing" } }));
  assert.equal(resource.getSnapshot().itemsFrom, "drafts"); assert.equal(resource.getSnapshot().head.data, undefined);
  assert.ok(f.opens.filter(open => open.args.after != null).every(open => open.close));
  const historyHead = f.snapshot([3], "h1"); f.publish("messages.thread", null, historyHead);
  assert.equal(resource.getSnapshot().itemsFrom, "history");
  assert.equal(resource.getSnapshot().status, "loading");
  f.publish("messages.thread", "h1", f.snapshot([2], "h2")); f.publish("messages.thread", "h2", f.snapshot([1], null));
  assert.deepEqual(resource.getSnapshot().items.map((value: any) => value.key), ["3", "2", "1"]);
  assert.strictEqual(resource.getSnapshot().history, historyHead);
  for (const open of f.opens.filter(open => open.op === "messages.thread")) {
    assert.ok("before" in open.args); assert.equal("after" in open.args, false); assert.equal("c" in open.args, false);
  }
  f.publish("messages.conversationView", null, f.snapshot([10], "q1"));
  assert.equal(resource.getSnapshot().itemsFrom, "query"); assert.equal(resource.getSnapshot().history, undefined);
  assert.ok(f.opens.filter(open => open.op === "messages.thread").every(open => open.close));
  f.publish("messages.conversationView", "q1", f.snapshot([9], "q2")); f.publish("messages.conversationView", "q2", f.snapshot([8], null));
  assert.equal(resource.getSnapshot().pages.length, 3); assert.equal(mapped.length, 1);
  f.publish("messages.conversationView", null, f.snapshot([], null, { status: "unavailable", data: undefined,
    receipt: { state: "denied", source: "server", seq: 4, next: null } }));
  assert.equal(resource.getSnapshot().itemsFrom, "drafts"); assert.deepEqual(resource.getSnapshot().items, []);
  assert.equal(resource.getSnapshot().history, undefined);
  stop(); f.deactivate();
  assert.equal(resource.getSnapshot().head.data, undefined); assert.deepEqual(resource.getSnapshot().items, []);
});

test("a pure getter cannot suppress the pending publication to an attached page consumer", () => {
  const f = pageFixture(), resource = new ClientPages(f.host as any, api.messages.thread, {});
  let notified = 0;
  f.cell("messages.thread", null).listeners.add(() => { resource.getSnapshot(); });
  const stop = resource.subscribe(() => { notified++; });
  const before = notified;
  f.publish("messages.thread", null, f.snapshot([1], null));
  assert.equal(notified, before + 1);
  stop();
});

test("a headless subscriber can load the next page from the capped publication without waiting for another frame", () => {
  const f = pageFixture(), resource = new ClientPages(f.host as any, api.messages.thread, {});
  const stop = resource.subscribe(() => {
    const snapshot = resource.getSnapshot();
    if (snapshot.status === "ready" && snapshot.hasMore) snapshot.loadMore();
  });
  f.publish("messages.thread", null, f.snapshot([3, 2], "tail"));
  assert.deepEqual(f.opens.map(open => open.args.c), [null, "tail"], "loadMore during notification opens its page in the same refresh");
  f.publish("messages.thread", "tail", f.snapshot([1], null));
  assert.deepEqual(resource.getSnapshot().items.map((value: Row) => value.id), ["3", "2", "1"]);
  stop();
});

test("page metadata preparation is lazy, independently normalized, and cannot open a retired history", async () => {
  const f = pageFixture({ "messages.conversationView": "after", "messages.thread": "before" });
  const known = new Map<string, string>(), resolving = new Map<string, (cursor: string) => void>();
  const prepared: string[] = [], mapped: any[] = [];
  const host = { ...f.host, cursor: (op: string) => known.get(op), prepare: (op: string) => {
    prepared.push(op); return new Promise<string>(resolve => resolving.set(op, cursor => { known.set(op, cursor); resolve(cursor); }));
  } };
  const declared = withHistory(defineItems(api.messages.conversationView as any, { table: "messages", rows: (value: any) => value.messages }), {
    items: defineItems(api.messages.thread as any, { table: "messages" }),
    args: (args: any) => { mapped.push(args); return { before: null, conversationId: args.conversationId }; },
  });
  const resource = new ClientPages(host as any, api.messages.conversationView, { conversationId: "chat", c: null }, { items: declared });
  resource.getSnapshot(); resource.getSnapshot(); assert.deepEqual(prepared, []); assert.deepEqual(mapped, []);
  const stop = resource.subscribe(() => {});
  assert.deepEqual(prepared, ["messages.conversationView"]); assert.deepEqual(f.opens, []);
  resolving.get("messages.conversationView")!("after"); await new Promise(resolve => setImmediate(resolve));
  assert.deepEqual(mapped, [{ conversationId: "chat", c: null, after: null }]);
  assert.deepEqual(f.opens[0].args, mapped[0]);
  f.publish("messages.conversationView", null, f.snapshot([], null, { status: "unavailable", data: undefined,
    receipt: { state: "partial", source: "twin", seq: 2, next: null } }));
  assert.deepEqual(prepared, ["messages.conversationView", "messages.thread"]);
  resource.retire(); resolving.get("messages.thread")!("before"); await new Promise(resolve => setImmediate(resolve));
  assert.equal(f.opens.length, 1, "late metadata cannot acquire an abandoned history");
  assert.deepEqual(resource.getSnapshot().items, []); stop();
});

test("ClientQueries shares raw primary page subscriptions without opening nested declared histories", () => {
  let active = true;
  const opened: Array<{ op: string; args: any; publish: (event: any) => void; closed: boolean }> = [];
  const queries = new ClientQueries({ identity: () => [1, 1], active: () => active, cursor: () => "c", connection: () => "offline",
    open(ref: any, args: any, publish: (event: any) => void) { const record = { op: ref.op, args, publish, closed: false }; opened.push(record);
      return { close: () => { record.closed = true; }, until: async () => { throw new Error("unused"); } }; },
    query: async () => { throw new Error("unused"); }, local: async () => { throw new Error("unused"); },
  } as any);
  const resources = [queries.observePages(api.messages.conversationView, viewArgs, { items: conversationItems }),
    queries.observePages(api.messages.conversationView, viewArgs, { items: conversationItems })];
  assert.deepEqual(opened, []); resources.forEach(resource => resource.getSnapshot()); assert.deepEqual(opened, []);
  const stops = resources.map(resource => resource.subscribe(() => {}));
  assert.equal(opened.length, 1);
  opened[0].publish({ state: "partial", seq: 1, reason: "count", live: false });
  assert.equal(opened.length, 2, "one independent history head for both page handles");
  opened[1].publish({ state: "capped", seq: 1, data: [{ message: row("9") }], next: "h1", live: false });
  resources.forEach(resource => resource.getSnapshot().loadMore());
  assert.equal(opened.length, 3, "both handles reuse each underlying page");
  opened[2].publish({ state: "complete", seq: 1, data: [{ message: row("8") }], next: null, live: false });
  for (const resource of resources) assert.deepEqual(resource.getSnapshot().items.map((value: any) => value.key), ["8", "9"]);
  stops[0](); assert.ok(opened.every(open => !open.closed));
  active = false; queries.clear();
  assert.ok(opened.every(open => open.closed));
  for (const resource of resources) { assert.deepEqual(resource.getSnapshot().items, []); assert.equal(resource.getSnapshot().history, undefined); }
  stops[1]();
});

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
    for (const hidden of [false, true]) await store.commit({ schema: { tables: { messages: { retain: "delivered-history" } } }, deliveries: [{
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

for (const paged of [false, true]) test(`${paged ? "page" : "query"} composition hides settled rows while history reacquires independent authority`, () => {
  const { queries, publish } = host();
  const composed = paged ? queries.observePages(api.messages.conversationView, viewArgs, { items: conversationItems })
    : queries.observe(api.messages.conversationView, viewArgs, { items: conversationItems });
  const stop = composed.subscribe(() => {});
  const data = { messages: [message], count: 1, preview: [message] };
  publish("messages.conversationView", { state: "partial", live: true, seq: 1, data, next: null });
  publish("messages.thread", { state: "complete", live: true, seq: 1, data: [message], next: null });
  assert.equal(composed.getSnapshot().itemsFrom, "history");
  assert.equal(composed.getSnapshot().items[0]?.data.body, "m");
  publish("messages.conversationView", { state: "capped", live: true, seq: 2, data, next: null });
  assert.equal(composed.getSnapshot().itemsFrom, "query");
  assert.equal(queries.consumers(api.messages.thread, threadArgs), 0, "usable primary releases the last history consumer");
  publish("messages.conversationView", { state: "partial", live: true, seq: 3, data, next: null });
  const loading = composed.getSnapshot();
  assert.equal(loading.itemsFrom, "drafts");
  assert.equal(loading.history?.status, "loading");
  assert.deepEqual(loading.items, [], "the settled row has no draft; neither partial primary nor detached history authorizes its image");
  assert.equal((loading.head ?? loading).data, undefined, "history cannot preserve scalar authority either");
  const renewed = { ...message, message: { ...message.message, body: "fresh history" } };
  publish("messages.thread", { state: "complete", live: true, seq: 3, data: [renewed], next: null });
  const restored = composed.getSnapshot();
  assert.equal(restored.itemsFrom, "history");
  assert.deepEqual(restored.items.map((item: any) => [item.key, item.data.body]), [["m", "fresh history"]]);
  assert.equal(restored.history?.receipt?.seq, 3, "restoration uses the newly acquired history's own receipt");
  stop();
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

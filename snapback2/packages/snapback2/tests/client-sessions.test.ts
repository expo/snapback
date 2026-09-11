import { sharedConsumers, subscribe } from "../src/internal.js";
import assert from "node:assert/strict";
import { test } from "node:test";
import React from "react";
import TestRenderer, { act } from "react-test-renderer";
import { api } from "../dist/client.mjs";
import { RefusalError, isRefusalError } from "../dist/client-observed-test.mjs";
import { indexedDbRangeStore, SnapbackProvider, useQuery } from "../dist/react.mjs";
import { ClientQueries, DrainSubscription, SharedSubscriptions, TabFollower } from "../dist/client-observed-test.mjs";
import { fixtureClient as createClient } from "./live-fixture.ts";
import { fakeOwner } from "./fake-owner.ts";
import { FakeIndexedDb, FakeLocks } from "./fake-indexeddb.ts";

(globalThis as any).IS_REACT_ACT_ENVIRONMENT = true;

async function until(condition: () => Promise<boolean> | boolean, what: string, timeoutMs = 5_000): Promise<void> {
  const deadline = Date.now() + timeoutMs;
  while (!(await condition())) {
    if (Date.now() > deadline) throw new Error(`timed out waiting for ${what}`);
    await new Promise<void>((resolve) => setTimeout(resolve, 10));
  }
}

const observedVerdict = (snapshot: any): string => snapshot.refusal !== undefined
  ? "refused" : snapshot.receipt?.state ?? snapshot.status;

class MemoryBroadcastChannel {
  static members = new Map<string, Set<MemoryBroadcastChannel>>();
  static messages: any[] = [];
  static drop: (message: any) => boolean = () => false;
  static throwOn: (message: any) => boolean = () => false;
  onmessage?: (event: { data: unknown }) => void;
  readonly name: string;
  constructor(name: string) {
    this.name = name;
    const members = MemoryBroadcastChannel.members.get(name) ?? new Set();
    members.add(this); MemoryBroadcastChannel.members.set(name, members);
  }
  postMessage(message: unknown) {
    const copy = structuredClone(message);
    if (MemoryBroadcastChannel.throwOn(copy)) throw new Error("transport publication failed");
    MemoryBroadcastChannel.messages.push(copy);
    if (MemoryBroadcastChannel.drop(copy)) return;
    MemoryBroadcastChannel.deliver(this.name, copy, this);
  }
  static deliver(name: string, message: unknown, sender?: MemoryBroadcastChannel) {
    for (const peer of MemoryBroadcastChannel.members.get(name) ?? []) if (peer !== sender) {
      queueMicrotask(() => peer.onmessage?.({ data: structuredClone(message) }));
    }
  }
  close() { MemoryBroadcastChannel.members.get(this.name)?.delete(this); }
}

test("two React queries read one client-owned snapshot and release it by refcount", async () => {
  let opens = 0;
  const fetch = async (input: string | URL | Request) => {
    const path = new URL(String(input)).pathname;
    if (path === "/api/manifest") return new Response(JSON.stringify({
      generation: "test", programGeneration: "program", ops: {}, channels: {}, auth: {},
    }), { headers: { "content-type": "application/json" } });
    if (path === "/api/subscribe") {
      opens += 1;
      const bytes = new TextEncoder().encode(`data: ${JSON.stringify({
        state: "complete", data: [{ id: "message-1" }], seq: 1, next: null,
      })}\n\n`);
      return new Response(new ReadableStream({ start(controller) { controller.enqueue(bytes); } }),
        { headers: { "content-type": "text/event-stream" } });
    }
    throw new Error(`unexpected route ${path}`);
  };
  const client = createClient({ url: "http://react-observed.test", persona: "alice", fetch });
  await client.ready;
  const args = { conversationId: "general" };
  let first: any, second: any;
  function First() { first = useQuery(api.messages.thread, args); return null; }
  function Second() { second = useQuery(api.messages.thread, args); return null; }
  let renderer: TestRenderer.ReactTestRenderer;
  await act(async () => {
    renderer = TestRenderer.create(React.createElement(SnapbackProvider, { client },
      React.createElement(React.Fragment, null, React.createElement(First), React.createElement(Second))));
    await new Promise(resolve => setTimeout(resolve, 20));
  });
  assert.equal(first.receipt?.state, "complete"); assert.equal(second.receipt?.state, "complete");
  assert.strictEqual(first.data, second.data, "both hooks select the same client-owned value");
  assert.equal(opens, 1); assert.equal(sharedConsumers(client, api.messages.thread, args), 2);
  await act(async () => { renderer!.unmount(); });
  assert.equal(sharedConsumers(client, api.messages.thread, args), 0);
  await client.close();
});

test("a delayed predecessor follower failure cannot stop its successor route", async () => {
  const predecessor = Promise.withResolvers<void>(), successor = Promise.withResolvers<void>();
  let route = "none", stops = 0, failures = 0;
  const follower = new TabFollower({
    runtime: () => ({
      follow: (principal: string) => principal === "predecessor" ? predecessor.promise : successor.promise,
      followed: () => undefined,
      reauthenticate: async () => undefined,
    }),
    closed: () => false,
    inherited: () => undefined,
    writer: async (principal: string) => { route = `writer:${principal}`; },
    following: (principal: string) => { route = `follower:${principal}`; },
    stopped: () => { stops += 1; route = "stopped"; },
    admitInherited: async () => undefined,
    takeover: async () => "authority",
    drain: () => undefined,
    failed: () => { failures += 1; },
  });
  follower.begin("predecessor", true, 1);
  follower.stop();
  follower.begin("successor", true, 2);
  predecessor.reject(new Error("late predecessor open failure"));
  await new Promise(resolve => setTimeout(resolve, 0));
  assert.equal(route, "follower:successor");
  assert.equal(stops, 1, "only the explicit predecessor withdrawal stops its route");
  assert.equal(failures, 0, "obsolete failure evidence is not published into the successor");
  successor.resolve();
  await until(() => route === "writer:successor", "the successor writer route");
});

test("a newer direct delivery fences a delayed local refresh and until sees later local revisions", async () => {
  type Event = { revision: number; source: "local" | "server" };
  const shared = new SharedSubscriptions();
  let publish!: (event: Event) => void;
  let refreshRuns = 0;
  let releaseFirst!: () => void;
  let markFirstStarted!: () => void;
  const firstStarted = new Promise<void>((resolve) => { markFirstStarted = resolve; });
  const firstRelease = new Promise<void>((resolve) => { releaseFirst = resolve; });
  const heard: Event[] = [];
  const spec = {
    key: "revision-race",
    initial: { revision: 0 },
    reduce: (current: { revision: number }, event: Event) => current.revision === event.revision
      ? current : { revision: event.revision },
    open: (listener: (event: Event) => void) => {
      publish = listener;
      return {
        close: () => undefined,
        until: async () => { throw new Error("shared until delegated to its transport"); },
      };
    },
    refresh: async (): Promise<Event> => {
      refreshRuns += 1;
      if (refreshRuns === 1) {
        markFirstStarted();
        await firstRelease;
        return { revision: 1, source: "local" };
      }
      return { revision: refreshRuns, source: "local" };
    },
  };
  const subscription = shared.attach(spec, (event: Event) => { heard.push(event); });
  shared.refresh();
  await firstStarted;
  publish({ revision: 2, source: "server" });
  releaseFirst();
  await until(() => refreshRuns === 2, "the current local evaluation after the stale one was fenced");
  assert.deepEqual(heard, [{ revision: 2, source: "server" }], "the stale local result never overwrites the direct delivery");

  const predicted = subscription.until((event: Event) => event.revision === 3 && event.source === "local", 500);
  shared.refresh();
  assert.deepEqual(await predicted, { revision: 3, source: "local" });
  assert.deepEqual(heard.at(-1), { revision: 3, source: "local" });
  subscription.close();
});

test("a current local reevaluation refusal publishes while an obsolete-authority failure is fenced", async () => {
  const refusal = () => new RefusalError({
    code: "E_OFFLINE_CARRIER", family: "offline", message: "local store failed", guide: "offline",
  });
  let identity: readonly [number, number] = [1, 1];
  let publish!: (event: any) => void;
  let local = async () => { throw refusal(); };
  const queries = new ClientQueries({
    identity: () => identity,
    active: (fence: readonly [number, number]) => fence[0] === identity[0] && fence[1] === identity[1],
    connection: () => "connected",
    open: (_ref: unknown, _args: unknown, listener: (event: any) => void) => {
      publish = listener;
      return { close: () => undefined, until: async () => { throw new Error("must use shared until"); } };
    },
    query: async () => { throw new Error("unused"); },
    local: () => local(),
  } as any);
  const args = { term: "wel", c: null };
  const observed = queries.observe(api.messages.search, args);
  const raw = queries.subscribe(api.messages.search, args, () => undefined);
  const stop = observed.subscribe(() => undefined);
  publish({ state: "complete", live: true, data: [], next: null, seq: 1 });
  const waiting = raw.until(() => false, 1_000);
  queries.refresh();
  await assert.rejects(waiting, (error: unknown) => isRefusalError(error) && error.code === "E_OFFLINE_CARRIER");
  await until(() => observed.getSnapshot().refusal?.code === "E_OFFLINE_CARRIER", "the shared local refusal snapshot");
  assert.equal((observed.getSnapshot() as any).refusal.code, "E_OFFLINE_CARRIER");
  raw.close(); stop();

  let failObsolete!: () => void;
  let markStarted!: () => void;
  const started = new Promise<void>((resolve) => { markStarted = resolve; });
  const delayed = new Promise<void>((resolve) => { failObsolete = resolve; });
  local = async () => { markStarted(); await delayed; throw refusal(); };
  const old = queries.observe(api.messages.search, { term: "old", c: null });
  const states: string[] = [];
  const stopOld = old.subscribe(() => { states.push(old.getSnapshot().receipt?.state ?? old.getSnapshot().status); });
  publish({ state: "complete", live: true, data: [], next: null, seq: 2 });
  queries.refresh();
  await started;
  identity = [2, 2];
  queries.clear();
  failObsolete();
  await new Promise<void>((resolve) => setTimeout(resolve, 20));
  assert.equal(old.getSnapshot().status, "loading");
  assert.deepEqual(states.slice(-2), ["complete", "loading"], "obsolete local failure published no refusal");
  stopOld();
});

test("a one-shot auth resume retries only after its in-flight read reports no held answer", async () => {
  const first = Promise.withResolvers<any>(), second = Promise.withResolvers<any>();
  let calls = 0;
  const queries = new ClientQueries({
    identity: () => [1, 1] as const,
    active: () => true,
    connection: () => "offline",
    open: () => { throw new Error("unused"); },
    query: () => ++calls === 1 ? first.promise : second.promise,
    local: async () => { throw new Error("unused"); },
  } as any);
  const observed = queries.observe(api.messages.inbox, { c: null }, { live: false });
  const stop = observed.subscribe(() => undefined);
  assert.equal(calls, 1);

  queries.resumeHydrating();
  assert.equal(calls, 1, "confirmation does not overlap the pending one-shot");
  first.resolve({ state: "hydrating", live: false, connection: "offline" });
  await until(() => calls === 2, "the queued no-held retry");
  assert.equal(observed.getSnapshot().reason?.code, "offline");
  second.resolve({ state: "complete", data: [], next: null, seq: 1 });
  await until(() => observed.getSnapshot().receipt?.state === "complete", "the resumed owner answer");
  assert.equal(calls, 2);
  stop();

  let heldCalls = 0;
  const heldQueries = new ClientQueries({
    identity: () => [1, 1] as const,
    active: () => true,
    connection: () => "offline",
    open: () => { throw new Error("unused"); },
    query: async () => { heldCalls += 1; return { state: "held", live: false, connection: "offline", data: [], next: null, seq: 1 }; },
    local: async () => { throw new Error("unused"); },
  } as any);
  const held = heldQueries.observe(api.messages.inbox, { c: null }, { live: false });
  const stopHeld = held.subscribe(() => undefined);
  await until(() => held.getSnapshot().reason?.code === "held", "the held one-shot answer");
  heldQueries.resumeHydrating();
  await new Promise<void>(resolve => setImmediate(resolve));
  assert.equal(heldCalls, 1, "confirmation preserves a held one-shot without refreshing it");
  stopHeld();
});

test("a live indexed query preserves its authoritative state until its effective value changes", async () => {
  let publish!: (event: any) => void;
  let local: { state: "held" | "complete" | "capped" | "partial"; live: false; connection: "offline"; data: Array<{ id: string }>;
    next: null; seq: number; reason?: string } = {
    state: "held", live: false, connection: "offline", data: [{ id: "server" }], next: null, seq: 2,
  };
  const queries = new ClientQueries({
    identity: () => [1, 1] as const,
    active: () => true,
    connection: () => "connected",
    open: (_ref: unknown, _args: unknown, listener: (event: any) => void) => {
      publish = listener;
      return { close: () => undefined, until: async () => { throw new Error("must use shared until"); } };
    },
    query: async () => { throw new Error("unused"); },
    local: async () => local,
  } as any);
  const observed = queries.observe(api.messages.search, { term: "café", c: null });
  const stop = observed.subscribe(() => undefined);
  publish({ state: "complete", live: true, data: [{ id: "server" }], next: null, seq: 1 });
  const authoritative = observed.getSnapshot();
  queries.refresh();
  await new Promise<void>((resolve) => setTimeout(resolve, 20));
  assert.strictEqual(observed.getSnapshot(), authoritative, "an unrelated store commit does not replace complete with held");

  local = { ...local, state: "complete" };
  queries.refresh();
  await until(() => observed.getSnapshot().receipt?.seq === 2, "the changed local receipt sequence");
  assert.equal(observed.getSnapshot().receipt?.source, "twin", "equal data does not hide a changed receipt sequence");
  publish({ state: "complete", live: true, data: [{ id: "server" }], next: null, seq: 1 });
  local = { ...local, state: "capped" };
  queries.refresh();
  await until(() => observed.getSnapshot().receipt?.state === "capped", "the changed local completeness");
  assert.equal(observed.getSnapshot().receipt?.source, "twin", "equal data does not hide a changed local verdict");
  local = { ...local, state: "partial", reason: "missing-authority" };
  queries.refresh();
  await until(() => observed.getSnapshot().receipt?.state === "partial", "the local partial verdict");
  assert.equal(observed.getSnapshot().reason?.code, "partial", "equal data does not hide local uncertainty");

  publish({ state: "complete", live: true, data: [{ id: "server" }], next: null, seq: 1 });
  local = { state: "held", live: false, connection: "offline", data: [{ id: "predicted" }], next: null, seq: 2 };
  queries.refresh();
  await until(() => (observed.getSnapshot() as any).data?.[0]?.id === "predicted", "the local indexed revision");
  assert.equal(observed.getSnapshot().status, "ready");
  assert.equal(observed.getSnapshot().reason?.code, "held");
  assert.equal(observed.getSnapshot().freshness.live, true);
  assert.deepEqual(observed.getSnapshot().data, [{ id: "predicted" }]);

  local = { ...local, data: [{ id: "server" }] };
  queries.refresh();
  await until(() => observed.getSnapshot().receipt?.state === "complete", "settlement returns to the authoritative value");
  stop();
});

test("new local prediction and revocation remain visible under an older held answer sequence", async () => {
  let publish!: (event: any) => void;
  let connection: "connected" | "reconnecting" | "offline" = "connected";
  let local = { state: "capped", live: false, connection: "offline", seq: 7, next: null,
    data: { messages: [{ id: "predicted", message: { id: "message" } }], count: 3, preview: [] },
    predicted: [{ table: "messages", id: "message", intent: "intent" }] };
  const queries = new ClientQueries({
    identity: () => [1, 1] as const,
    active: () => true,
    connection: () => connection,
    open: (_ref: unknown, _args: unknown, listener: (event: any) => void) => {
      publish = listener;
      return { close: () => undefined, until: async () => { throw new Error("must use shared until"); } };
    },
    query: async () => { throw new Error("unused"); },
    local: async () => local,
  } as any);
  const observed = queries.observe(api.messages.conversationView, { conversationId: "conversation-1" });
  const stop = observed.subscribe(() => undefined);
  publish({ state: "capped", live: true, seq: 8, next: null,
    data: { messages: [{ id: "server", message: { id: "server" } }], count: 2, preview: [] } });
  assert.equal(observed.getSnapshot().receipt?.source, "server", "the owner delivery keeps owner provenance");
  queries.refresh();
  await until(() => observed.getSnapshot().local.predicted[0]?.intent === "intent", "older-sequence prediction");
  assert.equal(observed.getSnapshot().receipt?.source, "twin",
    "a twin evaluation stays twin-authored while the transport remains live");
  const twinData = observed.getSnapshot().data;
  connection = "reconnecting";
  queries.reproject();
  assert.equal(observed.getSnapshot().freshness.connection, "reconnecting");
  assert.equal(observed.getSnapshot().receipt?.source, "twin", "transport reprojection does not rewrite evaluation provenance");
  assert.strictEqual(observed.getSnapshot().data, twinData, "transport reprojection keeps value identity");
  connection = "connected";
  queries.reproject();
  assert.equal((observed.getSnapshot() as any).data.count, 3,
    "owner sequence is not a carrier revision fence for a new overlay");

  local = { state: "capped", live: false, connection: "offline", seq: 7, next: null,
    data: { messages: [{ id: "removed", message: null }], count: 2, preview: [] }, predicted: [] } as any;
  queries.refresh();
  await until(() => (observed.getSnapshot() as any).data.messages[0].message === null, "older-sequence revocation");
  assert.equal(observed.getSnapshot().receipt?.source, "twin");
  assert.equal((observed.getSnapshot() as any).data.count, 2,
    "a newer local revocation cannot be hidden behind a newer owner sequence");
  stop();
});

test("a drain local refresh cannot claim caught-up before its mark finishes", async () => {
  let publish!: (event: any) => void;
  let localData = [{ id: "persisted-page" }];
  const queries = new ClientQueries({
    identity: () => [1, 1] as const,
    active: () => true,
    connection: () => "connected",
    open: (_ref: unknown, _args: unknown, listener: (event: any) => void) => {
      publish = listener;
      return { close: () => undefined, until: async () => { throw new Error("must use shared until"); } };
    },
    query: async () => { throw new Error("unused"); },
    local: async () => ({ state: "held", live: false, connection: "offline", data: localData,
      next: null, seq: 2, caughtUp: true, watermark: "persisted" }),
  } as any);
  const subscription = queries.subscribe(api.messages.inbox, { c: null }, () => undefined, { drain: true });
  let settled = false;
  const caught = subscription.until((event: any) => event.caughtUp === true, 2_000).then(value => {
    settled = true; return value;
  });
  queries.refresh();
  await new Promise<void>((resolve) => setTimeout(resolve, 20));
  assert.equal(settled, false, "the persisted page cannot outrun watermark/grant admission");
  publish({ state: "complete", live: true, data: localData, next: null, seq: 2, caughtUp: true, watermark: "persisted" });
  assert.equal((await caught as any).caughtUp, true, "the drain's own marked delivery settles caught-up");

  localData = [{ id: "predicted-page" }];
  queries.refresh();
  await new Promise<void>((resolve) => setTimeout(resolve, 20));
  assert.equal((await subscription.until((event: any) => event.data?.[0]?.id === "predicted-page", 2_000) as any).caughtUp, true,
    "later local value revisions retain the completed drain lifecycle");
  subscription.close();
});

test("a drain reconnect during page or mark startup fences the predecessor and starts once", async () => {
  for (const delayed of ["page", "mark"] as const) {
    const gate = Promise.withResolvers<void>();
    let queries = 0, marks = 0, tails = 0;
    const events: any[] = [];
    const drain = new DrainSubscription<any, any>({
      args: { c: null },
      query: async () => {
        queries += 1;
        if (delayed === "page" && queries === 1) await gate.promise;
        return { state: "complete", data: [queries], next: null, seq: queries };
      },
      subscribe: () => { tails += 1; return { close: () => undefined, until: async () => { throw new Error("unused"); } }; },
      mark: async () => { marks += 1; if (delayed === "mark" && marks === 1) await gate.promise; },
      onEvent: (event) => events.push(event),
    });
    await until(() => delayed === "page" ? queries === 1 : marks === 1, `${delayed} predecessor start`);
    drain.reconnect();
    await until(() => delayed === "page" ? queries === 2 : marks === 2, `${delayed} successor start`);
    gate.resolve();
    await until(() => events.length === 1, `${delayed} successor delivery`);
    assert.deepEqual(events[0].data, [2], `${delayed} predecessor cannot publish after reconnect`);
    assert.equal(tails, 1, `${delayed} reconnect creates one successor tail`);
    drain.close();
  }
});

/** Counts logical subscription children the multiplexed transport adds, and direct query pages. */
function counting(owner: ReturnType<typeof fakeOwner>) {
  const counts = { subscribes: 0, queries: 0 };
  const fetch = async (input: string | URL | Request, init?: RequestInit): Promise<Response> => {
    const url = String(input);
    // The multiplexed transport forwards each logical child as one upstream subscribe.
    if (url.includes("/api/subscribe")) counts.subscribes += 1;
    if (url.includes("/api/query")) counts.queries += 1;
    return owner.fetch(input, init);
  };
  return { counts, fetch };
}

// @ref LLP 1018#3-move-one-one-coherent-reactive-client — two consumers of one
// query share one stream and one current delivery; the last close releases it.
test("identical live subscriptions share one stream, one delivery, and one mounted record", async () => {
  const owner = fakeOwner({ seed: true });
  const { counts, fetch } = counting(owner);
  const client = createClient({ url: "http://shared.test", persona: "alice", fetch });
  await client.ready;
  const args = { conversationId: "conversation-1", c: null };
  const first = subscribe(client, api.messages.thread, args, () => undefined);
  const second = subscribe(client, api.messages.thread, args, () => undefined);
  const [a, b] = await Promise.all([
    first.until((event) => event.state === "complete", 2_000),
    second.until((event) => event.state === "complete", 2_000),
  ]);
  assert.equal(a.seq, b.seq);
  assert.equal(counts.subscribes, 1, "the second consumer attaches to the first consumer's stream");
  assert.equal(sharedConsumers(client, api.messages.thread, args), 2);

  // A late consumer sees the current delivery without asking the owner again.
  const seen: string[] = [];
  const third = subscribe(client, api.messages.thread, args, (event) => { seen.push(event.state); });
  await new Promise<void>((resolve) => setTimeout(resolve, 20));
  assert.deepEqual(seen, ["complete"]);
  assert.equal(counts.subscribes, 1);
  assert.equal(sharedConsumers(client, api.messages.thread, args), 3);

  // Closing duplicates leaves the survivor on the same stream.
  first.close();
  third.close();
  assert.equal(sharedConsumers(client, api.messages.thread, args), 1);
  assert.equal(counts.subscribes, 1);
  const again = await second.until((event) => event.state === "complete", 2_000);
  assert.equal(again.seq, a.seq);

  // The last close releases the entry; the next consumer opens a fresh stream.
  second.close();
  assert.equal(sharedConsumers(client, api.messages.thread, args), 0);
  const fresh = subscribe(client, api.messages.thread, args, () => undefined);
  await fresh.until((event) => event.state === "complete", 2_000);
  assert.equal(counts.subscribes, 2);
  fresh.close();

  // Different arguments never share.
  const other = subscribe(client, api.messages.thread, { conversationId: "conversation-2", c: null }, () => undefined);
  await other.until((event) => event.state === "complete", 2_000);
  assert.equal(counts.subscribes, 3);
  assert.equal(sharedConsumers(client, api.messages.thread, args), 0);
  other.close();
  await client.close();
});

test("observed queries are lazy and share one snapshot and source with raw subscribers", async () => {
  const owner = fakeOwner({ seed: true });
  const { counts, fetch } = counting(owner);
  const client = createClient({ url: "http://observed.test", persona: "alice", fetch });
  await client.ready;
  const args = { conversationId: "conversation-1", c: null };
  const lateArgs = { ...args };
  const lateOptions: any = {};
  const first = client.observe(api.messages.thread, lateArgs, lateOptions);
  const second = client.observe(api.messages.thread, args);
  lateArgs.conversationId = "conversation-2";
  lateOptions.live = false;
  lateOptions.drain = true;

  assert.strictEqual(first.getSnapshot(), first.getSnapshot(), "an unused observer has one stable hydrating snapshot");
  assert.equal(first.getSnapshot().status, "loading");
  assert.equal(counts.subscribes, 0, "obtaining an observer opens no transport");
  assert.equal(sharedConsumers(client, api.messages.thread, args), 0, "an unused observer retains no entry");

  const seen: string[] = [];
  const stopFirst = first.subscribe(() => { seen.push(`first:${observedVerdict(first.getSnapshot())}`); });
  const stopSecond = second.subscribe(() => { seen.push(`second:${observedVerdict(second.getSnapshot())}`); });
  await until(() => first.getSnapshot().receipt?.state === "complete", "the observed delivery");
  assert.strictEqual(first.getSnapshot(), second.getSnapshot(), "both observers own the same immutable snapshot");
  assert.ok((first.getSnapshot() as any).data.every((row: any) => row.conversationId === "conversation-1"),
    "late attach uses the arguments and mode captured when observe returned");
  assert.equal(counts.subscribes, 1);
  assert.equal(sharedConsumers(client, api.messages.thread, args), 2);

  const notifications = seen.length;
  let raw: any, mutationBlocked = false;
  const subscription = subscribe(client, api.messages.thread, args, (event) => {
    raw = event;
    try { (event as any).data[0].conversationId = "consumer mutation"; }
    catch (error) { mutationBlocked = error instanceof TypeError; }
  });
  await until(() => raw?.state === "complete", "the current raw delivery replay");
  assert.strictEqual(raw.data, (first.getSnapshot() as any).data, "raw and observed consumers share the current value");
  assert.equal(mutationBlocked, true, "one raw consumer cannot mutate the shared publication");
  assert.equal((second.getSnapshot() as any).data[0].conversationId, "conversation-1");
  assert.ok(Object.isFrozen(second.getSnapshot()) && Object.isFrozen((second.getSnapshot() as any).data)
    && Object.isFrozen((second.getSnapshot() as any).data[0]), "the whole public snapshot is frozen");
  assert.equal(seen.length, notifications, "blocked consumer mutation publishes no phantom notification");
  assert.equal(counts.subscribes, 1, "the raw subscriber reused the observed source");
  assert.equal(sharedConsumers(client, api.messages.thread, args), 3);

  (subscription as typeof subscription & { reset(): void }).reset();
  assert.equal(first.getSnapshot().status, "loading", "program reset synchronously forgets predecessor data");
  assert.equal(seen.at(-2), "first:loading");
  assert.equal(seen.at(-1), "second:loading");
  await until(() => first.getSnapshot().receipt?.state === "complete", "the successor delivery");
  assert.equal(counts.subscribes, 2, "program reset reopens the one shared source");

  stopFirst();
  subscription.close();
  assert.equal(sharedConsumers(client, api.messages.thread, args), 1);
  stopSecond();
  assert.equal(sharedConsumers(client, api.messages.thread, args), 0);
  assert.ok(seen.includes("first:complete") && seen.includes("second:complete"));
  await client.close();
});

test("closing a client retires an observed authority snapshot before later delivery", async () => {
  const owner = fakeOwner({ seed: true });
  const { counts, fetch } = counting(owner);
  const client = createClient({ url: "http://observed-reset.test", persona: "alice", fetch });
  await client.ready;
  const observed = client.observe(api.messages.thread, { conversationId: "conversation-1", c: null });
  const unused = client.observe(api.messages.thread, { conversationId: "conversation-unused", c: null });
  const states: string[] = [];
  const stop = observed.subscribe(() => { states.push(observedVerdict(observed.getSnapshot())); });
  await until(() => observed.getSnapshot().receipt?.state === "complete", "the predecessor snapshot");
  await client.close();
  assert.equal(observed.getSnapshot().status, "loading", "retirement forgot the predecessor value");
  assert.deepEqual(states.slice(-2), ["complete", "loading"]);
  const opened = counts.subscribes;
  const stopRetired = observed.subscribe(() => assert.fail("a retired observer notified again"));
  const stopUnused = unused.subscribe(() => assert.fail("an unused old-authority observer notified"));
  assert.equal(counts.subscribes, opened, "old observers cannot reopen transport after retirement");
  assert.strictEqual(unused.getSnapshot(), unused.getSnapshot(), "the unused retired view keeps one fallback");
  stopRetired();
  stopUnused();
  stop();
});

test("account open and wipe retire the old headless query snapshot through the authority fence", async () => {
  const database = new FakeIndexedDb(), locks = new FakeLocks();
  const carrier = indexedDbRangeStore({ indexedDB: database as any, locks: locks as any });
  const owner = fakeOwner({ seed: true, cursorArg: "c" });
  let token: string | null = null;
  const client = createClient({
    url: "http://observed-account-reset.test",
    tokenStore: { load: () => token, save: (next) => { token = next; } },
    fetch: (input, init) => new URL(String(input)).pathname === "/api/auth/logout"
      ? Promise.resolve(new Response(JSON.stringify({ ok: true }), { status: 200, headers: { "content-type": "application/json" } }))
      : owner.fetch(input, init),
    offline: { store: carrier },
  });
  await client.ready;
  await client.auth.login({ email: "alice@example.test", password: "correct horse" });
  const observed = client.observe(api.messages.thread, { conversationId: "conversation-1", c: null });
  const states: string[] = [];
  const stop = observed.subscribe(() => { states.push(observedVerdict(observed.getSnapshot())); });
  await until(() => observed.getSnapshot().receipt?.state === "complete", "the authenticated account query");
  await client.auth.logout();
  assert.equal(observed.getSnapshot().status, "loading", "the wiped account cannot remain visible");
  assert.deepEqual(states.slice(-2), ["complete", "loading"]);
  const staleStop = observed.subscribe(() => assert.fail("the wiped authority observer reopened"));
  staleStop(); stop();
  await client.close();
});

// @ref LLP 1018#3-move-one-one-coherent-reactive-client — a committed local
// overlay revision publishes one shared prediction; settlement rolls it back
// without waiting for a transport frame, while grant bookkeeping stays silent.
test("mounted query snapshots follow committed prediction and settlement revisions", async () => {
  const database = new FakeIndexedDb(), locks = new FakeLocks();
  const carrier = indexedDbRangeStore({ indexedDB: database as any, locks: locks as any });
  const physical = carrier();
  const owner = fakeOwner({ seed: true, cursorArg: "c" });
  const client = createClient({ url: "http://local-revision.test", persona: "alice", fetch: owner.fetch,
    offline: { store: () => physical } });
  await client.ready;
  const args = { conversationId: "conversation-1", c: null };
  const first = client.observe(api.messages.thread, args);
  const second = client.observe(api.messages.thread, args);
  let firstNotifies = 0, secondNotifies = 0;
  const stopFirst = first.subscribe(() => { firstNotifies += 1; });
  const stopSecond = second.subscribe(() => { secondNotifies += 1; });
  await until(() => first.getSnapshot().receipt?.state === "complete", "the held thread");
  await new Promise<void>((resolve) => setTimeout(resolve, 20));
  assert.strictEqual(first.getSnapshot(), second.getSnapshot());
  assert.deepEqual([firstNotifies, secondNotifies], [1, 1], "the delivery's store commit does not publish a duplicate snapshot");
  assert.equal(first.getSnapshot().receipt?.source, "server", "an equal local store evaluation retains the owner's receipt");
  const initial = (first.getSnapshot() as any).data[0].message;
  const onlineData = first.getSnapshot().data;
  const beforeOffline = firstNotifies;
  await client.offline();
  await until(() => first.getSnapshot().freshness.connection === "offline", "the mounted offline view");
  assert.strictEqual(first.getSnapshot(), second.getSnapshot());
  assert.strictEqual(first.getSnapshot().data, onlineData, "connection-only publication preserves shared data identity");
  assert.equal(firstNotifies, beforeOffline + 1, "connection-only publication notifies the shared observers once");
  const intent = "local-prediction";
  const entry = {
    intent, grant: "test-grant", offset: 0, count: 1, ids: ["predicted-id"],
    op: "messages.edit", args: { messageId: initial.id, body: "Predicted edit" }, issuedSeq: 5,
    state: "queued" as const, predicted: true, trace: { points: [], verdicts: [] }, createdAt: 10, updatedAt: 10,
  };
  const raw = subscribe(client, api.messages.thread, args, () => undefined);
  const rawPrediction = raw.until((event) => (event as any).predicted?.some((row: { intent: string }) => row.intent === intent), 2_000);
  const beforePrediction = firstNotifies;
  await physical.commit({ outbox: { put: [entry] }, overlay: { put: { [intent]: [{
    table: "messages", id: initial.id, row: { ...initial, body: "Predicted edit" }, fields: ["body"],
  }] } } });
  await until(() => first.getSnapshot().local.predicted.some((row) => row.intent === intent), "the shared local prediction");
  assert.equal((first.getSnapshot() as any).data[0].message.body, "Predicted edit");
  assert.equal((await rawPrediction as any).data[0].message.body, "Predicted edit",
    "imperative until observes the same committed local prediction");
  assert.strictEqual(first.getSnapshot(), second.getSnapshot(), "both consumers publish the same predicted snapshot");
  assert.equal(firstNotifies, beforePrediction + 1);
  assert.equal(secondNotifies, firstNotifies);

  const beforeBookkeeping = firstNotifies;
  await physical.commit({ grants: { put: [{ id: "bookkeeping", from: "s2id-0000000000000000000000000000000a-0000000000001000",
    count: 8, mintedAt: 10, expiresAt: 20, used: 0 }], current: "bookkeeping" } });
  await new Promise<void>((resolve) => setTimeout(resolve, 20));
  assert.equal(firstNotifies, beforeBookkeeping, "grant bookkeeping does not reevaluate a query");

  await physical.commit({ outbox: { put: [{ ...entry, state: "rejected", predicted: false, updatedAt: 11 }] } });
  await until(() => (first.getSnapshot() as any).data?.[0]?.message?.body === "Welcome", "prediction settlement rollback");
  assert.deepEqual(first.getSnapshot().local.predicted, []);
  assert.strictEqual(first.getSnapshot(), second.getSnapshot(), "settlement is one coherent shared snapshot");
  assert.equal(firstNotifies, beforeBookkeeping + 1);
  assert.equal(secondNotifies, firstNotifies);
  raw.close(); stopFirst(); stopSecond();
  await client.close();
});

test("identical drains share one page walk and one tail", async () => {
  const owner = fakeOwner({ seed: true, cursorArg: "c" });
  const { counts, fetch } = counting(owner);
  const client = createClient({ url: "http://shared-drain.test", persona: "alice", fetch });
  await client.ready;
  const first = subscribe(client, api.messages.inbox, { c: null }, () => undefined, { drain: true });
  const second = subscribe(client, api.messages.inbox, { c: null }, () => undefined, { drain: true });
  const [a, b] = await Promise.all([
    first.until((event) => event.state === "complete" && event.caughtUp === true, 2_000),
    second.until((event) => event.state === "complete" && event.caughtUp === true, 2_000),
  ]);
  assert.equal(a.seq, b.seq);
  assert.equal(counts.queries, 1, "one page walk serves both drains");
  await until(() => counts.subscribes >= 1, "the shared tail");
  assert.equal(counts.subscribes, 1, "one tail serves both drains");
  assert.equal(sharedConsumers(client, api.messages.inbox, { c: null }, true), 2);
  await client.offline(); await client.online();
  await until(() => counts.subscribes >= 2, "the drain tail after reconnect");
  assert.equal(counts.subscribes, 2, "the shared drain reopens exactly one tail after a transport cut");
  first.close();
  second.close();
  assert.equal(sharedConsumers(client, api.messages.inbox, { c: null }, true), 0);
  await client.close();
});

// @ref LLP 1018#3-move-one-one-coherent-reactive-client — the browser tab policy:
// a second tab of the same account reads live, refuses writes with a named
// writer's durable outbox, and inherits that partition when the writer closes.
test("a second web tab follows the writer and inherits its queue when the writer closes", async () => {
  const database = new FakeIndexedDb();
  const locks = new FakeLocks();
  const store = indexedDbRangeStore({ indexedDB: database as any, locks: locks as any });
  const owner = fakeOwner({ seed: true, cursorArg: "c" });
  const writer = createClient({ url: "http://tabs.test", persona: "alice", fetch: owner.fetch, offline: { store } });
  await writer.ready;
  // The writer earns its replay grant through the recipe's drain.
  const inbox = subscribe(writer, api.messages.inbox, { c: null }, () => undefined, { drain: true });
  await inbox.until((event) => event.state === "complete" && event.caughtUp === true, 2_000);
  await until(async () => (await writer.outbox.status()).ready, "the writer's grant");

  const follower = createClient({ url: "http://tabs.test", persona: "alice", fetch: owner.fetch, offline: { store } });
  await follower.ready;
  await until(async () => (await follower.outbox.status(api.messages.send)).ready, "the follower's writer admission");
  const read = await follower.query(api.messages.thread, { conversationId: "conversation-1", c: null });
  assert.equal(read.state, "complete", "a follower reads live");
  const forwarded = await follower.mutation(api.messages.send, { conversationId: "conversation-1", body: "from the follower" });
  assert.equal(forwarded.state, "queued", "the follower's row is durable before its result");
  assert.match(forwarded.intent, /^inbox:\d+$/, "a follower's result names its inbox row (LLP 1018.004 §1)");
  const fromFollower = (execution: { args: unknown }) => (execution.args as any).body === "from the follower";
  await until(() => owner.executions.some(fromFollower), "the admitted row's replay");
  assert.equal(owner.executions.filter(fromFollower).length, 1);

  await writer.offline();
  const queued = await writer.mutation(api.messages.send, { conversationId: "conversation-1", body: "queued in the writer tab" });
  assert.equal(queued.state, "queued");
  inbox.close();
  await writer.close();

  // The lock passes to the follower: it opens the partition and replays the inherited intent.
  await until(() => !(follower as any).offlineRuntime.following, "the follower marker clearing after takeover");
  await until(() => owner.executions.some((execution) => execution.intent === queued.intent), "the inherited replay");
  assert.equal(owner.executions.filter((execution) => execution.intent === queued.intent).length, 1);
  const after = await follower.mutation(api.messages.send, { conversationId: "conversation-1", body: "from the new writer" });
  assert.equal(after.state, "committed");
  await follower.close();
});

test("a follower that closes withdraws its wait, so the next tab becomes the writer", async () => {
  const database = new FakeIndexedDb();
  const locks = new FakeLocks();
  const store = indexedDbRangeStore({ indexedDB: database as any, locks: locks as any });
  const owner = fakeOwner({ seed: true });
  const writer = createClient({ url: "http://tabs-close.test", persona: "alice", fetch: owner.fetch, offline: { store } });
  await writer.ready;
  const follower = createClient({ url: "http://tabs-close.test", persona: "alice", fetch: owner.fetch, offline: { store } });
  await follower.ready;
  assert.notEqual((await follower.outbox.status()).reason, "follower", "a forwarding-capable follower reports writer readiness");
  await follower.close();
  await writer.close();
  const next = createClient({ url: "http://tabs-close.test", persona: "alice", fetch: owner.fetch, offline: { store } });
  await next.ready;
  assert.notEqual((await next.outbox.status()).reason, "follower", "the closed follower did not take the lock");
  await next.close();
});

test("two attachments sharing one callback function are two consumers", async () => {
  const owner = fakeOwner({ seed: true });
  const { counts, fetch } = counting(owner);
  const client = createClient({ url: "http://same-callback.test", persona: "alice", fetch });
  await client.ready;
  const args = { conversationId: "conversation-1", c: null };
  let calls = 0;
  const listener = () => { calls += 1; };
  const first = subscribe(client, api.messages.thread, args, listener);
  const second = subscribe(client, api.messages.thread, args, listener);
  await second.until((event) => event.state === "complete", 2_000);
  assert.equal(sharedConsumers(client, api.messages.thread, args), 2);
  first.close();
  assert.equal(sharedConsumers(client, api.messages.thread, args), 1, "closing one attachment keeps the other");
  assert.ok(calls >= 1, "the shared callback heard the delivery");
  const again = await second.until((event) => event.state === "complete", 2_000);
  assert.equal(again.state, "complete", "the surviving attachment still reads the shared stream");
  assert.equal(counts.subscribes, 1);
  second.close();
  assert.equal(sharedConsumers(client, api.messages.thread, args), 0);
  await client.close();
});

test("a follower's drain pages and tails live and earns no grant of its own", async () => {
  const database = new FakeIndexedDb();
  const locks = new FakeLocks();
  const store = indexedDbRangeStore({ indexedDB: database as any, locks: locks as any });
  const owner = fakeOwner({ seed: true, cursorArg: "c" });
  const writer = createClient({ url: "http://tabs-drain.test", persona: "alice", fetch: owner.fetch, offline: { store } });
  await writer.ready;
  const follower = createClient({ url: "http://tabs-drain.test", persona: "alice", fetch: owner.fetch, offline: { store } });
  await follower.ready;
  assert.notEqual((await follower.outbox.status()).reason, "follower", "forwarding availability replaces the hard follower refusal");
  const inbox = subscribe(follower, api.messages.inbox, { c: null }, () => undefined, { drain: true });
  const caughtUp = await inbox.until((event) => event.state === "complete" && event.caughtUp === true, 3_000);
  assert.equal(caughtUp.live, false);
  assert.equal(owner.grantsMinted(), 0, "a follower earns no grant of its own");
  inbox.close();
  await follower.close();
  await writer.close();
});

// The restored bearer tab: hydration opens the bound principal and starts following;
// confirming the session opens the same principal again, which must keep the wait.
test("a restored bearer second tab follows instead of refusing its own session", async () => {
  const database = new FakeIndexedDb();
  const locks = new FakeLocks();
  const store = indexedDbRangeStore({ indexedDB: database as any, locks: locks as any });
  const owner = fakeOwner({ seed: true, meEpoch: 7 });
  const custody = () => {
    let token: string | null = "token-a";
    let binding: { token: string; principal: string } | null = { token, principal: "dev:alice" };
    return { load: () => token, save: (value: string | null) => { token = value; },
      loadPrincipalBinding: () => binding,
      savePrincipal: (principal: string | null, bearer?: string) => { binding = principal && bearer ? { token: bearer, principal } : null; } };
  };
  const writer = createClient({ url: "http://tabs-bearer.test", tokenStore: custody(), fetch: owner.fetch, offline: { store } });
  await writer.ready;
  await until(() => writer.snapshot.auth.state === "authenticated", "the writer's session");
  const follower = createClient({ url: "http://tabs-bearer.test", tokenStore: custody(), fetch: owner.fetch, offline: { store } });
  await follower.ready;
  await until(() => follower.snapshot.auth.state !== "hydrating", "the follower's restoration");
  assert.equal(follower.snapshot.auth.state, "authenticated", `follower auth: ${JSON.stringify(follower.snapshot.auth)}`);
  assert.notEqual((await follower.outbox.status()).reason, "follower", "the confirmed bearer follower can coordinate with its writer");
  assert.equal(locks.waiting("snapback2:dev:alice"), 1);
  await writer.close();
  await until(() => locks.waiting("snapback2:dev:alice") === 0 && !(follower as any).offlineRuntime.following, "the bearer takeover");
  assert.equal(follower.snapshot.auth.state, "authenticated");
  await follower.close();
});

// A terminal session refusal closes every other transport; the consumers of the
// stream it came from must still hear it (the auth-ownership suite's contract).
test("a terminal refusal reaches every consumer of the shared entry it originated from", async () => {
  let opens = 0;
  const client = createClient({
    url: "http://shared-terminal.test",
    tokenStore: { load: () => "expired-token", save: () => undefined },
    fetch: async (input: string | URL | Request) => {
      const url = new URL(String(input));
      if (url.pathname === "/api/auth/me") return new Response(JSON.stringify({ viewer: "principal-a", kind: "account" }), { status: 200 });
      if (url.pathname === "/api/manifest") return new Response(JSON.stringify({ generation: "g", programGeneration: "p", ops: {}, channels: {}, auth: {} }), { status: 200 });
      opens += 1;
      const frame = JSON.stringify({ state: "refused", code: "E_AUTH_SESSION", family: "auth", message: "expired", guide: "auth/session" });
      return new Response(new ReadableStream<Uint8Array>({ start(controller) { controller.enqueue(new TextEncoder().encode(`data: ${frame}\n\n`)); } }),
        { status: 200, headers: { "content-type": "text/event-stream" } });
    },
  });
  await client.ready;
  const heard: string[] = [];
  const first = subscribe(client, api.messages.thread, { conversationId: "c", c: null }, (event) => { heard.push(`first:${event.state}`); });
  const second = subscribe(client, api.messages.thread, { conversationId: "c", c: null }, (event) => { heard.push(`second:${event.state}`); });
  await assert.rejects(first.until(() => true, 3_000), (error: unknown) => isRefusalError(error) && error.code === "E_AUTH_SESSION");
  await until(() => heard.includes("first:refused") && heard.includes("second:refused"), "both consumers hearing the refusal");
  assert.equal(opens, 1, "one stream served both consumers");
  first.close();
  second.close();
  await client.close();
});

test("a terminal refusal from a drain's tail reaches the drain's consumers", async () => {
  const owner = fakeOwner({ seed: true, cursorArg: "c" });
  let tails = 0;
  const client = createClient({
    url: "http://shared-drain-terminal.test",
    tokenStore: { load: () => "expired-token", save: () => undefined },
    fetch: async (input: string | URL | Request, init?: RequestInit) => {
      const url = String(input);
      if (url.includes("/api/subscribe")) {
        tails += 1;
        const frame = JSON.stringify({ state: "refused", code: "E_AUTH_SESSION", family: "auth", message: "expired", guide: "auth/session" });
        return new Response(new ReadableStream<Uint8Array>({ start(controller) { controller.enqueue(new TextEncoder().encode(`data: ${frame}\n\n`)); } }),
          { status: 200, headers: { "content-type": "text/event-stream" } });
      }
      return owner.fetch(input, init);
    },
  });
  await client.ready;
  const heard: string[] = [];
  const first = subscribe(client, api.messages.inbox, { c: null }, (event) => { heard.push(`first:${event.state}`); }, { drain: true });
  const second = subscribe(client, api.messages.inbox, { c: null }, (event) => { heard.push(`second:${event.state}`); }, { drain: true });
  await until(() => heard.includes("first:refused") && heard.includes("second:refused"), "both drain consumers hearing the tail's refusal");
  assert.equal(tails, 1, "one tail served both drains");
  first.close();
  second.close();
  await client.close();
});

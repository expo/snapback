import assert from "node:assert/strict";
import { test } from "node:test";
import React from "react";
import TestRenderer, { act } from "react-test-renderer";
import { api, isSnapbackRefusal, SnapbackRefusal } from "../dist/client.mjs";
import { indexedDbRangeStore, SnapbackProvider, useQuery } from "../dist/react.mjs";
import { ClientQueries, DrainSubscription, forwardingRequestId, MutationForwarding, SharedSubscriptions, TabFollower } from "../dist/client-observed-test.mjs";
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
  const client = createClient({ url: "http://react-observed.test", as: "alice", fetch });
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
  assert.equal(first.state, "complete"); assert.equal(second.state, "complete");
  assert.strictEqual(first.data, second.data, "both hooks select the same client-owned value");
  assert.equal(opens, 1); assert.equal((client as any).sharedConsumers(api.messages.thread, args), 2);
  await act(async () => { renderer!.unmount(); });
  assert.equal((client as any).sharedConsumers(api.messages.thread, args), 0);
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

test("concurrent follower mutations publish to the writer in invocation order", async () => {
  const Original = globalThis.BroadcastChannel;
  (globalThis as any).BroadcastChannel = MemoryBroadcastChannel;
  MemoryBroadcastChannel.members.clear(); MemoryBroadcastChannel.messages = [];
  MemoryBroadcastChannel.drop = () => false;
  const context = { scope: "forwarding-order", principal: "principal-a", authEpoch: 7, partitionIncarnation: "partition-a" };
  const order: number[] = [];
  const ready = { ready: true, reason: "ready", action: "none", remaining: 0, fence: "inside" } as const;
  const writer = new MutationForwarding({
    writer: () => context, status: async () => ready,
    async admit(command: any) {
      order.push(command.args.order);
      return { state: "queued", intent: `intent-${command.args.order}`, ids: [`id-${command.args.order}`] };
    },
    acknowledge: async () => undefined,
    failure: (error: unknown) => ({ code: "E_TEST", family: "test", message: String(error), guide: "test" }),
    admitted: () => undefined,
  });
  const follower = new MutationForwarding({
    writer: () => undefined, status: async () => ready,
    admit: async () => { throw new Error("follower cannot admit"); }, acknowledge: async () => undefined,
    failure: (error: unknown) => ({ code: "E_TEST", family: "test", message: String(error), guide: "test" }),
    admitted: () => undefined,
  });
  try {
    follower.follower({ scope: context.scope, principal: context.principal, authEpoch: 7, established: true, persona: false });
    const first = follower.mutation("deliveries.post", { order: 1 });
    await until(() => MemoryBroadcastChannel.messages.some(message => message.type === "discover"), "first discovery request");
    writer.writer(context);
    await new Promise(resolve => setTimeout(resolve, 0));
    const second = follower.mutation("deliveries.post", { order: 2 });
    await Promise.all([first, second]);
    assert.deepEqual(order, [1, 2], "preparation sequencing ends once each command is sent, not acknowledged");
  } finally {
    follower.stop(); writer.stop(); MemoryBroadcastChannel.members.clear();
    (globalThis as any).BroadcastChannel = Original;
  }
});

test("follower preparation and unacknowledged commands share the 64-slot bound", async () => {
  const Original = globalThis.BroadcastChannel;
  (globalThis as any).BroadcastChannel = MemoryBroadcastChannel;
  MemoryBroadcastChannel.members.clear(); MemoryBroadcastChannel.messages = [];
  MemoryBroadcastChannel.drop = () => false;
  const ready = { ready: true, reason: "ready", action: "none", remaining: 0, fence: "inside" } as const;
  const follower = new MutationForwarding({
    writer: () => undefined, status: async () => ready,
    admit: async () => { throw new Error("follower cannot admit"); }, acknowledge: async () => undefined,
    failure: (error: unknown) => ({ code: "E_TEST", family: "test", message: String(error), guide: "test" }),
    admitted: () => undefined,
  });
  try {
    follower.follower({ scope: "forwarding-cap", principal: "principal-a", authEpoch: 7, established: true, persona: false });
    let settled = 0;
    const waiting = Array.from({ length: 64 }, (_, index) =>
      follower.mutation("deliveries.post", { index }).then(
        value => { settled += 1; return value; },
        error => { settled += 1; throw error; },
      ));
    assert.equal((follower as any).commands.size, 64, "all retained inputs occupy the fixed budget during discovery");
    const overflow = follower.mutation("deliveries.post", { index: 64 });
    await assert.rejects(Promise.race([
      overflow,
      new Promise((_, reject) => setTimeout(() => reject(new Error("overflow did not refuse promptly")), 100)),
    ]), (error: unknown) => isSnapbackRefusal(error) && error.code === "E_OFFLINE_FORWARDING_CAPACITY");
    assert.equal(settled, 0, "the admitted 64 remain ordered behind the one discovery");
    follower.stop();
    const outcomes = await Promise.allSettled(waiting);
    assert.ok(outcomes.every(outcome => outcome.status === "rejected"
      && isSnapbackRefusal(outcome.reason) && outcome.reason.code === "E_OFFLINE_FOLLOWER"));
    assert.equal((follower as any).commands.size, 0, "generation stop releases every queued reservation");
  } finally {
    follower.stop(); MemoryBroadcastChannel.members.clear();
    MemoryBroadcastChannel.drop = () => false; MemoryBroadcastChannel.throwOn = () => false;
    (globalThis as any).BroadcastChannel = Original;
  }
});

test("account replacement invalidates unsent discovery and queued follower preparation", async () => {
  const Original = globalThis.BroadcastChannel;
  (globalThis as any).BroadcastChannel = MemoryBroadcastChannel;
  MemoryBroadcastChannel.members.clear(); MemoryBroadcastChannel.messages = [];
  MemoryBroadcastChannel.drop = () => false;
  const old = { scope: "forwarding-old", principal: "principal-a", authEpoch: 7, partitionIncarnation: "partition-a" };
  const successor = { scope: old.scope, principal: old.principal, authEpoch: 8, partitionIncarnation: "partition-b" };
  const ready = { ready: true, reason: "ready", action: "none", remaining: 0, fence: "inside" } as const;
  const admitted: string[] = [];
  const writer = new MutationForwarding({
    writer: () => successor, status: async () => ready,
    admit: async (command: any) => {
      admitted.push(command.args.body);
      return { state: "queued", intent: "successor-intent", ids: ["successor-id"] };
    },
    acknowledge: async () => undefined,
    failure: (error: unknown) => ({ code: "E_TEST", family: "test", message: String(error), guide: "test" }),
    admitted: () => undefined,
  });
  const follower = new MutationForwarding({
    writer: () => undefined, status: async () => ready,
    admit: async () => { throw new Error("follower cannot admit"); }, acknowledge: async () => undefined,
    failure: (error: unknown) => ({ code: "E_TEST", family: "test", message: String(error), guide: "test" }),
    admitted: () => undefined,
  });
  try {
    follower.follower({ scope: old.scope, principal: old.principal, authEpoch: 7, established: true, persona: false });
    const first = follower.mutation("deliveries.post", { body: "obsolete first" });
    const second = follower.mutation("deliveries.post", { body: "obsolete second" });
    await until(() => MemoryBroadcastChannel.messages.some(message => message.type === "discover"), "obsolete discovery request");
    follower.follower({ scope: successor.scope, principal: successor.principal, authEpoch: 8, established: true, persona: false });
    writer.writer(successor);
    await assert.rejects(first, (error: unknown) => isSnapbackRefusal(error) && error.code === "E_OFFLINE_FOLLOWER");
    await assert.rejects(second, (error: unknown) => isSnapbackRefusal(error) && error.code === "E_OFFLINE_FOLLOWER");
    assert.deepEqual(admitted, [], "neither known-unsent predecessor command attaches to the successor channel");
    assert.equal((await follower.mutation("deliveries.post", { body: "successor" })).state, "queued");
    assert.deepEqual(admitted, ["successor"]);
  } finally {
    follower.stop(); writer.stop(); MemoryBroadcastChannel.members.clear();
    (globalThis as any).BroadcastChannel = Original;
  }
});

test("a successor writer retires status work addressed to its predecessor", async () => {
  const Original = globalThis.BroadcastChannel;
  (globalThis as any).BroadcastChannel = MemoryBroadcastChannel;
  MemoryBroadcastChannel.members.clear(); MemoryBroadcastChannel.messages = [];
  MemoryBroadcastChannel.drop = () => false;
  const context = { scope: "forwarding-status", principal: "principal-a", authEpoch: 7, partitionIncarnation: "partition-a" };
  const ready = { ready: true, reason: "ready", action: "none", remaining: 0, fence: "inside" } as const;
  const host = {
    writer: () => context, status: async () => ready,
    admit: async () => ({ state: "queued" as const, intent: "intent", ids: ["id"] }),
    acknowledge: async () => undefined,
    failure: (error: unknown) => ({ code: "E_TEST", family: "test", message: String(error), guide: "test" }),
    admitted: () => undefined,
  };
  const first = new MutationForwarding(host), second = new MutationForwarding(host);
  const follower = new MutationForwarding({ ...host, writer: () => undefined });
  try {
    first.writer(context);
    follower.follower({ scope: context.scope, principal: context.principal, authEpoch: 7, established: true, persona: false });
    assert.equal((await follower.status()).ready, true);
    await new Promise(resolve => setTimeout(resolve, 0));
    let unchangedNotifications = 0;
    const stopNotifications = follower.subscribe(() => { unchangedNotifications++; });
    assert.equal((await follower.status()).ready, true);
    await new Promise(resolve => setTimeout(resolve, 0));
    assert.equal(unchangedNotifications, 0,
      "a successful status answer does not recursively invalidate the probe that requested it");
    stopNotifications();
    MemoryBroadcastChannel.drop = message => message.type === "status-answer";
    const requests = MemoryBroadcastChannel.messages.filter(message => message.type === "status").length;
    const stale = follower.status();
    await until(() => MemoryBroadcastChannel.messages.filter(message => message.type === "status").length > requests,
      "the predecessor-addressed status request");
    first.stop(); second.writer(context);
    assert.equal((await Promise.race([
      stale,
      new Promise((_, reject) => setTimeout(() => reject(new Error("successor announcement left predecessor status pending")), 100)),
    ]) as any).reason, "writer-discovery");
    assert.equal((follower as any).statusWaiters.size, 0);
    assert.equal((follower as any).unresponsive, false, "the retired predecessor timeout cannot poison successor readiness");
    MemoryBroadcastChannel.drop = () => false;
    assert.equal((await follower.status()).ready, true);
  } finally {
    follower.stop(); first.stop(); second.stop(); MemoryBroadcastChannel.members.clear();
    MemoryBroadcastChannel.drop = () => false; (globalThis as any).BroadcastChannel = Original;
  }
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
  const refusal = () => new SnapbackRefusal({
    code: "E_OFFLINE_CARRIER", family: "offline", message: "local store failed", guide: "offline",
  });
  let identity: readonly [number, number] = [1, 1];
  let publish!: (event: any) => void;
  let local = async () => { throw refusal(); };
  const queries = new ClientQueries({
    identity: () => identity,
    active: (fence: readonly [number, number]) => fence[0] === identity[0] && fence[1] === identity[1],
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
  await assert.rejects(waiting, (error: unknown) => isSnapbackRefusal(error) && error.code === "E_OFFLINE_CARRIER");
  await until(() => observed.getSnapshot().state === "refused", "the shared local refusal snapshot");
  assert.equal((observed.getSnapshot() as any).refusal.code, "E_OFFLINE_CARRIER");
  raw.close(); stop();

  let failObsolete!: () => void;
  let markStarted!: () => void;
  const started = new Promise<void>((resolve) => { markStarted = resolve; });
  const delayed = new Promise<void>((resolve) => { failObsolete = resolve; });
  local = async () => { markStarted(); await delayed; throw refusal(); };
  const old = queries.observe(api.messages.search, { term: "old", c: null });
  const states: string[] = [];
  const stopOld = old.subscribe(() => { states.push(old.getSnapshot().state); });
  publish({ state: "complete", live: true, data: [], next: null, seq: 2 });
  queries.refresh();
  await started;
  identity = [2, 2];
  queries.clear();
  failObsolete();
  await new Promise<void>((resolve) => setTimeout(resolve, 20));
  assert.equal(old.getSnapshot().state, "hydrating");
  assert.deepEqual(states.slice(-2), ["complete", "hydrating"], "obsolete local failure published no refusal");
  stopOld();
});

test("a live indexed query preserves its authoritative state until its effective value changes", async () => {
  let publish!: (event: any) => void;
  let localData = [{ id: "server" }];
  const queries = new ClientQueries({
    identity: () => [1, 1] as const,
    active: () => true,
    open: (_ref: unknown, _args: unknown, listener: (event: any) => void) => {
      publish = listener;
      return { close: () => undefined, until: async () => { throw new Error("must use shared until"); } };
    },
    query: async () => { throw new Error("unused"); },
    local: async () => ({ state: "held", live: false, connection: "offline", data: localData, next: null, seq: 2 }),
  } as any);
  const observed = queries.observe(api.messages.search, { term: "café", c: null });
  const stop = observed.subscribe(() => undefined);
  publish({ state: "complete", live: true, data: [{ id: "server" }], next: null, seq: 1 });
  const authoritative = observed.getSnapshot();
  queries.refresh();
  await new Promise<void>((resolve) => setTimeout(resolve, 20));
  assert.strictEqual(observed.getSnapshot(), authoritative, "an unrelated store commit does not replace complete with held");

  localData = [{ id: "predicted" }];
  queries.refresh();
  await until(() => (observed.getSnapshot() as any).data?.[0]?.id === "predicted", "the local indexed revision");
  assert.deepEqual(observed.getSnapshot(), {
    state: "held", live: true, data: [{ id: "predicted" }], next: null, seq: 2,
  });

  localData = [{ id: "server" }];
  queries.refresh();
  await until(() => observed.getSnapshot().state === "complete", "settlement returns to the authoritative value");
  stop();
});

test("new local prediction and revocation remain visible under an older held answer sequence", async () => {
  let publish!: (event: any) => void;
  let local = { state: "capped", live: false, connection: "offline", seq: 7, next: null,
    data: { messages: [{ id: "predicted", message: { id: "message" } }], count: 3, preview: [] }, predicted: ["intent"] };
  const queries = new ClientQueries({
    identity: () => [1, 1] as const,
    active: () => true,
    open: (_ref: unknown, _args: unknown, listener: (event: any) => void) => {
      publish = listener;
      return { close: () => undefined, until: async () => { throw new Error("must use shared until"); } };
    },
    query: async () => { throw new Error("unused"); },
    local: async () => local,
  } as any);
  const observed = queries.observe(api.deliveries.conversationView, { conversationId: "conversation-1" });
  const stop = observed.subscribe(() => undefined);
  publish({ state: "capped", live: true, seq: 8, next: null,
    data: { messages: [{ id: "server", message: { id: "server" } }], count: 2, preview: [] } });
  queries.refresh();
  await until(() => (observed.getSnapshot() as any).predicted?.[0] === "intent", "older-sequence prediction");
  assert.equal((observed.getSnapshot() as any).data.count, 3,
    "owner sequence is not a carrier revision fence for a new overlay");

  local = { state: "capped", live: false, connection: "offline", seq: 7, next: null,
    data: { messages: [{ id: "removed", message: null }], count: 2, preview: [] }, predicted: [] } as any;
  queries.refresh();
  await until(() => (observed.getSnapshot() as any).data.messages[0].message === null, "older-sequence revocation");
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
    open: (_ref: unknown, _args: unknown, listener: (event: any) => void) => {
      publish = listener;
      return { close: () => undefined, until: async () => { throw new Error("must use shared until"); } };
    },
    query: async () => { throw new Error("unused"); },
    local: async () => ({ state: "held", live: false, connection: "offline", data: localData,
      next: null, seq: 2, caughtUp: true, watermark: "persisted" }),
  } as any);
  const subscription = queries.subscribe(api.deliveries.inbox, { c: null }, () => undefined, { drain: true });
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
  const client = createClient({ url: "http://shared.test", as: "alice", fetch });
  await client.ready;
  const args = { conversationId: "conversation-1", c: null };
  const first = client.subscribe(api.deliveries.thread, args, () => undefined);
  const second = client.subscribe(api.deliveries.thread, args, () => undefined);
  const [a, b] = await Promise.all([
    first.until((event) => event.state === "complete", 2_000),
    second.until((event) => event.state === "complete", 2_000),
  ]);
  assert.equal(a.seq, b.seq);
  assert.equal(counts.subscribes, 1, "the second consumer attaches to the first consumer's stream");
  assert.equal(client.sharedConsumers(api.deliveries.thread, args), 2);

  // A late consumer sees the current delivery without asking the owner again.
  const seen: string[] = [];
  const third = client.subscribe(api.deliveries.thread, args, (event) => { seen.push(event.state); });
  await new Promise<void>((resolve) => setTimeout(resolve, 20));
  assert.deepEqual(seen, ["complete"]);
  assert.equal(counts.subscribes, 1);
  assert.equal(client.sharedConsumers(api.deliveries.thread, args), 3);

  // Closing duplicates leaves the survivor on the same stream.
  first.close();
  third.close();
  assert.equal(client.sharedConsumers(api.deliveries.thread, args), 1);
  assert.equal(counts.subscribes, 1);
  const again = await second.until((event) => event.state === "complete", 2_000);
  assert.equal(again.seq, a.seq);

  // The last close releases the entry; the next consumer opens a fresh stream.
  second.close();
  assert.equal(client.sharedConsumers(api.deliveries.thread, args), 0);
  const fresh = client.subscribe(api.deliveries.thread, args, () => undefined);
  await fresh.until((event) => event.state === "complete", 2_000);
  assert.equal(counts.subscribes, 2);
  fresh.close();

  // Different arguments never share.
  const other = client.subscribe(api.deliveries.thread, { conversationId: "conversation-2", c: null }, () => undefined);
  await other.until((event) => event.state === "complete", 2_000);
  assert.equal(counts.subscribes, 3);
  assert.equal(client.sharedConsumers(api.deliveries.thread, args), 0);
  other.close();
  await client.close();
});

test("observed queries are lazy and share one snapshot and source with raw subscribers", async () => {
  const owner = fakeOwner({ seed: true });
  const { counts, fetch } = counting(owner);
  const client = createClient({ url: "http://observed.test", as: "alice", fetch });
  await client.ready;
  const args = { conversationId: "conversation-1", c: null };
  const lateArgs = { ...args };
  const lateOptions: any = {};
  const first = client.observe(api.deliveries.thread, lateArgs, lateOptions);
  const second = client.observe(api.deliveries.thread, args);
  lateArgs.conversationId = "conversation-2";
  lateOptions.live = false;
  lateOptions.drain = true;

  assert.strictEqual(first.getSnapshot(), first.getSnapshot(), "an unused observer has one stable hydrating snapshot");
  assert.equal(first.getSnapshot().state, "hydrating");
  assert.equal(counts.subscribes, 0, "obtaining an observer opens no transport");
  assert.equal(client.sharedConsumers(api.deliveries.thread, args), 0, "an unused observer retains no entry");

  const seen: string[] = [];
  const stopFirst = first.subscribe(() => { seen.push(`first:${first.getSnapshot().state}`); });
  const stopSecond = second.subscribe(() => { seen.push(`second:${second.getSnapshot().state}`); });
  await until(() => first.getSnapshot().state === "complete", "the observed delivery");
  assert.strictEqual(first.getSnapshot(), second.getSnapshot(), "both observers own the same immutable snapshot");
  assert.ok((first.getSnapshot() as any).data.every((row: any) => row.conversationId === "conversation-1"),
    "late attach uses the arguments and mode captured when observe returned");
  assert.equal(counts.subscribes, 1);
  assert.equal(client.sharedConsumers(api.deliveries.thread, args), 2);

  const notifications = seen.length;
  let raw: any, mutationBlocked = false;
  const subscription = client.subscribe(api.deliveries.thread, args, (event) => {
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
  assert.equal(client.sharedConsumers(api.deliveries.thread, args), 3);

  (subscription as typeof subscription & { reset(): void }).reset();
  assert.equal(first.getSnapshot().state, "hydrating", "program reset synchronously forgets predecessor data");
  assert.equal(seen.at(-2), "first:hydrating");
  assert.equal(seen.at(-1), "second:hydrating");
  await until(() => first.getSnapshot().state === "complete", "the successor delivery");
  assert.equal(counts.subscribes, 2, "program reset reopens the one shared source");

  stopFirst();
  subscription.close();
  assert.equal(client.sharedConsumers(api.deliveries.thread, args), 1);
  stopSecond();
  assert.equal(client.sharedConsumers(api.deliveries.thread, args), 0);
  assert.ok(seen.includes("first:complete") && seen.includes("second:complete"));
  await client.close();
});

test("closing a client retires an observed authority snapshot before later delivery", async () => {
  const owner = fakeOwner({ seed: true });
  const { counts, fetch } = counting(owner);
  const client = createClient({ url: "http://observed-reset.test", as: "alice", fetch });
  await client.ready;
  const observed = client.observe(api.deliveries.thread, { conversationId: "conversation-1", c: null });
  const unused = client.observe(api.deliveries.thread, { conversationId: "conversation-unused", c: null });
  const states: string[] = [];
  const stop = observed.subscribe(() => { states.push(observed.getSnapshot().state); });
  await until(() => observed.getSnapshot().state === "complete", "the predecessor snapshot");
  await client.close();
  assert.equal(observed.getSnapshot().state, "hydrating", "retirement forgot the predecessor value");
  assert.deepEqual(states.slice(-2), ["complete", "hydrating"]);
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
  const observed = client.observe(api.deliveries.thread, { conversationId: "conversation-1", c: null });
  const states: string[] = [];
  const stop = observed.subscribe(() => { states.push(observed.getSnapshot().state); });
  await until(() => observed.getSnapshot().state === "complete", "the authenticated account query");
  await client.auth.logout();
  assert.equal(observed.getSnapshot().state, "hydrating", "the wiped account cannot remain visible");
  assert.deepEqual(states.slice(-2), ["complete", "hydrating"]);
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
  const client = createClient({ url: "http://local-revision.test", as: "alice", fetch: owner.fetch,
    offline: { store: () => physical } });
  await client.ready;
  const args = { conversationId: "conversation-1", c: null };
  const first = client.observe(api.deliveries.thread, args);
  const second = client.observe(api.deliveries.thread, args);
  let firstNotifies = 0, secondNotifies = 0;
  const stopFirst = first.subscribe(() => { firstNotifies += 1; });
  const stopSecond = second.subscribe(() => { secondNotifies += 1; });
  await until(() => first.getSnapshot().state === "complete", "the held thread");
  await new Promise<void>((resolve) => setTimeout(resolve, 20));
  assert.strictEqual(first.getSnapshot(), second.getSnapshot());
  assert.deepEqual([firstNotifies, secondNotifies], [1, 1], "the delivery's store commit does not publish a duplicate snapshot");
  const initial = (first.getSnapshot() as any).data[0].message;
  await client.offline();
  await until(() => first.getSnapshot().live === false, "the mounted offline view");
  assert.strictEqual(first.getSnapshot(), second.getSnapshot());
  const intent = "local-prediction";
  const entry = {
    intent, grant: "test-grant", offset: 0, count: 1, ids: ["predicted-id"],
    op: "deliveries.edit", args: { messageId: initial.id, body: "Predicted edit" }, issuedSeq: 5,
    state: "queued" as const, predicted: true, trace: { points: [], verdicts: [] }, createdAt: 10, updatedAt: 10,
  };
  const raw = client.subscribe(api.deliveries.thread, args, () => undefined);
  const rawPrediction = raw.until((event) => (event as any).predicted?.[0] === intent, 2_000);
  const beforePrediction = firstNotifies;
  await physical.commit({ outbox: { put: [entry] }, overlay: { put: { [intent]: [{
    table: "messages", id: initial.id, row: { ...initial, body: "Predicted edit" }, fields: ["body"],
  }] } } });
  await until(() => (first.getSnapshot() as any).predicted?.[0] === intent, "the shared local prediction");
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
  assert.equal((first.getSnapshot() as any).predicted, undefined);
  assert.strictEqual(first.getSnapshot(), second.getSnapshot(), "settlement is one coherent shared snapshot");
  assert.equal(firstNotifies, beforeBookkeeping + 1);
  assert.equal(secondNotifies, firstNotifies);
  raw.close(); stopFirst(); stopSecond();
  await client.close();
});

test("identical drains share one page walk and one tail", async () => {
  const owner = fakeOwner({ seed: true, cursorArg: "c" });
  const { counts, fetch } = counting(owner);
  const client = createClient({ url: "http://shared-drain.test", as: "alice", fetch });
  await client.ready;
  const first = client.subscribe(api.deliveries.inbox, { c: null }, () => undefined, { drain: true });
  const second = client.subscribe(api.deliveries.inbox, { c: null }, () => undefined, { drain: true });
  const [a, b] = await Promise.all([
    first.until((event) => event.state === "complete" && event.caughtUp === true, 2_000),
    second.until((event) => event.state === "complete" && event.caughtUp === true, 2_000),
  ]);
  assert.equal(a.seq, b.seq);
  assert.equal(counts.queries, 1, "one page walk serves both drains");
  await until(() => counts.subscribes >= 1, "the shared tail");
  assert.equal(counts.subscribes, 1, "one tail serves both drains");
  assert.equal(client.sharedConsumers(api.deliveries.inbox, { c: null }, true), 2);
  await client.offline(); await client.online();
  await until(() => counts.subscribes >= 2, "the drain tail after reconnect");
  assert.equal(counts.subscribes, 2, "the shared drain reopens exactly one tail after a transport cut");
  first.close();
  second.close();
  assert.equal(client.sharedConsumers(api.deliveries.inbox, { c: null }, true), 0);
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
  const writer = createClient({ url: "http://tabs.test", as: "alice", fetch: owner.fetch, offline: { store } });
  await writer.ready;
  // The writer earns its replay grant through the recipe's drain.
  const inbox = writer.subscribe(api.deliveries.inbox, { c: null }, () => undefined, { drain: true });
  await inbox.until((event) => event.state === "complete" && event.caughtUp === true, 2_000);
  await until(async () => (await writer.outbox.status()).ready, "the writer's grant");

  const follower = createClient({ url: "http://tabs.test", as: "alice", fetch: owner.fetch, offline: { store } });
  await follower.ready;
  await until(async () => (await follower.outbox.status(api.deliveries.post)).ready, "the follower's writer admission");
  const read = await follower.query(api.deliveries.thread, { conversationId: "conversation-1", c: null });
  assert.equal(read.state, "complete", "a follower reads live");
  const forwarded = await follower.mutation(api.deliveries.post, { conversationId: "conversation-1", body: "from the follower" });
  assert.equal(forwarded.state, "queued", "the follower learns the writer's durable admission");
  await until(() => owner.executions.some((execution) => execution.intent === (forwarded as any).intent), "the forwarded replay");
  assert.equal(owner.executions.filter((execution) => execution.intent === (forwarded as any).intent).length, 1);

  await writer.offline();
  const queued = await writer.mutation(api.deliveries.post, { conversationId: "conversation-1", body: "queued in the writer tab" });
  assert.equal(queued.state, "queued");
  inbox.close();
  await writer.close();

  // The lock passes to the follower: it opens the partition and replays the inherited intent.
  await until(() => !(follower as any).offlineRuntime.following, "the follower marker clearing after takeover");
  await until(() => owner.executions.some((execution) => execution.intent === queued.intent), "the inherited replay");
  assert.equal(owner.executions.filter((execution) => execution.intent === queued.intent).length, 1);
  const after = await follower.mutation(api.deliveries.post, { conversationId: "conversation-1", body: "from the new writer" });
  assert.equal(after.state, "committed");
  await follower.close();
});

test("client.recoverMutation reuses a follower admission whose public result was unknown", async () => {
  const Original = globalThis.BroadcastChannel;
  (globalThis as any).BroadcastChannel = MemoryBroadcastChannel;
  MemoryBroadcastChannel.members.clear(); MemoryBroadcastChannel.messages = [];
  MemoryBroadcastChannel.drop = () => false; MemoryBroadcastChannel.throwOn = () => false;
  const database = new FakeIndexedDb(), locks = new FakeLocks();
  const store = indexedDbRangeStore({ indexedDB: database as any, locks: locks as any });
  const owner = fakeOwner({ seed: true, cursorArg: "c" });
  const writer = createClient({ url: "http://public-recovery.test", as: "alice", fetch: owner.fetch, offline: { store } });
  let follower: ReturnType<typeof createClient> | undefined, inbox: any;
  try {
    await writer.ready;
    inbox = writer.subscribe(api.deliveries.inbox, { c: null }, () => undefined, { drain: true });
    await inbox.until((event: any) => event.state === "complete" && event.caughtUp === true, 2_000);
    follower = createClient({ url: "http://public-recovery.test", as: "alice", fetch: owner.fetch, offline: { store } });
    await follower.ready;
    await until(async () => (await follower!.outbox.status(api.deliveries.post)).ready, "public follower recovery readiness");
    const args = { conversationId: "conversation-1", body: "one public unknown admission" };
    MemoryBroadcastChannel.drop = message => message.type === "mutation-answer";
    const unknown = await follower.mutation(api.deliveries.post, args);
    assert.equal(unknown.state, "admission-unknown");
    assert.equal(typeof unknown.recovery, "string");
    MemoryBroadcastChannel.drop = () => false;
    const recovered = await follower.recoverMutation(api.deliveries.post, args, unknown.recovery);
    assert.equal(recovered.state, "queued");
    assert.equal(owner.executions.filter(execution => execution.intent === recovered.intent).length, 1,
      "public recovery redispatch reads the durable receipt without a second admission");
  } finally {
    inbox?.close(); await follower?.close(); await writer.close();
    MemoryBroadcastChannel.members.clear(); MemoryBroadcastChannel.drop = () => false;
    MemoryBroadcastChannel.throwOn = () => false; (globalThis as any).BroadcastChannel = Original;
  }
});

// @ref LLP 1018.000#8-account-sessions-and-durable-follower-admission — a lost
// answer returns an opaque recovery identity; discovery loss cannot turn that
// prior send into a safe refusal, and recovery reuses the durable admission.
test("forwarded mutation timeout, rediscovery and recovery preserve one request identity", async () => {
  const Original = globalThis.BroadcastChannel;
  const keepAlive = setInterval(() => undefined, 1_000);
  (globalThis as any).BroadcastChannel = MemoryBroadcastChannel;
  MemoryBroadcastChannel.members.clear(); MemoryBroadcastChannel.messages = [];
  let dropAnswers = true, creations = 0, acknowledgments = 0;
  MemoryBroadcastChannel.drop = message => dropAnswers && message.type === "mutation-answer";
  const context = { scope: "forwarding-test", principal: "principal-a", authEpoch: 7, partitionIncarnation: "partition-a" };
  const responseTimeout = 30;
  const receipts = new Map<string, any>();
  const ready = { ready: true, reason: "ready", action: "none", remaining: 0, fence: "inside" } as const;
  const writer = new MutationForwarding({
    writer: () => context, status: async () => ready,
    async admit(command: any) {
      let result = receipts.get(command.requestId);
      if (result) return result;
      if (command.recovery && command.expiresAt <= Date.now()) return undefined;
      if (!result) { creations += 1; result = { state: "queued", intent: `intent-${creations}`, ids: [`id-${creations}`] }; receipts.set(command.requestId, result); }
      return result;
    },
    async acknowledge() { acknowledgments += 1; },
    failure: (error: unknown) => ({ code: "E_TEST", family: "test", message: String(error), guide: "test" }),
    admitted: () => undefined,
  }, responseTimeout);
  const follower = new MutationForwarding({
    writer: () => undefined, status: async () => ready,
    admit: async () => { throw new Error("follower cannot admit"); }, acknowledge: async () => undefined,
    failure: (error: unknown) => ({ code: "E_TEST", family: "test", message: String(error), guide: "test" }),
    admitted: () => undefined,
  }, responseTimeout);
  try {
    writer.writer(context);
    follower.follower({ scope: context.scope, principal: context.principal, authEpoch: 7, established: true, persona: false });
    assert.equal((await follower.status("deliveries.post")).ready, true);
    const args = { conversationId: "conversation-1", body: "one durable send" };
    const unknown = await follower.mutation("deliveries.post", args);
    assert.equal(unknown.state, "admission-unknown"); assert.equal(creations, 1);
    const token = (unknown as any).recovery as string;
    const record = JSON.parse(Buffer.from(token.slice("s2mr1.".length), "base64url").toString());
    assert.deepEqual(Object.keys(record).sort(), ["authEpoch", "expiresAt", "followerId", "partitionIncarnation",
      "payloadDigest", "principal", "protocol", "requestId", "scope"], "the recovery token carries no op or arguments");
    assert.equal(record.requestId.startsWith(`s2fr1-${record.expiresAt.toString(16)}-`), true, "expiration is part of immutable identity");

    writer.writer(undefined);
    const discovers = MemoryBroadcastChannel.messages.filter(message => message.type === "discover").length;
    const blocker = follower.mutation("deliveries.post", { ...args, body: "known-unsent blocker" });
    const repeated = Array.from({ length: 65 }, () => follower.mutation("deliveries.post", args, token as any));
    await until(() => MemoryBroadcastChannel.messages.filter(message => message.type === "discover").length > discovers,
      "the earlier command's discovery");
    assert.equal((follower as any).commands.size, 2,
      "repeated observers retain one recovery command behind the earlier invocation");
    assert.ok((follower as any).commands.get(record.requestId).recovery,
      "the logical command owns the one shared recovery preparation/outcome");
    follower.stop();
    await assert.rejects(blocker,
      (error: unknown) => isSnapbackRefusal(error) && error.code === "E_OFFLINE_FOLLOWER",
      "the predecessor's command was known unsent when its generation stopped");
    assert.ok((await Promise.all(repeated)).every(result => result.state === "admission-unknown"
      && (result as any).recovery === token),
    "a queued recovery preserves the prior send's unknown outcome when its generation stops");
    follower.follower({ scope: context.scope, principal: context.principal, authEpoch: 7, established: true, persona: false });
    writer.writer(context);
    assert.equal((await follower.status("deliveries.post")).ready, true);

    (globalThis as any).BroadcastChannel = undefined;
    assert.deepEqual(await follower.mutation("deliveries.post", args, token as any), unknown,
      "no carrier after a prior send preserves the unknown outcome");
    await assert.rejects(follower.mutation("deliveries.post", { ...args, body: "never sent" }),
      (error: unknown) => isSnapbackRefusal(error) && error.code === "E_OFFLINE_FOLLOWER",
      "before any send, an unavailable forwarding carrier is an ordinary follower refusal");
    (globalThis as any).BroadcastChannel = MemoryBroadcastChannel;
    MemoryBroadcastChannel.throwOn = message => message.type === "mutation";
    assert.deepEqual(await follower.mutation("deliveries.post", args, token as any), unknown,
      "a synchronous recovery publication failure cannot disprove the prior send");
    await assert.rejects(follower.mutation("deliveries.post", { ...args, body: "first throwing send" }),
      (error: unknown) => isSnapbackRefusal(error) && error.code === "E_OFFLINE_FOLLOWER",
      "a first-ever synchronous publication failure proves non-admission");
    MemoryBroadcastChannel.throwOn = () => false;
    writer.writer(undefined); writer.writer(context); await new Promise(resolve => setTimeout(resolve, 0));
    assert.equal((await follower.status("deliveries.post")).reason, "writer-unresponsive",
      "an unrelated announcement does not clear an unknown command");

    let settled = false;
    const recovering = follower.mutation("deliveries.post", args, token as any).then(result => { settled = true; return result; });
    await until(() => MemoryBroadcastChannel.messages.filter(message => message.type === "mutation-answer").length === 2,
      "the successor writer's recovery answer");
    const answers = MemoryBroadcastChannel.messages.filter(message => message.type === "mutation-answer");
    MemoryBroadcastChannel.deliver(context.scope, answers[0]);
    await new Promise(resolve => setTimeout(resolve, 0));
    assert.equal(settled, false, "the predecessor writer's delayed answer cannot settle a retargeted recovery");
    MemoryBroadcastChannel.deliver(context.scope, answers[1]);
    const recovered = await recovering;
    assert.deepEqual(recovered, { state: "queued", intent: "intent-1", ids: ["id-1"] });
    await until(() => acknowledgments === 1, "the durable receipt acknowledgment");
    assert.equal(creations, 1, "recovery queried the same durable admission");
    const requests = MemoryBroadcastChannel.messages.filter(message => message.type === "mutation");
    assert.equal(new Set(requests.map(message => message.requestId)).size, 1);
    assert.equal(requests.at(-1).recovery, true, "retrying an unknown command uses recovery expiration semantics");

    const forged = { ...record, expiresAt: record.expiresAt + 1_000 };
    const forgedToken = `s2mr1.${Buffer.from(JSON.stringify(forged)).toString("base64url")}`;
    await assert.rejects(follower.mutation("deliveries.post", args, forgedToken as any), TypeError,
      "the same request id cannot acquire a later expiry after receipt pruning");

    const expiredAt = Date.now() - 1;
    const expiredRecord = { ...record, requestId: forwardingRequestId(expiredAt, "e".repeat(32)), expiresAt: expiredAt };
    const expiredToken = `s2mr1.${Buffer.from(JSON.stringify(expiredRecord)).toString("base64url")}`;
    const expired = await follower.mutation("deliveries.post", args, expiredToken as any);
    assert.equal(expired.state, "admission-unknown");
    dropAnswers = false;
    assert.equal((await follower.status("deliveries.post")).ready, true,
      "expiration removes the pending slot and cannot leave a phantom unresponsive state");

    // A recovery preparation owns the same logical slot even if the older
    // Pending expires while rediscovery is still in flight.
    dropAnswers = true;
    const nearExpiry = Date.now() + responseTimeout + 10;
    const expiringRecord = { ...record, requestId: forwardingRequestId(nearExpiry, "d".repeat(32)), expiresAt: nearExpiry };
    const expiringToken = `s2mr1.${Buffer.from(JSON.stringify(expiringRecord)).toString("base64url")}`;
    assert.equal((await follower.mutation("deliveries.post", args, expiringToken as any)).state, "admission-unknown");
    writer.writer(undefined);
    const retryDiscoveries = MemoryBroadcastChannel.messages.filter(message => message.type === "discover").length;
    const expiringRetry = follower.mutation("deliveries.post", args, expiringToken as any);
    await until(() => MemoryBroadcastChannel.messages.filter(message => message.type === "discover").length > retryDiscoveries,
      "the expiring recovery rediscovery");
    await until(() => {
      const lifecycle = (follower as any).commands.get(expiringRecord.requestId);
      return lifecycle?.pending === undefined && lifecycle?.recovery !== undefined;
    }, "pending expiry transferring ownership to recovery", 1_000);
    const behind = Array.from({ length: 63 }, (_, index) => follower.mutation("deliveries.post", { ...args, body: `behind-${index}` }));
    assert.equal((follower as any).commands.size, 64, "expiry cannot free the retained recovery's logical slot");
    await assert.rejects(follower.mutation("deliveries.post", { ...args, body: "overflow after expiry" }),
      (error: unknown) => isSnapbackRefusal(error) && error.code === "E_OFFLINE_FORWARDING_CAPACITY");
    dropAnswers = false; writer.writer(context);
    assert.equal((await expiringRetry).state, "queued",
      "successful rediscovery installs a current Pending after the predecessor expired");
    assert.ok((await Promise.all(behind)).every(outcome => outcome.state === "queued"));
    await until(() => (follower as any).commands.size === 0, "all acknowledged command ownership releasing");
  } finally {
    clearInterval(keepAlive);
    follower.stop(); writer.stop();
    MemoryBroadcastChannel.members.clear(); MemoryBroadcastChannel.drop = () => false;
    MemoryBroadcastChannel.throwOn = () => false;
    (globalThis as any).BroadcastChannel = Original;
  }
});

test("a follower that closes withdraws its wait, so the next tab becomes the writer", async () => {
  const database = new FakeIndexedDb();
  const locks = new FakeLocks();
  const store = indexedDbRangeStore({ indexedDB: database as any, locks: locks as any });
  const owner = fakeOwner({ seed: true });
  const writer = createClient({ url: "http://tabs-close.test", as: "alice", fetch: owner.fetch, offline: { store } });
  await writer.ready;
  const follower = createClient({ url: "http://tabs-close.test", as: "alice", fetch: owner.fetch, offline: { store } });
  await follower.ready;
  assert.notEqual((await follower.outbox.status()).reason, "follower", "a forwarding-capable follower reports writer readiness");
  await follower.close();
  await writer.close();
  const next = createClient({ url: "http://tabs-close.test", as: "alice", fetch: owner.fetch, offline: { store } });
  await next.ready;
  assert.notEqual((await next.outbox.status()).reason, "follower", "the closed follower did not take the lock");
  await next.close();
});

test("two attachments sharing one callback function are two consumers", async () => {
  const owner = fakeOwner({ seed: true });
  const { counts, fetch } = counting(owner);
  const client = createClient({ url: "http://same-callback.test", as: "alice", fetch });
  await client.ready;
  const args = { conversationId: "conversation-1", c: null };
  let calls = 0;
  const listener = () => { calls += 1; };
  const first = client.subscribe(api.deliveries.thread, args, listener);
  const second = client.subscribe(api.deliveries.thread, args, listener);
  await second.until((event) => event.state === "complete", 2_000);
  assert.equal(client.sharedConsumers(api.deliveries.thread, args), 2);
  first.close();
  assert.equal(client.sharedConsumers(api.deliveries.thread, args), 1, "closing one attachment keeps the other");
  assert.ok(calls >= 1, "the shared callback heard the delivery");
  const again = await second.until((event) => event.state === "complete", 2_000);
  assert.equal(again.state, "complete", "the surviving attachment still reads the shared stream");
  assert.equal(counts.subscribes, 1);
  second.close();
  assert.equal(client.sharedConsumers(api.deliveries.thread, args), 0);
  await client.close();
});

test("a follower's drain pages and tails live and earns no grant of its own", async () => {
  const database = new FakeIndexedDb();
  const locks = new FakeLocks();
  const store = indexedDbRangeStore({ indexedDB: database as any, locks: locks as any });
  const owner = fakeOwner({ seed: true, cursorArg: "c" });
  const writer = createClient({ url: "http://tabs-drain.test", as: "alice", fetch: owner.fetch, offline: { store } });
  await writer.ready;
  const follower = createClient({ url: "http://tabs-drain.test", as: "alice", fetch: owner.fetch, offline: { store } });
  await follower.ready;
  assert.notEqual((await follower.outbox.status()).reason, "follower", "forwarding availability replaces the hard follower refusal");
  const inbox = follower.subscribe(api.deliveries.inbox, { c: null }, () => undefined, { drain: true });
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
  const first = client.subscribe(api.deliveries.thread, { conversationId: "c", c: null }, (event) => { heard.push(`first:${event.state}`); });
  const second = client.subscribe(api.deliveries.thread, { conversationId: "c", c: null }, (event) => { heard.push(`second:${event.state}`); });
  await assert.rejects(first.until(() => true, 3_000), (error: unknown) => isSnapbackRefusal(error) && error.code === "E_AUTH_SESSION");
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
  const first = client.subscribe(api.deliveries.inbox, { c: null }, (event) => { heard.push(`first:${event.state}`); }, { drain: true });
  const second = client.subscribe(api.deliveries.inbox, { c: null }, (event) => { heard.push(`second:${event.state}`); }, { drain: true });
  await until(() => heard.includes("first:refused") && heard.includes("second:refused"), "both drain consumers hearing the tail's refusal");
  assert.equal(tails, 1, "one tail served both drains");
  first.close();
  second.close();
  await client.close();
});

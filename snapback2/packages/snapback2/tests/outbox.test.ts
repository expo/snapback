import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import React, { StrictMode } from "react";
import TestRenderer, { act } from "react-test-renderer";
import { SnapbackRefusal, api, createClient } from "../dist/client.mjs";
import { SnapbackProvider, indexedDbRangeStore, useMutation, useOutbox, useSnapbackClient } from "../dist/react.mjs";
import { fileRangeStore } from "../dist/test.mjs";
import { FakeIndexedDb, FakeLocks } from "./fake-indexeddb.ts";
import { DAY, engineId, fakeOwner, seededStore } from "./fake-owner.ts";

// @ref LLP 1012#7-writes-offline — the outbox contract, proven against a
// replay-aware owner double on both carriers.

(globalThis as any).IS_REACT_ACT_ENVIRONMENT = true;

async function tempRoot(): Promise<string> {
  return mkdtemp(join(tmpdir(), "snapback2-outbox-"));
}

function indexedFactory() {
  const database = new FakeIndexedDb();
  const locks = new FakeLocks();
  return () => indexedDbRangeStore({ indexedDB: database as any, locks: locks as any });
}

async function carriers(): Promise<Array<{ name: string; factory: () => ReturnType<typeof fileRangeStore>; cleanup(): Promise<void> }>> {
  const root = await tempRoot();
  const indexed = indexedFactory();
  return [
    { name: "file", factory: () => fileRangeStore(root), cleanup: () => rm(root, { recursive: true, force: true }) },
    { name: "IndexedDB", factory: indexed, cleanup: async () => undefined },
  ];
}

const post = (body: string) => ({ conversationId: "conversation-1", body });

test("enqueue consumes a grant slice of 1 + maxNewIds and refuses E_OFFLINE_ID_BLOCK when the grant is spent", async () => {
  for (const carrier of await carriers()) {
    const owner = fakeOwner({ grantCount: 110 });
    await seededStore(carrier.factory());
    const client = createClient({ url: "http://outbox.test", as: "alice", fetch: owner.fetch, offline: { store: carrier.factory() } });
    await client.ready;
    assert.equal(owner.grantsMinted(), 1, `${carrier.name}: cold start resumed and earned a grant`);
    await client.offline();
    const first = await client.mutation(api.deliveries.post as any, post("one"));
    assert.equal(first.state, "queued");
    const second = await client.mutation(api.deliveries.post as any, post("two"));
    assert.equal(second.state, "queued");
    const entries = await client.outbox.entries();
    assert.deepEqual(entries.map((entry) => [entry.intent, entry.offset, entry.count, entry.state]), [
      [`${engineId(100)}:0`, 0, 52, "queued"],
      [`${engineId(100)}:52`, 52, 52, "queued"],
    ], carrier.name);
    assert.equal(entries[0]!.ids.length, 52);
    assert.equal(entries[0]!.ids[0], engineId(100), "the first pinned id is the grant's from");
    assert.equal(entries[1]!.ids[0], engineId(152));
    assert.deepEqual(entries[0]!.trace, { points: [], verdicts: [] }, "the twin's seam is left empty");
    assert.equal(first.state === "queued" && first.ids[0], engineId(100));
    await assert.rejects(
      () => client.mutation(api.deliveries.post as any, post("three")),
      (error: unknown) => error instanceof SnapbackRefusal && error.code === "E_OFFLINE_ID_BLOCK"
        && error.envelope.family === "offline" && typeof error.envelope.rewrite === "string",
      `${carrier.name}: 110 - 104 = 6 ids left cannot hold 52`,
    );
    assert.equal((await client.outbox.entries()).length, 2, "a refused enqueue writes nothing");
    client.close();
    await carrier.cleanup();
  }
});

test("a fresh partition without a grant refuses offline writes loudly and earns one on the drained log", async () => {
  const root = await tempRoot();
  const owner = fakeOwner();
  const client = createClient({ url: "http://grantless.test", as: "alice", fetch: owner.fetch, offline: { store: fileRangeStore(root) } });
  await client.ready;
  assert.equal(owner.grantsMinted(), 0, "nothing held, nothing to resume");
  await client.offline();
  await assert.rejects(
    () => client.mutation(api.deliveries.post as any, post("no grant")),
    (error: unknown) => error instanceof SnapbackRefusal && error.code === "E_OFFLINE_ID_BLOCK",
  );
  await client.online();
  const drain = client.subscribe(api.deliveries.inbox as any, { c: null }, () => undefined, { drain: true });
  await drain.until((value) => value.state === "complete" && value.caughtUp === true, 2_000);
  await new Promise((resolve) => setTimeout(resolve, 20));
  assert.equal(owner.grantsMinted(), 1, "the drain reaching its watermark asked for a grant");
  await client.offline();
  const queued = await client.mutation(api.deliveries.post as any, post("now queued"));
  assert.equal(queued.state, "queued");
  drain.close();
  client.close();
  await rm(root, { recursive: true, force: true });
});

test("the drain replays FIFO after resume, one envelope per request, and both settle committed in order", async () => {
  for (const carrier of await carriers()) {
    const owner = fakeOwner();
    await seededStore(carrier.factory());
    const client = createClient({ url: "http://fifo.test", as: "alice", fetch: owner.fetch, offline: { store: carrier.factory() } });
    await client.ready;
    await client.offline();
    await client.mutation(api.deliveries.post as any, post("one"));
    await client.mutation(api.deliveries.post as any, post("two"));
    await client.online();
    await client.outbox.settled();
    assert.deepEqual(owner.executions.map((item) => (item.args as any).body), ["one", "two"], carrier.name);
    const entries = await client.outbox.entries();
    assert.deepEqual(entries.map((entry) => entry.state), ["committed", "committed"]);
    assert.equal((entries[0]!.response as any).data.id, entries[0]!.ids[0], "the server minted the pinned id");
    assert.equal((entries[1]!.response as any).intent, entries[1]!.intent);
    assert.equal(owner.grantsMinted(), 2, "resume minted a fresh grant; queued intents replayed under their own");
    client.close();
    await carrier.cleanup();
  }
});

test("a 503 after a commit leaves the intent queued, stops the drain, and the retry is the same envelope exactly once", async () => {
  for (const carrier of await carriers()) {
    const owner = fakeOwner({ failAfterCommit: 1 });
    await seededStore(carrier.factory());
    const client = createClient({ url: "http://exactly-once.test", as: "alice", fetch: owner.fetch, offline: { store: carrier.factory() } });
    await client.ready;
    await client.offline();
    await client.mutation(api.deliveries.post as any, post("one"));
    await client.mutation(api.deliveries.post as any, post("two"));
    await client.online();
    await client.outbox.settled();
    let entries = await client.outbox.entries();
    assert.deepEqual(entries.map((entry) => entry.state), ["queued", "queued"], `${carrier.name}: the 503 stopped the drain`);
    assert.equal(owner.executions.length, 1, "the owner committed the first intent before answering 503");
    await client.outbox.drain();
    entries = await client.outbox.entries();
    assert.deepEqual(entries.map((entry) => entry.state), ["committed", "committed"]);
    assert.equal(owner.executions.length, 2, "the retry was answered from the ledger, not executed again");
    assert.equal((entries[0]!.response as any).data.id, entries[0]!.ids[0]);
    client.close();
    await carrier.cleanup();
  }
});

test("a rejection and a trace conflict settle only their own intent and the drain continues", async () => {
  for (const carrier of await carriers()) {
    const owner = fakeOwner({
      reject: (_intent, body) => body.args.body === "rejected",
      conflict: (_intent, body) => body.op === "deliveries.edit",
    });
    await seededStore(carrier.factory());
    const client = createClient({ url: "http://settle.test", as: "alice", fetch: owner.fetch, offline: { store: carrier.factory() } });
    await client.ready;
    await client.offline();
    await client.mutation(api.deliveries.post as any, post("rejected"));
    await client.mutation(api.deliveries.edit as any, { messageId: "message-1", body: "mine", baseBody: "theirs" });
    await client.mutation(api.deliveries.post as any, post("after"));
    await client.online();
    await client.outbox.settled();
    const entries = await client.outbox.entries();
    assert.deepEqual(entries.map((entry) => entry.state), ["rejected", "rejected", "committed"], carrier.name);
    assert.equal((entries[0]!.response as any).code, "NOT_MEMBER");
    assert.deepEqual(
      { reason: (entries[1]!.response as any).reason, code: (entries[1]!.response as any).code, site: (entries[1]!.response as any).site },
      { reason: "conflict", code: "E_OFFLINE_CONFLICT", site: "deliveries.edit.messages[messageId]" },
    );
    await client.outbox.dismiss(entries[0]!.intent);
    await client.outbox.dismiss(entries[2]!.intent);
    assert.deepEqual((await client.outbox.entries()).map((entry) => entry.state), ["rejected"], "dismiss drops settled entries");
    client.close();
    await carrier.cleanup();
  }
});

test("a grant past fenceDays refuses new intents and settles queued ones expired locally without sending", async () => {
  const root = await tempRoot();
  const owner = fakeOwner();
  await seededStore(fileRangeStore(root));
  const client = createClient({ url: "http://fence.test", as: "alice", fetch: owner.fetch, offline: { store: fileRangeStore(root), fenceDays: 2 } });
  await client.ready;
  await client.offline();
  await client.mutation(api.deliveries.post as any, post("stale"));
  const originalNow = Date.now;
  Date.now = () => originalNow() + 3 * DAY;
  try {
    await assert.rejects(
      () => client.mutation(api.deliveries.post as any, post("past the fence")),
      (error: unknown) => error instanceof SnapbackRefusal && error.code === "E_OFFLINE_INTENT_EXPIRED",
    );
    const mutations = owner.requests.filter((path) => path === "/api/mutation").length;
    await client.outbox.drain();
    assert.equal(owner.requests.filter((path) => path === "/api/mutation").length, mutations, "an expired intent is never sent");
    const entries = await client.outbox.entries();
    assert.deepEqual(entries.map((entry) => entry.state), ["expired"]);
  } finally {
    Date.now = originalNow;
    client.close();
    await rm(root, { recursive: true, force: true });
  }
});

test("a committed settlement lands in the same swap as the log tail rows, or not at all", async () => {
  const root = await tempRoot();
  const owner = fakeOwner();
  await seededStore(fileRangeStore(root));
  let failAt = -1;
  let writes = 0;
  const store = fileRangeStore(root, {
    beforeRename: () => {
      writes += 1;
      if (writes === failAt) throw new Error("disk full");
    },
  });
  const client = createClient({ url: "http://atomic.test", as: "alice", fetch: owner.fetch, offline: { store } });
  await client.ready;
  await client.offline();
  const queued = await client.mutation(api.deliveries.post as any, post("atomic"));
  assert.equal(queued.state, "queued");
  const pinned = queued.state === "queued" ? queued.ids[0]! : "";
  // online(): write 1 adopts the resume's grant, write 2 is the settlement swap.
  failAt = writes + 2;
  await assert.rejects(() => client.online(), (error: unknown) => error instanceof SnapbackRefusal && error.code === "E_OFFLINE_CARRIER");
  assert.equal(owner.executions.length, 1, "the owner committed before the local swap failed");
  const inspect = fileRangeStore(root)();
  await inspect.open("dev:alice");
  assert.equal((await inspect.outbox.all())[0]?.state, "queued", "a failed swap left the intent queued");
  assert.equal((await inspect.coverage()).rows.length, 0, "and wrote none of the tail rows");
  await inspect.close?.();
  const before = writes;
  await client.outbox.drain();
  assert.equal(writes, before + 1, "settlement and rows were one carrier write");
  const after = fileRangeStore(root)();
  await after.open("dev:alice");
  assert.equal((await after.outbox.all())[0]?.state, "committed");
  assert.deepEqual((await after.coverage()).rows.map((row) => row.id), [pinned], "the tail page holds the committed row");
  const tail = await after.answer("deliveries.inbox", { c: "cursor-9" });
  assert.equal((tail?.data as any[])[0]?.message?.id, pinned);
  await after.close?.();
  assert.equal(owner.executions.length, 1, "the replay after the failed swap was deduplicated");
  client.close();
  await rm(root, { recursive: true, force: true });
});

test("online writes carry the replay envelope under custody; a transport failure enqueues; a queued outbox keeps FIFO", async () => {
  const root = await tempRoot();
  let dead = false;
  const owner = fakeOwner({ dead: () => dead });
  await seededStore(fileRangeStore(root));
  const client = createClient({ url: "http://bytes.test", as: "alice", fetch: owner.fetch, offline: { store: fileRangeStore(root) } });
  await client.ready;
  const bodies: string[] = [];
  const spying = createClient({
    url: "http://bytes.test", as: "alice", offline: { store: fileRangeStore(root) },
    fetch: async (input, init) => {
      if (new URL(String(input)).pathname === "/api/mutation") bodies.push(String(init?.body));
      return owner.fetch(input, init);
    },
  });
  await spying.ready;
  // @ref LLP 1012#7-writes-offline — with a grant and a bound every write is
  // a durable intent replayed under the envelope, online too: the ledger makes
  // the online path exactly-once, and the settled entry leaves the queue.
  const online = await spying.mutation(api.deliveries.post as any, post("plain"));
  assert.equal(online.state, "committed");
  const sent = JSON.parse(bodies[0]!);
  assert.equal(sent.replay?.intent, online.state === "committed" ? online.intent : undefined, "an online write under custody carries the replay envelope");
  assert.deepEqual(sent.replay.trace, { points: [], verdicts: [] });
  assert.deepEqual(owner.executions.map((item) => (item.args as any).body), ["plain"]);
  assert.deepEqual(await spying.outbox.entries(), [], "an online write that settled in its own call is retired from the queue");
  spying.close();
  dead = true;
  const queued = await client.mutation(api.deliveries.post as any, post("after failure"));
  assert.equal(queued.state, "queued", "a network failure enqueues instead of throwing");
  dead = false;
  const behind = await client.mutation(api.deliveries.post as any, post("behind"));
  assert.equal(behind.state, "committed", "the queued intent drained first, then the new write settled in its own call");
  // Every write under custody entered the ledger, in order.
  assert.deepEqual(owner.executions.map((item) => (item.args as any).body), ["plain", "after failure", "behind"]);
  assert.deepEqual((await client.outbox.entries()).map((entry) => [entry.state, (entry.args as any).body]), [["committed", "after failure"]]);
  client.close();
  await rm(root, { recursive: true, force: true });
});

// @ref LLP 1012#7-writes-offline — with a partition open there is no plain-bytes
// path: no grant or no bound refuses before any request, so a 503 after a commit
// can never double-send; only a client with no store sends today's bytes.
test("a store with an open partition never sends plain bytes: no grant or no bound refuses E_OFFLINE_ID_BLOCK with no request; a client with no store sends today's bytes", async () => {
  const owner = fakeOwner();
  const bodies: string[] = [];
  const spy = async (input: string | URL | Request, init?: RequestInit) => {
    if (new URL(String(input)).pathname === "/api/mutation") bodies.push(String(init?.body));
    return owner.fetch(input, init);
  };
  // No grant: a fresh partition that neither logged in nor drained a query.
  const grantlessRoot = await tempRoot();
  const grantless = createClient({ url: "http://custody.test", as: "alice", fetch: spy, offline: { store: fileRangeStore(grantlessRoot) } });
  await grantless.ready;
  assert.equal(owner.grantsMinted(), 0);
  await assert.rejects(
    () => grantless.mutation(api.deliveries.post as any, post("no grant")),
    (error: unknown) => error instanceof SnapbackRefusal && error.code === "E_OFFLINE_ID_BLOCK"
      && error.envelope.family === "offline" && /grant/.test(error.message) && typeof error.envelope.rewrite === "string",
  );
  assert.deepEqual(bodies, [], "no grant: no request left the device");
  grantless.close();
  await rm(grantlessRoot, { recursive: true, force: true });
  // No bound: a partition with a grant whose /api/program answered 404, so the write cannot be priced.
  const unboundRoot = await tempRoot();
  await seededStore(fileRangeStore(unboundRoot));
  const unbound = createClient({
    url: "http://custody.test", as: "alice", offline: { store: fileRangeStore(unboundRoot) },
    fetch: async (input, init) => new URL(String(input)).pathname === "/api/program"
      ? new Response(JSON.stringify({ code: "E_OP_UNKNOWN", family: "op", message: "not active", guide: "op/manifest" }), { status: 404, headers: { "content-type": "application/json" } })
      : spy(input, init),
  });
  await unbound.ready;
  assert.equal(owner.grantsMinted(), 1, "the resume minted a grant");
  await assert.rejects(
    () => unbound.mutation(api.deliveries.post as any, post("no bound")),
    (error: unknown) => error instanceof SnapbackRefusal && error.code === "E_OFFLINE_ID_BLOCK" && /bound/.test(error.message),
  );
  assert.deepEqual(bodies, [], "no bound: no request left the device");
  assert.deepEqual(await unbound.outbox.entries(), [], "a refused write is not an intent");
  unbound.close();
  await rm(unboundRoot, { recursive: true, force: true });
  // No store: today's bytes, byte-identical.
  const plain = createClient({ url: "http://custody.test", as: "alice", fetch: spy });
  assert.equal((await plain.mutation(api.deliveries.post as any, post("no store"))).state, "committed");
  assert.deepEqual(bodies, [JSON.stringify({ op: "deliveries.post", args: post("no store") })], "no store, no envelope");
  plain.close();
});

test("useMutation resolves last queued offline with pending filtered by op, and useOutbox lists the outbox at cold start", async () => {
  const root = await tempRoot();
  const owner = fakeOwner();
  await seededStore(fileRangeStore(root));
  let posting: any;
  let editing: any;
  let outbox: any;
  let client: any;
  function Harness() {
    posting = useMutation(api.deliveries.post as any);
    editing = useMutation(api.deliveries.edit as any);
    outbox = useOutbox();
    client = useSnapbackClient();
    return null;
  }
  const offline = { store: fileRangeStore(root) };
  let renderer: TestRenderer.ReactTestRenderer;
  await act(async () => {
    renderer = TestRenderer.create(React.createElement(
      SnapbackProvider,
      { url: "http://hooks.test", as: "alice", fetch: owner.fetch, offline },
      React.createElement(Harness),
    ));
  });
  await act(async () => { await client.ready; await client.offline(); });
  let result: any;
  await act(async () => { result = await posting.run(post("from the hook")); });
  assert.equal(result.state, "queued");
  await act(async () => { await editing.run({ messageId: "message-1", body: "b", baseBody: "a" }); });
  await act(async () => { await new Promise((resolve) => setTimeout(resolve, 10)); });
  assert.equal(posting.last.state, "queued");
  assert.equal(posting.last.intent, result.intent);
  assert.deepEqual(posting.pending.map((entry: any) => entry.op), ["deliveries.post"], "pending is this op's queued intents");
  assert.deepEqual(editing.pending.map((entry: any) => entry.op), ["deliveries.edit"]);
  assert.equal(posting.inFlight, false);
  assert.deepEqual(outbox.entries.map((entry: any) => [entry.op, entry.state]), [["deliveries.post", "queued"], ["deliveries.edit", "queued"]]);
  await act(async () => { renderer!.unmount(); });

  // Cold start on the same partition with the network dead: the outbox is on screen before any request.
  let dead = true;
  const deadOwner = fakeOwner({ dead: () => dead });
  await act(async () => {
    renderer = TestRenderer.create(React.createElement(
      SnapbackProvider,
      { url: "http://hooks-cold.test", as: "alice", fetch: deadOwner.fetch, offline },
      React.createElement(Harness),
    ));
  });
  await act(async () => { await new Promise((resolve) => setTimeout(resolve, 30)); });
  assert.deepEqual(outbox.entries.map((entry: any) => entry.state), ["queued", "queued"], "durable across a cold start");
  assert.equal(posting.pending.length, 1);
  await act(async () => { renderer!.unmount(); });
  dead = false;
  await rm(root, { recursive: true, force: true });
});

test("useOutbox survives restart(): the queue is intact and settles through the restarted client", async () => {
  const root = await tempRoot();
  const owner = fakeOwner();
  await seededStore(fileRangeStore(root));
  const client = createClient({ url: "http://restart.test", as: "alice", fetch: owner.fetch, offline: { store: fileRangeStore(root) } });
  await client.ready;
  await client.offline();
  await client.mutation(api.deliveries.post as any, post("before restart"));
  const cold = await client.restart();
  assert.equal(cold.snapshot.connection, "offline", "a restart of a cut device boots cut");
  const seen: any[][] = [];
  const unsubscribe = cold.outbox.subscribe((entries) => seen.push(entries));
  await new Promise((resolve) => setTimeout(resolve, 10));
  assert.deepEqual(seen.at(-1)?.map((entry: any) => entry.state), ["queued"]);
  assert.equal(owner.executions.length, 0, "nothing was sent while cut");
  await cold.online();
  await cold.outbox.settled();
  assert.deepEqual(seen.at(-1)?.map((entry: any) => entry.state), ["committed"], "subscribers saw the settlement");
  unsubscribe();
  cold.close();
  await rm(root, { recursive: true, force: true });
});

test("SnapbackProvider under StrictMode creates one lock-holding client and survives the simulated unmount", async () => {
  const owner = fakeOwner({ seed: true });
  const database = new FakeIndexedDb();
  const locks = new FakeLocks();
  const offline = { store: indexedDbRangeStore({ indexedDB: database as any, locks: locks as any }) };
  let client: any;
  let outbox: any;
  function Harness() {
    client = useSnapbackClient();
    outbox = useOutbox();
    return null;
  }
  let renderer: TestRenderer.ReactTestRenderer;
  await act(async () => {
    renderer = TestRenderer.create(React.createElement(
      StrictMode,
      null,
      React.createElement(
        SnapbackProvider,
        { url: "http://strict.test", as: "alice", fetch: owner.fetch, offline },
        React.createElement(Harness),
      ),
    ));
  });
  await act(async () => { await client.ready; await new Promise((resolve) => setTimeout(resolve, 20)); });
  assert.notEqual(client.snapshot.lastRefusal?.code, "E_OFFLINE_LOCK", "the discarded StrictMode client must not hold the principal's lock");
  const held = await client.query(api.deliveries.inbox as any, { c: null });
  assert.equal(held.state, "complete", "the surviving client is open after StrictMode's simulated unmount");
  assert.deepEqual(outbox.entries, []);
  await act(async () => { renderer!.unmount(); });
  await new Promise((resolve) => setTimeout(resolve, 10));
  assert.equal(client.snapshot.connection, "offline", "a real unmount closes the client one tick later");
});

test("a cold start with the owner unreachable serves the held log and the outbox before any metadata arrives", async () => {
  const root = await tempRoot();
  const owner = fakeOwner({ seed: true });
  await seededStore(fileRangeStore(root));
  const warm = createClient({ url: "http://cold.test", as: "alice", fetch: owner.fetch, offline: { store: fileRangeStore(root) } });
  await warm.ready;
  const drain = warm.subscribe(api.deliveries.inbox as any, { c: null }, () => undefined, { drain: true });
  await drain.until((value) => value.state === "complete" && value.caughtUp === true, 2_000);
  drain.close();
  await warm.offline();
  const queued = await warm.mutation(api.deliveries.post as any, post("cold"));
  assert.equal(queued.state, "queued");
  warm.close();
  let dead = true;
  const cold = createClient({ url: "http://cold.test", as: "alice", fetch: async (input, init) => {
    if (dead) throw new TypeError("fetch failed");
    return owner.fetch(input, init);
  }, offline: { store: fileRangeStore(root) } });
  await cold.ready;
  const held = await cold.query<any, any>(api.deliveries.inbox as any, { c: null });
  assert.equal(held.state, "complete");
  assert.equal("connection" in held && held.connection, "offline");
  assert.ok(Array.isArray(held.data) && held.data.some((row: any) => row.message?.body === "Welcome"), "the drained log answers from the store");
  assert.deepEqual((await cold.outbox.entries()).map((entry) => entry.state), ["queued"]);
  const tail = cold.subscribe(api.deliveries.inbox as any, { c: null }, () => undefined, { drain: true });
  const caught = await tail.until((value) => (value.state === "complete" || value.state === "capped") && value.caughtUp === true, 3_000);
  assert.equal("connection" in caught && caught.connection, "offline", "the drain reaches its held watermark without the owner");
  tail.close();
  dead = false;
  await cold.online();
  await cold.outbox.settled();
  assert.deepEqual((await cold.outbox.entries()).map((entry) => entry.state), ["committed"], "the reach replays the queue");
  cold.close();
  await rm(root, { recursive: true, force: true });
});

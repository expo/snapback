import assert from "node:assert/strict";
import { test } from "node:test";
import { api, isSnapbackRefusal } from "../dist/client.mjs";
import { indexedDbRangeStore } from "../dist/react.mjs";
import { fixtureClient as createClient } from "./live-fixture.ts";
import { fakeOwner } from "./fake-owner.ts";
import { FakeIndexedDb, FakeLocks } from "./fake-indexeddb.ts";

async function until(condition: () => Promise<boolean> | boolean, what: string, timeoutMs = 5_000): Promise<void> {
  const deadline = Date.now() + timeoutMs;
  while (!(await condition())) {
    if (Date.now() > deadline) throw new Error(`timed out waiting for ${what}`);
    await new Promise<void>((resolve) => setTimeout(resolve, 10));
  }
}

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
  first.close();
  second.close();
  assert.equal(client.sharedConsumers(api.deliveries.inbox, { c: null }, true), 0);
  await client.close();
});

// @ref LLP 1018#3-move-one-one-coherent-reactive-client — the browser tab policy:
// a second tab of the same account reads live, refuses writes with a named
// reason, and inherits the partition and its queue when the writer tab closes.
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
  assert.equal((await follower.outbox.status()).reason, "follower");
  assert.equal((await follower.outbox.status()).ready, false);
  const read = await follower.query(api.deliveries.thread, { conversationId: "conversation-1", c: null });
  assert.equal(read.state, "complete", "a follower reads live");
  await assert.rejects(
    follower.mutation(api.deliveries.post, { conversationId: "conversation-1", body: "from the follower" }),
    (error: unknown) => isSnapbackRefusal(error) && error.code === "E_OFFLINE_FOLLOWER",
  );
  assert.equal(owner.executions.length, 0, "a follower never sends plain bytes");

  await writer.offline();
  const queued = await writer.mutation(api.deliveries.post, { conversationId: "conversation-1", body: "queued in the writer tab" });
  assert.equal(queued.state, "queued");
  inbox.close();
  await writer.close();

  // The lock passes to the follower: it opens the partition and replays the inherited intent.
  await until(async () => (await follower.outbox.status()).reason !== "follower", "the takeover");
  await until(() => owner.executions.some((execution) => execution.intent === queued.intent), "the inherited replay");
  assert.equal(owner.executions.length, 1);
  const after = await follower.mutation(api.deliveries.post, { conversationId: "conversation-1", body: "from the new writer" });
  assert.equal(after.state, "committed");
  await follower.close();
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
  assert.equal((await follower.outbox.status()).reason, "follower");
  await follower.close();
  await writer.close();
  const next = createClient({ url: "http://tabs-close.test", as: "alice", fetch: owner.fetch, offline: { store } });
  await next.ready;
  assert.notEqual((await next.outbox.status()).reason, "follower", "the closed follower did not take the lock");
  await next.close();
});

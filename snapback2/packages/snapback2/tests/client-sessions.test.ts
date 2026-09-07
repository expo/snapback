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

  let raw: any;
  const subscription = client.subscribe(api.deliveries.thread, args, (event) => { raw = event; });
  await until(() => raw?.state === "complete", "the current raw delivery replay");
  assert.strictEqual(raw.data, (first.getSnapshot() as any).data, "raw and observed consumers share the current value");
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
  assert.equal((await follower.outbox.status()).reason, "follower");
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
  assert.equal((await follower.outbox.status()).reason, "follower");
  await writer.close();
  await until(async () => (await follower.outbox.status()).reason !== "follower", "the bearer takeover");
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

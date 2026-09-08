import assert from "node:assert/strict";
import { test } from "node:test";
import { api, isSnapbackRefusal } from "../dist/client.mjs";
import { indexedDbRangeStore } from "../dist/react.mjs";
import { inboxAlias, INBOX_LIMIT } from "../dist/client-observed-test.mjs";
import { fixtureClient as createClient } from "./live-fixture.ts";
import { fakeOwner } from "./fake-owner.ts";
import { FakeIndexedDb, FakeLocks } from "./fake-indexeddb.ts";

// @ref LLP 1018.004#2-the-inbox — a follower tab's write is a durable row in the
// partition's database before `run()` resolves; the writer admits rows through
// its ledger, in key order, in the same transaction as the entry each becomes.
// @ref LLP 1018.004#6-the-test-fake-and-the-witness — proven on the fake that
// models scope, scheduling, `versionchange`, and blocked deletion.

async function until(condition: () => Promise<boolean> | boolean, what: string, timeoutMs = 5_000): Promise<void> {
  const deadline = Date.now() + timeoutMs;
  while (!(await condition())) {
    if (Date.now() > deadline) throw new Error(`timed out waiting for ${what}`);
    await new Promise<void>((resolve) => setTimeout(resolve, 10));
  }
}

function tabs(options: { grant?: boolean } = {}) {
  const database = new FakeIndexedDb();
  const locks = new FakeLocks();
  const store = indexedDbRangeStore({ indexedDB: database as any, locks: locks as any });
  const owner = fakeOwner({ seed: true, cursorArg: "c" });
  const open = () => createClient({ url: "http://tabs.test", as: "alice", fetch: owner.fetch, offline: { store } });
  return { database, locks, store, owner, open, grant: options.grant ?? true };
}

/** The writer earns its replay grant through the recipe's drain. */
async function earnGrant(writer: any): Promise<() => void> {
  const inbox = writer.subscribe(api.deliveries.inbox, { c: null }, () => undefined, { drain: true });
  await inbox.until((event: any) => event.state === "complete" && event.caughtUp === true, 2_000);
  await until(async () => (await writer.outbox.status()).ready, "the writer's grant");
  return () => inbox.close();
}

test("a follower's write is a durable inbox row before run() resolves; the writer admits it and the follower reads the ledger entry", async () => {
  const { owner, open } = tabs();
  const writer = open();
  await writer.ready;
  const closeDrain = await earnGrant(writer);
  const follower = open();
  await follower.ready;
  await until(async () => (await follower.outbox.status()).reason === "forwarding", "the follower's inbox route");
  const sent = await follower.mutation(api.deliveries.post, { conversationId: "conversation-1", body: "from the follower" });
  assert.equal(sent.state, "queued");
  assert.equal(sent.intent, inboxAlias(1), "the public intent is the row's alias");
  assert.deepEqual(sent.ids, [], "no ids until the writer admits");
  await until(() => owner.executions.some((execution) => (execution.args as any).body === "from the follower"), "the writer's admission and replay");
  assert.equal(owner.executions.filter((execution) => (execution.args as any).body === "from the follower").length, 1, "exactly one execution");
  // The writer's grant slice for the recipe's post is 1 + maxNewIds, not one id: fan-out rows are minted from it too.
  await until(async () => (await follower.outbox.entries()).some((entry) => entry.inbox === 1 && entry.ids.length > 0), "the follower reading the ledger entry");
  const entries = await follower.outbox.entries();
  const admitted = entries.filter((entry) => entry.inbox === 1);
  assert.equal(admitted.length, 1, "an admitted row appears once, as its entry");
  assert.notEqual(admitted[0]!.intent, inboxAlias(1), "the entry carries the ledger intent");
  assert.equal(admitted[0]!.state, "committed");
  const writerEntries = await writer.outbox.entries();
  assert.deepEqual(writerEntries.map((entry) => entry.inbox), [1], "the writer's ledger records the row it admitted from");
  // The alias resolves to the entry on the follower and, being a settled entry, is dismissible from either tab.
  await follower.outbox.dismiss(inboxAlias(1));
  await until(async () => !(await writer.outbox.entries()).some((entry) => entry.inbox === 1), "the durable dismissal consumed by the writer");
  closeDrain();
  await follower.close();
  await writer.close();
});

test("the writer admits durable follower rows before its own write, so the device's order is the ledger's", async () => {
  const { owner, open } = tabs();
  const writer = open();
  await writer.ready;
  const closeDrain = await earnGrant(writer);
  const follower = open();
  await follower.ready;
  await until(async () => (await follower.outbox.status()).reason === "forwarding", "the follower's inbox route");
  await writer.offline();
  const first = await writer.mutation(api.deliveries.post, { conversationId: "conversation-1", body: "writer first" });
  const middle = await follower.mutation(api.deliveries.post, { conversationId: "conversation-1", body: "follower middle" });
  const second = await writer.mutation(api.deliveries.post, { conversationId: "conversation-1", body: "writer second" });
  assert.deepEqual([first.state, middle.state, second.state], ["queued", "queued", "queued"]);
  const entries = await writer.outbox.entries();
  assert.deepEqual(entries.map((entry) => (entry.args as any).body), ["writer first", "follower middle", "writer second"],
    "a local write is admitted behind every row durable before it");
  assert.equal(entries[1]!.inbox, 1);
  await writer.online();
  await writer.outbox.settled();
  assert.deepEqual(owner.executions.map((execution) => (execution.args as any).body), ["writer first", "follower middle", "writer second"]);
  closeDrain();
  await follower.close();
  await writer.close();
});

test("a reloaded follower shows its device's queued rows from durable state, and a grant arriving later admits them", async () => {
  const { owner, open } = tabs();
  // No drain yet: the writer holds no grant, so admission refuses temporarily and rows stay queued.
  const writer = open();
  await writer.ready;
  const follower = open();
  await follower.ready;
  await until(async () => (await follower.outbox.status()).reason === "forwarding", "the follower's inbox route");
  const a = await follower.mutation(api.deliveries.post, { conversationId: "conversation-1", body: "saved a" });
  const b = await follower.mutation(api.deliveries.post, { conversationId: "conversation-1", body: "saved b" });
  assert.deepEqual([a.intent, b.intent], [inboxAlias(1), inboxAlias(2)]);
  await follower.close();
  const reloaded = open();
  await reloaded.ready;
  await until(async () => (await reloaded.outbox.entries()).length === 2, "the reloaded tab's durable rows");
  const rows = await reloaded.outbox.entries();
  assert.deepEqual(rows.map((entry) => [entry.intent, entry.state, entry.ids.length, entry.inbox]), [[inboxAlias(1), "queued", 0, 1], [inboxAlias(2), "queued", 0, 2]]);
  const pending = await reloaded.outbox.status();
  assert.equal(pending.remaining, 2);
  assert.equal(pending.ready, true, "durable rows keep the follower sendable");
  // The writer's grant arrives; the ledger change retries admission without a nudge.
  const closeDrain = await earnGrant(writer);
  await until(() => owner.executions.filter((execution) => String((execution.args as any).body).startsWith("saved ")).length === 2, "both rows admitted and replayed after the grant");
  assert.deepEqual(owner.executions.map((execution) => (execution.args as any).body), ["saved a", "saved b"], "key order is the device's durable order");
  closeDrain();
  await reloaded.close();
  await writer.close();
});

test("the inbox refuses at its bound with no row written, and a row from another scope or epoch is rejected at admission and dismissible", async () => {
  const { owner, open } = tabs();
  const writer = open();
  await writer.ready;
  const follower = open();
  await follower.ready;
  await until(async () => (await follower.outbox.status()).reason === "forwarding", "the follower's inbox route");
  for (let index = 0; index < INBOX_LIMIT; index += 1) {
    await follower.mutation(api.deliveries.post, { conversationId: "conversation-1", body: `bulk ${index}` });
  }
  await assert.rejects(follower.mutation(api.deliveries.post, { conversationId: "conversation-1", body: "one too many" }),
    (error: unknown) => isSnapbackRefusal(error) && error.code === "E_OFFLINE_INBOX_FULL");
  assert.equal((await follower.outbox.status()).reason, "inbox-full");
  assert.equal((await follower.outbox.entries()).length, INBOX_LIMIT, "no row for the refused write");
  // Arguments the ledger cannot persist are refused before any row exists.
  await assert.rejects(follower.mutation(api.deliveries.post, { conversationId: "conversation-1", body: 10n as any }),
    (error: unknown) => isSnapbackRefusal(error) && error.code === "E_OFFLINE_ARGUMENTS");
  await follower.close();
  await writer.close();

  const second = tabs();
  const writer2 = second.open();
  await writer2.ready;
  const closeDrain = await earnGrant(writer2);
  const follower2 = second.open();
  await follower2.ready;
  await until(async () => (await follower2.outbox.status()).reason === "forwarding", "the second follower's inbox route");
  const runtime = (follower2 as any).offlineRuntime;
  const now = Date.now();
  const key = await runtime.insertInbox({ kind: "mutation", scope: "another backend", principal: "dev:alice", followerId: "test",
    op: "deliveries.post", args: { conversationId: "conversation-1", body: "foreign" }, state: "queued", ids: [], createdAt: now, updatedAt: now });
  await (writer2 as any).inbox.admit();
  await until(async () => (await follower2.outbox.entries()).some((entry) => entry.inbox === key && entry.state === "rejected"), "the identity rejection");
  const rejected = (await follower2.outbox.entries()).find((entry) => entry.inbox === key)!;
  assert.equal((rejected.response as any).code, "E_OFFLINE_FORWARDING_IDENTITY");
  assert.equal(second.owner.executions.length, 0, "a rejected row creates no entry and no execution");
  await follower2.outbox.dismiss(inboxAlias(key));
  await until(async () => !(await follower2.outbox.entries()).some((entry) => entry.inbox === key), "the rejected row deleted by its follower");
  closeDrain();
  await follower2.close();
  await writer2.close();
});

test("takeover admits the rows the closed writer left, before its first resume, and replays them once", async () => {
  const { owner, open } = tabs();
  const writer = open();
  await writer.ready;
  const follower = open();
  await follower.ready;
  await until(async () => (await follower.outbox.status()).reason === "forwarding", "the follower's inbox route");
  await follower.mutation(api.deliveries.post, { conversationId: "conversation-1", body: "left behind a" });
  await follower.mutation(api.deliveries.post, { conversationId: "conversation-1", body: "left behind b" });
  assert.equal(owner.executions.length, 0, "the grantless writer admitted nothing");
  await writer.close();
  await until(() => !(follower as any).offlineRuntime.following, "the follower marker clearing after takeover");
  const closeDrain = await earnGrant(follower);
  await until(() => owner.executions.filter((execution) => String((execution.args as any).body).startsWith("left behind")).length === 2, "the inherited rows replayed");
  assert.deepEqual(owner.executions.map((execution) => (execution.args as any).body), ["left behind a", "left behind b"]);
  const entries = await follower.outbox.entries();
  assert.deepEqual(entries.map((entry) => entry.inbox), [1, 2], "the new writer's ledger records the rows it admitted from");
  assert.ok(entries.every((entry) => entry.state === "committed"));
  closeDrain();
  await follower.close();
});

test("the carrier: a follower connection closes on versionchange, and a wipe under the lock deletes the database beneath it", async () => {
  const database = new FakeIndexedDb();
  const locks = new FakeLocks();
  const factory = indexedDbRangeStore({ indexedDB: database as any, locks: locks as any });
  const store: any = factory();
  await store.open("dev:alice");
  const connection = await store.inbox("dev:alice");
  const now = Date.now();
  const key = await connection.insert({ kind: "mutation", scope: "s", principal: "dev:alice", followerId: "f", op: "deliveries.post",
    args: { body: "x" }, state: "queued", ids: [], createdAt: now, updatedAt: now });
  assert.equal(key, 1, "the database assigns the first key");
  assert.deepEqual((await store.inboxRows()).map((row: any) => [row.key, row.state]), [[1, "queued"]], "the writer reads the follower's row");
  // A writer swap and a follower insertion overlap on the inbox store; neither is lost.
  await Promise.all([
    store.commit({ inbox: { put: [{ ...(await store.inboxRows())[0], admitted: "grant:0", ids: ["id-1"], updatedAt: now }] } }),
    connection.insert({ kind: "mutation", scope: "s", principal: "dev:alice", followerId: "f", op: "deliveries.post",
      args: { body: "y" }, state: "queued", ids: [], createdAt: now, updatedAt: now }),
  ]);
  assert.deepEqual((await connection.rows()).map((row: any) => [row.key, row.admitted]), [[1, "grant:0"], [2, undefined]]);
  assert.equal(database.connections("snapback2:dev:alice"), 2, "the writer and the follower each hold a connection");
  await store.wipe("dev:alice");
  assert.equal(connection.ended, true, "the follower connection closed on versionchange");
  assert.equal(database.has("snapback2:dev:alice"), false, "the deletion completed beneath the open follower connection");
  assert.ok(database.events.some((event) => event.event === "versionchange" && event.reason === "delete"));
  await assert.rejects(connection.insert({ kind: "mutation", scope: "s", principal: "dev:alice", followerId: "f", op: "deliveries.post",
    args: { body: "z" }, state: "queued", ids: [], createdAt: now, updatedAt: now }), /inbox connection has ended/);
  await store.close();
});

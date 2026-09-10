import { assertRefused } from "./live-fixture.ts";
import { subscribe } from "../src/internal.js";
import assert from "node:assert/strict";
import { test } from "node:test";
import { api,  mutationTarget } from "../dist/client.mjs";
import { isRefusalError } from "../dist/client-observed-test.mjs";
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

function tabs(options: { grant?: boolean; refuse?: NonNullable<Parameters<typeof fakeOwner>[0]>["refuse"] } = {}) {
  const database = new FakeIndexedDb();
  const locks = new FakeLocks();
  const store = indexedDbRangeStore({ indexedDB: database as any, locks: locks as any });
  const owner = fakeOwner({ seed: true, cursorArg: "c", refuse: options.refuse });
  const open = () => createClient({ url: "http://tabs.test", persona: "alice", fetch: owner.fetch, offline: { store } });
  return { database, locks, store, owner, open, grant: options.grant ?? true };
}

for (const [cold, target] of [[false, "alias"], [true, "alias"], [true, "intent"]] as const) test(`completed dismissal returns its bytes once after ${cold ? "cold reopen" : "takeover"} (${target} command)`, async () => {
  const refusal = { code: "E_INPUT", family: "input", message: "enum case removed", guide: "input/runtime" };
  const { owner, open } = tabs({ refuse: (_intent, body) => body.args.body === "removed" ? { status: 400, envelope: refusal } : undefined });
  const writer = open(); await writer.ready;
  const closeDrain = await earnGrant(writer);
  await writer.offline();
  const follower = open(); await follower.ready;
  let successor = follower;
  let release!: () => void;
  const paused = new Promise<void>(resolve => { release = resolve; });
  try {
    await until(async () => (await follower.outbox.status()).reason === "forwarding", "follower route");
    const args = { conversationId: "conversation-1", body: "removed" };
    const first = await follower.mutation(api.messages.send, args);
    await follower.mutation(api.messages.send, { ...args, body: "after" });
    await until(async () => (await writer.outbox.entries()).filter(e => e.grant).length === 2, "writer admission");
    await assert.rejects(writer.online(), { code: "E_INPUT" });
    await writer.offline();
    const head = (await writer.outbox.entries())[0]!;
    const inbox = (follower as any).inbox;
    const runtime = (follower as any).offlineRuntime;
    const refresh = inbox.refresh.bind(inbox);
    let waiting = false;
    inbox.refresh = async () => {
      await refresh();
      if (runtime.inboxRows.some((row: any) => row.kind === "dismiss" && row.state === "done")) {
        waiting = true;
        await paused;
      }
    };
    const pending = follower.outbox.dismiss(target === "alias" ? first.intent! : head.intent).then(value => ({ value }), error => ({ error }));
    await until(() => waiting, "follower paused before consuming completed result");
    const writerRuntime = (writer as any).offlineRuntime;
    const identity = { scope: (writer as any).inbox.scope("dev:alice"), principal: "dev:alice", authEpoch: writerRuntime.authEpoch };
    for (const foreign of [{ ...identity, scope: "another backend" }, { ...identity, principal: "dev:bob" }]) {
      assert.equal(await writerRuntime.outbox.dismiss(first.intent!, undefined, foreign), undefined, "completed results are scoped");
    }
    if (cold) await follower.close();
    await writer.close();
    if (cold) { successor = open(); await successor.ready; }
    await until(() => !(successor as any).offlineRuntime.following, "new writer");
    release();
    assert.ok("error" in await pending, "the old role cannot publish the result");
    const recovered = await successor.outbox.dismiss(first.intent!);
    assert.deepEqual(recovered, { intent: head.intent, op: head.op, args, refusal });
    assert.equal(await successor.outbox.dismiss(first.intent!), undefined, "returned only once");
    const rows = await (successor as any).offlineRuntime.store.inboxRows();
    assert.equal(rows.some((row: any) => row.kind === "dismiss"), false, "completed command cleaned up");
    await successor.online();
    await successor.outbox.drain();
    assert.deepEqual(owner.executions.map(e => (e.args as any).body), ["after"], "only the next intent replays");
  } finally { release(); closeDrain(); await successor.close(); await follower.close(); await writer.close(); }
});

/** The writer earns its replay grant through the recipe's drain. */
async function earnGrant(writer: any): Promise<() => void> {
  const inbox = subscribe(writer, api.messages.inbox, { c: null }, () => undefined, { drain: true });
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
  const target = mutationTarget(api.messages.send, "messages");
  const sent = await follower.mutation(target, { conversationId: "conversation-1", body: "from the follower" });
  assert.equal(sent.state, "queued");
  assert.equal(sent.intent, inboxAlias(1), "the public intent is the row's alias");
  assert.deepEqual(sent.ids, [], "no ids until the writer admits");
  await until(() => owner.executions.some((execution) => (execution.args as any).body === "from the follower"), "the writer's admission and replay");
  assert.equal(owner.executions.filter((execution) => (execution.args as any).body === "from the follower").length, 1, "exactly one execution");
  // The writer's grant slice for the recipe's post is 1 + maxNewIds, not one id: fan-out rows are minted from it too.
  // The follower learns admission from one nudge and settlement from a later one; wait for the settled entry.
  await until(async () => (await follower.outbox.entries()).some((entry) => entry.inbox === 1 && entry.ids.length > 0 && entry.state === "committed"),
    "the follower reading the settled ledger entry");
  const entries = await follower.outbox.entries();
  const admitted = entries.filter((entry) => entry.inbox === 1);
  assert.equal(admitted.length, 1, "an admitted row appears once, as its entry");
  assert.notEqual(admitted[0]!.intent, inboxAlias(1), "the entry carries the ledger intent");
  assert.equal(admitted[0]!.state, "committed");
  assert.equal(admitted[0]!.presentation, "messages", "the selected target survives durable follower admission");
  assert.equal(target.id(admitted[0]!), admitted[0]!.ids[0], "the writer attaches its certified message address");
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
  const first = await writer.mutation(api.messages.send, { conversationId: "conversation-1", body: "writer first" });
  const middle = await follower.mutation(api.messages.send, { conversationId: "conversation-1", body: "follower middle" });
  const second = await writer.mutation(api.messages.send, { conversationId: "conversation-1", body: "writer second" });
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
  const a = await follower.mutation(api.messages.send, { conversationId: "conversation-1", body: "saved a" });
  const b = await follower.mutation(api.messages.send, { conversationId: "conversation-1", body: "saved b" });
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
  const filled = await Promise.all(Array.from({ length: INBOX_LIMIT }, (_, index) =>
    follower.mutation(api.messages.send, { conversationId: "conversation-1", body: `bulk ${index}` })));
  assert.ok(filled.every(result => result.state === "queued"), "every slot is admitted before the bound refuses");
  await assertRefused(follower.mutation(api.messages.send, { conversationId: "conversation-1", body: "one too many" }),
    (error: unknown) => (error.state === "rejected" || error.state === "refused") && error.code === "E_OFFLINE_INBOX_FULL");
  assert.equal((await follower.outbox.status()).reason, "inbox-full");
  assert.equal((await follower.outbox.entries()).length, INBOX_LIMIT, "no row for the refused write");
  // Arguments the ledger cannot persist are refused before any row exists.
  await assertRefused(follower.mutation(api.messages.send, { conversationId: "conversation-1", body: 10n as any }),
    (error: unknown) => (error.state === "rejected" || error.state === "refused") && error.code === "E_OFFLINE_ARGUMENTS");
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
    op: "messages.send", args: { conversationId: "conversation-1", body: "foreign" }, state: "queued", ids: [], createdAt: now, updatedAt: now });
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
  await follower.mutation(api.messages.send, { conversationId: "conversation-1", body: "left behind a" });
  await follower.mutation(api.messages.send, { conversationId: "conversation-1", body: "left behind b" });
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
  const key = await connection.insert({ kind: "mutation", scope: "s", principal: "dev:alice", followerId: "f", op: "messages.send",
    args: { body: "x" }, state: "queued", ids: [], createdAt: now, updatedAt: now });
  assert.equal(key, 1, "the database assigns the first key");
  assert.deepEqual((await store.inboxRows()).map((row: any) => [row.key, row.state]), [[1, "queued"]], "the writer reads the follower's row");
  // A writer swap and a follower insertion overlap on the inbox store; neither is lost.
  await Promise.all([
    store.commit({ inbox: { put: [{ ...(await store.inboxRows())[0], admitted: "grant:0", ids: ["id-1"], updatedAt: now }] } }),
    connection.insert({ kind: "mutation", scope: "s", principal: "dev:alice", followerId: "f", op: "messages.send",
      args: { body: "y" }, state: "queued", ids: [], createdAt: now, updatedAt: now }),
  ]);
  assert.deepEqual((await connection.rows()).map((row: any) => [row.key, row.admitted]), [[1, "grant:0"], [2, undefined]]);
  assert.equal(database.connections("snapback2:dev:alice"), 2, "the writer and the follower each hold a connection");
  await store.wipe("dev:alice");
  assert.equal(connection.ended, true, "the follower connection closed on versionchange");
  assert.equal(database.has("snapback2:dev:alice"), false, "the deletion completed beneath the open follower connection");
  assert.ok(database.events.some((event) => event.event === "versionchange" && event.reason === "delete"));
  await assert.rejects(connection.insert({ kind: "mutation", scope: "s", principal: "dev:alice", followerId: "f", op: "messages.send",
    args: { body: "z" }, state: "queued", ids: [], createdAt: now, updatedAt: now }), /inbox connection has ended/);
  await store.close();
});

test("a follower dismisses a refused queued intent with its original bytes and blocked status; FIFO continues", async () => {
  const refusal = { code: "E_INPUT", family: "input", message: "enum case removed", guide: "input/runtime" };
  const { owner, open } = tabs({ refuse: (_intent, body) => body.args.body === "removed" ? { status: 400, envelope: refusal } : undefined });
  const writer = open(); await writer.ready;
  const closeDrain = await earnGrant(writer);
  await writer.offline();
  const follower = open(); await follower.ready;
  try {
    await until(async () => (await follower.outbox.status()).reason === "forwarding", "follower route");
    const args = { conversationId: "conversation-1", body: "removed" };
    const first = await follower.mutation(api.messages.send, args);
    const second = await follower.mutation(api.messages.send, { ...args, body: "after" });
    await until(async () => (await writer.outbox.entries()).filter(e => e.grant).length === 2, "writer admission");
    await assert.rejects(writer.online(), { code: "E_INPUT" });
    await until(async () => (await follower.outbox.entries()).some(e => e.refusal?.code === "E_INPUT"), "durable refusal");
    const head = (await writer.outbox.entries())[0]!;
    assert.deepEqual((await follower.outbox.status()).blocked, { intent: head.intent, code: "E_INPUT" });
    assert.equal(await follower.outbox.dismiss(second.intent!), undefined, "an unrefused queued entry is ineligible through the inbox too");
    const dismissed = await follower.outbox.dismiss(first.intent!);
    assert.deepEqual(dismissed, { intent: head.intent, op: head.op, args, refusal });
    assert.deepEqual(await writer.outbox.drain(), { stopped: false, remaining: 0 });
    await until(async () => !(await follower.outbox.status()).blocked, "cleared blocked status");
    assert.deepEqual(owner.executions.map(e => (e.args as any).body), ["after"]);
  } finally { closeDrain(); await follower.close(); await writer.close(); }
});

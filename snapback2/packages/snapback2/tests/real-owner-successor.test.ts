import assert from "node:assert/strict";
import { test } from "node:test";
import { api, createClient } from "../dist/client.mjs";
import { RealOwnerHarness } from "./owner-harness.ts";

// @ref LLP 1018#6-move-four-evolution-of-the-whole-application —
// evolve populated data while real client intents remain in durable custody.
test("durable client intents survive a schema successor and a lost acknowledgement survives operation removal", async (t) => {
  if (process.env.SNAPBACK_URL) return t.skip("requires an isolated self-started successor owner");
  const { mkdtemp, readFile, writeFile, rm } = await import("node:fs/promises");
  const { tmpdir } = await import("node:os");
  const { join } = await import("node:path");
  const { fileRangeStore } = await import("../dist/test.mjs");
  const previousUrl = process.env.SNAPBACK_URL;
  delete process.env.SNAPBACK_URL;
  let local: RealOwnerHarness | undefined;
  const directory = await mkdtemp(join(tmpdir(), "snapback-successor-client-"));
  const clients: ReturnType<typeof createClient>[] = [];
  const subscriptions: { close(): void }[] = [];
  const requests: { body: string; response: any }[] = [];
  const resets: any[] = [];
  let loseAcknowledgement = false;
  const observe: typeof fetch = async (input, init) => {
    const response = await fetch(input, init);
    const path = new URL(String(input)).pathname;
    if (path === "/api/resume") resets.push(await response.clone().json());
    if (path === "/api/mutation") {
      const body = await response.clone().json();
      requests.push({ body: String(init?.body), response: body });
      if (loseAcknowledgement && body.state === "committed") {
        loseAcknowledgement = false;
        // The real owner committed. Only its delivery to this client is lost.
        throw new TypeError("simulated connection loss after durable commit");
      }
    }
    return response;
  };
  try {
    local = await RealOwnerHarness.create({ withDeliveries: true });
    const makeClient = () => {
      const client = createClient({ url: local!.url, as: "alice", fetch: observe,
        offline: { store: fileRangeStore(directory) } });
      clients.push(client);
      return client;
    };
    const warm = async (client: ReturnType<typeof createClient>) => {
      await client.ready;
      const sub = client.subscribe(api.deliveries.inbox, { c: null }, () => {}, { drain: true });
      subscriptions.push(sub);
      await sub.until(event => event.live === true, 5_000);
      assert.equal((await client.outbox.status(api.deliveries.post)).ready, true);
      return sub;
    };
    const first = makeClient();
    const drain = await warm(first);
    const before: any = await first.query(api.messages.thread, { conversationId: "conversation-1", c: null });
    assert.equal(before.state, "complete");
    assert.equal(before.next, null);
    const baselineCount: any = await first.query(api.messages.summary, { conversationId: "conversation-1" });
    await first.offline();
    const queued = [];
    for (const body of ["successor first", "successor second"]) {
      const result = await first.mutation(api.deliveries.post, { conversationId: "conversation-1", body });
      assert.equal(result.state, "queued");
      queued.push(result);
    }
    const admitted = await first.outbox.entries();
    assert.equal(admitted.length, 2);
    assert.equal(admitted[0].predicted, true);
    assert.equal(admitted[1].predicted, true);
    assert.equal(requests.length, 0, "offline admission sends nothing");
    drain.close();
    await first.close();
    await local.stop();
    const schemaPath = join(local.root!, "snapback/schema.q");
    const schema = await readFile(schemaPath, "utf8");
    assert.ok(schema.includes("table messages:\n"));
    await writeFile(schemaPath, schema.replace("table messages:\n", "table messages:\n  category: text <=40 ?\n"));
    await local.start(false);

    const reopened = makeClient();
    await reopened.ready;
    await reopened.online();
    assert.deepEqual(await reopened.outbox.drain(), { stopped: false, remaining: 0 });
    assert.ok(resets.some(result => result.code === "E_OFFLINE_RESET"), "the real owner requires successor recovery");
    assert.deepEqual(requests.map(request => JSON.parse(request.body)), admitted.map(entry => ({
      op: entry.op, args: entry.args, replay: { grant: entry.grant, offset: entry.offset,
        count: entry.count, intent: entry.intent, trace: entry.trace ?? { points: [], verdicts: [] } },
    })), "FIFO replay preserves every admitted envelope field after close, schema reset, and reopen");
    const terminals = await reopened.outbox.entries();
    for (const entry of admitted) {
      const terminal = terminals.find(result => result.intent === entry.intent)!;
      assert.equal(terminal.state, "rejected");
      assert.equal((terminal.response as any).code, "E_OFFLINE_CONFLICT");
      assert.match((terminal.response as any).site, /^rule:/);
    }
    // Rule verdicts bind the complete schema. Even this optional addition
    // invalidates predecessor verdicts; new-generation intent admission is
    // an explicit user retry, never a rewrite of an existing envelope.
    const conflicted: any = await reopened.query(api.messages.thread, { conversationId: "conversation-1", c: null });
    assert.equal(conflicted.data.length, before.data.length, "the conflicted sends wrote no messages");
    for (const body of ["successor first", "successor second"]) {
      const result = await reopened.mutation(api.deliveries.post, { conversationId: "conversation-1", body });
      assert.equal(result.state, "committed");
      assert.ok(!admitted.some(entry => entry.intent === JSON.parse(requests.at(-1)!.body).replay.intent));
    }
    const after: any = await reopened.query(api.messages.thread, { conversationId: "conversation-1", c: null });
    assert.equal(after.state, "complete");
    assert.equal(after.next, null);
    for (const row of before.data) {
      const actual = after.data.find((value: any) => value.id === row.id);
      assert.ok(actual, `preserved message ${row.id}`);
      assert.equal(actual.category, null);
      const { category, ...originalFields } = actual;
      assert.deepEqual(originalFields, row);
    }
    for (const body of ["successor first", "successor second"]) assert.equal(after.data.filter((row: any) => row.body === body).length, 1);
    const afterCount: any = await reopened.query(api.messages.summary, { conversationId: "conversation-1" });
    assert.equal(afterCount.data.messageCount.value, baselineCount.data.messageCount.value + 2);
    t.diagnostic(`schema reset preserved ${before.data.length} original messages; two predicted intents settled E_OFFLINE_CONFLICT, and two explicit new intents advanced the first room count by two`);

    // A committed-but-unacknowledged intent must still settle if its operation
    // disappears before a cold client retries. New calls cannot use that op.
    const reopenedDrain = await warm(reopened);
    loseAcknowledgement = true;
    const uncertain = await reopened.mutation(api.deliveries.post, { conversationId: "conversation-1", body: "ack lost before removal" });
    assert.equal(uncertain.state, "queued");
    const originalRequest = requests.at(-1)!;
    assert.equal(originalRequest.response.state, "committed");
    reopenedDrain.close();
    await reopened.close();
    await local.stop();
    const operationPath = join(local.root!, "snapback/deliveries.q");
    const operations = await readFile(operationPath, "utf8");
    assert.ok(operations.includes("mutation post("));
    await writeFile(operationPath, operations.replace("mutation post(", "mutation postAfterEvolution("));
    await local.start(false);
    const retry = makeClient();
    await retry.ready;
    await retry.online();
    assert.deepEqual(await retry.outbox.drain(), { stopped: false, remaining: 0 });
    const retried = requests.filter(request => JSON.parse(request.body).replay.intent === uncertain.intent);
    assert.equal(retried.length, 2, "one original attempt and one cold retry");
    assert.equal(retried[1].body, originalRequest.body, "exact request bytes survive operation removal");
    assert.deepEqual(retried[1].response, originalRequest.response, "the owner returns its stored terminal");
    assert.equal((await retry.outbox.entries()).find(entry => entry.intent === uncertain.intent)?.state, "committed");
    const final: any = await retry.query(api.messages.thread, { conversationId: "conversation-1", c: null });
    assert.equal(final.state, "complete");
    assert.equal(final.data.filter((row: any) => row.body === "ack lost before removal").length, 1);
    const rejected = await fetch(`${local.url}/api/mutation`, { method: "POST",
      headers: { "Content-Type": "application/json", "X-Snapback-As": "alice" },
      body: JSON.stringify({ op: "deliveries.post", args: { conversationId: "conversation-1", body: "new forbidden call" } }) });
    assert.equal((await rejected.json()).code, "E_OP_UNKNOWN");
    t.diagnostic("lost acknowledgement retried byte-identically after operation removal; stored terminal settled with one message; new call refused E_OP_UNKNOWN");
  } finally {
    for (const sub of subscriptions) sub.close();
    for (const client of clients) await client.close();
    await local?.close();
    await rm(directory, { recursive: true, force: true });
    if (previousUrl === undefined) delete process.env.SNAPBACK_URL;
    else process.env.SNAPBACK_URL = previousUrl;
  }
});

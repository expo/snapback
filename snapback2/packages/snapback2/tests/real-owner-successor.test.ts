import { mkdtemp, mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { spawnSync } from "node:child_process";
import { fileRangeStore } from "../dist/test.mjs";
import { subscribe } from "../src/internal.js";
import assert from "node:assert/strict";
import { test } from "node:test";
import { api, createClient } from "../dist/client.mjs";
import { answerOffline } from "../dist/client-observed-test.mjs";
import { RealOwnerHarness } from "./owner-harness.ts";
import React from "react";
import TestRenderer, { act } from "react-test-renderer";
import { SnapbackProvider, useQuery } from "../dist/react.mjs";

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
    if (path === "/api/mutation" && JSON.parse(String(init?.body)).op === "messages.send") {
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
      const client = createClient({ url: local!.url, persona: "alice", fetch: observe,
        offline: { store: fileRangeStore(directory) } });
      clients.push(client);
      return client;
    };
    const warm = async (client: ReturnType<typeof createClient>) => {
      await client.ready;
      const sub = subscribe(client, api.messages.inbox, { c: null }, () => {}, { drain: true });
      subscriptions.push(sub);
      await sub.until(event => event.live === true, 5_000);
      assert.equal((await client.outbox.status(api.messages.send)).ready, true);
      return sub;
    };
    const first = makeClient();
    const drain = await warm(first);
    const before: any = await first.query(api.messages.thread, { conversationId: "conversation-1", c: null });
    assert.equal(before.state, "complete");
    assert.equal(before.next, null);
    const baselineCount: any = await first.query(api.messages.conversationView, { conversationId: "conversation-1" });
    await first.offline();
    const queued = [];
    for (const body of ["successor first", "successor second"]) {
      const result = await first.mutation(api.messages.send, { conversationId: "conversation-1", body });
      assert.equal(result.state, "queued");
      queued.push(result);
    }
    const admitted = (await first.outbox.entries()).filter(entry => entry.op === "messages.send");
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
    // Fix round r1, item 5: the cold-open route (the schema changed while the owner was
    // down) writes the same `successor: applied` line the hot installation writes.
    const coldLog = (await readFile(join(local.root!, ".snapback/log.jsonl"), "utf8")).trim().split("\n").flatMap(line => { try { return [JSON.parse(line)]; } catch { return []; /* a record the owner is still writing */ } });
    const coldApplied = coldLog.filter(line => line.successor === "applied" && line.report?.addedColumns?.includes("messages.category"));
    assert.equal(coldApplied.length, 1, `cold open logs the successor once: ${JSON.stringify(coldLog.filter(line => line.successor))}`);
    assert.ok(coldApplied[0].report.from && coldApplied[0].report.to && coldApplied[0].report.from !== coldApplied[0].report.to, JSON.stringify(coldApplied[0]));

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
      const result = await reopened.mutation(api.messages.send, { conversationId: "conversation-1", body });
      assert.equal(result.state, "committed", JSON.stringify(result));
      assert.ok(!admitted.some(entry => entry.intent === JSON.parse(requests.at(-1)!.body).replay.intent));
    }
    const after: any = await reopened.query(api.messages.thread, { conversationId: "conversation-1", c: null });
    assert.equal(after.state, "complete");
    assert.equal(after.next, null);
    for (const row of before.data) {
      const actual = after.data.find((value: any) => value.id === row.id);
      assert.ok(actual, `preserved message ${row.id}`);
      assert.equal(actual.message.category, null);
      const { category, ...originalFields } = actual.message;
      assert.deepEqual(originalFields, row.message);
    }
    for (const body of ["successor first", "successor second"]) assert.equal(after.data.filter((row: any) => row.message?.body === body).length, 1);
    const afterCount: any = await reopened.query(api.messages.conversationView, { conversationId: "conversation-1" });
    assert.equal(afterCount.data.count, baselineCount.data.count + 2);
    t.diagnostic(`schema reset preserved ${before.data.length} original messages; two predicted intents settled E_OFFLINE_CONFLICT, and two explicit new intents advanced the first room count by two`);

    // A committed-but-unacknowledged intent must still settle if its operation
    // disappears before a cold client retries. New calls cannot use that op.
    const reopenedDrain = await warm(reopened);
    loseAcknowledgement = true;
    const uncertain = await reopened.mutation(api.messages.send, { conversationId: "conversation-1", body: "ack lost before removal" });
    assert.equal(uncertain.state, "queued");
    const originalRequest = requests.at(-1)!;
    assert.equal(originalRequest.response.state, "committed");
    reopenedDrain.close();
    await reopened.close();
    await local.stop();
    const operationPath = join(local.root!, "snapback/messages.q");
    const operations = await readFile(operationPath, "utf8");
    assert.ok(operations.includes("mutation send("));
    await writeFile(operationPath, operations.replace("mutation send(", "mutation sendAfterEvolution("));
    await local.start(false);
    const retry = makeClient();
    await retry.ready;
    await retry.online();
    assert.deepEqual(await retry.outbox.drain(), { stopped: false, remaining: 0 });
    const retried = requests.filter(request => JSON.parse(request.body).replay.intent === uncertain.intent);
    assert.equal(retried.length, 2, "one original attempt and one cold retry");
    assert.equal(retried[1].body, originalRequest.body, "exact request bytes survive operation removal");
    assert.deepEqual(retried[1].response, originalRequest.response, "the owner returns its stored terminal");
    assert.match((originalRequest.response as any).program?.planHash, /^[a-f0-9]{64}$/);
    assert.match((originalRequest.response as any).program?.schemaHash, /^[a-f0-9]{64}$/);
    const terminal = (await retry.outbox.entries()).find(entry => entry.intent === uncertain.intent)!;
    assert.equal((terminal.response as any).program.planHash, terminal.targets?.planHash,
      "lost acknowledgement retains the original allocation proof after operation removal");
    assert.equal((await retry.outbox.entries()).find(entry => entry.intent === uncertain.intent)?.state, "committed");
    const final: any = await retry.query(api.messages.thread, { conversationId: "conversation-1", c: null });
    assert.equal(final.state, "complete");
    assert.equal(final.data.filter((row: any) => row.message?.body === "ack lost before removal").length, 1);
    const rejected = await fetch(`${local.url}/api/mutation`, { method: "POST",
      headers: { "Content-Type": "application/json", "X-Snapback-As": "alice" },
      body: JSON.stringify({ op: "messages.send", args: { conversationId: "conversation-1", body: "new forbidden call" } }) });
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


// @ref LLP 1018.003.001#4-automatic-compaction-of-successful-history —
// even an immediate empty-effect compaction must hand the online caller its terminal.
test("real owner no-op successes compact with zero readers and preserve each issuing result", async (t) => {
  if (process.env.SNAPBACK_URL) return t.skip("requires isolated owner");
  const { mkdtemp, writeFile, rm } = await import("node:fs/promises");
  const { tmpdir } = await import("node:os"), { join } = await import("node:path");
  const { fileRangeStore } = await import("../dist/test.mjs");
  const root = await mkdtemp(join(tmpdir(), "snapback-compacted-result-"));
  const previousUrl = process.env.SNAPBACK_URL;
  let local: RealOwnerHarness | undefined, client: ReturnType<typeof createClient> | undefined;
  try {
    local = await RealOwnerHarness.create({ prepare: async project => {
      await writeFile(join(project, "snapback/noop.q"), "mutation echo(value: int):\n  return value\n");
    } });
    const factory = fileRangeStore(root);
    client = createClient({ url: local.url, offline: { store: factory } });
    await client.ready;
    const session = await client.auth.guest();
    for (let value = 0; value < 20; value++) {
      const result = await client.mutation(api.noop.echo, { value });
      assert.equal(result.state, "committed", JSON.stringify(result));
      if (result.state === "committed") { assert.equal(result.data, value); assert.deepEqual(result.effects, []); }
      assert.deepEqual(await client.outbox.entries(), [], "zero observers; no success accumulates");
    }
    await client.close(); client = undefined;
    const reopened = factory(); await reopened.open(session.viewer);
    assert.deepEqual(await reopened.outbox.all(), []);
    assert((await reopened.outbox.compactedThrough!()) > 0);
    await reopened.close?.();
  } finally {
    await client?.close(); await local?.close(); await rm(root, { recursive: true, force: true });
    if (previousUrl === undefined) delete process.env.SNAPBACK_URL; else process.env.SNAPBACK_URL = previousUrl;
  }
});

test("real chat sends compact after own fanout and maintained count arrive", async (t) => {
  if (process.env.SNAPBACK_URL) return t.skip("requires isolated owner");
  const { mkdtemp, rm } = await import("node:fs/promises");
  const { tmpdir } = await import("node:os"), { join } = await import("node:path");
  const { fileRangeStore } = await import("../dist/test.mjs");
  const root = await mkdtemp(join(tmpdir(), "snapback-compacted-chat-"));
  let local: RealOwnerHarness | undefined, client: ReturnType<typeof createClient> | undefined;
  let drain: { close(): void } | undefined;
  try {
    local = await RealOwnerHarness.create({ fullChat: true });
    client = createClient({ url: local.url, persona: "alice", offline: { store: fileRangeStore(root) } });
    await client.ready;
    const tail = subscribe(client, api.messages.inbox, { c: null }, () => undefined, { drain: true });
    drain = tail;
    await tail.until(value => "caughtUp" in value && value.caughtUp === true);
    for (let n = 0; n < 10; n++) {
      const result = await client.mutation(api.messages.send, { conversationId: "conversation-1", body: `compact ${n}` });
      assert.equal(result.state, "committed", JSON.stringify(result));
      if (result.state === "committed") assert.deepEqual(result.effects?.map(row => row.table).sort(), ["deliveries", "deliveriesReceipts", "deliveriesReceipts", "messageCounts", "messages"]);
      const view = await client.query(api.messages.conversationView, { conversationId: "conversation-1", c: null });
      assert("data" in view && view.data.messages.some((row: any) => row.message?.body === `compact ${n}`));
      await client.query(api.messages.receipts, { messageId: (result as any).data.id });
      await client.outbox.drain();
      assert.deepEqual((await client.outbox.entries()).filter(entry => entry.op === "messages.send"), [], "all readable fanout, receipts and count arrived; no send history remains");
    }
  } finally { drain?.close(); await client?.close(); await local?.close(); await rm(root, { recursive: true, force: true }); }
});


const binary = resolve(import.meta.dirname, "../../../target/debug/snapback2");
const compiler = resolve(import.meta.dirname, "../dist/compiler.mjs");
const env = { ...process.env, SNAPBACK2_COMPILER: compiler };
const schema = (cases = "'text', 'image'", by = "sender") => `use identity

table messages:
  sender: principal
  recipient: principal
  kind: enum(${cases})
  body: text <=100
  by bySender: sender, id
  read <- allow
  insert <- allow
  update <- allow
  delete <- allow

table stamps:
  value: int
  read <- allow
  insert <- allow

maintain counts: count messages by ${by}
  read <- allow

maintain hiddenCounts: count messages by sender
  read <- .sender = viewer
`;
const operations = (cases = "'text', 'image'", retired = true) => `query all(c: cursor ?):
  return messages[] after c first 50 by byId

query count(who: principal):
  return counts[who]

query hidden(who: principal):
  return hiddenCounts[who]

mutation send(kind: enum(${cases}), body: text <=100):
  insert messages { sender: viewer, recipient: viewer, kind, body }
  return true
${retired ? '\nmutation retired():\n  insert stamps { value: 1 }\n  return true\n' : ''}`;
async function fixture() {
  const directory = await mkdtemp(join(tmpdir(), "snapback-successor-"));
  const source = join(directory, "source");
  await mkdir(source);
  await writeFile(join(source, "schema.q"), schema());
  await writeFile(join(source, "ops.q"), operations());
  await writeFile(join(source, "seed.ts"), `import { seed } from 'snapback2';
export default seed({ personas: ['alice', 'bob'], rows: { messages: [
  { id: 'original', sender: 'dev:alice', recipient: 'dev:bob', kind: 'text', body: 'original bytes: " \\u263a' }
] } });\n`);
  return { directory, source };
}
function cli(root: string, args: string[]) {
  const result = spawnSync(binary, [...args, "--project", root, "--json"], { env, encoding: "utf8", timeout: 15_000 });
  assert.equal(result.status, 0, `${args.join(" ")}: ${result.stdout}\n${result.stderr}`);
  return JSON.parse(result.stdout);
}
async function status(owner: RealOwnerHarness) {
  const info = JSON.parse(await readFile(join(owner.root!, ".snapback/owner.json"), "utf8"));
  return fetch(`${owner.url}/control/status`, { headers: { "x-snapback-control": info.secret } }).then(r => r.json());
}
async function until<T>(read: () => Promise<T>, predicate: (value: T) => boolean, label: string): Promise<T> {
  const start = Date.now();
  let value: T;
  do {
    value = await read();
    if (predicate(value)) return value;
    await new Promise(resolve => setTimeout(resolve, 25));
  } while (Date.now() - start < 8_000);
  assert.fail(`${label}: ${JSON.stringify(value)}`);
}
async function install(owner: RealOwnerHarness, cases: string, by = "sender", retired = true) {
  const before = await status(owner);
  await writeFile(join(owner.root!, "snapback/ops.q"), operations(cases, retired));
  await writeFile(join(owner.root!, "snapback/schema.q"), schema(cases, by));
  const ready: any = await until(() => status(owner), (s: any) => s.generation !== before.generation && s.status === "ready", "successor installation");
  return ready;
}

/** Hold selected complete owner frames after the server produced them but before the client can consume them. */
function gateLiveResponse(response: Response, select: (delivery: any) => Promise<void>): Response {
  assert.ok(response.body, "live response has a streaming body");
  const reader = response.body.getReader(), decoder = new TextDecoder(), encoder = new TextEncoder();
  let buffered = "", done = false;
  const body = new ReadableStream<Uint8Array>({
    async pull(controller) {
      while (true) {
        const boundary = buffered.indexOf("\n\n");
        if (boundary >= 0) {
          const event = buffered.slice(0, boundary + 2); buffered = buffered.slice(boundary + 2);
          const line = event.split("\n").find(value => value.startsWith("data: "));
          if (line) {
            const frame = JSON.parse(line.slice(6));
            if (frame?.data) await select(frame.data);
          }
          controller.enqueue(encoder.encode(event)); return;
        }
        if (done) {
          if (buffered) controller.enqueue(encoder.encode(buffered));
          controller.close(); return;
        }
        const chunk = await reader.read(); done = chunk.done;
        if (chunk.value) buffered += decoder.decode(chunk.value, { stream: !done });
      }
    },
    cancel(reason) { return reader.cancel(reason); },
  });
  return new Response(body, { status: response.status, statusText: response.statusText, headers: response.headers });
}

// @ref LLP 1012#6-reads-offline — an unheld aggregate cannot supply a screen's zero.
test("Insights hooks with never-held maintained values wait for authority, warm and cold", { timeout: 60000 }, async t => {
  const { directory, source } = await fixture();
  const previousUrl = process.env.SNAPBACK_URL;
  const previousAct = (globalThis as any).IS_REACT_ACT_ENVIRONMENT;
  (globalThis as any).IS_REACT_ACT_ENVIRONMENT = true;
  let owner: RealOwnerHarness | undefined, client: any, renderer: ReturnType<typeof TestRenderer.create> | undefined;
  try {
    await writeFile(join(source, "schema.q"), schema().replace("table stamps:\n", "table stamps:\n  bucket: int ?\n") + `
maintain received: count messages by recipient
  read <- allow

maintain sums: sum stamps of value by bucket
  read <- allow
`);
    await writeFile(join(source, "ops.q"), operations() + `
query insights(who: principal):
  return { sent: counts[who], received: received[who], sum: sums[7], zeroSum: sums[8], hidden: hiddenCounts[who], doubled: counts[who] * 2 }
`);
    await writeFile(join(source, "seed.ts"), `import { seed } from 'snapback2';
export default seed({ personas: ['alice', 'bob'], rows: {
  messages: [{ id: 'original', sender: 'dev:alice', recipient: 'dev:bob', kind: 'text', body: 'first insight' }],
  stamps: [{ id: 'stamp', value: 7, bucket: 7 }]
} });\n`);
    owner = await RealOwnerHarness.create({ forceOwned: true, fixture: source });
    for (const cold of [false, true]) {
      const carrier = fileRangeStore(join(directory, cold ? "cold" : "warm"));
      client = createClient({ url: owner.url, persona: "bob", offline: { store: carrier } });
      await client.ready;
      // Hold the program and ordinary rows, but no aggregate rows or absences.
      assert.equal((await client.query(api.ops.all, { c: null })).state, "complete");
      await client.offline();
      if (cold) {
        await client.close();
        client = createClient({ url: owner.url, persona: "bob", startOffline: true, offline: { store: carrier } });
        await client.ready;
      }
      const seen: Record<string, any[]> = { count: [], insights: [], zero: [], hidden: [] };
      function Insight({ name, op, who }: { name: string; op: any; who: string }) {
        const snapshot = useQuery(op, { who });
        seen[name].push(snapshot);
        return React.createElement("output", { id: name }, snapshot.data === undefined ? snapshot.status : JSON.stringify(snapshot.data));
      }
      await act(async () => {
        renderer = TestRenderer.create(React.createElement(SnapbackProvider, { client },
          React.createElement(Insight, { name: "count", op: api.ops.count, who: "dev:alice" }),
          React.createElement(Insight, { name: "insights", op: api.ops.insights, who: "dev:alice" }),
          React.createElement(Insight, { name: "zero", op: api.ops.count, who: "dev:bob" }),
          React.createElement(Insight, { name: "hidden", op: api.ops.hidden, who: "dev:alice" })));
      });
      await act(async () => {
        await until(async () => Object.fromEntries(Object.keys(seen).map(name => [name, client.observe(
          name === "insights" ? api.ops.insights : name === "hidden" ? api.ops.hidden : api.ops.count,
          { who: name === "zero" ? "dev:bob" : "dev:alice" }).getSnapshot()])),
        values => Object.values(values).every((value: any) => value.receipt?.state === "partial"), "unheld insights");
      });
      for (const [name, snapshots] of Object.entries(seen)) {
        const snapshot = snapshots.at(-1);
        assert.equal(snapshot.receipt?.state, "partial", `${cold}/${name}`);
        assert.equal(snapshot.status, "unavailable", `${cold}/${name}: ${JSON.stringify(snapshot)}`);
        assert.equal(snapshot.data, undefined, `${cold}/${name}: never-held is not zero`);
        assert.equal(snapshot.reason?.code, "partial");
      }
      await act(async () => { await client.online(); });
      await act(async () => {
        await until(async () => client.observe(api.ops.insights, { who: "dev:alice" }).getSnapshot(),
          value => value.freshness.live && value.data?.sum === 7, "live insights");
      });
      const expected = { sent: 1, received: 0, sum: 7, zeroSum: 0, hidden: 0, doubled: 2 };
      assert.deepEqual(seen.insights.at(-1).data, expected);
      assert.equal(seen.count.at(-1).data, 1);
      assert.equal(seen.zero.at(-1).data, 0, "proved absence remains a typed zero");
      assert.equal(seen.hidden.at(-1).data, 0, "proved unreadability remains a typed zero");
      assert.equal(seen.count.some(snapshot => snapshot.data === 0), false, "no intermediate zero paint");
      assert.equal(seen.insights.some(snapshot => snapshot.data?.sent === 0 || snapshot.data?.sum === 0), false);
      t.diagnostic(`${cold ? "cold" : "warm"} Insights: ${seen.insights.map(s => `${s.status}/${s.receipt?.state}/${JSON.stringify(s.data)}`).join(" → ")}`);
      await act(async () => renderer!.unmount()); renderer = undefined;
      await client.close(); client = undefined;
      client = createClient({ url: owner.url, persona: "bob", startOffline: true, offline: { store: carrier } });
      await client.ready;
      const retained: any = await client.query(api.ops.insights, { who: "dev:alice" });
      assert.equal(retained.state, "complete", "cold literal totals retain their checked owner answer");
      assert.deepEqual(retained.data, expected);
      assert.equal(retained.live, false);
      await client.close(); client = undefined;
    }
  } finally {
    if (renderer) await act(async () => renderer!.unmount());
    await client?.close(); await owner?.close();
    (globalThis as any).IS_REACT_ACT_ENVIRONMENT = previousAct;
    if (previousUrl === undefined) delete process.env.SNAPBACK_URL; else process.env.SNAPBACK_URL = previousUrl;
    await rm(directory, { recursive: true, force: true });
  }
});

// @ref LLP 1012#6-reads-offline — an exact maintained
// zero the device actually held remains usable but stale; reconnect must never
// relabel it live while the owner has already advanced the group.
test("a cold maintained zero stays explicitly stale until the owner publishes the current value", { timeout: 60000 }, async t => {
  const { directory, source } = await fixture();
  const previousUrl = process.env.SNAPBACK_URL;
  let owner: RealOwnerHarness | undefined;
  const clients: any[] = [];
  const stops: Array<() => void> = [];
  try {
    delete process.env.SNAPBACK_URL;
    owner = await RealOwnerHarness.create({ forceOwned: true, fixture: source });
    const carrier = fileRangeStore(join(directory, "maintained-bob"));
    const cached: any = createClient({ url: owner.url, persona: "bob", offline: { store: carrier } });
    clients.push(cached);
    await cached.ready;
    const args = { who: "dev:bob" };
    const cachedZero: any = await cached.query(api.ops.count, args);
    assert.deepEqual({ state: cachedZero.state, data: cachedZero.data, seq: cachedZero.seq },
      { state: "complete", data: 0, seq: 1 });
    await cached.close(); clients.pop();

    const writer: any = createClient({ url: owner.url, persona: "bob" });
    clients.push(writer);
    const write = await writer.mutation(api.ops.send, { kind: "text", body: "after cached zero" });
    assert.equal(write.state, "committed", JSON.stringify(write));
    const ownerNow: any = await writer.query(api.ops.count, args);
    assert.deepEqual({ state: ownerNow.state, data: ownerNow.data, seq: ownerNow.seq },
      { state: "complete", data: 1, seq: 2 });
    await writer.close(); clients.pop();

    const cold: any = createClient({ url: owner.url, persona: "bob", startOffline: true, offline: { store: carrier } });
    clients.push(cold);
    await cold.ready;
    const observed = cold.observe(api.ops.count, args);
    const snapshots: any[] = [];
    stops.push(observed.subscribe(() => snapshots.push(observed.getSnapshot())));
    const stale: any = await until(async () => observed.getSnapshot(),
      value => value.status === "ready" && value.data === 0 && value.receipt?.source === "twin", "cold maintained zero");
    assert.deepEqual({ data: stale.data, status: stale.status, receipt: stale.receipt,
      freshness: stale.freshness, reason: stale.reason?.code }, {
      data: 0,
      status: "ready",
      receipt: { state: "complete", source: "twin", seq: 1, next: null },
      freshness: { live: false, staleSince: stale.freshness.staleSince, connection: "offline" },
      reason: "stale",
    });
    assert.equal(typeof stale.freshness.staleSince, "number");

    await cold.online();
    const live: any = await until(async () => observed.getSnapshot(),
      value => value.status === "ready" && value.data === 1 && value.freshness.live === true, "current maintained value");
    assert.deepEqual(live.receipt, { state: "complete", source: "server", seq: 2, next: null });
    assert.equal(snapshots.some(snapshot => snapshot.data === 0 && snapshot.freshness.live === true), false,
      `the stale zero was never fabricated as current: ${JSON.stringify(snapshots)}`);

    stops.splice(0).forEach(stop => stop());
    await cold.offline(); await cold.close(); clients.pop();
    const colder: any = createClient({ url: owner.url, persona: "bob", startOffline: true, offline: { store: carrier } });
    clients.push(colder); await colder.ready;
    const retained: any = await colder.query(api.ops.count, args);
    assert.deepEqual({ state: retained.state, data: retained.data, seq: retained.seq, live: retained.live },
      { state: "complete", data: 1, seq: 2, live: false });
    t.diagnostic(`maintained custody: ${JSON.stringify({ cached: { data: 0, seq: 1, live: false, source: "twin" },
      owner: { data: 1, seq: 2 }, transitions: snapshots.map(snapshot => ({ data: snapshot.data,
        live: snapshot.freshness.live, source: snapshot.receipt?.source, seq: snapshot.receipt?.seq })), retained: { data: 1, seq: 2 } })}`);
  } finally {
    stops.splice(0).forEach(stop => stop());
    for (const client of clients.reverse()) await client.close();
    await owner?.close();
    if (previousUrl === undefined) delete process.env.SNAPBACK_URL; else process.env.SNAPBACK_URL = previousUrl;
    await rm(directory, { recursive: true, force: true });
  }
});

// @ref LLP 1020#a8-acceptance — actual owners, durable carriers, and original intent bytes.
test("two clients and cold carrier reopen preserve rows; an enum replay with a lost acknowledgment cannot be dismissed", { timeout: 60000 }, async t => {
  const { directory, source } = await fixture();
  const previousUrl = process.env.SNAPBACK_URL;
  let owner: RealOwnerHarness | undefined;
  const clients: any[] = [];
  const resets: any[] = [];
  let loseAcknowledgment = false;
  const committed = Promise.withResolvers<void>(), release = Promise.withResolvers<void>();
  let retry: Promise<unknown> | undefined;
  const observe: typeof fetch = async (input, init) => {
    const response = await fetch(input, init);
    const path = new URL(String(input)).pathname;
    if (path === "/api/resume") resets.push(await response.clone().json());
    if (path === "/api/mutation" && loseAcknowledgment && response.ok) {
      assert.equal((await response.clone().json()).state, "committed");
      loseAcknowledgment = false;
      committed.resolve(); await release.promise;
      throw new TypeError("replay committed; acknowledgment lost");
    }
    return response;
  };
  try {
    owner = await RealOwnerHarness.create({ forceOwned: true, fixture: source });
    let alice: any = createClient({ url: owner.url, persona: "alice", fetch: observe, offline: { store: fileRangeStore(join(directory, "alice")) } });
    let bob: any = createClient({ url: owner.url, persona: "bob", offline: { store: fileRangeStore(join(directory, "bob")) } });
    clients.push(alice, bob);
    await Promise.all([alice.ready, bob.ready]);
    const initial: any = await alice.query(api.ops.all, {});
    assert.equal(initial.state, "complete");
    assert.deepEqual((await bob.query(api.ops.all, {})).data, initial.data);
    for (const client of [alice, bob]) {
      const draining = subscribe(client, api.ops.all, {}, () => {}, { drain: true });
      await draining.until((event: any) => event.live === true, 3_000); draining.close();
    }
    await Promise.all([alice.online(), bob.online()]);
    const terminal = await alice.mutation(api.ops.retired, {});
    assert.equal(terminal.state, "committed", JSON.stringify(terminal));
    const retired = (await alice.outbox.entries()).find((entry: any) => entry.op === "ops.retired");
    assert.ok(retired?.response, `terminal is durable before removal: ${JSON.stringify(await alice.outbox.entries())}`);
    const widened: any = await install(owner, "'text', 'image', 'poll'");
    assert.notEqual(widened.successor.from, widened.successor.to);
    for (const client of [alice, bob]) {
      await client.online();
      const after = await client.query(api.ops.all, {});
      assert.equal(after.state, "complete");
      assert.deepEqual(after.data, initial.data);
    }
    await Promise.all([alice.offline(), bob.offline()]);
    alice = await alice.restart(); bob = await bob.restart(); clients.push(alice, bob);
    for (const client of [alice, bob]) {
      const cold = await client.query(api.ops.all, {});
      assert.equal(cold.live, false);
      assert.equal(cold.state, "complete");
      assert.deepEqual(cold.data, initial.data);
    }
    const args = { kind: "image", body: 'queued original: " \\ ☺' };
    const queued = await alice.mutation(api.ops.send, args);
    assert.equal(queued.state, "queued");
    const original = (await alice.outbox.entries()).find((entry: any) => entry.intent === queued.intent);
    assert.ok(original);
    const originalBytes = JSON.stringify({ args: original.args, intent: original.intent, generation: original.expectedGeneration });
    const narrowed = await install(owner, "'text', 'poll'", "sender", false);
    assert.equal(narrowed.successor.narrowings[0].affectedRows, 0);
    assert.deepEqual(narrowed.successor.narrowings[0].removedCases, ["image"]);
    // The existing contract (owner test offline_replay_successor): resume resets the
    // held generation, the server judges the replay by current validation, and a
    // refused intent is never spent — its bytes stay queued, untouched.
    resets.length = 0;
    const refused: any = await alice.online().then(() => alice.outbox.drain()).then(() => undefined, (error: any) => error);
    assert.equal(refused?.code, "E_INPUT", JSON.stringify(refused));
    assert.match(refused.message, /"image" is not in \["text", "poll"\]/);
    assert.ok(resets.some((result: any) => result.code === "E_OFFLINE_RESET"), JSON.stringify(resets));
    const stale = (await alice.outbox.entries()).find((entry: any) => entry.intent === queued.intent);
    assert.equal(stale.state, "queued");
    assert.equal(JSON.stringify({ args: stale.args, intent: stale.intent, generation: stale.expectedGeneration }), originalBytes);
    const history = (await alice.outbox.entries()).find((entry: any) => entry.intent === retired.intent);
    assert.equal(history.state, "committed");
    assert.deepEqual(history.response, retired.response, "removing the operation retains its original terminal");
    await bob.online();
    assert.deepEqual((await bob.query(api.ops.all, {})).data, initial.data, "removed queued case never enters the store");
    t.diagnostic(`old-generation intent: ${JSON.stringify({ state: stale.state, refusal: refused.envelope, reset: resets.find((result: any) => result.code === "E_OFFLINE_RESET")?.code, originalBytes })}`);
    // Widening the case back admits the same bytes: nothing was rewritten or dropped.
    await install(owner, "'text', 'image', 'poll'", "sender", false);
    loseAcknowledgment = true;
    retry = alice.outbox.drain();
    void retry!.catch(() => undefined);
    await committed.promise;
    assert.equal(await alice.outbox.dismiss(queued.intent), undefined, "committed replay is still in flight");
    release.resolve();
    assert.deepEqual(await retry, { stopped: "transport", remaining: 1 });
    assert.equal(await alice.outbox.dismiss(queued.intent), undefined, "lost acknowledgment leaves the outcome unknown");
    assert.equal((await alice.outbox.status()).blocked, undefined);
    assert.equal((await alice.outbox.entries()).find((e: any) => e.intent === queued.intent).refusal, undefined);
    await alice.online();
    assert.deepEqual(await alice.outbox.drain(), { stopped: false, remaining: 0 });
    const landed = (await alice.outbox.entries()).find((entry: any) => entry.intent === queued.intent);
    assert.equal(landed.state, "committed", JSON.stringify(landed));
    assert.equal(JSON.stringify({ args: landed.args, intent: landed.intent, generation: landed.expectedGeneration }), originalBytes);
    await bob.online();
    const rows: any = await bob.query(api.ops.all, {});
    assert.equal(rows.data.filter((row: any) => row.kind === "image" && row.body === args.body).length, 1, JSON.stringify(rows));
  } finally {
    release.resolve(); await retry?.catch(() => undefined);
    for (const client of clients.reverse()) await client.close();
    await owner?.close();
    if (previousUrl === undefined) delete process.env.SNAPBACK_URL; else process.env.SNAPBACK_URL = previousUrl;
    await rm(directory, { recursive: true, force: true });
  }
});

test("positional reads compile after a regroup, report it in log/status, and absent/hidden receipts do not invent completeness", { timeout: 60000 }, async t => {
  const { directory, source } = await fixture();
  const previousUrl = process.env.SNAPBACK_URL;
  let owner: RealOwnerHarness | undefined;
  const clients: any[] = [], subscriptions: any[] = [];
  const onlineLive = { armed: false, entered: Promise.withResolvers<any>(), release: Promise.withResolvers<void>() };
  const onlineQuery = { armed: false, entered: Promise.withResolvers<any>(), release: Promise.withResolvers<void>() };
  const onlineReset = { armed: false, entered: Promise.withResolvers<any>(), release: Promise.withResolvers<void>() };
  const resumeReset = { armed: false, entered: Promise.withResolvers<any>(), release: Promise.withResolvers<void>() };
  const resumeQuery = { armed: false, entered: Promise.withResolvers<any>(), release: Promise.withResolvers<void>() };
  let predecessor: string | undefined;
  const gatedJson = async (response: Response, gate: typeof onlineQuery) => {
    const value = await response.clone().json();
    if (gate.armed) { gate.armed = false; gate.entered.resolve(value); await gate.release.promise; }
    return response;
  };
  try {
    owner = await RealOwnerHarness.create({ forceOwned: true, fixture: source });
    const onlineFetch: typeof fetch = async (input, init) => {
      const response = await fetch(input, init), path = new URL(String(input)).pathname;
      if (path === "/api/live") return gateLiveResponse(response, async delivery => {
        if (onlineLive.armed && delivery?.generation && delivery.generation !== predecessor) {
          onlineLive.armed = false; onlineLive.entered.resolve(delivery); await onlineLive.release.promise;
        }
      });
      if (path === "/api/query" && onlineQuery.armed) return gatedJson(response, onlineQuery);
      if (path === "/api/resume" && onlineReset.armed) return gatedJson(response, onlineReset);
      return response;
    };
    const resumeFetch: typeof fetch = async (input, init) => {
      const response = await fetch(input, init), path = new URL(String(input)).pathname;
      if (path === "/api/resume" && resumeReset.armed) return gatedJson(response, resumeReset);
      if (path === "/api/query" && resumeQuery.armed) return gatedJson(response, resumeQuery);
      return response;
    };
    const online: any = createClient({ url: owner.url, persona: "bob", fetch: onlineFetch,
      offline: { store: fileRangeStore(join(directory, "bob-online")) } });
    const resuming: any = createClient({ url: owner.url, persona: "bob", fetch: resumeFetch,
      offline: { store: fileRangeStore(join(directory, "bob-resume")) } });
    clients.push(online, resuming);
    await Promise.all([online.ready, resuming.ready]);
    for (const client of clients) assert.equal((await client.query(api.ops.count, { who: "dev:alice" })).data, 1);
    predecessor = online.offlineRuntime.programGeneration;
    assert.equal(resuming.offlineRuntime.programGeneration, predecessor);
    const onlineEvents: any[] = [], resumeEvents: any[] = [];
    const onlineSub = subscribe(online, api.ops.count, { who: "dev:alice" }, value => onlineEvents.push(value));
    const resumeSub = subscribe(resuming, api.ops.count, { who: "dev:alice" }, value => resumeEvents.push(value));
    subscriptions.push(onlineSub, resumeSub);
    await Promise.all([
      onlineSub.until((event: any) => event.live === true && event.data === 1, 5_000),
      resumeSub.until((event: any) => event.live === true && event.data === 1, 5_000),
    ]);
    await resuming.offline();
    onlineLive.armed = true;
    const after: any = await install(owner, "'text', 'image'", "recipient");
    const blockedLive = await onlineLive.entered.promise;
    assert.notEqual(blockedLive.generation, predecessor, "the held frame belongs to the installed successor");
    assert.equal(online.offlineRuntime.programGeneration, predecessor, "the retained online client still holds the predecessor before the frame commits");
    assert.equal(resuming.offlineRuntime.programGeneration, predecessor, "the offline client retains the predecessor before resume");
    cli(owner.root!, ["check"]);
    assert.deepEqual(after.successor.maintains, ["maintain counts: by sender → by recipient"]);
    const text = await readFile(join(owner.root!, ".snapback/log.jsonl"), "utf8");
    assert.ok(text.includes("maintain counts: by sender → by recipient"));
    assert.deepEqual(cli(owner.root!, ["dev", "--status"]).successor.maintains, after.successor.maintains);

    // The owner has produced both successor answers while the twin still owns
    // the predecessor schema. Neither may be applied through its old bySender index.
    onlineQuery.armed = true; onlineReset.armed = true;
    const queried = online.query(api.ops.count, { who: "dev:alice" });
    const blockedQuery = await onlineQuery.entered.promise;
    assert.equal(blockedQuery.generation, blockedLive.generation);
    assert.equal(online.offlineRuntime.programGeneration, predecessor);
    onlineQuery.release.resolve();
    assert.equal((await queried).data, 0, "the one-shot online read returns the successor answer");
    const resetRefusal = await onlineReset.entered.promise;
    assert.equal(resetRefusal.code, "E_OFFLINE_RESET", JSON.stringify(resetRefusal));
    assert.equal(online.offlineRuntime.resetNeeded, true);
    assert.equal((await answerOffline(online.offlineRuntime, "ops.count", { who: "dev:alice" }, error => error as Error)).state,
      "hydrating", "superseded predecessor coverage is never served as exact");
    onlineLive.release.resolve(); onlineReset.release.resolve();
    const onlineSuccessor = await onlineSub.until((event: any) => event.live === true && event.state === "complete" && event.data === 0, 8_000);
    assert.equal(onlineSuccessor.data, 0);
    await until(async () => online.offlineRuntime, (runtime: any) => runtime.programGeneration !== predecessor && !runtime.resetNeeded,
      "online successor coverage completion");

    // The offline client sends predecessor facts. Hold the owner's reset
    // refusal, then hold the fresh mounted answer during the atomic rebuild.
    resumeReset.armed = true; resumeQuery.armed = true;
    const resumed = resuming.online();
    const resumeRefusal = await resumeReset.entered.promise;
    assert.equal(resumeRefusal.code, "E_OFFLINE_RESET", JSON.stringify(resumeRefusal));
    assert.equal(resuming.offlineRuntime.programGeneration, predecessor);
    resumeReset.release.resolve();
    const freshResume = await resumeQuery.entered.promise;
    assert.equal(freshResume.generation, blockedLive.generation);
    assert.notEqual(resuming.offlineRuntime.programGeneration, predecessor, "successor program is adopted before fresh coverage");
    assert.equal(resuming.offlineRuntime.resetNeeded, true);
    assert.equal((await answerOffline(resuming.offlineRuntime, "ops.count", { who: "dev:alice" }, error => error as Error)).state,
      "hydrating", "the shared reset never exposes a partial predecessor/successor image");
    resumeQuery.release.resolve(); await resumed;
    assert.equal((await resuming.query(api.ops.count, { who: "dev:alice" })).data, 0);
    assert.equal((await resuming.query(api.ops.count, { who: "dev:bob" })).data, 1);
    await resumeSub.until((event: any) => event.live === true && event.state === "complete" && event.data === 0, 8_000);

    for (const [name, who] of [["count", "dev:alice"], ["hidden", "dev:alice"]]) {
      const server: any = await online.query(api.ops[name], { who });
      assert.equal(server.data, 0, `${name}: server typed zero: ${JSON.stringify(server)}`);
      await online.online();
      const replay = await online.offlineRuntime.evaluate(`ops.${name}`, { who });
      t.diagnostic(`${name}: ${JSON.stringify({ server: server.state, replay })}`);
      assert.equal(server.state, "complete", `${name}: the server's typed zero is complete`);
      assert.equal(replay?.state, "partial", `${name}: receipt-only evaluation cannot mint zero authority`);
      assert.equal(replay?.reason, "never-held", `${name}: the group was never held, so no false completeness: ${JSON.stringify(replay)}`);
    }
    assert.equal(onlineEvents.some(event => event.state === "refused" && /E_SCHEMA|E_OFFLINE_STATE/.test(event.code ?? "")), false);
    assert.equal(resumeEvents.some(event => event.state === "refused" && /E_SCHEMA|E_OFFLINE_STATE/.test(event.code ?? "")), false);
  } finally {
    onlineLive.release.resolve(); onlineQuery.release.resolve(); onlineReset.release.resolve();
    resumeReset.release.resolve(); resumeQuery.release.resolve();
    for (const subscription of subscriptions) subscription.close();
    for (const client of clients.reverse()) await client.close();
    await owner?.close();
    if (previousUrl === undefined) delete process.env.SNAPBACK_URL; else process.env.SNAPBACK_URL = previousUrl;
    await rm(directory, { recursive: true, force: true });
  }
});

// @ref LLP 1001#maintained-addresses — a day bucket is an ordinary typed
// maintain group: the owner derives the UTC epoch day and updates its count in
// the same source mutation rather than asking the client to assemble a chart.
test("real owner maintains seven UTC-day insight buckets", { timeout: 60000 }, async () => {
  const directory = await mkdtemp(join(tmpdir(), "snapback-time-buckets-"));
  const source = join(directory, "source");
  const previousUrl = process.env.SNAPBACK_URL;
  let owner: RealOwnerHarness | undefined, client: ReturnType<typeof createClient> | undefined;
  try {
    await mkdir(source);
    await writeFile(join(source, "schema.q"), `use identity

table events:
  author: principal
  day: int
  by byDay: day, id
  read <- allow
  insert <- allow

maintain dayCounts: count events by day
  read <- allow
`);
    await writeFile(join(source, "insights.q"), `mutation record():
  day = divmod(now, 86400000).quotient
  insert events { author: viewer, day }
  return day

query week(start: int):
  return { d0: dayCounts[start], d1: dayCounts[start + 1], d2: dayCounts[start + 2], d3: dayCounts[start + 3], d4: dayCounts[start + 4], d5: dayCounts[start + 5], d6: dayCounts[start + 6] }
`);
    await writeFile(join(source, "seed.ts"), "import { seed } from 'snapback2';\nexport default seed({ personas: ['alice'], rows: {} });\n");
    owner = await RealOwnerHarness.create({ forceOwned: true, fixture: source });
    client = createClient({ url: owner.url, persona: "alice" });
    await client.ready;
    let firstDay: number | undefined;
    const expected: Record<string, number> = {};
    for (let offset = 0; offset < 7; offset += 1) {
      const recorded: any = await client.mutation(api.insights.record, {});
      assert.equal(recorded.state, "committed", JSON.stringify(recorded));
      firstDay ??= recorded.data;
      assert.equal(recorded.data, firstDay + offset, "owner clock advances across exact UTC-day buckets");
      expected[`d${offset}`] = 1;
      if (offset < 6) {
        const info = JSON.parse(await readFile(join(owner.root!, ".snapback/owner.json"), "utf8"));
        const advanced = await fetch(`${owner.url}/control/clock`, { method: "POST", headers: {
          "content-type": "application/json", "x-snapback-control": info.secret,
        }, body: JSON.stringify({ advanceMs: 86400000 }) });
        assert.equal(advanced.status, 200, await advanced.text());
      }
    }
    const week: any = await client.query(api.insights.week, { start: firstDay });
    assert.equal(week.state, "complete", JSON.stringify(week));
    assert.deepEqual(week.data, expected);
  } finally {
    await client?.close(); await owner?.close();
    if (previousUrl === undefined) delete process.env.SNAPBACK_URL; else process.env.SNAPBACK_URL = previousUrl;
    await rm(directory, { recursive: true, force: true });
  }
});

test("successor guide aliases and Quarry diagnostic rewrites compile", { timeout: 60000 }, async () => {
  const directory = await mkdtemp(join(tmpdir(), "snapback-successor-guide-"));
  try {
    await mkdir(join(directory, "snapback"));
    const pages = ["successor", "migrations", "migration"].map(name => cli(directory, ["guide", name]).content);
    assert.equal(pages[0], pages[1]); assert.equal(pages[0], pages[2]);
    // 4,608 while the page carries the custody-log paragraph (LLP 1019); it moves to `guide deliver`.
    assert.ok(Buffer.byteLength(pages[0]) <= 4608);
    assert.ok(!pages[0].includes("once J1b lands"));
    const families = JSON.parse(await readFile(resolve(import.meta.dirname, "../guide/families.source.json"), "utf8"));
    // Fix round r1, item 9: every successor family row and the `E_STEPS` pair. A Quarry
    // block compiles through `check` (file markers name the files; otherwise the block is
    // the schema, with a job split into admin.q), and `E_STEPS.wrong` must refuse that code
    // in family `bound`, page `bounds`. Prose-only sides (`E_SUCCESSOR_ROW_INVALID`,
    // `E_SUCCESSOR_STORE`, `E_SUCCESSOR_DESTRUCTIVE.right`) have nothing to compile.
    const project = (source: string): Record<string, string> => {
      const marked: Record<string, string> = {};
      let path: string | undefined;
      for (const line of source.split("\n")) {
        const marker = /^-- (snapback\/[A-Za-z0-9_./-]+\.q)$/.exec(line);
        if (marker) { path = marker[1]!; marked[path] = ""; } else if (path) marked[path] += `${line}\n`;
      }
      if (Object.keys(marked).length) return marked;
      const start = source.indexOf("\njob ");
      return start < 0 ? { "snapback/schema.q": source, "snapback/admin.q": "query inspect():\n  return null\n" }
        : { "snapback/schema.q": source.slice(0, start), "snapback/admin.q": source.slice(start) };
    };
    const rows = families.filter((row: any) => row.code.startsWith("E_SUCCESSOR") || row.code === "E_STEPS");
    assert.deepEqual(rows.map((row: any) => row.code).sort(), ["E_STEPS", "E_SUCCESSOR_BOOTSTRAP", "E_SUCCESSOR_CAP", "E_SUCCESSOR_COLUMN_REQUIRED", "E_SUCCESSOR_DESTRUCTIVE", "E_SUCCESSOR_NARROWING", "E_SUCCESSOR_ROW_INVALID", "E_SUCCESSOR_STORE", "E_SUCCESSOR_UNIQUE"]);
    let compiled = 0;
    for (const example of rows) {
      assert.equal(example.guide, example.code === "E_STEPS" ? "bounds" : "successor", example.code); assert.ok(example.site, example.code);
      for (const side of example.code === "E_STEPS" ? ["wrong", "right"] : ["right"]) {
        const source = /```q\n([\s\S]*?)\n```/.exec(example[side])?.[1];
        if (!source) continue;
        await rm(join(directory, "snapback"), { recursive: true, force: true });
        await mkdir(join(directory, "snapback"));
        for (const [path, text] of Object.entries(project(source))) await writeFile(join(directory, path), text);
        const result = spawnSync(binary, ["check", "--project", directory, "--json"], { env, encoding: "utf8", timeout: 15_000 });
        compiled += 1;
        if (side === "right") { assert.equal(result.status, 0, `${example.code}.${side}: ${result.stdout}\n${result.stderr}`); continue; }
        assert.equal(result.status, 1, `${example.code}.wrong: ${result.stdout}\n${result.stderr}`);
        const refusal = JSON.parse(result.stdout.trim().split("\n")[0]);
        assert.deepEqual({ code: refusal.code, family: refusal.family, guide: refusal.guide }, { code: "E_STEPS", family: "bound", guide: "bounds" }, result.stdout);
      }
    }
    assert.equal(compiled, 6, "four successor `right` blocks plus both E_STEPS sides compile");
  } finally { await rm(directory, { recursive: true, force: true }); }
});

test("nested enum refusal names both generations and declaration, and its pasted job repairs the predecessor", { timeout: 60000 }, async t => {
  const { directory, source } = await fixture();
  const previousUrl = process.env.SNAPBACK_URL;
  let owner: RealOwnerHarness | undefined;
  const nested = (cases: string) => schema().replace("  body: text <=100", `  body: text <=100\n  tags: [[enum(${cases})] <=3] <=3 ?`);
  try {
    await writeFile(join(source, "schema.q"), nested("'a', 'b'"));
    await writeFile(join(source, "seed.ts"), `import { seed } from 'snapback2';
export default seed({ personas: ['alice', 'bob'], rows: { messages: [
  { id: 'keep', sender: 'dev:alice', recipient: 'dev:bob', kind: 'text', body: 'keep', tags: [[], ['a']] },
  { id: 'remove', sender: 'dev:alice', recipient: 'dev:bob', kind: 'text', body: 'remove', tags: [['b', 'b']] }
] } });\n`);
    owner = await RealOwnerHarness.create({ forceOwned: true, fixture: source });
    const before: any = await status(owner);
    // Seed changes make future empty-store startup valid; the populated row still has b.
    await writeFile(join(owner.root!, "snapback/seed.ts"), (await readFile(join(source, "seed.ts"), "utf8")).replaceAll("'b', 'b'", "'a', 'a'"));
    await writeFile(join(owner.root!, "snapback/schema.q"), nested("'a'"));
    const refused: any = await until(() => status(owner), (s: any) => s.status?.refused?.some((e: any) => e.code === "E_SUCCESSOR_NARROWING"), "nested enum narrowing refusal");
    const error = refused.status.refused.find((e: any) => e.code === "E_SUCCESSOR_NARROWING");
    assert.equal(refused.generation, before.generation);
    assert.equal(error.from, before.generation); assert.notEqual(error.to, error.from);
    assert.match(error.site, /schema\.q:8:3$/);
    assert.equal(error.affectedRows, 1); assert.deepEqual(error.sample, ["remove"]);
    assert.deepEqual(error.removedCases, ["b"]);
    const repair = join(directory, "repair.q");
    await writeFile(repair, error.rewrite);
    // Restore the predecessor declarations for the ad hoc compiler as the rewrite directs.
    await writeFile(join(owner.root!, "snapback/schema.q"), nested("'a', 'b'"));
    await until(() => status(owner), (s: any) => s.status === "ready", "predecessor declarations restored");
    const result = spawnSync(binary, ["run", "--file", repair, "--as", "system", "--wait", "--project", owner.root!, "--json"], { env, encoding: "utf8", timeout: 15_000 });
    assert.equal(result.status, 0, `${result.stdout}\n${result.stderr}\n${error.rewrite}`);
    assert.ok(result.stdout.includes('"state":"done"'), result.stdout);
    await writeFile(join(owner.root!, "snapback/schema.q"), `${nested("'a'")}\n`);
    const ready: any = await until(() => status(owner), (s: any) => s.generation !== before.generation && s.status === "ready", "repaired successor");
    assert.equal(ready.successor.narrowings[0].affectedRows, 0);
    const rows = cli(owner.root!, ["data", "messages", "--as", "system"]);
    assert.ok(JSON.stringify(rows).includes('"keep"'));
    assert.ok(!JSON.stringify(rows).includes('"remove"'));
    t.diagnostic(`nested refusal: ${JSON.stringify({ from: error.from, to: error.to, site: error.site, affectedRows: error.affectedRows, removedCases: error.removedCases, rewrite: error.rewrite })}`);
    // A scalar enum pastes one whole-table sweep that deletes every affected row.
    cli(owner.root!, ["run", "ops.send", JSON.stringify({ kind: "image", body: "scalar" }), "--as", "alice"]);
    const scalar = (cases: string) => `${nested("'a'")}\n`.replace("kind: enum('text', 'image')", `kind: enum(${cases})`);
    const narrowKind = async (cases: string) => {
      await writeFile(join(owner!.root!, "snapback/ops.q"), operations(cases));
      await writeFile(join(owner!.root!, "snapback/schema.q"), scalar(cases));
    };
    await narrowKind("'text'");
    const flat: any = await until(() => status(owner), (s: any) => s.status?.refused?.some((e: any) => e.column === "kind"), "scalar enum narrowing refusal");
    const flatError = flat.status.refused.find((e: any) => e.column === "kind");
    assert.equal(flatError.affectedRows, 1); assert.deepEqual(flatError.removedCases, ["image"]);
    assert.ok(flatError.rewrite.includes("  chunk p in messages first 100 by byId:\n    if p.kind = 'image':\n      delete messages[p.id]"), flatError.rewrite);
    await writeFile(repair, flatError.rewrite);
    await narrowKind("'text', 'image'");
    await until(() => status(owner), (s: any) => s.status === "ready", "scalar predecessor restored");
    const swept = spawnSync(binary, ["run", "--file", repair, "--as", "system", "--wait", "--project", owner.root!, "--json"], { env, encoding: "utf8", timeout: 15_000 });
    assert.equal(swept.status, 0, `${swept.stdout}\n${swept.stderr}\n${flatError.rewrite}`);
    assert.ok(swept.stdout.includes('"state":"done"'), swept.stdout);
    await narrowKind("'text'");
    const flatReady: any = await until(() => status(owner), (s: any) => s.generation !== flat.generation && s.status === "ready", "scalar repaired successor");
    assert.equal(flatReady.successor.narrowings.find((n: any) => n.column === "kind").affectedRows, 0);
    const afterSweep = JSON.stringify(cli(owner.root!, ["data", "messages", "--as", "system"]));
    assert.ok(afterSweep.includes('"keep"') && !afterSweep.includes('"scalar"'), afterSweep);
  } finally {
    await owner?.close();
    if (previousUrl === undefined) delete process.env.SNAPBACK_URL; else process.env.SNAPBACK_URL = previousUrl;
    await rm(directory, { recursive: true, force: true });
  }
});

// Fix round r1, items 1, 4 and 6: the combined unwrap-plus-removal job fills and deletes in
// one sweep, the list-shrink job checks every row with one `.length`, and both run to zero
// on a real owner (a removed case inside a list stays the sampled job: the nested test).
test("combined and list-narrowing pasted jobs run to zero on the real owner", { timeout: 90000 }, async t => {
  const { directory, source } = await fixture();
  const previousUrl = process.env.SNAPBACK_URL;
  let owner: RealOwnerHarness | undefined;
  const declare = (note: string, tags: string) => schema().replace("  body: text <=100", `  body: text <=100\n  note: ${note}\n  tags: ${tags}`);
  const ops = (note: string) => operations().replace(
    "mutation send(kind: enum('text', 'image'), body: text <=100):\n  insert messages { sender: viewer, recipient: viewer, kind, body }",
    `mutation send(kind: enum('text', 'image'), body: text <=100, note: ${note}):\n  insert messages { sender: viewer, recipient: viewer, kind, body, note }`);
  const seed = (rows: string) => `import { seed } from 'snapback2';\nexport default seed({ personas: ['alice', 'bob'], rows: { messages: [\n${rows}\n] } });\n`;
  const row = (id: string, fields: string) => `  { id: '${id}', sender: 'dev:alice', recipient: 'dev:bob', kind: 'text', body: '${id}'${fields} }`;
  const wide = { note: "enum('a', 'b', 'c') ?", tags: "[enum('x', 'y')] <=3 ?" };
  try {
    await writeFile(join(source, "schema.q"), declare(wide.note, wide.tags));
    await writeFile(join(source, "ops.q"), ops(wide.note));
    await writeFile(join(source, "seed.ts"), seed([row("keep", ", note: 'a', tags: ['x']"), row("nul", ", tags: ['x', 'y', 'x']"), row("gone", ", note: 'c', tags: []")].join(",\n")));
    owner = await RealOwnerHarness.create({ forceOwned: true, fixture: source });
    const start: any = await status(owner);
    // Seeds only feed an empty store; keep them valid for every schema below.
    await writeFile(join(owner.root!, "snapback/seed.ts"), seed(row("keep", ", note: 'a', tags: ['x']")));
    const declareAll = async (note: string, tags: string) => {
      await writeFile(join(owner!.root!, "snapback/ops.q"), ops(note));
      await writeFile(join(owner!.root!, "snapback/schema.q"), declare(note, tags));
    };
    const repair = join(directory, "repair.q");
    const run = (args?: string) => spawnSync(binary, ["run", "--file", repair, ...(args ? [args] : []), "--as", "system", "--wait", "--project", owner!.root!, "--json"], { env, encoding: "utf8", timeout: 20_000 });
    // 1. `note` loses its `?` and the case 'c' at once: one job fills the null and deletes the case.
    await declareAll("enum('a', 'b')", wide.tags);
    const first: any = await until(() => status(owner!), (s: any) => s.status?.refused?.some((e: any) => e.column === "note"), "combined narrowing refusal");
    const note = first.status.refused.find((e: any) => e.column === "note");
    assert.deepEqual({ affectedRows: note.affectedRows, nullRows: note.nullRows, oversizeRows: note.oversizeRows, removedCases: note.removedCases, sample: note.sample },
      { affectedRows: 2, nullRows: 1, oversizeRows: 0, removedCases: ["c"], sample: ["gone"] }, JSON.stringify(note));
    assert.ok(note.rewrite.includes("job remove_messages_note(value: enum('a', 'b')):\n  chunk p in messages first 100 by byId:\n    if p.note = null:\n      update messages[p.id] { note: value }\n    if p.note = 'c':\n      delete messages[p.id]"), note.rewrite);
    await writeFile(repair, note.rewrite);
    await declareAll(wide.note, wide.tags);
    await until(() => status(owner!), (s: any) => s.status === "ready" && s.generation === start.generation, "predecessor restored");
    const filled = run('{"value":"b"}');
    assert.equal(filled.status, 0, `${filled.stdout}\n${filled.stderr}\n${note.rewrite}`); assert.ok(filled.stdout.includes('"state":"done"'), filled.stdout);
    await declareAll("enum('a', 'b')", wide.tags);
    const second: any = await until(() => status(owner!), (s: any) => s.status === "ready" && s.generation !== start.generation, "combined successor admitted");
    assert.equal(second.successor.narrowings.find((n: any) => n.column === "note").affectedRows, 0);
    let rows = JSON.stringify(cli(owner.root!, ["data", "messages", "--as", "system"]));
    assert.ok(rows.includes('"keep"') && rows.includes('"nul"') && !rows.includes('"gone"') && rows.includes('"note":"b"'), rows);
    // 2. `tags` keeps its cases and its maximum drops to 2: one sweep with `.length`.
    await declareAll("enum('a', 'b')", "[enum('x', 'y')] <=2 ?");
    const third: any = await until(() => status(owner!), (s: any) => s.status?.refused?.some((e: any) => e.column === "tags"), "list narrowing refusal");
    const tags = third.status.refused.find((e: any) => e.column === "tags");
    assert.deepEqual({ affectedRows: tags.affectedRows, nullRows: tags.nullRows, oversizeRows: tags.oversizeRows, removedCases: tags.removedCases, sample: tags.sample },
      { affectedRows: 1, nullRows: 0, oversizeRows: 1, removedCases: [], sample: ["nul"] }, JSON.stringify(tags));
    assert.ok(tags.rewrite.includes("job shrink_messages_tags():\n  chunk p in messages first 100 by byId:\n    if (p.tags ?? []).length > 2:\n      delete messages[p.id]"), tags.rewrite);
    assert.match(tags.message, /1 affected rows remain \(0 null or absent, 1 over the new maximum\)/);
    await writeFile(repair, tags.rewrite);
    await declareAll("enum('a', 'b')", wide.tags);
    await until(() => status(owner!), (s: any) => s.status === "ready" && s.generation === second.generation, "list predecessor restored");
    const swept = run();
    assert.equal(swept.status, 0, `${swept.stdout}\n${swept.stderr}\n${tags.rewrite}`); assert.ok(swept.stdout.includes('"state":"done"'), swept.stdout);
    await declareAll("enum('a', 'b')", "[enum('x', 'y')] <=2 ?");
    const fourth: any = await until(() => status(owner!), (s: any) => s.status === "ready" && s.generation !== second.generation, "list successor admitted");
    assert.equal(fourth.successor.narrowings.find((n: any) => n.column === "tags").affectedRows, 0);
    rows = JSON.stringify(cli(owner.root!, ["data", "messages", "--as", "system"]));
    assert.ok(rows.includes('"keep"') && !rows.includes('"nul"'), rows);
    t.diagnostic(`combined: ${JSON.stringify({ note: note.message, tags: tags.message })}`);
  } finally {
    await owner?.close();
    if (previousUrl === undefined) delete process.env.SNAPBACK_URL; else process.env.SNAPBACK_URL = previousUrl;
    await rm(directory, { recursive: true, force: true });
  }
});

test("sampled required-list repair keeps filled nulls and converges beyond ten removed-case rows", { timeout: 90000 }, async t => {
  const { directory, source } = await fixture();
  const previousUrl = process.env.SNAPBACK_URL;
  let owner: RealOwnerHarness | undefined;
  const declare = (type: string) => schema().replace("  body: text <=100", `  body: text <=100\n  tags: ${type}`);
  const wide = "[enum('a', 'b')] <=3 ?", narrow = "[enum('a')] <=3";
  const rows = [{ id: "00-null", tags: null }, { id: "keep", tags: ["a"] },
    ...Array.from({ length: 12 }, (_, i) => ({ id: `bad-${i}`, tags: ["b"] }))]
    .map(row => ({ sender: "dev:alice", recipient: "dev:bob", kind: "text", body: row.id, ...row }));
  const seed = (values: unknown[]) => `import { seed } from 'snapback2';\nexport default seed({ personas: ['alice', 'bob'], rows: { messages: ${JSON.stringify(values)} } });\n`;
  try {
    await writeFile(join(source, "schema.q"), declare(wide));
    await writeFile(join(source, "ops.q"), operations().replace("kind, body }", "kind, body, tags: ['a'] }"));
    await writeFile(join(source, "seed.ts"), seed(rows));
    owner = await RealOwnerHarness.create({ forceOwned: true, fixture: source });
    const start: any = await status(owner);
    await writeFile(join(owner.root!, "snapback/seed.ts"), seed([rows[1]]));
    const schemaPath = join(owner.root!, "snapback/schema.q");
    const data = () => (cli(owner!.root!, ["data", "messages", "--as", "system"]) as any).data;
    const unchanged = JSON.stringify(data().find((row: any) => row.id === "keep"));
    const repair = join(directory, "repair.q");
    let priorSample: string[] = [];
    for (const remaining of [13, 2]) {
      await writeFile(schemaPath, declare(narrow));
      const refused: any = await until(() => status(owner!), (s: any) => s.status?.refused?.some((e: any) => e.column === "tags"), "sampled narrowing refusal");
      const conflict = refused.status.refused.find((e: any) => e.column === "tags");
      assert.equal(conflict.affectedRows, remaining);
      assert.equal(conflict.nullRows, remaining === 13 ? 1 : 0);
      assert.ok(conflict.sample.every((id: string) => !priorSample.includes(id)), "fresh sample on re-apply");
      priorSample = conflict.sample;
      await writeFile(repair, conflict.rewrite);
      await writeFile(schemaPath, declare(wide));
      await until(() => status(owner!), (s: any) => s.status === "ready" && s.generation === start.generation, "predecessor restored");
      const run = spawnSync(binary, ["run", "--file", repair, '{"value":["a"]}', "--as", "system", "--wait", "--project", owner.root!, "--json"], { env, encoding: "utf8", timeout: 20_000 });
      assert.equal(run.status, 0, `${run.stdout}\n${run.stderr}\n${conflict.rewrite}`);
      const after = data();
      assert.deepEqual(after.find((row: any) => row.id === "00-null")?.tags, ["a"], "filled null survives");
      assert.equal(JSON.stringify(after.find((row: any) => row.id === "keep")), unchanged);
      assert.ok(run.stdout.includes('"state":"done"'), run.stdout);
      t.diagnostic(`${conflict.affectedRows} affected; sample ${JSON.stringify(conflict.sample)}; repair done; filled null and unchanged row kept`);
    }
    await writeFile(schemaPath, declare(narrow));
    const admitted: any = await until(() => status(owner!), (s: any) => s.status === "ready" && s.generation !== start.generation, "narrow successor admitted");
    assert.equal(admitted.successor.narrowings.find((n: any) => n.column === "tags").affectedRows, 0);
    const after = data();
    assert.deepEqual(after.map((row: any) => row.id).sort(), ["00-null", "keep"]);
  } finally {
    await owner?.close();
    if (previousUrl === undefined) delete process.env.SNAPBACK_URL; else process.env.SNAPBACK_URL = previousUrl;
    await rm(directory, { recursive: true, force: true });
  }
});

test("text repair truncates scalars or deletes only over-long rows, preserving short text and nulls", { timeout: 90000 }, async () => {
  for (const remove of [false, true]) {
    const { directory, source } = await fixture();
    const previousUrl = process.env.SNAPBACK_URL;
    let owner: RealOwnerHarness | undefined;
    const declare = (max: number) => schema().replace("  body: text <=100", `  body: text <=100\n  note: text <=${max} ?`);
    const rows = [{ id: "null", note: null }, { id: "short", note: "a😀" }, { id: "long", note: "😀".repeat(12) }]
      .map(row => ({ sender: "dev:alice", recipient: "dev:bob", kind: "text", body: row.id, ...row }));
    const seed = (values: unknown[]) => `import { seed } from 'snapback2';\nexport default seed({ personas: ['alice', 'bob'], rows: { messages: ${JSON.stringify(values)} } });\n`;
    try {
      await writeFile(join(source, "schema.q"), declare(20));
      await writeFile(join(source, "seed.ts"), seed(rows));
      owner = await RealOwnerHarness.create({ forceOwned: true, fixture: source });
      const start: any = await status(owner);
      await writeFile(join(owner.root!, "snapback/seed.ts"), seed(rows.slice(0, 2)));
      const path = join(owner.root!, "snapback/schema.q");
      await writeFile(path, declare(10));
      const refused: any = await until(() => status(owner!), (s: any) => s.status?.refused?.some((e: any) => e.column === "note"), "text maximum refusal");
      const conflict = refused.status.refused.find((e: any) => e.column === "note");
      assert.equal(conflict.oversizeRows, 1);
      let job = conflict.rewrite;
      if (remove) {
        const alternative = job.split("\n").filter((line: string) => /^-- (if |  delete )/.test(line)).map((line: string) => `    ${line.slice(3)}`).join("\n");
        assert.match(alternative, /!= slice/);
        job = `job drop_messages_note():\n  chunk p in messages first 100 by byId:\n${alternative}`;
      }
      const repair = join(directory, "repair.q");
      await writeFile(repair, job);
      await writeFile(path, declare(20));
      await until(() => status(owner!), (s: any) => s.status === "ready" && s.generation === start.generation, "text predecessor restored");
      const run = spawnSync(binary, ["run", "--file", repair, "--as", "system", "--wait", "--project", owner.root!, "--json"], { env, encoding: "utf8", timeout: 20_000 });
      assert.equal(run.status, 0, `${run.stdout}\n${run.stderr}\n${job}`);
      await writeFile(path, declare(10));
      await until(() => status(owner!), (s: any) => s.status === "ready" && s.generation !== start.generation, "text successor admitted");
      const data = (cli(owner.root!, ["data", "messages", "--as", "system"]) as any).data;
      assert.deepEqual(data.find((row: any) => row.id === "short"), rows[1]);
      assert.deepEqual(data.find((row: any) => row.id === "null"), rows[0]);
      assert.deepEqual(data.find((row: any) => row.id === "long"), remove ? undefined : { ...rows[2], note: "😀".repeat(10) });
    } finally {
      await owner?.close();
      if (previousUrl === undefined) delete process.env.SNAPBACK_URL; else process.env.SNAPBACK_URL = previousUrl;
      await rm(directory, { recursive: true, force: true });
    }
  }
});

test("dev status retains the completed install report including delivery audience bounds", async () => {
  const { directory, source } = await fixture();
  const previousUrl = process.env.SNAPBACK_URL;
  let owner: RealOwnerHarness | undefined;
  const audience = `\ntable audience:\n  sender: principal\n  member: principal\n  by bySender: sender, member\n  cap 10 by sender\n  read <- allow\n`;
  try {
    await writeFile(join(source, "schema.q"), schema() + audience);
    delete process.env.SNAPBACK_URL;
    owner = await RealOwnerHarness.create({ fixture: source });
    await mkdir(join(directory, "snapback"));
    await writeFile(join(directory, "snapback/schema.q"), schema().replace("  body: text <=100", "  body: text <=100\n  deliver to audience[.sender] by .member as deliveries") + audience);
    await writeFile(join(directory, "snapback/ops.q"), operations());
    cli(directory, ["check"]);
    const project = JSON.parse(await readFile(join(directory, ".snapback/build/project.json"), "utf8"));
    const info = JSON.parse(await readFile(join(owner.root!, ".snapback/owner.json"), "utf8"));
    const response = await fetch(`${owner.url}/control/apply`, { method: "POST", headers: { "content-type": "application/json", "x-snapback-control": info.secret }, body: JSON.stringify({ project }) });
    const report = await response.json();
    assert.equal(response.status, 200, JSON.stringify(report));
    assert.deepEqual(report.audienceBounds, { deliveries: 10 });
    assert.deepEqual(cli(owner.root!, ["dev", "--status"]).successor, report);
  } finally { await owner?.close(); await rm(directory, { recursive: true, force: true }); if (previousUrl === undefined) delete process.env.SNAPBACK_URL; else process.env.SNAPBACK_URL = previousUrl; }
});

test("cold owner regroup logs the old and new keys and serves the successor positional value", async () => {
  const { directory, source } = await fixture();
  const previousUrl = process.env.SNAPBACK_URL;
  let owner: RealOwnerHarness | undefined;
  try {
    owner = await RealOwnerHarness.create({ forceOwned: true, fixture: source });
    assert.equal(cli(owner.root!, ["run", "ops.count", '{"who":"dev:alice"}', "--as", "bob"]).data, 1);
    await owner.stop();
    await writeFile(join(owner.root!, "snapback/schema.q"), schema("'text', 'image'", "recipient"));
    await owner.start(false);
    const line = "maintain counts: by sender → by recipient";
    const report = cli(owner.root!, ["dev", "--status"]).successor;
    assert.deepEqual(report.maintains, [line]);
    const logs = (await readFile(join(owner.root!, ".snapback/log.jsonl"), "utf8")).split("\n").flatMap(line => { try { return [JSON.parse(line)]; } catch { return []; } });
    assert.deepEqual(logs.filter(row => row.successor === "applied" && row.report.to === report.to).map(row => row.report.maintains), [[line]]);
    cli(owner.root!, ["check"]);
    assert.equal(cli(owner.root!, ["run", "ops.count", '{"who":"dev:bob"}', "--as", "bob"]).data, 1);
    assert.equal(cli(owner.root!, ["run", "ops.count", '{"who":"dev:alice"}', "--as", "bob"]).data, 0);
  } finally { await owner?.close(); await rm(directory, { recursive: true, force: true }); if (previousUrl === undefined) delete process.env.SNAPBACK_URL; else process.env.SNAPBACK_URL = previousUrl; }
});

test("real owner input refusal exposes the head and dismissal returns args before the next queued send commits", async () => {
  const { directory, source } = await fixture();
  const previousUrl = process.env.SNAPBACK_URL;
  let owner: RealOwnerHarness | undefined, client: ReturnType<typeof createClient> | undefined;
  try {
    owner = await RealOwnerHarness.create({ forceOwned: true, fixture: source });
    client = createClient({ url: owner.url, persona: "alice", offline: { store: fileRangeStore(join(directory, "client")) } });
    await client.ready;
    const drain = subscribe(client, api.ops.all, {}, () => {}, { drain: true });
    try { await drain.until((event: any) => event.live === true, 3_000); } finally { drain.close(); }
    await client.online(); await client.offline();
    const args = { kind: "image", body: 'dismiss these original bytes: " \\ ☺' };
    const first = await client.mutation(api.ops.send, args);
    const second = await client.mutation(api.ops.send, { kind: "text", body: "after dismissal" });
    assert.equal(first.state, "queued"); assert.equal(second.state, "queued");
    await install(owner, "'text'");
    await assert.rejects(client.online(), { code: "E_INPUT" });
    assert.deepEqual((await client.outbox.status()).blocked, { intent: first.intent, code: "E_INPUT" });
    const entry = (await client.outbox.entries()).find(e => e.intent === first.intent)!;
    assert.deepEqual(await client.outbox.dismiss(first.intent!), { intent: first.intent, op: "ops.send", args, refusal: entry.refusal });
    assert.deepEqual(await client.outbox.drain(), { stopped: false, remaining: 0 });
    assert.equal((await client.outbox.status()).blocked, undefined);
    const entries = await client.outbox.entries();
    assert.equal(entries.some(e => e.intent === first.intent), false);
    assert.equal(entries.find(e => e.intent === second.intent)?.state, "committed");
    const rows: any = await client.query(api.ops.all, {});
    assert.equal(rows.data.some((row: any) => row.body === args.body), false);
    assert.equal(rows.data.filter((row: any) => row.body === "after dismissal").length, 1);
  } finally { await client?.close(); await owner?.close(); await rm(directory, { recursive: true, force: true }); if (previousUrl === undefined) delete process.env.SNAPBACK_URL; else process.env.SNAPBACK_URL = previousUrl; }
});

test("owner source changes rebuild distinct totals and report hot install, migration and cold open", async () => {
  const { directory, source } = await fixture();
  const previousUrl = process.env.SNAPBACK_URL;
  let owner: RealOwnerHarness | undefined;
  const posts = `\ntable posts:\n  sender: principal\n  read <- allow\n`;
  const sourceSchema = (table: string) => (schema() + posts).replace("maintain counts: count messages", `maintain counts: count ${table}`);
  try {
    await writeFile(join(source, "schema.q"), sourceSchema("messages"));
    const seedPath = join(source, "seed.ts");
    await writeFile(seedPath, (await readFile(seedPath, "utf8")).replace("] } });", "], posts: [{ id: 'post-1', sender: 'dev:alice' }, { id: 'post-2', sender: 'dev:alice' }, { id: 'post-3', sender: 'dev:alice' }] } });"));
    owner = await RealOwnerHarness.create({ forceOwned: true, fixture: source });
    const count = () => cli(owner!.root!, ["run", "ops.count", '{"who":"dev:alice"}', "--as", "bob"]).data;
    assert.equal(count(), 1);
    await mkdir(join(directory, "snapback"));
    await writeFile(join(directory, "snapback/ops.q"), operations());
    for (const [route, from, to, expected] of [["apply", "messages", "posts", 3], ["migrate", "posts", "messages", 1], ["reopen", "messages", "posts", 3]] as const) {
      let report: any;
      if (route === "reopen") {
        await owner.stop();
        await writeFile(join(owner.root!, "snapback/schema.q"), sourceSchema(to));
        await owner.start(false);
        report = cli(owner.root!, ["dev", "--status"]).successor;
      } else {
        await writeFile(join(directory, "snapback/schema.q"), sourceSchema(to));
        cli(directory, ["check"]);
        const project = JSON.parse(await readFile(join(directory, ".snapback/build/project.json"), "utf8"));
        const info = JSON.parse(await readFile(join(owner.root!, ".snapback/owner.json"), "utf8"));
        const response = await fetch(`${owner.url}/control/${route}`, { method: "POST", headers: { "content-type": "application/json", "x-snapback-control": info.secret }, body: JSON.stringify({ project, plan: { drops: [] } }) });
        report = await response.json();
        assert.equal(response.status, 200, JSON.stringify(report));
      }
      const line = `maintain counts: from ${from} → from ${to}`;
      assert.deepEqual(report.maintains, [line], route);
      assert.equal(count(), expected, route);
      assert.deepEqual(cli(owner.root!, ["dev", "--status"]).successor, report, route);
      const logs = (await readFile(join(owner.root!, ".snapback/log.jsonl"), "utf8")).split("\n").flatMap(line => { try { return [JSON.parse(line)]; } catch { return []; } });
      assert.ok(logs.some(row => row.successor === "applied" && row.report.to === report.to && row.report.maintains.includes(line)), route);
    }
  } finally { await owner?.close(); await rm(directory, { recursive: true, force: true }); if (previousUrl === undefined) delete process.env.SNAPBACK_URL; else process.env.SNAPBACK_URL = previousUrl; }
});

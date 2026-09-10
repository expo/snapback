import { mkdtemp, mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { spawnSync } from "node:child_process";
import { fileRangeStore } from "../dist/test.mjs";
import { subscribe } from "../src/internal.js";
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
      if (result.state === "committed") assert.deepEqual(result.effects?.map(row => row.table).sort(), ["deliveries", "messageCounts", "messages"]);
      const view = await client.query(api.messages.conversationView, { conversationId: "conversation-1", c: null });
      assert("data" in view && view.data.messages.some((row: any) => row.message?.body === `compact ${n}`));
      assert.deepEqual(await client.outbox.entries(), [], "all readable fanout and count arrived; no success history remains");
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

// @ref LLP 1020#a8-acceptance — actual owners, durable carriers, and original intent bytes.
test("two clients and cold carrier reopen preserve rows through widening; removed enum intents keep bytes and explicit conflict", { timeout: 60000 }, async t => {
  const { directory, source } = await fixture();
  const previousUrl = process.env.SNAPBACK_URL;
  let owner: RealOwnerHarness | undefined;
  const clients: any[] = [];
  const resets: any[] = [];
  const observe: typeof fetch = async (input, init) => {
    const response = await fetch(input, init);
    if (new URL(String(input)).pathname === "/api/resume") resets.push(await response.clone().json());
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
    await alice.online();
    assert.deepEqual(await alice.outbox.drain(), { stopped: false, remaining: 0 });
    const landed = (await alice.outbox.entries()).find((entry: any) => entry.intent === queued.intent);
    assert.equal(landed.state, "committed", JSON.stringify(landed));
    assert.equal(JSON.stringify({ args: landed.args, intent: landed.intent, generation: landed.expectedGeneration }), originalBytes);
    await bob.online();
    const rows: any = await bob.query(api.ops.all, {});
    assert.equal(rows.data.filter((row: any) => row.kind === "image" && row.body === args.body).length, 1, JSON.stringify(rows));
  } finally {
    for (const client of clients.reverse()) await client.close();
    await owner?.close();
    if (previousUrl === undefined) delete process.env.SNAPBACK_URL; else process.env.SNAPBACK_URL = previousUrl;
    await rm(directory, { recursive: true, force: true });
  }
});

test("positional reads compile after a regroup, report it in log/status, and absent/hidden receipts do not invent completeness", { timeout: 60000 }, async t => {
  const { directory, source } = await fixture();
  const previousUrl = process.env.SNAPBACK_URL;
  let owner: RealOwnerHarness | undefined, client: any;
  try {
    owner = await RealOwnerHarness.create({ forceOwned: true, fixture: source });
    client = createClient({ url: owner.url, persona: "bob", offline: { store: fileRangeStore(join(directory, "bob")) } });
    await client.ready;
    assert.equal((await client.query(api.ops.count, { who: "dev:alice" })).data, 1);
    // LLP 1012's reset path: the held generation is dropped on the next resume.
    // (An online client racing the hot regroup is issues/20260910-snapback2-online-client-query-during-hot-regroup.md.)
    await client.offline();
    const after: any = await install(owner, "'text', 'image'", "recipient");
    cli(owner.root!, ["check"]);
    assert.deepEqual(after.successor.maintains, ["maintain counts: by sender → by recipient"]);
    const text = await readFile(join(owner.root!, ".snapback/log.jsonl"), "utf8");
    assert.ok(text.includes("maintain counts: by sender → by recipient"));
    assert.deepEqual(cli(owner.root!, ["dev", "--status"]).successor.maintains, after.successor.maintains);
    await client.online();
    assert.equal((await client.query(api.ops.count, { who: "dev:alice" })).data, 0);
    assert.equal((await client.query(api.ops.count, { who: "dev:bob" })).data, 1);
    for (const [name, who] of [["count", "dev:alice"], ["hidden", "dev:alice"]]) {
      const server: any = await client.query(api.ops[name], { who });
      assert.equal(server.data, 0, `${name}: server typed zero: ${JSON.stringify(server)}`);
      await client.online();
      const replay = await client.offlineRuntime.evaluate(`ops.${name}`, { who });
      t.diagnostic(`${name}: ${JSON.stringify({ server: server.state, replay })}`);
      assert.equal(replay?.state, "partial", `${name}: receipt-only evaluation cannot mint zero authority`);
    }
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
    assert.ok(Buffer.byteLength(pages[0]) <= 4096);
    assert.ok(!pages[0].includes("once J1b lands"));
    const families = JSON.parse(await readFile(resolve(import.meta.dirname, "../guide/families.source.json"), "utf8"));
    for (const code of ["E_SUCCESSOR_NARROWING", "E_SUCCESSOR_COLUMN_REQUIRED", "E_SUCCESSOR_UNIQUE", "E_SUCCESSOR_CAP"]) {
      const example = families.find((family: any) => family.code === code);
      assert.equal(example.guide, "successor"); assert.ok(example.site);
      const source = /```q\n([\s\S]*?)\n```/.exec(example.right)![1];
      const start = source.indexOf("\njob ");
      await writeFile(join(directory, "snapback/schema.q"), start < 0 ? source : source.slice(0, start));
      if (start < 0) await writeFile(join(directory, "snapback/admin.q"), "query inspect():\n  return null\n");
      else await writeFile(join(directory, "snapback/admin.q"), source.slice(start));
      cli(directory, ["check"]);
    }
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

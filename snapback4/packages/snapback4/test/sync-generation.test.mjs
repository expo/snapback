import test from "node:test";
import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { once } from "node:events";
import { mkdtempSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { setTimeout as delay } from "node:timers/promises";
import { createLocalClient } from "../dist/local.js";
import { syncTransport } from "../dist/local-sync.js";
import { processDevice } from "../dist/native.js";
import { memoryPersistence, webDevice } from "../dist/web.js";

const root = join(dirname(fileURLToPath(import.meta.url)), "../../..");
const binary = process.env.SNAPBACK4_BIN ?? join(root, "target/debug/snapback4");
const source = `use personas alice
table counters:
  n: int
  public 'generation fixture'
  update <- allow
  sync public
query counter():
  return counters['a']
mutation bump():
  c = counters['a'] ! else NOT_FOUND
  update counters['a'] {n: c.n + 1}
`;
const legacyMessage = "sync needs { from, limit, after, stream, pending }: nonnegative integers, a cursor or null, a boolean, and at most 256 ids of 1..128 UTF-8 bytes";
const legacyRefusal = { denied: { code: "E_INPUT", family: "input", message: legacyMessage } };

function parkedChanges(signal) {
  let cleanup;
  return new Response(new ReadableStream({
    start(controller) {
      const beat = () => controller.enqueue(new Uint8Array([32, 10]));
      const timer = setInterval(beat, 500);
      const abort = () => { cleanup(); controller.error(signal.reason); };
      cleanup = () => { clearInterval(timer); signal.removeEventListener("abort", abort); };
      if (signal.aborted) abort();
      else { signal.addEventListener("abort", abort, { once: true }); beat(); }
    },
    cancel() { cleanup(); },
  }));
}

async function fixture(t, tier = "process", serverBinary = binary) {
  const dir = mkdtempSync(join(tmpdir(), "sb4-sync-generation-"));
  mkdirSync(join(dir, "snapback"));
  let url, child, exited, client, core;
  const trace = [], calls = [];
  async function stop() {
    if (child && child.exitCode == null && child.signalCode == null) child.kill();
    if (exited) await exited;
  }
  t.after(async () => { await client?.close(); await stop(); rmSync(dir, { recursive: true, force: true }); });
  async function start(schema = source) {
    await stop(); writeFileSync(join(dir, "snapback/schema.q"), schema);
    child = spawn(serverBinary, ["dev", "--no-watch", "--port", url ? new URL(url).port : "0"], { cwd: dir, stdio: ["ignore", "pipe", "pipe"] });
    exited = once(child, "exit");
    let log = "", ready = false;
    for (const stream of [child.stdout, child.stderr]) stream.on("data", bytes => {
      log += bytes;
      const address = log.match(/http:\/\/127\.0\.0\.1:\d+/)?.[0];
      if (address) { url = address; ready = true; }
    });
    const deadline = Date.now() + 30000;
    while (!ready && Date.now() < deadline) { assert.equal(child.exitCode, null, log); await delay(20); }
    assert.ok(ready, log);
  }
  async function post(path, input) {
    const response = await fetch(url + path, { method: "POST", headers: { "x-snapback-persona": "alice" }, body: JSON.stringify(input) });
    assert.equal(response.status, 200);
    return response.json();
  }
  async function ok(request) {
    const result = await core.call(request);
    assert.equal(result.denied, undefined, JSON.stringify(result));
    return result.ok;
  }
  await start();
  assert.equal((await post("/seed", [{ table: "counters", row: { id: "a", n: 0 } }])).seeded, 1);
  const opener = tier === "process" ? processDevice({ binary, dir: join(dir, "device") })
    : webDevice({ wasm: readFileSync(join(root, "packages/snapback4/src/wasm/snapback4_device_bg.wasm")), persist: memoryPersistence() });
  client = await createLocalClient({ url, persona: "alice", device: { open: async (...args) => {
    core = await opener.open(...args);
    return { close: () => core.close(), call: async request => {
      if (request.op === "apply") assert.equal(request.page.denied, undefined, "never apply a refusal as a page");
      const reply = await core.call(request);
      calls.push({ request, reply, ...(request.op === "observe_store" && request.page.denied ? { state: await ok({ op: "state" }) } : {}) });
      if (request.op === "adopt") trace.push({ op: "adopt", state: await ok({ op: "state" }), queued: await ok({ op: "queued" }) });
      return reply;
    } };
  } }, fetch: async (input, init) => {
    const path = new URL(input).pathname;
    if (path === "/changes") return parkedChanges(init.signal);
    const response = await fetch(input, init);
    const text = await response.text(), reply = JSON.parse(text);
    trace.push({ path, request: init.body ? JSON.parse(init.body) : undefined, status: response.status, bytes: Buffer.byteLength(text), reply });
    return new Response(text, { status: response.status, headers: response.headers });
  } });
  assert.equal(client.acquired, true);
  // Let the constructor's empty flush finish before injecting durable entries.
  await delay(20);
  return { client, ok, start, post, trace, calls };
}

for (const tier of ["wasm", "process"]) test(`${tier}: early generation adoption preserves unsent writes, known and lost acknowledgements`, { timeout: 90000 }, async t => {
  const f = await fixture(t, tier);
  const ids = ["known", "lost", "unsent"];
  let known;
  for (const [i, id] of ids.entries()) {
    await f.ok({ op: "admit", entry: { id, seq: i + 1, op: "bump", args: {}, new_ids: [], predicted: [], viewer: "dev:alice", now: 1000, predictable: true } });
    if (id !== "unsent") {
      await f.ok({ op: "begin_send" });
      const receipt = await f.post("/m/bump", { id, args: {} });
      assert.equal(receipt.state, "sent");
      if (id === "known") { known = receipt; await f.ok({ op: "settle", id, seq: receipt.seq }); }
    }
  }
  const before = await f.ok({ op: "state" });
  const queued = await f.ok({ op: "queued" });
  assert.deepEqual(queued.map(e => e.id), ids);
  assert.equal(queued[0].sent_seq, known.seq);
  // Also change acquisition so adoption must discard its old row images.
  await f.start(source.replace("n: int", "n: int\n  added: int default 0").replace("sync public", "sync public last 100 by byId"));
  f.trace.length = 0; f.calls.length = 0;
  await f.client.sync();
  assert.deepEqual(f.trace.slice(0, 4).map(r => r.path ?? r.op), ["/sync", "/schema", "adopt", "/sync"]);
  const early = f.trace[0];
  assert.equal(early.request.generation, 1);
  assert.equal(early.request.from, before.watermark);
  assert.equal(early.reply.denied?.code, "E_SYNC_GENERATION");
  assert.ok(early.bytes < 1024);
  assert.equal(f.calls.find(r => r.request.op === "observe_store").state.watermark, before.watermark,
    "observing the early answer must not advance delivered progress before adoption");
  const adopted = f.trace[2];
  assert.equal(adopted.state.generation, 2);
  assert.equal(adopted.state.watermark, 0, "early head must never become delivered progress");
  assert.deepEqual(adopted.queued, queued, "adoption keeps every outbox entry and known receipt byte for byte");
  const retry = f.trace[3].request;
  assert.equal(retry.generation, 2);
  assert.equal(retry.from, 0);
  assert.equal(retry.limit, early.request.limit);
  // Adoption recaptures the outbox; wasm can additionally capture an unsent
  // entry here. Every id awaiting an acknowledgement must still be present.
  assert.ok(early.request.pending.every(id => retry.pending.includes(id)));
  assert.ok(f.trace.every(r => r.reply?.denied?.code !== "E_BOUND"));
  const receiptPage = f.trace.find(r => r.reply?.acknowledged?.lost);
  assert.ok(receiptPage, "lost acknowledgement is recovered by a delivered page after adoption");
  assert.equal(receiptPage.reply.acknowledged.known, known.seq);
  const remaining = await f.ok({ op: "queued" });
  const unsent = remaining.find(e => e.id === "unsent");
  assert.deepEqual(unsent, queued[2], "unsent intent survives catch-up unchanged");
  const lost = remaining.find(e => e.id === "lost");
  assert.ok(!lost || lost.observed_seq === receiptPage.reply.acknowledged.lost);
  assert.equal((await f.ok({ op: "state" })).watermark, early.reply.watermark);
  // Complete the surviving intent under its original id; all three writes
  // must have happened exactly once and the client must skip no event.
  await f.ok({ op: "begin_send" });
  const sent = await f.post("/m/bump", { id: unsent.id, args: unsent.args });
  await f.ok({ op: "settle", id: unsent.id, seq: sent.seq });
  await f.client.sync();
  const row = await f.client.query({ kind: "query", name: "counter" }, {});
  assert.equal(row.data.n, 3);
  assert.equal(row.data.added, 0);
  assert.equal(row.fresh, true);
  assert.equal((await f.ok({ op: "state" })).watermark, sent.seq);
});

test("legacy fallback is once per client, preserves the request, and recognizes only the exact refusal", async () => {
  const input = { generation: 7, from: 31, limit: 2, after: "cursor", stream: false, pending: ["write"], store_id: "store" };
  const requests = [];
  const transport = syncTransport(async (_, init) => {
    requests.push(JSON.parse(init.body));
    return Response.json(legacyRefusal, { status: 400 });
  });
  assert.equal((await transport("http://legacy/sync", {}, input)).status, 400);
  await transport("http://legacy/sync", {}, input);
  const { generation: _, ...oldInput } = input;
  assert.deepEqual(requests, [input, oldInput, oldInput], "one retry, no cursor, id or pending mutation");
  for (const [status, reply] of [[200, legacyRefusal], [413, legacyRefusal], [500, legacyRefusal],
    [400, { denied: { ...legacyRefusal.denied, message: "other input error" } }],
    [400, { denied: { ...legacyRefusal.denied, family: "auth" } }],
    [400, { denied: { ...legacyRefusal.denied, code: "E_AUTH" } }]]) {
    let calls = 0;
    const fetchSync = syncTransport(async () => { calls++; return Response.json(reply, { status }); });
    await fetchSync("http://legacy/sync", {}, input);
    assert.equal(calls, 1, JSON.stringify({ status, reply }));
  }
});

test("new client syncs against the actual 0.2.32 server's deny_unknown_fields request contract", {
  timeout: 90000,
  skip: !process.env.SNAPBACK4_LEGACY_BIN && "set SNAPBACK4_LEGACY_BIN to the published 0.2.32 binary",
}, async t => {
  const f = await fixture(t, "process", process.env.SNAPBACK4_LEGACY_BIN);
  const syncs = f.trace.filter(r => r.path === "/sync");
  assert.equal(syncs[0].request.generation, 1);
  assert.equal(syncs[0].status, 400);
  assert.deepEqual(syncs[0].reply, legacyRefusal, "the refusal is from 0.2.32's actual serde parser");
  const { generation: _, ...oldRequest } = syncs[0].request;
  assert.deepEqual(syncs[1].request, oldRequest);
  assert.equal(syncs[1].status, 200);
  assert.equal(syncs[1].reply.events.length, 1);
  await f.post("/m/bump", { id: "legacy-bump", args: {} });
  await f.client.sync();
  assert.ok(f.trace.filter(r => r.path === "/sync").slice(1).every(r => !("generation" in r.request)));
  assert.equal((await f.client.query({ kind: "query", name: "counter" }, {})).data.n, 1);
  await f.start(source.replace("n: int", "n: int\n  added: int default 0"));
  f.trace.length = 0;
  await f.client.sync();
  assert.deepEqual(f.trace.slice(0, 4).map(r => r.path ?? r.op), ["/sync", "/schema", "adopt", "/sync"]);
  assert.ok(f.trace.filter(r => r.path === "/sync").every(r => !("generation" in r.request)));
  assert.equal((await f.ok({ op: "state" })).generation, 2);
  assert.equal((await f.client.query({ kind: "query", name: "counter" }, {})).data.n, 1);
});

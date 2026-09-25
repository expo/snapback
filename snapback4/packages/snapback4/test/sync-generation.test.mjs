import test from "node:test";
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { spawn } from "node:child_process";
import { once } from "node:events";
import { mkdtempSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { setTimeout as delay } from "node:timers/promises";
import { createLocalClient } from "../dist/local.js";
import { legacyInputRefusal, syncTransport } from "../dist/local-sync.js";
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
table remoteCounters:
  n: int
  public 'uncached server read for retryable link failures'
query remoteCounter():
  return remoteCounters['a']
`;
// Captured verbatim from published snapback4-darwin-arm64@0.2.32.
// Pin the fixture bytes themselves, not the published binary digest.
const legacyBytes = readFileSync(new URL("./fixtures/sync-input-0.2.32.json", import.meta.url));
const legacyRefusal = JSON.parse(legacyBytes);
test("the legacy refusal constant matches the published 0.2.32 capture", () => {
  assert.equal(createHash("sha256").update(legacyBytes).digest("hex"),
    "90b1ca3ddc4d0bbf9fc2c9222240757a3707288d9b148f0a08d51690cd0055c1");
  assert.deepEqual(legacyInputRefusal, legacyRefusal);
});

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
  let url, child, exited, client, core, intercept;
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
  const rawPost = (path, input) => fetch(url + path, { method: "POST", headers: { "x-snapback-persona": "alice" }, body: JSON.stringify(input) });
  async function post(path, input) {
    const response = await rawPost(path, input);
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
      if (request.op === "adopt") trace.push({ op: "adopt", state: await ok({ op: "sync_state", capture: false }), queued: await ok({ op: "queued" }) });
      return reply;
    } };
  } }, fetch: async (input, init) => {
    const path = new URL(input).pathname;
    if (path === "/changes") return parkedChanges(init.signal);
    const response = await intercept?.(input, init) ?? await fetch(input, init);
    const text = await response.text(), reply = JSON.parse(text);
    trace.push({ path, request: init.body ? JSON.parse(init.body) : undefined, status: response.status, bytes: Buffer.byteLength(text), reply });
    return new Response(text, { status: response.status, headers: response.headers });
  } });
  assert.equal(client.acquired, true);
  // Let the constructor's empty flush finish before injecting durable entries.
  await delay(20);
  return { client, ok, start, post, rawPost, trace, calls, intercept: fn => { intercept = fn; } };
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
  await f.start(source.replace("n: int", "n: int\n  intermediate: int default 0"));
  // Also change acquisition so adoption must discard its old row images.
  await f.start(source.replace("n: int", "n: int\n  added: int default 0").replace("sync public", "sync public last 100 by byId"));
  f.trace.length = 0; f.calls.length = 0;
  await f.client.sync();
  assert.deepEqual(f.trace.slice(0, 4).map(r => r.path ?? r.op), ["/sync", "/schema", "adopt", "/sync"]);
  const early = f.trace[0];
  assert.equal(early.request.generation, 1);
  assert.equal(early.request.from, before.watermark);
  assert.equal(early.reply.denied?.code, "E_SYNC_GENERATION");
  assert.deepEqual(Object.keys(early.reply).sort(), ["denied", "generation", "store_id", "watermark"]);
  assert.ok(early.reply.generation > early.request.generation + 1);
  assert.ok(before.watermark > 0);
  assert.ok(early.reply.watermark > 0);
  assert.ok(early.bytes < 1024);
  assert.equal(f.calls.find(r => r.request.op === "observe_store").state.watermark, before.watermark,
    "observing the early answer must not advance delivered progress before adoption");
  const adopted = f.trace[2];
  assert.equal(adopted.state.generation, early.reply.generation);
  assert.equal(adopted.state.store_id, early.reply.store_id);
  assert.notEqual(adopted.state.watermark, early.reply.watermark);
  assert.equal(adopted.state.watermark, 0, "early head must never become delivered progress");
  assert.deepEqual(adopted.queued, queued, "adoption keeps every outbox entry and known receipt byte for byte");
  const retry = f.trace[3].request;
  assert.equal(retry.generation, early.reply.generation);
  assert.equal(retry.store_id, early.reply.store_id);
  assert.equal(retry.from, 0);
  assert.equal(retry.limit, early.request.limit);
  // Adoption recaptures the outbox; wasm can additionally capture an unsent
  // entry here. Every id awaiting an acknowledgement must still be present.
  assert.ok(early.request.pending.includes("lost"));
  assert.ok(retry.pending.includes("lost"));
  assert.ok(early.request.pending.every(id => retry.pending.includes(id)));
  assert.ok(f.trace.every(r => r.reply?.denied?.code !== "E_BOUND"));
  const receiptPage = f.trace.find(r => r.reply?.acknowledged?.lost);
  assert.ok(receiptPage, "lost acknowledgement is recovered by a delivered page after adoption");
  assert.equal(receiptPage.reply.acknowledged.known, known.seq);
  const remaining = await f.ok({ op: "queued" });
  const unsent = remaining.find(e => e.id === "unsent");
  assert.deepEqual(unsent, queued[2], "unsent intent survives catch-up unchanged");
  const lost = remaining.find(e => e.id === "lost");
  let lostOutcome;
  if (lost) {
    assert.equal(lost.observed_seq, receiptPage.reply.acknowledged.lost);
    lostOutcome = await f.client.write(lost.id);
  } else {
    const history = await f.ok({ op: "meta", key: "write-history" });
    assert.equal(typeof history, "string", "retired receipts must have durable history");
    lostOutcome = JSON.parse(history).find(r => r.id === "lost");
  }
  assert.ok(lostOutcome, "the lost acknowledgement must be recorded in client state");
  assert.equal(lostOutcome.id, "lost");
  assert.equal(lostOutcome.state, "sent");
  assert.equal(lostOutcome.seq, receiptPage.reply.acknowledged.lost);
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

const legacyRequest = { generation: 7, from: 31, limit: 2, after: "cursor", stream: false, pending: ["write"], store_id: "store" };
const { generation: omittedGeneration, ...strippedRequest } = legacyRequest;
const legacyInit = { method: "POST", headers: { authorization: "Bearer fixture", "content-type": "application/json" } };
const oldRefusal = () => new Response(legacyBytes, { status: 400 });
const oldPage = () => Response.json({ generation: 7, store_id: "store", watermark: 31, snapshot: false, events: [], more: false });
const record = (url, init) => ({ url, method: init.method, headers: Object.fromEntries(new Headers(init.headers)), body: JSON.parse(init.body) });

test("legacy fallback returns the distinct successful retry and latches only its origin and transport", async t => {
  const document = Object.getOwnPropertyDescriptor(globalThis, "document");
  t.after(() => document ? Object.defineProperty(globalThis, "document", document) : delete globalThis.document);
  Object.defineProperty(globalThis, "document", { configurable: true, value: { baseURI: "http://page/" } });
  const requests = [], page = oldPage(), first = oldRefusal();
  const transport = syncTransport(async (url, init) => {
    requests.push(record(url, init));
    return requests.length === 1 ? first : page;
  });
  assert.equal(first.status, 400);
  assert.deepEqual(await first.clone().json(), legacyRefusal);
  assert.equal(await transport("http://legacy/sync", legacyInit, legacyRequest), page);
  assert.equal(page.status, 200);
  assert.equal((await page.clone().json()).denied, undefined);
  await transport("http://legacy/another/sync", legacyInit, legacyRequest);
  await transport("http://modern/sync", legacyInit, legacyRequest);
  await transport("http://legacy:8080/sync", legacyInit, legacyRequest);
  const second = syncTransport(async (url, init) => { requests.push(record(url, init)); return oldPage(); });
  await second("http://legacy/sync", legacyInit, legacyRequest);
  assert.deepEqual(requests.map(r => r.body), [legacyRequest, strippedRequest, strippedRequest, legacyRequest, legacyRequest, legacyRequest]);
  assert.deepEqual(requests.map(r => r.url), ["http://legacy/sync", "http://legacy/sync", "http://legacy/another/sync", "http://modern/sync", "http://legacy:8080/sync", "http://legacy/sync"]);
  assert.ok(requests.every(r => r.method === "POST"));
  assert.ok(requests.every(r => JSON.stringify(r.headers) === JSON.stringify(Object.fromEntries(new Headers(legacyInit.headers)))));
});

for (const failure of ["same E_INPUT", "throw", 503, 429, 401, 408]) test(`legacy fallback does not latch on ${failure}`, async () => {
  const requests = [], refusedRetry = typeof failure === "number" ? new Response("retry failed", { status: failure }) : oldRefusal();
  const transport = syncTransport(async (url, init) => {
    requests.push(record(url, init));
    if (requests.length === 1) return oldRefusal();
    if (requests.length === 2) { if (failure === "throw") throw new Error("retry offline"); return refusedRetry; }
    return oldPage();
  });
  if (failure === "throw") await assert.rejects(transport("http://legacy/sync", legacyInit, legacyRequest), /retry offline/);
  else assert.equal(await transport("http://legacy/sync", legacyInit, legacyRequest), refusedRetry);
  assert.equal(requests.length, 2, "one retry, even when the same refusal persists");
  await transport("http://legacy/sync", legacyInit, legacyRequest);
  assert.deepEqual(requests.map(r => r.body), [legacyRequest, strippedRequest, legacyRequest]);
});

test("legacy fallback captures each overlapping attempt and waits for successful retry before latching", async () => {
  const requests = [], replies = [];
  const transport = syncTransport((url, init) => {
    requests.push(record(url, init));
    return new Promise(resolve => { replies.push(resolve); });
  });
  const first = transport("http://legacy/sync", legacyInit, legacyRequest);
  const second = transport("http://legacy/sync", legacyInit, legacyRequest);
  replies[0](oldRefusal());
  while (replies.length < 3) await delay(1);
  const third = transport("http://legacy/sync", legacyInit, legacyRequest);
  assert.deepEqual(requests[3].body, legacyRequest, "an in-flight stripped retry has not latched");
  assert.deepEqual(requests[2].body, strippedRequest);
  const firstPage = oldPage(), secondPage = oldPage(), thirdPage = oldPage();
  replies[2](firstPage);
  assert.equal(await first, firstPage);
  replies[1](oldRefusal());
  while (replies.length < 5) await delay(1);
  assert.deepEqual(requests[4].body, strippedRequest, "the second attempt sent generation and still gets its retry after another attempt latches");
  replies[4](secondPage); replies[3](thirdPage);
  assert.equal(await second, secondPage);
  assert.equal(await third, thirdPage);
  assert.equal(thirdPage.status, 200);
  assert.equal(requests.length, 5);
});

test("legacy fallback ignores other refusals and never retries an attempt without generation", async () => {
  for (const [status, reply] of [[200, legacyRefusal], [413, legacyRefusal], [500, legacyRefusal],
    [400, { denied: { ...legacyRefusal.denied, family: "auth" } }],
    [400, { denied: { ...legacyRefusal.denied, code: "E_AUTH" } }]]) {
    const requests = [];
    const transport = syncTransport(async (url, init) => { requests.push(record(url, init)); return new Response(reply === legacyRefusal ? legacyBytes : JSON.stringify(reply), { status }); });
    await transport("http://legacy/sync", legacyInit, legacyRequest);
    await transport("http://legacy/sync", legacyInit, legacyRequest);
    assert.deepEqual(requests.map(r => r.body), [legacyRequest, legacyRequest], "different E_INPUT must not latch");
  }
  let calls = 0;
  const transport = syncTransport(async () => { calls++; return oldRefusal(); });
  await transport("http://legacy/sync", legacyInit, strippedRequest);
  assert.equal(calls, 1);
});

test("legacy fallback ignores the current server's bad-cursor, bad-limit and bad-pending-id refusals", async t => {
  const f = await fixture(t);
  const bodies = new Set();
  for (const [name, input] of [
    ["bad-cursor", { from: 0, after: "bad-cursor" }],
    ["bad-limit", { limit: -1 }],
    ["bad-pending-id", { pending: [""] }],
  ]) {
    const response = await f.rawPost("/sync", input);
    assert.equal(response.status, 400, name);
    const bytes = await response.text();
    const reply = JSON.parse(bytes);
    assert.equal(reply.denied.code, "E_INPUT", name);
    bodies.add(bytes);
    const requests = [];
    const transport = syncTransport(async (url, init) => {
      requests.push(record(url, init));
      return new Response(bytes, { status: response.status });
    });
    await transport("http://current/sync", legacyInit, legacyRequest);
    await transport("http://current/sync", legacyInit, legacyRequest);
    assert.deepEqual(requests.map(r => r.body), [legacyRequest, legacyRequest], name);
  }
  assert.equal(bodies.size, 2, "cursor validation and request parsing have distinct real server bodies");
});

for (const base of ["document", "location", "none"]) for (const url of ["/api/sync", "//host/api/sync", "https://host/api/sync"]) {
  test(`legacy fallback accepts relative URL ${url} with ${base} base without rewriting fetch`, async t => {
    for (const name of ["document", "location"]) {
      const descriptor = Object.getOwnPropertyDescriptor(globalThis, name);
      t.after(() => descriptor ? Object.defineProperty(globalThis, name, descriptor) : delete globalThis[name]);
      Object.defineProperty(globalThis, name, { configurable: true, writable: true, value: undefined });
    }
    if (base === "document") {
      globalThis.document = { baseURI: "https://page.test/base/" };
      globalThis.location = { href: "https://ignored.test/" };
    }
    if (base === "location") globalThis.location = { href: "https://page.test/base/" };
    const requests = [], page = oldPage();
    const transport = syncTransport(async (input, init) => {
      requests.push(record(input, init));
      return requests.length === 1 ? oldRefusal() : page;
    });
    assert.equal(await transport(url, legacyInit, legacyRequest), page);
    assert.equal(await transport(url, legacyInit, legacyRequest), page);
    assert.deepEqual(requests.map(r => r.url), [url, url, url]);
    assert.deepEqual(requests.map(r => r.body), [legacyRequest, strippedRequest, strippedRequest]);
    if (base !== "none") {
      const sameOrigin = new URL(url, "https://page.test/base/").origin + "/other/sync";
      await transport(sameOrigin, legacyInit, legacyRequest);
      assert.equal(requests[3].url, sameOrigin);
      assert.deepEqual(requests[3].body, strippedRequest, "resolved origin shares the latch");
    } else {
      await transport(url + "-other", legacyInit, legacyRequest);
      assert.deepEqual(requests[3].body, legacyRequest, "unresolved URLs have separate string keys");
    }
  });
}

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

async function retainEvidence(f, transfer) {
  const storeId = (await f.ok({ op: "sync_state", capture: false })).store_id;
  assert.ok(storeId);
  const page = async (watermark, extra = {}) => {
    const c = await f.ok({ op: "sync_state" });
    return { snapshot: false, events: [], more: false, generation: 1, store_id: storeId, watermark, images_at: watermark,
      requested_watermark: c.transfer_watermark, captured_watermark: c.watermark,
      captured_restore_watermark: c.restore_watermark, captured_restore_images_at: c.restore_images_at,
      send_revision: c.send_revision, pending_through: c.pending_through, pending_complete: c.pending_complete,
      pending_bound: c.pending_bound, ...extra };
  };
  await f.ok({ op: "apply", page: await page(5) });
  await f.ok({ op: "admit", entry: { id: "q", seq: 1, op: "bump", args: {}, new_ids: [], predicted: [], viewer: "dev:alice", now: 1000, predictable: true } });
  const staged = transfer === "staged snapshot";
  const applied = await f.ok({ op: "apply", first: staged, page: await page(staged ? 20 : 10, staged
    ? { snapshot: true, stage_snapshot: true, more: true, next: "staged-continuation", requested_watermark: 0 }
    : { images_at: 20, more: true, committed_above: { q: 20 } }) });
  assert.equal(applied.published, false);
  const before = await f.ok({ op: "sync_state", capture: false });
  assert.equal(before.watermark, 5);
  assert.equal(before.restore_images_at, 20);
  if (!staged) {
    assert.equal(before.transfer_watermark, 10);
    assert.deepEqual(before.pending_ids, ["q"]);
  }
  const queued = await f.ok({ op: "queued" });
  return { storeId, before, queued };
}

for (const tier of ["wasm", "process"]) for (const transfer of ["deferred stream", "staged snapshot"]) {
  test(`${tier}: early generation head preserves restore evidence from ${transfer}`, { timeout: 90000 }, async t => {
    const f = await fixture(t, tier);
    const { storeId, queued } = await retainEvidence(f, transfer);
    await f.start(source.replace("n: int", "n: int\n  added: int default 0"));
    let syncs = 0;
    f.intercept(input => {
      if (new URL(input).pathname !== "/sync") return;
      return Response.json(syncs++ === 0
        ? { denied: { code: "E_SYNC_GENERATION", family: "generation", message: "adopt" }, generation: 2, store_id: storeId, watermark: 15 }
        : { snapshot: false, events: [], more: false, images_at: 15, generation: 2, store_id: storeId, watermark: 15 });
    });
    f.trace.length = 0; f.calls.length = 0;
    await f.client.sync();
    const state = await f.ok({ op: "sync_state", capture: false });
    assert.equal(state.restore_refusal?.code, "E_STORE_RESTORE");
    assert.equal(state.generation, 1);
    assert.equal(state.watermark, 5);
    assert.equal(state.restore_images_at, 20);
    assert.deepEqual(await f.ok({ op: "queued" }), queued);
    assert.equal(f.calls.filter(c => c.request.op === "adopt").length, 0);
    assert.equal(f.calls.filter(c => c.request.op === "begin_send").length, 0);
    assert.equal(f.trace.filter(r => r.path?.startsWith("/m/")).length, 0);
    assert.equal((await f.client.query({ kind: "query", name: "counter" }, {})).denied?.code, "E_STORE_RESTORE");
    await f.client.sync();
    assert.equal(syncs, 1, "the durable restore halt prevents retry and resend");
    assert.equal(f.calls.filter(c => c.request.op === "adopt" || c.request.op === "begin_send").length, 0);
  });
}

for (const tier of ["wasm", "process"]) for (const transfer of ["deferred stream", "staged snapshot"]) {
  for (const head of [20, 25]) test(`${tier}: early head ${head} and ordinary page decide ${transfer} evidence identically`, { timeout: 90000 }, async t => {
    const outcomes = [];
    for (const early of [false, true]) {
      const f = await fixture(t, tier);
      const { storeId } = await retainEvidence(f, transfer);
      await f.start(source.replace("n: int", "n: int\n  added: int default 0"));
      let syncs = 0;
      f.intercept(input => {
        if (new URL(input).pathname !== "/sync") return;
        const first = syncs++ === 0;
        return Response.json(early && first
          ? { denied: { code: "E_SYNC_GENERATION", family: "generation", message: "adopt" }, generation: 2, store_id: storeId, watermark: head }
          : { snapshot: false, events: [], more: false, images_at: head, generation: 2, store_id: storeId, watermark: head, acknowledged: { q: 20 } });
      });
      f.trace.length = 0; f.calls.length = 0;
      await f.client.sync();
      const state = await f.ok({ op: "sync_state", capture: false });
      assert.equal(state.restore_refusal, undefined);
      assert.equal(state.generation, 2);
      assert.equal(state.watermark, head);
      assert.equal(f.calls.filter(c => c.request.op === "adopt").length, 1);
      assert.ok(f.calls.every(c => c.reply.denied?.code !== "E_STORE_RESTORE"));
      assert.equal(syncs, 2);
      const outcome = await f.client.write("q");
      assert.ok(outcome, "the pending write has an actual client outcome");
      outcomes.push(outcome);
      await f.client.close();
    }
    assert.deepEqual(outcomes[1], outcomes[0], "early discovery and an ordinary page must decide the pending write identically");
    assert.equal(outcomes[1].state, "sent");
    assert.equal(outcomes[1].seq, 20);
  });

  test(`${tier}: missing early watermark preserves ${transfer} evidence until a headed retry`, { timeout: 90000 }, async t => {
    const f = await fixture(t, tier);
    const { before, queued } = await retainEvidence(f, transfer);
    // Advance the real server's head past the retained evidence, then change generation.
    for (let i = 0; i < 25; i++) await f.post("/m/bump", { id: `head-${i}`, args: {} });
    await f.start(source.replace("n: int", "n: int\n  added: int default 0"));
    let earlyReplies = 0, stripHead = true;
    const links = [];
    f.client.onLink(link => links.push(link));
    f.intercept(async (input, init) => {
      if (new URL(input).pathname !== "/sync") return;
      const response = await fetch(input, init);
      const reply = await response.json();
      if (reply.denied?.code === "E_SYNC_GENERATION") {
        earlyReplies++;
        assert.ok(reply.watermark >= 20);
        if (stripHead) delete reply.watermark;
      }
      return Response.json(reply, { status: response.status });
    });
    f.trace.length = 0; f.calls.length = 0;
    for (let attempt = 0; attempt < 2; attempt++) {
      await f.client.sync();
      const state = await f.ok({ op: "sync_state", capture: false });
      for (const key of ["generation", "watermark", "transfer_watermark", "restore_watermark", "restore_images_at"])
        assert.equal(state[key], before[key], key);
      assert.deepEqual(await f.ok({ op: "queued" }), queued);
      assert.equal(state.restore_refusal, undefined);
      assert.equal(f.calls.filter(c => ["observe_store", "adopt"].includes(c.request.op)).length, 0);
      assert.equal(earlyReplies, attempt + 1);
      assert.equal(links.at(-1), "offline", "malformed early heads surface a retryable link failure");
      const result = await f.client.query({ kind: "query", name: "remoteCounter" }, {});
      assert.ok(queued.some(entry => entry.predictable && entry.observed_seq == null && entry.predicted.length > 0));
      assert.equal(result.denied?.code, "E_OFFLINE", "remoteCounters is disjoint from the prediction, but has neither local facts nor memory");
    }
    stripHead = false;
    await f.client.sync();
    assert.equal(earlyReplies, 3, "both headless replies and the headed retry were observed");
    assert.equal((await f.ok({ op: "state" })).generation, 2);
    assert.equal(f.calls.filter(c => c.request.op === "adopt").length, 1);
    const observations = f.calls.filter(c => c.request.op === "observe_store" && c.request.page.denied);
    assert.equal(observations.length, 1);
    assert.ok(Number.isInteger(observations[0].request.page.images_at));
    assert.ok(observations[0].request.page.images_at >= 20);
  });
}

for (const tier of ["wasm", "process"]) test(`${tier}: invalid early heads are retryable and never reach observation or adoption`, async t => {
  const f = await fixture(t, tier);
  const { storeId, before, queued } = await retainEvidence(f, "deferred stream");
  let head, replies = 0;
  f.intercept(input => {
    if (new URL(input).pathname !== "/sync") return;
    replies++;
    const reply = { denied: { code: "E_SYNC_GENERATION", family: "generation", message: "adopt" }, generation: 2, store_id: storeId, watermark: head };
    // JSON numbers can overflow to Infinity during parsing; this is still invalid evidence.
    const bytes = JSON.stringify(reply).replace('"watermark":"nonfinite"', '"watermark":1e400');
    return new Response(bytes);
  });
  f.calls.length = 0;
  const heads = [null, -1, 20.5, "20", "nonfinite"];
  for (head of heads) {
    await f.client.sync();
    const state = await f.ok({ op: "sync_state", capture: false });
    assert.equal(state.generation, before.generation);
    assert.equal(state.restore_images_at, 20);
    assert.equal(state.watermark, before.watermark);
    assert.deepEqual(await f.ok({ op: "queued" }), queued);
    assert.equal(state.restore_refusal, undefined);
    assert.equal(f.client.link(), "offline");
  }
  assert.equal(replies, heads.length);
  assert.equal(f.calls.filter(c => ["observe_store", "adopt"].includes(c.request.op)).length, 0);
});

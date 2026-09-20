// Real HTTP encoding at the unchanged 16 MiB ceiling, SQLite server storage,
// and the production catch-up loop on both wasm and SQLite process devices.
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
import { processDevice } from "../dist/native.js";
import { memoryPersistence, webDevice } from "../dist/web.js";

const root = join(dirname(fileURLToPath(import.meta.url)), "../../..");
const binary = process.env.SNAPBACK4_BIN ?? join(root, "target/debug/snapback4");
const wasm = readFileSync(join(root, "packages/snapback4/src/wasm/snapback4_device_bg.wasm"));
const ceiling = 16 << 20, count = 44, width = 400000;
const limits = [4000, 2000, 1000, 500, 250, 125, 62, 31, 15, 7, 3, 1];
const source = `use personas alice
table items:
  body: text <=400000
  public 'sync overflow fixture'
  sync last 10000 by byId
query one(id: items):
  return items[id]
`;
const refusal = "the HTTP JSON response exceeds 16 MiB; request a smaller page or return fewer values";
const id = i => `row-${String(i).padStart(2, "0")}`;
const headers = { "x-snapback-persona": "alice" };
async function until(check, message) {
  const deadline = Date.now() + 20000;
  do { if (await check()) return; await delay(20); } while (Date.now() < deadline);
  assert.fail(message);
}

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

async function fixture(t) {
  const dir = mkdtempSync(join(tmpdir(), "sb4-sync-overflow-"));
  mkdirSync(join(dir, "snapback"));
  let url, child, exited;
  const clients = [];
  async function stop() {
    if (child && child.exitCode == null && child.signalCode == null) child.kill("SIGTERM");
    if (exited) await exited;
  }
  t.after(async () => {
    await Promise.all(clients.map(f => f.client.close()));
    await stop(); rmSync(dir, { recursive: true, force: true });
  });
  async function start(next = source, fresh = false) {
    await stop(); writeFileSync(join(dir, "snapback/schema.q"), next);
    child = spawn(binary, ["dev", "--no-watch", "--port", url ? new URL(url).port : "0", ...(fresh ? ["--fresh"] : [])], { cwd: dir, stdio: ["ignore", "pipe", "pipe"] });
    exited = once(child, "exit");
    let log = "", listening = false;
    for (const stream of [child.stdout, child.stderr]) stream.on("data", bytes => {
      log += bytes;
      const address = log.match(/http:\/\/127\.0\.0\.1:\d+/)?.[0];
      if (address) { url = address; listening = true; }
    });
    await until(() => { assert.equal(child.exitCode, null, log); return listening; }, "server did not listen");
  }
  async function post(path, body) {
    const response = await fetch(url + path, { method: "POST", headers, body: JSON.stringify(body), signal: AbortSignal.timeout(20000) });
    assert.equal(response.status, 200);
    return response.json();
  }
  async function seed(rows) { assert.equal((await post("/seed", rows.map(row => ({ table: "items", row })))).seeded, rows.length); }
  async function widen() {
    // One narrow commit, then separate wide commits within the seed request
    // ceiling. Streaming that first commit rematerializes all 44 current rows.
    await seed(Array.from({ length: count }, (_, i) => ({ id: id(i), body: "narrow" })));
    for (let offset = 0; offset < count; offset += 4) {
      await seed(Array.from({ length: 4 }, (_, n) => ({ id: id(offset + n), body: "x".repeat(width) })));
    }
  }
  async function open(tier, legacy = false) {
    const trace = [], pages = [];
    let polls = 0;
    const opener = tier === "wasm" ? webDevice({ wasm, persist: memoryPersistence() }) : processDevice({ binary, dir: join(dir, `device-${clients.length}`) });
    const f = { trace, pages, legacy, core: null, client: null };
    f.client = await createLocalClient({ url, persona: "alice", device: { open: async (...args) => {
      f.core = await opener.open(...args);
      return { call: async request => {
        if (request.op === "apply") assert.equal(request.page.denied, undefined, "a refusal is never an empty page to apply");
        return f.core.call(request);
      }, close: () => f.core.close() };
    } }, fetch: async (input, init) => {
      const path = new URL(input).pathname;
      // Keep the follower parked with real heartbeat frames, so the link
      // watchdog stays healthy and only explicit sync drives each transition.
      if (path === "/changes") { polls++; return parkedChanges(init.signal); }
      trace.push(path);
      const response = await fetch(input, init);
      if (path !== "/sync") return response;
      const request = JSON.parse(init.body), page = await response.json();
      pages.push({ request, page });
      // Model an already wedged device on the old server. The body really
      // overflowed; only the new recovery instruction is suppressed here.
      if (f.legacy && page.metadata) delete page.recovery;
      return Response.json(page, { status: response.status });
    } });
    clients.push(f);
    assert.equal(f.client.acquired, true);
    await until(() => polls > 0, "the healthy change poll did not start");
    f.trace.length = 0; f.pages.length = 0;
    return f;
  }
  await start(); await seed([{ id: "anchor", body: "small" }]);
  return { post, start, seed, widen, open };
}

async function recovered(f, generation, head) {
  const state = (await f.core.call({ op: "state" })).ok;
  assert.equal(state.generation, generation, "the real device adopted the backend generation");
  assert.equal(state.watermark, head, "snapshot and catch-up reached the real server head");
  assert.equal(f.client.acquired, true);
  const row = await f.client.query({ kind: "query", name: "one" }, { id: id(count - 1) });
  assert.equal(row.denied, undefined);
  assert.equal(row.data?.body.length, width);
  assert.equal(row.fresh, true);
}

test("oversized sync identity, indivisible-commit snapshot recovery, and wedged generation adoption", { timeout: 240000 }, async t => {
  const f = await fixture(t);
  const ordinary = [], wedged = [];
  for (const tier of ["wasm", "process"]) {
    ordinary.push({ tier, ...await f.open(tier) });
    wedged.push({ tier, f: await f.open(tier, true) });
  }
  await f.widen();
  const first = await f.post("/sync", { from: 0, limit: 1 });
  const head = first.watermark;
  assert.ok(count * width > ceiling);
  t.diagnostic(`current row body bytes=${count * width}; HTTP ceiling=${ceiling}; rows in indivisible commit=${count}; head=${head}`);
  for (const [kind, request] of [["snapshot", { from: 0, limit: 100 }], ["stream", { from: 1, stream: true, limit: 2 }]]) {
    await t.test(`${kind} overflow discovers generation and store identity through metadata`, async () => {
      const page = await f.post("/sync", request);
      assert.equal(page.denied?.message, refusal);
      assert.equal(page.generation, undefined);
      assert.equal(page.store_id, undefined);
      const metadata = await f.post("/sync", { metadata: true, store_id: first.store_id });
      assert.equal(metadata.generation, first.generation);
      assert.equal(metadata.store_id, first.store_id);
      assert.ok(Buffer.byteLength(JSON.stringify(page)) < 1000);
    });
  }
  await t.test("limit 1 grants a snapshot only after measuring the indivisible stream page", async () => {
    const page = await f.post("/sync", { from: 1, stream: true, limit: 1 });
    assert.equal(page.denied?.message, refusal);
    assert.equal(page.snapshot, undefined);
    const measured = await f.post("/sync", { metadata: true, recover: true, store_id: first.store_id,
      generation: first.generation, send_revision: 0, from: 1, stream: true, limit: 1 });
    assert.equal(measured.recovery?.snapshot, true);
    assert.equal(page.events, undefined, "an instruction carries no events");
    assert.equal(first.denied, undefined, "one snapshot row fits without raising the ceiling");
    assert.equal(first.events.length, 1);
  });
  for (const device of ordinary) await t.test(`${device.tier} reacquires an indivisible commit by snapshot at the same generation`, async () => {
    await device.client.sync();
    const data = device.pages.filter(p => !p.request.metadata);
    assert.deepEqual(data.slice(0, limits.length).map(p => p.request.limit), limits);
    assert.ok(data.slice(0, limits.length).every(p => p.request.from === 1 && !p.request.stream));
    assert.equal(data[limits.length]?.request.from, 0);
    assert.equal(data[limits.length]?.request.limit, 1);
    await recovered(device, 1, head);
  });
  for (const { tier, f: device } of wedged) {
    await device.client.sync();
    assert.equal((await device.core.call({ op: "state" })).ok.watermark, 1, "old-server refusal really wedges the device");
    assert.equal((await device.client.query({ kind: "query", name: "one" }, { id: "anchor" })).data?.body, "small", "a refusal alone cannot deny the existing partition");
    t.diagnostic(`${tier} before generation change: watermark=1; terminal limit=${device.pages.at(-1).request.limit}; refusal=E_BOUND`);
    device.legacy = false; device.trace.length = 0; device.pages.length = 0;
  }
  await f.start(source.replace("last 10000", "last 100"));
  for (const { tier, f: device } of wedged) await t.test(`${tier} a wedged device discovers generation before shrinking the oversized page`, async () => {
    await device.client.sync();
    assert.equal(device.pages[0].page.denied?.code, "E_BOUND", "the generation is discovered in a real oversized response");
    assert.deepEqual(device.trace.slice(0, 4), ["/sync", "/sync", "/schema", "/sync"], "adopt before retrying the undeliverable position");
    assert.equal(device.pages[2].request.from, 0);
    assert.equal(device.pages[2].request.limit, 4000, "generation adoption precedes shrinking");
    await recovered(device, 2, (await f.post("/sync", { from: 0, limit: 1 })).watermark);
  });
});

test("an oversized reply from a replacement store is observed before shrinking even at the same generation", { timeout: 120000 }, async t => {
  const f = await fixture(t);
  const devices = [];
  for (const tier of ["wasm", "process"]) devices.push({ tier, ...await f.open(tier) });
  const old = await f.post("/sync", { from: 0, limit: 1 });
  await f.start(source, true); await f.seed([{ id: "anchor", body: "replacement" }]); await f.widen();
  const replacement = await f.post("/sync", { from: 0, limit: 1 });
  assert.notEqual(replacement.store_id, old.store_id);
  assert.equal(replacement.generation, old.generation);
  for (const device of devices) await t.test(`${device.tier} replaces the old store before shrinking`, async () => {
    await device.client.sync();
    assert.equal(device.pages[0].page.denied?.code, "E_BOUND");
    assert.deepEqual(device.trace.slice(0, 4), ["/sync", "/sync", "/schema", "/sync"]);
    assert.equal(device.pages[2].request.from, 0);
    assert.equal(device.pages[2].request.limit, 4000);
    assert.equal((await device.core.call({ op: "sync_state" })).ok.store_id, replacement.store_id);
    await recovered(device, replacement.generation, replacement.watermark);
  });
});

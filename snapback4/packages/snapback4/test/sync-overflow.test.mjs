import { captureStdout } from './helpers/server-output.mjs';
import { waitFor as awaitState, hangBudget } from './helpers/wait.mjs';
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
const limits = [10000, 5000, 2500, 1250, 625, 312, 156, 78, 39, 19, 9, 4, 2, 1];
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
const engine = await processDevice({binary,dir:tmpdir()}).engineInfo();
const headers = { "x-snapback-persona": "alice", "x-snapback-device": JSON.stringify(engine) };
async function until(check, message) { return awaitState(check, message); }

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

async function fixture(t, empty = false) {
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
    const readStdout = captureStdout(child);
    exited = once(child, "exit");
    let log = "", listening = false;
    for (const stream of [child.stdout, child.stderr]) stream.on("data", bytes => {
      log += bytes;
      const address = readStdout().match(/http:\/\/127\.0\.0\.1:\d+(?=\r?\n)/)?.[0];
      if (address) { url = address; listening = true; }
    });
    await until(() => { assert.equal(child.exitCode, null, log); return listening; }, "server did not listen");
  }
  async function post(path, body) {
    const response = await fetch(url + path, { method: "POST", headers, body: JSON.stringify(body), signal: AbortSignal.timeout(hangBudget()) });
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
  async function open(tier, legacy = false, onPage, expectAcquired = true) {
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
      await onPage?.(request, page);
      // Model an already wedged device on the old server. The body really
      // overflowed; only the new recovery instruction is suppressed here.
      if (f.legacy && page.denied) delete page.snapshot;
      return Response.json(page, { status: response.status });
    } });
    clients.push(f);
    assert.equal(f.client.acquired, expectAcquired);
    if (expectAcquired) await until(() => polls > 0, "the healthy change poll did not start");
    f.trace.length = 0; f.pages.length = 0;
    return f;
  }
  await start(); if (!empty) await seed([{ id: "anchor", body: "small" }]);
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

test("oversized sync identity, indivisible-commit snapshot recovery, and wedged generation adoption", { timeout: hangBudget(1024) }, async t => {
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
    await t.test(`${kind} overflow preserves generation and store identity`, async () => {
      const page = await f.post("/sync", request);
      assert.equal(page.denied?.message, refusal);
      assert.equal(page.generation, first.generation);
      assert.equal(page.store_id, first.store_id);
      assert.ok(Buffer.byteLength(JSON.stringify(page)) < 1000);
    });
  }
  await t.test("limit 1 instructs a snapshot only for an indivisible stream page", async () => {
    const page = await f.post("/sync", { from: 1, stream: true, limit: 1 });
    assert.equal(page.denied?.message, refusal);
    assert.equal(page.snapshot, true);
    assert.equal(page.events, undefined, "an instruction carries no events");
    assert.equal(first.denied, undefined, "one snapshot row fits without raising the ceiling");
    assert.equal(first.events.length, 1);
  });
  for (const device of ordinary) await t.test(`${device.tier} reacquires an indivisible commit by snapshot at the same generation`, async () => {
    await device.client.sync();
    assert.deepEqual(device.pages.slice(0, limits.length).map(p => p.request.limit), limits);
    assert.ok(device.pages.slice(0, limits.length).every(p => p.request.from === 1 && !p.request.stream));
    assert.equal(device.pages[limits.length]?.request.from, 0);
    assert.equal(device.pages[limits.length]?.request.limit, 1);
    await recovered(device, 1, head);
  });
  for (const { tier, f: device } of wedged) {
    await device.client.sync();
    assert.equal((await device.core.call({ op: "state" })).ok.watermark, 1, "old-server refusal really wedges the device");
    assert.equal((await device.client.query({ kind: "query", name: "one" }, { id: "anchor" })).denied?.code, "E_BOUND");
    t.diagnostic(`${tier} before generation change: watermark=1; terminal limit=${device.pages.at(-1).request.limit}; refusal=E_BOUND`);
    device.legacy = false; device.trace.length = 0; device.pages.length = 0;
  }
  await f.start(source.replace("last 10000", "last 100"));
  for (const { tier, f: device } of wedged) await t.test(`${tier} a wedged device discovers generation before shrinking the oversized page`, async () => {
    await device.client.sync();
    assert.equal(device.pages[0].page.denied?.code, "E_SYNC_GENERATION", "the stale generation is discovered before building the oversized page");
    assert.deepEqual(device.trace.slice(0, 3), ["/sync", "/schema", "/sync"], "adopt before retrying the undeliverable position");
    assert.equal(device.pages[1].request.from, 0);
    assert.equal(device.pages[1].request.limit, 10000, "generation adoption precedes shrinking");
    await recovered(device, 2, (await f.post("/sync", { from: 0, limit: 1 })).watermark);
  });
});

test("an oversized reply from a replacement store is observed before shrinking even at the same generation", { timeout: hangBudget(1024) }, async t => {
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
    assert.deepEqual(device.trace.slice(0, 3), ["/sync", "/schema", "/sync"]);
    assert.equal(device.pages[1].request.from, 0);
    assert.equal(device.pages[1].request.limit, 10000);
    assert.equal((await device.core.call({ op: "sync_state" })).ok.store_id, replacement.store_id);
    await recovered(device, replacement.generation, replacement.watermark);
  });
});

// Port of R5 D1: request bytes fit, but per-event framing makes the first
// indivisible stream commit overflow. No synthetic refusal or metadata path.
for (const tier of ["wasm", "process"]) test(`${tier} a new replica recovers its oversized first commit`, { timeout: hangBudget(1024) }, async t => {
  const f = await fixture(t, true);
  const device = await f.open(tier);
  assert.equal((await device.core.call({ op: "state" })).ok.watermark, 0);
  const rows = Array.from({ length: 42 }, (_, i) => ({ table: "items", row: { id: `first-${i}`, body: "" } }));
  const bytes = ceiling - 100 - Buffer.byteLength(JSON.stringify(rows));
  for (let i = 0; i < rows.length; i++) rows[i].row.body = "x".repeat(Math.floor(bytes / rows.length) + (i < bytes % rows.length ? 1 : 0));
  await f.seed(rows.map(entry => entry.row));
  const stream = await f.post("/sync", { from: 0, stream: true, limit: 1 });
  assert.equal(stream.denied?.message, refusal);
  assert.equal(stream.snapshot, true);
  assert.equal(stream.watermark, 0, "a refused acquisition cannot invent applied progress");
  await device.client.sync();
  const state = (await device.core.call({ op: "state" })).ok;
  assert.equal(state.watermark, 1);
  assert.equal(device.client.acquired, true);
  assert.ok(device.pages.some(({ page }) => page.denied?.code === "E_BOUND"));
  assert.ok(device.pages.every(({ request }) => !request.metadata && !request.recover));
  assert.equal((await device.client.query({ kind: "query", name: "one" }, { id: "first-41" })).data.body, rows[41].row.body);
  t.diagnostic(JSON.stringify({ tier, before: 0, after: state.watermark, pages: device.pages.map(({ request, page }) => ({ from: request.from, stream: request.stream, limit: request.limit, denied: page.denied?.code, snapshot: page.snapshot })) }));
});

for (const tier of ["wasm", "process"]) test(`${tier} an oversized first commit arriving during zero-head snapshot catch-up restarts inline`, { timeout: hangBudget(1024) }, async t => {
  const f = await fixture(t, true);
  let added = false, refusedFromZero = false;
  const device = await f.open(tier, false, async (request, page) => {
    if (page.denied && request.from === 0 && request.stream && request.limit === 1) {
      refusedFromZero = true;
      assert.equal(page.snapshot, true);
    }
    if (!added && page.snapshot && !page.denied) {
      assert.equal(page.watermark, 0);
      added = true;
      await f.widen();
    }
  });
  assert.equal(refusedFromZero, true, "the real catch-up overflows at zero, with catchingUp true");
  await recovered(device, 1, (await f.post("/sync", { from: 0, limit: 1 })).watermark);
});

// Ported history/horizon fixture; no metadata request or grant interception.
const historySource = `use personas alice
table members:
  room: text <=40
  principal: principal
  unique byRoomPrincipal: room, principal
  by byPrincipal: principal, room
  immutable room, principal
  read <- allow
  delete <- allow
  sync public
table history:
  room: text <=40
  body: text <=40
  by byRoom: room, id
  read <- exists members[.room, viewer]
  retain delivered-history
  sync to members[.room]
table items:
  body: text <=400000
  read <- allow
  sync public last 45 by byId
table held:
  body: text <=40
  read <- allow
  sync public last 2 by byId
query heldRows():
  return held last 10 by byId
query retained():
  return history['left'] first 10 by byRoom
query marker():
  return 1
query item(id: id):
  return items[id]
mutation leave():
  delete members['member']
`;
async function historyFixture(t, tier) {
  const dir = mkdtempSync(join(tmpdir(), 'sb4-oversized-'));
  mkdirSync(join(dir, 'snapback'));
  writeFileSync(join(dir, 'snapback/schema.q'), historySource);
  const child = spawn(binary, ['dev', '--port', '0', '--no-watch'], { cwd: dir, stdio: ['ignore', 'pipe', 'pipe'] });
  const readStdout = captureStdout(child);
  const exit = once(child, 'exit');
  let log = '', url, client, core, offline = false, intercept;
  child.stdout.on('data', b => { log += b; url ??= readStdout().match(/http:\/\/127\.0\.0\.1:\d+(?=\r?\n)/)?.[0]; });
  child.stderr.on('data', b => { log += b; });
  t.after(async () => {
    await client?.close();
    if (child.exitCode == null && child.signalCode == null) child.kill('SIGTERM');
    await exit; rmSync(dir, { recursive: true, force: true });
  });
  await until(() => { assert.equal(child.exitCode, null, log); return url; }, 'server startup');
  const post = async (path, body) => fetch(url + path, { method: 'POST', headers, body: JSON.stringify(body) }).then(r => r.json());
  const seed = async rows => assert.equal((await post('/seed', rows)).seeded, rows.length);
  await seed([
    { table: 'held', row: { id: 'p1', body: 'first' } },
    { table: 'held', row: { id: 'p2', body: 'second' } },
    { table: 'members', row: { id: 'member', room: 'left', principal: 'dev:alice' } },
    { table: 'history', row: { id: 'retained', room: 'left', body: 'keep this delivered history' } },
  ]);
  const opener = tier === 'wasm' ? webDevice({ wasm, persist: memoryPersistence() }) : processDevice({ binary, dir: join(dir, 'device') });
  const requests = [], replies = [], calls = [];
  const openClient = () => createLocalClient({ url, persona: 'alice', waitSeconds: 1,
    device: { open: async (...args) => {
      core = await opener.open(...args);
      return { close: () => core.close(), call: async request => { calls.push(request); return core.call(request); } };
    } },
    fetch: async (input, init) => {
      if (offline) throw new TypeError('offline fixture');
      // Keep background polls inert; explicit client.sync drives each round.
      if (new URL(input).pathname === '/changes') return parkedChanges(init.signal);
      const path = new URL(input).pathname;
      const body = init.body ? JSON.parse(init.body) : undefined;
      const response = await intercept?.(path, body, () => fetch(input, init)) ?? await fetch(input, init);
      if (path !== '/sync') return response;
      requests.push(body);
      const page = await response.clone().json(); replies.push(page);
      return response;
    },
  });
  client = await openClient();
  assert.equal((await post('/m/leave', { id: 'leave', args: {} })).state, 'sent');
  await client.sync();
  const before = (await core.call({ op: 'sync_state' })).ok;
  offline = true;
  assert.equal((await client.query({ kind: 'query', name: 'retained' }, {})).data?.[0]?.body, 'keep this delivered history');
  return { get client() { return client; }, get core() { return core; }, requests, replies, calls, before, seed, post, dir, url,
    reopen: async () => { await client.close(); client = await openClient(); },
    intercept: handler => { intercept = handler; },
    online: () => { offline = false; requests.length = 0; replies.length = 0; calls.length = 0; },
  };
}

async function enlargedHistory(f) {
  const rows = Array.from({ length: 48 }, (_, i) => ({ table: 'items', row: { id: `wide-${String(i).padStart(2, '0')}`, body: 'small' } }));
  await f.seed(rows);
  for (let i = 0; i < rows.length; i += 4) await f.seed(rows.slice(i, i + 4).map(({ table, row }) => ({ table, row: { ...row, body: 'x'.repeat(400000) } })));
}
for (const tier of ['wasm', 'process']) test(`${tier} interrupted inline recovery retries after reopen, preserves delivered history and enforces the horizon`, { timeout: hangBudget(1024) }, async t => {
  const f = await historyFixture(t, tier);
  await enlargedHistory(f);
  const head = (await f.post('/sync', { from: 0, limit: 1 })).watermark;
  f.intercept((path, request) => {
    if (path === '/sync' && request.from === 0 && !request.stream) throw new TypeError('interrupted recovery snapshot');
  });
  f.online(); await f.client.sync();
  assert.equal((await f.core.call({ op: 'state' })).ok.watermark, f.before.watermark, 'refusal cannot apply the head');
  assert.equal((await f.client.query({ kind: 'query', name: 'retained' }, {})).data[0].body, 'keep this delivered history');
  await f.reopen();
  f.intercept(undefined);
  await f.client.sync();
  const after = (await f.core.call({ op: 'sync_state' })).ok;
  assert.equal(after.watermark, head);
  assert.equal(after.acquired, true);
  assert.equal(after.generation, f.before.generation);
  assert.ok(f.calls.every(r => r.op !== 'apply' || !r.page.denied));
  assert.ok(f.requests.every(r => !r.metadata && !r.recover));
  assert.ok(f.calls.some(r => r.op === 'apply' && r.page.acquisitions?.some(m => m.floor && m.floor !== 'whole')));
  assert.equal((await f.client.query({ kind: 'query', name: 'retained' }, {})).data[0].body, 'keep this delivered history');
  const query = id => f.core.call({ op: 'query', name: 'item', viewer: 'dev:alice', args: { id }, now: Date.now() });
  assert.equal((await query('wide-47')).ok.data.body.length, 400000);
  assert.equal((await query('wide-00')).ok.data, null, 'recovery respects the 45-row horizon');
});

for (const tier of ['wasm', 'process']) test(`${tier}: many ordinary commits recover by halving without snapshot`, { timeout: hangBudget(1024) }, async t => {
  const f = await historyFixture(t, tier);
  for (let i = 0; i < 48; i++) await f.seed([{ table: 'items', row: { id: `ordinary-${i}`, body: 'x'.repeat(400000) } }]);
  f.online(); await f.client.sync();
  const after = (await f.core.call({ op: 'sync_state' })).ok;
  assert.equal(after.generation, f.before.generation);
  assert.equal(after.watermark, (await f.post('/sync', { from: 0, limit: 1 })).watermark);
  assert.ok(f.replies.some(r => r.denied?.code === 'E_BOUND'));
  assert.ok(f.requests.every(r => !r.metadata && !r.recover));
  assert.ok(f.requests.some(r => r.limit < 10000));
  assert.ok(f.requests.every(r => r.metadata || r.from > 0));
  assert.ok(f.replies.every(r => !r.snapshot));
  const row = (await f.core.call({ op: 'query', name: 'item', viewer: 'dev:alice', args: { id: 'ordinary-47' }, now: Date.now() })).ok;
  assert.equal(row.data?.body.length, 400000);
  assert.equal((await f.client.query({ kind: 'query', name: 'retained' }, {})).data[0].body, 'keep this delivered history');
});

for (const tier of ['wasm', 'process']) test(`${tier} a snapshot continuation overflow keeps its cursor and terminates at limit one`, async t => {
  const f = await fixture(t, true);
  await f.seed([{ id: 'a', body: 'small' }, { id: 'b', body: 'small' }]);
  const first = await f.post('/sync', { from: 0, limit: 1 });
  assert.ok(first.next);
  const requests = [];
  const device = await f.open(tier, false, async (request, page) => {
    requests.push(request);
    for (const key of Object.keys(page)) delete page[key];
    if (!request.after) Object.assign(page, first);
    else Object.assign(page, { denied: { code: 'E_BOUND', family: 'bound', message: refusal },
      store_id: first.store_id, generation: first.generation, watermark: first.watermark });
  }, false);
  assert.deepEqual(requests.slice(1).map(r => r.limit), limits);
  assert.ok(requests.slice(1).every(r => r.from === 0 && !r.stream && r.after === first.next));
  assert.equal((await device.core.call({ op: 'state' })).ok.watermark, 0, 'refusals never publish the staged snapshot');
});

for (const tier of ['wasm', 'process']) test(`${tier} bare refusals retain held rows beyond the horizon and allow a later sync retry`, async t => {
  const f = await historyFixture(t, tier);
  await f.seed([{ table: 'held', row: { id: 'p3', body: 'third' } }]);
  f.online(); await f.client.sync();
  const rows = async () => (await f.core.call({ op: 'query', name: 'heldRows', viewer: 'dev:alice', args: {}, now: Date.now() })).ok.data.map(r => r.id);
  assert.deepEqual(await rows(), ['p3', 'p2', 'p1']);
  const before = (await f.core.call({ op: 'state' })).ok;
  f.intercept(path => path === '/sync' ? Response.json({ denied: { code: 'E_BOUND', family: 'bound', message: refusal } }) : undefined);
  f.online(); await f.client.sync();
  assert.deepEqual((await f.core.call({ op: 'state' })).ok, before);
  assert.deepEqual(await rows(), ['p3', 'p2', 'p1']);
  assert.ok(f.calls.every(r => r.op !== 'apply' && r.op !== 'adopt'));
  assert.ok(f.requests.every(r => r.from > 0 && !r.metadata && !r.recover));
  f.intercept(undefined);
  await f.client.sync();
  assert.deepEqual(await rows(), ['p3', 'p2', 'p1']);
  assert.equal((await f.client.query({ kind: 'query', name: 'retained' }, {})).data[0].body, 'keep this delivered history');
});

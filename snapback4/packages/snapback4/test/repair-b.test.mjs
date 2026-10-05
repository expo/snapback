import { captureStdout } from './helpers/server-output.mjs';
import { waitFor as awaitState, hangBudget } from './helpers/wait.mjs';
// Native round trip uses the same Device without requiring a wasm build.
import test from "node:test";
import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { once } from "node:events";
import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { createLocalClient } from "../dist/local.js";
import { processDevice } from "../dist/native.js";

const root = join(dirname(fileURLToPath(import.meta.url)), "../../..");
const binary = process.env.SNAPBACK4_BIN ?? join(root, "target/debug/snapback4");
const source = `use personas alice, bob
table counters:
  n: int
  read <- allow
  update <- allow
  sync public
query counter():
  return counters['a']
mutation bump():
  c = counters['a'] ! else NOT_FOUND
  update counters['a'] {n: c.n + 1}
`;
test("Repair B carries both bounds and resumes a private transfer cursor", { timeout: hangBudget(27) }, async t => {
  const directory = mkdtempSync(join(tmpdir(), "sb4-repair-b-"));
  mkdirSync(join(directory, "snapback"));
  mkdirSync(join(directory, "devices"));
  writeFileSync(join(directory, "snapback/schema.q"), source);
  const server = spawn(binary, ["dev", "--port", "0", "--no-watch", "--memory", "--hold-schedules"], { cwd: directory, stdio: ["ignore", "pipe", "pipe"] });
  const readStdout = captureStdout(server);
  const exited = once(server, "exit");
  let log = "", client, core;
  server.stderr.on("data", chunk => { log += chunk; });
  t.after(async () => { await client?.close(); if (server.exitCode == null && server.signalCode == null) server.kill(); await exited; rmSync(directory, { recursive: true, force: true }); });
  const url = await new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error(log)), hangBudget());
    server.once("exit", () => { clearTimeout(timer); reject(new Error(log)); });
    server.stdout.on("data", chunk => { log += chunk; const address = readStdout().match(/http:\/\/127\.0\.0\.1:\d+(?=\r?\n)/)?.[0]; if (address) { clearTimeout(timer); resolve(address); } });
  });
  const post = async (path, body, persona = "alice") => {
    const r = await fetch(`${url}${path}`, { method: "POST", headers: { "x-snapback-persona": persona, "content-type": "application/json" }, body: JSON.stringify(body) });
    const v = await r.json(); assert.equal(r.status, 200, JSON.stringify(v)); return v;
  };
  assert.equal((await post("/seed", [{ table: "counters", row: { id: "a", n: 0 } }])).seeded, 1);
  const opener = processDevice({ binary, dir: join(directory, "devices") });
  let mode = "initial", replies = 0;
  const applied = [], requests = [], observed = [];
  client = await createLocalClient({ url, persona: "alice", waitSeconds: 1,
    device: { open: async (...args) => {
      core = await opener.open(...args);
      return { close: () => core.close(), call: async request => {
        const reply = await core.call(request);
        if (request.op === "apply") applied.push({ page: request.page, reply });
        if (request.op === "query" && reply.ok?.data?.n != null) observed.push(reply.ok.data.n);
        return reply;
      } };
    } },
    fetch: async (input, init) => {
      const path = new URL(input).pathname;
      if (path === "/changes" || path === "/probe") throw new TypeError("fixture holds background polling");
      if (path === "/sync") {
        if (mode === "hold" || (mode === "interrupt" && replies++ > 0)) throw new TypeError("fixture interrupts catch-up");
        const request = JSON.parse(init.body);
        if (mode !== "initial") request.limit = 1;
        requests.push(request);
        return fetch(input, { ...init, body: JSON.stringify(request) });
      }
      return fetch(input, init);
    },
  });
  const ok = async request => { const r = await core.call(request); assert.ok(!r.denied, JSON.stringify(r)); return r.ok; };
  const read = async () => { const result = await ok({ op: "query", name: "counter", viewer: "dev:alice", args: {}, now: 1000 }); observed.push(result.data.n); return result.data.n; };
  assert.equal(await read(), 0);
  const watch = client.observe({ kind: "query", name: "counter" }, {});
  const watched = [];
  watch.subscribe(() => { const value = watch.getSnapshot().data?.n; if (value != null) watched.push(value); });
  t.after(() => watch.close());
  const published = (await ok({ op: "state" })).watermark;
  mode = "hold";
  await post("/m/bump", { id: "bob", args: {} }, "bob");
  await ok({ op: "admit", entry: { id: "alice", seq: 1, op: "bump", args: {}, new_ids: [], predicted: [], viewer: "dev:alice", now: 1000, predictable: true } });
  await ok({ op: "begin_send" });
  const sent = await post("/m/bump", { id: "alice", args: {} });
  assert.equal(sent.state, "sent");
  mode = "interrupt";
  await client.sync();
  assert.equal(await read(), 1);
  assert.equal((await ok({ op: "state" })).watermark, published);
  const deferred = applied.find(({ page }) => page.committed_above?.alice);
  assert.ok(deferred);
  assert.equal(deferred.page.images_at, sent.seq);
  assert.equal(deferred.page.committed_above.alice, sent.seq);
  assert.equal(deferred.page.pending_through, 1);
  assert.equal(deferred.page.pending_complete, true);
  assert.deepEqual(deferred.reply.ok.touched, []);
  const capture = await ok({ op: "sync_state" });
  assert.equal(capture.watermark, published);
  assert.equal(capture.transfer_watermark, deferred.page.watermark);
  assert.deepEqual(capture.pending_ids, ["alice"]);
  const count = requests.length;
  mode = "resume";
  await client.sync();
  assert.equal(requests[count].from, capture.transfer_watermark);
  assert.equal(await read(), 2);
  assert.equal((await ok({ op: "state" })).watermark, sent.seq);
  const remaining = (await ok({ op: "queued" })).find(q => q.id === "alice");
  assert.ok(!remaining || remaining.observed_seq === sent.seq);
  await client.query({ kind: "query", name: "counter" }, {});
  await awaitState(async () => !(watch.getSnapshot().data?.n !== 2), "repair-b.test.mjs: watch.getSnapshot().data?.n !== 2", { poll: async () => { await new Promise(resolve => setTimeout(resolve, 10)); } });
  assert.equal(watch.getSnapshot().data.n, 2);
  assert.ok(watched.length > 0);
  assert.ok(watched.every(n => n <= 2), JSON.stringify(watched));
  assert.ok(observed.every(n => n <= 2), JSON.stringify(observed));
});

test("catch-up requests adopt the device transfer cursor", { timeout: hangBudget(3) }, async () => {
  // Exercise the live TypeScript transport without a server/device build.
  // The stub supplies durable cursor facts only; it does not implement replay.
  const { createLocalClient: create } = await import(process.env.REPAIR_B_LOCAL ?? "../dist/local.js");
  const backend = { generation: 1, schema: { tables: {} }, programs: [] };
  let applied = 0, published = 0;
  const requests = [];
  const core = { close: async () => {}, call: async request => {
    switch (request.op) {
      case "observe_store": return { ok: { reset: false, backend_required: false, send_revision: 0, retired: {} } };
      case "backend": return { ok: backend };
      case "meta": return { ok: null };
      case "state": return { ok: { watermark: published, generation: 1 } };
      case "queued": return { ok: [] };
      case "sync_state": return { ok: { acquired: published > 0, backend_required: false, store_id: null,
        watermark: published, transfer_watermark: applied ? 7 : 0, generation: 1,
        restore_watermark: 0, restore_images_at: 0, receipt_outcomes: true, outbox_status: true, adoption_capture: {}, pending_ids: [], pending_through: 0, pending_complete: true, pending_bound: 0, send_revision: 0 } };
      case "apply":
        applied++;
        if (!request.page.snapshot) published = request.page.watermark;
        return { ok: { touched: [], published: !request.page.snapshot } };
      case "set_meta": case "keep_write": case "adopt": return { ok: null };
      case "next_submission": return { ok: 1 };
      default: throw new Error(`unexpected device operation ${request.op}`);
    }
  } };
  const client = await create({ url: "http://cursor.invalid", persona: "alice", device: { open: async () => core },
    fetch: async (url, init) => {
      const path = new URL(url).pathname;
      if (path === "/schema") return Response.json(backend);
      if (path === "/sync") {
        const request = JSON.parse(init.body); requests.push(request);
        if (requests.length === 1) return Response.json({ snapshot: true, events: [], watermark: 5, more: false, generation: 1 });
        // A durable transfer may have advanced since the last response (e.g.
        // another owner). Catch-up must take sync_state's current cursor.
        return Response.json({ snapshot: false, events: [], watermark: 8, images_at: 8, more: false, generation: 1 });
      }
      throw new TypeError("background transport held");
    },
  });
  try {
    assert.equal(requests.length, 2);
    assert.equal(requests[1].stream, true);
    assert.equal(requests[1].from, 7);
    assert.equal(published, 8);
  } finally { await client.close(); }
});

test("interrupted snapshot catch-up resumes its durable mode", { timeout: hangBudget(4) }, async () => {
  const { createLocalClient: create } = await import(process.env.REPAIR_B_LOCAL ?? "../dist/local.js");
  const backend = { generation: 1, schema: { tables: {} }, programs: [] };
  let staged = false, published = 0, failures = 1;
  const requests = [];
  const core = { close: async () => {}, call: async request => {
    switch (request.op) {
      case "observe_store": return { ok: { reset: false, backend_required: false, send_revision: 0, retired: {} } };
      case "backend": return { ok: backend };
      case "meta": return { ok: null };
      case "state": return { ok: { watermark: published, generation: 1 } };
      case "queued": return { ok: [] };
      case "sync_state": return { ok: { acquired: published > 0, backend_required: false, store_id: null,
        watermark: published, transfer_watermark: staged ? 5 : published, snapshot_catchup: staged,
        generation: 1, restore_watermark: 0, restore_images_at: 0, receipt_outcomes: true, outbox_status: true, adoption_capture: {}, pending_ids: [], pending_through: 0, pending_complete: true, pending_bound: 0, send_revision: 0 } };
      case "apply":
        if (request.page.snapshot) { staged = true; return { ok: { touched: [], published: false } }; }
        if (staged) {
          assert.equal(request.page.snapshot_catchup, true);
          assert.equal(request.first, false);
        } else {
          assert.equal(request.page.snapshot_catchup, false);
          assert.equal(request.first, true);
        }
        staged = false; published = request.page.watermark;
        return { ok: { touched: [], published: true } };
      case "set_meta": case "keep_write": case "adopt": return { ok: null };
      case "next_submission": return { ok: 1 };
      default: throw new Error(`unexpected device operation ${request.op}`);
    }
  } };
  const client = await create({ url: "http://resume.invalid", persona: "alice", device: { open: async () => core },
    fetch: async (url, init) => {
      const path = new URL(url).pathname;
      if (path === "/schema") return Response.json(backend);
      if (path === "/sync") {
        const request = JSON.parse(init.body); requests.push(request);
        if (requests.length === 1) return Response.json({ snapshot: true, events: [], watermark: 5, more: false, generation: 1 });
        if (failures-- > 0) throw new TypeError("interrupted after staging");
        if (staged) {
          assert.equal(request.stream, true, "the new syncRound must recover staged transfer mode");
          assert.equal(request.from, 5);
        } else {
          assert.equal(request.stream, false, "the explicit follow-up begins after publication");
          assert.equal(request.from, 8);
        }
        return Response.json({ snapshot: false, events: [], watermark: 8, images_at: 8, more: false, generation: 1 });
      }
      throw new TypeError("background transport held");
    },
  });
  try {
    assert.equal(staged, true);
    await client.sync();
    assert.equal(published, 8);
    assert.equal(staged, false);
    // Startup already began recovery; explicit sync must then observe a newer round.
    assert.deepEqual(requests.map(r => [r.from, r.stream]), [[0, false], [5, true], [5, true], [8, false]]);
  } finally { await client.close(); }
});

test("generation adoption compares published identity during private acquisition", { timeout: hangBudget(3) }, async () => {
  const { createLocalClient: create } = await import(process.env.REPAIR_B_LOCAL ?? "../dist/local.js");
  let generation = 1, staged = false, published = 0, adopted = 0, serverGeneration = 1;
  const stateReads = [];
  const backend = () => ({ generation: serverGeneration, schema: { tables: {} }, programs: [] });
  const core = { close: async () => {}, call: async request => {
    switch (request.op) {
      case "observe_store": return { ok: { reset: false, backend_required: false, send_revision: 0, retired: {} } };
      case "backend": return { ok: { ...backend(), generation } };
      case "meta": return { ok: null };
      case "state": return { ok: { watermark: published, generation } };
      case "queued": return { ok: [] };
      case "sync_state": stateReads.push({ capture: request.capture, requested: false }); return { ok: { acquired: published > 0, backend_required: false,
        store_id: published ? "store" : null, transfer_store_id: staged || published ? "store" : null,
        watermark: published, transfer_watermark: staged ? 5 : published, snapshot_catchup: staged,
        generation, restore_watermark: 0, restore_images_at: 0, receipt_outcomes: true, outbox_status: true, adoption_capture: {}, pending_ids: [], pending_through: 0, pending_complete: true, pending_bound: 0, send_revision: 0 } };
      case "adopt":
        assert.equal(request.store_id, null, "adoption must compare the published identity, not the private transfer");
        assert.equal(request.send_revision, 0);
        adopted++; generation = request.backend.generation; staged = false;
        return { ok: null };
      case "apply":
        if (request.page.snapshot) { staged = true; return { ok: { touched: [], published: false } }; }
        staged = false; published = request.page.watermark;
        return { ok: { touched: [], published: true } };
      case "set_meta": case "keep_write": return { ok: null };
      case "next_submission": return { ok: 1 };
      default: throw new Error(`unexpected device operation ${request.op}`);
    }
  } };
  let requests = 0;
  const client = await create({ url: "http://adopt-private.invalid", persona: "alice", device: { open: async () => core },
    fetch: async (url, init) => {
      const path = new URL(url).pathname;
      if (path === "/schema") return Response.json(backend());
      if (path === "/sync") {
        stateReads.at(-1).requested = true;
        requests++;
        const request = JSON.parse(init.body);
        if (requests === 2) serverGeneration = 2;
        return Response.json({ snapshot: !request.stream, events: [], watermark: 5,
          images_at: 5, store_id: "store", more: false, generation: serverGeneration });
      }
      throw new TypeError("background transport held");
    },
  });
  try {
    assert.ok(stateReads.some(read => !read.requested));
    assert.ok(stateReads.every(read => read.requested || read.capture === false), "every state read outside a sync request must be read-only");
    assert.equal(adopted, 1, "generation adoption must succeed on its first attempt");
    assert.equal(published, 5);
    assert.equal(requests, 4);
  } finally { await client.close(); }
});

test("row reset between A2 acquisition and B fetches B's backend and retires A's receipt", { timeout: hangBudget(28) }, async t => {
  const directory = mkdtempSync(join(tmpdir(), "sb4-repair-b-reset-"));
  const servers = [];
  let client, core, deviceName, switched = false, adoptedA2 = false, bSchemas = 0, schemaReads = 0, receipt;
  t.after(async () => {
    await client?.close(); await core?.close();
    for (const { server, exited } of servers) { if (server.exitCode == null && server.signalCode == null) server.kill(); await exited; }
    rmSync(directory, { recursive: true, force: true });
  });
  async function host(label) {
    const cwd = join(directory, label); mkdirSync(join(cwd, "snapback"), { recursive: true });
    writeFileSync(join(cwd, "snapback/schema.q"), `${source}\nquery stamp():\n  return '${label}'\n`);
    const server = spawn(binary, ["dev", "--port", "0", "--no-watch", "--memory", "--hold-schedules"], { cwd, stdio: ["ignore", "pipe", "pipe"] });
    const readStdout = captureStdout(server);
    const exited = once(server, "exit"); servers.push({ server, exited });
    let log = ""; server.stderr.on("data", chunk => { log += chunk; });
    return await new Promise((resolve, reject) => {
      const timer = setTimeout(() => reject(new Error(log)), hangBudget());
      server.once("exit", () => { clearTimeout(timer); reject(new Error(log)); });
      server.stdout.on("data", chunk => { log += chunk; const address = readStdout().match(/http:\/\/127\.0\.0\.1:\d+(?=\r?\n)/)?.[0]; if (address) { clearTimeout(timer); resolve(address); } });
    });
  }
  const a = await host("A1"), b = await host("B");
  const headers = { "x-snapback-persona": "alice", "content-type": "application/json" };
  async function post(base, path, body) {
    const r = await fetch(`${base}${path}`, { method: "POST", headers, body: JSON.stringify(body) });
    const result = await r.json(); assert.equal(r.status, 200, JSON.stringify(result)); return result;
  }
  await post(a, "/seed", [{ table: "counters", row: { id: "a", n: 0 } }]);
  await post(b, "/seed", [{ table: "counters", row: { id: "a", n: 50 } }]);
  const opener = processDevice({ binary, dir: join(directory, "devices") });
  async function ok(request) { const reply = await core.call(request); assert.ok(!reply.denied, JSON.stringify(reply)); return reply.ok; }
  client = await createLocalClient({ url: a, persona: "alice", waitSeconds: 1,
    device: { open: async (name, backend) => {
      deviceName = name; core = await opener.open(name, backend);
      return { close: () => core.close(), call: async request => {
        const reply = await core.call(request);
        if (request.op === "adopt" && !switched && !reply.denied) adoptedA2 = true;
        if (request.op === "apply" && request.page.snapshot && !switched && !reply.denied) {
          assert.ok(adoptedA2); assert.equal(reply.ok.published, false);
          await ok({ op: "admit", entry: { id: "old-a", seq: 0, op: "bump", args: {}, new_ids: [], predicted: [], viewer: "dev:alice", now: 1000, predictable: true } });
          await ok({ op: "begin_send" });
          receipt = (await post(a, "/m/bump", { id: "old-a", args: {} })).seq;
          assert.ok(Number.isSafeInteger(receipt));
          await ok({ op: "settle", id: "old-a", seq: receipt });
          await ok({ op: "clear_rows" });
          await core.close(); core = await opener.open(deviceName);
          switched = true;
        }
        return reply;
      } };
    } },
    fetch: async (input, init) => {
      const path = new URL(input).pathname;
      if (path === "/changes" || path === "/probe") throw new TypeError("fixture holds background polling");
      // The fixture presents these generation-1 engines as generation 2.
      // Translate the request as well as the response, so the real server's
      // early check compares both sides in its own generation numbering.
      let forwarded = init;
      if (path === "/sync") {
        const request = JSON.parse(init.body);
        if (request.generation !== undefined) request.generation = Math.max(0, request.generation - 1);
        forwarded = { ...init, body: JSON.stringify(request) };
      }
      const response = await fetch(`${switched ? b : a}${path}`, forwarded);
      if (path !== "/schema" && path !== "/sync") return response;
      let body = await response.json();
      if (path === "/schema") {
        if (switched) bSchemas++;
        else if (adoptedA2 || schemaReads++ > 0) body = JSON.parse(JSON.stringify(body).replaceAll('"A1"', '"A2"'));
        body.generation = switched || schemaReads > 1 ? 2 : 1;
      } else body.generation = 2;
      return Response.json(body, { status: response.status });
    },
  });
  assert.ok(switched);
  assert.equal(bSchemas, 1, "same-generation replacement must fetch B's backend");
  for (let reopen = 0; reopen < 3; reopen++) {
    if (reopen) { await core.close(); core = await opener.open(deviceName); }
    assert.deepEqual(await ok({ op: "queued" }), []);
    assert.equal((await ok({ op: "query", name: "stamp", viewer: "dev:alice", args: {}, now: 1000 })).data, "B");
    assert.equal((await ok({ op: "query", name: "counter", viewer: "dev:alice", args: {}, now: 1000 })).data.n, 50);
  }
});

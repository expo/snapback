import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync, mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { spawn } from "node:child_process";
import { once } from "node:events";
import { memoryPersistence, webDevice } from "../dist/web.js";
import { createLocalClient } from "../dist/local.js";
import { createClient } from "../dist/client.js";
import { guardClient } from "../dist/app-client.js";
import { processDevice } from "../dist/native.js";
import { readResidency } from "../dist/residency.js";
import initWasm from "../dist/wasm/snapback4_device.js";

const wasm = readFileSync(new URL("../dist/wasm/snapback4_device_bg.wasm", import.meta.url));
const backend = JSON.parse(readFileSync(new URL("./chat-schema.json", import.meta.url), "utf8"));
const ok = reply => { assert.ok(!reply.denied, JSON.stringify(reply)); return reply.ok; };
const events = [
  { table: "conversations", id: "c1", title: "é🦀", creatorId: "dev:alice" },
  { table: "memberships", id: "m1", conversationId: "c1", principal: "dev:alice", role: "admin", joinedAt: 1 },
  { table: "messages", id: "confirmed", conversationId: "c1", authorId: "dev:alice", body: "é🦀", at: 1, editedAt: null, photo: null },
].map(({ table, ...data }) => ({ table, id: data.id, kind: "put", data }));
const snapshot = events => ({ op: "apply", first: true, page: { snapshot: true, generation: 1, events, watermark: 1, more: false } });

test("web residency reconciles committed UTF-8 bytes through prediction, rollback, deletion and reopen", async t => {
  const memory = memoryPersistence();
  let fail = false, loads = 0;
  const persist = { ...memory, async load(name) { loads++; return memory.load(name); }, async save(name, changes) {
    if (fail) { fail = false; throw Error("save failed"); }
    return memory.save(name, changes);
  } };
  const opener = webDevice({ wasm, persist });
  let core = await opener.open(t.name, backend);
  const { memory: heap } = await initWasm({ module_or_path: wasm });
  t.after(() => core.close());
  async function verify() {
    const loaded = loads;
    const report = ok(await core.call({ op: "residency" }));
    assert.equal(loads, loaded, "measurement does not reload persistence");
    const saved = await memory.load(t.name);
    let total = 0;
    const tables = Object.fromEntries(Object.keys(backend.schema.tables).map(name => [name, { rows: 0, bytes: 0 }]));
    for (const { s, k, v } of saved) {
      total += Buffer.byteLength(s) + Buffer.byteLength(k) + Buffer.byteLength(v);
      if (s === "r") { const [name] = JSON.parse(k); tables[name].rows++; tables[name].bytes += Buffer.byteLength(v); }
    }
    assert.deepEqual(report.tables, tables);
    assert.equal(report.totalBytes, total);
    assert.equal(report.totalBytesKind, "logical");
    assert.equal(report.wasmHeapBytes, heap.buffer.byteLength, "the actual allocated wasm memory");
    return report;
  }
  assert.equal((await verify()).tables.messages.rows, 0);
  ok(await core.call(snapshot(events)));
  assert.equal((await verify()).tables.messages.rows, 1);
  ok(await core.call({ op: "admit", entry: { id: "pending", seq: 1, op: "send", args: { conversationId: "c1", body: "pending🦀" }, viewer: "dev:alice", now: 10, new_ids: ["pending"], predictable: true } }));
  assert.equal((await verify()).tables.messages.rows, 2);
  fail = true;
  await assert.rejects(core.call(snapshot([])), /save failed/);
  // Reopening after an aborted save rebuilds counters from durable records.
  ok(await core.call({ op: "state" }));
  assert.equal((await verify()).tables.messages.rows, 2);
  ok(await core.call({ op: "settle", id: "pending" }));
  assert.equal((await verify()).tables.messages.rows, 1);
  await core.close(); core = await opener.open(t.name, null);
  assert.equal((await verify()).tables.messages.rows, 1);
  ok(await core.call({ op: "clear_rows" }));
  assert.equal((await verify()).tables.messages.rows, 0);
  const before = await verify();
  const previousPages = heap.grow(2);
  assert.equal(previousPages * 65536, before.wasmHeapBytes);
  const after = await verify();
  assert.equal(after.wasmHeapBytes, before.wasmHeapBytes + 2 * 65536);
  assert.deepEqual(after.tables, before.tables);
  assert.equal(after.totalBytes, before.totalBytes);
});

test("client residency works offline and fences a closed or retired client", async t => {
  const opener = webDevice({ wasm, persist: memoryPersistence() });
  const client = await createLocalClient({ url: "http://offline.invalid", persona: "alice", fetch: async () => { throw Error("offline"); },
    device: { open: () => opener.open(t.name, backend) } });
  t.after(() => client.close());
  assert.equal((await client.residency()).tables.messages.rows, 0);
  const online = createClient({ url: "http://offline.invalid", persona: "alice", fetch: async () => { throw Error("offline"); } });
  assert.equal(await online.residency(), null); await online.close();
  let valid = true, resolve;
  const raw = { ...client, residency: () => new Promise(r => { resolve = r; }) };
  const guarded = guardClient(raw, async () => valid, () => valid, () => ({ code: "E_AUTH", family: "auth", message: "retired" }));
  const pending = guarded.client.residency();
  while (!resolve) await new Promise(r => setImmediate(r));
  valid = false; resolve({ tables: {}, totalBytes: 0, totalBytesKind: "logical" });
  await assert.rejects(pending, error => error.code === "E_AUTH");
  await client.close();
  await assert.rejects(client.residency(), error => error.code === "E_CLOSED");
});

test("public client residency reads the native process store offline", async t => {
  const dir = mkdtempSync(join(tmpdir(), "sb4-native-residency-"));
  let child;
  const opener = processDevice({ dir, binary: fileURLToPath(new URL("../../../target/debug/snapback4", import.meta.url)),
    spawn: (...args) => child = spawn(...args) });
  const core = await opener.open("native-residency", backend);
  t.after(async () => { await core.close(); rmSync(dir, { recursive: true, force: true }); });
  ok(await core.call(snapshot(events)));
  const client = await createLocalClient({ url: "http://offline.invalid", persona: "alice", fetch: async () => { throw Error("offline"); },
    device: { open: async () => core } });
  t.after(() => client.close());
  const report = await client.residency();
  assert.equal(report.tables.messages.rows, 1);
  assert.ok(report.tables.messages.bytes >= Buffer.byteLength("é🦀"));
  assert.equal(report.totalBytesKind, "sqlite-pages");
  assert.ok(report.totalBytes >= Object.values(report.tables).reduce((sum, table) => sum + table.bytes, 0));
  assert.equal(report.wasmHeapBytes, undefined);
  const exited = once(child, "close");
  child.kill("SIGKILL");
  await exited;
  await assert.rejects(client.residency(), error => error.code === "E_STORE" && error.family === "store"
    && error.site === "client.residency" && /native device exited/.test(error.message) && /reopen/.test(error.rewrite));
});

test("residency codes rejected device reads, preserves returned refusals, and rechecks closed/session state", async () => {
  const refused = { code: "E_BOUND", family: "bound", message: "device read bound", site: "device", rewrite: "reduce tables" };
  await assert.rejects(readResidency(async () => ({ denied: refused }), () => null), error => {
    for (const [key, value] of Object.entries(refused)) if (key !== "message") assert.equal(error[key], value);
    return error.message.includes(refused.message);
  });
  await assert.rejects(readResidency(async () => { throw Error("device host died"); }, () => null), error =>
    error.code === "E_STORE" && error.family === "store" && error.site === "client.residency" && /device host died/.test(error.message));
  for (const failure of ["reject", "refuse"]) {
    for (const state of [{ code: "E_CLOSED", family: "client", message: "closed" }, { code: "E_AUTH", family: "auth", message: "signed out" }]) {
      let unavailable = null, finish;
      const pending = readResidency(() => new Promise((resolve, reject) => {
        finish = () => failure === "reject" ? reject(Error("host died")) : resolve({ denied: refused });
      }), () => unavailable);
      unavailable = state;
      finish();
      await assert.rejects(pending, error => error.code === state.code && error.family === state.family);
    }
  }
});

test("app residency rechecks session custody even when the raw device read rejects", async () => {
  let valid = true, reject;
  const guarded = guardClient({ residency: () => new Promise((_, r) => { reject = r; }) },
    async () => valid, () => valid, () => ({ code: "E_AUTH", family: "auth", message: "retired" }));
  const pending = guarded.client.residency();
  while (!reject) await new Promise(r => setImmediate(r));
  valid = false;
  reject(Error("host died"));
  await assert.rejects(pending, error => error.code === "E_AUTH" && error.family === "auth");
});

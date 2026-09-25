import test from "node:test";
import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { once } from "node:events";
import { mkdtempSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { createLocalClient } from "../dist/local.js";
import { memoryPersistence, webDevice } from "../dist/web.js";

const root = join(dirname(fileURLToPath(import.meta.url)), "../../..");
const binary = process.env.SNAPBACK4_BIN ?? join(root, "target/debug/snapback4");
const wasm = readFileSync(join(root, "packages/snapback4/src/wasm/snapback4_device_bg.wasm"));
const source = `use personas alice
table notes:
  body: text <=100
  public 'store reset fixture'
  insert <- allow
  sync
query all():
  return notes first 100 by byId
mutation add(body: text <=100):
  return insert notes { body }
`;
const query = { kind: "query", name: "all" };
const mutation = { kind: "mutation", name: "add" };
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
async function until(check, message) {
  const end = Date.now() + 20000;
  do { if (await check()) return; await sleep(20); } while (Date.now() < end);
  assert.fail(message);
}
async function fixture(t, durable = false) {
  const dir = mkdtempSync(join(tmpdir(), "sb4-store-reset-"));
  mkdirSync(join(dir, "snapback")); writeFileSync(join(dir, "snapback/schema.q"), source);
  let child, exit, url, client, core, offline = false, interrupt = false, replies = 0;
  const pages = [], writes = [], persist = memoryPersistence();
  async function stop() {
    if (child && child.exitCode == null && child.signalCode == null) child.kill("SIGTERM");
    if (exit) await exit;
  }
  t.after(async () => { await client?.close(); await stop(); rmSync(dir, { recursive: true, force: true }); });
  async function start(fresh = true, replacementSource) {
    await stop();
    if (replacementSource) writeFileSync(join(dir, "snapback/schema.q"), replacementSource);
    const port = url ? new URL(url).port : "0";
    child = spawn(binary, ["dev", "--port", port, ...(fresh ? ["--fresh"] : [])], { cwd: dir, stdio: ["ignore", "pipe", "pipe"] });
    exit = once(child, "exit"); let log = "", listening = false;
    child.stdout.on("data", (data) => { log += data; const address = log.match(/http:\/\/127\.0\.0\.1:\d+/)?.[0]; if (address) { url = address; listening = true; } });
    child.stderr.on("data", (data) => { log += data; });
    await until(() => { assert.equal(child.exitCode, null, log); return listening; }, "server did not start");
  }
  const headers = { "x-snapback-persona": "alice" };
  const post = (path, body) => fetch(`${url}${path}`, { method: "POST", headers, body: JSON.stringify(body) }).then((r) => r.json());
  const seed = async (prefix, count) => { for (let n = 0; n < count; n++) assert.equal((await post("/seed", [{ table: "notes", row: { id: `${prefix}-${n}`, body: prefix } }])).seeded, 1); };
  async function open() {
    const opener = webDevice({ wasm, persist });
    client = await createLocalClient({ url, persona: "alice", waitSeconds: 1,
      device: { open: async (...args) => { core = await opener.open(...args); return core; } },
      fetch: async (input, init) => {
        if (offline) throw new TypeError("offline");
        const path = new URL(input).pathname;
        if (path === "/sync") {
          if (interrupt && replies > 0) throw new TypeError("interrupted reacquisition");
          const body = JSON.parse(init.body);
          const response = await fetch(input, { ...init, body: JSON.stringify({ ...body, limit: 2 }) });
          pages.push({ request: body, reply: await response.clone().json() }); replies++; return response;
        }
        if (path.startsWith("/m/")) {
          if (interrupt) throw new TypeError("write held across reacquisition");
          writes.push(JSON.parse(init.body));
        }
        return fetch(input, init);
      },
    });
    return client;
  }
  await start(!durable);
  return { start, seed, open, post, pages, writes, core: () => core, offline: (v) => { offline = v; }, interrupt: (v) => { interrupt = v; replies = 0; } };
}

test("wasm: persisted device reacquires after two backend replacements and preserves an unsent write", { timeout: 60000 }, async (t) => {
  const f = await fixture(t); await f.seed("A", 3);
  let client = await f.open();
  const acquired = await client.query(query, {});
  assert.equal(acquired.data.length, 3); assert.equal(acquired.fresh, true);
  const a = (await f.core().call({ op: "state" })).ok;
  f.offline(true); await client.sync();
  const pending = await client.mutate(mutation, { body: "unsent" }); assert.equal(pending.state, "pending");
  await client.close(); await f.start(); await f.seed("B", 1);
  f.offline(false); f.interrupt(true); client = await f.open();
  const b = (await f.core().call({ op: "state" })).ok;
  const local = await f.core().call({ op: "query", name: "all", viewer: "dev:alice", args: {}, now: Date.now() });
  const queue = (await f.core().call({ op: "queued" })).ok;
  t.diagnostic(`reset observed: A=${JSON.stringify(a)}, B=${JSON.stringify(b)}, local=${JSON.stringify(local)}, queue=${JSON.stringify(queue)}, reply=${JSON.stringify(f.pages.at(-1))}`);
  assert.ok(local.ok.denied, "the replaced partition must be unacquired, with no stale or predicted rows");
  assert.equal(b.watermark, 0); assert.equal(queue.length, 1); assert.equal(queue[0].id, pending.id);
  assert.equal(queue[0].predictable, false); assert.deepEqual(queue[0].predicted, []);
  f.offline(true); await client.sync(); await client.close(); client = await f.open();
  assert.deepEqual(await client.query(query, {}), { loading: true });
  f.interrupt(false); f.offline(false); await client.sync();
  await until(async () => (await f.core().call({ op: "queued" })).ok.length === 0, "pending write did not flush");
  await client.sync();
  const current = await client.query(query, {});
  assert.equal(current.fresh, true); assert.equal(current.complete, true);
  assert.deepEqual(current.data.map((row) => row.body).sort(), ["B", "unsent"]);
  assert.equal(f.writes.filter((w) => w.id === pending.id).length, 1);
  const bId = f.pages.at(-1).reply.store_id;
  await client.close(); await f.start(); await f.seed("C", 2);
  client = await f.open();
  const final = await client.query(query, {});
  assert.equal(final.fresh, true); assert.equal(final.complete, true);
  assert.deepEqual(final.data.map((row) => row.body), ["C", "C"]);
  assert.notEqual(f.pages.at(-1).reply.store_id, bId, "equal watermarks must still detect a second reset");
  assert.equal(f.writes.filter((w) => w.id === pending.id).length, 1, "a known sent write is never replayed to C");
  t.diagnostic(`reacquired: B rows=${current.data.length}, C rows=${final.data.length}, pending POSTs=${f.writes.length}, resets=2`);
});

test("sync store identity survives a server restart; a live client detects an equal-watermark replacement", { timeout: 60000 }, async (t) => {
  const f = await fixture(t, true); await f.seed("A", 3);
  let client = await f.open();
  const first = f.pages.at(-1).reply;
  assert.match(first.store_id, /^[0-9a-f]{32}$/);
  await client.close(); await f.start(false); client = await f.open();
  assert.equal(f.pages.at(-1).reply.store_id, first.store_id, "reopening the same database keeps its identity");
  assert.equal((await client.query(query, {})).data.length, 3);
  await f.start(); await f.seed("B", 3);
  await until(async () => {
    const read = await client.query(query, {});
    return read.fresh && read.complete && read.data.length === 3 && read.data.every((row) => row.body === "B");
  }, "a live client must verify store identity on an unchanged heartbeat");
  const second = f.pages.at(-1).reply;
  assert.equal(second.watermark, first.watermark);
  assert.notEqual(second.store_id, first.store_id);
  // The HTTP protocol accepts legacy requests, while a foreign snapshot
  // cursor is ignored only when its accompanying identity proves a reset.
  const legacy = await f.post("/sync", { from: 0, limit: 2 });
  assert.equal(legacy.snapshot, true); assert.equal(legacy.store_id, second.store_id);
  const mismatch = await f.post("/sync", { from: 0, limit: 2, after: "obsolete-cursor", store_id: first.store_id });
  assert.equal(mismatch.snapshot, true); assert.deepEqual(mismatch.events, legacy.events);
  const invalid = await f.post("/sync", { from: 0, after: "obsolete-cursor", store_id: second.store_id });
  assert.equal(invalid.denied.code, "E_INPUT", "ordinary malformed cursors still refuse");
  t.diagnostic(`server: identity length=${second.store_id.length}, restart IDs=1, replacement IDs=2, equal watermark=${second.watermark}`);
});

test("wasm: a known receipt is not replayed to the replacement; an unknown receipt keeps its write ID", { timeout: 60000 }, async (t) => {
  const f = await fixture(t); await f.seed("A", 1);
  let client = await f.open(); f.offline(true); await client.sync();
  const known = await client.mutate(mutation, { body: "known" });
  const unknown = await client.mutate(mutation, { body: "unknown" });
  const queue = (await f.core().call({ op: "queued" })).ok;
  for (const entry of queue) {
    const reply = await f.post("/m/add", { id: entry.id, args: entry.args, newIds: entry.new_ids });
    assert.equal(reply.state, "sent");
    if (entry.id === known.id) await f.core().call({ op: "settle", id: entry.id, seq: reply.seq });
  }
  await client.close(); await f.start(); await f.seed("B", 1); f.offline(false); client = await f.open();
  await until(async () => (await f.core().call({ op: "queued" })).ok.length === 0, "unknown receipt did not settle");
  await client.sync();
  const read = await client.query(query, {});
  assert.deepEqual(read.data.map((row) => row.body).sort(), ["B", "unknown"]);
  assert.equal(f.writes.filter((w) => w.id === known.id).length, 0);
  assert.equal(f.writes.filter((w) => w.id === unknown.id).length, 1);
  const entry = queue.find((entry) => entry.id === unknown.id);
  const replay = await f.post("/m/add", { id: entry.id, args: entry.args, newIds: entry.new_ids });
  assert.equal(replay.replayed, true);
  t.diagnostic("receipts across reset: known POSTs=0, unknown POSTs=1, duplicate replay=true");
});

test("wasm: a replacement reloads backend programs even when the generation number repeats", { timeout: 60000 }, async (t) => {
  const f = await fixture(t); await f.seed("A", 1);
  let client = await f.open();
  assert.equal((await client.query(query, {})).data.length, 1);
  const generation = (await f.core().call({ op: "state" })).ok.generation;
  await f.start(true, source.replace("return notes first 100 by byId", "return 'replacement'"));
  await client.sync();
  await until(async () => (await client.query(query, {})).data === "replacement", "same-number backend programs were not reloaded");
  assert.equal((await f.core().call({ op: "state" })).ok.generation, generation);
});

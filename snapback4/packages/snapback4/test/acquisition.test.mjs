// @ref LLP 3000.008.001#2-three-facts-to-distinguish — a compiled device capability is not an acquired partition.
import nodeTest from "node:test";
import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { once } from "node:events";
import { mkdtempSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { createLocalClient } from "../dist/local.js";
import { processDevice } from "../dist/native.js";
import { memoryPersistence, webDevice } from "../dist/web.js";
import { WriteHistory } from "../dist/writes.js";

const shard = process.env.SNAPBACK4_TEST_SHARD?.split("/").map(Number);
if (shard && (shard.length !== 2 || !Number.isInteger(shard[0]) || !Number.isInteger(shard[1]) || shard[0] < 0 || shard[1] < 1 || shard[0] >= shard[1])) {
  throw Error("SNAPBACK4_TEST_SHARD must be a zero-based part/count pair");
}
let registered = 0;
const test = (...args) => {
  const index = registered++;
  if (!shard || index % shard[1] === shard[0]) return nodeTest(...args);
};

const root = join(dirname(fileURLToPath(import.meta.url)), "../../..");
const binary = process.env.SNAPBACK4_BIN ?? join(root, "target/debug/snapback4");
const wasm = readFileSync(join(root, "packages/snapback4/src/wasm/snapback4_device_bg.wasm"));
const source = `use personas alice
table notes:
  body: text <=100
  public 'acquisition fixture'
  insert <- allow
  sync
query all():
  return notes first 100 by byId
query countAll():
  page = notes first 100 by byId
  return count(page)
query one():
  return notes['seed']
query guarded():
  require exists notes['seed'] else MISSING
  return true
mutation reject():
  require exists notes['missing'] else MISSING
  return true
mutation add(body: text <=100):
  require exists notes['seed'] else MISSING
  return insert notes { body }
`;
const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
async function until(check, message) {
  const end = Date.now() + 15000;
  do { if (await check()) return; await sleep(20); } while (Date.now() < end);
  assert.fail(message);
}
const query = (name) => ({ kind: "query", name });

async function fixture(t, tier, empty = false) {
  const directory = mkdtempSync(join(tmpdir(), "sb4-acquisition-"));
  mkdirSync(join(directory, "snapback"));
  const schemaPath = join(directory, "snapback/schema.q");
  writeFileSync(schemaPath, source);
  t.after(() => rmSync(directory, { recursive: true, force: true }));
  let child, exit, url;
  async function start() {
    if (child) { child.kill("SIGTERM"); await exit; }
    child = spawn(binary, ["dev", "--port", url ? new URL(url).port : "0", "--fresh"], { cwd: directory, stdio: ["ignore", "pipe", "pipe"] });
    exit = once(child, "exit");
    let log = "", listening = false;
    child.stdout.on("data", (data) => { log += data; const address = log.match(/http:\/\/127\.0\.0\.1:\d+/)?.[0]; if (address) { url = address; listening = true; } });
    child.stderr.on("data", (data) => { log += data; });
    await until(() => { assert.equal(child.exitCode, null, log); return listening; }, "server did not listen");
  }
  const clients = [];
  t.after(async () => {
    await Promise.allSettled(clients.map((client) => client.close()));
    if (child.exitCode == null && child.signalCode == null) child.kill("SIGTERM");
    await exit;
  });
  await start();
  const headers = { "x-snapback-persona": "alice" };
  const post = (path, body) => fetch(`${url}${path}`, { method: "POST", headers, body: JSON.stringify(body) }).then((r) => r.json());
  const backend = () => fetch(`${url}/schema`, { headers }).then((r) => r.json());
  if (!empty) assert.equal((await post("/seed", Array.from({ length: 6 }, (_, n) => ({ table: "notes", row: { id: n ? `row-${n}` : "seed", body: `note ${n}` } })))).seeded, 6);
  const deviceDir = join(directory, "device"); mkdirSync(deviceDir);
  const persist = memoryPersistence();
  let core, mode = "sync-fails", snapshots = 0, catchups = 0, posts = 0, restore = false;
  const metadata = new Map();
  const open = async () => {
    const opener = tier === "wasm" ? webDevice({ wasm, persist }) : processDevice({ binary, dir: deviceDir,
      spawn: (cmd, args) => spawn(cmd, args, { stdio: ["pipe", "pipe", "inherit"] }),
      writeFile: async (path, text) => writeFileSync(path, text) });
    const client = await createLocalClient({ url, persona: "alice", waitSeconds: 1,
      device: { open: async (...args) => {
        core = await opener.open(...args);
        const call = core.call.bind(core);
        core.call = async request => {
          const reply = await call(request);
          if (request.op === "set_meta" && !reply.denied && reply.ok !== false) metadata.set(request.key, request.value);
          if (request.op === "keep_write" && !reply.denied) metadata.set("write-history", (await call({ op: "meta", key: "write-history" })).ok);
          return reply;
        };
        return core;
      } },
      fetch: async (input, init) => {
        const path = new URL(input).pathname;
        if (mode === "offline") throw new TypeError("offline reopen");
        if (mode === "before-catchup" && (path === "/probe" || path === "/changes" || path.startsWith("/q/"))) throw new TypeError("offline before catch-up");
        if (restore && path === "/probe") {
          const response = await fetch(input, init), json = await response.json();
          return Response.json({ ...json, seq: 0 });
        }
        if ((mode === "busy" && (path === "/sync" || path.startsWith("/m/"))) || (mode === "sent-queued" && path === "/sync")) return Response.json({ denied: {
          code: "E_RATE_LIMIT", family: "bound", message: "server is busy", retryable: true,
        } }, { status: 429 });
        if (path === "/schema" && mode === "after-adopt") {
          const response = await fetch(input, init); mode = "sync-fails"; return response;
        }
        if (path === "/sync") {
          const body = JSON.parse(init.body);
          if (mode === "sync-fails" || (mode === "after-page" && snapshots > 0) || (mode === "before-catchup" && body.stream)) throw new TypeError("interrupted acquisition");
          const response = await fetch(input, { ...init, body: JSON.stringify({ ...body, limit: 2 }) });
          const page = await response.clone().json();
          if (page.snapshot) snapshots++;
          if (body.stream) catchups++;
          if (restore) return Response.json({ ...page, watermark: 0 });
          return response;
        }
        if (path.startsWith("/m/")) posts++;
        return fetch(input, init);
      },
    });
    clients.push(client); return client;
  };
  return { open, backend, schemaPath, start, metadata, persist, restore: () => { restore = true; }, core: () => core, mode: (next) => { mode = next; }, counts: () => ({ snapshots, catchups, posts }) };
}

test("W5R1x: terminal history is bounded independently of unresolved writes", async t => {
  const history = new WriteHistory();
  for (let n = 0; n < 300; n++) history.remember({ state: "pending", id: `pending-${n}` });
  for (let n = 0; n < 600; n++) history.remember({ state: "sent", id: `sent-${n}`, seq: n, replayed: true });
  assert.equal(await history.read("sent-0"), undefined);
  assert.equal((await history.read("sent-599")).state, "sent");
  for (let n = 0; n < 300; n++) assert.equal((await history.read(`pending-${n}`)).state, "pending");
  assert.equal(history.values.size, 556, "256 terminal + 300 unresolved entries");
  for (let n = 0; n < 600; n++) assert.equal(history.firstEmission(`sent-${n}`), true);
  assert.equal(history.firstEmission("sent-599"), false);
  assert.equal(history.emitted.size, 256);
  t.diagnostic(`terminal=256 unresolved=300 memory=${history.values.size} evicted=344`);
});

for (const tier of ["wasm", "process"]) {
  test(`W5R1x ${tier}: durable receipts evict beyond 256 without growing metadata`, { timeout: 60000 }, async t => {
    const f = await fixture(t, tier);
    f.mode("online"); let client = await f.open();
    const ids = [], events = [];
    client.onWrite(write => events.push(write.id));
    for (let n = 0; n < 270; n++) {
      const write = await client.mutate({ kind: "mutation", name: "add" }, { body: `receipt ${n}` });
      assert.equal(write.state, "sent"); ids.push(write.id);
    }
    assert.equal(events.length, 270);
    assert.equal(new Set(events).size, 270);
    assert.equal(await client.write(ids[0]), undefined);
    assert.equal((await client.write(ids.at(-1))).state, "sent");
    const receipts = [...f.metadata].filter(([key]) => key.startsWith("write"));
    assert.equal(receipts.length, 1, "one bounded receipt record, not one row per mutation");
    assert.equal(JSON.parse(receipts[0][1]).length, 256);
    await client.close(); f.mode("offline"); client = await f.open();
    assert.equal(await client.write(ids[0]), undefined);
    assert.equal((await client.write(ids.at(-1))).state, "sent");
    const pending = await client.mutate({ kind: "mutation", name: "add" }, { body: "still unresolved" });
    // Other receipt settlements cannot retire this executable outbox entry.
    for (let n = 0; n < 270; n++) {
      assert.equal((await f.core().call({ op: "keep_write", value: JSON.stringify({ state: "sent", id: `other-${n}`, seq: n, replayed: true }) })).denied, undefined);
    }
    assert.equal((await client.write(pending.id)).state, "pending");
    await client.close(); client = await f.open();
    assert.equal((await client.write(pending.id)).state, "pending");
    assert.equal((await f.core().call({ op: "queued" })).ok.length, 1);
    assert.equal(JSON.parse((await f.core().call({ op: "meta", key: "write-history" })).ok).length, 256);
    t.diagnostic(`writes=270 terminal=256 evicted=14 receipt_rows=${receipts.length} receipt_bytes=${Buffer.byteLength(receipts[0][1])} unresolved=1`);
  });

  test(`W5R1x ${tier}: opener returns an offline unacquired client on network loss`, { timeout: 30000 }, async t => {
    const f = await fixture(t, tier);
    let client = await f.open(); await client.close();
    f.mode("busy"); client = await f.open();
    assert.equal(client.link(), "online"); assert.equal(client.acquired, false);
    f.mode("sync-fails");
    // The native starter's close-and-throw pattern closes only exceptions.
    const opened = await (async () => {
      try { if (client.link() === "online") await client.sync(); return client; }
      catch (error) { await client.close(); throw error; }
    })();
    assert.equal(opened, client); assert.equal(client.acquired, false); assert.equal(client.link(), "offline");
    assert.equal((await client.mutate({ kind: "mutation", name: "add" }, { body: "opens offline" })).state, "pending");
    f.mode("online"); await client.sync(); assert.equal(client.acquired, true);
  });

  test(`W5R1x ${tier}: replacement stays unacquired until the new catch-up completes`, { timeout: 30000 }, async t => {
    const f = await fixture(t, tier); f.mode("online");
    const client = await f.open(), changes = [];
    assert.equal(client.acquired, true); client.onAcquired(value => changes.push(value));
    const before = (await f.core().call({ op: "sync_state" })).ok.store_id;
    f.mode("offline"); await client.sync(); await f.start();
    f.mode("before-catchup"); await client.sync();
    const state = (await f.core().call({ op: "sync_state" })).ok;
    assert.notEqual(state.store_id, before); assert.equal(client.acquired, false);
    assert.deepEqual(changes, [false]);
    f.mode("online"); await client.sync();
    assert.equal(client.acquired, true); assert.deepEqual(changes, [false, true]);
    assert.deepEqual((await client.query(query("all"), {})).data, []);
  });

  test(`W5R1x ${tier}: a restore halt keeps acquisition false across retries and reopen`, { timeout: 30000 }, async t => {
    const f = await fixture(t, tier); f.mode("online");
    let client = await f.open(); assert.equal(client.acquired, true);
    f.mode("offline"); await client.sync(); f.restore(); f.mode("online");
    await until(async () => { await client.sync(); return !client.acquired; }, "restore was not observed");
    assert.equal((await client.query(query("all"), {})).denied?.code, "E_STORE_RESTORE");
    await client.sync(); assert.equal(client.acquired, false);
    await client.close(); f.mode("offline"); client = await f.open();
    assert.equal(client.acquired, false);
    assert.equal((await client.query(query("all"), {})).denied?.code, "E_STORE_RESTORE");
  });
}

async function observations(client, t) {
  const answers = {};
  for (const name of ["all", "countAll", "one", "guarded"]) answers[name] = await client.query(query(name), {});
  t.diagnostic(`unacquired answers: ${JSON.stringify(answers)}`);
  return answers;
}
function assertUnknown(answers) {
  for (const [name, answer] of Object.entries(answers)) {
    assert.deepEqual(answer, { loading: true }, `${name}: no fabricated absence or authoritative refusal`);
    assert.equal("data" in answer, false);
  }
}
async function unknown(client, t) { assert.equal(client.acquired, false); assertUnknown(await observations(client, t)); }

for (const tier of ["wasm", "process"]) {
  test(`${tier}: schema alone is not acquisition; queued guarded writes survive offline reopen`, { timeout: 30000 }, async (t) => {
    const f = await fixture(t, tier);
    let client = await f.open();
    const first = await observations(client, t);
    const pending = await client.mutate({ kind: "mutation", name: "add" }, { body: "queued before acquisition" });
    const held = (await f.core().call({ op: "queued" })).ok;
    t.diagnostic(`before acquisition write: ${JSON.stringify(pending)}; durable queue: ${JSON.stringify(held)}`);
    await client.close(); f.mode("offline");
    client = await f.open();
    const reopened = await observations(client, t);
    assertUnknown(first); assertUnknown(reopened);
    assert.equal(pending.state, "pending");
    assert.equal(held.length, 1); assert.equal(held[0].id, pending.id);
    assert.equal(held[0].predictable, false); assert.deepEqual(held[0].predicted, []);
    assert.equal((await f.core().call({ op: "queued" })).ok[0].id, pending.id);
    const terminal = []; client.onWrite((write) => terminal.push(write));
    f.mode("online"); await client.sync();
    await until(() => terminal.some((write) => write.id === pending.id), "guarded write did not settle");
    assert.equal(terminal.find((write) => write.id === pending.id).state, "sent");
    await client.sync();
    const rows = await client.query(query("all"), {});
    assert.equal(rows.complete, true); assert.equal(rows.data.length, 7);
    assert.equal(rows.data.filter((row) => row.body === "queued before acquisition").length, 1);
    assert.equal(f.counts().posts, 1, "one stable write was submitted");
  });

  test(`${tier}: snapshot and catch-up publish readiness together; later failures preserve acquired rows`, { timeout: 30000 }, async (t) => {
    const f = await fixture(t, tier);
    f.mode("after-page"); let client = await f.open();
    assert.equal(f.counts().snapshots, 1); await unknown(client, t);
    await client.close(); f.mode("offline"); client = await f.open(); await unknown(client, t);
    await client.close(); f.mode("before-catchup"); client = await f.open();
    assert.ok(f.counts().snapshots > 1); assert.equal(f.counts().catchups, 0);
    await unknown(client, t);
    f.mode("online"); await client.sync();
    assert.equal(client.acquired, true);
    const full = await client.query(query("all"), {});
    assert.equal(full.complete, true); assert.equal(full.data.length, 6); assert.ok(f.counts().catchups > 0);
    f.mode("offline"); await client.sync(); await client.close(); client = await f.open();
    const stale = await client.query(query("all"), {});
    assert.equal(stale.complete, true); assert.equal(stale.fresh, false); assert.deepEqual(stale.data, full.data);
    const queued = await client.mutate({ kind: "mutation", name: "add" }, { body: "acquired prediction" });
    assert.equal(queued.state, "pending");
    assert.equal((await f.core().call({ op: "queued" })).ok[0].predictable, true);
    // A schema fetch alone cannot adopt a generation before sync preflight.
    // Keep the complete old partition until a validated reply permits evolution.
    const old = await f.backend();
    const evolved = source.replace("  body: text <=100", "  body: text <=100\n  tag: text <=20 default 'new'");
    writeFileSync(f.schemaPath, evolved);
    await until(async () => (await f.backend()).generation !== old.generation, "server did not adopt the new generation");
    await client.close(); f.mode("sync-fails"); client = await f.open();
    assert.equal(client.acquired, true, "failed preflight preserves the acquired old generation");
    const inherited = await client.query(query("all"), {});
    assert.equal(inherited.complete, true); assert.equal(inherited.fresh, false); assert.equal(inherited.data.length, 7);
    assert.equal((await f.core().call({ op: "state" })).ok.generation, old.generation);
    assert.ok(inherited.data.every((row) => !Object.hasOwn(row, "tag")), "unvalidated defaults cannot appear in the retained generation");
    assert.equal((await f.core().call({ op: "queued" })).ok[0].id, queued.id);
    f.mode("online"); await client.sync();
    await until(async () => (await f.core().call({ op: "queued" })).ok.length === 0, "old queued write did not settle after adoption");
    const current = await client.query(query("all"), {});
    assert.equal(current.complete, true); assert.equal(current.data.length, 7);
    assert.ok(current.data.every((row) => row.tag === "new"));
    // A changed horizon resets the partition. Exercise the live adopt path,
    // interrupt its acquisition, then reopen the reset generation offline.
    const acquired = await f.backend();
    f.mode("offline");
    writeFileSync(f.schemaPath, evolved.replace("  sync\n", "  sync last 100 by byId\n"));
    await until(async () => (await f.backend()).generation !== acquired.generation, "server did not change the horizon");
    f.mode("after-adopt"); await client.sync(); await unknown(client, t);
    await client.close(); f.mode("offline"); client = await f.open(); await unknown(client, t);
    f.mode("online"); await client.sync();
    assert.equal(client.acquired, true);
    const reacquired = await client.query(query("all"), {});
    assert.equal(reacquired.complete, true); assert.equal(reacquired.data.length, 7);
  });

  test(`${tier}: a genuinely empty partition at sequence zero is acquired durably`, { timeout: 20000 }, async (t) => {
    const f = await fixture(t, tier, true);
    f.mode("online"); let client = await f.open();
    assert.equal(client.acquired, true, "an empty partition is acquired too");
    assert.equal((await f.core().call({ op: "state" })).ok.watermark, 0);
    f.mode("offline"); await client.sync(); await client.close(); client = await f.open();
    const page = await client.query(query("all"), {}), count = await client.query(query("countAll"), {});
    assert.deepEqual(page.data, []); assert.equal(page.complete, true); assert.equal(page.fresh, false);
    assert.equal(count.data, 0); assert.equal(count.complete, true);
    assert.equal((await client.query(query("guarded"), {})).denied?.code, "MISSING", "acquired absence may justify the program's refusal");
  });
}

for (const tier of ["wasm", "process"]) {
  test(`W5c ${tier}: online reopen reports acquisition and a missing-row reason, then predicts`, { timeout: 30000 }, async (t) => {
    const f = await fixture(t, tier);
    let client = await f.open();
    await client.close();
    // Schema and server reads succeed while acquisition and writes wait online.
    f.mode("busy"); client = await f.open();
    assert.equal(client.link(), "online");
    assert.equal(client.acquired, false);
    assert.equal((await client.query(query("all"), {})).data.length, 6);
    const changes = []; client.onAcquired(value => changes.push(value));
    const pending = await client.mutate({ kind: "mutation", name: "add" }, { body: "before acquisition" });
    assert.equal(pending.state, "pending");
    assert.equal(pending.reason, "queued without a row: not acquired yet");
    assert.equal(client.link(), "online", "pending does not imply a lost link");
    assert.deepEqual((await f.core().call({ op: "queued" })).ok[0].predicted, []);
    f.mode("online"); await client.sync();
    assert.equal(client.acquired, true);
    assert.deepEqual(changes, [true]);
    await until(async () => (await client.write(pending.id))?.state === "sent", "queued write did not settle");
    f.mode("offline"); await client.sync();
    const predicted = await client.mutate({ kind: "mutation", name: "add" }, { body: "after acquisition" });
    assert.equal(predicted.state, "pending");
    assert.equal(predicted.reason, undefined);
    const rows = await client.query(query("all"), {});
    assert.equal(rows.data.filter(row => row.body === "after acquisition" && row.pending).length, 1);
    await client.close(); client = await f.open();
    assert.equal(client.acquired, true, "offline reopen keeps durable acquisition");
    assert.equal((await client.write(predicted.id)).state, "pending");
    t.diagnostic(`acquisition changes: ${JSON.stringify(changes)}; before: 0 predicted rows; after: 1 predicted row`);
  });

  test(`W5c ${tier}: pending writes recover by id through sent and failed, including settlement before reopen returns`, { timeout: 30000 }, async (t) => {
    const f = await fixture(t, tier);
    // Hold delivery while arranging pending writes: a failed sync alone does
    // not prevent a successful mutation response from settling them first.
    f.mode("busy");
    let client = await f.open();
    // Keep the pending phase offline, including close: failed sync alone does
    // not prevent a retry timer from reaching the mutation endpoint.
    f.mode("offline");
    const sent = await client.mutate({ kind: "mutation", name: "add" }, { body: "recover me" });
    const failed = await client.mutate({ kind: "mutation", name: "reject" }, {});
    assert.equal(sent.state, "pending"); assert.equal(failed.state, "pending");
    assert.equal((await client.write(sent.id)).state, "pending");
    assert.equal((await client.write(failed.id)).state, "pending");
    await client.close(); f.mode("offline"); client = await f.open();
    assert.equal((await client.write(sent.id)).state, "pending");
    assert.equal((await client.write(failed.id)).state, "pending");
    const terminal = []; client.onWrite(write => terminal.push(write));
    f.mode("online"); await client.sync();
    await until(() => terminal.length === 2, "both terminal outcomes did not arrive");
    assert.equal((await client.write(sent.id)).state, "sent");
    assert.equal((await client.write(failed.id)).why.code, "MISSING");
    await client.close(); client = await f.open();
    const recovered = await client.write(sent.id);
    assert.equal(recovered.state, "sent"); assert.equal(recovered.replayed, true);
    assert.equal("result" in recovered, false, "reopen carries identity only");
    assert.equal((await client.write(failed.id)).state, "failed");
    assert.equal((await client.write(failed.id)).why.code, "MISSING");
    assert.equal(await client.write("unknown-id"), undefined, "unknown is never a fabricated pending receipt");
    t.diagnostic(`recovered outcomes: sent=1 failed=1; server sends=${f.counts().posts}`);
  });
}


const sentReceipt = (id, seq = 1) => ({ state: "sent", id, seq, replayed: true });

for (const state of ["sent", "failed"]) test(`receipt custody retains the first ${state} outcome across repeated save failures`, async () => {
  let failures = 2, saved;
  const history = new WriteHistory({
    read: async () => saved ? JSON.stringify([saved]) : null,
    save: async value => { if (failures-- > 0) throw Error("aborted receipt"); saved = JSON.parse(value); },
  });
  const original = state === "sent" ? sentReceipt("original", 7)
    : { state: "failed", id: "original", why: { code: "NOT_ADMIN", family: "auth", message: "not admin" } };
  const replacement = { state: "failed", id: "original", why: { code: "E_STORE_REPLACED", family: "store", message: "replacement" } };
  await assert.rejects(history.keep(original), /aborted receipt/);
  await assert.rejects(history.keep(replacement), /aborted receipt/);
  assert.equal(history.hasUnpersisted(original.id), true);
  await history.persistPending();
  assert.equal(history.hasUnpersisted(original.id), false);
  const kept = await history.read(original.id);
  assert.equal(kept.state, state);
  if (state === "sent") assert.equal(kept.seq, 7); else assert.equal(kept.why.code, "NOT_ADMIN");
});

const ok = reply => { assert.equal(reply.denied, undefined, JSON.stringify(reply)); return reply.ok; };

test('acknowledgement drops an unsaved replacement refusal before any persistence retry', async () => {
  let abort = true, saved;
  const attempts = [];
  const history = new WriteHistory({
    read: async () => saved ? JSON.stringify([saved]) : null,
    save: async value => { attempts.push(JSON.parse(value)); if (abort) throw Error('receipt aborted'); saved = JSON.parse(value); },
  });
  await assert.rejects(history.keep({ state: 'failed', id: 'acknowledged', why: { code: 'E_STORE_REPLACED', family: 'store', message: 'unknown' } }));
  abort = false;
  const sent = await history.acknowledged('acknowledged', 7);
  await history.keep(sent);
  assert.deepEqual(attempts.map(write => write.state), ['failed', 'sent']);
  assert.equal((await history.read('acknowledged')).seq, 7);
});

const keepReceipt = (core, receipt) => core.call({ op: "keep_write", value: JSON.stringify(receipt) }).then(ok);

test('a legacy acknowledgement returns a known authored refusal without saving success', async () => {
  const refused = { state: 'failed', id: 'refused', why: { code: 'NOT_ADMIN', family: 'rule', message: 'not admin' } };
  const saves = [];
  const history = new WriteHistory({ read: async () => JSON.stringify([refused]), save: async value => { saves.push(value); } });
  assert.deepEqual(await history.acknowledged(refused.id, 7), refused);
  assert.deepEqual(await history.read(refused.id), refused);
  assert.deepEqual(saves, []);
});

function receiptLocks(t) {
  const previous = Object.getOwnPropertyDescriptor(globalThis, "navigator"), held = new Set();
  Object.defineProperty(globalThis, "navigator", { configurable: true, value: { locks: { async request(name, options, body) {
    if (held.has(name)) return body(null);
    held.add(name);
    try { return await body({ name }); } finally { held.delete(name); }
  } } } });
  t.after(() => previous ? Object.defineProperty(globalThis, "navigator", previous) : delete globalThis.navigator);
}

test("W5R2a: two native owners recover 600 completions without stale pending memory", { timeout: 60000 }, async t => {
  const f = await fixture(t, "process"), client = await f.open(), a = f.core();
  await f.open(); const b = f.core(); f.mode("offline");
  const history = new WriteHistory({
    read: async () => ok(await a.call({ op: "meta", key: "write-history" })),
    save: value => a.call({ op: "keep_write", value }).then(ok),
  });
  const ids = [];
  for (let n = 0; n < 600; n++) {
    const pending = await client.mutate({ kind: "mutation", name: "add" }, { body: `owner A ${n}` });
    assert.equal(pending.state, "pending"); ids.push(pending.id); history.remember(pending);
    assert.equal((await client.write(pending.id)).state, "pending");
    await keepReceipt(b, sentReceipt(pending.id, n + 1));
    ok(await b.call({ op: "settle", id: pending.id, seq: n + 1 }));
    ok(await b.call({ op: "dequeue", id: pending.id }));
    assert.equal((await history.read(pending.id)).state, "sent");
    assert.equal((await client.write(pending.id)).state, "sent");
  }
  const cachedPending = [...history.values.values()].filter(write => write.state === "pending").length;
  const durable = JSON.parse(ok(await a.call({ op: "meta", key: "write-history" })));
  t.diagnostic(`observed=600 durable=${durable.length} cached_pending=${cachedPending} memory=${history.values.size} outbox=${ok(await a.call({ op: "queued" })).length}`);
  assert.equal(cachedPending, 0);
  assert.ok(history.values.size <= 256);
  assert.equal(await client.write(ids[0]), undefined, "an evicted completion cannot revert to pending");
  assert.equal(await history.read(ids[0]), undefined);
  for (const id of ids.slice(-256)) assert.equal((await client.write(id)).state, "sent");
});

for (const tier of ["wasm", "process"]) test(`W5R2a ${tier}: a sent queued id emits once beyond 256 other emissions`, { timeout: 60000 }, async t => {
  const f = await fixture(t, tier); f.mode("online");
  const client = await f.open(), events = [];
  client.onWrite(write => events.push(write)); f.mode("sent-queued");
  const first = await client.mutate({ kind: "mutation", name: "add" }, { body: "sent but not caught up" });
  assert.equal(first.state, "sent");
  assert.equal(ok(await f.core().call({ op: "queued" }))[0].sent_seq, first.seq);
  // Acquired local refusals are terminal emissions too, with no outbox row.
  for (let n = 0; n < 256; n++) assert.equal((await client.mutate({ kind: "mutation", name: "reject" }, {})).state, "failed");
  // Evict A from the receipt window as well: its outbox row must pin emission.
  for (let n = 0; n < 256; n++) await keepReceipt(f.core(), sentReceipt(`other-${n}`, n + 1));
  assert.equal((await client.write(first.id)).state, "sent", "the queued terminal still owns its outcome");
  const next = await client.mutate({ kind: "mutation", name: "add" }, { body: "trigger the next flush" });
  assert.equal(next.state, "sent");
  const count = events.filter(write => write.id === first.id).length;
  t.diagnostic(`other_emissions=256 first_id_emissions=${count} queued=${ok(await f.core().call({ op: "queued" })).length}`);
  assert.equal(count, 1);
  assert.equal(events.filter(write => write.id === next.id).length, 1);
  f.mode("online"); await client.sync();
  assert.equal(ok(await f.core().call({ op: "queued" })).length, 0);
  assert.equal(await client.write(first.id), undefined, "flushing a sent entry cannot refresh an evicted receipt");
  assert.equal((await client.write(next.id)).state, "sent");
});

test("W5 confirmation N3: another owner's durable receipt still notifies this client once", { timeout: 60000 }, async t => {
  const f = await fixture(t, "process"), client = await f.open(), a = f.core();
  await f.open(); const b = f.core(); f.mode("offline");
  const events = []; client.onWrite(write => events.push(write));
  const pending = await client.mutate({ kind: "mutation", name: "add" }, { body: "settled by the other owner" });
  assert.equal(pending.state, "pending");
  await keepReceipt(b, sentReceipt(pending.id, 1));
  ok(await b.call({ op: "settle", id: pending.id, seq: 1 }));
  assert.equal(ok(await a.call({ op: "queued" }))[0].sent_seq, 1, "the shared entry stays queued until catch-up");
  f.mode("sent-queued");
  // Only /sync is refused, so catch-up leaves the shared entry queued while flushes run.
  await client.mutate({ kind: "mutation", name: "add" }, { body: "first flush" });
  for (let n = 0; n < 60 && !events.some(write => write.id === pending.id); n++) await new Promise(r => setTimeout(r, 50));
  await client.mutate({ kind: "mutation", name: "add" }, { body: "second flush" });
  await new Promise(r => setTimeout(r, 200));
  const count = events.filter(write => write.id === pending.id).length;
  t.diagnostic(`first_completion_emissions=${count}`);
  assert.equal(count, 1, "usePendingWrite depends on exactly one onWrite for the completion");
  assert.equal((await client.write(pending.id)).state, "sent");
});

for (const size of [256, 128]) test(`W5R2a web: adopting 256 orphan receipts preserves ${size} destination receipts`, { timeout: 30000 }, async t => {
  receiptLocks(t);
  const f = await fixture(t, "wasm"); f.mode("online");
  const client = await f.open(), destination = f.core();
  const own = Array.from({ length: size }, (_, n) => sentReceipt(`A${n}`, n + 1));
  for (const receipt of own) await keepReceipt(destination, receipt);
  const orphanClient = await f.open(), orphan = f.core();
  const incoming = Array.from({ length: 255 }, (_, n) => sentReceipt(`B${n}`, n + 1));
  incoming.push(sentReceipt("A0", 9999)); // Destination wins an id collision too.
  for (const receipt of incoming) await keepReceipt(orphan, receipt);
  await orphanClient.close(); await client.sync();
  const kept = JSON.parse(ok(await destination.call({ op: "meta", key: "write-history" })));
  const surviving = kept.filter(receipt => receipt.id.startsWith("A")).length;
  const stores = [...f.persist.stores.entries()];
  const shared = stores.find(([name]) => name.endsWith(":receipts"))[1];
  const local = stores.find(([name]) => name.startsWith("snapback4-") && !name.includes(":") && name !== "snapback4-wasm")[1];
  const stored = store => JSON.parse([...store.values()].find(c => c.k === "client:write-history").v);
  t.diagnostic(`destination=${size} orphan=256 surviving_destination=${surviving} shared=${stored(shared).length} view=${kept.length}`);
  assert.equal(surviving, size);
  for (const receipt of own) assert.deepEqual(await client.write(receipt.id), receipt);
  assert.deepEqual(stored(local), own, "adoption never copies receipts into the destination window");
  assert.deepEqual(stored(shared), incoming);
  assert.equal(kept.length, size + 255, "a read combines two bounded windows, with local ids winning collisions");
  assert.deepEqual(kept, [...incoming.slice(0, -1), ...own]);
  assert.equal([...f.persist.stores.keys()].filter(name => name.includes(":tab-")).length, 0);
  f.mode("offline"); await client.close();
  const reopened = await f.open();
  for (const receipt of own) assert.deepEqual(await reopened.write(receipt.id), receipt);
});

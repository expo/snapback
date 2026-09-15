// Review round 2: production polls and paging through real backend restarts.
import test from "node:test";
import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { once } from "node:events";
import { cpSync, mkdtempSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { createLocalClient } from "../dist/local.js";
import { webDevice, memoryPersistence } from "../dist/web.js";
import { processDevice } from "../dist/native.js";

const root = join(dirname(fileURLToPath(import.meta.url)), "../../..");
const binary = process.env.SNAPBACK4_BIN ?? join(root, "target/debug/snapback4");
const wasm = readFileSync(join(root, "packages/snapback4/dist/wasm/snapback4_device_bg.wasm"));
const source = `use personas alice
table notes:
  body: text <=100
  public 'reconnect fixture'
  insert <- allow
  sync
query all():
  return notes first 100 by byId
`;
const op = { kind: "query", name: "all" }, headers = { "x-snapback-persona": "alice" };
const sleep = ms => new Promise(r => setTimeout(r, ms));
const gate = () => { let resolve; const promise = new Promise(r => { resolve = r; }); return { promise, resolve }; };
async function until(check, message, ms = 15000) {
  const end = Date.now() + ms;
  do { if (await check()) return; await sleep(10); } while (Date.now() < end);
  assert.fail(message);
}
const oldFresh = read => read.fresh && read.complete && Array.isArray(read.data) && read.data.some(row => row.body === "A");
const current = read => read.fresh && read.complete && read.data?.length === 3 && read.data.every(row => row.body === "B");

async function fixture(t, kind = "wasm", waitSeconds = 25, watch = false) {
  const dir = mkdtempSync(join(tmpdir(), "sb4-reconnect-"));
  mkdirSync(join(dir, "snapback")); writeFileSync(join(dir, "snapback/schema.q"), source);
  let child, exit, url, core, blocked = false, holdAfter, nextAfter, lowerNotice = false;
  const clients = [], pages = [], polls = [], notices = [], persist = memoryPersistence();
  async function stop() {
    if (child && child.exitCode == null && child.signalCode == null) child.kill("SIGTERM");
    if (exit) await exit;
  }
  async function start(fresh = true) {
    await stop();
    child = spawn(binary, ["dev", ...(watch ? [] : ["--no-watch"]), "--port", url ? new URL(url).port : "0", ...(fresh ? ["--fresh"] : [])], { cwd: dir, stdio: ["ignore", "pipe", "pipe"] });
    exit = once(child, "exit"); let log = "", listening = false;
    child.stdout.on("data", data => { log += data; const address = log.match(/http:\/\/127\.0\.0\.1:\d+/)?.[0]; if (address) { url = address; listening = true; } });
    child.stderr.on("data", data => { log += data; });
    await until(() => { assert.equal(child.exitCode, null, log); return listening; }, "server did not start");
  }
  const post = (path, body) => fetch(`${url}${path}`, { method: "POST", headers, body: JSON.stringify(body) }).then(r => r.json());
  async function seed(prefix, count) {
    for (let i = 0; i < count; i++) assert.equal((await post("/seed", [{ table: "notes", row: { id: `${prefix}-${i}`, body: prefix } }])).seeded, 1);
  }
  async function open(freshDevice = false) {
    const opener = kind === "process" ? processDevice({ dir: join(dir, freshDevice ? "fresh-device" : "device"), binary }) : webDevice({ wasm, persist: freshDevice ? memoryPersistence() : persist });
    const client = await createLocalClient({ url, persona: "alice", waitSeconds,
      device: { async open(...args) { core = await opener.open(...args); return core; } },
      fetch: async (input, init) => {
        if (blocked) throw new TypeError("transport disconnected");
        const parsed = new URL(input);
        if (parsed.pathname === "/changes") {
          polls.push(parsed);
          if (!watch && !lowerNotice) return fetch(input, init);
          const response = await fetch(input, init), json = await response.json();
          if (lowerNotice) { lowerNotice = false; json.seq = 0; }
          notices.push(json);
          return new Response(JSON.stringify(json), { status: response.status, headers: response.headers });
        }
        if (parsed.pathname === "/sync") {
          const body = JSON.parse(init.body);
          if (body.after && holdAfter) { const wait = holdAfter; holdAfter = null; nextAfter.resolve(body); await wait.promise; }
          const response = await fetch(input, { ...init, body: JSON.stringify({ ...body, limit: 2 }) });
          pages.push({ request: body, reply: await response.clone().json() }); return response;
        }
        return fetch(input, init);
      },
    });
    clients.push(client); return client;
  }
  t.after(async () => { holdAfter?.resolve(); for (const client of clients) await client.close(); await stop(); rmSync(dir, { recursive: true, force: true }); });
  await start(false);
  return { dir, start, stop, seed, open, post, pages, polls, notices, lowerNotice() { lowerNotice = true; }, get url() { return url; }, get core() { return core; },
    block(value) { blocked = value; }, holdPage() { holdAfter = gate(); nextAfter = gate(); return { release: holdAfter.resolve, entered: nextAfter.promise }; },
  };
}

test("R2 item 1: changes with a foreign identity returns before its production wait", { timeout: 30000 }, async t => {
  const f = await fixture(t); await f.seed("A", 3);
  const a = await f.post("/sync", { from: 0 });
  await f.start(); await f.seed("B", 3);
  const started = performance.now();
  const response = await fetch(`${f.url}/changes?since=${a.watermark}&wait=25&store_id=${a.store_id}`, { headers, signal: AbortSignal.timeout(3000) });
  const b = await response.json();
  t.diagnostic(`foreign identity wait=25: ${Math.round(performance.now() - started)} ms`);
  assert.notEqual(b.store_id, a.store_id); assert.equal(b.seq, a.watermark);
  // A matching identity still holds the poll until a commit, without sync.
  let finished = false;
  const poll = fetch(`${f.url}/changes?since=${b.seq}&wait=20&store_id=${b.store_id}`, { headers, signal: AbortSignal.timeout(3000) }).then(r => r.json()).then(json => { finished = true; return json; });
  await sleep(100); assert.equal(finished, false);
  await f.seed("extra", 1); assert.equal((await poll).seq, b.seq + 1);
});

for (const [kind, wait] of [["wasm", 25], ["process", 20]]) test(`R2 item 1/4: ${kind} reconnect at equal head never republishes A as fresh (wait=${wait})`, { timeout: 45000 }, async t => {
  const f = await fixture(t, kind, wait); await f.seed("A", 3);
  const client = await f.open(), watch = client.observe(op, {});
  await until(() => oldFresh(watch.getSnapshot()), "A never acquired");
  await until(() => f.polls.length > 0, "poll never started");
  const a = f.pages.at(-1).reply;
  const beforeRestart = f.pages.length;
  f.block(true); await f.stop();
  await until(() => client.link() === "offline", "same-store disconnect not observed");
  await f.start(false); f.block(false);
  await until(() => client.link() === "online" && oldFresh(watch.getSnapshot()), "same-store reconnect did not restore freshness");
  assert.equal(f.pages.length, beforeRestart, "a matching identity reconnect must not sync");
  t.diagnostic(`${kind}: same-store restart syncs=${f.pages.length - beforeRestart}`);
  f.block(true); await f.stop();
  await until(() => client.link() === "offline", "disconnect not observed");
  await f.start(); await f.seed("B", 3);
  const notices = [], unsubscribe = watch.subscribe(() => notices.push(watch.getSnapshot()));
  const offLink = client.onLink(() => notices.push(watch.getSnapshot()));
  t.after(() => { unsubscribe(); offLink(); });
  const started = performance.now(); f.block(false);
  await until(async () => {
    const read = await client.query(op, {}); notices.push(read, watch.getSnapshot());
    assert.ok(!notices.some(oldFresh), "A was published fresh and complete after B was listening");
    return current(read) && current(watch.getSnapshot());
  }, "B did not converge before the production poll deadline", 10000);
  // Server fallback may answer B before its paged device acquisition ends.
  // Count idle sync only after the client resumes B's long poll.
  await until(() => f.polls.at(-1).searchParams.get("store_id") && f.polls.at(-1).searchParams.get("store_id") !== a.store_id, "B's acquisition never reached the next poll");
  const b = f.pages.at(-1).reply;
  assert.equal(a.watermark, b.watermark); assert.notEqual(a.store_id, b.store_id);
  const syncs = f.pages.length;
  await sleep(150); assert.equal(f.pages.length, syncs, "matching store heartbeat must not reacquire");
  t.diagnostic(`${kind}: wait=${wait}, replacement=${Math.round(performance.now() - started)} ms, stale fresh snapshots=${notices.filter(oldFresh).length}, idle syncs=${f.pages.length - syncs}`);
});

for (const kind of ["wasm", "process"]) test(`R2 item 4: ${kind} replacement while a snapshot after request is in flight`, { timeout: 45000 }, async t => {
  const f = await fixture(t, kind); await f.seed("A", 5);
  const barrier = f.holdPage(), opening = f.open();
  const request = await barrier.entered;
  assert.ok(request.after); assert.ok(request.store_id);
  await f.start(); await f.seed("B", 3); barrier.release();
  const client = await opening;
  await client.sync(); const read = await client.query(op, {});
  assert.ok(current(read), JSON.stringify(read));
  assert.ok(f.pages.some(page => page.request.after && page.request.store_id !== page.reply.store_id), "B received A's actual continuation");
  assert.equal((await f.core.call({ op: "state" })).ok.watermark, 3);
  t.diagnostic(`${kind}: A staged rows=2/5, B final rows=${read.data.length}, old rows=${read.data.filter(row => row.body === "A").length}`);
});

test("R2 item 3: restoring the same store at a lower head halts reads and retries", { timeout: 45000 }, async t => {
  const f = await fixture(t); await f.seed("A", 1); await f.stop();
  const path = join(f.dir, ".snapback4"), backup = join(f.dir, "backup"); cpSync(path, backup, { recursive: true });
  await f.start(false); await f.seed("later", 2);
  const client = await f.open(), watch = client.observe(op, {});
  await until(() => watch.getSnapshot().fresh, "watch never acquired");
  const a = f.pages.at(-1).reply;
  f.block(true); await f.stop();
  await until(() => client.link() === "offline", "disconnect not observed");
  rmSync(path, { recursive: true }); cpSync(backup, path, { recursive: true });
  await f.start(false); f.block(false); await client.sync();
  const read = await client.query(op, {}), b = await f.post("/sync", { from: a.watermark, store_id: a.store_id });
  assert.equal(a.store_id, b.store_id); assert.equal(a.watermark, 3); assert.equal(b.watermark, 1);
  const probe = await fetch(`${f.url}/probe`, { headers }).then(r => r.json());
  assert.equal(probe.store_id, a.store_id); assert.equal(probe.seq, 1);
  const change = await fetch(`${f.url}/changes?since=3&wait=25&store_id=${a.store_id}`, { headers, signal: AbortSignal.timeout(3000) }).then(r => r.json());
  assert.equal(change.seq, 1); assert.equal(change.store_id, a.store_id);
  t.diagnostic(`restore before/after heads=${a.watermark}/${b.watermark}, read=${JSON.stringify(read)}`);
  assert.equal(read.denied?.code, "E_STORE_RESTORE", "restored same-id partition must refuse, never return old complete rows");
  assert.equal(read.denied.message, "E_STORE_RESTORE: the backend store was restored or shrank below this device's watermark; stop this client and use a fresh device store and outbox");
  assert.notEqual(read.denied.retryable, true);
  await until(() => watch.getSnapshot().denied?.code === "E_STORE_RESTORE", "watch did not refuse");
  const syncs = f.pages.length; await client.sync(); await sleep(1200);
  assert.equal(f.pages.length, syncs, "a coded halt must stop the retry loop");
  const state = (await f.core.call({ op: "sync_state" })).ok;
  assert.equal(state.watermark, 3); assert.equal(state.store_id, a.store_id);
  await client.close(); f.block(true);
  const cold = await f.open(); assert.equal((await cold.query(op, {})).denied?.code, "E_STORE_RESTORE");
  await cold.close(); f.block(false);
  const reopened = await f.open(); await reopened.sync();
  assert.equal(f.pages.length, syncs, "a persisted halt does not resume sync when reopened online");
  const freshClient = await f.open(true), freshRead = await freshClient.query(op, {});
  assert.equal(freshRead.fresh, true); assert.equal(freshRead.complete, true); assert.equal(freshRead.data.length, 1);
  assert.equal((await f.core.call({ op: "sync_state" })).ok.store_id, a.store_id);
  t.diagnostic(`restore: old watermark preserved=${state.watermark}, retry syncs=0, offline reopen refuses=true, fresh device rows=${freshRead.data.length}`);
});

for (const kind of ["server", "wasm", "process"]) test(`R3 finding 5: ${kind} idle poll after populated maintain adoption stays healthy`, { timeout: 30000 }, async t => {
  const f = await fixture(t, kind, 0, true); await f.seed("A", 3);
  const before = await f.post("/sync", { from: 0 });
  writeFileSync(join(f.dir, "snapback/schema.q"), `${source}
maintain counts: count notes by body
  read <- allow
`);
  await until(async () => (await f.post("/sync", { from: 0 })).generation !== before.generation, "maintain was not adopted");
  const rebuilt = await f.post("/sync", { from: 0 });
  assert.equal(rebuilt.watermark, before.watermark + 1);
  assert.equal(rebuilt.store_id, before.store_id);
  if (kind === "server") {
    const notice = await fetch(`${f.url}/changes?since=${rebuilt.watermark}&wait=0&store_id=${rebuilt.store_id}`, { headers }).then(r => r.json());
    t.diagnostic(`maintain: acquired=${rebuilt.watermark}, idle notice=${notice.seq}`);
    assert.equal(notice.seq, rebuilt.watermark, "the idle notice must report the committed rebuild head");
  } else {
    const client = await f.open();
    await until(() => f.notices.length > 0, "no idle notice");
    await client.sync();
    const state = (await f.core.call({ op: "sync_state" })).ok;
    const read = await client.query(op, {});
    t.diagnostic(`${kind}: acquired=${state.watermark}, idle notice=${f.notices[0].seq}, restore=${state.restore_refusal?.code ?? "none"}`);
    assert.equal(read.denied, undefined, JSON.stringify(read));
    assert.equal(read.fresh, true); assert.equal(read.data.length, 3);
    assert.equal(state.restore_refusal, undefined);
  }
});

for (const kind of ["wasm", "process"]) test(`R3 finding 5: ${kind} a lower notification requires sync confirmation`, { timeout: 30000 }, async t => {
  const f = await fixture(t, kind, 1); await f.seed("A", 3);
  const client = await f.open(); f.lowerNotice();
  const syncs = f.pages.length;
  await until(() => f.notices.some(n => n.seq === 0), "the lower notice was not delivered");
  await client.sync();
  const read = await client.query(op, {}), state = (await f.core.call({ op: "sync_state" })).ok;
  assert.equal(read.denied, undefined, JSON.stringify(read));
  assert.equal(read.fresh, true); assert.equal(read.data.length, 3);
  assert.ok(f.pages.length > syncs, "a lower notice must be checked against sync");
  assert.equal(state.restore_refusal, undefined);
  t.diagnostic(`${kind}: lower notice=0, confirmed head=${state.watermark}, restore=none`);
});

test("R3 finding 5: concurrent commits and an older receipt retry keep the actual head", { timeout: 30000 }, async t => {
  const f = await fixture(t, "server", 0, true);
  writeFileSync(join(f.dir, "snapback/schema.q"), `${source}
mutation add(body: text <=100):
  return insert notes { body }
`);
  await until(async () => (await fetch(`${f.url}/schema`, { headers }).then(r => r.json())).programs?.some(p => p.name === "add"), "mutation not adopted");
  // Concurrent commits followed by replay of the older committed receipt.
  // The server unit regression separately forces reversed wake delivery.
  const replies = await Promise.all(["one", "two"].map(id => f.post("/m/add", { id, args: { body: id } })));
  replies.sort((a, b) => a.seq - b.seq);
  assert.deepEqual(replies.map(r => r.seq), [1, 2]);
  const old = await f.post("/m/add", { id: replies[0].id, args: { body: replies[0].id } });
  assert.equal(old.seq, 1);
  const acquired = await f.post("/sync", { from: 0 });
  const notice = await fetch(`${f.url}/changes?since=2&wait=0&store_id=${acquired.store_id}`, { headers }).then(r => r.json());
  t.diagnostic(`commits=1,2; replay=1; acquired=2; idle head=${notice.seq}`);
  assert.equal(notice.seq, 2);
  let finished = false;
  const held = fetch(`${f.url}/changes?since=2&wait=1&store_id=${acquired.store_id}`, { headers }).then(r => r.json()).then(r => { finished = true; return r; });
  await sleep(100); assert.equal(finished, false, "an old completion must not wake idle polls forever");
  await held;
});

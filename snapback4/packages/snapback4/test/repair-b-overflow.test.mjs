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

const root = fileURLToPath(new URL("../../../", import.meta.url));
const binary = process.env.SNAPBACK4_BIN ?? join(root, "target/debug/snapback4");
const wasm = readFileSync(join(root, "packages/snapback4/src/wasm/snapback4_device_bg.wasm"));
const count = 44, width = 400000;
const source = `use personas alice, bob
table items:
  body: text <=400000
  public 'sync overflow fixture'
  sync last 10000 by byId
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
query one(id: items):
  return items[id]
`;
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
  await start(); await seed([{ id: "anchor", body: "small" }]);
  async function rawOpen(tier) {
    const backend = await (await fetch(url + "/schema", { headers })).json();
    const opener = tier === "wasm" ? webDevice({ wasm, persist: memoryPersistence() }) : processDevice({ binary, dir: join(dir, "raw-device") });
    const core = await opener.open("probe", backend);
    t.after(() => core.close());
    const page = await post("/sync", { from: 0, limit: 100 });
    const result = await core.call({ op: "apply", page, first: true });
    assert.equal(result.denied, undefined, JSON.stringify(result));
    return { core };
  }
  return { post, start, seed, widen, open: rawOpen, url: () => url };
}

test("oversized indivisible commit replaces deferred effects on wasm and SQLite", { timeout: hangBudget(23) }, async t => {
  const f = await fixture(t);
  assert.equal((await f.post("/seed", [{ table: "counters", row: { id: "a", n: 0 } }])).seeded, 1);
  const devices = [];
  for (const tier of ["wasm", "process"]) devices.push({ tier, ...await f.open(tier) });
  for (const d of devices) {
    assert.equal((await d.core.call({ op: "admit", entry: { id: "q", seq: 1, op: "bump", args: {}, new_ids: [], predicted: [], viewer: "dev:alice", now: 1000, predictable: true } })).denied, undefined);
    assert.equal((await d.core.call({ op: "begin_send" })).denied, undefined);
  }
  assert.equal((await f.post("/m/bump", { id: "external", args: {} })).state, "sent");
  await f.widen();
  const receipt = await f.post("/m/bump", { id: "q", args: {} });
  assert.equal(receipt.state, "sent");
  for (const d of devices) await t.test(d.tier, async () => {
    const ok = reply => { assert.equal(reply.denied, undefined, JSON.stringify(reply)); return reply.ok; };
    const capture = () => d.core.call({ op: "sync_state" }).then(ok);
    const c = await capture();
    const ordinary = await f.post("/sync", { from: c.transfer_watermark, limit: 1, pending: c.pending_ids });
    assert.equal(ordinary.committed_above.q, receipt.seq);
    assert.equal(ok(await d.core.call({ op: "apply", first: false, page: { ...ordinary,
      requested_watermark: c.transfer_watermark, captured_watermark: c.watermark,
      send_revision: c.send_revision, pending_through: c.pending_through,
      pending_complete: c.pending_complete, pending_bound: c.pending_bound } })).published, false);
    const pending = await capture();
    assert.ok(pending.transfer_watermark > pending.watermark);
    const requests = [], observations = [];
    let replacements = 0, publications = 0;
    const client = await createLocalClient({ url: f.url(), persona: "alice",
      device: { async open() { return { async call(request, committed) {
        if (request.op === "observe_store") observations.push(structuredClone(request.page));
        const reply = await d.core.call(request, committed);
        if (request.op === "apply") {
          assert.equal(request.page.denied, undefined, "overflow refusals are never applied");
          const result = ok(reply);
          if (request.page.snapshot) {
            replacements++;
            assert.equal(request.page.requested_watermark, 0);
            assert.equal(result.published, false);
            assert.equal(ok(await d.core.call({ op: "meta", key: "device:deferred:acks" })), null);
          }
          if (!result.published) {
            assert.equal(ok(await d.core.call({ op: "state" })).watermark, pending.watermark);
            assert.equal(ok(await d.core.call({ op: "query", name: "counter", viewer: "dev:alice", args: {}, now: 1000 })).data.n, 1);
            assert.equal(ok(await d.core.call({ op: "queued" }))[0].observed_seq ?? null, null);
          } else publications++;
        }
        return reply;
      }, close() {} }; } },
      fetch: async (input, init) => {
        if (new URL(input).pathname === "/changes") return parkedChanges(init.signal);
        if (new URL(input).pathname === "/sync") requests.push(JSON.parse(init.body));
        return fetch(input, init);
      } });
    t.after(() => client.close());
    assert.ok(replacements > 1, "a second correctly requested snapshot page must apply");
    assert.equal(publications, 1, "only terminal catch-up publishes");
    const refusals = observations.filter(page => page.denied);
    assert.ok(refusals.length > 0, "MC0 observes the bounded reply inline");
    assert.ok(refusals.every(page => page.requested_watermark === pending.transfer_watermark
      && page.captured_watermark === pending.watermark && page.more && !page.snapshot && page.events.length === 0),
      "the inline observation preserves private and published cuts without applying rows or terminality");
    assert.ok(requests.every(request => !request.metadata && !request.recover));
    const state = ok(await d.core.call({ op: "sync_state", capture: false }));
    assert.equal(state.restore_refusal ?? null, null);
    assert.equal(state.watermark, receipt.seq);
    assert.equal(state.acquired, true);
    assert.equal(ok(await d.core.call({ op: "query", name: "counter", viewer: "dev:alice", args: {}, now: 1000 })).data.n, 2);
    const row = await client.query({ kind: "query", name: "one" }, { id: id(count - 1) });
    assert.equal(row.data.body.length, width);
    assert.equal(row.fresh, true);
    const firstSnapshot = requests.findIndex(request => request.from === 0 && !request.stream);
    assert.ok(firstSnapshot > 0);
    assert.equal(requests[firstSnapshot - 1].limit, 1);
    assert.ok(requests.filter(request => request.after).every(request => request.from === 0 && !request.stream));
    await client.close();
    t.diagnostic(JSON.stringify({ tier: d.tier, published: c.watermark, transfer: pending.transfer_watermark,
      images_at: ordinary.images_at, inlineRefusals: refusals.length, snapshotPages: replacements, final: state.watermark }));
  });
});

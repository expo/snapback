// Compiled client, production dispatcher and SQLite; only the HTTP history is controlled.
import test from "node:test";
import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { once } from "node:events";
import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { processDevice } from "../dist/native.js";
const { createLocalClient } = await import(process.env.REPAIR_B_LOCAL ?? "../dist/local.js");
const binary = process.env.SNAPBACK4_BIN ?? join(dirname(fileURLToPath(import.meta.url)), "../../../target/debug/snapback4");
const source = `use personas alice
 table counters:
  n: int
  read <- allow
  update <- allow
  sync public
query counter():
  return counters['a']
mutation bump():
  c = counters['b'] ! else NOT_FOUND
  update counters['b'] {n: c.n + 1}
`.replace(" table", "table");
const put = (id, n) => ({ table: "counters", kind: "put", id, data: { id, n } });
const ok = async (core, request) => {
  const reply = await core.call(request);
  assert.ok(!reply.denied, JSON.stringify({ request, reply }));
  return reply.ok;
};
async function page(core, watermark, extra = {}) {
  const c = await ok(core, { op: "sync_state" });
  return { snapshot: false, store_id: "S", generation: 1, events: [], watermark, images_at: watermark, more: false,
    requested_watermark: c.transfer_watermark, captured_watermark: c.watermark, send_revision: c.send_revision,
    pending_through: c.pending_through, pending_complete: c.pending_complete, pending_bound: c.pending_bound,
    snapshot_catchup: c.snapshot_catchup, ...extra };
}
async function seed(core, snapshot = false, publish = true) {
  if (publish) await ok(core, { op: "apply", page: await page(core, 5, { events: [put("a", 5), put("b", 0)] }) });
  await ok(core, { op: "admit", entry: { id: "q", seq: 1, op: "bump", args: {}, new_ids: [], predicted: [], viewer: "dev:alice", now: 1000, predictable: true } });
  if (snapshot) await ok(core, { op: "apply", first: true, page: await page(core, 8, { snapshot: true, stage_snapshot: true, requested_watermark: 0 }) });
  const applied = await ok(core, { op: "apply", first: false, page: await page(core, 10, { images_at: 20, more: true, committed_above: { q: 20 }, events: [put("a", 99)] }) });
  assert.equal(applied.published, false);
  const capture = await ok(core, { op: "sync_state", capture: false });
  assert.deepEqual([capture.watermark, capture.transfer_watermark], [5, 10]);
}
async function halted(core) {
  const capture = await ok(core, { op: "sync_state", capture: false });
  assert.equal(capture.restore_refusal?.code, "E_STORE_RESTORE");
  assert.equal(capture.watermark, 5);
  assert.equal(capture.acquired, false);
  assert.equal((await core.call({ op: "begin_send" })).denied?.code, "E_STORE_RESTORE");
  assert.equal((await core.call({ op: "query", name: "counter", viewer: "dev:alice", args: {}, now: 1000 })).ok?.denied?.code, "E_STORE_RESTORE");
}
function held(signal) {
  return new Promise((_, reject) => {
    if (signal.aborted) reject(signal.reason);
    else signal.addEventListener("abort", () => reject(signal.reason), { once: true });
  });
}

test("round 9 native client head observations", { timeout: 60_000 }, async t => {
  const directory = mkdtempSync(join(tmpdir(), "sb4-r9-"));
  mkdirSync(join(directory, "snapback"));
  writeFileSync(join(directory, "snapback/schema.q"), source);
  const server = spawn(binary, ["dev", "--port", "0", "--no-watch", "--memory", "--hold-schedules"], { cwd: directory, stdio: ["ignore", "pipe", "pipe"] });
  const exited = once(server, "exit");
  let log = "";
  server.stderr.on("data", chunk => { log += chunk; });
  t.after(async () => { if (server.exitCode == null && server.signalCode == null) server.kill(); await exited; rmSync(directory, { recursive: true, force: true }); });
  const url = await new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error(log)), 15_000);
    server.once("exit", () => { clearTimeout(timer); reject(new Error(log)); });
    server.stdout.on("data", chunk => { log += chunk; const address = log.match(/http:\/\/127\.0\.0\.1:\d+/)?.[0]; if (address) { clearTimeout(timer); resolve(address); } });
  });
  const backend = await (await fetch(`${url}/schema`, { headers: { "x-snapback-persona": "alice" } })).json();
  assert.equal(backend.generation, 1);
  let number = 0;
  for (const [mode, head, snapshot] of [["startup", 7, false], ["startup", 15, false], ["startup", 15, true], ["probe", 15, false], ["changes", 7, false], ["generation", 15, false], ["generation", 15, true], ["snapshot-restart", 20, true], ["stale-send", 7, false], ["stale-published", 7, false], ["healthy", 20, false]]) {
    await t.test(`${mode} head ${head}, snapshot ${snapshot}`, async t => {
      const opener = processDevice({ binary, dir: join(directory, `device-${number++}`) });
      let core = await opener.open("fixture", backend), client;
      t.after(async () => { await client?.close(); await core.close(); });
      const polling = mode === "probe" || mode === "changes";
      if (!polling) await seed(core, snapshot);
      else await ok(core, { op: "apply", page: await page(core, 5, { events: [put("a", 5), put("b", 0)] }) });
      await core.close();
      core = await opener.open("fixture", null);
      const observations = [], sends = [], adoptions = [];
      let syncs = 0, injected = false, probed = false, preSyncSends;
      let resolveObservation;
      const observed = new Promise(resolve => { resolveObservation = resolve; });
      client = await createLocalClient({ url: "http://head-r9.invalid", persona: "alice", waitSeconds: 0,
        device: { open: async () => ({ close: () => core.close(),
          ...(!polling && mode !== "generation" && mode !== "snapshot-restart" ? { onSuspend: () => () => {} } : {}),
          call: async request => {
            if (request.op === "begin_send") sends.push("begin_send");
            if (request.op === "adopt") adoptions.push(request);
            const reply = await core.call(request);
            if (request.op === "observe_store") observations.push({ request, reply });
            if (polling && request.op === "set_meta" && request.key === "syncedAt" && !injected) {
              injected = true; await seed(core, false, false);
              // The private evidence also survives withdrawal; no sender competes with the poll.
              await ok(core, { op: "dequeue", id: "q" });
            }
            return reply;
          } }) },
        fetch: async (input, init) => {
          const path = new URL(input).pathname;
          if (path === "/schema") return Response.json(mode === "generation" && syncs > 0 ? { ...backend, generation: 2 } : backend);
          if (path === "/probe" || path === "/changes") {
            if (mode === "changes" && path === "/probe") throw new Error("unexpected probe");
            if (mode === "probe" && path === "/changes") throw new TypeError("disconnect before reconnect probe");
            if (probed) return held(init.signal);
            probed = true; resolveObservation();
            if (mode === "stale-send") await ok(core, { op: "begin_send" });
            if (mode === "stale-published") {
              await ok(core, { op: "settle", id: "q", seq: 20 });
              await ok(core, { op: "apply", page: await page(core, 25, { acknowledged: { q: 20 } }) });
              await ok(core, { op: "admit", entry: { id: "q2", seq: 2, op: "bump", args: {}, new_ids: [], predicted: [], viewer: "dev:alice", now: 1000, predictable: true } });
            }
            return Response.json({ ok: true, store_id: "S", seq: head, tables: [] });
          }
          if (path === "/m/bump") { sends.push("http"); return Response.json({ state: "sent", id: "q", seq: 25 }); }
          if (path === "/sync") {
            preSyncSends ??= [...sends];
            syncs++;
            if (mode === "snapshot-restart") {
              if (syncs > 1) throw new TypeError("hold after a healthy replacement page");
              return Response.json({ snapshot: true, generation: 1, store_id: "S", watermark: 8, images_at: 20, more: true, next: "next", events: [put("a", 20)] });
            }
            if (mode === "generation" && syncs > 1) throw new TypeError("hold after the first generation reply");
            if (mode === "generation") return Response.json({ snapshot: false, generation: 2, store_id: "S", watermark: 15, images_at: 15, more: false, events: [] });
            if (polling && syncs === 1) return Response.json({ snapshot: false, generation: 1, store_id: "S", watermark: 5, images_at: 5, more: false, events: [] });
            if (polling || mode.startsWith("stale-") || mode === "healthy") throw new TypeError("hold acquisition after early replay decision");
            return Response.json({ snapshot: false, generation: 1, store_id: "S", watermark: 25, images_at: 25, more: false, events: [], acknowledged: { q: 20 } });
          }
          throw new Error(`unexpected ${path}`);
        },
      });
      if (polling) {
        await Promise.race([observed, new Promise((_, reject) => { const timer = setTimeout(() => reject(new Error("head observation not delivered")), 4000); timer.unref(); })]);
        for (let i = 0; i < 100; i++) {
          if ((await ok(core, { op: "sync_state", capture: false })).restore_refusal) break;
          await new Promise(resolve => setTimeout(resolve, 5));
        }
      }
      if (mode.startsWith("stale-")) {
        assert.equal(preSyncSends.length, 0, "a fenced head cannot authorize early replay");
        assert.equal(observations[0].reply.denied?.code, "E_GENERATION");
        assert.equal((await ok(core, { op: "sync_state", capture: false })).restore_refusal, undefined, "stale observations cannot persist a halt");
      } else if (mode === "snapshot-restart") {
        assert.equal(sends.length, 0);
        assert.equal(observations[0].reply.denied, undefined, "a healthy replacement cut below private progress is not restore");
        const state = await ok(core, { op: "sync_state", capture: false });
        assert.equal(state.restore_refusal, undefined);
        assert.equal(state.watermark, 5);
        assert.equal(state.restore_watermark, 10, "the existing snapshot floor rejects the old cut without persisting a restore halt");
      } else if (mode === "healthy") {
        assert.deepEqual(sends, ["begin_send", "http"], "a validated head permits early replay");
        assert.equal((await ok(core, { op: "sync_state", capture: false })).restore_refusal, undefined);
      } else {
        assert.equal(sends.length, 0, "no mutation send after the lower head observation");
        assert.equal(adoptions.length, 0, "adoption cannot erase private restore evidence");
        await halted(core);
        assert.equal((await client.query({ kind: "query", name: "counter" }, {})).denied?.code, "E_STORE_RESTORE");
        await client.close(); client = undefined;
        core = await opener.open("fixture", null);
        await halted(core);
        const refill = await core.call({ op: "apply", page: await page(core, 25, { acknowledged: { q: 20 } }) });
        assert.equal(refill.denied?.code, "E_STORE_RESTORE", "refill cannot publish the discarded-history row");
        await core.close(); core = await opener.open("fixture", null);
        await halted(core);
      }
    });
  }
});

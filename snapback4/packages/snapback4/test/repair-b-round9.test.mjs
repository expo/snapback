import { captureStdout } from './helpers/server-output.mjs';
import { waitFor as awaitState } from './helpers/wait.mjs';
import { withHangGuard, hangBudget } from './helpers/wait.mjs';
// Compiled client and production openers over SQLite and wasm memory; HTTP history is controlled.
import test from "node:test";
import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { once, EventEmitter } from "node:events";
import { mkdtempSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
const { processDevice } = await import(process.env.REPAIR_B_NATIVE ?? "../dist/native.js");
import { webDevice, memoryPersistence } from "../dist/web.js";
const wasm = readFileSync(new URL("../dist/wasm/snapback4_device_bg.wasm", import.meta.url));
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
  return { snapshot: false, store_id: "S", generation: c.generation, events: [], watermark, images_at: watermark, more: false,
    captured_restore_watermark: c.restore_watermark, captured_restore_images_at: c.restore_images_at,
    requested_watermark: c.transfer_watermark, captured_watermark: c.watermark, send_revision: c.send_revision,
    pending_through: c.pending_through, pending_complete: c.pending_complete, pending_bound: c.pending_bound,
    snapshot_catchup: c.snapshot_catchup, ...extra };
}
async function seed(core, snapshot = false, publish = true, published = 5, privateCut = 10) {
  if (publish) await ok(core, { op: "apply", page: await page(core, published, { events: [put("a", 5), put("b", 0)] }) });
  await ok(core, { op: "admit", entry: { id: "q", seq: 1, op: "bump", args: {}, new_ids: [], predicted: [], viewer: "dev:alice", now: 1000, predictable: true } });
  if (snapshot) await ok(core, { op: "apply", first: true, page: await page(core, privateCut - 1, { snapshot: true, stage_snapshot: true, requested_watermark: 0 }) });
  const applied = await ok(core, { op: "apply", first: false, page: await page(core, privateCut, { images_at: 20, more: true, committed_above: { q: 20 }, events: [put("a", 99)] }) });
  assert.equal(applied.published, false);
  const capture = await ok(core, { op: "sync_state", capture: false });
  assert.deepEqual([capture.watermark, capture.transfer_watermark], [published, privateCut]);
}
async function halted(core, watermark = 5) {
  const capture = await ok(core, { op: "sync_state", capture: false });
  assert.equal(capture.restore_refusal?.code, "E_STORE_RESTORE");
  assert.equal(capture.watermark, watermark);
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

test("round 9-12 client head observations and startup installation", { timeout: hangBudget(63) }, async t => {
  const directory = mkdtempSync(join(tmpdir(), "sb4-r9-"));
  mkdirSync(join(directory, "snapback"));
  writeFileSync(join(directory, "snapback/schema.q"), source);
  const server = spawn(binary, ["dev", "--port", "0", "--no-watch", "--memory", "--hold-schedules"], { cwd: directory, stdio: ["ignore", "pipe", "pipe"] });
  const readStdout = captureStdout(server);
  const exited = once(server, "exit");
  let log = "";
  server.stderr.on("data", chunk => { log += chunk; });
  t.after(async () => { if (server.exitCode == null && server.signalCode == null) server.kill(); await exited; rmSync(directory, { recursive: true, force: true }); });
  const url = await new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error(log)), hangBudget());
    server.once("exit", () => { clearTimeout(timer); reject(new Error(log)); });
    server.stdout.on("data", chunk => { log += chunk; const address = readStdout().match(/http:\/\/127\.0\.0\.1:\d+(?=\r?\n)/)?.[0]; if (address) { clearTimeout(timer); resolve(address); } });
  });
  const backend = await (await fetch(`${url}/schema`, { headers: { "x-snapback-persona": "alice" } })).json();
  assert.equal(backend.generation, 1);
  let number = 0;
  for (const tier of ["native", "wasm"]) for (const [mode, head, snapshot] of [["first-install-overlap", 15, false], ["first-install-overlap", 19, true], ["first-install-healthy", 20, false], ["fresh", 25, false], ["startup-generation", 15, false], ["startup-generation", 19, false], ["startup-generation", 19, true], ["startup-generation-native", 15, false], ["startup-generation-native", 19, true], ["healthy-generation", 20, false], ["replacement-generation", 15, false], ["offline-generation", 0, false], ["startup", 7, false], ["startup", 15, false], ["startup", 15, true], ["probe", 15, false], ["changes", 7, false], ["generation", 15, false], ["generation", 15, true], ["snapshot-restart", 20, true], ["stale-send", 7, false], ["stale-published", 7, false], ["healthy", 20, false], ["private-overlap", 7, false], ["private-overlap", 15, false], ["private-generation", 15, false], ["private-generation-declaration", 15, false], ["late-evidence", 20, false], ["image-only", 20, false], ["late-first-evidence", 7, false], ["schema-overlap", 20, false], ["schema-preflight-gap", 20, false]]) {
    const firstInstallOverlap = mode.startsWith("first-install-");
    const changedStartup = firstInstallOverlap || ["startup-generation", "startup-generation-native", "healthy-generation", "replacement-generation", "offline-generation"].includes(mode);
    if (tier === "wasm" && !changedStartup && mode !== "fresh") continue; // two simultaneous native owners exercise the overlap cases
    await t.test(`${tier}: ${mode} head ${head}, snapshot ${snapshot}`, async t => {
      const opener = tier === "wasm" ? webDevice({ wasm, persist: memoryPersistence() }) : processDevice({ binary, dir: join(directory, `device-${number++}`) });
      const published = changedStartup ? 17 : 5;
      let core, client, peer;
      if (mode !== "fresh" && !firstInstallOverlap) core = await opener.open("fixture", changedStartup ? { ...backend, generation: 2 } : backend);
      t.after(async () => { await client?.close(); await core?.close(); await peer?.close(); });
      const polling = mode === "probe" || mode === "changes";
      if (mode === "fresh" || firstInstallOverlap) { /* The real opener must bootstrap an absent store. */ }
      else if (!polling && mode !== "late-first-evidence") await seed(core, snapshot, true, published, changedStartup ? 18 : 10);
      else await ok(core, { op: "apply", page: await page(core, 5, { events: [put("a", 5), put("b", 0)] }) });
      if (mode === "late-first-evidence") await ok(core, { op: "admit", entry: { id: "q", seq: 1, op: "bump", args: {}, new_ids: [], predicted: [], viewer: "dev:alice", now: 1000, predictable: true } });
      await core?.close();
      if (["private-overlap", "private-generation", "private-generation-declaration", "late-evidence", "image-only", "late-first-evidence", "schema-overlap", "schema-preflight-gap"].includes(mode)) peer = await opener.open("fixture", null);
      const generationMode = ["generation", "private-generation", "private-generation-declaration", "schema-overlap", "schema-preflight-gap"].includes(mode);
      const advance = async () => {
        const before = await ok(peer, { op: "sync_state", capture: false });
        if (mode === "late-first-evidence") await ok(peer, { op: "apply", page: await page(peer, 10, { images_at: 20, more: true, committed_above: { q: 20 }, events: [put("a", 99)] }) });
        else await ok(peer, { op: "apply", page: await page(peer, mode === "image-only" ? 10 : 12, { images_at: ["late-evidence", "image-only", "schema-overlap"].includes(mode) ? 25 : 20, more: true, committed_above: { q: 20 } }) });
        const after = await ok(peer, { op: "sync_state", capture: false });
        assert.deepEqual([after.watermark, after.send_revision], [before.watermark, before.send_revision], "only private evidence moves");
      };
      const observations = [], sends = [], adoptions = [];
      let syncs = 0, injected = false, probed = false, preSyncSends;
      let resolveObservation;
      const observed = new Promise(resolve => { resolveObservation = resolve; });
      client = await createLocalClient({ url: "http://head-r9.invalid", persona: "alice", waitSeconds: 0,
        device: { open: async (_name, fetchedBackend) => {
          // Alias only the store name: forward the actual client backend into
          // the production opener, including changed-generation installation.
          try { core = await opener.open("fixture", fetchedBackend); }
          catch (error) {
            if (!firstInstallOverlap || fetchedBackend !== null) throw error;
            assert.match(String(error), /E_AUTH.*this device has never synced/);
            // Pause after the real empty open has failed/released ownership.
            // A second real owner installs and persists evidence before the
            // unchanged refusal reaches the client's fallback continuation.
            peer = await opener.open("fixture", { ...backend, generation: 2 });
            await seed(peer, snapshot, true, 17, 18);
            const saved = await ok(peer, { op: "sync_state", capture: false });
            assert.deepEqual([saved.generation, saved.watermark, saved.restore_watermark, saved.restore_images_at], [2, 17, 18, 20]);
            await peer.close(); peer = undefined;
            throw error;
          }
          if (firstInstallOverlap) {
            const state = await ok(core, { op: "sync_state", capture: false });
            t.diagnostic(`after fallback open: ${JSON.stringify({ generation: state.generation, published: state.watermark, private: state.restore_watermark, images: state.restore_images_at })}`);
          }
          return { close: () => core.close(),
          ...(!polling && !generationMode && mode !== "snapshot-restart" && mode !== "startup-generation-native" ? { onSuspend: core.onSuspend?.bind(core) ?? (() => () => {}) } : {}),
          call: async request => {
            if (request.op === "begin_send") sends.push("begin_send");
            if (request.op === "adopt") adoptions.push(request);
            const reply = await core.call(request);
            if (request.op === "observe_store") {
              observations.push({ request, reply });
              if (mode === "schema-preflight-gap") await advance();
            }
            if (polling && request.op === "set_meta" && request.key === "syncedAt:wall:1" && !injected) {
              injected = true; await seed(core, false, false);
              // The private evidence also survives withdrawal; no sender competes with the poll.
              await ok(core, { op: "dequeue", id: "q" });
            }
            return reply;
          } }; } },
        fetch: async (input, init) => {
          const path = new URL(input).pathname;
          if (mode === "offline-generation") throw new TypeError("offline startup");
          if (path === "/schema") {
            if (mode === "schema-overlap" && syncs > 0) await advance();
            return Response.json(generationMode && syncs > 0 ? { ...backend, generation: 2 } : backend);
          }
          if (path === "/probe" || path === "/changes") {
            if (mode === "changes" && path === "/probe") throw new Error("unexpected probe");
            if (mode === "probe" && path === "/changes") throw new TypeError("disconnect before reconnect probe");
            if (probed) return held(init.signal);
            probed = true; resolveObservation();
            if (peer) await advance();
            if (mode === "stale-send") await ok(core, { op: "begin_send" });
            if (mode === "stale-published") {
              await ok(core, { op: "settle", id: "q", seq: 20 });
              await ok(core, { op: "apply", page: await page(core, 25, { acknowledged: { q: 20 } }) });
              await ok(core, { op: "admit", entry: { id: "q2", seq: 2, op: "bump", args: {}, new_ids: [], predicted: [], viewer: "dev:alice", now: 1000, predictable: true } });
            }
            return Response.json({ ok: true, store_id: mode === "replacement-generation" ? "T" : "S", seq: head, tables: [] });
          }
          if (path === "/m/bump") { sends.push("http"); return Response.json({ state: "sent", id: "q", seq: 25 }); }
          if (path === "/sync") {
            preSyncSends ??= [...sends];
            syncs++;
            if (changedStartup) {
              // A bad opener may erase the evidence, so let it reacquire and
              // expose the forbidden send instead of stubbing that boundary.
              return Response.json({ snapshot: false, generation: 1, store_id: mode === "replacement-generation" ? "T" : "S", watermark: head, images_at: head, more: false, events: [], acknowledged: {} });
            }
            if (mode === "snapshot-restart") {
              if (syncs > 1) throw new TypeError("hold after a healthy replacement page");
              return Response.json({ snapshot: true, generation: 1, store_id: "S", watermark: 8, images_at: 20, more: true, next: "next", events: [put("a", 20)] });
            }
            if (generationMode && syncs > 1) throw new TypeError("hold after the first generation reply");
            if (generationMode) {
              if (mode.startsWith("private-generation")) {
                await advance();
                if (mode === "private-generation-declaration") {
                  await ok(peer, { op: "admit", entry: { id: "later", seq: 2, op: "bump", args: {}, new_ids: [], predicted: [], viewer: "dev:alice", now: 1000, predictable: true } });
                  await ok(peer, { op: "sync_state" });
                }
              }
              return Response.json({ snapshot: false, generation: 2, store_id: "S", watermark: head, images_at: head, more: false, events: [] });
            }
            if (polling && syncs === 1) return Response.json({ snapshot: false, generation: 1, store_id: "S", watermark: 5, images_at: 5, more: false, events: [] });
            if (polling || mode.startsWith("stale-") || mode === "healthy" || ["late-evidence", "image-only", "late-first-evidence"].includes(mode)) throw new TypeError("hold acquisition after early replay decision");
            return Response.json({ snapshot: false, generation: 1, store_id: "S", watermark: 25, images_at: 25, more: false, events: [], acknowledged: { q: 20 } });
          }
          throw new Error(`unexpected ${path}`);
        },
      });
      if (polling) {
        await withHangGuard(() => observed, "head observation not delivered");
        await awaitState(async () => (await ok(core, { op: "sync_state", capture: false })).restore_refusal, "restore refusal");
      }
      if (mode === "fresh") {
        const state = await ok(core, { op: "sync_state", capture: false });
        assert.deepEqual([state.generation, state.watermark, state.acquired], [1, 25, true]);
        assert.equal(state.restore_refusal, undefined);
        assert.equal(adoptions.length, 0);
        assert.equal(sends.length, 0);
      } else if (mode === "offline-generation") {
        assert.equal(sends.length, 0);
        assert.equal(adoptions.length, 0);
        const state = await ok(core, { op: "sync_state", capture: false });
        assert.deepEqual([state.generation, state.watermark, state.restore_watermark, state.restore_images_at], [2, 17, 18, 20]);
        assert.equal(state.restore_refusal, undefined);
      } else if (["healthy-generation", "replacement-generation", "first-install-healthy"].includes(mode)) {
        const state = await ok(core, { op: "sync_state", capture: false });
        assert.equal(state.generation, 1, "a validated changed generation is actually installed");
        assert.equal(state.store_id, mode === "replacement-generation" ? "T" : "S");
        assert.equal(state.restore_refusal, undefined);
        assert.equal(adoptions.length, 1);
        assert.equal(sends.filter(s => s === "http").length, mode === "replacement-generation" ? 0 : 1, "replacement retires the known old-store receipt without replay");
      } else if (mode === "schema-overlap" || mode === "schema-preflight-gap") {
        assert.equal(sends.length, 0);
        assert.equal(adoptions.length, 1);
        const state = await ok(core, { op: "sync_state", capture: false });
        assert.equal(state.generation, 1, "schema reply cannot discard private evidence acquired during its request");
        assert.equal(state.restore_watermark, 12);
        assert.equal(state.restore_refusal, undefined);
      } else if (mode.startsWith("stale-") || ["late-evidence", "image-only", "late-first-evidence"].includes(mode)) {
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
        await halted(core, published);
        if (changedStartup) {
          const state = await ok(core, { op: "sync_state", capture: false });
          assert.deepEqual([state.generation, state.restore_watermark, state.restore_images_at], [2, 18, 20], "open cannot erase persisted evidence before validation");
        }
        assert.equal((await client.query({ kind: "query", name: "counter" }, {})).denied?.code, "E_STORE_RESTORE");
        await client.close(); client = undefined;
        core = await opener.open("fixture", null);
        await halted(core, published);
        const refill = await core.call({ op: "apply", page: await page(core, 25, { acknowledged: { q: 20 } }) });
        assert.equal(refill.denied?.code, "E_STORE_RESTORE", "refill cannot publish the discarded-history row");
        await core.close(); core = await opener.open("fixture", null);
        await halted(core, published);
      }
    });
  }
});


test("startup never treats another open failure as an empty store", async () => {
  for (const message of ["E_STORE: corrupt kept backend", "E_AUTH: access refused", "E_STORE: this device has never synced: the server must be reachable once to open"]) {
    const failure = new Error(message), supplied = [];
    await assert.rejects(createLocalClient({ url: "http://open-failure.invalid", persona: "alice",
      fetch: async () => Response.json({ generation: 1, schema: { tables: {} }, programs: [] }),
      device: { open: async (_name, backend) => { supplied.push(backend); throw failure; } },
    }), error => error === failure);
    assert.deepEqual(supplied, [null], "an open failure cannot authorize installation");
  }
});


test("native open preserves a refusal arriving after process exit", async () => {
  const child = new EventEmitter();
  child.stdout = new EventEmitter();
  child.stdin = { write() {} };
  child.kill = () => {};
  const opener = processDevice({ dir: "unused", binary: "controlled-child", spawn: () => {
    queueMicrotask(() => {
      child.emit("exit", 1, null);
      setImmediate(() => {
        child.stdout.emit("data", JSON.stringify({ denied: { code: "E_AUTH", message: "this device has never synced: the server must be reachable once to open" } }) + "\n");
        child.emit("close", 1, null);
      });
    });
    return child;
  } });
  await assert.rejects(opener.open("fixture", null), /E_AUTH: this device has never synced/);
});

import { waitFor as awaitState, hangBudget } from './helpers/wait.mjs';
import test from "node:test";
import assert from "node:assert/strict";

const backend = { generation: 1, schema: { tables: {}, operations: { counter: { runs: "device", held: true } } }, programs: [{ name: "counter", kind: "Query", args: {}, body: [{ table: "counters" }], held: true }] };
const query = { kind: "query", name: "counter", held: true };
const pause = () => new Promise(resolve => setTimeout(resolve, 0));

function device(state, apply, extra = () => undefined) {
  return { close: async () => {}, call: async request => {
    const reply = extra(request);
    if (reply !== undefined) return reply;
    switch (request.op) {
      case "engine_info": return { ok: {format:1,version:"0.4.24",capabilities:["sync-generation-v1"]} };
      case "observe_store": return { ok: { reset: false, backend_required: false, send_revision: 0, retired: {} } };
      case "backend": return { ok: backend };
      case "meta": return { ok: null };
      case "state": return { ok: { watermark: state().watermark, generation: 1 } };
      case "queued": return { ok: [] };
      case "sync_state": return { ok: { acquired: true, backend_required: false, generation: 1,
        restore_watermark: 0, restore_images_at: 0, receipt_outcomes: true, outbox_status: true, adoption_capture: {}, pending_ids: [], pending_through: 0, pending_complete: true, pending_bound: 0, send_revision: 0, ...state() } };
      case "apply": return apply(request);
      case "set_meta": case "keep_write": return { ok: null };
      case "next_submission": return { ok: 1 };
      default: throw new Error(`unexpected device operation ${request.op}`);
    }
  } };
}

test("private commits keep the published image without adopting the staged identity", { timeout: hangBudget(7) }, async t => {
  const { createLocalClient } = await import(process.env.REPAIR_B_LOCAL ?? "../dist/local.js");
  let mode = "initial", publishedStore = "A", watermark = 5, transfer = 5, value = 1;
  let stage = 0, localReads = 0, observations = 0, adoptions = 0, client, watch;
  const watched = [], requests = [];
  const core = device(() => ({ store_id: publishedStore, transfer_store_id: mode === "initial" ? "A" : "B",
    watermark, transfer_watermark: transfer, snapshot_catchup: false }), request => {
    if (mode === "initial") return { ok: { touched: [], published: true } };
    if (stage++ === 0) { transfer = 6; return { ok: { touched: [], published: false } }; }
    value = 2; watermark = transfer = 7; publishedStore = "B";
    return { ok: { touched: ["counters"], published: true } };
  }, request => {
    if (request.op === "observe_store") { observations++; return { ok: { reset: false, backend_required: false, send_revision: 0, retired: {} } }; }
    if (request.op === "adopt") { adoptions++; return { ok: null }; }
    if (request.op === "query") { localReads++; return { ok: { data: value, complete: true, tables: ["counters"] } }; }
  });
  let priorReads, priorNotifications, duringPrivate;
  client = await createLocalClient({ url: "http://private-r7.invalid", persona: "alice", device: { open: async () => core },
    fetch: async (url, init) => {
      const path = new URL(url).pathname;
      if (path === "/schema") return Response.json(backend);
      if (path === "/probe") return Response.json({ ok: true, store_id: publishedStore, seq: watermark });
      if (path === "/changes") return new Promise((_, reject) => {
        if (init.signal.aborted) reject(init.signal.reason);
        else init.signal.addEventListener("abort", () => reject(init.signal.reason), { once: true });
      });
      if (path !== "/sync") throw new TypeError("background transport held");
      const request = JSON.parse(init.body); requests.push(request);
      if (mode === "initial") return Response.json({ snapshot: false, store_id: "A", events: [], watermark: 5, images_at: 5, more: false, generation: 1 });
      if (stage === 1) {
        await pause();
        duringPrivate = { snapshot: watch.getSnapshot(), reads: localReads, notifications: watched.length };
      }
      return Response.json({ snapshot: false, store_id: "B", events: [], watermark: stage ? 7 : 6, images_at: 7, more: !stage, generation: 1 });
    },
  });
  t.after(async () => { watch?.close(); await client.close(); });
  watch = client.observe(query, {});
  watch.subscribe(() => watched.push(watch.getSnapshot()));
  await awaitState(async () => !(watch.getSnapshot().data !== 1), "repair-b-round7.test.mjs: watch.getSnapshot().data !== 1", { poll: async () => { await pause(); } });
  assert.equal(watch.getSnapshot().data, 1);
  priorReads = localReads; priorNotifications = watched.length;
  mode = "private";
  await client.sync();
  await awaitState(async () => !(watch.getSnapshot().data !== 2), "repair-b-round7.test.mjs: watch.getSnapshot().data !== 2", { poll: async () => { await pause(); } });
  assert.equal(stage, 2, "private transfer reached publication");
  assert.equal(duringPrivate.snapshot.data, 1, "a rerun still reads the published image");
  assert.equal(duringPrivate.reads, priorReads, "an empty private staging apply does no known-query work");
  assert.equal(duringPrivate.notifications, priorNotifications, "private staging leaves the published answer untouched");
  assert.ok(watched.slice(priorNotifications, duringPrivate.notifications).every(read => !("data" in read) || read.data === 1), "staged rows cannot reach any publication");
  assert.equal(watch.getSnapshot().data, 2);
  assert.equal(observations, 3, "all pages are validated without treating private identity as a replacement");
  assert.equal(adoptions, 0);
  assert.deepEqual(requests.slice(1).map(r => [r.store_id, r.from]), [["B", 5], ["B", 6]]);
});

test("ordinary publication keeps stream mode through false snapshot mode and an interrupted round", { timeout: hangBudget(3) }, async t => {
  const { createLocalClient } = await import(process.env.REPAIR_B_LOCAL ?? "../dist/local.js");
  let watermark = 0, transfer = 0, applied = 0, interrupted = false;
  const requests = [], ownership = [];
  const core = device(() => ({ store_id: "S", transfer_store_id: "S", watermark, transfer_watermark: transfer, snapshot_catchup: false }), request => {
    ownership.push(request.page.snapshot_catchup);
    if (applied++ === 0) { transfer = 7; return { ok: { touched: [], published: false } }; }
    watermark = transfer = 9;
    return { ok: { touched: [], published: true } };
  });
  const client = await createLocalClient({ url: "http://ordinary-r7.invalid", persona: "alice", device: { open: async () => core },
    fetch: async (url, init) => {
      const path = new URL(url).pathname;
      if (path === "/schema") return Response.json(backend);
      if (path !== "/sync") throw new TypeError("background transport held");
      const request = JSON.parse(init.body); requests.push(request);
      if (requests.length === 1) return Response.json({ snapshot: false, store_id: "S", events: [], watermark: 7, images_at: 9, more: true, generation: 1 });
      if (!interrupted) { interrupted = true; throw new TypeError("lose the next request after deferral"); }
      if (watermark === 0 && !request.stream) return new Response("missing stream mode", { status: 503 });
      return Response.json({ snapshot: false, store_id: "S", events: [], watermark: 9, images_at: 9, more: false, generation: 1 });
    },
  });
  t.after(() => client.close());
  assert.equal(watermark, 0);
  await client.sync();
  assert.equal(watermark, 9);
  // Startup already began recovery; the explicit follow-up uses published progress.
  assert.deepEqual(requests.map(r => [r.from, r.stream]), [[0, false], [7, true], [7, true], [9, false]]);
  assert.deepEqual(ownership, [false, false, false], "ordinary deferral must never claim a snapshot owner");
});

test("change polling takes published native progress after another owner advances", { timeout: hangBudget(5) }, async t => {
  const { createLocalClient } = await import(process.env.REPAIR_B_LOCAL ?? "../dist/local.js");
  let watermark = 5, advancing = false, releasePoll;
  const polls = [];
  const core = device(() => ({ store_id: "S", watermark, transfer_watermark: watermark, snapshot_catchup: false }), () => {
    // This page commits at 7; another owner's transaction advances to 9 before
    // the shell refreshes native progress. The HTTP page is no longer current.
    if (advancing) watermark = 9;
    return { ok: { touched: [], published: true } };
  });
  const client = await createLocalClient({ url: "http://published-r7.invalid", persona: "alice", device: { open: async () => core },
    fetch: async (url, init) => {
      const parsed = new URL(url);
      if (parsed.pathname === "/schema") return Response.json(backend);
      if (parsed.pathname === "/sync") return Response.json({ snapshot: false, store_id: "S", events: [], watermark: advancing ? 7 : 5, images_at: advancing ? 7 : 5, more: false, generation: 1 });
      if (parsed.pathname === "/probe") return Response.json({ ok: true, store_id: "S", seq: watermark });
      if (parsed.pathname === "/changes") {
        polls.push([parsed.searchParams.get("since"), parsed.searchParams.get("store_id")]);
        return new Promise((_, reject) => {
          releasePoll = () => reject(new TypeError("interrupt the old poll"));
          if (init.signal.aborted) reject(init.signal.reason);
          else init.signal.addEventListener("abort", () => reject(init.signal.reason), { once: true });
        });
      }
      throw new Error(`unexpected transport ${url}`);
    },
  });
  t.after(() => client.close());
  await awaitState(async () => !(!polls.length), "repair-b-round7.test.mjs: !polls.length", { poll: async () => { await pause(); } });
  assert.deepEqual(polls, [["5", "S"]]);
  advancing = true;
  await client.sync();
  releasePoll();
  await awaitState(async () => !(polls.length < 2), "repair-b-round7.test.mjs: polls.length < 2", { poll: async () => { await new Promise(resolve => setTimeout(resolve, 10)); } });
  assert.deepEqual(polls, [["5", "S"], ["9", "S"]]);
});

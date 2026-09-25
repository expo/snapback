// @ref LLP 3000.016#2.2 — every publication uses possible reads, not just the reads a speculative branch took.
import test from "node:test";
import assert from "node:assert/strict";
import { evaluateLocal } from "../dist/local-query.js";
import { createLocalClient } from "../dist/local.js";

const op = { kind: "query", name: "read" }, input = { c: "original-cursor" };
const prediction = { id: "own", predictable: true, observed_seq: null, predicted: ["posts/own", "feedFeed/own"] };
function routing() {
  const program = { name: "read", kind: "Query", args: {}, body: [{ table: "posts" }], runs: "device" };
  const backend = { generation: 1, schema: { tables: {}, timelines: [{ name: "feed", posts: ["posts"], reposts: ["reposts"] }] }, programs: [program] };
  let entries = [prediction], outcome = { data: [], unknown: true, complete: false, tables: ["switches"] };
  const requests = [];
  const env = {
    backend, partitionDenied: null, credentialRevision: 0, incarnation: 0, authority: 0, sessionDead: false,
    refreshing: null, link: "online", caughtUp: true, identityChecked: true, lastSyncAt: 1, principal: "alice",
    partitionCurrent: true, nativeReady: true, signal: new AbortController().signal,
    unavailable: () => null, queued: async () => entries,
    call: async request => { assert.equal(request.op, "query"); return { ok: outcome }; },
    post: async (path, body) => { requests.push({ path, body }); return { ok: true, json: { data: ["server"], tables: ["switches"], complete: true }, obsoleteAuth: false }; },
    installNative: async () => false, notify: () => {},
    offline: () => ({ code: "E_OFFLINE", family: "link", message: "offline" }), serverAnswers: new Map(),
  };
  return { env, program, requests, set entries(value) { entries = value; }, set outcome(value) { outcome = value; },
    read: async () => (await evaluateLocal(env, op, input, 0, 0)).read };
}

for (const path of ["server shortcut", "remembered", "local unknown", "E_OFFLINE reset", "E_OFFLINE unknown refusal", "E_OFFLINE remembered miss"]) {
  test(`prediction publication fence: ${path}`, async () => {
    const f = routing();
    if (path === "server shortcut") f.program.runs = "server";
    if (path.startsWith("E_OFFLINE") || path === "remembered") f.env.link = "offline";
    if (path.includes("remembered")) {
      f.program.runs = "server";
      f.program.body = []; // The device has not run: possible reads are all tables.
      if (path === "remembered") f.env.serverAnswers.set(`read:${JSON.stringify(input)}`, {
        read: { data: ["old"], complete: true, cut: null, fresh: true, next: "stale-next" }, at: 1, tables: new Set(["switches"]),
      });
    }
    if (path === "E_OFFLINE reset") { f.env.partitionCurrent = false; f.program.body = []; }
    if (path === "E_OFFLINE unknown refusal") {
      f.program.body = [{ table: "other" }];
      f.entries = [{ ...prediction, predicted: ["other/own"] }];
      f.outcome = { denied: { code: "MISSING", family: "app", message: "unknown" }, unknown: true, tables: ["other"] };
    }
    assert.deepEqual(await f.read(), { loading: true });
    assert.equal(f.requests.length, 0);
    if (path === "remembered") {
      f.entries = [];
      assert.deepEqual((await f.read()).data, ["old"], "the control actually exercises remembered recovery");
    }
  });
}

test("prediction publication fence: dispatch and delivery both check opaque native dependencies", async () => {
  const f = routing(); f.program.native = true; f.program.body = []; f.env.partitionCurrent = false;
  f.entries = [];
  const send = f.env.post;
  f.env.post = async (...args) => { const response = await send(...args); f.entries = [prediction]; return response; };
  assert.deepEqual(await f.read(), { loading: true });
  assert.deepEqual(f.requests, [{ path: "/q/read", body: { args: input } }]);
  assert.equal(f.env.serverAnswers.size, 0);
});

test("prediction publication fence: transport failure cannot recover an answer after a prediction arrives", async () => {
  const f = routing(); f.program.body = []; f.program.runs = "server"; f.entries = [];
  f.env.serverAnswers.set(`read:${JSON.stringify(input)}`, {
    read: { data: ["old"], complete: true, cut: null, fresh: true, next: "old-next" }, at: 1, tables: new Set(["switches"]),
  });
  f.env.post = async () => { f.entries = [prediction]; f.env.link = "offline"; return { ok: false }; };
  assert.deepEqual(await f.read(), { loading: true });
});

test("prediction publication fence: row IDs containing slashes still intersect their source table", async () => {
  const f = routing();
  f.entries = [{ ...prediction, predicted: ["posts/author/own"] }];
  assert.deepEqual(await f.read(), { loading: true });
  assert.equal(f.requests.length, 0);
});

test("prediction publication fence: established branches and disjoint writes remain answerable", async () => {
  const f = routing(); f.program.held = true;
  f.outcome = { data: false, unknown: false, complete: true, tables: [] };
  assert.equal((await f.read()).data, false);
  f.program.held = false;
  f.outcome = { data: [], unknown: true, complete: false, tables: ["switches"] };
  f.entries = [{ ...prediction, predicted: ["unrelated/own"] }];
  assert.deepEqual((await f.read()).data, ["server"]);
  assert.equal(f.requests.length, 1);
  f.entries = [{ ...prediction, observed_seq: 10 }];
  assert.deepEqual((await f.read()).data, ["server"], "observation releases the fence");
});

for (const mode of ["reset", "install failure"]) {
  for (const held of [false, true]) test(`native client ${mode} with an unobserved prediction${held ? " held" : ""}`, async t => {
    const backend = { generation: 1, schema: { tables: {} }, native: { digest: "fixture", reads: ["read"], jobs: [] },
      programs: [{ name: "read", kind: "Query", args: {}, body: [], native: true, held }] };
    let reset = false, generation = 1, queryCalls = 0, installs = 0;
    const requests = [], snapshots = [];
    const core = {
      async call(request) {
        switch (request.op) {
          case "backend": return { ok: backend };
          case "state": return { ok: { watermark: 0, generation, native: mode === "reset" ? "fixture" : null } };
          case "sync_state": return { ok: { acquired: false, backend_required: false, store_id: null, watermark: 0, generation, restore_watermark: 0, restore_images_at: 0, adoption_capture: {}, pending_ids: ["own"], send_revision: 0 } };
          case "observe_store": { const changed = reset; reset = false; return { ok: { reset: changed, backend_required: false, send_revision: request.page.send_revision, retired: {}, adoption_capture: {} } }; }
          case "next_submission": return { ok: 2 };
          case "meta": return { ok: null };
          case "set_meta": return { ok: null };
          case "apply": return { ok: { touched: [] } };
          // Acknowledged but not observed: do not submit it again, and keep its prediction fenced.
          case "queued": return { ok: [{ ...prediction, seq: 1, sent_seq: 1, op: "post", args: {}, new_ids: [] }] };
          case "query": queryCalls++; return { ok: { data: ["own"], complete: true, unknown: false, tables: ["posts"] } };
          default: throw Error(`unexpected ${request.op}`);
        }
      }, async close() {},
    };
    const client = await createLocalClient({ url: `http://native-${mode.replaceAll(" ", "-")}.invalid`, persona: "alice", device: { open: async () => core }, fetch: async (url, init) => {
      const path = new URL(url).pathname;
      if (path === "/schema") return Response.json(backend);
      if (path === "/native.wasm") { installs++; return new Response(null, { status: 503 }); }
      if (path === "/changes") return new Promise((_, reject) => {
        if (init.signal.aborted) reject(init.signal.reason);
        else init.signal.addEventListener("abort", () => reject(init.signal.reason), { once: true });
      });
      if (path === "/sync") return Response.json({ snapshot: true, events: [], watermark: 0, more: false, generation });
      if (path === "/q/read") { requests.push(JSON.parse(init.body)); return Response.json({ data: ["server-without-own"], complete: true }); }
      throw Error(`unexpected ${path}`);
    } });
    t.after(() => client.close());
    await client.sync();
    if (mode === "reset") {
      assert.deepEqual((await client.query(op, input)).data, ["own"]);
      const watch = client.observe(op, input);
      const stop = watch.subscribe(() => snapshots.push(watch.getSnapshot())); t.after(stop);
      reset = true;
      // This refusal stops acquisition after observe_store reruns the watch.
      const call = core.call.bind(core);
      core.call = async request => request.op === "apply" ? { denied: { code: "E_BUSY", family: "transport", message: "snapshot paused" } } : call(request);
      await client.sync();
    }
    const before = queryCalls;
    assert.deepEqual(await client.query(op, input), { loading: true });
    assert.equal(queryCalls, before, "the unavailable guest/partition cannot run locally");
    assert.equal(requests.length, 0);
    assert.ok(snapshots.every(read => !("data" in read) || !read.data.includes("server-without-own")));
    if (mode === "install failure") assert.ok(installs >= 2, JSON.stringify({ installs, link: client.link() }));
  });
}

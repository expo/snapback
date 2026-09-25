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

// Rule 2: even a static server class must execute and prefer a complete answer.
for (const native of [false, true]) for (const held of [false, true]) {
  test(`rule 2: known complete branch wins (native=${native}, held=${held})`, async () => {
    const f = routing(); f.program.runs = "server"; f.program.native = native; f.program.held = held;
    f.outcome = { data: false, unknown: false, complete: true, tables: ["switches"] };
    assert.equal((await f.read()).data, false);
    assert.equal(f.requests.length, 0, "narrowing known reads must never authorize a different server branch");
  });
}

for (const state of ["offline", "prediction", "held", "server", "transport failure"]) {
  test(`rule 3: engine-withheld ${state}`, async () => {
    const f = routing(); f.entries = [];
    f.outcome = { loading: true, unknown: true, tables: ["posts"] };
    if (state === "offline") f.env.link = "offline";
    if (state === "prediction") f.entries = [prediction];
    if (state === "held") f.program.held = true;
    if (state === "transport failure") f.env.post = async () => ({ ok: false });
    const answer = await f.read();
    if (state === "server") {
      assert.deepEqual(answer.data, ["server"]);
      assert.deepEqual(f.requests, [{ path: "/q/read", body: { args: input } }]);
    } else assert.deepEqual(answer, { loading: true });
  });
}

for (const state of ["offline", "prediction", "held", "server", "transport failure"]) {
  test(`rule 4: available unknown Following ${state}`, async () => {
    const f = routing(); f.entries = [];
    f.outcome = { data: ["own"], unknown: true, complete: false, tables: ["posts"] };
    if (state === "offline") f.env.link = "offline";
    if (state === "prediction") f.entries = [prediction];
    if (state === "held") f.program.held = true;
    if (state === "transport failure") f.env.post = async () => ({ ok: false });
    const read = await f.read();
    assert.deepEqual(read.data, state === "server" ? ["server"] : ["own"]);
    assert.equal(read.complete, state === "server");
  });
}

test("rule 4: unknown conditions retain static possible reads, including slash IDs", async () => {
  const f = routing(); f.entries = [{ ...prediction, predicted: ["posts/author/own"] }];
  assert.deepEqual((await f.read()).data, []);
  assert.equal(f.requests.length, 0);
});

test("rules 2/3: an unrelated profile read runs before considering a pending post", async () => {
  const f = routing(); f.program.runs = "server"; f.program.body = [{ table: "profiles" }];
  f.outcome = { data: "profile", unknown: false, complete: true, tables: ["profiles"] };
  assert.equal((await f.read()).data, "profile");
  assert.equal(f.requests.length, 0);
  f.outcome = { loading: true, unknown: true, tables: ["profiles"] };
  assert.deepEqual((await f.read()).data, ["server"], "a disjoint footprint does not fence fallback");
});

test("rule 3: known meter prefixes stay partial without fallback", async () => {
  const f = routing(); f.entries = [];
  f.outcome = { data: ["prefix"], unknown: false, complete: false, cut: "meter", next: "resume", tables: ["posts"] };
  const read = await f.read();
  assert.deepEqual(read.data, ["prefix"]); assert.equal(read.complete, false); assert.equal(read.next, "resume");
  assert.equal(f.requests.length, 0);
});

for (const available of [false, true]) for (const wait of ["delivery", "publication"]) {
  test(`rule 5: prediction arriving at ${wait} keeps ${available ? "local data" : "withholding"}`, async () => {
    const f = routing(); f.entries = [];
    f.outcome = available ? { data: ["local"], unknown: true, complete: false, tables: ["posts"] } : { loading: true, unknown: true, tables: ["posts"] };
    const send = f.env.post; let delivered = false, checks = 0;
    f.env.post = async (...args) => { const answer = await send(...args); delivered = true; return answer; };
    f.env.queued = async () => delivered && ++checks >= (wait === "delivery" ? 1 : 2) ? [prediction] : [];
    const read = await f.read();
    if (available) { assert.deepEqual(read.data, ["local"]); assert.equal(read.complete, false); }
    else assert.deepEqual(read, { loading: true });
    assert.equal(f.requests.length, 1);
  });
}

for (const available of [false, true]) test(`rules 3/4: remembered pages cannot replace ${available ? "local data" : "withholding"}`, async () => {
  const f = routing(); f.program.runs = "server";
  f.env.serverAnswers.set(`read:${JSON.stringify(input)}`, {
    read: { data: ["old"], complete: true, cut: null, fresh: true, next: "stale-next" }, at: 1, tables: new Set(["switches"]),
  });
  f.outcome = available ? { data: ["own"], unknown: true, complete: false, tables: ["posts"] } : { loading: true, unknown: true, tables: ["posts"] };
  for (const online of [true, false]) for (const entries of [[prediction], []]) {
    f.entries = entries; f.env.link = online ? "online" : "offline";
    f.env.post = async () => ({ ok: false });
    const read = await f.read();
    if (available) assert.deepEqual(read.data, ["own"]); else assert.deepEqual(read, { loading: true });
  }
});

test("rule 5: a native program stays opaque after local execution", async () => {
  const f = routing(); f.program.native = true; f.program.body = [];
  f.outcome = { loading: true, unknown: true, tables: ["switches"] };
  assert.deepEqual(await f.read(), { loading: true }); assert.equal(f.requests.length, 0);
});

test("rule 5: observed entries and predictable no-ops release the fence", async () => {
  const f = routing();
  for (const entry of [{ ...prediction, predicted: [] }, { ...prediction, observed_seq: 10 }]) {
    f.entries = [entry]; assert.deepEqual((await f.read()).data, ["server"]);
  }
  assert.equal(f.requests.length, 2);
});

for (const code of ["E_PREDICT", "E_NATIVE"]) test(`rule 3: device preflight ${code} cannot certify local coverage`, async () => {
  const f = routing(); f.program.body = [{ table: "other" }];
  f.outcome = { denied: { code, family: "prediction", message: "device cannot run" }, unknown: true };
  assert.deepEqual(await f.read(), { loading: true }); assert.equal(f.requests.length, 0);
  f.entries = []; assert.deepEqual((await f.read()).data, ["server"]);
});

for (const wait of ["delivery", "publication"]) for (const code of ["E_AUTH", "E_CLOSED"]) {
  test(`rule 1: router itself refuses ${code} during ${wait}`, async () => {
    const f = routing(); f.entries = [];
    f.outcome = { loading: true, unknown: true, tables: ["posts"] };
    let delivered = false, checks = 0, denied = null;
    const send = f.env.post;
    f.env.post = async (...args) => { const answer = await send(...args); delivered = true; return answer; };
    f.env.unavailable = () => denied;
    f.env.queued = async () => {
      if (delivered && ++checks === (wait === "delivery" ? 1 : 2)) denied = { code, family: "auth", message: "session ended" };
      return [];
    };
    assert.deepEqual(await f.read(), { denied: { code, family: "auth", message: "session ended" } });
  });
}

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

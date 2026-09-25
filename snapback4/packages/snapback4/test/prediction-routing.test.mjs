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
  let entries = [prediction], outcome = { data: [], speculative: true, held: false, unknown: true, complete: false, tables: ["switches"] };
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
    f.outcome = { data: [{ id: "own" }], speculative: false, held: true, unknown: true, complete: false, tables: ["posts"] };
    if (state === "offline") f.env.link = "offline";
    if (state === "prediction") f.entries = [prediction];
    if (state === "held") f.program.held = true;
    if (state === "transport failure") f.env.post = async () => ({ ok: false });
    const read = await f.read();
    assert.deepEqual(read.data, state === "server" ? ["server"] : [{ id: "own" }]);
    assert.equal(read.complete, state === "server");
  });
}

test("rule 4: unknown conditions retain static possible reads, including slash IDs", async () => {
  const f = routing(); f.entries = [{ ...prediction, predicted: ["posts/author/own"] }];
  assert.deepEqual(await f.read(), { loading: true });
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
    f.outcome = available ? { data: [{ id: "local" }], speculative: false, held: true, unknown: true, complete: false, tables: ["posts"] } : { loading: true, unknown: true, tables: ["posts"] };
    const send = f.env.post; let delivered = false, checks = 0;
    f.env.post = async (...args) => { const answer = await send(...args); delivered = true; return answer; };
    f.env.queued = async () => delivered && ++checks >= (wait === "delivery" ? 1 : 2) ? [prediction] : [];
    const read = await f.read();
    if (available) { assert.deepEqual(read.data, [{ id: "local" }]); assert.equal(read.complete, false); }
    else assert.deepEqual(read, { loading: true });
    assert.equal(f.requests.length, 1);
  });
}

for (const available of [false, true]) test(`rules 3/4: remembered pages cannot replace ${available ? "local data" : "withholding"}`, async () => {
  const f = routing(); f.program.runs = "server";
  f.env.serverAnswers.set(`read:${JSON.stringify(input)}`, {
    read: { data: ["old"], complete: true, cut: null, fresh: true, next: "stale-next" }, at: 1, tables: new Set(["switches"]),
  });
  f.outcome = available ? { data: [{ id: "own" }], speculative: false, held: true, unknown: true, complete: false, tables: ["posts"] } : { loading: true, unknown: true, tables: ["posts"] };
  for (const online of [true, false]) for (const entries of [[prediction], []]) {
    f.entries = entries; f.env.link = online ? "online" : "offline";
    f.env.post = async () => ({ ok: false });
    const read = await f.read();
    if (available) assert.deepEqual(read.data, [{ id: "own" }]); else assert.deepEqual(read, { loading: true });
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

// Round 5: incomplete execution is not evidence that a later branch was untaken.
for (const unknown of [false, true]) test(`rule 2: a withheld scalar/heap cut preserves skipped static reads (unknown=${unknown})`, async () => {
  const f = routing();
  f.program.body = [{ table: "events" }, { table: "feedFeed" }, { table: "posts" }];
  f.outcome = { loading: true, unknown, complete: false, tables: ["events"] };
  assert.deepEqual(await f.read(), { loading: true });
  assert.equal(f.requests.length, 0, "the cut never established that Following was untaken");
});

for (const value of [null, [], true, false, 0, { online: true }, [null]]) {
  test(`rules 4/5: unknown placeholder ${JSON.stringify(value)} recovers memory, never speculative data`, async () => {
    const f = routing(); f.entries = [];
    f.outcome = { data: value, speculative: true, held: false, unknown: true, complete: false, tables: ["posts"] };
    const online = await f.read(); assert.deepEqual(online.data, ["server"]);
    f.env.link = "offline";
    const stale = await f.read();
    assert.deepEqual(stale.data, online.data); assert.equal(stale.fresh, false); assert.ok(stale.since > 0);
    assert.equal(f.requests.length, 1);
    f.entries = [prediction];
    assert.deepEqual(await f.read(), { loading: true }, "a remembered answer is fenced too");
    f.entries = []; f.env.serverAnswers.clear();
    assert.equal((await f.read()).denied.code, "E_OFFLINE", "no plausible placeholder when memory is absent");
    f.program.held = true;
    assert.deepEqual(await f.read(), { loading: true }, "held cannot recover an external answer");
  });
}

for (const wait of ["recovery", "publication"]) for (const change of ["prediction", "sign-out", "close"]) {
  test(`rule 5: remembered answer rechecks ${change} during ${wait}`, async () => {
    const f = routing(); f.entries = []; await f.read(); f.env.link = "offline";
    let checks = 0, denied = null;
    f.env.unavailable = () => denied;
    f.env.queued = async () => {
      if (++checks >= (wait === "recovery" ? 1 : 2)) {
        if (change === "prediction") return [prediction];
        denied = { code: change === "sign-out" ? "E_AUTH" : "E_CLOSED", family: "auth", message: "ended" };
      }
      return [];
    };
    const answer = await f.read();
    if (change === "prediction") assert.deepEqual(answer, { loading: true });
    else assert.deepEqual(answer, { denied });
    assert.equal(f.requests.length, 1);
  });
}

for (const fail of [false, true]) test(`rule 4: local freshness is decided at publication (transport failure=${fail})`, async () => {
  const f = routing(); f.entries = [];
  f.outcome = { data: [{ id: "held" }], speculative: false, held: true, unknown: true, complete: false, tables: ["posts"] };
  if (fail) f.env.post = async () => { f.env.link = "offline"; return { ok: false }; };
  else f.env.link = "offline";
  const answer = await f.read();
  assert.deepEqual(answer.data, [{ id: "held" }]); assert.equal(answer.complete, false);
  assert.equal(answer.fresh, false); assert.equal(answer.since, 1);
});

for (const reply of [{ denied: { code: "E_BOUND", family: "bound", message: "output ceiling" } },
  { denied: { code: "APP_REFUSAL", family: "application", message: "guard" } }, { loading: true }]) {
  for (const fenced of [false, true]) test(`rule 5: composed ${JSON.stringify(reply)} survives unless fenced (${fenced})`, async () => {
    const f = routing(); f.entries = [];
    f.outcome = { data: { left: [{ id: "held" }], right: [{ id: "partial" }] }, speculative: false, held: true, unknown: true, complete: false, tables: ["posts"],
      components: { left: { retained: true, complete: true }, right: { unknown: true, complete: false } } };
    let delivered = false, checks = 0;
    f.env.post = async () => { delivered = true; return { ok: true, json: reply, obsoleteAuth: false }; };
    f.env.queued = async () => delivered && ++checks >= 2 && fenced ? [prediction] : [];
    const read = await f.read();
    if (fenced) assert.deepEqual(read.data, { left: [{ id: "held" }], right: [{ id: "partial" }] });
    else assert.deepEqual(read, reply);
    assert.equal(f.env.serverAnswers.size, 0, "composed observations never cache whole server answers");
  });
}

for (const reply of [{ loading: true }, { denied: { code: "NO", family: "application", message: "no" } }]) {
  test(`rule 5: authoritative ${JSON.stringify(reply)} retires earlier memory`, async () => {
    const f = routing(); f.entries = []; await f.read();
    f.env.post = async () => ({ ok: true, json: reply, obsoleteAuth: false });
    assert.deepEqual(await f.read(), reply);
    f.env.link = "offline";
    assert.equal((await f.read()).denied.code, "E_OFFLINE");
  });
}

// Round 6: provenance is supplied by the interpreter, never inferred from shape.
for (const value of [[], 0, null, [{ body: "held", at: 1 }]]) {
  test(`rule 4: non-speculative unknown ${JSON.stringify(value)} stays partial without an id`, async () => {
    const f = routing(); f.entries = []; f.env.link = "offline";
    f.outcome = { data: value, unknown: true, complete: false, speculative: false, held: true, tables: ["posts"] };
    assert.deepEqual((await f.read()).data, value);
    assert.equal((await f.read()).complete, false);
    assert.equal(f.requests.length, 0);
  });
}
for (const left of [[], 0]) for (const failed of [false, true]) {
  test(`rule 4: retained ${JSON.stringify(left)} composition survives offline/transport failure=${failed}`, async () => {
    const f = routing(); f.entries = [];
    const data = { left, held: Array.isArray(left) ? [] : null };
    f.outcome = { data, unknown: true, complete: false, speculative: false, held: true, tables: ["posts"],
      components: { left: { retained: true, unknown: false, held: true, speculative: false }, held: { unknown: true, speculative: false, held: false } } };
    f.env.serverAnswers.set(`read:${JSON.stringify(input)}`, { read: { data: "obsolete" }, at: 1, nextExpiry: null, tables: new Set() });
    if (failed) f.env.post = async () => { f.env.link = "offline"; return { ok: false }; }; else f.env.link = "offline";
    const read = await f.read();
    assert.deepEqual(read.data, data); assert.equal(read.complete, false); assert.equal(read.fresh, false);
    assert.equal(f.env.serverAnswers.size, 0, "composition never uses whole-answer memory");
  });
}
for (const held of [false, true]) for (const fenced of [false, true]) {
  test(`rule 4: speculative values with engine held=${held}, fenced=${fenced}`, async () => {
    const f = routing(); f.entries = []; await f.read();
    f.env.link = "offline"; f.entries = fenced ? [prediction] : [];
    f.outcome = { data: [{ body: "local", online: true }], unknown: true, complete: false, speculative: true, held, tables: ["posts"] };
    const read = await f.read();
    if (!fenced) assert.deepEqual(read.data, ["server"]);
    else assert.deepEqual(read, { loading: true });
  });
}
for (const caughtUp of [false, true]) for (const identityChecked of [false, true]) {
  test(`rule 4: online partial freshness requires caughtUp=${caughtUp}, identityChecked=${identityChecked}`, async () => {
    const f = routing(); f.env.caughtUp = caughtUp; f.env.identityChecked = identityChecked;
    f.outcome = { data: [{ body: "own", at: 1 }], unknown: true, complete: false, speculative: false, held: true, tables: ["posts"] };
    const read = await f.read();
    assert.equal(read.fresh, caughtUp && identityChecked);
    if (!read.fresh) assert.equal(read.since, f.env.lastSyncAt);
    assert.equal(f.requests.length, 0);
  });
}
test("rules 4/5: remembered since is the original observation time", async t => {
  let now = 100;
  t.mock.method(Date, "now", () => now);
  const f = routing(); f.entries = [];
  await f.read(); now = 900; f.env.link = "offline";
  const read = await f.read();
  assert.equal(read.fresh, false); assert.equal(read.since, 100);
});
for (const when of ["recovery", "publication"]) {
  test(`rule 5: memory expires at ${when}, with no expired answer or repeated deadline`, async t => {
    let now = 100; t.mock.method(Date, "now", () => now);
    const f = routing(); f.entries = [];
    f.env.post = async () => ({ ok: true, json: { data: ["private"], complete: true, nextExpiry: 200 }, obsoleteAuth: false });
    const initial = await evaluateLocal(f.env, op, input, 0, 0);
    assert.equal(initial.nextExpiry, 200);
    f.env.link = "offline"; now = 150;
    const remembered = await evaluateLocal(f.env, op, input, 0, 0);
    assert.equal(remembered.nextExpiry, 200, "watch must schedule the remembered authorization deadline");
    assert.equal(remembered.read.since, 100);
    let checks = 0;
    if (when === "recovery") now = 200;
    // Offline dispatch, recovery, and final publication each consult the fence.
    else f.env.queued = async () => { if (++checks === 3) now = 200; return []; };
    const expired = await evaluateLocal(f.env, op, input, 0, 0);
    assert.equal(expired.read.denied.code, "E_OFFLINE"); assert.equal(expired.nextExpiry, null);
    assert.equal(f.env.serverAnswers.size, 0);
  });
}

for (const reply of [{ denied: { code: "E_BOUND", family: "bound", message: "ceiling" } }, { loading: true }]) {
  test(`rule 5: expiry does not replace authoritative ${JSON.stringify(reply)}`, async () => {
    const f = routing(); f.entries = [];
    f.env.post = async () => ({ ok: true, json: { ...reply, nextExpiry: 1 }, obsoleteAuth: false });
    assert.deepEqual(await f.read(), reply);
  });
}

// Round 7: unrelated read provenance cannot authorize a speculative refusal.
for (const fenced of [false, true]) test(`rule 4: speculative refusal is a placeholder (fenced=${fenced})`, async () => {
  const f = routing(); f.entries = []; await f.read();
  f.env.link = "offline"; f.entries = fenced ? [prediction] : [];
  f.outcome = { denied: { code: "NOT_FOUND", family: "application", message: "placeholder" }, unknown: true, complete: false, speculative: true, held: true, tables: ["posts"] };
  const read = await f.read();
  if (fenced) assert.deepEqual(read, { loading: true });
  else assert.deepEqual(read.data, ["server"], "a speculative refusal recovers memory like a speculative null");
});

for (const left of [[{ body: "retained" }], [], 0]) for (const fenced of [false, true]) for (const failed of [false, true]) {
  test(`rule 4: retained composition beside speculative null (left=${JSON.stringify(left)}, fenced=${fenced}, failed=${failed})`, async () => {
    const f = routing(); f.entries = fenced ? [prediction] : [];
    const data = { left, right: null };
    f.outcome = { data, unknown: true, complete: false, speculative: true, tables: ["posts"],
      components: { left: { retained: true, unknown: false, speculative: false }, right: { unknown: true, speculative: true } } };
    f.env.serverAnswers.set(`read:${JSON.stringify(input)}`, { read: { data: "obsolete" }, at: 1, nextExpiry: null, tables: new Set() });
    let attempts = 0;
    if (failed) f.env.post = async () => { attempts++; f.env.link = "offline"; return { ok: false }; }; else f.env.link = "offline";
    const read = await f.read();
    assert.deepEqual(read, { loading: true }, "Read<T> cannot publish a missing sibling as T or express component loading");
    assert.equal(attempts, failed && !fenced ? 1 : 0);
    assert.equal(f.env.serverAnswers.size, 0, "independent components never recover whole-answer memory");
  });
}

for (const complete of [false, true]) for (const observing of [false, true]) {
  test(`rules 2/4/5: delayed local data expires and reobserves (complete=${complete}, watch=${observing})`, async t => {
    let now = 100; t.mock.method(Date, "now", () => now);
    const f = routing(); f.env.link = "offline";
    const beforeRows = [{ body: "expired" }, { body: "kept" }], afterRows = [{ body: "kept" }];
    const data = complete ? beforeRows : { left: beforeRows, right: [] };
    const after = complete ? afterRows : { left: afterRows, right: [] };
    const coverage = { unknown: !complete, complete, speculative: false, tables: ["posts"],
      ...(!complete ? { components: { left: { retained: true, unknown: false, speculative: false }, right: { unknown: true, speculative: false } } } : {}) };
    f.outcome = { ...coverage, data, nextExpiry: 200 };
    assert.deepEqual((await f.read()).data, data, "the pre-deadline local value is publishable");
    let release, reached, calls = 0;
    const gate = new Promise(resolve => { release = resolve; });
    const waiting = new Promise(resolve => { reached = resolve; });
    f.env.call = async request => {
      assert.deepEqual(request.args, input);
      if (++calls === 1) {
        assert.equal(request.now, 100); reached(); await gate;
        return { ok: { ...coverage, data, nextExpiry: 200 } };
      }
      assert.equal(request.now, 200);
      return { ok: { ...coverage, data: after, nextExpiry: complete ? null : 300 } };
    };
    const watch = observing ? { dirty: false } : undefined;
    const pending = evaluateLocal(f.env, op, input, 0, 0, watch);
    await waiting; now = 200; release();
    const result = await pending;
    assert.deepEqual(result.read.data, after); assert.equal(result.read.complete, complete);
    assert.equal(result.read.fresh, false);
    assert.equal(result.nextExpiry, complete ? null : 300);
    assert.equal(calls, 2); assert.equal(f.requests.length, 0);
    if (watch) assert.equal(watch.dirty, false, "a successful retry supplies its own next deadline");
  });
}

for (const kind of ["speculative", "unavailable"]) test(`rules 4/5: a withheld local retry keeps its future deadline (${kind})`, async t => {
  let now = 100; t.mock.method(Date, "now", () => now);
  const f = routing(); f.env.link = "offline"; let calls = 0;
  f.env.call = async request => {
    assert.deepEqual(request.args, input);
    if (++calls === 1) {
      assert.equal(request.now, 100); now = 200;
      return { ok: { data: true, unknown: false, complete: true, tables: ["posts"], nextExpiry: 200 } };
    }
    assert.equal(request.now, 200);
    return { ok: { ...(kind === "unavailable" ? { loading: true } : { data: null }),
      unknown: true, complete: false, speculative: kind === "speculative", tables: ["posts"], nextExpiry: 300 } };
  };
  const watch = { dirty: false };
  const result = await evaluateLocal(f.env, op, input, 0, 0, watch);
  assert.deepEqual(result.read, { loading: true });
  assert.equal(result.nextExpiry, 300, "withholding the value must not remove the watch's next wakeup");
  assert.equal(watch.dirty, false); assert.equal(calls, 2); assert.equal(f.requests.length, 0);
});

for (const kind of ["data", "speculative", "unavailable"]) for (const observing of [false, true]) test(`rule 5: a second expired local reply stops and dirties its watch (${kind}, ${observing})`, async t => {
  let now = 100; t.mock.method(Date, "now", () => now);
  const f = routing(); let calls = 0;
  f.env.call = async request => {
    assert.equal(request.now, now);
    const deadline = now + 1; now = deadline;
    assert.ok(++calls <= 2, "expiry retry is bounded to one extra device call");
    const second = calls === 2;
    return { ok: { ...(second && kind === "unavailable" ? { loading: true } : { data: ["expired"] }),
      unknown: second && kind !== "data", complete: !second || kind === "data",
      speculative: second && kind === "speculative", tables: ["posts"], nextExpiry: deadline } };
  };
  const watch = observing ? { dirty: false } : undefined;
  const result = await evaluateLocal(f.env, op, input, 0, 0, watch);
  assert.deepEqual(result.read, { loading: true }); assert.equal(result.nextExpiry, null);
  assert.equal(calls, 2); assert.equal(f.requests.length, 0);
  if (watch) assert.equal(watch.dirty, true, "rerun finally must schedule another observation instead of leaving loading idle");
});

for (const transition of ["sign-out", "close", "incarnation"]) {
  test(`rules 1/5: ${transition} during local expiry retry still fences publication`, async t => {
    let now = 100; t.mock.method(Date, "now", () => now);
    const f = routing(); let calls = 0;
    f.env.call = async () => {
      if (++calls === 1) now = 200;
      else if (transition === "incarnation") f.env.incarnation++;
      else f.env.unavailable = () => ({ code: transition === "close" ? "E_CLOSED" : "E_AUTH", family: "session", message: transition });
      return { ok: { data: ["private"], unknown: false, complete: true, tables: ["posts"], nextExpiry: calls === 1 ? 200 : null } };
    };
    const read = await f.read();
    assert.equal(calls, 2);
    if (transition === "incarnation") assert.deepEqual(read, { loading: true });
    else assert.equal(read.denied.code, transition === "close" ? "E_CLOSED" : "E_AUTH");
    assert.equal("data" in read, false);
  });
}

for (const composed of [false, true]) for (const boundary of ["transport", "publication"]) {
  test(`rule 5: delayed ${composed ? "composed" : "server"} data expires during ${boundary}`, async t => {
    let now = 100; t.mock.method(Date, "now", () => now);
    const f = routing(); f.entries = [];
    if (composed) f.outcome = { data: { left: [{ body: "retained" }], right: null }, unknown: true, complete: false, speculative: true, tables: ["posts"],
      components: { left: { retained: true, unknown: false, speculative: false }, right: { unknown: true, speculative: true } } };
    let release, reached;
    const gate = new Promise(resolve => { release = resolve; });
    const waiting = new Promise(resolve => { reached = resolve; });
    let delivered = false, checks = 0, calls = 0;
    f.env.post = async () => {
      if (boundary === "transport") { reached(); await gate; }
      delivered = true;
      return { ok: true, json: { data: composed ? { left: [], right: { body: "private" } } : [{ body: "private" }], complete: true, nextExpiry: 200 }, obsoleteAuth: false };
    };
    // Server: delivery + final check. Composition also gates after reobservation.
    f.env.queued = async () => {
      if (boundary === "publication" && delivered && ++checks === (composed ? 3 : 2)) { reached(); await gate; }
      return [];
    };
    const call = f.env.call; f.env.call = async (...args) => { calls++; return call(...args); };
    const pending = evaluateLocal(f.env, op, input, 0, 0);
    await waiting; now = 200; release();
    const result = await pending;
    assert.deepEqual(result.read, { loading: true }); assert.equal(result.nextExpiry, null);
    assert.equal(f.env.serverAnswers.size, 0, "an expired response never becomes remembered data");
    assert.equal(calls, composed ? 2 : 1, "exercise the composed publication candidate, not just server routing");
  });
}


// Round 10: an expiry retry is a new observation, not a publication shortcut.
function expiryRetry(t, outcome) {
  let now = 100, calls = 0;
  t.mock.method(Date, "now", () => now);
  const f = routing(); f.entries = [];
  f.env.call = async request => {
    assert.deepEqual(request.args, input, "retry/fallback must keep the original cursor");
    if (++calls === 1) {
      assert.equal(request.now, 100); now = 200;
      return { ok: { data: ["expired"], unknown: false, complete: true, tables: ["posts"], nextExpiry: 200 } };
    }
    assert.equal(request.now, 200);
    return { ok: outcome };
  };
  return { f, calls: () => calls };
}
const retryWatch = () => ({ dirty: false, fetch: work => work() });
const unknownRetry = (speculative = false) => ({ data: ["retry"], unknown: true, complete: false, speculative, tables: ["posts"], nextExpiry: null });
for (const speculative of [false, true]) for (const observing of [false, true]) {
  test(`rules 3/4/5: online unknown expiry retry takes fallback (speculative=${speculative}, watch=${observing})`, async t => {
    const { f, calls } = expiryRetry(t, unknownRetry(speculative));
    const watch = observing ? retryWatch() : undefined;
    const result = await evaluateLocal(f.env, op, input, 0, 0, watch);
    assert.deepEqual(result.read.data, ["server"], "neither the expired snapshot nor the unknown retry may bypass fallback");
    assert.equal(result.read.complete, true); assert.equal(result.read.fresh, true);
    assert.equal(calls(), 2); assert.deepEqual(f.requests, [{ path: "/q/read", body: { args: input } }]);
    if (watch) assert.equal(watch.dirty, false, "the idle watch is answered by the fallback");
    assert.deepEqual(f.env.serverAnswers.get(`read:${JSON.stringify(input)}`).read.data, ["server"]);
  });
}
for (const deadline of [null, 300, 200]) for (const observing of [false, true]) {
  test(`rules 4/5: offline speculative expiry retry recovers independent memory (deadline=${deadline}, watch=${observing})`, async t => {
    const { f, calls } = expiryRetry(t, unknownRetry(true)); f.env.link = "offline";
    const key = `read:${JSON.stringify(input)}`;
    const remembered = { read: { data: ["remembered"], complete: true, fresh: true, cut: null, next: "remembered-cursor" }, at: 50, nextExpiry: deadline, tables: new Set(["posts"]) };
    f.env.serverAnswers.set(key, remembered);
    const watch = observing ? retryWatch() : undefined;
    const result = await evaluateLocal(f.env, op, input, 0, 0, watch);
    if (deadline === 200) {
      assert.deepEqual(result.read, observing ? { loading: true } : { denied: f.env.offline() });
      assert.equal(f.env.serverAnswers.size, 0);
    } else {
      assert.deepEqual(result.read.data, ["remembered"]);
      assert.equal(result.read.fresh, false); assert.equal(result.read.since, 50);
      assert.equal(result.read.next, "remembered-cursor"); assert.equal(result.nextExpiry, deadline);
      assert.equal(f.env.serverAnswers.get(key), remembered, "local expiry must not retire independent unexpired memory");
    }
    assert.equal(calls(), 2); assert.equal(f.requests.length, 0);
  });
}
for (const state of ["offline", "prediction", "held", "transport failure"]) {
  test(`rules 3/4: expiry retry respects ${state}`, async t => {
    const { f, calls } = expiryRetry(t, { ...unknownRetry(), nextExpiry: 300 });
    if (state === "offline") f.env.link = "offline";
    if (state === "prediction") f.entries = [prediction];
    if (state === "held") f.program.held = true;
    let posts = 0;
    if (state === "transport failure") f.env.post = async () => { posts++; f.env.link = "offline"; return { ok: false }; };
    const result = await evaluateLocal(f.env, op, input, 0, 0);
    assert.deepEqual(result.read.data, ["retry"]); assert.equal(result.read.complete, false);
    assert.equal(result.read.fresh, state === "prediction" || state === "held");
    assert.equal(result.nextExpiry, 300); assert.equal(calls(), 2);
    assert.equal(posts, state === "transport failure" ? 1 : 0); assert.equal(f.requests.length, 0);
  });
}
test("rules 4/5: expiry retry composes retained rows with its server answer", async t => {
  const localData = { left: ["retained"], right: [] };
  const { f, calls } = expiryRetry(t, { ...unknownRetry(), data: localData,
    components: { left: { retained: true, unknown: false, complete: false, speculative: false }, right: { unknown: true, speculative: false } } });
  let posts = 0;
  f.env.post = async (path, body) => {
    assert.equal(path, "/q/read"); assert.deepEqual(body.args, input); posts++;
    return { ok: true, obsoleteAuth: false, json: { data: { left: [], right: ["server"] }, complete: true } };
  };
  const result = await evaluateLocal(f.env, op, input, 0, 0);
  assert.deepEqual(result.read.data, { left: ["retained"], right: ["server"] });
  assert.equal(result.read.complete, false); assert.equal(result.read.fresh, false);
  assert.equal(posts, 1); assert.equal(calls(), 3, "one expiry retry plus the ordinary post-server composition observation");
  assert.equal(f.env.serverAnswers.size, 0);
});
for (const speculative of [false, true]) {
  test(`rule 5: expiry fallback rechecks predictions at final publication (speculative=${speculative})`, async t => {
    const { f } = expiryRetry(t, { ...unknownRetry(speculative), nextExpiry: 300 });
    let delivered = false, checks = 0;
    const post = f.env.post;
    f.env.post = async (...args) => { const reply = await post(...args); delivered = true; return reply; };
    f.env.queued = async () => delivered && ++checks === 2 ? [prediction] : [];
    const result = await evaluateLocal(f.env, op, input, 0, 0);
    if (speculative) assert.deepEqual(result.read, { loading: true });
    else assert.deepEqual(result.read.data, ["retry"]);
    assert.equal(f.requests.length, 1); assert.equal(checks, 2);
    assert.equal(result.nextExpiry, 300); assert.equal(f.env.serverAnswers.size, 0);
  });
}
test("rule 5: an expired retry server answer dirties the watch without retiring valid memory", async t => {
  const { f, calls } = expiryRetry(t, unknownRetry());
  const key = `read:${JSON.stringify(input)}`;
  const remembered = { read: { data: ["still valid"] }, at: 50, nextExpiry: null, tables: new Set(["posts"]) };
  f.env.serverAnswers.set(key, remembered);
  f.env.post = async () => ({ ok: true, obsoleteAuth: false, json: { data: ["expired server"], complete: true, nextExpiry: 200 } });
  const watch = retryWatch();
  const result = await evaluateLocal(f.env, op, input, 0, 0, watch);
  assert.deepEqual(result.read, { loading: true }); assert.equal(result.nextExpiry, null);
  assert.equal(watch.dirty, true); assert.equal(calls(), 2);
  assert.equal(f.env.serverAnswers.get(key), remembered);
});

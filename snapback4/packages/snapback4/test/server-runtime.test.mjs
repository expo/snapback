import { withHangGuard, hangBudget } from './helpers/wait.mjs';
import { readyRead } from "../dist/read-existence.js";
// Protocol doubles: the core/CLI suite separately proves durable HTTP behavior.
import test from "node:test";
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { spawnSync } from "node:child_process";
import { setTimeout as delay } from "node:timers/promises";
import { startServer, ParkStep, ServerError } from "../dist/server.js";
import { runWorker, GiveUp } from "../dist/worker.js";

const query = name => ({ name, kind: "query" });
const mutation = name => ({ name, kind: "mutation" });
const manifest = (name = "work", secrets = []) => ({ actions: { [name]: { contract: "contract-v1", secrets } }, effects: {} });
const claim = (extra = {}) => ({ id: "invocation-1", action: "work", principal: "member:alice", attempt: 1, at: 0,
  contract: "contract-v1", deadline: null, args: {}, session: { token: "claim-token", principal: "member:alice", kind: "action", expiresAt: Date.now() + 60_000 }, ...extra });

async function invoke(handler, options = {}) {
  const request = claim(options.claim);
  const stop = new AbortController();
  const requests = [], errors = [];
  let claimed = false, settled, ctx;
  const worker = startServer(options.manifest ?? manifest(request.action, options.secrets), { actions: { [request.action]: async (args, context) => { ctx = context; return handler(args, context); } } }, {
    env: { SNAPBACK_URL: "http://runtime.test", SNAPBACK_SERVICE_TOKEN: "service-token", ...options.env },
    signal: stop.signal, onError: error => errors.push(error), statusIntervalMs: options.statusIntervalMs ?? 10,
    fetch: async (url, init) => {
      const path = new URL(url).pathname;
      const body = JSON.parse(init.body);
      requests.push({ path, body, headers: init.headers });
      if (path === "/actions/claim-set") {
        assert.deepEqual(body.actions, [request.action]);
        if (!claimed) { claimed = true; return Response.json({ requests: [request], worker: "service:worker" }); }
        throw Error("test expected one claim");
      }
      assert.equal(init.headers["x-snapback-action-lease"], path.startsWith("/actions/") ? request.session.token : undefined);
      assert.equal(init.headers.authorization, path.startsWith("/actions/") ? "Bearer service-token" : "Bearer claim-token");
      if (path === `/actions/${request.id}/done` || path === `/actions/${request.id}/failed`) {
        settled = { path, body };
        stop.abort();
        if (options.settlementLost) throw Error("lost action settlement acknowledgement");
        return Response.json({ ok: true });
      }
      const response = options.wire ? await options.wire(path, body, init, request) : undefined;
      if (response !== undefined) return response instanceof Response ? response : Response.json(response);
      if (path.endsWith("/status")) return Response.json({ invocation: { id: request.id, attempt: request.attempt, deadline: request.deadline, cancelled: false, state: "running" } });
      throw Error(`unexpected wire request: ${path}`);
    },
  });
  try {
    await withHangGuard(() => worker.done, "runtime worker finishes");
  } finally { stop.abort(); }
  return { settled, requests, errors, context: ctx };
}

function stepStore({ loseDone = false } = {}) {
  const records = new Map();
  return { records, wire(path, body, init, request) {
    const match = path.match(/\/steps\/([^/]+)\/(begin|done|park)$/);
    if (!match) return;
    const name = decodeURIComponent(match[1]), verb = match[2];
    const record = records.get(name);
    if (verb === "begin") {
      const input = JSON.stringify(body.input);
      if (record && record.input !== input) return { denied: { code: "E_STEP_INPUT", family: "action", message: "changed step input" } };
      if (record?.state === "done") return { step: { state: "done", key: record.key, result: record.result } };
      if (record?.state === "parked" || (record && !body.reconcile)) {
        record.state = "parked";
        return { denied: { code: "E_STEP_PARKED", family: "action", message: "uncertain step parked" } };
      }
      if (record?.attempt === request.attempt) return { denied: { code: "E_STEP_BUSY", family: "action", message: "step already started in this attempt" } };
      const next = record ?? { key: `provider:${request.id}:${name}`, input, state: "started" };
      next.attempt = request.attempt;
      records.set(name, next);
      return { step: { state: record ? "reconcile" : "run", key: next.key } };
    }
    assert.ok(record);
    if (verb === "park") { record.state = "parked"; return { ok: true }; }
    record.state = "done";
    record.result = body.result;
    if (loseDone) { loseDone = false; throw Error("lost step settlement acknowledgement"); }
    return { ok: true };
  } };
}

test("generated registry rejects missing, extra and inherited actions before any claim", () => {
  const options = { url: "http://runtime.test", token: "token", fetch: () => { throw Error("must not fetch"); } };
  for (const actions of [{}, { work() {}, extra() {} }, Object.create({ work() {} })]) {
    assert.throws(() => startServer(manifest(), { actions }, options), error => error.refusal.code === "E_SERVER_HANDLERS");
  }
  assert.throws(() => startServer(manifest(), { actions: { work() {} }, effects: { undeclared() {} } }, options), /E_SERVER_HANDLERS/);
  assert.throws(() => startServer(manifest(), { actions: { work() {} } }, { env: {} }), /E_SERVER_CONFIG/);
});

test("declared registry and durable step names are safe for Object prototype keys", async () => {
  for (const name of ["__proto__", "constructor", "toString"]) {
    const store = stepStore();
    const result = await invoke(async (_, ctx) => ctx.step(name, { n: 1 }, () => ({ ok: true })), { claim: { action: name }, wire: store.wire });
    assert.deepEqual(result.settled.body, { result: { ok: true } });
    assert.equal(store.records.get(name).state, "done");
  }
});

test("generation mismatch fails before handler or secret access", async () => {
  let called = false;
  const result = await invoke(() => { called = true; }, { claim: { contract: "other" }, secrets: ["MISSING"] });
  assert.equal(called, false);
  assert.equal(result.settled.body.code, "E_ACTION_GENERATION");
  assert.equal(result.settled.body.retry, false);
  assert.deepEqual(result.requests.map(r => r.path), ["/actions/claim-set", "/actions/invocation-1/failed"]);
});

test("ordinary ServerContext exposes no private identity mint authority", async () => {
  const result = await invoke((_, ctx) => ({
    keys: Object.keys(ctx).sort(),
    mint: "mint" in ctx,
    identityRuntime: "identityRuntime" in ctx,
    actionLease: "actionLease" in ctx.invocation,
  }));
  assert.deepEqual(result.settled.body.result, {
    keys: ["invocation", "mutate", "principal", "query", "secrets", "step", "writeIdFor"],
    mint: false,
    identityRuntime: false,
    actionLease: false,
  });
});

test("query and mutation preserve card receipts and use the delegated session", async () => {
  const expectedMeter = { cut: "meter", examined: 2, indexEntries: 3, probes: 1, steps: 10, heapBytes: 80, outputBytes: 12, rowsWritten: 0 };
  const result = await invoke(async (_, ctx) => {
    assert.equal(ctx.principal, "member:alice");
    const read = await ctx.query(query("documents.at"), { revision: 3 });
    assert.deepEqual(read, readyRead({ data: { text: "hello" }, complete: false, cut: "meter", fresh: true, next: "cursor", meter: expectedMeter }));
    const saved = await ctx.mutate(mutation("summaries.save"), { text: "summary" }, { id: ctx.writeIdFor("save") });
    assert.equal(saved.replayed, true);
    assert.equal(Object.hasOwn(saved, "result"), false);
    assert.deepEqual(await ctx.query(query("denied"), {}), { denied: { code: "E_RULE", family: "rule", message: "denied" } });
    return { seq: saved.seq };
  }, { wire(path, body) {
    if (path === "/q/documents.at") return { data: { text: "hello" }, complete: false, cut: "meter", next: "cursor", meter: expectedMeter };
    if (path === "/q/denied") return { denied: { code: "E_RULE", family: "rule", message: "denied" } };
    if (path === "/m/summaries.save") return { state: "sent", id: body.id, seq: 12, replayed: true, result: { must: "not survive" } };
  } });
  assert.deepEqual(result.settled.body, { result: { seq: 12 } });
});

test("writeIdFor is a deterministic 128-bit Crockford identity across attempts", async () => {
  const ids = [];
  for (const attempt of [1, 7]) {
    const result = await invoke((_, ctx) => {
      const id = ctx.writeIdFor("save");
      assert.match(id, /^[0-7][0-9A-HJKMNP-TV-Z]{25}$/);
      assert.notEqual(id, ctx.writeIdFor("elsewhere"));
      for (const bad of ["", "x".repeat(129), "line\nbreak", "😀"]) assert.throws(() => ctx.writeIdFor(bad), /E_WRITE_LABEL/);
      return { id };
    }, { claim: { attempt } });
    ids.push(result.settled.body.result.id);
  }
  assert.equal(ids[0], ids[1]);
  const digest = createHash("sha256").update('["snapback4:write:v1","invocation-1","save"]').digest("hex").slice(0, 32);
  let decoded = 0n;
  for (const digit of ids[0]) decoded = decoded * 32n + BigInt("0123456789ABCDEFGHJKMNPQRSTVWXYZ".indexOf(digit));
  assert.equal(decoded.toString(16).padStart(32, "0"), digest);
});

test("step records before I/O, coalesces concurrent calls and snapshots completed results", async () => {
  const store = stepStore();
  let calls = 0;
  const result = await invoke(async (_, ctx) => {
    const run = async key => { calls++; assert.equal(store.records.get("provider").state, "started"); await delay(3); return { key, items: [1] }; };
    const a = ctx.step("provider", { b: 2, a: 1 }, run);
    const b = ctx.step("provider", { a: 1, b: 2 }, run);
    const [first, second] = await Promise.all([a, b]);
    assert.deepEqual(first, second);
    first.items.push(2);
    assert.deepEqual((await ctx.step("provider", { a: 1, b: 2 }, run)).items, [1]);
    await assert.rejects(ctx.step("provider", { a: 2, b: 2 }, run), /E_STEP_INPUT/);
    return second;
  }, { wire: store.wire });
  assert.equal(calls, 1);
  assert.equal(result.requests.filter(r => r.path.endsWith("/begin")).length, 1);
  assert.deepEqual(result.settled.body.result.items, [1]);
});

test("recorded outcome survives a lost acknowledgement without repeating the provider", async () => {
  const store = stepStore({ loseDone: true });
  let calls = 0;
  const handler = (_, ctx) => ctx.step("provider", { revision: 1 }, () => { calls++; return { externalId: "mail-1" }; });
  const first = await invoke(handler, { wire: store.wire });
  assert.equal(first.settled.body.retry, true);
  const next = await invoke(handler, { claim: { attempt: 2 }, wire: store.wire });
  assert.deepEqual(next.settled.body, { result: { externalId: "mail-1" } });
  assert.equal(calls, 1);
  assert.equal(next.requests.filter(r => r.path.endsWith("/steps/provider/done")).length, 0);
});

test("lost action settlement does not run the handler twice in one claim", async () => {
  let called = 0;
  const result = await invoke(() => { called++; return { ok: true }; }, { settlementLost: true });
  assert.equal(called, 1);
  assert.equal(result.requests.filter(r => /\/(done|failed)$/.test(r.path)).length, 1);
});

test("unrecorded provider acceptance reconciles through the same key", async () => {
  const store = stepStore(), provider = new Map();
  let calls = 0, reconciles = 0;
  const handler = (_, ctx) => ctx.step("mail", { email: "alice@example.test" }, key => {
    calls++;
    provider.set(key, { message: "accepted" });
    throw Error("worker lost connection after provider acceptance");
  }, { reconcile(key) { reconciles++; assert.ok(provider.has(key)); return provider.get(key); } });
  assert.equal((await invoke(handler, { wire: store.wire })).settled.body.retry, true);
  assert.deepEqual((await invoke(handler, { claim: { attempt: 2 }, wire: store.wire })).settled.body, { result: { message: "accepted" } });
  assert.equal(calls, 1);
  assert.equal(reconciles, 1);
});

test("an uncertain provider without reconciliation parks instead of rerunning", async () => {
  const store = stepStore();
  let calls = 0;
  const handler = (_, ctx) => ctx.step("mail", {}, () => { calls++; throw Error("unknown provider outcome"); });
  await invoke(handler, { wire: store.wire });
  const result = await invoke(handler, { claim: { attempt: 2 }, wire: store.wire });
  assert.equal(result.settled.body.code, "E_STEP_PARKED");
  assert.equal(result.settled.body.retry, false);
  assert.equal(calls, 1);
});

for (const ErrorType of [ParkStep, GiveUp]) test(`unresolved reconciliation with ${ErrorType.name} durably parks`, async () => {
  const store = stepStore();
  const handler = (_, ctx) => ctx.step("mail", {}, () => { throw Error("provider result uncertain"); }, { reconcile() { throw new ErrorType("cannot establish provider outcome"); } });
  await invoke(handler, { wire: store.wire });
  const result = await invoke(handler, { claim: { attempt: 2 }, wire: store.wire });
  assert.equal(store.records.get("mail").state, "parked");
  assert.equal(result.settled.body.code, "E_STEP_PARKED");
  assert.equal(result.requests.filter(r => r.path.endsWith("/park")).length, 1);
});

test("changed input after restart refuses before any provider call", async () => {
  const store = stepStore();
  await invoke((_, ctx) => ctx.step("mail", { n: 1 }, () => "done"), { wire: store.wire });
  let called = false;
  const result = await invoke((_, ctx) => ctx.step("mail", { n: 2 }, () => { called = true; }), { claim: { attempt: 2 }, wire: store.wire });
  assert.equal(called, false);
  assert.equal(result.settled.body.code, "E_STEP_INPUT");
});

test("an uncertain begin is never retried locally, even if application catches it", async () => {
  let began = 0, called = 0;
  const result = await invoke(async (_, ctx) => {
    for (let i = 0; i < 2; i++) await assert.rejects(ctx.step("mail", {}, () => { called++; }), /lost begin response/);
    return { ok: true };
  }, { wire(path) { if (path.endsWith("/begin")) { began++; throw Error("lost begin response"); } } });
  assert.equal(began, 1);
  assert.equal(called, 0);
  assert.deepEqual(result.settled.body, { result: { ok: true } });
});

test("strict JSON refuses coercions and cycles before step admission or provider I/O", async () => {
  const cyclic = {}; cyclic.self = cyclic;
  let getterCalls = 0;
  const getter = { get value() { getterCalls++; return 1; } };
  const nonEnumerable = Object.defineProperty({}, "n", { value: 1 });
  const cases = [undefined, { missing: undefined }, [undefined], Array(1), NaN, Infinity, 1n, cyclic, new Date(), new Map(), () => {}, Symbol("x"), getter, nonEnumerable, { [Symbol("x")]: 1 }, { toJSON() { throw Error("do not call"); } }, "x".repeat(1_048_577)];
  const result = await invoke(async (_, ctx) => {
    for (const [i, input] of cases.entries()) await assert.rejects(ctx.step(`case-${i}`, input, () => { throw Error("provider must not run"); }), /E_STEP_INPUT/);
    return { checked: cases.length };
  });
  assert.equal(getterCalls, 0);
  assert.equal(result.requests.some(r => r.path.includes("/steps/")), false);
  assert.equal(result.settled.body.result.checked, cases.length);
});

test("invalid step result fails terminally and is not silently coerced", async () => {
  const store = stepStore();
  let calls = 0;
  const result = await invoke((_, ctx) => ctx.step("mail", {}, () => { calls++; return { amount: Infinity }; }), { wire: store.wire });
  assert.equal(calls, 1);
  assert.equal(result.settled.body.code, "E_STEP_RESULT");
  assert.equal(result.settled.body.retry, false);
  assert.equal(store.records.get("mail").state, "started");
  assert.equal(result.requests.some(r => r.path.endsWith("/steps/mail/done")), false);
});

test("missing step acknowledgement keeps the outcome uncertain", async () => {
  const store = stepStore();
  const result = await invoke((_, ctx) => ctx.step("mail", {}, () => "sent"), { wire(path, body, init, request) {
    if (path.endsWith("/steps/mail/done")) return {};
    return store.wire(path, body, init, request);
  } });
  assert.equal(result.settled.body.retry, true);
  assert.equal(store.records.get("mail").state, "started");
});

for (const value of [undefined, { n: NaN }, { missing: undefined }, "x".repeat(1_048_577)]) test(`invalid action result is terminal (${typeof value})`, async () => {
  const result = await invoke(() => value);
  assert.equal(result.settled.body.code, "E_ACTION_RESULT");
  assert.equal(result.settled.body.retry, false);
  assert.match(result.settled.path, /\/failed$/);
});

test("secrets are a frozen declared own-map and are redacted in recorded failures", async () => {
  const secret = 'private"key\nwith-specials';
  const result = await invoke((_, ctx) => {
    assert.equal(Object.getPrototypeOf(ctx.secrets), null);
    assert.equal(Object.isFrozen(ctx.secrets), true);
    assert.deepEqual(Object.keys(ctx.secrets), ["MAIL_KEY"]);
    assert.equal(ctx.secrets.UNRELATED, undefined);
    assert.equal(ctx.secrets.MAIL_KEY, secret);
    throw Error(`provider leaked ${secret}; escaped ${JSON.stringify(secret)}; delegated claim-token`);
  }, { secrets: ["MAIL_KEY"], env: { MAIL_KEY: secret, UNRELATED: "another-private-value" } });
  const body = result.settled.body;
  assert.equal(body.retry, true);
  assert.match(body.error, /\[REDACTED\]/);
  assert.equal(body.error.includes(secret), false);
  assert.equal(body.error.includes(JSON.stringify(secret).slice(1, -1)), false);
  assert.equal(body.error.includes("claim-token"), false);
  for (const request of result.requests) assert.equal(JSON.stringify(request.body).includes("another-private-value"), false);
});

for (const value of [undefined, ""]) test(`missing or empty declared secret is a typed terminal refusal (${String(value)})`, async () => {
  let called = false;
  const result = await invoke(() => { called = true; return null; }, { secrets: ["MAIL_KEY"], env: { MAIL_KEY: value } });
  assert.equal(called, false);
  assert.equal(result.settled.body.code, "E_SECRET_MISSING");
  assert.equal(result.settled.body.retry, false);
});

test("cancellation aborts the signal, fences late database calls and stops polling", async () => {
  const result = await invoke(async (_, ctx) => {
    await new Promise(resolve => ctx.invocation.signal.addEventListener("abort", resolve, { once: true }));
    assert.equal(ctx.invocation.cancelled, true);
    const write = await ctx.mutate(mutation("save"), {}, { id: "00000000000000000000000000" });
    assert.equal(write.why.code, "E_ACTION_CANCELLED");
    assert.equal((await ctx.query(query("read"), {})).denied.code, "E_ACTION_CANCELLED");
    await assert.rejects(ctx.step("too-late", {}, () => "never"), /E_ACTION_CANCELLED/);
    throw new ServerError("E_ACTION_CANCELLED", "the action was cancelled");
  }, { wire(path, body, init, request) { if (path.endsWith("/status")) return { invocation: { id: request.id, attempt: request.attempt, deadline: null, cancelled: true, state: "failed" } }; } });
  const requests = result.requests.length;
  await delay(35);
  assert.equal(result.requests.length, requests);
  assert.equal(result.requests.some(r => r.path.startsWith("/m/") || r.path.startsWith("/q/")), false);
  assert.equal(result.settled.body.code, "E_ACTION_CANCELLED");
});

test("an actual Node worker stays alive when its handler awaits only cancellation", () => {
  const module = new URL("../dist/server.js", import.meta.url).href;
  const child = spawnSync(process.execPath, ["--input-type=module", "-e", `
    import assert from "node:assert/strict";
    import { startServer } from ${JSON.stringify(module)};
    const stop = new AbortController();
    const request = ${JSON.stringify(claim())};
    const worker = startServer(${JSON.stringify(manifest())}, { actions: { async work(_, ctx) {
      await new Promise(resolve => ctx.invocation.signal.addEventListener("abort", resolve, { once: true }));
      assert.equal(ctx.invocation.cancelled, true);
      return {};
    } } }, { url: "http://runtime.test", token: "service-token", signal: stop.signal, statusIntervalMs: 10,
      fetch: async (url, init) => {
        if (url.endsWith("/claim-set")) return Response.json({ requests: [request] });
        if (url.endsWith("/status")) return Response.json({ invocation: { id: request.id, attempt: request.attempt, cancelled: true, state: "failed" } });
        assert.ok(url.endsWith("/failed"));
        assert.equal(JSON.parse(init.body).code, "E_ACTION_CANCELLED");
        stop.abort();
        return Response.json({ ok: true });
      },
    });
    // Deliberately no parent-test timeout/keepalive inside this process.
    await worker.done;
    process.stdout.write("cancelled and settled");
  `], { encoding: "utf8", timeout: hangBudget() });
  assert.equal(child.status, 0, child.stderr || String(child.error));
  assert.equal(child.stdout, "cancelled and settled");
});

test("a deadline aborts cooperatively without waiting for status polling", async () => {
  const result = await invoke(async (_, ctx) => {
    await new Promise(resolve => ctx.invocation.signal.addEventListener("abort", resolve, { once: true }));
    assert.equal(ctx.invocation.cancelled, false);
    return { code: (await ctx.query(query("late"), {})).denied.code };
  }, { claim: { deadline: Date.now() + 25 }, statusIntervalMs: 1000 });
  assert.equal(result.settled.body.code, "E_ACTION_DEADLINE");
  assert.equal(result.settled.body.retry, false);
  assert.equal(result.requests.some(r => r.path.endsWith("/status")), false);
});

test("a claim past its deadline never enters the handler", async () => {
  let calls = 0;
  const result = await invoke(() => { calls++; return null; }, { claim: { deadline: Date.now() - 1 } });
  assert.equal(calls, 0);
  assert.equal(result.settled.body.code, "E_ACTION_DEADLINE");
});

for (const offset of [-3_600_000, 3_600_000]) test(`deadline uses the server clock plus monotonic elapsed time (${offset})`, async () => {
  let entered = false;
  const now = Date.now() + offset;
  const result = await invoke(async (_, ctx) => {
    entered = true;
    assert.equal(ctx.invocation.deadline, now + 25);
    await new Promise(resolve => ctx.invocation.signal.addEventListener("abort", resolve, { once: true }));
    return null;
  }, { claim: { now, deadline: now + 25 }, statusIntervalMs: 1000 });
  assert.equal(entered, true);
  assert.equal(result.settled.body.code, "E_ACTION_DEADLINE");
  assert.equal(result.requests.some(request => request.path.endsWith("/status")), false);
});

test("retryable step admission remains a retryable worker failure", async () => {
  const result = await invoke((_, ctx) => ctx.step("mail", {}, () => { throw Error("provider must not run"); }), { wire(path) {
    if (path.endsWith("/begin")) return { denied: { code: "E_BUSY", family: "store", message: "retry this request", retryable: true } };
  } });
  assert.equal(result.settled.body.retry, true);
});

test("a pending transport outcome remains uncertain when its context later aborts", async () => {
  let write;
  const result = await invoke(async (_, ctx) => {
    write = await ctx.mutate(mutation("save"), {}, { id: ctx.writeIdFor("save") });
    assert.equal(write.state, "pending");
    await new Promise(resolve => ctx.invocation.signal.addEventListener("abort", resolve, { once: true }));
    assert.equal(write.state, "pending");
    return null;
  }, { wire(path, body, init, request) {
    if (path.startsWith("/m/")) throw Error("write acknowledgement lost");
    if (path.endsWith("/status")) return { invocation: { id: request.id, attempt: request.attempt, cancelled: true, state: "failed" } };
  } });
  assert.equal(write.state, "pending");
  assert.equal(result.settled.body.code, "E_ACTION_CANCELLED");
});

test("lease refusal from status aborts context authority", async () => {
  const result = await invoke(async (_, ctx) => {
    await new Promise(resolve => ctx.invocation.signal.addEventListener("abort", resolve, { once: true }));
    return { code: (await ctx.query(query("late"), {})).denied.code };
  }, { wire(path) { if (path.endsWith("/status")) return { denied: { code: "E_ACTION_LEASE", family: "action", message: "lease lost" } }; } });
  assert.equal(result.settled.body.code, "E_ACTION_LEASE");
  assert.equal(result.settled.body.retry, false);
});

test("unreachable status aborts the context with a retryable outcome", async () => {
  const result = await invoke(async (_, ctx) => {
    await new Promise(resolve => ctx.invocation.signal.addEventListener("abort", resolve, { once: true }));
    const read = await ctx.query(query("late"), {});
    assert.equal(read.denied.code, "E_OFFLINE");
    assert.equal(read.denied.retryable, true);
    throw ctx.invocation.signal.reason;
  }, { wire(path) { if (path.endsWith("/status")) throw Error("status transport lost"); } });
  assert.equal(result.settled.body.retry, true);
  assert.equal(result.requests.some(r => r.path.startsWith("/q/")), false);
});

test("handler completion aborts a hung status fetch and closes retained contexts", async () => {
  let release, statusSignal;
  const statusStarted = new Promise(resolve => { release = resolve; });
  const result = await invoke(async () => { await statusStarted; return { ok: true }; }, { wire(path, body, init) {
    if (path.endsWith("/status")) { statusSignal = init.signal; release(); return new Promise(() => {}); }
  } });
  assert.equal(statusSignal.aborted, true);
  assert.equal(result.context.invocation.signal.aborted, true);
  assert.equal((await result.context.mutate(mutation("late"), {})).why.code, "E_ACTION_CLOSED");
  const count = result.requests.length;
  await delay(35);
  assert.equal(result.requests.length, count);
});

test("handler completion releases a hung status response body", async () => {
  let release, statusSignal;
  const statusStarted = new Promise(resolve => { release = resolve; });
  const result = await invoke(async () => { await statusStarted; return { ok: true }; }, { wire(path, body, init) {
    if (path.endsWith("/status")) {
      statusSignal = init.signal;
      const response = Response.json({});
      response.json = () => { release(); return new Promise(() => {}); };
      return response;
    }
  } });
  assert.equal(statusSignal.aborted, true);
  assert.deepEqual(result.settled.body, { result: { ok: true } });
});

test("legacy workers keep optional metadata, undefined result coercion and own handler lookup", async () => {
  const stop = new AbortController();
  const requests = [];
  let calls = 0;
  const worker = runWorker({ url: "http://runtime.test", token: "service-token", signal: stop.signal,
    actions: { work(args, meta) { calls++; assert.equal(meta.contract, undefined); assert.equal(meta.deadline, undefined); return undefined; } },
    fetch: async (url, init) => {
      const body = JSON.parse(init.body); requests.push({ url, body });
      if (url.endsWith("/claim")) { const request = claim(); delete request.contract; delete request.deadline; return Response.json({ requests: [request] }); }
      stop.abort(); return Response.json({ ok: true });
    },
  });
  await worker.done;
  assert.equal(calls, 1);
  assert.deepEqual(requests[1].body, { result: null });
});

test("worker error callback redacts messages and drops arbitrary error properties", async () => {
  const stop = new AbortController();
  const errors = [];
  const leaked = Object.assign(Error("private-key"), { secret: "private-key" });
  const worker = runWorker({ url: "http://runtime.test", token: "service-token", signal: stop.signal, actions: { work() {} },
    redact: text => text.replaceAll("private-key", "[REDACTED]"),
    onError(error) { errors.push(error); stop.abort(); },
    fetch: async () => { throw leaked; },
  });
  await worker.done;
  assert.equal(errors.length, 1);
  assert.equal(errors[0].message, "[REDACTED]");
  assert.equal(errors[0].secret, undefined);
});

const waitForAbort = signal => new Promise((_, reject) => {
  if (signal.aborted) { reject(signal.reason); return; }
  signal.addEventListener("abort", () => reject(signal.reason), {once:true});
});

for (const size of [128, 129, 513]) test(`generated ${size}-action registry opens one action poll beside verifier and effect polls`, async () => {
  const names = Array.from({length:size}, (_, i) => `work-${i}`), stop = new AbortController(), errors = [];
  const calls = [];
  const worker = startServer({actions:Object.fromEntries(names.map(name => [name, {contract:"v1", secrets:[]}])),
    effects:{mail:{contract:"mail-v1", secrets:[]}, push:{contract:"push-v1", secrets:[]}}, routes:{billing:{contract:"v1", method:"POST", path:"/hook", service:"service:billing", secrets:[]}}}, {
    actions:Object.fromEntries(names.map(name => [name, () => ({})])), effects:{mail() {}, push() {}},
    routes:{billing:{verify:() => true, handle:() => new Response()}},
  }, {url:"http://runtime.test", token:"service-token", signal:stop.signal,
    // Even untyped callers cannot opt generated servers out of registry mode.
    actionRegistry:false,
    onError(error) { errors.push(error); stop.abort(); }, fetch:async (url, init) => {
      calls.push({path:new URL(url).pathname, body:JSON.parse(init.body)}); return waitForAbort(init.signal);
    },
  });
  try {
    await Promise.resolve(); // The verifier enters its abort-aware fetch on a microtask.
    assert.equal(calls.filter(call => call.path === "/actions/claim-set").length, 1);
    assert.equal(calls.filter(call => call.path === "/actions/claim").length, 0);
    const registry = calls.find(call => call.path === "/actions/claim-set").body;
    assert.deepEqual(registry.actions, [...names, "@route/billing"].slice(0, 128));
    assert.equal(registry.wait, 1); // The private route is also part of this registry.
    assert.equal(registry.session, 60); assert.equal(registry.limit, 8);
    assert.equal(calls.filter(call => call.path === "/routes/verify/claim").length, 1);
    assert.deepEqual(calls.filter(call => call.path === "/effects/claim").map(call => call.body.effect), ["mail", "push"]);
    assert.ok(calls.filter(call => call.path === "/effects/claim").every(call => call.body.fenced === true));
    assert.deepEqual(calls.filter(call => call.path === "/effects/claim").map(call => call.body.declarationContract), ["mail-v1", "push-v1"]);
  } finally { stop.abort(); await worker.done; }
  assert.deepEqual(errors, []);
});

test("registry action chunks rotate across own handlers and preserve per-name session durations", {timeout:hangBudget(1)}, async () => {
  const short = Array.from({length:130}, (_, i) => `short-${i}`), long = Array.from({length:129}, (_, i) => `long-${i}`);
  const names = short.flatMap((name, i) => long[i] ? [name, long[i]] : [name]).concat(["__proto__", "constructor"]);
  const sessions = Object.fromEntries([...long.map(name => [name, 120]), ["__proto__", 900], ["constructor", 900], [short[0], 60]]);
  const expected = [
    {actions:short.slice(0, 128), session:60}, {actions:short.slice(128), session:60},
    {actions:long.slice(0, 128), session:120}, {actions:long.slice(128), session:120},
    {actions:["__proto__", "constructor"], session:900},
  ];
  const stop = new AbortController(), polls = [], handled = [], settled = [], errors = [];
  const actions = Object.fromEntries(names.map(name => [name, () => { handled.push(name); return {name}; }]));
  Object.setPrototypeOf(actions, {inherited() { throw Error("an inherited handler must not be claimed"); }});
  const worker = runWorker({url:"http://runtime.test", token:"service-token", signal:stop.signal, actionRegistry:true,
    actions, actionSessions:sessions, batch:2, lease:180, wait:25,
    onError(error) { errors.push(error); stop.abort(); }, fetch:async (url, init) => {
      const path = new URL(url).pathname, body = JSON.parse(init.body);
      if (path === "/actions/claim-set") {
        const chunk = {actions:body.actions, session:body.session}; polls.push(chunk);
        assert.deepEqual(chunk, expected[(polls.length - 1) % expected.length]);
        assert.equal(body.wait, 1); assert.equal(body.lease, 180); assert.equal(body.limit, 2);
        if (polls.length === expected.length * 2) stop.abort();
        // The second cycle is empty, proving that rotation is not contingent
        // on finding work. Each first-cycle chunk dispatches its own handler.
        return Response.json({requests:polls.length <= expected.length ? [claim({id:`work-${polls.length}`, action:body.actions.at(-1)})] : []});
      }
      assert.match(path, /^\/actions\/work-\d+\/done$/); assert.equal(init.headers["x-snapback-action-lease"], "claim-token");
      settled.push(body); return Response.json({ok:true});
    },
  });
  try { await worker.done; } finally { stop.abort(); }
  assert.deepEqual(errors, []); assert.deepEqual(polls, [...expected, ...expected]);
  assert.deepEqual(handled, expected.map(chunk => chunk.actions.at(-1)));
  assert.deepEqual(settled, handled.map(name => ({result:{name}})));
});

test("single registry chunk retains configured long-poll wait and an empty registry finishes without a poll", async () => {
  for (const count of [0, 128]) {
    const stop = new AbortController(), polls = [], errors = [];
    const worker = runWorker({url:"http://runtime.test", token:"service-token", signal:stop.signal, actionRegistry:true, wait:17,
      actions:Object.fromEntries(Array.from({length:count}, (_, i) => [`work-${i}`, () => null])),
      onError(error) { errors.push(error); stop.abort(); }, fetch:async (url, init) => {
        polls.push({path:new URL(url).pathname, body:JSON.parse(init.body)}); stop.abort(); return Response.json({requests:[]});
      },
    });
    await worker.done; assert.deepEqual(errors, []); assert.equal(polls.length, count ? 1 : 0);
    if (count) { assert.equal(polls[0].path, "/actions/claim-set"); assert.equal(polls[0].body.wait, 17); assert.equal(polls[0].body.actions.length, 128); }
  }
});

test("registry action execution waits for its bounded batch, including callbacks that ignore shutdown", {timeout:hangBudget(4)}, async () => {
  let release, enter, active = 0, polls = 0, done = false;
  const gate = new Promise(resolve => { release = resolve; }), entered = new Promise(resolve => { enter = resolve; });
  const stop = new AbortController(), errors = [];
  const actions = Object.fromEntries(Array.from({length:260}, (_, i) => [`work-${i}`, async () => {
    if (++active === 2) enter(); await gate; active--; return null;
  }]));
  const worker = runWorker({url:"http://runtime.test", token:"service-token", signal:stop.signal, actionRegistry:true,
    actions, batch:2, onError(error) { errors.push(error); stop.abort(); }, fetch:async (url, init) => {
      if (url.endsWith("/claim-set")) {
        polls++; const body = JSON.parse(init.body); assert.equal(body.limit, 2);
        return Response.json({requests:body.actions.slice(0, 2).map((action, i) => claim({id:`batch-${i}`, action}))});
      }
      return Response.json({ok:true});
    },
  });
  void worker.done.then(() => { done = true; });
  let timer;
  try {
    await withHangGuard(() => entered, "batch did not enter");
    assert.equal(active, 2); assert.equal(polls, 1);
    stop.abort(); await Promise.resolve(); assert.equal(done, false);
    assert.equal(active, 2); assert.equal(polls, 1);
  } finally { clearTimeout(timer); stop.abort(); release(); await worker.done; }
  assert.equal(active, 0); assert.deepEqual(errors, []);
});

for (const actionRegistry of [undefined, false]) test(`legacy action polling stays per-name (${actionRegistry})`, async () => {
  const stop = new AbortController(), polls = [], errors = [];
  const worker = runWorker({url:"http://runtime.test", token:"service-token", signal:stop.signal, actionRegistry,
    actions:{first() {}, second() {}, third() {}}, actionSessions:{second:120}, wait:19,
    onError(error) { errors.push(error); stop.abort(); }, fetch:async (url, init) => {
      polls.push({path:new URL(url).pathname, body:JSON.parse(init.body)}); return waitForAbort(init.signal);
    },
  });
  try {
    assert.deepEqual(polls.map(poll => [poll.path, poll.body.action, poll.body.session, poll.body.wait]), [
      ["/actions/claim", "first", 60, 19], ["/actions/claim", "second", 120, 19], ["/actions/claim", "third", 60, 19],
    ]);
  } finally { stop.abort(); await worker.done; }
  assert.deepEqual(errors, []);
});

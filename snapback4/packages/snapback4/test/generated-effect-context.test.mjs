import test from "node:test";
import assert from "node:assert/strict";
import { startServer } from "../dist/server.js";
import { GiveUp, runWorker } from "../dist/worker.js";
import { statusPoller } from "../dist/server-lifetime.js";

const declaration = "rust-static-declaration-digest";
const effect = (overrides = {}) => ({
  id: "effect /%é", effect: "mail", payload: { to: "a@example.test" },
  attempt: 2, seq: 17, at: 1234, deadline: null,
  leaseToken: "private-effect-lease", declarationContract: declaration,
  ...overrides,
});
const manifest = (secrets = []) => ({ actions: {}, routes: {}, effects: { mail: { contract: declaration, secrets } } });
const claimOnce = (claimed = effect()) => {
  let claims = 0;
  return {
    reply() {
      if (++claims === 1) return Response.json({ effects: [claimed] });
      return Response.json({ denied: { code: "E_EFFECT_GENERATION", family: "schema", message: "test fixture received an unexpected generated effect repoll" } });
    },
    assertClaimedOnce() { assert.equal(claims, 1, "generated effect fixture must claim exactly once"); },
  };
};

test("generated effects claim one static declaration and expose only frozen effect authority", async () => {
  const stop = new AbortController(), calls = [];
  const claim = claimOnce();
  let seen, unexpected;
  const worker = startServer(manifest(["MAIL_KEY"]), { effects: { async mail(payload, ctx) {
    seen = ctx;
    assert.deepEqual(payload, { to: "a@example.test" });
    assert.deepEqual(Object.keys(ctx).sort(), ["effect", "invocation", "secrets", "step"]);
    assert.deepEqual(Object.keys(ctx.effect).sort(), ["at", "attempt", "effect", "id", "seq", "worker"]);
    assert.deepEqual(Object.keys(ctx.invocation).sort(), ["attempt", "cancelled", "deadline", "id", "signal"]);
    for (const absent of ["query", "mutate", "principal", "writeIdFor", "sql", "data", "admin", "session", "token", "lease"]) assert.equal(absent in ctx, false);
    assert.equal(Object.isFrozen(ctx), true); assert.equal(Object.isFrozen(ctx.effect), true); assert.equal(Object.isFrozen(ctx.invocation), true);
    assert.equal(Object.getPrototypeOf(ctx.secrets), null); assert.equal(Object.isFrozen(ctx.secrets), true);
    assert.deepEqual(Object.keys(ctx.secrets), ["MAIL_KEY"]); assert.equal(ctx.secrets.MAIL_KEY, "mail-secret");
    return { receipt: await ctx.step("send /%key", { n: 1 }, key => ({ key })) };
  } } }, {
    url: "http://runtime.test", token: "service-token", env: { MAIL_KEY: "mail-secret" }, signal: stop.signal, statusIntervalMs: 1000,
    fetch: async (url, init) => {
      const path = new URL(url).pathname, body = JSON.parse(init.body); calls.push({ path, body, headers: init.headers });
      if (path === "/effects/claim") return claim.reply();
      if (path.endsWith("/steps/send%20%2F%25key/begin")) return Response.json({ step: { state: "run", key: "provider-key" } });
      if (path.endsWith("/steps/send%20%2F%25key/done")) return Response.json({ ok: true });
      if (path.endsWith("/status")) return Response.json({ id: effect().id, attempt: 2, state: "running", deadline: null, cancelled: false });
      if (path.endsWith("/done")) { queueMicrotask(() => stop.abort()); return Response.json({ ok: true }); }
      unexpected = new Error(`unexpected generated effect request ${path}`); stop.abort(); throw unexpected;
    },
  });
  await worker.done;
  assert.equal(unexpected, undefined, unexpected?.message);
  claim.assertClaimedOnce();
  assert.deepEqual(calls[0].body, { limit: 8, lease: 60, wait: 25, effect: "mail", fenced: true, declarationContract: declaration });
  assert.equal(calls[0].path, "/effects/claim");
  for (const call of calls.filter(call => call.path.includes("/effects/effect%20%2F%25%C3%A9/"))) {
    assert.equal(call.headers.authorization, "Bearer service-token");
    assert.equal(call.headers["x-snapback-effect-lease"], "private-effect-lease");
  }
  assert.equal(seen.invocation.signal.aborted, true, "handler completion closes the retained context");
});

test("handler error drains an older failing status body without top-level settlement", async () => {
  const stop = new AbortController(), paths = [], errors = [];
  const claim = claimOnce();
  let statuses = 0, bodyStartedResolve, rejectBody, handlerReturned = false;
  const bodyStarted = new Promise(resolve => { bodyStartedResolve = resolve; });
  const oldBody = new Promise((_, reject) => { rejectBody = reject; });
  const worker = startServer(manifest(), { effects: { async mail() {
    await bodyStarted;
    setImmediate(() => { assert.equal(handlerReturned, true); rejectBody(Error("old status body failed")); });
    handlerReturned = true;
    throw Error("provider failed before status loss");
  } } }, {
    url: "http://runtime.test", token: "service-token", signal: stop.signal, statusIntervalMs: 1,
    onError: error => { errors.push(error); stop.abort(); },
    fetch: async (url) => {
      const path = new URL(url).pathname; paths.push(path);
      if (path === "/effects/claim") return claim.reply();
      if (path.endsWith("/status")) {
        if (++statuses === 1) return { ok: true, json() { bodyStartedResolve(); return oldBody; } };
        stop.abort(); throw Error(`unexpected fresh status request ${path}`);
      }
      if (path.endsWith("/done") || path.endsWith("/failed")) { stop.abort(); return Response.json({ ok: true }); }
      stop.abort(); throw Error(`unexpected request ${path}`);
    },
  });
  await worker.done;
  claim.assertClaimedOnce();
  assert.equal(statuses, 1);
  assert.equal(paths.some(path => path.endsWith("/done") || path.endsWith("/failed")), false);
  assert.deepEqual(errors.map(error => error.message), ["E_OFFLINE: the effect authority could not be confirmed"]);
});

test("finalization drains an older successful status before one fresh read and settlement", async () => {
  const stop = new AbortController(), paths = [], errors = [];
  const claim = claimOnce();
  let statuses = 0, bodyStartedResolve, resolveBody, oldSettled = false;
  const bodyStarted = new Promise(resolve => { bodyStartedResolve = resolve; });
  const oldBody = new Promise(resolve => { resolveBody = resolve; });
  const running = { id: effect().id, attempt: 2, state: "running", deadline: null, cancelled: false };
  const worker = startServer(manifest(), { effects: { async mail() {
    await bodyStarted;
    setImmediate(() => { oldSettled = true; resolveBody(running); });
    return "sent";
  } } }, {
    url: "http://runtime.test", token: "service-token", signal: stop.signal, statusIntervalMs: 1,
    onError: error => errors.push(error),
    fetch: async (url) => {
      const path = new URL(url).pathname; paths.push(path);
      if (path === "/effects/claim") return claim.reply();
      if (path.endsWith("/status")) {
        if (++statuses === 1) return { ok: true, json() { bodyStartedResolve(); return oldBody; } };
        assert.equal(statuses, 2); assert.equal(oldSettled, true, "fresh status must follow the drained body");
        return Response.json(running);
      }
      if (path.endsWith("/done")) { queueMicrotask(() => stop.abort()); return Response.json({ ok: true }); }
      stop.abort(); throw Error(`unexpected request ${path}`);
    },
  });
  await worker.done;
  claim.assertClaimedOnce();
  assert.equal(statuses, 2);
  assert.equal(paths.filter(path => path.endsWith("/done")).length, 1);
  assert.equal(paths.some(path => path.endsWith("/failed")), false);
  assert.deepEqual(errors, []);
});

for (const [name, failure, secrets, env, expected] of [
  ["redacted retry", Error("MAIL_KEY mail-secret service-token private-effect-lease"), ["MAIL_KEY"], { MAIL_KEY: "mail-secret" }, { error: "[REDACTED] [REDACTED] [REDACTED] [REDACTED]", retry: true }],
  ["GiveUp", new GiveUp("permanent provider refusal"), [], {}, { error: "permanent provider refusal", retry: false }],
]) test(`handler error ${name} drains an older healthy status before one failed settlement`, async () => {
  const stop = new AbortController(), paths = [], errors = [];
  const claim = claimOnce();
  let statuses = 0, bodyStartedResolve, resolveBody, recorded;
  const bodyStarted = new Promise(resolve => { bodyStartedResolve = resolve; });
  const oldBody = new Promise(resolve => { resolveBody = resolve; });
  const running = { id: effect().id, attempt: 2, state: "running", deadline: null, cancelled: false };
  const worker = startServer(manifest(secrets), { effects: { async mail() {
    await bodyStarted;
    setImmediate(() => resolveBody(running));
    throw failure;
  } } }, {
    url: "http://runtime.test", token: "service-token", env, signal: stop.signal, statusIntervalMs: 1,
    onError: error => errors.push(error),
    fetch: async (url, init) => {
      const path = new URL(url).pathname; paths.push(path);
      if (path === "/effects/claim") return claim.reply();
      if (path.endsWith("/status")) {
        if (++statuses === 1) return { ok: true, json() { bodyStartedResolve(); return oldBody; } };
        assert.equal(statuses, 2); return Response.json(running);
      }
      if (path.endsWith("/failed")) { recorded = JSON.parse(init.body); queueMicrotask(() => stop.abort()); return Response.json({ ok: true }); }
      stop.abort(); throw Error(`unexpected request ${path}`);
    },
  });
  await worker.done;
  claim.assertClaimedOnce();
  assert.equal(statuses, 2);
  assert.deepEqual(recorded, expected);
  assert.equal(paths.filter(path => path.endsWith("/failed")).length, 1);
  assert.equal(paths.some(path => path.endsWith("/done")), false);
  assert.deepEqual(errors, []);
});

for (const stage of ["fetch", "body"]) test(`actual final status ${stage} timeout latches E_OFFLINE without settlement`, { timeout: 15_000 }, async () => {
  const stop = new AbortController(), paths = [], errors = [];
  const claim = claimOnce();
  const worker = startServer(manifest(), { effects: { mail: () => "must-not-settle" } }, {
    url: "http://runtime.test", token: "service-token", signal: stop.signal, statusIntervalMs: 60_000,
    onError: error => { errors.push(error); stop.abort(); },
    fetch: async url => {
      const path = new URL(url).pathname; paths.push(path);
      if (path === "/effects/claim") return claim.reply();
      if (path.endsWith("/status")) {
        if (stage === "fetch") return new Promise(() => {});
        return { ok: true, json: () => new Promise(() => {}) };
      }
      if (path.endsWith("/done") || path.endsWith("/failed")) { stop.abort(); return Response.json({ ok: true }); }
      stop.abort(); throw Error(`unexpected request ${path}`);
    },
  });
  await worker.done;
  claim.assertClaimedOnce();
  assert.equal(paths.filter(path => path.endsWith("/status")).length, 1);
  assert.equal(paths.some(path => path.endsWith("/done") || path.endsWith("/failed")), false);
  assert.deepEqual(errors.map(error => error.message), ["E_OFFLINE: the effect authority could not be confirmed"]);
});

test("quiescing drains an active status poll without dropping its loss callback", async () => {
  const failure = Error("old poll failed"), losses = [];
  let startedResolve, rejectPoll, polls = 0;
  const started = new Promise(resolve => { startedResolve = resolve; });
  const poller = statusPoller({
    intervalMs: 0,
    stopped: () => false,
    poll: () => { polls++; startedResolve(); return new Promise((_, reject) => { rejectPoll = reject; }); },
    lost: error => losses.push(error),
  });
  await started;
  const drained = poller.quiesce();
  rejectPoll(failure);
  await drained;
  assert.deepEqual(losses, [failure]);
  assert.equal(polls, 1);
  poller.close();
});

test("legacy runWorker keeps its absent-contract claim and (payload, meta) handler wire", async () => {
  const stop = new AbortController(), calls = [];
  let meta;
  const worker = runWorker({ url: "http://runtime.test", token: "service-token", signal: stop.signal,
    effects: { mail(payload, value) { assert.deepEqual(payload, { legacy: true }); meta = value; return undefined; } },
    fetch: async (url, init) => {
      const path = new URL(url).pathname, body = JSON.parse(init.body); calls.push({ path, body });
      if (path === "/effects/claim") return Response.json({ effects: [effect({ payload: { legacy: true }, declarationContract: undefined })] });
      queueMicrotask(() => stop.abort()); return Response.json({ ok: true });
    },
  });
  await worker.done;
  assert.deepEqual(calls[0].body, { limit: 8, lease: 60, wait: 25, effect: "mail", fenced: true });
  assert.deepEqual(meta, { id: effect().id, effect: "mail", attempt: 2, seq: 17, at: 1234, worker: "service" });
  assert.deepEqual(calls[1].body, { result: null });
});

for (const mode of ["denied", "missing", "mismatch"]) test(`generated declaration ${mode} rejects before handler, settlement or repoll`, async () => {
  const errors = [], calls = [];
  let handled = 0;
  const worker = startServer(manifest(), { effects: { mail() { handled++; } } }, {
    url: "http://runtime.test", token: "service-token", onError: error => errors.push(error),
    fetch: async (url, init) => {
      calls.push(new URL(url).pathname);
      if (mode === "denied") return Response.json({ denied: { code: "E_EFFECT_GENERATION", family: "schema", message: "changed" } });
      return Response.json({ effects: [effect({ declarationContract: mode === "missing" ? undefined : "other" })] });
    },
  });
  await assert.rejects(worker.done, /E_EFFECT_GENERATION/);
  assert.equal(handled, 0); assert.deepEqual(calls, ["/effects/claim"]); assert.equal(errors.length, 1);
});

for (const [name, status] of [
  ["cancelled", { id: effect().id, attempt: 2, state: "failed", cancelled: true, errorCode: "E_EFFECT_CANCELLED" }],
  ["deadline", { id: effect().id, attempt: 2, state: "failed", cancelled: false, errorCode: "E_EFFECT_DEADLINE" }],
  ["terminal", { id: effect().id, attempt: 2, state: "sent", cancelled: false }],
  ["lease", { denied: { code: "E_EFFECT_LEASE", family: "effect", message: "lost" } }],
  ["generation", { denied: { code: "E_EFFECT_GENERATION", family: "schema", message: "changed" } }],
  ["auth", { denied: { code: "E_AUTH", family: "auth", message: "ended" } }],
  ["offline", null],
]) test(`generated effect status ${name} aborts and never settles after authority loss`, async () => {
  const stop = new AbortController(), paths = [], errors = [];
  const claim = claimOnce();
  const worker = startServer(manifest(), { effects: { async mail(_, ctx) {
    await new Promise(resolve => ctx.invocation.signal.addEventListener("abort", resolve, { once: true }));
    stop.abort();
    return "must-not-settle";
  } } }, { url: "http://runtime.test", token: "service-token", signal: stop.signal, statusIntervalMs: 1, onError: error => errors.push(error),
    fetch: async (url) => {
      const path = new URL(url).pathname; paths.push(path);
      if (path === "/effects/claim") return claim.reply();
      if (path.endsWith("/status")) {
        if (status === null) throw Error("offline");
        return Response.json(status);
      }
      throw Error(`unexpected post-loss request ${path}`);
    },
  });
  if (name === "generation") await assert.rejects(worker.done, /E_EFFECT_GENERATION/);
  else await worker.done;
  claim.assertClaimedOnce();
  assert.equal(paths.some(path => path.endsWith("/done") || path.endsWith("/failed")), false);
  assert.equal(paths.filter(path => path === "/effects/claim").length, 1);
});

test("effect step parking uses the encoded effect path and does not top-level settle", async () => {
  const stop = new AbortController(), paths = [];
  const claim = claimOnce();
  const worker = startServer(manifest(), { effects: { mail: (_, ctx) => ctx.step("provider", {}, () => "must-not-run") } }, {
    url: "http://runtime.test", token: "service-token", signal: stop.signal,
    fetch: async (url, init) => {
      const path = new URL(url).pathname; paths.push(path);
      if (path === "/effects/claim") return claim.reply();
      if (path.endsWith("/steps/provider/begin")) return Response.json({ step: { state: "reconcile", key: "same-key" } });
      if (path.endsWith("/steps/provider/park")) { assert.equal(init.headers["x-snapback-effect-lease"], "private-effect-lease"); queueMicrotask(() => stop.abort()); return Response.json({ ok: true }); }
      throw Error(`unexpected request ${path}`);
    },
  });
  await worker.done;
  claim.assertClaimedOnce();
  assert.ok(paths.includes("/effects/effect%20%2F%25%C3%A9/steps/provider/park"));
  assert.equal(paths.some(path => path.endsWith("/done") || path.endsWith("/failed")), false);
});

test("generated failure records redact declared names and values plus service and effect tokens", async () => {
  const stop = new AbortController(); let recorded, statuses = 0;
  const claim = claimOnce();
  const worker = startServer(manifest(["MAIL_KEY"]), { effects: { mail() { throw Error("MAIL_KEY mail-secret service-token private-effect-lease"); } } }, {
    url: "http://runtime.test", token: "service-token", env: { MAIL_KEY: "mail-secret" }, signal: stop.signal,
    fetch: async (url, init) => {
      const path = new URL(url).pathname;
      if (path === "/effects/claim") return claim.reply();
      if (path.endsWith("/status")) { statuses++; return Response.json({ id: effect().id, attempt: 2, state: "running", deadline: null, cancelled: false }); }
      if (path.endsWith("/failed")) { recorded = JSON.parse(init.body).error; queueMicrotask(() => stop.abort()); return Response.json({ ok: true }); }
      throw Error(`unexpected request ${path}`);
    },
  });
  await worker.done;
  claim.assertClaimedOnce();
  assert.equal(statuses, 1);
  assert.equal(recorded, "[REDACTED] [REDACTED] [REDACTED] [REDACTED]");
});

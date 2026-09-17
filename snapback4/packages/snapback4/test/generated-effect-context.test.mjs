import test from "node:test";
import assert from "node:assert/strict";
import { startServer } from "../dist/server.js";
import { runWorker } from "../dist/worker.js";

const declaration = "rust-static-declaration-digest";
const effect = (overrides = {}) => ({
  id: "effect /%é", effect: "mail", payload: { to: "a@example.test" },
  attempt: 2, seq: 17, at: 1234, deadline: null,
  leaseToken: "private-effect-lease", declarationContract: declaration,
  ...overrides,
});
const manifest = (secrets = []) => ({ actions: {}, routes: {}, effects: { mail: { contract: declaration, secrets } } });

test("generated effects claim one static declaration and expose only frozen effect authority", async () => {
  const stop = new AbortController(), calls = [];
  let seen, unexpected, claims = 0;
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
      if (path === "/effects/claim") {
        if (++claims === 1) return Response.json({ effects: [effect()] });
        unexpected = new Error("unexpected second generated effect claim"); stop.abort(); throw unexpected;
      }
      if (path.endsWith("/steps/send%20%2F%25key/begin")) return Response.json({ step: { state: "run", key: "provider-key" } });
      if (path.endsWith("/steps/send%20%2F%25key/done")) return Response.json({ ok: true });
      if (path.endsWith("/status")) return Response.json({ id: effect().id, attempt: 2, state: "running", deadline: null, cancelled: false });
      if (path.endsWith("/done")) { queueMicrotask(() => stop.abort()); return Response.json({ ok: true }); }
      unexpected = new Error(`unexpected generated effect request ${path}`); stop.abort(); throw unexpected;
    },
  });
  await worker.done;
  assert.equal(unexpected, undefined, unexpected?.message);
  assert.equal(claims, 1);
  assert.deepEqual(calls[0].body, { limit: 8, lease: 60, wait: 25, effect: "mail", fenced: true, declarationContract: declaration });
  assert.equal(calls[0].path, "/effects/claim");
  for (const call of calls.filter(call => call.path.includes("/effects/effect%20%2F%25%C3%A9/"))) {
    assert.equal(call.headers.authorization, "Bearer service-token");
    assert.equal(call.headers["x-snapback-effect-lease"], "private-effect-lease");
  }
  assert.equal(seen.invocation.signal.aborted, true, "handler completion closes the retained context");
});

test("an overlapping status loss after final confirm still fences generated settlement", async () => {
  const stop = new AbortController(), paths = [], errors = [];
  let claims = 0, statuses = 0, oldSignal, oldStartedResolve;
  const oldStarted = new Promise(resolve => { oldStartedResolve = resolve; });
  const worker = startServer(manifest(), { effects: { async mail() {
    await oldStarted;
    return "must-not-settle";
  } } }, {
    url: "http://runtime.test", token: "service-token", signal: stop.signal, statusIntervalMs: 1,
    onError: error => errors.push(error),
    fetch: async (url, init) => {
      const path = new URL(url).pathname; paths.push(path);
      if (path === "/effects/claim") {
        if (++claims === 1) return Response.json({ effects: [effect()] });
        stop.abort(); return Response.json({ effects: [] });
      }
      if (path.endsWith("/status")) {
        if (++statuses === 1) {
          oldSignal = init.signal;
          return { ok: true, json() { oldStartedResolve(); return new Promise(() => {}); } };
        }
        if (statuses === 2) return { ok: true, async json() {
          return { id: effect().id, attempt: 2, cancelled: false, get state() {
            // Queue the older request's catch now: confirm's synchronous check
            // completes first, but authority loss runs before its caller resumes.
            assert.ok(oldSignal); oldSignal.dispatchEvent(new Event("abort")); return "running";
          } };
        } };
        stop.abort(); throw Error(`unexpected third status request ${path}`);
      }
      if (path.endsWith("/done") || path.endsWith("/failed")) { stop.abort(); return Response.json({ ok: true }); }
      stop.abort(); throw Error(`unexpected request ${path}`);
    },
  });
  await worker.done;
  assert.equal(statuses, 2);
  assert.equal(paths.some(path => path.endsWith("/done") || path.endsWith("/failed")), false);
  assert.deepEqual(errors.map(error => error.message), ["E_OFFLINE: the effect authority could not be confirmed"]);
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
  const worker = startServer(manifest(), { effects: { async mail(_, ctx) {
    await new Promise(resolve => ctx.invocation.signal.addEventListener("abort", resolve, { once: true }));
    stop.abort();
    return "must-not-settle";
  } } }, { url: "http://runtime.test", token: "service-token", signal: stop.signal, statusIntervalMs: 1, onError: error => errors.push(error),
    fetch: async (url) => {
      const path = new URL(url).pathname; paths.push(path);
      if (path === "/effects/claim") return Response.json({ effects: [effect()] });
      if (path.endsWith("/status")) {
        if (status === null) throw Error("offline");
        return Response.json(status);
      }
      throw Error(`unexpected post-loss request ${path}`);
    },
  });
  if (name === "generation") await assert.rejects(worker.done, /E_EFFECT_GENERATION/);
  else await worker.done;
  assert.equal(paths.some(path => path.endsWith("/done") || path.endsWith("/failed")), false);
  assert.equal(paths.filter(path => path === "/effects/claim").length, 1);
});

test("effect step parking uses the encoded effect path and does not top-level settle", async () => {
  const stop = new AbortController(), paths = [];
  const worker = startServer(manifest(), { effects: { mail: (_, ctx) => ctx.step("provider", {}, () => "must-not-run") } }, {
    url: "http://runtime.test", token: "service-token", signal: stop.signal,
    fetch: async (url, init) => {
      const path = new URL(url).pathname; paths.push(path);
      if (path === "/effects/claim") return Response.json({ effects: [effect()] });
      if (path.endsWith("/steps/provider/begin")) return Response.json({ step: { state: "reconcile", key: "same-key" } });
      if (path.endsWith("/steps/provider/park")) { assert.equal(init.headers["x-snapback-effect-lease"], "private-effect-lease"); setTimeout(() => stop.abort(), 5); return Response.json({ ok: true }); }
      throw Error(`unexpected request ${path}`);
    },
  });
  await worker.done;
  assert.ok(paths.includes("/effects/effect%20%2F%25%C3%A9/steps/provider/park"));
  assert.equal(paths.some(path => path.endsWith("/done") || path.endsWith("/failed")), false);
});

test("generated failure records redact declared names and values plus service and effect tokens", async () => {
  const stop = new AbortController(); let recorded;
  const worker = startServer(manifest(["MAIL_KEY"]), { effects: { mail() { throw Error("MAIL_KEY mail-secret service-token private-effect-lease"); } } }, {
    url: "http://runtime.test", token: "service-token", env: { MAIL_KEY: "mail-secret" }, signal: stop.signal,
    fetch: async (url, init) => {
      const path = new URL(url).pathname;
      if (path === "/effects/claim") return Response.json({ effects: [effect()] });
      if (path.endsWith("/failed")) { recorded = JSON.parse(init.body).error; queueMicrotask(() => stop.abort()); return Response.json({ ok: true }); }
      throw Error(`unexpected request ${path}`);
    },
  });
  await worker.done;
  assert.equal(recorded, "[REDACTED] [REDACTED] [REDACTED] [REDACTED]");
});

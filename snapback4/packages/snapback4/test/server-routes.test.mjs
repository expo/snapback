// Protocol doubles; the CLI lane owns real ingress/verification/crash witnesses.
import test from "node:test";
import assert from "node:assert/strict";
import { setTimeout as delay } from "node:timers/promises";
import { startServer, ServerError, ParkStep } from "../dist/server.js";
import { GiveUp, Retry, runWorker } from "../dist/worker.js";
import { routeRequest, routeResponse } from "../dist/server-routes.js";

const declaration = (service = null, secrets = []) => ({ contract: "route-v1", method: "POST", path: "/hooks/billing", service, secrets });
const envelope = (extra = {}) => ({ method: "POST", path: "/hooks/billing", headers: [["x-signature", "one"], ["x-signature", "two"]], bodyHex: "00ff80207b207d0a", ...extra });
const manifest = (spec = declaration(), name = "billing") => ({ actions: {}, effects: {}, routes: { [name]: spec } });
const options = { url: "http://routes.test", token: "service-token" };
const deferred = () => { let resolve; const promise = new Promise(done => { resolve = done; }); return { promise, resolve }; };
const aborted = signal => new Promise((_, reject) => {
  if (signal.aborted) { reject(signal.reason); return; }
  signal.addEventListener("abort", () => reject(signal.reason), { once: true });
});
const claim = (extra = {}) => ({ id: "route-invocation", action: "@route/billing", principal: "member:alice", attempt: 1, at: 0,
  contract: "route-v1", deadline: null, args: { request: envelope() },
  session: { token: "action-fence", principal: "member:alice", kind: "action", expiresAt: Date.now() + 60_000 }, ...extra });
const ticket = (extra = {}) => ({ id: "ticket-1", route: "billing", contract: "route-v1", now: 1000, deadline: 11_000,
  leaseToken: "verify-fence", request: envelope(), ...extra });

async function enteredWithin(promise) {
  let timer;
  try { await Promise.race([promise, new Promise((_, reject) => { timer = setTimeout(() => reject(Error("handler did not enter")), 1000); })]); }
  finally { clearTimeout(timer); }
}

async function finished(worker, stop) {
  let timer;
  try { await Promise.race([worker.done, new Promise((_, reject) => { timer = setTimeout(() => reject(Error("server did not stop")), 2000); })]); }
  finally { clearTimeout(timer); stop.abort(); }
}

async function invoke(handler, configuration = {}) {
  const stop = new AbortController(), errors = [], requests = [];
  const request = claim(configuration.claim);
  let sent = false, settled;
  const worker = startServer(manifest(declaration(null, configuration.secrets)), { routes: { billing: handler } }, {
    ...options, env: configuration.env ?? {}, signal: stop.signal, statusIntervalMs: 5, onError: error => errors.push(error),
    fetch: async (url, init) => {
      const path = new URL(url).pathname, body = JSON.parse(init.body);
      requests.push({ path, body, headers: init.headers });
      if (path === "/actions/claim-set") {
        assert.deepEqual(body.actions, ["@route/billing"]);
        if (!sent) { sent = true; return Response.json({ requests: [request], worker: "service:worker" }); }
        return aborted(init.signal);
      }
      assert.equal(init.headers.authorization, "Bearer service-token");
      assert.equal(init.headers["x-snapback-action-lease"], "action-fence");
      if (/\/(done|failed)$/.test(path)) {
        settled = { path, body }; setImmediate(() => stop.abort()); return Response.json({ ok: true });
      }
      if (path.endsWith("/status")) return Response.json({ invocation: { id: request.id, attempt: request.attempt,
        cancelled: false, state: configuration.cancel ? "failed" : "running", ...(configuration.cancel ? { errorCode: "E_ACTION_CANCELLED" } : {}) } });
      throw Error(`unexpected ${path}`);
    },
  });
  await finished(worker, stop);
  return { settled, errors, requests, worker };
}

async function verify(handler, configuration = {}) {
  const stop = new AbortController(), errors = [], settlements = [], requests = [];
  const claims = configuration.claims ?? [ticket()];
  let sent = false;
  const worker = startServer(manifest(declaration("service:billing", configuration.secrets)), {
    routes: { billing: { verify: handler, handle: () => { throw Error("verification must not call handle"); } } },
  }, {
    ...options, signal: stop.signal, env: configuration.env ?? {}, batch: 4, onError: error => errors.push(error),
    fetch: async (url, init) => {
      const path = new URL(url).pathname, body = JSON.parse(init.body);
      requests.push({ path, body, headers: init.headers });
      assert.equal(init.headers.authorization, "Bearer service-token");
      if (path === "/actions/claim-set") return aborted(init.signal);
      if (path === "/routes/verify/claim") {
        assert.deepEqual(body.routes, ["billing"]); assert.ok(body.limit <= 4);
        if (!sent) { sent = true; return Response.json({ requests: claims, worker: "service:worker" }); }
        return aborted(init.signal);
      }
      assert.equal(init.headers["x-snapback-route-lease"], "verify-fence");
      assert.equal(init.headers["x-snapback-action-lease"], undefined);
      settlements.push({ path, body });
      if (settlements.length === claims.length) setImmediate(() => stop.abort());
      if (configuration.settlementLost) throw Error("verification acknowledgement lost");
      return Response.json({ ok: true });
    },
  });
  await finished(worker, stop);
  return { settlements, errors, requests, worker };
}

test("route registries require exact own handlers and exact service members", () => {
  const never = { ...options, fetch: () => { throw Error("must not claim"); } };
  for (const routes of [{}, { billing() {}, extra() {} }, Object.create({ billing() {} }), { billing: {} }, { billing() {}, [Symbol()]: 1 }]) {
    assert.throws(() => startServer(manifest(), { routes }, never), /E_SERVER_HANDLERS/);
  }
  for (const billing of [() => {}, { handle() {} }, { verify() {}, handle() {}, extra: 1 }, Object.create({ verify() {}, handle() {} })]) {
    assert.throws(() => startServer(manifest(declaration("service:billing")), { routes: { billing } }, never), /E_SERVER_HANDLERS/);
  }
});

test("route-only registries accept prototype names and need no dummy actions", async () => {
  for (const name of ["__proto__", "constructor", "toString"]) {
    const stop = new AbortController();
    let polled;
    const worker = startServer(manifest(declaration(), name), { routes: { [name]: () => new Response() } }, {
      ...options, signal: stop.signal, fetch: async (_, init) => { polled = JSON.parse(init.body).actions; return aborted(init.signal); },
    });
    let done = false; void worker.done.then(() => { done = true; });
    await delay(1); assert.equal(done, false); assert.deepEqual(polled, [`@route/${name}`]);
    stop.abort(); await finished(worker, stop);
  }
});

test("requests preserve non-UTF8 bytes, duplicate headers and independent copies", async () => {
  const wire = envelope(), first = routeRequest(wire, declaration()), second = routeRequest(wire, declaration());
  assert.equal(Object.isFrozen(first), true); assert.equal(first.method, "POST");
  assert.equal(first.headers.get("X-Signature"), "one, two");
  const bytes = await first.rawBody(); assert.deepEqual([...bytes], [0, 255, 128, 32, 123, 32, 125, 10]);
  bytes.fill(0); first.headers.set("x-signature", "changed");
  assert.equal(Buffer.from(await first.rawBody()).toString("hex"), wire.bodyHex);
  assert.equal(second.headers.get("x-signature"), "one, two");
  assert.equal(Buffer.from(await second.rawBody()).toString("hex"), wire.bodyHex);
});

test("request wire refuses noncanonical bytes, mismatched routes and unbounded headers", () => {
  for (const extra of [{ bodyHex: "FF" }, { bodyHex: "0" }, { bodyHex: "00".repeat(65537) }, { path: "/other" },
    { method: "GET" }, { extra: true }, { headers: [["bad name", "value"]] }, { headers: [["x", "line\nbreak"]] },
    { headers: [["x", "é"]] }, { headers: Array.from({ length: 65 }, () => ["x", "a"]) }, { headers: [["x", "a".repeat(16384)]] }]) {
    assert.throws(() => routeRequest(envelope(extra), declaration()), /E_ROUTE_RESULT/);
  }
  assert.equal(routeRequest(envelope({ bodyHex: "ff".repeat(65536) }), declaration()).path, "/hooks/billing");
});

test("route handles reuse A2 authority and return exact buffered bytes and independent cookies", async () => {
  let ctx;
  const result = await invoke(async (request, context) => {
    ctx = context;
    assert.equal(context.principal, "member:alice"); assert.equal(context.invocation.id, "route-invocation");
    assert.match(context.writeIdFor("save"), /^[0-7][0-9A-HJKMNP-TV-Z]{25}$/);
    assert.deepEqual(Object.keys(context.secrets), ["HOOK_KEY"]);
    assert.equal(context.secrets.HOOK_KEY, "hook-secret"); assert.equal(Object.isFrozen(context.secrets), true);
    return new Response(await request.rawBody(), { status: 201, headers: [["set-cookie", "a=1"], ["set-cookie", "b=2"]] });
  }, { secrets: ["HOOK_KEY"], env: { HOOK_KEY: "hook-secret", UNDECLARED: "other" } });
  assert.deepEqual(result.settled.body.result, { status: 201, headers: [["set-cookie", "a=1"], ["set-cookie", "b=2"]], bodyHex: envelope().bodyHex });
  assert.equal(ctx.invocation.signal.aborted, true);
});

test("route contract and secret refusals precede the application handler", async () => {
  let calls = 0;
  const handler = () => { calls++; return new Response(); };
  const stale = await invoke(handler, { claim: { contract: "old" }, secrets: ["MISSING"] });
  assert.equal(stale.settled.body.code, "E_ACTION_GENERATION");
  const missing = await invoke(handler, { secrets: ["MISSING"] });
  assert.equal(missing.settled.body.code, "E_SECRET_MISSING"); assert.equal(calls, 0);
});

test("plain application GiveUp is a redacted bounded bare 204; infrastructure and ParkStep never acknowledge", async () => {
  const refusal = await invoke(() => { throw new GiveUp("hook-secret " + "😀".repeat(1000)); }, { secrets: ["HOOK_KEY"], env: { HOOK_KEY: "hook-secret" } });
  const response = refusal.settled.body.result;
  assert.equal(response.status, 204); assert.deepEqual(response.headers, []); assert.equal(response.bodyHex, "");
  assert.ok(Buffer.byteLength(response.applicationRefusal) <= 2000); assert.match(response.applicationRefusal, /\[REDACTED\]/);
  assert.doesNotMatch(JSON.stringify(refusal), /hook-secret/);
  for (const error of [new ServerError("E_SECRET_MISSING", "missing"), new ParkStep(), Error("transient")]) {
    const result = await invoke(() => { throw error; });
    assert.match(result.settled.path, /\/failed$/); assert.equal(result.settled.body.retry, !(error instanceof GiveUp));
  }
});

test("an explicit 5xx response retries; invalid output is terminal", async () => {
  const retry = await invoke(() => new Response("must not be cached or logged", { status: 503 }));
  assert.equal(retry.settled.body.retry, true); assert.doesNotMatch(JSON.stringify(retry), /must not be cached/);
  for (const output of [{ status: 200 }, Response.error(), new Response("x", { headers: { "content-length": "1" } })]) {
    const result = await invoke(() => output);
    assert.equal(result.settled.body.retry, false); assert.equal(result.settled.body.code, "E_ROUTE_RESULT");
  }
});

test("Response buffering enforces byte/header/status bounds without awaiting an uncooperative cancel", async () => {
  let cancelled = false;
  const response = new Response(new ReadableStream({ start(controller) { controller.enqueue(new Uint8Array(65537)); },
    cancel() { cancelled = true; return new Promise(() => {}); } }));
  await assert.rejects(routeResponse(response, new AbortController().signal), /E_ROUTE_RESULT/);
  assert.equal(cancelled, true);
  for (const response of [new Response(null, { headers: Array.from({ length: 65 }, (_, i) => [`x-${i}`, "v"]) }),
    new Response(null, { headers: { x: "a".repeat(16384) } }), new Response(null, { headers: { x: "é" } })]) {
    await assert.rejects(routeResponse(response, new AbortController().signal), /E_ROUTE_RESULT/);
  }
  for (const status of [204, 205, 304]) assert.deepEqual(await routeResponse(new Response(null, { status }), new AbortController().signal), { status, headers: [], bodyHex: "" });
  const full = await routeResponse(new Response(new Uint8Array(65536)), new AbortController().signal);
  assert.equal(full.bodyHex.length, 131072);
});

test("Response buffering refuses consumed/locked bodies and bounds stalled reads", async () => {
  const consumed = new Response("used"); await consumed.text();
  await assert.rejects(routeResponse(consumed, new AbortController().signal), /E_ROUTE_RESULT/);
  const locked = new Response("locked"), reader = locked.body.getReader();
  try { await assert.rejects(routeResponse(locked, new AbortController().signal), /E_ROUTE_RESULT/); } finally { reader.releaseLock(); }
  let cancelled = false;
  const stalled = new Response(new ReadableStream({ cancel() { cancelled = true; } }));
  await assert.rejects(routeResponse(stalled, new AbortController().signal, 5), /time bound/);
  assert.equal(cancelled, true);
});

test("empty response chunks cannot starve the byte buffer or deadline", async () => {
  let cancelled = false;
  const response = new Response(new ReadableStream({ pull(controller) { controller.enqueue(new Uint8Array()); }, cancel() { cancelled = true; } }));
  await assert.rejects(routeResponse(response, new AbortController().signal, 5), /time bound/);
  assert.equal(cancelled, true);
});

test("an invocation cancellation aborts Response reading before settlement", async () => {
  let cancelled = false;
  const result = await invoke(() => new Response(new ReadableStream({ cancel() { cancelled = true; } })), { cancel: true });
  assert.equal(cancelled, true); assert.equal(result.settled.body.code, "E_ACTION_CANCELLED");
  assert.equal(result.settled.body.retry, false);
});

test("verification has only scoped secrets/signal and settles exact booleans, not truthiness", async () => {
  for (const [value, disposition] of [[true, "allow"], [false, "deny"], ["true", "unavailable"], [1, "unavailable"], [null, "unavailable"]]) {
    const result = await verify(async (request, ctx) => {
      assert.deepEqual(Object.keys(ctx).sort(), ["secrets", "signal"]); assert.equal(Object.isFrozen(ctx), true);
      assert.equal(Object.getPrototypeOf(ctx.secrets), null); assert.equal(Object.isFrozen(ctx.secrets), true);
      assert.deepEqual(Object.keys(ctx.secrets), ["HOOK_KEY"]); assert.equal(ctx.secrets.HOOK_KEY, "hook-secret");
      assert.equal(Buffer.from(await request.rawBody()).toString("hex"), envelope().bodyHex);
      return value;
    }, { secrets: ["HOOK_KEY"], env: { HOOK_KEY: "hook-secret", OTHER_KEY: "not scoped" } });
    assert.deepEqual(result.settlements[0].body, { disposition }); assert.equal(result.worker.principal(), "service:worker");
    assert.equal(result.requests.filter(r => r.path === "/routes/verify/claim").length <= 2, true);
  }
});

test("verifier exceptions/missing secrets/stale contracts are unavailable, without secret/fence disclosure", async () => {
  const thrown = await verify(() => { throw Error("hook-secret verify-fence service-token"); }, { secrets: ["HOOK_KEY"], env: { HOOK_KEY: "hook-secret" } });
  assert.deepEqual(thrown.settlements[0].body, { disposition: "unavailable" });
  for (const error of thrown.errors) assert.doesNotMatch(error.message, /hook-secret|verify-fence|service-token/);
  let calls = 0;
  for (const configuration of [{ secrets: ["MISSING"] }, { claims: [ticket({ contract: "stale" })] }]) {
    const result = await verify(() => { calls++; return true; }, configuration);
    assert.deepEqual(result.settlements[0].body, { disposition: "unavailable" });
  }
  assert.equal(calls, 0);
});

test("lost verification settlement never repeats the callback or disposition locally", async () => {
  let calls = 0;
  const result = await verify(() => { calls++; return true; }, { settlementLost: true });
  assert.equal(calls, 1); assert.equal(result.settlements.length, 1);
  assert.deepEqual(result.settlements[0].body, { disposition: "allow" });
});

test("all service routes share one poll and a hard four-callback batch cap", async () => {
  const stop = new AbortController(), entered = deferred(), release = deferred();
  let polls = 0, active = 0;
  const handler = { async verify() { if (++active === 4) entered.resolve(); await release.promise; return true; }, handle: () => new Response() };
  const schema = manifest(declaration("service:billing"));
  schema.routes.other = { ...declaration("service:other"), path: "/hooks/other" };
  const worker = startServer(schema, { routes: { billing: handler, other: handler } }, { ...options, batch: 100, signal: stop.signal, onError() {},
    fetch: async (url, init) => {
      const path = new URL(url).pathname;
      if (path === "/actions/claim-set") return aborted(init.signal);
      assert.equal(path, "/routes/verify/claim");
      const body = JSON.parse(init.body);
      assert.deepEqual(body.routes.sort(), ["billing", "other"]); assert.equal(body.limit, 4); polls++;
      return Response.json({ requests: Array.from({ length: 4 }, (_, i) => ticket({ id: `ticket-${i}`, route: i % 2 ? "other" : "billing", request: envelope({ path: i % 2 ? "/hooks/other" : "/hooks/billing" }) })) });
    },
  });
  try { await enteredWithin(entered.promise); assert.equal(active, 4); assert.equal(polls, 1); }
  finally { stop.abort(); release.resolve(); await finished(worker, stop); }
});

test("verifier deadlines use the server clock, suppress late settlement, and retain uncooperative callback slots", async () => {
  const stop = new AbortController(), entered = deferred(), release = deferred();
  let claims = 0, settlements = 0, signal, done = false;
  const worker = startServer(manifest(declaration("service:billing")), { routes: { billing: {
    async verify(_, ctx) { signal = ctx.signal; entered.resolve(); await release.promise; return true; }, handle: () => new Response(),
  } } }, { ...options, signal: stop.signal, onError() {}, fetch: async (url, init) => {
    const path = new URL(url).pathname;
    if (path === "/actions/claim-set") return aborted(init.signal);
    if (path === "/routes/verify/claim") { claims++; return Response.json({ requests: [ticket({ now: 100, deadline: 120 })] }); }
    settlements++; return Response.json({ ok: true });
  } });
  void worker.done.then(() => { done = true; });
  try {
    await enteredWithin(entered.promise); await delay(40);
    assert.equal(signal.aborted, true); assert.equal(claims, 1); assert.equal(settlements, 0);
    stop.abort(); await delay(1); assert.equal(done, false);
  } finally { stop.abort(); release.resolve(); await finished(worker, stop); }
  assert.equal(settlements, 0);
});

test("action authentication loss stops the verifier callback and both loops", async () => {
  const stop = new AbortController(), entered = deferred(), auth = deferred();
  let verificationSignal, settlements = 0;
  const worker = startServer(manifest(declaration("service:billing")), { routes: { billing: {
    async verify(_, ctx) { verificationSignal = ctx.signal; entered.resolve(); await aborted(ctx.signal); return true; }, handle: () => new Response(),
  } } }, { ...options, signal: stop.signal, onError() {}, fetch: async (url, init) => {
    if (new URL(url).pathname === "/actions/claim-set") { await auth.promise; return Response.json({ denied: { code: "E_AUTH", family: "auth", message: "ended" } }); }
    if (new URL(url).pathname === "/routes/verify/claim") return Response.json({ requests: [ticket()] });
    settlements++; return Response.json({ ok: true });
  } });
  try { await enteredWithin(entered.promise); auth.resolve(); await finished(worker, stop); }
  finally { auth.resolve(); stop.abort(); }
  assert.equal(verificationSignal.aborted, true); assert.equal(settlements, 0);
});

test("verifier authentication loss aborts an in-flight A2 route context", async () => {
  const stop = new AbortController(), entered = deferred();
  let context, claimed = false;
  const worker = startServer(manifest(declaration("service:billing")), { routes: { billing: {
    verify: () => true,
    async handle(_, ctx) { context = ctx; entered.resolve(); await aborted(ctx.invocation.signal); return new Response(); },
  } } }, { ...options, signal: stop.signal, onError() {}, fetch: async (url, init) => {
    const path = new URL(url).pathname;
    if (path === "/actions/claim-set" && !claimed) { claimed = true; return Response.json({ requests: [claim()] }); }
    if (path === "/routes/verify/claim") { await entered.promise; return Response.json({ denied: { code: "E_AUTH", family: "auth", message: "ended" } }); }
    return aborted(init.signal);
  } });
  await finished(worker, stop); assert.equal(context.invocation.signal.aborted, true);
});

test("runWorker aborts before calling its auth lifecycle hook, even when the hook throws", async () => {
  const errors = []; let transportSignal, called = 0;
  const worker = runWorker({ ...options, actions: { work() {} }, onError: error => errors.push(error),
    onAuthFailure() { called++; assert.equal(transportSignal.aborted, true); throw Error("hook threw"); },
    fetch: async (_, init) => { transportSignal = init.signal; return Response.json({ denied: { code: "E_AUTH", family: "auth", message: "ended" } }); },
  });
  await worker.done; assert.equal(called, 1); assert.ok(errors.some(error => error.message === "hook threw"));
});

test("more than 128 verifiers rotate bounded chunks past empty groups in one poll loop", async () => {
  const names = Array.from({length:257}, (_, i) => `route-${i}`), stop = new AbortController(), polls = [], checked = [], errors = [];
  const chunks = [names.slice(0, 128), names.slice(128, 256), names.slice(256)];
  const routes = Object.fromEntries(names.map(name => [name, {...declaration("service:provider"), path:`/hooks/${name}`} ]));
  let actionPolls = 0, activePolls = 0, maximumPolls = 0, settlements = 0;
  const worker = startServer({actions:{}, effects:{}, routes}, {routes:Object.fromEntries(names.map(name => [name, {
    verify(request) { checked.push(name); assert.equal(request.path, `/hooks/${name}`); return true; }, handle:() => new Response(),
  }]))}, {...options, signal:stop.signal, batch:2, wait:25,
    onError(error) { errors.push(error); stop.abort(); }, fetch:async (url, init) => {
      const path = new URL(url).pathname, body = JSON.parse(init.body);
      if (path === "/actions/claim-set") { actionPolls++; return aborted(init.signal); }
      if (path === "/routes/verify/claim") {
        maximumPolls = Math.max(maximumPolls, ++activePolls);
        try {
          const index = polls.length % chunks.length; polls.push(body.routes);
          assert.deepEqual(body.routes, chunks[index]); assert.equal(body.wait, 1); assert.equal(body.limit, 2);
          // Two empty chunks must not conceal work in the final chunk, and
          // one complete rotation must not stop registration polling.
          return Response.json({requests:index === 2 ? [ticket({id:`ticket-${polls.length}`, route:names[256], request:envelope({path:`/hooks/${names[256]}`})})] : []});
        } finally { activePolls--; }
      }
      assert.match(path, /^\/routes\/verify\/ticket-\d+\/settle$/);
      assert.deepEqual(body, {disposition:"allow"}); assert.equal(init.headers["x-snapback-route-lease"], "verify-fence");
      if (++settlements === 2) stop.abort();
      return Response.json({ok:true});
    },
  });
  await finished(worker, stop);
  assert.deepEqual(errors, []); assert.deepEqual(polls, [...chunks, ...chunks]);
  assert.deepEqual(checked, [names[256], names[256]]); assert.equal(settlements, 2);
  assert.equal(actionPolls, 1); assert.equal(maximumPolls, 1);
});

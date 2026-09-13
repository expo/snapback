import assert from "node:assert/strict";
import http from "node:http";
import test from "node:test";
import { createEffectRunner } from "../dist/effect-runner.mjs";

const DEFAULT_TEST_LIMITS = {
  durationMs: 3_000,
  memoryMb: 192,
  settlementRetryMs: 5,
  closeDrainMs: 300,
  childExitMs: 300,
};

class FakeWorker {
  constructor(claims, settle) {
    this.claims = [...claims];
    this.settleImpl = settle;
    this.calls = [];
    this.settlements = [];
    this.thenRuns = 0;
    this.seq = 10;
  }
  async request(method, params = {}) {
    this.calls.push({ method, params: structuredClone(params) });
    if (method === "effect.claim") {
      const claim = this.claims.shift() ?? null;
      return { failed: [], claim, recoveredThen: null, more: this.claims.length > 0 };
    }
    assert.equal(method, "effect.settle");
    this.settlements.push(structuredClone(params));
    if (this.settleImpl) return this.settleImpl(params, this);
    if (params.state === "sent") this.thenRuns++;
    return settlementResponse(params, ++this.seq);
  }
}

function effectClaim(source, { id = "outbox-1", effect = "delivery.send", payload = null, grants = [], attempts = 1, then = "delivery.record" } = {}) {
  return {
    row: {
      id, effect, payload, state: "running", attempts, generation: "generation-1",
      seq: 1, nextAt: 0, lastError: null, result: null, then,
    },
    declaration: { name: effect, source, grants, then },
  };
}

function settlementResponse(params, seq = 11) {
  return {
    row: {
      id: params.id, effect: "delivery.send", payload: null, state: params.state,
      attempts: 1, generation: "generation-1", thenSeq: params.state === "sent" ? seq : null,
    },
    seq,
  };
}

async function runClaims(claims, { limits, settle, childEntry } = {}) {
  const worker = new FakeWorker(Array.isArray(claims) ? claims : [claims], settle);
  const events = [];
  const commits = [];
  const runner = createEffectRunner({
    worker,
    onCommit: commit => commits.push(commit),
    onEvent: event => events.push(event),
    log() {},
    limits: { ...DEFAULT_TEST_LIMITS, ...limits },
    childEntry,
  });
  runner.poke();
  await waitFor(() => worker.settlements.length > 0 || events.some(event => event.state === "outcome_unknown"), 8_000);
  await runner.close();
  return { worker, events, commits };
}

test("granted loopback fetch preserves stable meta.id and settles through worker then custody", async () => {
  const seen = [];
  const server = await listen((request, response) => {
    let body = "";
    request.setEncoding("utf8");
    request.on("data", chunk => { body += chunk; });
    request.on("end", () => {
      seen.push({ method: request.method, id: request.headers["idempotency-key"], body });
      response.setHeader("content-type", "application/json");
      response.end(JSON.stringify({ providerId: "provider-1" }));
    });
  });
  try {
    const source = `async (payload, tools) => {
      const response = await tools.fetch(payload.url, {
        method: "POST",
        headers: { "content-type": "application/json", "idempotency-key": meta.id },
        body: JSON.stringify({ value: payload.value }),
      });
      return { ...(await response.json()), sameMeta: meta.id === tools.meta.id };
    }`;
    const claim = effectClaim(source, { payload: { url: server.url, value: 7 }, grants: [server.origin] });
    const { worker, commits } = await runClaims(claim);
    assert.deepEqual(seen, [{ method: "POST", id: "outbox-1", body: '{"value":7}' }]);
    assert.deepEqual(worker.settlements[0], { id: "outbox-1", state: "sent", result: { providerId: "provider-1", sameMeta: true } });
    assert.equal(worker.thenRuns, 1, "only fake worker settlement owns the then transition");
    assert.deepEqual(commits, [{ seq: 11, generation: "generation-1" }]);
  } finally { await server.close(); }
});

test("a denied redirect origin fails before the next provider hop", async () => {
  let deniedHits = 0;
  const denied = await listen((_request, response) => { deniedHits++; response.end("wrong"); });
  const granted = await listen((_request, response) => {
    response.statusCode = 302;
    response.setHeader("location", denied.url);
    response.end();
  });
  try {
    const claim = effectClaim(`async payload => { const alias = fetch; const helper = url => alias(url); return (await helper(payload.url)).text() }`, {
      payload: { url: granted.url }, grants: [granted.origin],
    });
    const { worker } = await runClaims(claim);
    assert.equal(deniedHits, 0);
    assert.equal(worker.settlements[0].state, "failed");
    assert.match(worker.settlements[0].error, /^E_EFFECT_GRANT:/);
  } finally { await granted.close(); await denied.close(); }
});

test("authored headers survive while 301/302/303 normalize methods and cross-origin credentials are stripped", async () => {
  const first = [];
  const final = [];
  const target = await listen((request, response) => {
    let body = "";
    request.on("data", chunk => { body += chunk; });
    request.on("end", () => {
      final.push({
        path: request.url, method: request.method, body,
        author: request.headers["x-author"], authorization: request.headers.authorization,
        proxyAuthorization: request.headers["proxy-authorization"], cookie: request.headers.cookie, contentType: request.headers["content-type"],
        contentLength: request.headers["content-length"],
      });
      response.end("ok");
    });
  });
  const source = await listen((request, response) => {
    let body = "";
    request.on("data", chunk => { body += chunk; });
    request.on("end", () => {
      first.push({ path: request.url, method: request.method, body, author: request.headers["x-author"] });
      const status = Number(request.url.slice(2));
      response.statusCode = status;
      response.setHeader("location", `${target.url}/final-${status}`);
      response.end();
    });
  });
  try {
    const code = `async payload => {
      const output = [];
      for (const item of payload.cases) {
        const response = await fetch(payload.base + "/r" + item.status, {
          method: item.method,
          headers: { "x-author": "yes", authorization: "Bearer secret", "proxy-authorization": "Basic secret", cookie: "sid=secret", "content-type": "text/plain" },
          body: "authored-body",
        });
        output.push(await response.text());
      }
      return output;
    }`;
    const claim = effectClaim(code, {
      payload: { base: source.origin, cases: [{ status: 301, method: "POST" }, { status: 302, method: "POST" }, { status: 303, method: "PUT" }] },
      grants: [source.origin, target.origin],
    });
    const { worker } = await runClaims(claim);
    assert.equal(worker.settlements[0].state, "sent", worker.settlements[0].error);
    assert.deepEqual(first.map(value => [value.path, value.method, value.body, value.author]), [
      ["/r301", "POST", "authored-body", "yes"],
      ["/r302", "POST", "authored-body", "yes"],
      ["/r303", "PUT", "authored-body", "yes"],
    ]);
    for (const request of final) {
      assert.equal(request.method, "GET");
      assert.equal(request.body, "");
      assert.equal(request.author, "yes");
      assert.equal(request.authorization, undefined);
      assert.equal(request.proxyAuthorization, undefined);
      assert.equal(request.cookie, undefined);
      assert.equal(request.contentType, undefined);
      assert.equal(request.contentLength, undefined);
    }
  } finally { await source.close(); await target.close(); }
});

test("empty grants deny network before any provider call", async () => {
  let hits = 0;
  const server = await listen((_request, response) => { hits++; response.end("wrong"); });
  try {
    const { worker } = await runClaims(effectClaim(`payload => fetch(payload.url)`, { payload: { url: server.url }, grants: [] }));
    assert.equal(hits, 0);
    assert.equal(worker.settlements[0].state, "failed");
    assert.match(worker.settlements[0].error, /^E_EFFECT_GRANT:/);
  } finally { await server.close(); }
});

test("request, response, concurrent fetch, and result bounds fail closed", async () => {
  let hits = 0;
  const server = await listen((request, response) => {
    hits++;
    if (request.url === "/large") {
      response.setHeader("content-length", "100");
      response.end("x".repeat(100));
      return;
    }
    setTimeout(() => response.end("ok"), 150);
  });
  try {
    const request = await runClaims(effectClaim(`payload => fetch(payload.url, { method: "POST", body: "x".repeat(100) })`, {
      payload: { url: server.url }, grants: [server.origin],
    }), { limits: { requestBytes: 16 } });
    assert.equal(hits, 0, "oversized authored bodies refuse before dispatch");
    assert.match(request.worker.settlements[0].error, /^E_EFFECT_REQUEST_TOO_LARGE:/);

    const response = await runClaims(effectClaim(`async payload => (await fetch(payload.url)).text()`, {
      payload: { url: `${server.origin}/large` }, grants: [server.origin],
    }), { limits: { responseBytes: 16 } });
    assert.match(response.worker.settlements[0].error, /^E_EFFECT_RESPONSE_TOO_LARGE:/);

    const concurrent = await runClaims(effectClaim(`payload => Promise.all([
      fetch(payload.url), fetch(payload.url), fetch(payload.url)
    ])`, { payload: { url: server.url }, grants: [server.origin] }), {
      limits: { concurrentFetches: 2 },
    });
    assert.match(concurrent.worker.settlements[0].error, /^E_EFFECT_FETCH_LIMIT:/);

    const result = await runClaims(effectClaim(`() => ({ value: "x".repeat(100) })`), { limits: { resultBytes: 32 } });
    assert.match(result.worker.settlements[0].error, /^E_EFFECT_RESULT:/);
  } finally { await server.close(); }
});

test("SES constructors, response values, Headers, URL, and Error expose no ambient Node authority", async () => {
  const server = await listen((_request, response) => { response.end("ok"); });
  try {
    const code = `async payload => {
      const response = await fetch(payload.url);
      const values = [response, response.headers, new Headers(), new URL(payload.url), new Error("x"), {}, [], async function () {}];
      const blocked = values.map(() => []);
      for (let i = 0; i < values.length; i++) {
        for (const name of ["process", "require", "fetch"]) {
          try { values[i].constructor.constructor("return " + name)(); blocked[i].push(false); }
          catch { blocked[i].push(true); }
        }
      }
      const url = new URL(payload.url);
      const blobAuthority = typeof URL.createObjectURL !== "undefined"
        || typeof Object.getPrototypeOf(url).constructor.createObjectURL !== "undefined"
        || typeof Object.getPrototypeOf(Object.getPrototypeOf(url)).constructor.createObjectURL !== "undefined";
      return { blocked, blobAuthority, text: await response.text() };
    }`;
    const { worker } = await runClaims(effectClaim(code, { payload: { url: server.url }, grants: [server.origin] }));
    assert.equal(worker.settlements[0].state, "sent", worker.settlements[0].error);
    const result = worker.settlements[0].result;
    assert.equal(result.blobAuthority, false);
    assert.equal(result.text, "ok");
    assert.ok(result.blocked.flat().every(Boolean));
    const imported = await runClaims(effectClaim(`async () => import("node:fs")`, { id: "import-attempt" }));
    assert.equal(imported.worker.settlements[0].state, "failed");
    assert.match(imported.worker.settlements[0].error, /^E_EFFECT_SOURCE:.*SES_IMPORT_REJECTED/);
  } finally { await server.close(); }
});

test("declared ES2020 globals perform representative work inside the compartment", async () => {
  const code = `async (_payload, { meta }) => {
    const bytes = new TextEncoder().encode("héllo");
    const view = new DataView(new ArrayBuffer(8)); view.setBigInt64(0, 42n);
    const url = new URL("/a?b=2&a=1", "https://example.test"); url.searchParams.sort();
    const headers = new Headers([["X-Test", "one"]]); headers.append("x-test", "two");
    const proxied = new Proxy({ value: 3 }, { get: Reflect.get });
    const timerArgs = await new Promise(resolve => setTimeout((a, b) => resolve(a + b), 5, 2, 3));
    return {
      array: Array.from(new Set([1, 1, 2])).join(","), map: new Map([["x", 4]]).get("x"),
      big: String(view.getBigInt64(0) + BigInt(1)), typed: new Uint16Array([513])[0],
      text: new TextDecoder().decode(bytes), url: url.toString(), canParse: URL.canParse(url),
      parsed: URL.parse(url).hostname, headers: headers.get("x-test"), date: Date.UTC(2020, 0, 2),
      intl: new Intl.DateTimeFormat("en-US", { timeZone: "UTC", year: "numeric" }).format(new Date(0)),
      number: new Intl.NumberFormat("en-US", { useGrouping: false }).format(1234),
      regexp: /^\\p{Letter}+$/u.test("é"), proxy: proxied.value, symbol: Symbol.keyFor(Symbol.for("effect")),
      base64: atob(btoa("abc")), uri: decodeURIComponent(encodeURIComponent("a b")), id: meta.id,
      timerArgs, now: Date.now() > 0, random: Math.random() >= 0 && Math.random() < 1,
    };
  }`;
  const { worker } = await runClaims(effectClaim(code));
  assert.equal(worker.settlements[0].state, "sent");
  assert.deepEqual(worker.settlements[0].result, {
    array: "1,2", map: 4, big: "43", typed: 513, text: "héllo",
    url: "https://example.test/a?a=1&b=2", canParse: true, parsed: "example.test",
      headers: "one, two", date: 1577923200000, intl: "1970", number: "1234",
    regexp: true, proxy: 3, symbol: "effect", base64: "abc", uri: "a b", id: "outbox-1",
    timerArgs: 5, now: true, random: true,
  });
});

test("infinite loops and rejected promises are bounded without blocking the parent", async () => {
  let ticks = 0;
  const ticker = setInterval(() => { ticks++; }, 10);
  try {
    const loop = await runClaims(effectClaim(`() => { for (;;) {} }`), { limits: { durationMs: 180 } });
    assert.equal(loop.worker.settlements[0].state, "queued");
    assert.match(loop.worker.settlements[0].error, /^E_EFFECT_TIMEOUT:/);
    assert.ok(ticks >= 5, `parent timer advanced only ${ticks} times`);
    const rejected = await runClaims(effectClaim(`async () => { throw new Error("provider broke") }`));
    assert.equal(rejected.worker.settlements[0].state, "queued");
    assert.match(rejected.worker.settlements[0].error, /^E_EFFECT_RUN: provider broke/);
  } finally { clearInterval(ticker); }
});

test("stray timers and fetches are cancelled when a successful result is sent", async () => {
  let hits = 0;
  const server = await listen((_request, response) => { hits++; setTimeout(() => response.end("late"), 250); });
  try {
    const code = `async payload => {
      setTimeout(() => console.log("late timer"), 1000);
      fetch(payload.url).catch(() => {});
      return { done: true };
    }`;
    const { worker, events } = await runClaims(effectClaim(code, { payload: { url: server.url }, grants: [server.origin] }));
    assert.equal(worker.settlements[0].state, "sent");
    const executed = events.find(event => event.state === "executed");
    assert.ok(executed.capture.stray.timers >= 1);
    const after = hits;
    await new Promise(resolve => setTimeout(resolve, 350));
    assert.equal(hits, after, "no child work survived settlement");
  } finally { await server.close(); }
});

test("console output is capped and does not flood the parent process", async () => {
  const code = `() => { for (let i = 0; i < 5000; i++) console.log("line", i); return { ok: true } }`;
  const { worker, events } = await runClaims(effectClaim(code), { limits: { logEntries: 12, logBytes: 2048 } });
  assert.equal(worker.settlements[0].state, "sent");
  const logs = events.find(event => event.state === "executed").capture.logs;
  assert.equal(logs.entries.length, 12);
  assert.equal(logs.truncated, true);
  assert.ok(logs.bytes <= 2048);
  assert.match(logs.entries[0].values[0], /^\[string \d+ bytes\]$/);
  assert.equal(JSON.stringify(logs).includes("line"), false, "operator capture carries no authored string contents");
});

test("old-space OOM, external allocation, and an immediate child crash stay confined", { timeout: 15_000 }, async () => {
  const oom = `() => { const hold = []; for (;;) hold.push(new Array(100000).fill({ value: hold.length })) }`;
  const outcome = await runClaims(effectClaim(oom), { limits: { memoryMb: 96, durationMs: 5_000 } });
  assert.equal(outcome.worker.settlements[0].state, "queued");
  assert.match(outcome.worker.settlements[0].error, /^E_EFFECT_(CHILD_EXIT|TIMEOUT):/);

  const external = `async () => {
    const bytes = new Uint8Array(128 * 1024 * 1024);
    for (let at = 0; at < bytes.length; at += 4096) bytes[at] = 1;
    await new Promise(resolve => setTimeout(resolve, 1000));
    return { impossible: bytes[0] };
  }`;
  const externalOutcome = await runClaims(effectClaim(external, { id: "external-allocation" }), {
    limits: { memoryMb: 96, durationMs: 5_000 },
  });
  assert.equal(externalOutcome.worker.settlements[0].state, "queued");
  assert.match(externalOutcome.worker.settlements[0].error, /^E_EFFECT_CHILD_EXIT:/);

  const crashChild = new URL("./fixtures/effect-crash-child.mjs", import.meta.url);
  const crash = await runClaims(effectClaim(`() => null`), { childEntry: crashChild });
  assert.equal(crash.worker.settlements[0].state, "queued");
  assert.match(crash.worker.settlements[0].error, /^E_EFFECT_CHILD_EXIT:/);
});

test("lost effect.settle replies retry the identical row identity without provider replay", async () => {
  let applied;
  let calls = 0;
  const settle = async (params, worker) => {
    calls++;
    if (!applied) applied = structuredClone(params);
    assert.deepEqual(params, applied);
    if (calls === 1) throw Object.assign(new Error("reply lost"), { code: "S3_WORKER_EXIT" });
    worker.thenRuns++;
    return settlementResponse(applied, 41);
  };
  const { worker, commits } = await runClaims(effectClaim(`(_payload, { meta }) => ({ providerId: meta.id })`), { settle });
  assert.equal(calls, 2);
  assert.equal(applied.id, "outbox-1");
  assert.deepEqual(applied.result, { providerId: "outbox-1" });
  assert.equal(worker.calls.filter(call => call.method === "effect.claim").length, 1);
  assert.deepEqual(commits, [{ seq: 41, generation: "generation-1" }]);
});

test("one poke claims only its configured bounded page", async () => {
  const statefulSource = `(() => { const state = { count: 0 }; return () => ({ count: ++state.count }) })()`;
  const claims = [1, 2, 3].map(number => effectClaim(statefulSource, { id: `bounded-${number}` }));
  const worker = new FakeWorker(claims);
  const events = [];
  const runner = createEffectRunner({
    worker, onCommit() {}, onEvent: event => events.push(event), log() {},
    limits: { ...DEFAULT_TEST_LIMITS, claimsPerPoke: 2 },
  });
  runner.poke();
  await waitFor(() => worker.settlements.length === 2);
  await new Promise(resolve => setTimeout(resolve, 100));
  assert.equal(worker.settlements.length, 2);
  assert.deepEqual(worker.settlements.map(value => value.result), [{ count: 1 }, { count: 1 }], "fresh children share no writable source globals");
  assert.ok(events.some(event => event.state === "work_remaining"));
  runner.poke();
  await waitFor(() => worker.settlements.length === 3);
  assert.deepEqual(worker.settlements[2].result, { count: 1 });
  await runner.close();
});

test("an abnormal exit after an acknowledged dispatch remains durably ambiguous", async () => {
  const server = await listen((_request, _response) => { /* keep the request open until child termination */ });
  try {
    const source = `async payload => { await fetch(payload.url); return { impossible: true } }`;
    const worker = new FakeWorker([effectClaim(source, { payload: { url: server.url }, grants: [server.origin] })]);
    const events = [];
    const runner = createEffectRunner({
      worker, onCommit() {}, onEvent: event => events.push(event), log() {},
      limits: { ...DEFAULT_TEST_LIMITS, durationMs: 180 },
    });
    runner.poke();
    await waitFor(() => events.some(event => event.state === "outcome_unknown"), 5_000);
    await runner.close();
    assert.equal(worker.settlements.length, 0, "runner must leave running custody for startup effect.recover");
    assert.equal(events.find(event => event.state === "outcome_unknown").code, "E_EFFECT_TIMEOUT");
  } finally { await server.close(); }
});

test("close kills and accounts for a tracked non-cooperative child within its own bound", async () => {
  const worker = new FakeWorker([effectClaim(`() => { for (;;) {} }`)]);
  const events = [];
  const runner = createEffectRunner({
    worker, onCommit() {}, onEvent: event => events.push(event), log() {},
    limits: { ...DEFAULT_TEST_LIMITS, durationMs: 30_000, closeDrainMs: 100, childExitMs: 200 },
  });
  runner.poke();
  await waitFor(() => events.some(event => event.state === "running"));
  const started = Date.now();
  await runner.close();
  assert.ok(Date.now() - started < 1_500);
  await waitFor(() => worker.settlements.length > 0);
  assert.equal(worker.settlements[0].state, "queued");
});

async function listen(handler) {
  const server = http.createServer(handler);
  await new Promise((resolve, reject) => {
    server.once("error", reject);
    server.listen(0, "127.0.0.1", resolve);
  });
  const address = server.address();
  const origin = `http://127.0.0.1:${address.port}`;
  return {
    origin,
    url: `${origin}/`,
    close: () => new Promise((resolve, reject) => server.close(error => error ? reject(error) : resolve())),
  };
}

async function waitFor(predicate, timeout = 5_000) {
  const deadline = Date.now() + timeout;
  while (!predicate()) {
    if (Date.now() >= deadline) throw new Error("timed out waiting for effect runner");
    await new Promise(resolve => setTimeout(resolve, 10));
  }
}

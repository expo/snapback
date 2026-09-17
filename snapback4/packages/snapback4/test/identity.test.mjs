// Signed local protocol double. Real-provider qualification is a separate, credentials-gated fixture.
import test from "node:test";
import assert from "node:assert/strict";
import { createHash, createHmac, generateKeyPairSync, sign } from "node:crypto";
import { createServer } from "node:http";
import { setTimeout as delay } from "node:timers/promises";
import { oidcHandlers } from "../dist/identity.js";
import { startServer } from "../dist/server.js";

const CLIENT_ID = "snapback4-b1a";
const CLIENT_SECRET = "local-double-client-secret";
const REDIRECT_URI = "http://127.0.0.1:38972/auth/callback";
const ACCESS_TOKEN = "access-token-must-not-persist";
const REFRESH_TOKEN = "refresh-token-must-not-persist";
const SESSION_TOKEN = "session-token-final-result-only";
const op = (kind, name) => ({ kind, name });
const operations = {
  byInvocation: op("query", "identity.byInvocation"),
  byState: op("query", "identity.byState"),
  begin: op("mutation", "identity.begin"),
  claim: op("mutation", "identity.claim"),
  verified: op("mutation", "identity.verified"),
};
const manifest = {
  actions: {
    beginOidc: { contract: "begin-v1", secrets: ["OIDC_CLIENT_SECRET"] },
    completeOidc: { contract: "complete-v1", secrets: ["OIDC_CLIENT_SECRET"] },
  },
  effects: {},
};

const b64 = value => Buffer.from(value).toString("base64url");
const bindingHash = value => createHash("sha256").update(value).digest("base64url");
const pkce = value => createHash("sha256").update(value).digest("base64url");
const key = kid => {
  const pair = generateKeyPairSync("rsa", { modulusLength: 2048 });
  return { kid, ...pair, jwk: { ...pair.publicKey.export({ format: "jwk" }), kid, use: "sig", alg: "RS256" } };
};
const signedJwt = (signingKey, claims, header = {}) => {
  const protectedHeader = { alg: "RS256", typ: "JWT", kid: signingKey.kid, ...header };
  const input = `${b64(JSON.stringify(protectedHeader))}.${b64(JSON.stringify(claims))}`;
  if (protectedHeader.alg === "none") return `${input}.`;
  if (protectedHeader.alg === "HS256") return `${input}.${createHmac("sha256", "wrong-shared-key").update(input).digest("base64url")}`;
  return `${input}.${sign("RSA-SHA256", Buffer.from(input), signingKey.privateKey).toString("base64url")}`;
};

async function localProvider(t) {
  const old = key("old"), rotated = key("rotated"), unknown = key("unknown");
  const codes = new Map(), requests = [];
  let current = old;
  const server = createServer(async (request, response) => {
    const url = new URL(request.url, issuer);
    if (url.pathname.endsWith("/.well-known/openid-configuration")) {
      response.setHeader("content-type", "application/json");
      response.end(JSON.stringify({ issuer, authorization_endpoint: `${issuer}/authorize`, token_endpoint: `${issuer}/token`,
        jwks_uri: `${issuer}/jwks`, response_types_supported: ["code"], subject_types_supported: ["public"],
        id_token_signing_alg_values_supported: ["RS256"], token_endpoint_auth_methods_supported: ["client_secret_post"],
        code_challenge_methods_supported: ["S256"], authorization_response_iss_parameter_supported: true }));
      return;
    }
    if (url.pathname === "/jwks") {
      requests.push({ kind: "jwks", kid: current.kid });
      response.setHeader("content-type", "application/json"); response.end(JSON.stringify({ keys: [current.jwk] })); return;
    }
    if (url.pathname === "/token") {
      const chunks = []; for await (const chunk of request) chunks.push(chunk);
      const form = new URLSearchParams(Buffer.concat(chunks).toString("utf8"));
      const code = form.get("code"), entry = codes.get(code);
      requests.push({ kind: "token", code, form: Object.fromEntries(form) });
      if (!entry || entry.used || form.get("client_id") !== CLIENT_ID || form.get("client_secret") !== CLIENT_SECRET
        || form.get("redirect_uri") !== REDIRECT_URI || pkce(form.get("code_verifier") ?? "") !== entry.challenge) {
        response.writeHead(400, { "content-type": "application/json" }); response.end(JSON.stringify({ error: "invalid_grant" })); return;
      }
      entry.used = true;
      if (entry.behavior.httpError) {
        response.writeHead(400, { "content-type": "application/json" }); response.end(JSON.stringify({ error: "invalid_grant" })); return;
      }
      const now = Math.floor(Date.now() / 1000);
      const claims = { iss: issuer, sub: "subject-42", aud: CLIENT_ID, iat: now, exp: now + 300,
        nonce: entry.nonce, email: "person@example.test", email_verified: true, ...entry.behavior.claims };
      const signingKey = entry.behavior.key === "unknown" ? unknown : current;
      let idToken = signedJwt(signingKey, claims, entry.behavior.header);
      if (entry.behavior.malformed) idToken = "not-a-jwt";
      response.setHeader("content-type", "application/json");
      response.end(JSON.stringify({ access_token: ACCESS_TOKEN, refresh_token: REFRESH_TOKEN, token_type: "Bearer", expires_in: 300, id_token: idToken }));
      return;
    }
    response.writeHead(404); response.end();
  });
  await new Promise((resolve, reject) => { server.once("error", reject); server.listen(0, "127.0.0.1", resolve); });
  const address = server.address();
  const issuer = `http://127.0.0.1:${address.port}`;
  t.after(() => new Promise(resolve => server.close(resolve)));
  return {
    issuer, requests,
    register(code, authorizationUrl, behavior = {}) {
      const url = new URL(authorizationUrl);
      codes.set(code, { challenge: url.searchParams.get("code_challenge"), nonce: url.searchParams.get("nonce"), behavior, used: false });
    },
    rotate() { current = rotated; },
    tokenCalls(code) { return requests.filter(request => request.kind === "token" && request.code === code).length; },
    jwksCalls() { return requests.filter(request => request.kind === "jwks").length; },
  };
}

class FakeCore {
  constructor() {
    this.now = Date.now();
    this.transactions = new Map();
    this.steps = new Map();
    this.mints = 0;
    this.failAfterVerified = 0;
    this.loseMint = 0;
    this.loseActionDone = 0;
    this.allBodies = [];
  }
  byInvocation(invocation) { return [...this.transactions.values()].find(row => row.beginInvocation === invocation) ?? null; }
  byState(state) { return [...this.transactions.values()].find(row => row.state === state) ?? null; }
  async wire(path, body, claim, stop) {
    this.allBodies.push({ path, body: structuredClone(body) });
    if (path === "/actions/claim-set") return { requests: [claim], worker: "service:worker" };
    if (path === `/actions/${claim.id}/status`) return { invocation: { id: claim.id, attempt: claim.attempt, cancelled: false, state: "running" } };
    if (path === `/actions/${claim.id}/done` || path === `/actions/${claim.id}/failed`) {
      this.settled = { path, body: structuredClone(body) };
      stop.abort();
      if (path.endsWith("/done") && this.loseActionDone-- > 0) throw Error("lost action settlement acknowledgement");
      return { ok: true };
    }
    const step = path.match(/^\/actions\/[^/]+\/steps\/([^/]+)\/(begin|done|park)$/);
    if (step) {
      const name = decodeURIComponent(step[1]), verb = step[2], id = `${claim.id}:${name}`;
      const found = this.steps.get(id);
      if (verb === "begin") {
        const input = JSON.stringify(body.input);
        if (found && found.input !== input) return { denied: { code: "E_STEP_INPUT", family: "action", message: "changed step input" } };
        if (found?.state === "done") return { step: { state: "done", key: found.key, result: found.result } };
        if (found) { found.state = "parked"; return { denied: { code: "E_STEP_PARKED", family: "action", message: "uncertain step parked" } }; }
        const created = { input, key: `step:${id}`, state: "started", attempt: claim.attempt };
        this.steps.set(id, created); return { step: { state: "run", key: created.key } };
      }
      if (!found) throw Error("missing step");
      if (verb === "park") { found.state = "parked"; return { ok: true }; }
      found.state = "done"; found.result = structuredClone(body.result); return { ok: true };
    }
    if (path === "/q/identity.byInvocation") return { data: this.byInvocation(body.args.invocation), complete: true };
    if (path === "/q/identity.byState") return { data: this.byState(body.args.state), complete: true };
    if (path === "/m/identity.begin") {
      const row = body.args;
      if (!Number.isInteger(row.createdAt) || !Number.isInteger(row.expiresAt)) {
        return { state: "failed", why: { code: "E_INPUT", family: "input", message: "time must be integer milliseconds" } };
      }
      if (this.byInvocation(row.beginInvocation) || this.byState(row.state)) return { state: "failed", why: { code: "DUPLICATE", family: "constraint", message: "duplicate transaction" } };
      this.transactions.set(row.id, structuredClone(row)); return { state: "sent", id: body.id, seq: 1, result: null };
    }
    if (path === "/m/identity.claim") {
      const row = this.transactions.get(body.args.id);
      if (!row || row.expiresAt <= this.now || (row.completionInvocation !== null && row.completionInvocation !== body.args.completionInvocation)) {
        return { state: "failed", why: { code: "OIDC_CLAIMED", family: "rule", message: "not claimable" } };
      }
      row.completionInvocation = body.args.completionInvocation;
      return { state: "sent", id: body.id, seq: 2, result: null };
    }
    if (path === "/m/identity.verified") {
      const row = this.transactions.get(body.args.id);
      if (!row || row.expiresAt <= this.now || row.completionInvocation !== body.args.completionInvocation) {
        return { state: "failed", why: { code: "OIDC_CLAIMED", family: "rule", message: "not owned" } };
      }
      row.verifiedIssuer = body.args.issuer; row.verifiedSubject = body.args.subject;
      row.email = body.args.email; row.emailVerified = body.args.emailVerified;
      if (this.failAfterVerified-- > 0) throw Error("lost verified mutation response");
      return { state: "sent", id: body.id, seq: 3, result: null };
    }
    if (path === "/auth/session") {
      this.mints++;
      const session = { principal: body.principal, kind: body.kind, token: SESSION_TOKEN, expiresAt: this.now + body.days * 86_400_000 };
      if (this.loseMint-- > 0) throw Error("lost mint response");
      return { session };
    }
    throw Error(`unexpected fake-core path ${path}`);
  }
}

function suite(provider, core = new FakeCore()) {
  const handlers = oidcHandlers({ issuer: provider.issuer, clientId: CLIENT_ID, clientSecret: "OIDC_CLIENT_SECRET",
    redirectURI: REDIRECT_URI, development: { allowInsecureLoopback: true }, transactions: operations });
  let sequence = 0;
  async function invoke(action, args, options = {}) {
    const id = options.id ?? `${action}-${++sequence}`;
    const attempt = options.attempt ?? 1;
    const principal = options.principal ?? "guest:original";
    const claim = { id, action, principal, attempt, at: core.now, now: core.now,
      contract: manifest.actions[action].contract, deadline: null, args,
      session: { token: `action-lease-${id}-${attempt}`, principal, kind: "action", expiresAt: core.now + 60_000 } };
    const stop = new AbortController(), errors = [];
    let claimed = false;
    core.settled = undefined;
    const worker = startServer(manifest, { actions: { beginOidc: handlers.begin, completeOidc: handlers.complete } }, {
      env: { SNAPBACK_URL: "http://core.test", SNAPBACK_SERVICE_TOKEN: "service-token", OIDC_CLIENT_SECRET: CLIENT_SECRET },
      signal: stop.signal, statusIntervalMs: 100, wait: 0, onError: error => errors.push(error),
      fetch: async (url, init) => {
        const path = new URL(url).pathname;
        const body = init.body ? JSON.parse(init.body) : {};
        if (path === "/actions/claim-set") {
          if (claimed) { await delay(10); return { json: async () => ({ requests: [], worker: "service:worker" }) }; }
          claimed = true;
        }
        const reply = await core.wire(path, body, claim, stop);
        return Response.json(reply);
      },
    });
    const timeout = AbortSignal.timeout(4_000);
    try { await Promise.race([worker.done, new Promise((_, reject) => timeout.addEventListener("abort", () => reject(Error("identity invocation timed out")), { once: true }))]); }
    finally { stop.abort(); }
    return { settled: core.settled, errors, id, attempt };
  }
  async function begin(label, options = {}) {
    const binding = `browser-binding-${label}-${"x".repeat(32)}`;
    const result = await invoke("beginOidc", { bindingHash: bindingHash(binding) }, { id: `begin-${label}`, ...options });
    assert.equal(result.settled?.path, `/actions/begin-${label}/done`, JSON.stringify(result));
    return { binding, authorizationUrl: result.settled.body.result.authorizationUrl, state: new URL(result.settled.body.result.authorizationUrl).searchParams.get("state") };
  }
  const callback = (flow, code, extra = {}) => ({
    code, state: flow.state, binding: flow.binding, error: null, iss: provider.issuer, ...extra,
  });
  return { core, invoke, begin, callback };
}

test("OIDC helper runs a signed Authorization Code + S256 flow and persists no provider tokens", async t => {
  const provider = await localProvider(t), s = suite(provider);
  const flow = await s.begin("healthy");
  const url = new URL(flow.authorizationUrl);
  assert.equal(url.origin, provider.issuer);
  assert.equal(url.searchParams.get("redirect_uri"), REDIRECT_URI);
  assert.equal(url.searchParams.get("response_type"), "code");
  assert.equal(url.searchParams.get("code_challenge_method"), "S256");
  assert.equal(url.searchParams.get("scope"), "openid email");
  provider.register("healthy-code", flow.authorizationUrl);
  const result = await s.invoke("completeOidc", s.callback(flow, "healthy-code"), { id: "complete-healthy" });
  assert.equal(result.settled.path, "/actions/complete-healthy/done");
  assert.deepEqual(result.settled.body.result, { principal: result.settled.body.result.principal, kind: "oidc", token: SESSION_TOKEN, expiresAt: s.core.now + 7 * 86_400_000 });
  assert.match(result.settled.body.result.principal, /^oidc:[A-Za-z0-9_-]{43}$/);
  const transaction = s.core.byState(flow.state);
  assert.equal(transaction.verifiedIssuer, provider.issuer); assert.equal(transaction.verifiedSubject, "subject-42");
  assert.equal(transaction.email, "person@example.test"); assert.equal(transaction.emailVerified, true);
  const durable = JSON.stringify({ transactions: [...s.core.transactions.values()], steps: [...s.core.steps.values()] });
  for (const secret of [ACCESS_TOKEN, REFRESH_TOKEN, SESSION_TOKEN, CLIENT_SECRET]) assert.equal(durable.includes(secret), false, secret);
  assert.equal(provider.tokenCalls("healthy-code"), 1); assert.equal(s.core.mints, 1);
});

test("callback, browser, authority, expiry and replay bindings fail closed before repeated effects", async t => {
  const provider = await localProvider(t), s = suite(provider);
  for (const [label, mutate, expected] of [
    ["provider-error", args => ({ ...args, code: null, error: "access_denied" }), "E_OIDC_CALLBACK"],
    ["binding", args => ({ ...args, binding: "wrong-binding-" + "z".repeat(32) }), "E_OIDC_CALLBACK"],
    ["state", args => ({ ...args, state: "wrong-state-" + "z".repeat(32) }), "E_OIDC_TRANSACTION"],
  ]) {
    const flow = await s.begin(label); provider.register(`${label}-code`, flow.authorizationUrl);
    const args = mutate(s.callback(flow, `${label}-code`));
    const result = await s.invoke("completeOidc", args, { id: `complete-${label}` });
    assert.equal(result.settled.body.code, expected, label);
    assert.equal(provider.tokenCalls(`${label}-code`), 0, label);
  }
  const foreign = await s.begin("foreign"); provider.register("foreign-code", foreign.authorizationUrl);
  assert.equal((await s.invoke("completeOidc", s.callback(foreign, "foreign-code"),
    { id: "complete-foreign", principal: "guest:other" })).settled.body.code, "E_OIDC_CALLBACK");
  const expired = await s.begin("expired"); s.core.byState(expired.state).expiresAt = s.core.now - 1;
  assert.equal((await s.invoke("completeOidc", s.callback(expired, "expired-code"),
    { id: "complete-expired" })).settled.body.code, "E_OIDC_CALLBACK");
  const mixup = await s.begin("response-issuer"); provider.register("response-issuer-code", mixup.authorizationUrl);
  assert.equal((await s.invoke("completeOidc", s.callback(mixup, "response-issuer-code", { iss: "http://127.0.0.1:9/other" }),
    { id: "complete-response-issuer" })).settled.body.code, "E_OIDC_EXCHANGE");
  assert.equal(provider.tokenCalls("response-issuer-code"), 0);
  const replay = await s.begin("replay"); provider.register("replay-code", replay.authorizationUrl);
  assert.ok((await s.invoke("completeOidc", s.callback(replay, "replay-code"), { id: "complete-replay-a" })).settled.path.endsWith("/done"));
  const second = await s.invoke("completeOidc", s.callback(replay, "replay-code"), { id: "complete-replay-b" });
  assert.equal(second.settled.body.code, "E_OIDC_REPLAY"); assert.equal(provider.tokenCalls("replay-code"), 1); assert.equal(s.core.mints, 1);
});

test("openid-client rejects hostile ID tokens and an expired authorization code", async t => {
  const provider = await localProvider(t), s = suite(provider);
  const now = Math.floor(Date.now() / 1000);
  const cases = [
    ["malformed", { malformed: true }],
    ["none", { header: { alg: "none" } }],
    ["wrong-alg", { header: { alg: "HS256" } }],
    ["wrong-issuer", { claims: { iss: "http://127.0.0.1:9/other" } }],
    ["wrong-aud", { claims: { aud: "another-client" } }],
    ["wrong-azp", { claims: { aud: [CLIENT_ID, "other"], azp: "other" } }],
    ["wrong-nonce", { claims: { nonce: "another-nonce" } }],
    ["expired-token", { claims: { iat: now - 700, exp: now - 1 } }],
    ["future-iat", { claims: { iat: now + 120, exp: now + 300 } }],
    ["unknown-kid", { key: "unknown" }],
    ["expired-code", { httpError: true }],
  ];
  for (const [label, behavior] of cases) {
    const flow = await s.begin(label); provider.register(`${label}-code`, flow.authorizationUrl, behavior);
    const result = await s.invoke("completeOidc", s.callback(flow, `${label}-code`), { id: `complete-${label}` });
    assert.equal(result.settled.body.code, "E_OIDC_EXCHANGE", label);
    assert.equal(s.core.mints, 0, label);
    const rendered = JSON.stringify({ result, bodies: s.core.allBodies.slice(-20) });
    assert.equal(rendered.includes(ACCESS_TOKEN), false, label); assert.equal(rendered.includes(REFRESH_TOKEN), false, label);
    const defaults = JSON.stringify({ settled: result.settled, errors: result.errors });
    const transaction = s.core.byState(flow.state);
    for (const protectedValue of [`${label}-code`, flow.binding, transaction.pkceVerifier, CLIENT_SECRET, ACCESS_TOKEN, REFRESH_TOKEN, SESSION_TOKEN]) {
      assert.equal(defaults.includes(protectedValue), false, `${label}: default diagnostic exposed protected value`);
    }
  }
});

test("unknown signing-key rotation refreshes JWKS without weakening signature checks", async t => {
  const provider = await localProvider(t), s = suite(provider);
  const first = await s.begin("before-rotation"); provider.register("before-rotation-code", first.authorizationUrl);
  assert.ok((await s.invoke("completeOidc", s.callback(first, "before-rotation-code"), { id: "complete-before-rotation" })).settled.path.endsWith("/done"));
  const before = provider.jwksCalls(); provider.rotate();
  const rotated = await s.begin("after-rotation"); provider.register("after-rotation-code", rotated.authorizationUrl);
  assert.ok((await s.invoke("completeOidc", s.callback(rotated, "after-rotation-code"), { id: "complete-after-rotation" })).settled.path.endsWith("/done"));
  assert.ok(provider.jwksCalls() > before, `JWKS calls ${before} -> ${provider.jwksCalls()}`);
});

test("persisted verification resumes after restart while uncertain mint and lost handoff never mint twice", async t => {
  const provider = await localProvider(t), s = suite(provider);
  const resumed = await s.begin("resume"); provider.register("resume-code", resumed.authorizationUrl);
  s.core.failAfterVerified = 1;
  const first = await s.invoke("completeOidc", s.callback(resumed, "resume-code"), { id: "complete-resume", attempt: 1 });
  assert.equal(first.settled.body.retry, true); assert.equal(provider.tokenCalls("resume-code"), 1); assert.equal(s.core.mints, 0);
  const second = await s.invoke("completeOidc", s.callback(resumed, "resume-code"), { id: "complete-resume", attempt: 2 });
  assert.ok(second.settled.path.endsWith("/done")); assert.equal(provider.tokenCalls("resume-code"), 1); assert.equal(s.core.mints, 1);

  const uncertain = await s.begin("uncertain-mint"); provider.register("uncertain-mint-code", uncertain.authorizationUrl); s.core.loseMint = 1;
  assert.equal((await s.invoke("completeOidc", s.callback(uncertain, "uncertain-mint-code"),
    { id: "complete-uncertain-mint", attempt: 1 })).settled.body.retry, true);
  const parked = await s.invoke("completeOidc", s.callback(uncertain, "uncertain-mint-code"),
    { id: "complete-uncertain-mint", attempt: 2 });
  assert.equal(parked.settled.body.code, "E_STEP_PARKED"); assert.equal(s.core.mints, 2, "one prior healthy mint plus one uncertain mint");

  const lost = await s.begin("lost-handoff"); provider.register("lost-handoff-code", lost.authorizationUrl); s.core.loseActionDone = 1;
  await s.invoke("completeOidc", s.callback(lost, "lost-handoff-code"), { id: "complete-lost-handoff", attempt: 1 });
  const failedClosed = await s.invoke("completeOidc", s.callback(lost, "lost-handoff-code"), { id: "complete-lost-handoff", attempt: 2 });
  assert.equal(failedClosed.settled.body.code, "E_OIDC_HANDOFF");
  assert.equal(provider.tokenCalls("lost-handoff-code"), 1); assert.equal(s.core.mints, 3, "lost handoff did not repeat mint");
});

test("configuration refuses non-HTTPS production and non-literal-loopback development", () => {
  const base = { clientId: CLIENT_ID, clientSecret: "OIDC_CLIENT_SECRET", transactions: operations };
  assert.throws(() => oidcHandlers({ ...base, issuer: "http://provider.example", redirectURI: "https://app.example/callback" }), /E_OIDC_CONFIG/);
  assert.throws(() => oidcHandlers({ ...base, issuer: "http://localhost:8080", redirectURI: "http://localhost:3000/callback",
    development: { allowInsecureLoopback: true } }), /literal-loopback/);
  assert.throws(() => oidcHandlers({ ...base, issuer: "https://provider.example/?tenant=other", redirectURI: "https://app.example/callback" }), /query/);
});

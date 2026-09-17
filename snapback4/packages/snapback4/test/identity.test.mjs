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
const nativeFetch = globalThis.fetch.bind(globalThis);
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
  if (protectedHeader.alg === "HS256") return `${input}.${createHmac("sha256", CLIENT_SECRET).update(input).digest("base64url")}`;
  return `${input}.${sign("RSA-SHA256", Buffer.from(input), signingKey.privateKey).toString("base64url")}`;
};

async function localProvider(t) {
  const old = key("old"), rotated = key("rotated"), unknown = key("unknown");
  const codes = new Map(), requests = [];
  let current = old, unavailable = false, jwksUnavailable = false, nextDiscoveryFailure = null;
  const server = createServer(async (request, response) => {
    const url = new URL(request.url, issuer);
    if (url.pathname.endsWith("/.well-known/openid-configuration")) {
      requests.push({ kind: "discovery" });
      const failure = nextDiscoveryFailure; nextDiscoveryFailure = null;
      if (failure === "503") { response.writeHead(503); response.end(); return; }
      if (failure === "unreadable") {
        response.writeHead(200, { "content-type": "application/json" }); response.end("{"); return;
      }
      if (unavailable) { response.writeHead(503); response.end(); return; }
      response.setHeader("content-type", "application/json");
      response.end(JSON.stringify({ issuer, authorization_endpoint: `${issuer}/authorize`, token_endpoint: `${issuer}/token`,
        jwks_uri: `${issuer}/jwks`, response_types_supported: ["code"], subject_types_supported: ["public"],
        id_token_signing_alg_values_supported: ["RS256"], token_endpoint_auth_methods_supported: ["client_secret_post"],
        code_challenge_methods_supported: ["S256"], authorization_response_iss_parameter_supported: true }));
      return;
    }
    if (url.pathname === "/jwks") {
      requests.push({ kind: "jwks", kid: current.kid });
      if (unavailable || jwksUnavailable) { response.writeHead(503); response.end(); return; }
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
      if (entry.behavior.dropTokenReply) { response.destroy(); return; }
      if (entry.behavior.oauthError) {
        response.writeHead(400, { "content-type": "application/json" });
        response.end(JSON.stringify({ error: entry.behavior.oauthError })); return;
      }
      if (entry.behavior.httpStatus) { response.writeHead(entry.behavior.httpStatus); response.end(); return; }
      if (entry.behavior.unreadableReply) {
        response.writeHead(200, { "content-type": "application/json" }); response.end("{"); return;
      }
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
      response.end(JSON.stringify(entry.behavior.malformedTokenResponse
        ? { token_type: "Bearer", expires_in: 300, id_token: idToken }
        : { access_token: ACCESS_TOKEN, refresh_token: REFRESH_TOKEN, token_type: "Bearer", expires_in: 300, id_token: idToken }));
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
    metadata() { return { issuer, authorization_endpoint: `${issuer}/authorize`, token_endpoint: `${issuer}/token`,
      jwks_uri: `${issuer}/jwks`, response_types_supported: ["code"], subject_types_supported: ["public"],
      id_token_signing_alg_values_supported: ["RS256"], token_endpoint_auth_methods_supported: ["client_secret_post"],
      code_challenge_methods_supported: ["S256"], authorization_response_iss_parameter_supported: true }; },
    register(code, authorizationUrl, behavior = {}) {
      const url = new URL(authorizationUrl);
      codes.set(code, { challenge: url.searchParams.get("code_challenge"), nonce: url.searchParams.get("nonce"), behavior, used: false });
    },
    rotate() { current = rotated; },
    setUnavailable(value) { unavailable = value; },
    setJwksUnavailable(value) { jwksUnavailable = value; },
    failNextDiscovery(value) { nextDiscoveryFailure = value; },
    consume(code) { const entry = codes.get(code); if (entry) entry.used = true; },
    discoveryCalls() { return requests.filter(request => request.kind === "discovery").length; },
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
    this.mintSequence = 0;
    this.mintBindings = new Map();
    this.sessions = new Map();
    this.failAfterVerified = 0;
    this.loseMintBeforeCommit = 0;
    this.loseMintAfterCommit = 0;
    this.mintRefusal = null;
    this.serviceLive = true;
    this.inactiveInvocations = new Set();
    this.revokedTargets = new Set();
    this.loseMintStepDone = 0;
    this.loseMarkerBegin = 0;
    this.loseMarkerDone = 0;
    this.loseDiscoveryDone = 0;
    this.allBodies = [];
  }
  byInvocation(invocation) { return [...this.transactions.values()].find(row => row.beginInvocation === invocation) ?? null; }
  byState(state) { return [...this.transactions.values()].find(row => row.state === state) ?? null; }
  resolve(token) { return this.sessions.get(token) ?? null; }
  closeFamily(token) {
    const found = this.sessions.get(token);
    if (!found) return false;
    for (const [candidate, session] of this.sessions) if (session.family === found.family) this.sessions.delete(candidate);
    return true;
  }
  mintDenied(code, message = "bound session refused") { return { denied: { code, family: code === "E_INPUT" ? "input" : "action", message } }; }
  async wire(path, body, claim, stop, init = {}) {
    const headers = new Headers(init.headers);
    this.allBodies.push({ path, body: structuredClone(body), headers: Object.fromEntries(headers) });
    if (path === "/actions/claim-set") return { requests: [claim], worker: "service:worker" };
    if (path === `/actions/${claim.id}/status`) return { invocation: { id: claim.id, attempt: claim.attempt, cancelled: false, state: "running" } };
    if (path === `/actions/${claim.id}/done` || path === `/actions/${claim.id}/failed`) {
      this.settled = { path, body: structuredClone(body) };
      stop.abort();
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
        if (found?.state === "parked" || (found && !body.reconcile)) {
          found.state = "parked";
          return { denied: { code: "E_STEP_PARKED", family: "action", message: "uncertain step parked" } };
        }
        if (found) { found.attempt = claim.attempt; return { step: { state: "reconcile", key: found.key } }; }
        const created = { input, key: `step:${id}`, state: "started", attempt: claim.attempt };
        this.steps.set(id, created);
        if (name === "oidc.exchange.v2.marker" && this.loseMarkerBegin > 0) {
          this.loseMarkerBegin--;
          throw Error("lost v2 marker admission response after begin");
        }
        return { step: { state: "run", key: created.key } };
      }
      if (!found) throw Error("missing step");
      if (verb === "park") { found.state = "parked"; return { ok: true }; }
      found.state = "done"; found.result = structuredClone(body.result);
      if (name === "oidc.exchange.v2.marker" && this.loseMarkerDone > 0) {
        this.loseMarkerDone--;
        throw Error("lost v2 marker completion response after commit");
      }
      if (name === "oidc.exchange.v2.discovery" && this.loseDiscoveryDone > 0) {
        this.loseDiscoveryDone--;
        throw Error("lost v2 discovery completion response after commit");
      }
      if (name === "oidc.mint" && this.loseMintStepDone > 0) {
        this.loseMintStepDone--;
        throw Error("lost mint-step completion response after commit");
      }
      return { ok: true };
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
      if (this.loseMintBeforeCommit > 0) {
        this.loseMintBeforeCommit--;
        throw Error("lost mint request before commit");
      }
      if (headers.get("authorization") !== "Bearer service-token" || !this.serviceLive) return this.mintDenied("E_AUTH");
      const binding = body.binding;
      if (!binding || binding.invocationId !== claim.id || binding.intent !== "identity-session/v1"
        || headers.get("x-snapback-action-lease") !== claim.session.token || this.inactiveInvocations.has(claim.id)) {
        return this.mintDenied(binding?.intent === "identity-session/v1" ? "E_ACTION_LEASE" : "E_INPUT");
      }
      if (this.mintRefusal) return this.mintDenied(this.mintRefusal);
      const key = `${binding.invocationId}\0${binding.intent}`;
      const input = JSON.stringify([body.principal, body.kind, body.days]);
      const previous = this.mintBindings.get(key);
      let family, expiresAt;
      if (!previous) {
        family = `family:${binding.invocationId}`;
        expiresAt = this.now + body.days * 86_400_000;
        this.mintBindings.set(key, { input, family, expiresAt, principal: body.principal, kind: body.kind });
      } else {
        if (previous.input !== input) return this.mintDenied("E_INPUT");
        if (binding.replaceLostDelivery !== true) return this.mintDenied("E_INPUT");
        if (this.revokedTargets.has(body.principal)
          || ![...this.sessions.values()].some(session => session.family === previous.family && session.expiresAt > this.now)) {
          return this.mintDenied("E_ACTION_AUTHORITY");
        }
        ({ family, expiresAt } = previous);
        for (const [token, session] of this.sessions) if (session.family === family) this.sessions.delete(token);
      }
      const token = ++this.mintSequence === 1 ? SESSION_TOKEN : `${SESSION_TOKEN}-${this.mintSequence}`;
      const session = { principal: body.principal, kind: body.kind, token, expiresAt, family };
      this.sessions.set(token, session);
      if (this.loseMintAfterCommit > 0) {
        this.loseMintAfterCommit--;
        throw Error("lost mint response after commit");
      }
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
        const target = new URL(url);
        if (target.origin !== "http://core.test") return (options.providerFetch ?? nativeFetch)(url, init);
        const path = target.pathname;
        const body = init.body ? JSON.parse(init.body) : {};
        if (path === "/actions/claim-set") {
          if (claimed) { await delay(10); return { json: async () => ({ requests: [], worker: "service:worker" }) }; }
          claimed = true;
        }
        if (path === `/actions/${claim.id}/status` && options.cancelOnStatus) {
          return Response.json({ invocation: { id: claim.id, attempt: claim.attempt, cancelled: true, state: "failed" } });
        }
        if (options.coreFetch) {
          const response = await options.coreFetch(path, body, init, claim);
          if (response !== undefined) return response;
        }
        const reply = await core.wire(path, body, claim, stop, init);
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

function exchangeInput(core, flow, code, responseIssuer) {
  const row = core.byState(flow.state);
  return {
    codeHash: createHash("sha256").update(JSON.stringify(["snapback4:oidc-code:v1", code])).digest("base64url"),
    configFingerprint: row.configFingerprint,
    responseIssuer,
    state: flow.state,
    transaction: row.id,
  };
}

function seedStep(core, invocation, name, input, state, result) {
  core.steps.set(`${invocation}:${name}`, {
    input: JSON.stringify(input), key: `step:${invocation}:${name}`, state, attempt: 1,
    ...(state === "done" ? { result: structuredClone(result) } : {}),
  });
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
  const stepResults = JSON.stringify([...s.core.steps.values()].map(step => step.result));
  for (const protectedValue of ["healthy-code", flow.binding, transaction.pkceVerifier, ACCESS_TOKEN, REFRESH_TOKEN, SESSION_TOKEN, CLIENT_SECRET]) {
    assert.equal(stepResults.includes(protectedValue), false, `step result retained ${protectedValue}`);
  }
  const mint = s.core.allBodies.find(entry => entry.path === "/auth/session");
  assert.deepEqual(mint.body, {
    principal: result.settled.body.result.principal, kind: "oidc", days: 7,
    binding: { invocationId: "complete-healthy", intent: "identity-session/v1" },
  });
  assert.equal(mint.headers["x-snapback-action-lease"], "action-lease-complete-healthy-1");
  assert.equal(mint.headers.authorization, "Bearer service-token");
  assert.equal(s.core.allBodies.filter(entry => JSON.stringify(entry.body).includes(SESSION_TOKEN)).every(entry => entry.path.endsWith("/done")), true,
    "the raw session appears only in the protected final action result");
  assert.equal(provider.tokenCalls("healthy-code"), 1); assert.equal(s.core.mints, 1);
});

test("callback, browser, authority, expiry and replay bindings fail closed before repeated effects", async t => {
  const provider = await localProvider(t), s = suite(provider);
  for (const [label, mutate, expected] of [
    ["provider-error", args => ({ ...args, code: null, error: "access_denied" }), "E_OIDC_CALLBACK"],
    ["binding", args => ({ ...args, binding: "wrong-binding-" + "z".repeat(32) }), "E_OIDC_CALLBACK"],
    ["state", args => ({ ...args, state: "wrong-state-" + "z".repeat(32) }), "E_OIDC_CALLBACK"],
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
    ["symmetric-hs256-with-actual-client-secret", { header: { alg: "HS256" } }],
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

test("persisted verification replays through provider outage without repeating exchange", async t => {
  const provider = await localProvider(t), s = suite(provider);
  const resumed = await s.begin("resume"); provider.register("resume-code", resumed.authorizationUrl);
  s.core.failAfterVerified = 1;
  const first = await s.invoke("completeOidc", s.callback(resumed, "resume-code"), { id: "complete-resume", attempt: 1 });
  assert.equal(first.settled.body.retry, true); assert.equal(provider.tokenCalls("resume-code"), 1); assert.equal(s.core.mints, 0);
  const providerCalls = { discovery: provider.discoveryCalls(), token: provider.tokenCalls("resume-code"), jwks: provider.jwksCalls() };
  provider.setUnavailable(true);
  const second = await s.invoke("completeOidc", s.callback(resumed, "resume-code"), { id: "complete-resume", attempt: 2 });
  assert.ok(second.settled.path.endsWith("/done")); assert.equal(provider.tokenCalls("resume-code"), 1); assert.equal(s.core.mints, 1);
  assert.deepEqual({ discovery: provider.discoveryCalls(), token: provider.tokenCalls("resume-code"), jwks: provider.jwksCalls() }, providerCalls,
    "a completed exchange replays its claims without discovery, token or JWKS reachability");
  assert.equal(s.core.allBodies.filter(entry => entry.path === "/auth/session").length, 1);
  assert.equal(s.core.steps.get("complete-resume:oidc.exchange.v2.marker").state, "done");
  assert.equal(s.core.steps.get("complete-resume:oidc.exchange.v2.discovery").state, "done");
  assert.equal(s.core.steps.get("complete-resume:oidc.exchange.v2.token").state, "done");
});

test("protocol double: pre-token discovery failures reconcile with one total code POST", async t => {
  const provider = await localProvider(t);
  for (const mode of ["503", "timeout", "unreadable"]) {
    const s = suite(provider), flow = await s.begin(`discovery-${mode}`), code = `discovery-${mode}-code`;
    provider.register(code, flow.authorizationUrl);
    let timeoutRaised = false;
    if (mode !== "timeout") provider.failNextDiscovery(mode);
    const first = await s.invoke("completeOidc", s.callback(flow, code), {
      id: `complete-discovery-${mode}`, attempt: 1,
      ...(mode === "timeout" ? { providerFetch: async (url, init) => {
        if (!timeoutRaised && new URL(url).pathname.endsWith("/.well-known/openid-configuration")) {
          timeoutRaised = true;
          throw new DOMException("the injected discovery request timed out", "TimeoutError");
        }
        return nativeFetch(url, init);
      } } : {}),
    });
    assert.equal(first.settled.body.retry, true, mode);
    assert.equal(provider.tokenCalls(code), 0, `${mode}: discovery failure occurs before token POST`);
    assert.equal(s.core.steps.get(`complete-discovery-${mode}:oidc.exchange.v2.marker`).state, "done", mode);
    assert.equal(s.core.steps.get(`complete-discovery-${mode}:oidc.exchange.v2.discovery`).state, "started", mode);
    if (mode === "timeout") assert.equal(timeoutRaised, true, "the library received a DOM TimeoutError from its transport");
    const recovered = await s.invoke("completeOidc", s.callback(flow, code), {
      id: `complete-discovery-${mode}`, attempt: 2,
    });
    assert.ok(recovered.settled.path.endsWith("/done"), mode);
    assert.equal(provider.tokenCalls(code), 1, `${mode}: reconciliation performs exactly one total code POST`);
    assert.equal(s.core.steps.get(`complete-discovery-${mode}:oidc.exchange.v2.discovery`).state, "done", mode);
  }
});

test("protocol double: v2 marker and discovery acknowledgements recover only from durable completed phases", async t => {
  const provider = await localProvider(t);

  const marker = suite(provider), markerFlow = await marker.begin("marker-ack"), markerCode = "marker-ack-code";
  provider.register(markerCode, markerFlow.authorizationUrl); marker.core.loseMarkerDone = 1;
  const markerFirst = await marker.invoke("completeOidc", marker.callback(markerFlow, markerCode), { id: "complete-marker-ack", attempt: 1 });
  assert.equal(markerFirst.settled.body.retry, true);
  assert.equal(marker.core.steps.get("complete-marker-ack:oidc.exchange.v2.marker").state, "done");
  assert.equal(provider.tokenCalls(markerCode), 0);
  assert.ok((await marker.invoke("completeOidc", marker.callback(markerFlow, markerCode),
    { id: "complete-marker-ack", attempt: 2 })).settled.path.endsWith("/done"));
  assert.equal(provider.tokenCalls(markerCode), 1);

  const discovery = suite(provider), discoveryFlow = await discovery.begin("discovery-ack"), discoveryCode = "discovery-ack-code";
  provider.register(discoveryCode, discoveryFlow.authorizationUrl); discovery.core.loseDiscoveryDone = 1;
  const discoveryFirst = await discovery.invoke("completeOidc", discovery.callback(discoveryFlow, discoveryCode),
    { id: "complete-discovery-ack", attempt: 1 });
  assert.equal(discoveryFirst.settled.body.retry, true);
  assert.equal(discovery.core.steps.get("complete-discovery-ack:oidc.exchange.v2.discovery").state, "done");
  assert.equal(provider.tokenCalls(discoveryCode), 0);
  let replayDiscovery = false;
  const discoverySecond = await discovery.invoke("completeOidc", discovery.callback(discoveryFlow, discoveryCode), {
    id: "complete-discovery-ack", attempt: 2,
    providerFetch: async (url, init) => {
      if (new URL(url).pathname.endsWith("/.well-known/openid-configuration")) {
        replayDiscovery = true;
        throw Error("completed discovery must replay its public metadata");
      }
      return nativeFetch(url, init);
    },
  });
  assert.ok(discoverySecond.settled.path.endsWith("/done"));
  assert.equal(replayDiscovery, false); assert.equal(provider.tokenCalls(discoveryCode), 1);
});

test("protocol double: legacy completed exchanges replay, while unfinished exchanges without a valid marker park", async t => {
  const provider = await localProvider(t);

  const completed = suite(provider), completedFlow = await completed.begin("legacy-complete"), completedId = "complete-legacy-complete";
  const completedCode = "legacy-complete-code", before = provider.requests.length;
  seedStep(completed.core, completedId, "oidc.exchange",
    exchangeInput(completed.core, completedFlow, completedCode, provider.issuer), "done",
    { ok: true, claims: { issuer: provider.issuer, subject: "legacy-subject", email: null, emailVerified: null } });
  provider.setUnavailable(true);
  const replay = await completed.invoke("completeOidc", completed.callback(completedFlow, completedCode), { id: completedId, attempt: 2 });
  assert.ok(replay.settled.path.endsWith("/done"), JSON.stringify(replay));
  assert.equal(provider.requests.length, before, "completed legacy outer result needs no provider reachability");
  assert.equal(completed.core.steps.has(`${completedId}:oidc.exchange.v2.marker`), false);
  provider.setUnavailable(false);

  const unfinished = suite(provider), unfinishedFlow = await unfinished.begin("legacy-unfinished"), unfinishedCode = "legacy-unfinished-code";
  const unfinishedId = "complete-legacy-unfinished";
  provider.register(unfinishedCode, unfinishedFlow.authorizationUrl); provider.consume(unfinishedCode);
  seedStep(unfinished.core, unfinishedId, "oidc.exchange",
    exchangeInput(unfinished.core, unfinishedFlow, unfinishedCode, provider.issuer), "started");
  const parked = await unfinished.invoke("completeOidc", unfinished.callback(unfinishedFlow, unfinishedCode),
    { id: unfinishedId, attempt: 2 });
  assert.equal(parked.settled.body.code, "E_STEP_PARKED");
  assert.equal(provider.tokenCalls(unfinishedCode), 0, "missing v2 proof never repeats a possibly consumed code");
  assert.equal(unfinished.core.steps.get(`${unfinishedId}:oidc.exchange.v2.marker`).state, "parked");

  const interrupted = suite(provider), interruptedFlow = await interrupted.begin("legacy-marker-interrupted");
  const interruptedCode = "legacy-marker-interrupted-code", interruptedId = "complete-legacy-marker-interrupted";
  provider.register(interruptedCode, interruptedFlow.authorizationUrl); provider.consume(interruptedCode);
  seedStep(interrupted.core, interruptedId, "oidc.exchange",
    exchangeInput(interrupted.core, interruptedFlow, interruptedCode, provider.issuer), "started");
  interrupted.core.loseMarkerBegin = 1;
  const interruptedFirst = await interrupted.invoke("completeOidc", interrupted.callback(interruptedFlow, interruptedCode),
    { id: interruptedId, attempt: 2 });
  assert.equal(interruptedFirst.settled.body.retry, true);
  assert.equal(interrupted.core.steps.get(`${interruptedId}:oidc.exchange.v2.marker`).state, "started");
  const interruptedSecond = await interrupted.invoke("completeOidc", interrupted.callback(interruptedFlow, interruptedCode),
    { id: interruptedId, attempt: 3 });
  assert.equal(interruptedSecond.settled.body.code, "E_STEP_PARKED");
  assert.equal(provider.tokenCalls(interruptedCode), 0, "a lost marker admission response cannot manufacture v2 proof");
});

test("protocol double: JWKS outage after code consumption parks without a second POST or mint", async t => {
  const provider = await localProvider(t), s = suite(provider);
  const flow = await s.begin("jwks-outage"), code = "jwks-outage-code", id = "complete-jwks-outage";
  provider.register(code, flow.authorizationUrl); provider.setJwksUnavailable(true);
  const first = await s.invoke("completeOidc", s.callback(flow, code), { id, attempt: 1 });
  assert.equal(first.settled.body.code, "E_STEP_PARKED");
  assert.equal(s.core.steps.get(`${id}:oidc.exchange.v2.token`).state, "parked");
  assert.equal(provider.tokenCalls(code), 1); assert.equal(s.core.mints, 0);
  provider.setJwksUnavailable(false);
  const restart = await s.invoke("completeOidc", s.callback(flow, code), { id, attempt: 2 });
  assert.equal(restart.settled.body.code, "E_STEP_PARKED");
  assert.equal(provider.tokenCalls(code), 1); assert.equal(s.core.mints, 0);
});

test("bound mint recovers losses before commit, after commit, and after completed metadata without extending expiry", async t => {
  const provider = await localProvider(t);

  const beforeCore = new FakeCore(), before = suite(provider, beforeCore);
  const beforeFlow = await before.begin("mint-before-commit"); provider.register("mint-before-commit-code", beforeFlow.authorizationUrl);
  beforeCore.loseMintBeforeCommit = 1;
  const beforeFirst = await before.invoke("completeOidc", before.callback(beforeFlow, "mint-before-commit-code"), { id: "complete-mint-before", attempt: 1 });
  assert.equal(beforeFirst.settled.body.retry, true); assert.equal(beforeCore.mintBindings.size, 0);
  const beforeRecovered = await before.invoke("completeOidc", before.callback(beforeFlow, "mint-before-commit-code"), { id: "complete-mint-before", attempt: 2 });
  assert.ok(beforeRecovered.settled.path.endsWith("/done")); assert.equal(beforeCore.mintBindings.size, 1);
  assert.equal(provider.tokenCalls("mint-before-commit-code"), 1);
  const beforeMints = beforeCore.allBodies.filter(entry => entry.path === "/auth/session");
  assert.equal(beforeMints.length, 2, "one initial request and one explicit recovery; no local HTTP retry");
  assert.equal(Object.hasOwn(beforeMints[0].body.binding, "replaceLostDelivery"), false);
  assert.equal(beforeMints[1].body.binding.replaceLostDelivery, true);
  assert.deepEqual(beforeMints.map(entry => entry.headers["x-snapback-action-lease"]),
    ["action-lease-complete-mint-before-1", "action-lease-complete-mint-before-2"]);

  const afterCore = new FakeCore(), after = suite(provider, afterCore);
  const afterFlow = await after.begin("mint-after-commit"); provider.register("mint-after-commit-code", afterFlow.authorizationUrl);
  afterCore.loseMintAfterCommit = 1;
  const afterFirst = await after.invoke("completeOidc", after.callback(afterFlow, "mint-after-commit-code"), { id: "complete-mint-after", attempt: 1 });
  assert.equal(afterFirst.settled.body.retry, true);
  const [lostToken] = afterCore.sessions.keys(), originalExpiry = afterCore.resolve(lostToken).expiresAt;
  const afterRecovered = await after.invoke("completeOidc", after.callback(afterFlow, "mint-after-commit-code"), { id: "complete-mint-after", attempt: 2 });
  const replacement = afterRecovered.settled.body.result;
  assert.ok(afterRecovered.settled.path.endsWith("/done")); assert.equal(replacement.expiresAt, originalExpiry);
  assert.equal(afterCore.resolve(lostToken), null); assert.equal(afterCore.resolve(replacement.token).expiresAt, originalExpiry);
  assert.equal(afterCore.closeFamily(lostToken), false, "a stale delivery cannot close the replacement family");
  assert.notEqual(afterCore.resolve(replacement.token), null);
  assert.equal(provider.tokenCalls("mint-after-commit-code"), 1);

  const handoffCore = new FakeCore(), handoff = suite(provider, handoffCore);
  const handoffFlow = await handoff.begin("lost-final-handoff"); provider.register("lost-final-handoff-code", handoffFlow.authorizationUrl);
  handoffCore.loseMintStepDone = 1;
  const lostHandoff = await handoff.invoke("completeOidc", handoff.callback(handoffFlow, "lost-final-handoff-code"), { id: "complete-lost-handoff", attempt: 1 });
  assert.equal(lostHandoff.settled.body.retry, true);
  const [originalToken] = handoffCore.sessions.keys(), expiresAt = handoffCore.resolve(originalToken).expiresAt;
  const recovered = await handoff.invoke("completeOidc", handoff.callback(handoffFlow, "lost-final-handoff-code"), { id: "complete-lost-handoff", attempt: 2 });
  assert.ok(recovered.settled.path.endsWith("/done")); assert.equal(recovered.settled.body.result.expiresAt, expiresAt);
  assert.equal(handoffCore.resolve(originalToken), null); assert.notEqual(handoffCore.resolve(recovered.settled.body.result.token), null);
  assert.equal(handoffCore.steps.get("complete-lost-handoff:oidc.mint").state, "done");
  assert.equal(provider.tokenCalls("lost-final-handoff-code"), 1);
  const handoffMints = handoffCore.allBodies.filter(entry => entry.path === "/auth/session");
  assert.equal(handoffMints.length, 2); assert.equal(handoffMints[1].body.binding.replaceLostDelivery, true);
});

test("a lost recovery reply is recovered only by the next explicit claim attempt", async t => {
  const provider = await localProvider(t), core = new FakeCore(), s = suite(provider, core);
  const flow = await s.begin("lost-recovery-reply"); provider.register("lost-recovery-reply-code", flow.authorizationUrl);
  core.loseMintAfterCommit = 1;
  assert.equal((await s.invoke("completeOidc", s.callback(flow, "lost-recovery-reply-code"),
    { id: "complete-lost-recovery", attempt: 1 })).settled.body.retry, true);
  const [firstToken] = core.sessions.keys();
  core.loseMintAfterCommit = 1;
  assert.equal((await s.invoke("completeOidc", s.callback(flow, "lost-recovery-reply-code"),
    { id: "complete-lost-recovery", attempt: 2 })).settled.body.retry, true);
  const [secondToken] = core.sessions.keys();
  assert.notEqual(secondToken, firstToken); assert.equal(core.resolve(firstToken), null);
  const third = await s.invoke("completeOidc", s.callback(flow, "lost-recovery-reply-code"),
    { id: "complete-lost-recovery", attempt: 3 });
  assert.ok(third.settled.path.endsWith("/done")); assert.equal(core.resolve(secondToken), null);
  assert.notEqual(core.resolve(third.settled.body.result.token), null);
  const mints = core.allBodies.filter(entry => entry.path === "/auth/session");
  assert.equal(mints.length, 3); assert.deepEqual(mints.map(entry => entry.body.binding.replaceLostDelivery ?? false), [false, true, true]);
  assert.deepEqual(mints.map(entry => entry.headers["x-snapback-action-lease"]), [
    "action-lease-complete-lost-recovery-1", "action-lease-complete-lost-recovery-2", "action-lease-complete-lost-recovery-3",
  ]);
  assert.equal(provider.tokenCalls("lost-recovery-reply-code"), 1);
});

test("bound mint propagates terminal authority and binding refusals without an unbound or new-family fallback", async t => {
  const provider = await localProvider(t);
  const initialCases = [
    ["changed-intent", "E_INPUT", (_core, body) => { body.binding.intent = "identity-session/v2"; }],
    ["cross-invocation", "E_ACTION_LEASE", (_core, body) => { body.binding.invocationId = "another-invocation"; }],
    ["stale-claim", "E_ACTION_LEASE", (_core, _body, init) => { init.headers["x-snapback-action-lease"] = "stale-claim-token"; }],
    ["cancelled-invocation", "E_ACTION_LEASE", (core, _body, _init, claim) => { core.inactiveInvocations.add(claim.id); }],
    ["revoked-service", "E_AUTH", core => { core.serviceLive = false; }],
    ["terminal-authority", "E_ACTION_AUTHORITY", core => { core.mintRefusal = "E_ACTION_AUTHORITY"; }],
  ];
  for (const [label, expected, alter] of initialCases) {
    const core = new FakeCore(), s = suite(provider, core);
    const flow = await s.begin(label), code = `${label}-code`, id = `complete-${label}`;
    provider.register(code, flow.authorizationUrl);
    const result = await s.invoke("completeOidc", s.callback(flow, code), { id, coreFetch(path, body, init, claim) {
      if (path === "/auth/session") alter(core, body, init, claim);
    } });
    assert.equal(result.settled.body.code, expected, label);
    assert.equal(core.allBodies.filter(entry => entry.path === "/auth/session").length, 1, `${label}: no local retry or fallback`);
    assert.equal(core.mintBindings.size, 0, `${label}: no bound or unbound family was minted`);
    assert.equal(core.sessions.size, 0, label);
  }

  for (const mode of ["changed-input", "closed-family", "revoked-target"]) {
    const core = new FakeCore(), s = suite(provider, core);
    const flow = await s.begin(mode), code = `${mode}-code`, id = `complete-${mode}`;
    provider.register(code, flow.authorizationUrl); core.loseMintAfterCommit = 1;
    assert.equal((await s.invoke("completeOidc", s.callback(flow, code), { id, attempt: 1 })).settled.body.retry, true, mode);
    const [originalToken] = core.sessions.keys();
    if (mode === "closed-family") assert.equal(core.closeFamily(originalToken), true);
    if (mode === "revoked-target") {
      core.revokedTargets.add(core.resolve(originalToken).principal);
      assert.equal(core.closeFamily(originalToken), true);
    }
    const result = await s.invoke("completeOidc", s.callback(flow, code), { id, attempt: 2, coreFetch(path, body) {
      if (path === "/auth/session" && mode === "changed-input") body.days--;
    } });
    assert.equal(result.settled.body.code, mode === "changed-input" ? "E_INPUT" : "E_ACTION_AUTHORITY", mode);
    assert.equal(core.mintBindings.size, 1, `${mode}: the original binding tombstone remains`);
    assert.equal(core.allBodies.filter(entry => entry.path === "/auth/session").length, 2, `${mode}: no unbound or new-family fallback`);
    if (mode === "changed-input") assert.notEqual(core.resolve(originalToken), null, "changed input does not invalidate the original token");
    else assert.equal(core.sessions.size, 0, `${mode}: revoked family was not recreated`);
  }
});

test("a consumed code with a dropped token reply parks and is never posted twice", async t => {
  const provider = await localProvider(t), s = suite(provider);
  const flow = await s.begin("lost-token-reply");
  provider.register("lost-token-reply-code", flow.authorizationUrl, { dropTokenReply: true });
  const first = await s.invoke("completeOidc", s.callback(flow, "lost-token-reply-code"),
    { id: "complete-lost-token-reply", attempt: 1 });
  assert.equal(first.settled.body.code, "E_STEP_PARKED");
  assert.equal(s.core.steps.get("complete-lost-token-reply:oidc.exchange").state, "parked");
  assert.equal(provider.tokenCalls("lost-token-reply-code"), 1); assert.equal(s.core.mints, 0);
  const restart = await s.invoke("completeOidc", s.callback(flow, "lost-token-reply-code"),
    { id: "complete-lost-token-reply", attempt: 2 });
  assert.equal(restart.settled.body.code, "E_STEP_PARKED");
  assert.equal(provider.tokenCalls("lost-token-reply-code"), 1); assert.equal(s.core.mints, 0);
});

test("consumed-code uncertain OAuth and malformed responses park without a second token POST", async t => {
  const provider = await localProvider(t), s = suite(provider);
  const cases = [
    ["server-error", { oauthError: "server_error" }],
    ["temporarily-unavailable", { oauthError: "temporarily_unavailable" }],
    ["unknown-oauth-error", { oauthError: "provider_extension_error" }],
    ["http-503", { httpStatus: 503 }],
    ["unreadable-reply", { unreadableReply: true }],
    ["malformed-token-response", { malformedTokenResponse: true }],
  ];
  for (const [label, behavior] of cases) {
    const flow = await s.begin(label); const code = `${label}-code`;
    provider.register(code, flow.authorizationUrl, behavior);
    const id = `complete-${label}`;
    const first = await s.invoke("completeOidc", s.callback(flow, code), { id, attempt: 1 });
    assert.equal(first.settled.body.code, "E_STEP_PARKED", label);
    assert.equal(s.core.steps.get(`${id}:oidc.exchange`).state, "parked", label);
    assert.equal(provider.tokenCalls(code), 1, label); assert.equal(s.core.mints, 0, label);
    const restart = await s.invoke("completeOidc", s.callback(flow, code), { id, attempt: 2 });
    assert.equal(restart.settled.body.code, "E_STEP_PARKED", label);
    assert.equal(provider.tokenCalls(code), 1, `${label}: restart must not resend a consumed code`);
    assert.equal(s.core.mints, 0, label);
  }
});

test("unknown callback state is public refusal while malformed recipe data retains its internal diagnosis", async t => {
  const provider = await localProvider(t), s = suite(provider);
  const unknown = { code: "unknown-code", state: `unknown-${"z".repeat(32)}`, binding: `binding-${"z".repeat(32)}`, error: null, iss: provider.issuer };
  assert.equal((await s.invoke("completeOidc", unknown, { id: "complete-unknown-state" })).settled.body.code, "E_OIDC_CALLBACK");
  const flow = await s.begin("malformed-recipe");
  s.core.byState(flow.state).nonce = null;
  assert.equal((await s.invoke("completeOidc", s.callback(flow, "unused-code"),
    { id: "complete-malformed-recipe" })).settled.body.code, "E_OIDC_RECIPE");
});

test("invocation lifetime releases provider and private-core fetch and body stalls without late identity effects", async t => {
  const provider = await localProvider(t), s = suite(provider);
  const deferred = () => { let resolve; const promise = new Promise(done => { resolve = done; }); return { promise, resolve }; };
  const stalledBody = (response, entered, pending) => {
    const clone = response.clone.bind(response);
    for (const method of ["json", "text", "arrayBuffer"]) response[method] = () => { entered.value = true; return pending.promise; };
    response.clone = () => stalledBody(clone(), entered, pending);
    return response;
  };
  const assertClosed = async (result, before, label, release) => {
    assert.equal(result.settled.body.code, "E_ACTION_CANCELLED", `${label}: ${JSON.stringify(result)}`);
    assert.equal(s.core.mints, 0, label);
    assert.equal(s.core.allBodies.some(entry => entry.path === "/m/identity.verified" || entry.path === "/auth/session"), false, label);
    release();
    await delay(40);
    assert.equal(s.core.allBodies.length, before, `${label}: no late core request after authority closed`);
  };

  for (const phase of ["discovery", "token", "jwks"]) {
    for (const kind of ["fetch", "body"]) {
      const label = `provider-${phase}-${kind}`, code = `${label}-code`;
      const flow = await s.begin(label); provider.register(code, flow.authorizationUrl);
      let providerSignal;
      const entered = { value: false }, pending = deferred();
      const result = await s.invoke("completeOidc", s.callback(flow, code), {
        id: `complete-${label}`, cancelOnStatus: true,
        providerFetch: async (url, init) => {
          const path = new URL(url).pathname;
          const actual = path.endsWith("/.well-known/openid-configuration") ? "discovery"
            : path === "/token" ? "token" : path === "/jwks" ? "jwks" : "other";
          if (actual !== phase) return nativeFetch(url, init);
          providerSignal = init.signal; entered.value = true;
          if (kind === "fetch") return pending.promise;
          return stalledBody(await nativeFetch(url, init), entered, pending);
        },
      });
      const before = s.core.allBodies.length;
      assert.equal(entered.value, true); assert.equal(providerSignal.aborted, true);
      assert.equal(provider.tokenCalls(code), phase === "discovery" || (phase === "token" && kind === "fetch") ? 0 : 1, label);
      await assertClosed(result, before, `${phase} ${kind} stall`, () => pending.resolve(Response.json({})));
    }
  }

  for (const kind of ["fetch", "body"]) {
    let coreSignal;
    const entered = { value: false }, pending = deferred();
    const binding = `core-${kind}-${"x".repeat(32)}`;
    const result = await s.invoke("beginOidc", { bindingHash: bindingHash(binding) }, {
      id: `begin-core-${kind}`, cancelOnStatus: true,
      coreFetch(path, _body, init) {
        if (path !== "/q/identity.byInvocation") return undefined;
        coreSignal = init.signal; entered.value = true;
        if (kind === "fetch") return pending.promise;
        return stalledBody(Response.json({ data: null }), entered, pending);
      },
    });
    const before = s.core.allBodies.length;
    assert.equal(entered.value, true); assert.equal(coreSignal.aborted, true);
    await assertClosed(result, before, `private core ${kind} stall`, () => pending.resolve(Response.json({ data: null })));
  }

  for (const kind of ["fetch", "body"]) {
    const label = `mint-${kind}`, code = `${label}-code`;
    const flow = await s.begin(label); provider.register(code, flow.authorizationUrl);
    let mintSignal;
    const entered = { value: false }, pending = deferred();
    const result = await s.invoke("completeOidc", s.callback(flow, code), {
      id: `complete-${label}`, cancelOnStatus: true,
      coreFetch(path, body, init) {
        if (path !== "/auth/session") return undefined;
        mintSignal = init.signal; entered.value = true;
        if (kind === "fetch") return pending.promise;
        return stalledBody(Response.json({ session: {
          principal: body.principal, kind: body.kind, token: SESSION_TOKEN, expiresAt: s.core.now + 86_400_000,
        } }), entered, pending);
      },
    });
    const before = s.core.allBodies.length;
    assert.equal(entered.value, true); assert.equal(mintSignal.aborted, true);
    assert.equal(result.settled.body.code, "E_ACTION_CANCELLED", `mint ${kind} stall`);
    pending.resolve(Response.json({ session: {} }));
    await delay(40);
    assert.equal(s.core.allBodies.length, before, `mint ${kind}: no late step or action result after authority closed`);
  }
});

test("configuration refuses non-HTTPS production and non-literal-loopback development", () => {
  const base = { clientId: CLIENT_ID, clientSecret: "OIDC_CLIENT_SECRET", transactions: operations };
  assert.throws(() => oidcHandlers({ ...base, issuer: "http://provider.example", redirectURI: "https://app.example/callback" }), /E_OIDC_CONFIG/);
  assert.throws(() => oidcHandlers({ ...base, issuer: "http://localhost:8080", redirectURI: "http://localhost:3000/callback",
    development: { allowInsecureLoopback: true } }), /literal-loopback/);
  assert.throws(() => oidcHandlers({ ...base, issuer: "https://provider.example/?tenant=other", redirectURI: "https://app.example/callback" }), /query/);
});

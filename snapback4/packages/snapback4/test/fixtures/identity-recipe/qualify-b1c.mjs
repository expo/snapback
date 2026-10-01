import { waitFor as awaitState, hangBudget } from '../../helpers/wait.mjs';
// Prepared B1c qualification. This file intentionally runs only when an
// executor supplies a private scratch parent, an exact binary digest and the
// fixed Keycloak credential file. It emits no credential or bearer value.
import { spawn, spawnSync } from "node:child_process";
import { createHash, randomBytes, randomUUID } from "node:crypto";
import { createServer } from "node:http";
import { createServer as createSocket } from "node:net";
import { access, cp, lstat, mkdir, mkdtemp, readFile, realpath, stat, symlink, writeFile } from "node:fs/promises";
import { constants as fsConstants } from "node:fs";
import { dirname, isAbsolute, join, relative, sep } from "node:path";
import { fileURLToPath } from "node:url";
import { setTimeout as delay } from "node:timers/promises";
import { DatabaseSync } from "node:sqlite";
import { authorizeWithKeycloak } from "./keycloak-browser.mjs";
import { diagnosticStreamsAreSecretFree } from "./diagnostic-secrecy.mjs";
import {
  appendCrashCutObservation, requireCrashCutWorkers, requireInitialMintCut,
  requireMintStepDoneCut, requireMintStepDurableObservation, selectMintStepDoneCut,
} from "./crash-cut-plan.mjs";
import { proveDeadlineSequence } from "./deadline-sequence.mjs";
import { captureEngineCustody, registerWorkerCustody, verifyWorkerCustody } from "./process-custody.mjs";
import { abortProxyServer, closeExpectedProxy, createProxyPhase, stopOwnedChild, trackProxyExchange } from "./proxy-phase.mjs";

const fixture = dirname(fileURLToPath(import.meta.url));
const enginePort = 38973;
const proxyPort = 38974;
const engineUrl = `http://127.0.0.1:${enginePort}`;
const expectedProvider = Object.freeze({
  issuer: "http://127.0.0.1:38971/realms/sb4-b1a-20260917",
  clientId: "snapback4-b1a",
  redirectUri: "http://127.0.0.1:38972/auth/callback",
});
let stage = "configuration";
let retainedScratch = null;
let approvedDigest = null;
let runtimeUid = null;
let instrumentFailureCode = null;
const observations = [];
const children = new Set();
const secrets = new Set();
const custodyReceipts = [];
class InstrumentFailure extends Error {
  constructor(code) {
    super(code);
    this.label = String(code);
    this.code = `B1C_${this.label.replace(/[^A-Za-z0-9]+/g, "_").toUpperCase()}`;
  }
}
const fail = code => { throw new InstrumentFailure(code); };
const requireValue = name => {
  const value = process.env[name];
  if (!value || !value.trim()) fail(`missing-${name}`);
  return value;
};
const assert = (condition, code) => { if (!condition) fail(code); };
const sha256 = value => createHash("sha256").update(value).digest("hex");
const oidcPrincipal = (issuer, subject) => `oidc:${createHash("sha256")
  .update("snapback4:oidc-principal:v1\0").update(issuer).update("\0").update(subject).digest("base64url")}`;
const descendant = (parent, child) => {
  const tail = relative(parent, child);
  return tail !== "" && tail !== ".." && !tail.startsWith(`..${sep}`) && !isAbsolute(tail);
};

async function existingPath(name, kind) {
  const supplied = requireValue(name);
  assert(isAbsolute(supplied), `relative-${name}`);
  const found = await realpath(supplied).catch(() => fail(`missing-${name}`));
  const metadata = await stat(found);
  assert(kind === "file" ? metadata.isFile() : metadata.isDirectory(), `wrong-kind-${name}`);
  return found;
}

async function readPrivateConfig() {
  const path = await existingPath("SNAPBACK4_OIDC_QUALIFICATION_CONFIG", "file");
  const metadata = await stat(path);
  assert((metadata.mode & 0o077) === 0, "config-mode");
  const value = JSON.parse(await readFile(path, "utf8"));
  for (const key of ["issuer", "clientId", "clientSecret", "redirectUri", "username", "password", "expectedSubject"]) {
    assert(typeof value[key] === "string" && value[key].length > 0, `config-${key}`);
    secrets.add(value[key]);
  }
  assert(value.issuer === expectedProvider.issuer && value.clientId === expectedProvider.clientId
    && value.redirectUri === expectedProvider.redirectUri, "config-fixed-values");
  return value;
}

async function fileDigest(path) {
  return sha256(await readFile(path));
}

async function portMustBeFree(port) {
  await new Promise((resolvePromise, reject) => {
    const server = createSocket();
    server.once("error", () => reject(new Error(`qualification port ${port} is occupied`)));
    server.listen(port, "127.0.0.1", () => server.close(resolvePromise));
  });
}

async function makeScratch(parent) {
  const root = await mkdtemp(join(parent, "sb4-b1c-"));
  const actual = await realpath(root);
  assert(descendant(parent, actual), "scratch-outside-parent");
  const marker = join(actual, ".sb4-b1c-owned");
  const markerProof = randomBytes(24).toString("hex");
  await writeFile(marker, markerProof, { mode: 0o600, flag: "wx" });
  const scratch = { root: actual, marker, markerProof };
  await assertScratch(scratch);
  return scratch;
}

async function assertScratch(scratch) {
  assert(Boolean(scratch?.root && scratch?.marker && scratch?.markerProof), "scratch-empty");
  const actual = await realpath(scratch.root).catch(() => fail("scratch-missing"));
  const parent = await realpath(dirname(scratch.root));
  assert(actual === scratch.root && descendant(parent, actual), "scratch-moved");
  assert(((await stat(actual)).mode & 0o777) === 0o700, "scratch-mode");
  assert((await lstat(scratch.marker)).isFile()
    && await readFile(scratch.marker, "utf8") === scratch.markerProof, "scratch-marker");
}

async function verifiedScratchPath() {
  if (!retainedScratch) return null;
  try { await assertScratch(retainedScratch); return retainedScratch.root; }
  catch { return null; }
}

async function prepareProject(scratch, name, paths, mode) {
  await assertScratch(scratch);
  const project = join(scratch.root, name);
  await mkdir(join(project, "snapback"), { recursive: true, mode: 0o700 });
  assert(descendant(scratch.root, await realpath(project)), "project-outside-scratch");
  if (mode === "keycloak") {
    await cp(join(fixture, "snapback"), join(project, "snapback"), { recursive: true });
    await cp(join(project, "snapback/server.b1c-qualification.ts"), join(project, "snapback/server.ts"));
  } else {
    await cp(join(fixture, "raw-authority-schema.q"), join(project, "snapback/schema.q"));
  }
  await mkdir(join(project, "node_modules/@types"), { recursive: true });
  await symlink(paths.packageDir, join(project, "node_modules/snapback4"));
  await symlink(paths.typescriptDir, join(project, "node_modules/typescript"));
  await symlink(paths.nodeTypesDir, join(project, "node_modules/@types/node"));
  await writeFile(join(project, "package.json"), JSON.stringify({ private: true, type: "module" }), { mode: 0o600 });
  return project;
}

function safeCommand(binary, cwd, args, env = {}) {
  const result = spawnSync(binary, args, {
    cwd, encoding: "utf8", timeout: hangBudget(),
    env: { ...process.env, SNAPBACK_NODE: process.execPath, ...env },
  });
  if (result.status !== 0) fail(`command-${args[0]}`);
  return { stdout: result.stdout, stderr: result.stderr };
}

async function startEngine(binary, project, env = {}) {
  const child = spawn(binary, ["dev", "--port", String(enginePort), "--no-watch"], {
    cwd: project,
    env: { ...process.env, SNAPBACK_NODE: process.execPath, ...env },
    stdio: ["ignore", "pipe", "pipe"],
  });
  children.add(child);
  let spawnFailed = false;
  child.on("error", () => { spawnFailed = true; instrumentFailureCode ??= "engine-spawn"; });
  const identity = await captureEngineCustody(child.pid, runtimeUid).catch(() => fail("engine-custody-capture"));
  let output = "";
  for (const stream of [child.stdout, child.stderr]) stream.on("data", bytes => { output += bytes.toString(); });
  await until(async () => {
    if (spawnFailed) fail("engine-spawn");
    if (child.exitCode !== null) fail("engine-exited");
    try { const response = await fetch(`${engineUrl}/auth/guest`, { method: "POST", signal: AbortSignal.timeout(hangBudget()) }); return response.status < 500; }
    catch { return false; }
  }, "engine-start");
  return {
    child, identity,
    workerPids: () => new Set([...output.matchAll(/snapback4 worker: .* \(pid (\d+)\)/g)].map(match => Number(match[1]))),
    async stop() { await stopChild(child); },
  };
}

async function stopChild(child) {
  try { await stopOwnedChild(child, children); }
  catch { fail("child-stop-timeout"); }
}

async function until(check, code) {
  return awaitState(async () => {
    if (instrumentFailureCode) fail(instrumentFailureCode);
    return check();
  }, `qualification-${code}`);
}

async function http(path, body = {}, token, headers = {}) {
  let response;
  try {
    response = await fetch(`${engineUrl}${path}`, {
      method: "POST", signal: AbortSignal.timeout(hangBudget()),
      headers: { "content-type": "application/json", ...(token ? { authorization: `Bearer ${token}` } : {}), ...headers },
      body: JSON.stringify(body),
    });
  } catch {
    if (instrumentFailureCode) fail(instrumentFailureCode);
    fail("http-transport");
  }
  const value = await response.json().catch(() => fail("http-json"));
  return { status: response.status, value };
}

async function action(name, id, args, token, wait = 25) {
  return (await http(`/a/${encodeURIComponent(name)}?wait=${wait}`, { id, args }, token)).value;
}

async function collect(name, id, args, token) {
  return until(async () => {
    const value = await action(name, id, args, token, 25);
    return value.state === "pending" ? null : value;
  }, `collect-${name}`);
}

async function guest() {
  const result = await http("/auth/guest");
  assert(result.status === 200 && result.value.session?.kind === "guest", "guest");
  secrets.add(result.value.session.token);
  return result.value.session;
}

async function whoami(session) {
  return (await http("/q/identityWhoami", { args: {} }, session.token)).value;
}

function boundedBody(request, limit = 2 * 1024 * 1024) {
  return new Promise((resolvePromise, reject) => {
    const chunks = []; let length = 0;
    request.on("data", chunk => { length += chunk.length; if (length > limit) reject(new Error("qualification proxy body too large")); else chunks.push(chunk); });
    request.on("end", () => resolvePromise(Buffer.concat(chunks)));
    request.on("error", reject);
  });
}

async function startFaultProxy(engine, mode, project, invocation) {
  const state = { phase: "initial", providerClosed: false, provider: [], mints: [], cuts: [], workers: new Map(),
    bindingAbsentAtCut: false, exchangeDoneAtCut: false, initialMintRequest: null, stepDone: null,
    stepDoneCutSelected: false, recoveredMintPid: null, stepDonePid: null, durableMintAtCut: null };
  const lifecycle = createProxyPhase(code => { instrumentFailureCode ??= code; });
  const exchanges = new Set();
  const register = async pid => {
    if (state.workers.has(pid)) return state.workers.get(pid);
    let registered;
    try { registered = await registerWorkerCustody(pid, engine.identity(), runtimeUid); }
    catch { throw Object.assign(new Error("custody"), { proxyCategory: "custody-registration" }); }
    state.workers.set(pid, registered);
    custodyReceipts.push(registered.receipt);
    return registered;
  };
  const cutWorker = async (pid, registered, cut) => {
    await until(() => engine.workerPids().has(pid), "worker-pid-registration");
    try { await verifyWorkerCustody(registered, engine.identity(), runtimeUid); }
    catch { throw Object.assign(new Error("custody"), { proxyCategory: "custody-revalidation" }); }
    try { process.kill(pid, "SIGKILL"); }
    catch { throw Object.assign(new Error("custody"), { proxyCategory: "custody-signal" }); }
    state.cuts.push({ cut, pid });
    state.providerClosed = true;
  };
  const server = createServer(async (request, response) => {
    let exchange;
    exchange = trackProxyExchange(lifecycle, request, response, () => exchanges.delete(exchange));
    exchanges.add(exchange);
    if (exchange.requestPhase.phase !== "proof") {
      try { response.writeHead(503, { connection: "close", "content-length": "0" }).end(); }
      finally { exchange.handlerDone(); }
      return;
    }
    try {
      const body = await boundedBody(request);
      if (request.url === "/__qualification/provider-attempt") {
        const event = JSON.parse(body.toString("utf8"));
        assert(event && ["GET", "POST"].includes(event.method) && typeof event.path === "string" && Number.isInteger(event.pid), "provider-event");
        await register(event.pid);
        state.provider.push({ method: event.method, path: event.path, blocked: state.providerClosed });
        response.writeHead(state.providerClosed ? 503 : 204).end();
        return;
      }
      const pid = Number(request.headers["x-snapback4-qualification-worker-pid"]);
      assert(Number.isInteger(pid) && pid > 1, "proxy-worker-pid");
      const registered = await register(pid);
      const bearer = String(request.headers.authorization ?? "").match(/^Bearer (.+)$/)?.[1];
      const actionLease = request.headers["x-snapback-action-lease"];
      if (bearer) secrets.add(bearer);
      if (typeof actionLease === "string" && actionLease) secrets.add(actionLease);
      const headers = new Headers();
      for (const [name, value] of Object.entries(request.headers)) {
        if (["host", "content-length", "connection", "x-snapback4-qualification-worker-pid"].includes(name) || value === undefined) continue;
        for (const item of Array.isArray(value) ? value : [value]) headers.append(name, item);
      }
      const sent = request.url === "/auth/session" ? JSON.parse(body.toString("utf8")) : null;
      if (sent && state.phase === "initial" && sent.binding?.replaceLostDelivery !== true) state.initialMintRequest = sent;
      if (mode === "before-mint" && state.phase === "initial" && request.url === "/auth/session") {
        requireInitialMintCut({ invocation: invocation(), phase: state.phase, path: request.url, binding: sent.binding }, assert);
        const db = database(project);
        try {
          state.bindingAbsentAtCut = db.prepare("SELECT 1 FROM _session_mint_bindings WHERE invocation = ? AND intent = 'identity-session/v1'").get(invocation()) === undefined;
          state.exchangeDoneAtCut = db.prepare("SELECT state FROM _action_steps WHERE invocation = ? AND name = 'oidc.exchange'").get(invocation())?.state === "done";
        } finally { db.close(); }
        assert(state.bindingAbsentAtCut && state.exchangeDoneAtCut, "before-commit-cut-state");
        await cutWorker(pid, registered, "before-core-mint-commit");
        state.phase = "recovery";
        exchange.intentionalCut(); response.destroy(); return;
      }
      const upstream = await fetch(`${engineUrl}${request.url}`, {
        method: request.method, headers, body: request.method === "GET" ? undefined : body, signal: exchange.signal,
      });
      const bytes = Buffer.from(await upstream.arrayBuffer());
      if (request.url === "/auth/session" && upstream.ok) {
        const received = JSON.parse(bytes.toString("utf8"));
        if (received.session?.token) {
          state.mints.push({ session: received.session, binding: sent.binding, request: sent, pid });
          secrets.add(received.session.token);
          if (mode !== "before-mint" && state.phase === "initial" && sent.binding?.replaceLostDelivery !== true) {
            await cutWorker(pid, registered, "after-core-mint-commit-before-worker-ack");
            state.phase = "recovery";
            exchange.intentionalCut();
            response.destroy();
            return;
          }
          if (state.phase === "recovery" && sent.binding?.replaceLostDelivery === true) {
            state.recoveredMintPid = pid;
            state.phase = mode === "after-step" ? "await-step-done" : "done";
          } else if (state.phase === "final-recovery" && sent.binding?.replaceLostDelivery === true) state.phase = "done";
        }
      }
      const selectedInvocation = selectMintStepDoneCut({ getInvocation: invocation, mode, phase: state.phase,
        path: request.url, selected: state.stepDoneCutSelected });
      if (selectedInvocation !== null) {
        const selectedPhase = state.phase;
        state.stepDoneCutSelected = true;
        state.phase = "cutting-step-done";
        const reply = JSON.parse(bytes.toString("utf8"));
        requireMintStepDoneCut({ invocation: selectedInvocation, phase: selectedPhase, path: request.url, upstreamOk: upstream.ok, reply }, assert);
        assert(Number.isInteger(state.recoveredMintPid) && pid === state.recoveredMintPid
          && pid !== state.cuts[0]?.pid, "cut-recovered-worker-binding");
        const recoveredMint = state.mints.at(-1)?.session;
        assert(recoveredMint, "cut-recovered-mint-missing");
        const db = database(project);
        try {
          const row = db.prepare(`SELECT r.id request_id, r.name request_name, r.state request_state,
            r.result request_result, r.settled_at request_settled_at, s.invocation step_invocation,
            s.name step_name, s.state step_state, s.result step_result
            FROM _requests r LEFT JOIN _action_steps s
              ON s.invocation = r.id AND s.name = 'oidc.mint' WHERE r.id = ?`).get(selectedInvocation);
          state.durableMintAtCut = row && {
            requestId: row.request_id, requestName: row.request_name, requestState: row.request_state,
            requestResult: row.request_result, requestSettledAt: row.request_settled_at,
            stepInvocation: row.step_invocation, stepName: row.step_name, stepState: row.step_state,
            stepResult: row.step_result === null ? null : JSON.parse(row.step_result),
          };
        } finally { db.close(); }
        requireMintStepDurableObservation({ invocation: selectedInvocation, observation: state.durableMintAtCut,
          expected: recoveredMint }, assert);
        state.stepDone = reply.step;
        state.stepDonePid = pid;
        await cutWorker(pid, registered, "after-mint-step-done-before-action-settlement");
        state.phase = "final-recovery";
        exchange.intentionalCut(); response.destroy(); return;
      }
      const replyHeaders = {};
      upstream.headers.forEach((value, name) => { if (!["connection", "content-length", "transfer-encoding"].includes(name)) replyHeaders[name] = value; });
      response.writeHead(upstream.status, { ...replyHeaders, "content-length": bytes.length });
      response.end(bytes);
    } catch (error) {
      const category = error?.proxyCategory ?? (error instanceof InstrumentFailure ? "protocol" : "request");
      lifecycle.failRequest(exchange.requestPhase, category);
      if (!response.destroyed) response.destroy();
    } finally {
      exchange.handlerDone();
    }
  });
  try { await new Promise((resolvePromise, reject) => { server.once("error", reject); server.listen(proxyPort, "127.0.0.1", resolvePromise); }); }
  catch { fail("proxy-listen"); }
  server.on("error", () => lifecycle.failServer());
  server.on("clientError", (_error, socket) => {
    lifecycle.failServer("client-error");
    socket.destroy();
  });
  return {
    state,
    async closeExpected() {
      const failure = await closeExpectedProxy({ server, lifecycle, exchanges,
        currentFailure: () => instrumentFailureCode, drainMilliseconds: hangBudget(), closeMilliseconds: hangBudget() });
      if (failure) fail(failure);
    },
    async closeAbort() {
      lifecycle.beginExpectedTeardown();
      await abortProxyServer(server, exchanges, hangBudget());
      lifecycle.close();
    },
  };
}

function database(project) {
  return new DatabaseSync(join(project, ".snapback4/store.sqlite"), { readOnly: true });
}

function tokenLocations(db, token) {
  const hits = [];
  for (const { name } of db.prepare("SELECT name FROM sqlite_master WHERE type = 'table'").all()) {
    const quoted = `"${String(name).replaceAll('"', '""')}"`;
    const columns = db.prepare(`PRAGMA table_info(${quoted})`).all().filter(column => ["TEXT", "BLOB", ""].includes(String(column.type).toUpperCase()));
    for (const column of columns) {
      const field = `"${String(column.name).replaceAll('"', '""')}"`;
      for (const row of db.prepare(`SELECT ${field} value FROM ${quoted} WHERE instr(CAST(${field} AS TEXT), ?) > 0`).all(token)) {
        if (row.value !== null) hits.push(`${name}.${column.name}`);
      }
    }
  }
  return hits.sort();
}

async function keycloakWitness(paths, scratch, config, mode = "primary") {
  stage = `keycloak-${mode}-project`;
  const project = await prepareProject(scratch, `keycloak-${mode}`, paths, "keycloak");
  await assertScratch(scratch);
  safeCommand(paths.binary, project, ["check", "--json"]);
  const completion = { id: null };
  let engine; const proxy = await startFaultProxy({
    workerPids: () => engine?.workerPids() ?? new Set(),
    identity: () => engine?.identity ?? fail("engine-custody-unavailable"),
  }, mode, project, () => completion.id ?? fail("completion-id-unavailable"));
  let witnessError = null;
  try {
    engine = await startEngine(paths.binary, project, { OIDC_CLIENT_SECRET: config.clientSecret });
    const admitting = await guest();
    const binding = randomBytes(32).toString("base64url"); secrets.add(binding);
    const bindingHash = createHash("sha256").update(binding).digest("base64url"); secrets.add(bindingHash);
    const beginId = `b1c-begin-${randomUUID()}`;
    stage = `keycloak-${mode}-begin`;
    const begun = await collect("beginOidc", beginId, { bindingHash }, admitting.token);
    assert(begun.state === "done" && typeof begun.result?.authorizationUrl === "string", "begin-result");
    const state = new URL(begun.result.authorizationUrl).searchParams.get("state");
    assert(state, "provider-state"); secrets.add(state);
    stage = `keycloak-${mode}-browser-code`;
    const callback = await authorizeWithKeycloak(config, begun.result.authorizationUrl, () => fail("browser-flow"));
    const code = callback.searchParams.get("code");
    const returnedState = callback.searchParams.get("state");
    const issuer = callback.searchParams.get("iss");
    assert(code && returnedState === state && issuer === config.issuer && !callback.searchParams.has("error"), "callback");
    secrets.add(code);
    completion.id = `b1c-complete-${randomUUID()}`;
    const args = { code, state, binding, error: null, iss: issuer };
    stage = `keycloak-${mode}-lost-mint-recovery`;
    const done = await collect("completeOidc", completion.id, args, admitting.token);
    assert(done.state === "done" && done.result?.token && done.result.kind === "oidc", "complete-result");
    secrets.add(done.result.token);
    const expectedMints = mode === "before-mint" ? 1 : mode === "after-step" ? 3 : 2;
    const expectedCuts = mode === "after-step" ? 2 : 1;
    assert(proxy.state.phase === "done" && proxy.state.cuts.length === expectedCuts
      && proxy.state.mints.length === expectedMints, "fault-cuts");
    const finalMint = proxy.state.mints.at(-1);
    assert(finalMint && engine.workerPids().has(finalMint.pid)
      && new Set([...proxy.state.cuts.map(cut => cut.pid), ...proxy.state.mints.map(mint => mint.pid)]).size === expectedCuts + 1,
    "worker-process-restart");
    if (mode === "after-step") requireCrashCutWorkers({
      firstKilledPid: proxy.state.cuts[0]?.pid, recoveredMintPid: proxy.state.recoveredMintPid,
      donePid: proxy.state.stepDonePid, finalMintPid: finalMint?.pid,
    }, assert);
    assert(finalMint.binding?.invocationId === completion.id && finalMint.binding?.intent === "identity-session/v1"
      && finalMint.binding?.replaceLostDelivery === true, "recovery-wire");
    if (mode !== "before-mint") {
      const initialMint = proxy.state.mints[0];
      assert(initialMint.binding?.invocationId === completion.id && initialMint.binding?.intent === "identity-session/v1"
        && !Object.hasOwn(initialMint.binding, "replaceLostDelivery"), "initial-wire");
    } else assert(proxy.state.bindingAbsentAtCut && proxy.state.exchangeDoneAtCut, "binding-absence-observed");
    assert(proxy.state.mints.every(mint => mint.session.principal === done.result.principal && mint.session.kind === done.result.kind
      && mint.session.expiresAt === done.result.expiresAt), "immutable-mint-inputs");
    assert(new Set(proxy.state.mints.map(mint => mint.session.token)).size === expectedMints
      && finalMint.session.token === done.result.token, "replacement-token");
    const initialRequest = proxy.state.initialMintRequest;
    assert(initialRequest && proxy.state.mints.every(mint => mint.request.principal === initialRequest.principal
      && mint.request.kind === initialRequest.kind && mint.request.days === initialRequest.days), "immutable-mint-request");
    if (mode === "after-step") assert(proxy.state.stepDone?.result?.minted === true, "mint-step-done-receipt");
    assert(proxy.state.provider.filter(event => event.method === "POST" && event.path.endsWith("/token")).length === 1, "provider-code-once");
    assert(proxy.state.provider.filter(event => event.blocked).length === 0, "provider-independent-replay");
    const live = await whoami(done.result);
    assert(live.data === done.result.principal, "new-token-public-query");
    for (const staleMint of proxy.state.mints.slice(0, -1)) {
      assert((await whoami(staleMint.session)).denied?.code === "E_AUTH", "old-token-public-query");
    }

    stage = "keycloak-own-profile";
    const queriedBefore = Date.now();
    const own = (await http("/q/identityOwnProfileEligibility", { args: {} }, done.result.token)).value;
    const queriedAfter = Date.now();
    const profile = own.data?.profile;
    assert(profile && profile.principal === done.result.principal, "own-profile-principal");
    assert(profile.issuer === config.issuer && profile.subject === config.expectedSubject, "own-profile-provider-binding");
    assert(profile.principal === oidcPrincipal(profile.issuer, profile.subject), "own-profile-derived-principal");
    assert(profile.proofExpiresAt === profile.proofStartedAt + 300_000, "own-profile-proof-window");
    assert((profile.proofExpiresAt > queriedBefore) === (profile.proofExpiresAt > queriedAfter), "own-profile-freshness-boundary");
    const expectedEligibility = profile.email !== null && profile.email !== undefined
      && profile.emailVerified === true && profile.proofExpiresAt > queriedAfter;
    assert(own.data.eligible === expectedEligibility, "own-profile-eligibility");
    secrets.add(profile.subject); secrets.add(profile.principal);
    if (typeof profile.email === "string" && profile.email) secrets.add(profile.email);
    const unrelated = await guest();
    const unrelatedProfile = (await http("/q/identityOwnProfile", { args: {} }, unrelated.token)).value;
    assert(unrelatedProfile.data === null, "unrelated-own-profile");

    stage = `keycloak-${mode}-read-only-family-inspection`;
    const db = database(project);
    try {
      const bindingRow = db.prepare("SELECT family, expires_at FROM _session_mint_bindings WHERE invocation = ? AND intent = 'identity-session/v1'").get(completion.id);
      const originalMint = proxy.state.mints[0];
      assert(bindingRow && bindingRow.family === sha256(originalMint.session.token)
        && bindingRow.expires_at === originalMint.session.expiresAt && bindingRow.expires_at === done.result.expiresAt, "binding-row-original-family");
      const familyRows = db.prepare("SELECT token_digest, expires_at FROM _sessions WHERE family = ?").all(bindingRow.family);
      assert(familyRows.length === 1 && familyRows[0].token_digest === sha256(done.result.token)
        && familyRows[0].expires_at === done.result.expiresAt, "same-family");
      const mintStep = db.prepare("SELECT result FROM _action_steps WHERE invocation = ? AND name = 'oidc.mint'").get(completion.id);
      assert(mintStep && proxy.state.mints.every(mint => !String(mintStep.result).includes(mint.session.token)), "step-token-absence");
      for (const staleMint of proxy.state.mints.slice(0, -1)) assert(tokenLocations(db, staleMint.session.token).length === 0, "old-token-persisted");
      assert(JSON.stringify(tokenLocations(db, done.result.token)) === JSON.stringify(["_requests.result"]), "final-token-result-only");
    } finally { db.close(); }
    const diagnostic = safeCommand(paths.binary, project, ["why", completion.id]);
    assert(diagnosticStreamsAreSecretFree(diagnostic, secrets), "default-diagnostic-secret");
    if (instrumentFailureCode) fail(instrumentFailureCode);
  } catch (error) {
    witnessError = error;
  } finally {
    if (witnessError) {
      await proxy.closeAbort().catch(() => {});
      if (engine) await engine.stop().catch(() => {});
    } else {
      try { await proxy.closeExpected(); }
      catch (error) { witnessError = error; }
      try { if (engine) await engine.stop(); }
      catch (error) { witnessError ??= error; }
    }
  }
  const cleanupComplete = witnessError === null;
  if (witnessError) throw witnessError;
  if (instrumentFailureCode) fail(instrumentFailureCode);
  if (mode === "primary") observations.push("actual-keycloak-generated-helper", "post-commit-lost-reply-process-crash",
    "same-family-same-expiry-old-token-invalid", "actual-keycloak-derived-own-profile", "default-diagnostic-redaction");
  else appendCrashCutObservation(observations, mode, cleanupComplete, assert);
}

async function rawAuthorityWitness(paths, scratch) {
  stage = "raw-authority-project";
  const project = await prepareProject(scratch, "authority", paths, "raw");
  await assertScratch(scratch);
  safeCommand(paths.binary, project, ["check", "--json"]);
  safeCommand(paths.binary, project, ["test", "--residency"]);
  const service = safeCommand(paths.binary, project, ["token", "--service", "worker", "--days", "30"]).stdout.trim();
  const operator = safeCommand(paths.binary, project, ["token", "--service", "operator", "--days", "30"]).stdout.trim();
  secrets.add(service); secrets.add(operator);
  const engine = await startEngine(paths.binary, project);
  const claim = async (actionName, id) => until(async () => {
    const value = (await http("/actions/claim", { action: actionName, limit: 1, lease: 10, wait: 0 }, service)).value;
    const requests = value.requests ?? [];
    assert(requests.length === 0 || (requests.length === 1 && requests[0].id === id), "unexpected-claimed-invocation");
    const found = requests[0];
    if (found?.session?.token) { secrets.add(found.session.token); return found; }
    return null;
  }, "claim-current-invocation");
  const admit = async (actionName = "qualificationMint") => {
    const owner = await guest(); const id = `b1c-raw-${randomUUID()}`;
    const result = await action(actionName, id, {}, owner.token, 0);
    assert(result.state === "pending", "raw-admit");
    return { owner, id, held: await claim(actionName, id), actionName };
  };
  const mint = async (run, principal, replace = false, lease = run.held.session.token, credential = service, days = 30) =>
    (await http("/auth/session", { principal, kind: "oidc", days, binding: {
      invocationId: run.id, intent: "identity-session/v1", ...(replace ? { replaceLostDelivery: true } : {}),
    } }, credential, { "x-snapback-action-lease": lease })).value;
  const retry = async run => {
    const value = (await http(`/actions/${encodeURIComponent(run.id)}/failed`, { error: "qualification retry", retry: true }, service,
      { "x-snapback-action-lease": run.held.session.token })).value;
    assert(value.ok === true, "retry-settlement");
  };
  const finish = async (run, lease = run.held.session.token) => {
    const value = (await http(`/actions/${encodeURIComponent(run.id)}/done`, { result: null }, service,
      { "x-snapback-action-lease": lease })).value;
    assert(value.ok === true, "done-settlement");
  };
  const cancel = async run => {
    const value = (await http(`/actions/${encodeURIComponent(run.id)}/cancel`, {}, run.owner.token)).value;
    assert(value.ok === true && value.request?.state === "failed" && value.request?.why?.code === "E_ACTION_CANCELLED", "cancel-settlement");
  };
  let witnessError = null;
  try {
    stage = "raw-before-commit-recovery";
    const before = await admit();
    const first = await mint(before, `oidc:raw-before-${randomUUID()}`, true);
    assert(first.session?.token && (await whoami(first.session)).data === first.session.principal, "first-binding-recovery");
    await cancel(before);

    stage = "raw-stale-lease";
    const stale = await admit(); await retry(stale); await delay(1_100); const current = await claim(stale.actionName, stale.id);
    const staleReply = await mint(stale, `oidc:raw-stale-${randomUUID()}`, false, stale.held.session.token);
    assert(staleReply.denied?.code === "E_ACTION_LEASE", "stale-lease-refusal");
    await finish(stale, current.session.token);

    stage = "raw-cancelled-settled-deadline";
    const cancelled = await admit(); await cancel(cancelled);
    assert((await mint(cancelled, `oidc:raw-cancel-${randomUUID()}`)).denied?.code === "E_ACTION_LEASE", "cancel-refusal");
    const settled = await admit(); await finish(settled);
    assert((await mint(settled, `oidc:raw-settled-${randomUUID()}`)).denied?.code === "E_ACTION_LEASE", "settled-refusal");
    const deadline = await admit("qualificationDeadline");
    await proveDeadlineSequence({ run: deadline, waitPastDeadline: () => delay(2_200), require: assert,
      status: async () => (await http(`/actions/${encodeURIComponent(deadline.id)}/status`, {}, service,
        { "x-snapback-action-lease": deadline.held.session.token })).value,
      collect: () => action(deadline.actionName, deadline.id, {}, deadline.owner.token, 0),
      mint: () => mint(deadline, `oidc:raw-deadline-${randomUUID()}`),
    });

    stage = "raw-parked";
    const parked = await admit();
    const stepHeaders = { "x-snapback-action-lease": parked.held.session.token };
    const begun = (await http(`/actions/${parked.id}/steps/qualification/begin`, { input: { intent: "park" }, reconcile: false }, service, stepHeaders)).value;
    assert(begun.step?.state === "run", "park-step-begin");
    await retry(parked); await delay(1_100); const parkedCurrent = await claim(parked.actionName, parked.id);
    const parkReply = (await http(`/actions/${parked.id}/steps/qualification/begin`, { input: { intent: "park" }, reconcile: false }, service,
      { "x-snapback-action-lease": parkedCurrent.session.token })).value;
    assert(parkReply.denied?.code === "E_STEP_PARKED", "park-transition");
    assert((await mint(parked, `oidc:raw-parked-${randomUUID()}`, false, parkedCurrent.session.token)).denied?.code === "E_ACTION_LEASE", "parked-refusal");

    stage = "raw-authority-revocations";
    const admitting = await admit();
    assert((await http("/auth/logout", {}, admitting.owner.token)).value.ok === true, "admitting-logout");
    assert((await mint(admitting, `oidc:raw-admitting-${randomUUID()}`)).denied?.code === "E_ACTION_LEASE", "admitting-logout-refusal");
    await delay(10_100);
    const swept = (await http("/actions/claim", { action: admitting.actionName, limit: 1, lease: 10, wait: 0 }, service)).value;
    assert((swept.requests ?? []).every(request => request.id !== admitting.id), "admitting-not-reclaimed");
    const admittingDb = database(project);
    try {
      const terminal = admittingDb.prepare("SELECT state, error_code FROM _requests WHERE id = ?").get(admitting.id);
      assert(terminal?.state === "failed" && terminal?.error_code === "E_ACTION_AUTHORITY", "admitting-terminal-authority");
    } finally { admittingDb.close(); }
    const issuedLogout = await admit(); const issued = await mint(issuedLogout, `oidc:raw-issued-${randomUUID()}`);
    assert((await http("/auth/logout", {}, issued.session.token)).value.ok === true, "issued-logout");
    assert((await mint(issuedLogout, issued.session.principal, true)).denied?.code === "E_ACTION_AUTHORITY", "issued-logout-refusal");
    await cancel(issuedLogout);
    const target = await admit(); const targetSession = await mint(target, `oidc:raw-target-${randomUUID()}`);
    assert((await http("/auth/revoke", { principal: targetSession.session.principal }, operator)).value.revoked >= 1, "target-revoke");
    assert((await mint(target, targetSession.session.principal, true)).denied?.code === "E_ACTION_AUTHORITY", "target-revoke-refusal");
    await cancel(target);

    stage = "raw-issued-family-expiry-dev-clock";
    const expired = await admit(); const expiringSession = await mint(expired, `oidc:raw-expired-${randomUUID()}`, false, expired.held.session.token, service, 1);
    await retry(expired);
    const advanced = (await http("/dev/clock/advance", { duration: "+25h" })).value;
    assert(advanced.advancedMs === 25 * 60 * 60 * 1_000, "clock-advance");
    const expiryCurrent = await claim(expired.actionName, expired.id);
    const expiredReply = await mint(expired, expiringSession.session.principal, true, expiryCurrent.session.token, service, 1);
    assert(expiredReply.denied?.code === "E_ACTION_AUTHORITY", "expired-family-refusal");
    assert((await whoami(expiringSession.session)).denied?.code === "E_AUTH", "expired-token-public-query");
    await cancel(expired);

    const serviceRun = await admit();
    assert((await http("/auth/revoke", { principal: "service:worker" }, operator)).value.revoked >= 1, "service-revoke");
    const serviceReply = await mint(serviceRun, `oidc:raw-service-${randomUUID()}`);
    assert(serviceReply.denied?.code === "E_AUTH", "service-revoke-refusal");
    await cancel(serviceRun);

  } catch (error) {
    witnessError = error;
  } finally {
    try { await engine.stop(); }
    catch (error) { witnessError ??= error; }
  }
  if (witnessError) throw witnessError;
  observations.push("explicit-first-binding-with-recovery-flag", "stale-parked-cancelled-settled-deadline-refusals",
    "admitting-issued-target-service-refusals", "issued-family-expiry-supported-dev-clock");
}

async function main() {
  assert(process.platform === "linux" && typeof process.getuid === "function", "linux-proc-required");
  runtimeUid = process.getuid();
  assert(process.versions.node.split(".")[0] === "24", "node-major");
  const paths = {
    binary: await existingPath("SNAPBACK4_BIN", "file"),
    packageDir: await existingPath("SNAPBACK4_PACKAGE_DIR", "directory"),
    typescriptDir: await existingPath("SNAPBACK4_TYPESCRIPT_DIR", "directory"),
    nodeTypesDir: await existingPath("SNAPBACK4_NODE_TYPES_DIR", "directory"),
  };
  await access(paths.binary, fsConstants.X_OK).catch(() => fail("binary-not-executable"));
  const expectedDigest = requireValue("SNAPBACK4_B1C_BINARY_SHA256").toLowerCase();
  assert(/^[0-9a-f]{64}$/.test(expectedDigest) && await fileDigest(paths.binary) === expectedDigest, "binary-digest");
  approvedDigest = expectedDigest;
  const config = await readPrivateConfig();
  const privateParent = await existingPath("SNAPBACK4_QUALIFICATION_PRIVATE_PARENT", "directory");
  const parentMode = (await stat(privateParent)).mode;
  assert((parentMode & 0o077) === 0, "private-parent-mode");
  await portMustBeFree(enginePort).catch(() => fail("engine-port-occupied"));
  await portMustBeFree(proxyPort).catch(() => fail("proxy-port-occupied"));
  const scratch = await makeScratch(privateParent);
  retainedScratch = scratch;
  try {
    for (const mode of ["primary", "before-mint", "after-step"]) {
      await keycloakWitness(paths, scratch, config, mode);
      await portMustBeFree(enginePort).catch(() => fail("engine-port-not-released"));
      await portMustBeFree(proxyPort).catch(() => fail("proxy-port-not-released"));
    }
    await rawAuthorityWitness(paths, scratch);
  } finally {
    for (const child of [...children]) await stopChild(child).catch(() => {});
  }
  stage = "complete";
  const scratchPath = await verifiedScratchPath();
  assert(scratchPath === scratch.root, "scratch-custody-final");
  return { status: "passed", code: "B1C_QUALIFICATION_PASSED", stage, binarySha256: expectedDigest,
    observations, custody: custodyReceipts, scratch: scratchPath };
}

main().then(result => {
  process.stdout.write(JSON.stringify(result) + "\n");
}).catch(async error => {
  for (const child of [...children]) await stopChild(child).catch(() => {});
  const scratch = await verifiedScratchPath();
  const code = error instanceof InstrumentFailure ? error.code : "B1C_UNEXPECTED_FAILURE";
  process.stderr.write(JSON.stringify({ status: "failed", code, stage, scratch, binarySha256: approvedDigest,
    observations, custody: custodyReceipts }) + "\n");
  process.exitCode = 1;
});

import { waitFor as awaitState, hangBudget } from './helpers/wait.mjs';
// The worker's door on the real wire: a service token from the CLI, a
// session minted for an account the application authenticated itself,
// presence read by the mutation that emits, and the worker loop claiming
// and settling what was emitted. Only this test's child is stopped.
import test from "node:test";
import assert from "node:assert/strict";
import { spawn, spawnSync } from "node:child_process";
import { once } from "node:events";
import { createServer } from "node:http";
import { DatabaseSync } from "node:sqlite";
import { mkdtempSync, mkdirSync, rmSync, writeFileSync, readFileSync, symlinkSync, existsSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { listEffects, mintSession, revokeSessions, runWorker, GiveUp } from "../dist/worker.js";

import { createClient } from "../dist/client.js";
import { createLocalClient } from "../dist/local.js";
import { processDevice } from "../dist/native.js";

const root = join(dirname(fileURLToPath(import.meta.url)), "../../..");
const binary = process.env.SNAPBACK4_BIN ?? join(root, "target/debug/snapback4");
const source = `use personas alice
effect notify

table memberships:
  conversationId: id
  principal: principal
  unique byConversationPrincipal: conversationId, principal
  by byPrincipalConversation: principal, conversationId, id
  cap 50 by conversationId
  read <- exists memberships[.conversationId, viewer]
  insert <- allow

table messages:
  conversationId: id
  authorId: principal
  body: text <=4000
  at: time
  by byConvTime: conversationId, at, id
  read <- exists memberships[.conversationId, viewer]
  insert <- .authorId = viewer and exists memberships[.conversationId, viewer]

mutation join(conversationId: id):
  return insert memberships { conversationId, principal: viewer }

mutation send(conversationId: id, body: text <=4000):
  require exists memberships[conversationId, viewer] else NOT_MEMBER
  msg = insert messages { conversationId, authorId: viewer, body, at: now }
  for m in memberships[conversationId] first 50 by byConversationPrincipal:
    if m.principal != viewer and not exists connected[m.principal]:
      emit notify { targetUserId: m.principal, chatId: conversationId, preview: slice(body, 0, 80) }
  return { id: msg.id }

query online(p: principal):
  return connected[p]
`;

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

test("a service mints sessions, the mutation reads presence, the worker settles what was emitted", { timeout: hangBudget(24) }, async () => {
  const directory = mkdtempSync(join(tmpdir(), "sb4-worker-"));
  mkdirSync(join(directory, "snapback"));
  writeFileSync(join(directory, "snapback/schema.q"), source);
  const initialized = spawnSync(binary, ["test", "--residency"], { cwd: directory, encoding: "utf8" });
  assert.equal(initialized.status, 0, initialized.stderr);
    const minted = spawnSync(binary, ["token", "--service", "pusher", "--days", "1"], { cwd: directory, encoding: "utf8" });
    assert.equal(minted.status, 0, minted.stderr);
    const serviceToken = minted.stdout.trim();
    assert.match(serviceToken, /^[A-Za-z0-9_-]{40,}$/);
  // Not --fresh: the CLI mints the token into the same store file.
  const child = spawn(binary, ["dev", "--port", "0", "--no-watch"], { cwd: directory, stdio: ["ignore", "pipe", "pipe"] });
  const exited = once(child, "exit");
  let log = "", url;
  child.stdout.on("data", (data) => { log += data; url ??= log.match(/http:\/\/127\.0\.0\.1:(\d+)/)?.[0]; });
  child.stderr.on("data", (data) => { log += data; });
  const stop = new AbortController();
  try {
    const deadline = performance.now() + hangBudget();
    while (!url && child.exitCode == null && performance.now() < deadline) await sleep(10);
    assert.ok(url, log || "server did not listen");
    // A user token is not a worker's seat.
    const asUser = await fetch(`${url}/effects/claim`, { method: "POST", headers: { "x-snapback-persona": "alice", "content-type": "application/json" }, body: "{}" });
    assert.equal(asUser.status, 401);
    assert.equal((await asUser.json()).denied.code, "E_AUTH");
    // The service mints sessions for accounts the application authenticated itself.
    const bob = await mintSession(url, serviceToken, "member:bob", "member");
    const carol = await mintSession(url, serviceToken, "member:carol", "member", 7);
    assert.equal(bob.principal, "member:bob");
    assert.equal(carol.kind, "member");
    await assert.rejects(mintSession(url, serviceToken, "user:42"), /E_AUTH/);
    const as = (session) => ({ "content-type": "application/json", authorization: `Bearer ${session.token}` });
    const mutate = async (session, op, args) => (await (await fetch(`${url}/m/${op}`, { method: "POST", headers: as(session), body: JSON.stringify({ args }) })).json());
    for (const session of [bob, carol]) assert.equal((await mutate(session, "join", { conversationId: "c1" })).state, "sent");
    // Bob holds a poll open: connected. Carol does not.
    const poll = fetch(`${url}/changes?since=0&wait=5`, { headers: as(bob) });
    const online = async (p) => (await (await fetch(`${url}/q/online`, { method: "POST", headers: as(bob), body: JSON.stringify({ args: { p } }) })).json()).data;
    await awaitState(async () => await online("member:bob") === 1, "Bob's held poll establishes presence");
    assert.equal(await online("member:bob"), 1);
    assert.equal(await online("member:carol"), 0);
    // Bob sends while carol has no connection: one effect, for carol.
    assert.equal((await mutate(bob, "send", { conversationId: "c1", body: "hello carol " + "x".repeat(100) })).state, "sent");
    await poll;
    const queued = await listEffects(url, serviceToken, "queued");
    assert.equal(queued.length, 1, JSON.stringify(queued));
    assert.equal(queued[0].payload.targetUserId, "member:carol");
    assert.equal(queued[0].payload.preview.length, 80);
    // The worker claims, performs and settles; a first failure retries.
    const delivered = [];
    let attempts = 0;
    const worker = runWorker({
      url,
      token: serviceToken,
      wait: 1,
      signal: stop.signal,
      effects: {
        notify: async (payload, meta) => {
          attempts += 1;
          if (attempts === 1) throw new Error("provider 503");
          delivered.push({ payload, attempt: meta.attempt });
          return { providerId: `apns-${meta.id}` };
        },
      },
    });
    const until = performance.now() + hangBudget();
    while (delivered.length === 0 && performance.now() < until) await sleep(50);
    assert.equal(delivered.length, 1, "the retry delivered it");
    assert.equal(delivered[0].attempt, 2);
    assert.equal(delivered[0].payload.chatId, "c1");
    let sent = [];
    while (sent.length === 0 && performance.now() < until) { sent = await listEffects(url, serviceToken, "sent"); if (sent.length === 0) await sleep(50); }
    assert.equal(sent.length, 1);
    assert.equal(sent[0].result.providerId, `apns-${sent[0].id}`);
    assert.equal(sent[0].attempt, 2);
    // Revocation ends every session of an account.
    assert.equal(await revokeSessions(url, serviceToken, "member:carol"), 1);
    const gone = await fetch(`${url}/q/online`, { method: "POST", headers: as(carol), body: JSON.stringify({ args: { p: "member:bob" } }) });
    assert.equal(gone.status, 401);
    stop.abort();
    await worker.done;
  } finally {
    stop.abort();
    child.kill("SIGTERM");
    await Promise.race([exited, sleep(2000)]);
    if (child.exitCode == null) child.kill("SIGKILL");
    rmSync(directory, { recursive: true, force: true });
  }
});


const action = name => ({ kind: "action", name });
const actionSource = `use personas alice, bob
use identity
effect notify
use server
action echo(message: text <=200)
action fail()
action slow()
action retry()
action gated() <- viewer = 'service:worker'
action blocked() <- deny
table notes:
  owner: principal
  body: text <=200
  by byOwner: owner, id
  read <- .owner = viewer
  insert <- .owner = viewer
  sync to .owner last 10 by byOwner
mutation save(body: text <=200):
  return insert notes { owner: viewer, body }
query mine():
  return notes[viewer] first 10 by byOwner
`;
async function until(check) { return awaitState(check); }
async function actionFixture(t, { worker, source = actionSource, flags = [] } = {}) {
  const directory = mkdtempSync(join(tmpdir(), "sb4-actions-"));
  mkdirSync(join(directory, "snapback"));
  mkdirSync(join(directory, "devices"));
  writeFileSync(join(directory, "snapback/schema.q"), source);
  if (worker) {
    if (worker.packageType) writeFileSync(join(directory, "package.json"), JSON.stringify({ type: worker.packageType }));
    mkdirSync(join(directory, "node_modules"));
    symlinkSync(join(root, "packages/snapback4"), join(directory, "node_modules/snapback4"));
    writeFileSync(join(directory, `snapback/worker.${worker.ext ?? "ts"}`), worker.text);
  }
  const initialized = spawnSync(binary, ["test", "--residency"], { cwd: directory, encoding: "utf8" });
  assert.equal(initialized.status, 0, initialized.stderr);
  const minted = spawnSync(binary, ["token", "--service", "worker"], { cwd: directory, encoding: "utf8" });
  assert.equal(minted.status, 0, minted.stderr);
  const token = minted.stdout.trim();
  const otherToken = spawnSync(binary, ["token", "--service", "other"], { cwd: directory, encoding: "utf8" });
  const nextToken = spawnSync(binary, ["token", "--service", "worker"], { cwd: directory, encoding: "utf8" });
  assert.equal(otherToken.status, 0, otherToken.stderr); assert.equal(nextToken.status, 0, nextToken.stderr);
  const child = spawn(binary, ["dev", "--port", "0", "--no-watch", ...flags], { cwd: directory, stdio: ["ignore", "pipe", "pipe"] });
  const exited = once(child, "exit");
  let log = "", stdout = "", stderr = "", url;
  child.stdout.on("data", data => { log += data; stdout += data; url ??= stdout.match(/http:\/\/127\.0\.0\.1:\d+/)?.[0]; });
  child.stderr.on("data", data => { log += data; stderr += data; });
  const safeLog = () => log.replace(/token \(printed once\): \S+/g, "token (printed once): <redacted>");
  const clients = [], workers = [];
  const stop = new AbortController();
  const stopServer = async () => {
    child.kill("SIGTERM");
    await Promise.race([exited, sleep(4000)]);
    if (child.exitCode == null && child.signalCode == null) { child.kill("SIGKILL"); await exited; }
  };
  t.after(async () => { stop.abort(); await Promise.all(workers.map(w => w.done)); for (const client of clients) await client.close(); await stopServer(); rmSync(directory, { recursive: true, force: true }); });
  await until(() => { if (child.exitCode != null) throw Error(safeLog()); return url; });
  const headers = credential => ({ "content-type": "application/json", ...(typeof credential === "string" ? { authorization: `Bearer ${credential}` } : { "x-snapback-persona": "alice" }) });
  const post = async (path, body, credential, lease) => {
    const response = await fetch(`${url}${path}`, { method: "POST", headers: { ...headers(credential), ...(lease ? { "x-snapback-action-lease": lease } : {}) }, body: JSON.stringify(body) });
    return { status: response.status, ...await response.json() };
  };
  return { url, directory, child, token, otherToken, nextToken, stop, workers, clients, post, log: safeLog, stdout: () => stdout, stderr: () => stderr, stopServer, launch(options) { const w = runWorker({ url, token, wait: 1, signal: stop.signal, ...options }); workers.push(w); return w; } };
}

// @ref LLP 3000.011.005.000#4 — provider acceptance and local settlement are separate; a lost outcome reconciles or parks.
for (const resolvable of [true, false]) test(`provider test double: killed accepted worker ${resolvable ? "reconciles one delivery" : "parks an unknown outcome"}`, { timeout: hangBudget(25) }, async t => {
  const f = await actionFixture(t, { source: `${actionSource}\nmutation notify():\n  emit notify { message: 'disposable provider fixture' }\n` });
  // Labeled loopback double, owned by this test. Its state survives only the
  // worker crash tested here; this is no claim about a real provider/device.
  const accepted = new Map();
  let requests = 0;
  const provider = createServer(async (request, response) => {
    const chunks = []; for await (const chunk of request) chunks.push(chunk);
    response.setHeader("content-type", "application/json");
    if (request.method === "POST" && request.url === "/send") {
      const { key, payload } = JSON.parse(Buffer.concat(chunks));
      requests++;
      if (!accepted.has(key)) accepted.set(key, { payload, result: { providerId: `double-${accepted.size + 1}` } });
      response.end(JSON.stringify(accepted.get(key).result));
    } else {
      const found = resolvable && accepted.get(decodeURIComponent(request.url.slice("/outcome/".length)));
      response.statusCode = found ? 200 : 404;
      response.end(JSON.stringify(found ? found.result : { error: "outcome unavailable" }));
    }
  });
  provider.listen(0, "127.0.0.1"); await once(provider, "listening");
  t.after(async () => { provider.closeAllConnections(); await new Promise(resolve => provider.close(resolve)); });
  const providerUrl = `http://127.0.0.1:${provider.address().port}`;
  assert.equal((await f.post("/m/notify", { id: "provider-crash-fixture", args: {} })).state, "sent");
  const worker = spawn(process.execPath, ["--input-type=module", "-e", `
    const { FIXTURE_BACKEND: url, FIXTURE_TOKEN: token, FIXTURE_PROVIDER: provider } = process.env;
    async function post(path, body, lease) {
      const response = await fetch(url + path, { method: "POST", headers: {
        "content-type": "application/json", authorization: "Bearer " + token,
        ...(lease ? { "x-snapback-effect-lease": lease } : {}),
      }, body: JSON.stringify(body) });
      const reply = await response.json();
      if (!response.ok || reply.denied) throw Error("fixture worker wire refusal");
      return reply;
    }
    const claim = (await post("/effects/claim", { effect: "notify", limit: 1, lease: 1, fenced: true })).effects[0];
    const step = (await post("/effects/" + claim.id + "/steps/provider/begin", { input: claim.payload }, claim.leaseToken)).step;
    if (step.state !== "run") throw Error("first provider step did not run");
    const response = await fetch(provider + "/send", { method: "POST", body: JSON.stringify({ key: step.key, payload: claim.payload }) });
    if (!response.ok) throw Error("test double refused");
    await response.json();
    process.send({ claim, key: step.key });
    // The provider accepted, but neither the step nor the parent effect has
    // settled. Keep the owned worker alive for the parent's exact crash cut.
    setInterval(() => {}, 1000);
  `], { env: { ...process.env, FIXTURE_BACKEND: f.url, FIXTURE_TOKEN: f.token, FIXTURE_PROVIDER: providerUrl }, stdio: ["ignore", "ignore", "pipe", "ipc"] });
  const exited = once(worker, "exit");
  // Never include the child environment or private claim token in diagnostics.
  let stderr = ""; worker.stderr.on("data", data => { stderr += data; });
  t.after(async () => { if (worker.exitCode == null && worker.signalCode == null) worker.kill("SIGKILL"); await exited; });
  const delivered = await Promise.race([
    once(worker, "message").then(([message]) => message),
    exited.then(() => { throw Error(`provider fixture worker exited before acceptance (${stderr.includes("refused") ? "refused" : "unexpected exit"})`); }),
  ]);
  assert.equal(accepted.size, 1);
  assert.equal((await listEffects(f.url, f.token, "sent")).length, 0, "provider acceptance has not settled the effect");
  worker.kill("SIGKILL"); await exited;
  const first = delivered.claim;
  await until(() => Date.now() > first.leaseUntil);
  const second = await until(async () => (await f.post("/effects/claim", { effect: "notify", limit: 1, lease: 10, fenced: true }, f.token)).effects?.[0]);
  assert.equal(second.id, first.id); assert.equal(second.attempt, 2);
  assert.notEqual(second.leaseToken, first.leaseToken);
  const post = async (path, body, lease = second.leaseToken) => {
    const response = await fetch(f.url + path, { method: "POST", headers: { "content-type": "application/json", authorization: `Bearer ${f.token}`, "x-snapback-effect-lease": lease }, body: JSON.stringify(body) });
    assert.equal(response.status, 200); return response.json();
  };
  const effect = `/effects/${second.id}`, stepPath = `${effect}/steps/provider`;
  for (const path of [`${stepPath}/done`, `${effect}/done`]) {
    assert.equal((await post(path, { result: "stale" }, first.leaseToken)).denied?.code, "E_EFFECT_LEASE");
  }
  const step = (await post(`${stepPath}/begin`, { input: second.payload, reconcile: true })).step;
  assert.equal(step.state, "reconcile"); assert.equal(step.key, delivered.key);
  const outcome = await fetch(`${providerUrl}/outcome/${encodeURIComponent(step.key)}`);
  if (resolvable) {
    assert.equal(outcome.status, 200);
    const result = await outcome.json();
    const replay = await (await fetch(providerUrl + "/send", { method: "POST", body: JSON.stringify({ key: step.key, payload: second.payload }) })).json();
    assert.deepEqual(replay, result, "this double supports idempotent submission under the stable provider key");
    assert.equal((await post(`${stepPath}/done`, { result })).ok, true);
    const recorded = (await post(`${stepPath}/begin`, { input: second.payload })).step;
    assert.equal(recorded.state, "done"); assert.deepEqual(recorded.result, result);
    assert.equal((await post(`${effect}/done`, { result })).ok, true);
    const sent = await listEffects(f.url, f.token, "sent");
    assert.equal(sent.length, 1); assert.equal(sent[0].attempt, 2);
    assert.deepEqual(sent[0].result, result); assert.equal(requests, 2);
  } else {
    assert.equal(outcome.status, 404);
    assert.equal((await post(`${stepPath}/park`, { error: "test double cannot resolve the accepted outcome" })).ok, true);
    const parked = await listEffects(f.url, f.token, "parked");
    assert.equal(parked.length, 1); assert.equal(parked[0].errorCode, "E_STEP_PARKED");
    assert.equal((await listEffects(f.url, f.token, "sent")).length, 0);
    assert.equal(requests, 1, "an uncertain provider outcome must not trigger a blind resend");
  }
  assert.equal(accepted.size, 1);
  t.diagnostic(`loopback provider double only: requests=${requests}, accepted=1, worker=SIGKILL before settlement, outcome=${resolvable ? "reconciled/sent" : "unknown/parked"}, stale claim refused; real provider and device receipt untested`);
});

test("dev injects a usable service token and redacts both child log streams", { timeout: hangBudget(2) }, async t => {
  const f = await actionFixture(t, { worker: { ext: "mjs", text: `
const token = process.env.SNAPBACK_SERVICE_TOKEN;
console.log('stdout-token:' + token); console.error('stderr-token:' + token);
const response = await fetch(process.env.SNAPBACK_URL + '/auth/session', {
  method: 'POST', headers: { authorization: 'Bearer ' + token, 'content-type': 'application/json' },
  body: JSON.stringify({ principal: 'directory-user' })
});
const reply = await response.json();
console.log('injected-auth:' + (reply.session?.principal === 'directory-user'));
setInterval(() => {}, 1000);
` } });
  await until(() => f.log().includes("injected-auth:true"));
  assert.equal(/^http:\/\/127\.0\.0\.1:\d+$/.test(f.stdout().trim()), true, "stdout contains only readiness, never a credential");
  assert.match(f.stderr(), /\[worker:worker\] stdout-token:\[REDACTED\]/);
  assert.match(f.stderr(), /\[worker:worker\] stderr-token:\[REDACTED\]/);
  assert.equal(f.log().includes("printed once"), false);
});

test("actions run as the requesting viewer; client done/failed and replay reach both client tiers", { timeout: hangBudget(14) }, async t => {
  const f = await actionFixture(t);
  let invocations = 0;
  const sessions = [];
  f.launch({ effects: { notify: () => null }, actions: {
    echo: async (args, meta) => {
      invocations++;
      sessions.push(meta.session);
      assert.equal(meta.principal, "dev:alice");
      assert.equal(meta.session.principal, "dev:alice");
      const viewer = createClient({ url: f.url, session: meta.session });
      try {
        const write = await viewer.mutate({ kind: "mutation", name: "save" }, { body: args.message });
        assert.equal(write.state, "sent");
        assert.equal(write.result.owner, "dev:alice");
        const read = await viewer.query({ kind: "query", name: "mine" }, {});
        assert.ok(read.data.some(row => row.id === write.result.id));
        return { message: args.message, principal: meta.session.principal, score: 1.25 };
      } finally { await viewer.close(); }
    },
    fail: () => { throw new GiveUp("the provider refused this address"); },
  } });
  const online = createClient({ url: f.url, persona: "alice" }); f.clients.push(online);
  const device = processDevice({ binary, dir: join(f.directory, "devices"), spawn: (cmd, args) => spawn(cmd, args, { stdio: ["pipe", "pipe", "inherit"] }), writeFile: async (path, text) => writeFileSync(path, text) });
  const local = await createLocalClient({ url: f.url, persona: "alice", device, waitSeconds: 1 }); f.clients.push(local);
  for (const [i, client] of [online, local].entries()) {
    const writes = []; client.onWrite(w => writes.push(w));
    const started = performance.now();
    const done = await client.act(action("echo"), { message: `hello-${i}` }, { id: `hello ${i}/+=%é` });
    assert.equal(done.state, "done", JSON.stringify(done));
    assert.deepEqual(done.result, { message: `hello-${i}`, principal: "dev:alice", score: 1.25 });
    t.diagnostic(`action round trip tier=${i === 0 ? "online" : "device"}: ${(performance.now() - started).toFixed(2)} ms`);
    assert.deepEqual(await client.act(action("echo"), { message: `hello-${i}` }, { id: done.id }), done);
    assert.equal((await client.act(action("echo"), { message: "changed" }, { id: done.id })).denied.code, "E_ID_REUSED");
    assert.equal((await client.act(action("fail"), {}, { id: done.id })).denied.code, "E_ID_REUSED");
    assert.equal((await f.post(`/a/echo`, { id: done.id, args: { message: `hello-${i}` } })).replayed, true);
    const failed = await client.act(action("fail"), {});
    assert.equal(failed.state, "failed"); assert.equal(failed.why.family, "action");
    assert.match(failed.why.message, /provider refused/);
    assert.deepEqual(await client.act(action("fail"), {}, { id: failed.id }), failed);
    assert.deepEqual(writes, [], "an action never emits a mutation receipt or a predicted row");
  }
  assert.equal(invocations, 2, "replays never run the handler again");
  for (const session of sessions) assert.equal((await f.post("/q/mine", { args: {} }, session.token)).status, 401, "settlement revokes the viewer session");
  assert.deepEqual((await f.post("/q/mine", { args: {} }, f.token)).data, [], "the service cannot read the viewer's rows");
});

test("actions pending then settled on retry, lease expiry, fencing, admission and worker authentication", { timeout: hangBudget(23) }, async t => {
  const f = await actionFixture(t);
  const alice = await mintSession(f.url, f.token, "member:alice");
  for (const path of ["/actions/claim", "/actions/id/done", "/actions/id/failed"]) {
    const denied = await f.post(path, {}, alice.token);
    assert.equal(denied.status, 401); assert.equal(denied.denied.code, "E_AUTH");
  }
  assert.equal((await f.post("/a/gated?wait=0", { id: "gated", args: {} }, alice.token)).denied.code, "E_RULE");
  assert.equal((await f.post("/a/gated?wait=0", { id: "allowed", args: {} }, f.token)).state, "pending");
  assert.equal((await f.post("/a/blocked?wait=0", { id: "blocked", args: {} }, f.token)).denied.code, "E_RULE");
  assert.equal((await f.post("/a/echo?wait=0", { id: "bad", args: { message: "x".repeat(201) } }, alice.token)).denied.code, "E_INPUT");
  assert.equal((await f.post("/a/missing", { id: "unknown", args: {} }, alice.token)).denied.code, "E_ACTION_UNKNOWN");
  const started = performance.now();
  const pending = await f.post("/a/slow?wait=1", { id: "r1", args: {} }, alice.token);
  assert.equal(pending.status, 202); assert.equal(pending.state, "pending");
  assert.equal(pending.why.code, "E_ACTION_PENDING"); assert.equal(pending.why.retryable, true);
  t.diagnostic(`pending wait: ${(performance.now() - started).toFixed(2)} ms`);
  const first = (await f.post("/actions/claim", { action: "slow", lease: 1, session: 1 }, f.token)).requests[0];
  assert.equal(first.principal, "member:alice"); assert.equal(first.session.principal, "member:alice"); assert.equal(first.attempt, 1);
  assert.equal((await f.post("/q/mine", { args: {} }, first.session.token)).status, 200);
  assert.equal((await f.post("/auth/refresh", {}, first.session.token)).denied.code, "E_AUTH");
  assert.equal((await f.post("/auth/session", { principal: "member:forged" }, first.session.token)).status, 401);
  await until(() => Date.now() >= first.session.expiresAt);
  assert.equal((await f.post("/q/mine", { args: {} }, first.session.token)).status, 401);
  const second = (await f.post("/actions/claim", { action: "slow" }, f.token)).requests[0];
  assert.equal(second.attempt, 2);
  assert.equal((await f.post("/actions/r1/done", { result: "old" }, f.token, first.session.token)).denied.code, "E_ACTION_LEASE");
  assert.equal((await f.post("/actions/r1/done", { result: { ready: true } }, f.token, second.session.token)).ok, true);
  const replay = await f.post("/a/slow", { id: "r1", args: {} }, alice.token);
  assert.equal(replay.replayed, true); assert.equal(replay.state, "done"); assert.deepEqual(replay.result, { ready: true });
  const bob = await mintSession(f.url, f.token, "member:bob");
  assert.equal((await f.post("/a/slow?wait=0", { id: "r1", args: {} }, bob.token)).denied.code, "E_ACTION_UNKNOWN");
  // Even a request whose original principal is a service gets a delegated
  // data session, never a worker or identity-minting credential.
  const serviceClaim = (await f.post("/actions/claim", { action: "gated" }, f.token)).requests[0];
  assert.equal(serviceClaim.session.principal, "service:worker");
  assert.equal((await f.post("/actions/claim", {}, serviceClaim.session.token)).status, 401);
});

test("actions retry a throwing handler and reauthenticate a waiting caller and worker", { timeout: hangBudget(10) }, async t => {
  const f = await actionFixture(t);
  let attempts = 0;
  f.launch({ actions: { retry: (_, meta) => { attempts++; if (attempts === 1) throw Error("transient"); return { attempt: meta.attempt }; } } });
  const client = createClient({ url: f.url, persona: "alice" }); f.clients.push(client);
  const done = await client.act(action("retry"), {});
  assert.equal(done.state, "done"); assert.equal(done.result.attempt, 2); assert.equal(attempts, 2);
  const caller = await mintSession(f.url, f.token, "member:revoked");
  const waiting = f.post("/a/slow?wait=3", { id: "revoke-me", args: {} }, caller.token);
  await until(async () => (await f.post("/actions/claim", { action: "slow" }, f.token)).requests?.length);
  await revokeSessions(f.url, f.token, caller.principal);
  assert.equal((await waiting).status, 401);
  // A second live token can revoke the service that is holding an empty poll.
  const other = f.otherToken;
  assert.equal(other.status, 0);
  const claim = f.post("/actions/claim", { action: "nothing", wait: 3 }, f.token);
  await sleep(100);
  await revokeSessions(f.url, other.stdout.trim(), "service:worker");
  assert.equal((await claim).status, 401);
});

test("actions are denied offline on both tiers without entering the device queue", { timeout: hangBudget(10) }, async t => {
  const f = await actionFixture(t);
  let offline = false, actionPosts = 0;
  const network = (...args) => { if (String(args[0]).includes("/a/")) actionPosts++; return offline ? Promise.reject(new TypeError("offline")) : fetch(...args); };
  const online = createClient({ url: f.url, persona: "alice", fetch: network }); f.clients.push(online);
  const native = processDevice({ binary, dir: join(f.directory, "devices"), spawn: (cmd, args) => spawn(cmd, args, { stdio: ["pipe", "pipe", "inherit"] }), writeFile: async (path, text) => writeFileSync(path, text) });
  const cores = [];
  const device = { async open(...args) { const core = await native.open(...args); cores.push(core); return core; } };
  const local = await createLocalClient({ url: f.url, persona: "alice", fetch: network, device, waitSeconds: 1 }); f.clients.push(local);
  offline = true;
  await online.query({ kind: "query", name: "mine" }, {});
  await local.sync();
  for (const client of [online, local]) {
    assert.equal(client.link(), "offline");
    const result = await client.act(action("echo"), { message: "offline" });
    assert.equal(result.denied.code, "E_OFFLINE"); assert.equal(result.denied.retryable, true);
  }
  assert.equal(actionPosts, 0);
  assert.deepEqual((await cores[0].call({ op: "queued" })).ok, []);
  offline = false;
  await local.sync();
  const pending = await local.act(action("slow"), {}, { waitSeconds: 0 });
  assert.equal(pending.state, "pending");
  f.launch({ actions: { slow: () => "ready" } });
  const done = await local.act(action("slow"), {}, { id: pending.id });
  assert.equal(done.state, "done"); assert.equal(done.result, "ready");
});

test("chat's real TypeScript invite worker is supervised by dev, restarts and stops with it", { timeout: hangBudget(6) }, async t => {
  const reference = readFileSync(join(root, "apps/chat/snapback/worker.ts"), "utf8");
  const source = readFileSync(join(root, "apps/chat/snapback/schema.q"), "utf8");
  // The reference worker keeps its production 60 s lease / 25 s poll: dev
  // closes a killed child's own session, so its orphaned claim poll fails
  // reauthentication instead of leasing the next request to nobody.
  const worker = reference;
  // Exercise the actual reference after one intentional crash; only this
  // fixture's worker PID is ever signalled by the test.
  const f = await actionFixture(t, { source, worker: { text: worker } });
  const client = createClient({ url: f.url, persona: "alice" }); f.clients.push(client);
  const result = await client.act(action("invite"), { email: "friend@example.com" });
  assert.equal(result.state, "done", JSON.stringify(result) + f.log());
  assert.deepEqual(result.result, { principal: "member:friend@example.com" });
  const before = f.log().match(/worker\.ts \(pid (\d+)\)/g) ?? [];
  assert.equal(before.length, 1);
  const pid = Number(before[0].match(/pid (\d+)/)[1]);
  process.kill(pid, "SIGKILL");
  await until(() => (f.log().match(/worker\.ts \(pid (\d+)\)/g) ?? []).length === 2);
  assert.match(f.log(), /restarting in 250 ms/);
  assert.equal((f.log().match(/token \(printed once\)/g) ?? []).length, 0);
  const result2 = await client.act(action("invite"), { email: "another@example.com" });
  assert.equal(result2.state, "done");
  const failed = await client.act(action("invite"), { email: "invalid" });
  assert.equal(failed.state, "failed");
  const doctor = spawnSync(binary, ["doctor"], { cwd: f.directory, encoding: "utf8" });
  assert.equal(doctor.status, 0, doctor.stdout + doctor.stderr);
  assert.match(doctor.stdout, /worker.*worker\.ts/); assert.match(doctor.stdout, /requests.*0 queued, 0 running, 2 done, 1 failed/);
  const lastPid = Number((f.log().match(/worker\.ts \(pid (\d+)\)/g) ?? []).at(-1).match(/pid (\d+)/)[1]);
  await f.stopServer();
  assert.throws(() => process.kill(lastPid, 0), { code: "ESRCH" });
});

for (const ext of ["mjs", "mts"]) test(`dev also starts a worker.${ext}`, { timeout: hangBudget(2) }, async t => {
  const text = `import { runWorker } from 'snapback4/worker';
const stop = new AbortController(); process.once('SIGTERM', () => stop.abort());
await runWorker({ url: process.env.SNAPBACK_URL, token: process.env.SNAPBACK_SERVICE_TOKEN, signal: stop.signal, actions: { slow: () => 'mjs' } }).done;`;
  const f = await actionFixture(t, { worker: { ext, text, packageType: "commonjs" } });
  const client = createClient({ url: f.url, persona: "alice" }); f.clients.push(client);
  assert.equal((await client.act(action("slow"), {})).result, "mjs");
});

test("a lost action settlement retries its lease; a non-JSON result fails once", { timeout: hangBudget(4) }, async t => {
  const f = await actionFixture(t);
  let dropped = false, invalidCalls = 0;
  const errors = [], ids = [];
  f.launch({ lease: 1, actionSessions: { echo: 1 }, onError: error => errors.push(error),
    fetch: (url, init) => {
      if (String(url).endsWith("/done") && !dropped) { dropped = true; return Promise.reject(new TypeError("connection lost before settlement")); }
      return fetch(url, init);
    },
    actions: {
      echo: (_, meta) => { ids.push(meta.id); return { attempt: meta.attempt }; },
      fail: () => { invalidCalls++; return 1n; },
    },
  });
  const client = createClient({ url: f.url, persona: "alice" }); f.clients.push(client);
  const done = await client.act(action("echo"), { message: "retry" });
  assert.equal(done.state, "done", JSON.stringify(done));
  assert.deepEqual(done.result, { attempt: 2 });
  assert.deepEqual(ids, [done.id, done.id]);
  assert.equal(errors.length, 1);
  const invalid = await client.act(action("fail"), {});
  assert.equal(invalid.state, "failed"); assert.equal(invalid.why.family, "action");
  assert.equal(invalidCalls, 1);
  assert.deepEqual(await client.act(action("fail"), {}, { id: invalid.id }), invalid);
});

for (const state of ["queued", "failed", "sent", "running"]) test(`lost effect lease on the wire reports ${state}`, { timeout: hangBudget(13) }, async t => {
  const f = await actionFixture(t, { source: `${actionSource}\nmutation notify():\n  emit notify { message: 'hello' }\n` });
  const info = t.mock.method(console, "info", () => {}), errors = [];
  const other = f.otherToken;
  assert.equal(other.status, 0, other.stderr);
  const otherToken = other.stdout.trim();
  const expire = async effect => {
    await until(() => Date.now() > effect.leaseUntil);
    assert.equal((await f.post("/dev/clock/advance", { duration: "1ms" })).advancedMs, 1);
  };
  assert.equal((await f.post("/m/notify", { args: {} })).state, "sent");
  if (state === "failed") for (let attempt = 1; attempt < 8; attempt++) {
    const claim = (await f.post("/effects/claim", { effect: "notify", lease: 1 }, f.token)).effects[0];
    assert.equal(claim.attempt, attempt);
    await expire(claim);
  }
  let claim, refused;
  const handlerError = new Error("provider unavailable");
  const worker = f.launch({ lease: 1, onError: error => errors.push(error), effects: { notify: async () => {
    await expire(claim);
    if (state === "sent" || state === "running") {
      const next = (await f.post("/effects/claim", { effect: "notify" }, otherToken)).effects[0];
      assert.equal(next.id, claim.id);
      assert.equal(next.attempt, 2);
      if (state === "sent") assert.equal((await f.post(`/effects/${claim.id}/done`, { result: "other worker" }, otherToken)).ok, true);
    }
    if (state === "queued") throw handlerError;
    return "original worker";
  } }, fetch: async (url, options) => {
    const response = await fetch(url, options), body = await response.json();
    if (url.endsWith("/claim")) claim = body.effects[0];
    else { refused = body.denied; f.stop.abort(); }
    return Response.json(body, { status: response.status });
  } });
  await worker.done;
  assert.equal(refused?.code, "E_EFFECT_LEASE");
  const message = `E_EFFECT_LEASE: effect ${claim.id} is not held by this live claim; claim it first and use its current token`;
  const refusal = `effect ${claim.id} settlement lost authority: ${message}`;
  assert.equal(refused.message, message);
  const recorded = (await listEffects(f.url, f.token))[0];
  assert.equal(recorded.state, state);
  assert.equal(recorded.attempt, state === "failed" ? 8 : state === "queued" ? 1 : 2);
  assert.deepEqual(errors.map(error => error.message), [refusal, ...(state === "queued" ? [handlerError.message] : [])]);
  if (state === "queued") assert.equal(errors[1], handlerError, "the handler's original error and stack survive a refused settlement");
  assert.equal(info.mock.calls.length, 0);
  assert.equal(errors[0].message.match(/E_EFFECT_LEASE:/g)?.length, 1, "the real prefixed refusal must display its code once");
  assert.doesNotMatch(errors[0].message, /\b(?:queued|failed|sent|running|requeued)\b/);
  if (state === "queued") assert.equal(recorded.error, "the lease expired", "the refused handler error must not rewrite the row");
});

for (const state of ["queued", "failed", "sent", "running", "unknown"]) for (const failed of [false, true]) test(`lost effect lease reports ${state} after handler ${failed ? "failure" : "success"}`, async t => {
  const stop = new AbortController(), errors = [], requests = [];
  const info = t.mock.method(console, "info", () => {});
  const handlerError = new Error("provider unavailable");
  const opaque = "effect effect-test is not held by this live claim; claim it first and use its current token";
  const message = state === "failed" || state === "running" ? `E_EFFECT_LEASE: ${opaque}` : opaque;
  const refusal = `effect effect-test settlement lost authority: E_EFFECT_LEASE: ${opaque}`;
  const worker = runWorker({ url: "http://worker.test", token: "service-token", signal: stop.signal, onError: error => errors.push(error),
    effects: { notify: () => { if (failed) throw handlerError; return "sent"; } },
    fetch: async (url, options) => {
      requests.push({ path: new URL(url).pathname, body: JSON.parse(options.body) });
      if (url.endsWith("/claim")) return Response.json({ effects: [{ id: "effect-test", effect: "notify", payload: {}, attempt: state === "failed" ? 8 : 1, seq: 1, at: 0 }] });
      stop.abort();
      return Response.json({ denied: { code: "E_EFFECT_LEASE", message } });
    },
  });
  await worker.done;
  assert.deepEqual(errors.map(error => error.message), [refusal, ...(failed ? [handlerError.message] : [])]);
  if (failed) assert.equal(errors.at(-1), handlerError, "the handler's original error and stack survive a refused settlement");
  assert.deepEqual(info.mock.calls.map(call => call.arguments), []);
  assert.equal(errors[0].message.match(/E_EFFECT_LEASE:/g)?.length, 1, `${message.startsWith("E_EFFECT_LEASE:") ? "prefixed" : "unprefixed"} synthetic refusal must display its code once`);
  assert.doesNotMatch(errors[0].message, /\b(?:queued|failed|sent|running|requeued)\b/);
  assert.equal(requests.length, 2, "a lost claim must not provoke a second settlement");
  assert.equal(requests[1].path, `/effects/effect-test/${failed ? "failed" : "done"}`);
  if (failed) assert.deepEqual(requests[1].body, { error: "provider unavailable", retry: true });
});

test("effect settlement still reports a refusal other than lease loss", async () => {
  const stop = new AbortController(), errors = [];
  const worker = runWorker({ url: "http://worker.test", token: "service-token", signal: stop.signal, onError: error => errors.push(error),
    effects: { notify: () => "sent" },
    fetch: async url => {
      if (url.endsWith("/claim")) return Response.json({ effects: [{ id: "effect-test", effect: "notify", payload: {}, attempt: 1, seq: 1, at: 0 }] });
      stop.abort();
      return Response.json({ denied: { code: "E_AUTH", message: "this session is not live; sign in again" } });
    },
  });
  await worker.done;
  assert.deepEqual(errors.map(error => error.message), ["E_AUTH: this session is not live; sign in again"]);
});


for (const replay of [true, false]) test(`W7r1 runWorker and doctor observe ${replay ? "suppressed" : "deferred"} presence effects`, { timeout: hangBudget(13) }, async t => {
  const settlementReply = Promise.withResolvers();
  t.after(() => settlementReply.resolve());
  const f = await actionFixture(t, { flags: replay ? ["--replay"] : [], source: `use personas alice
 effect notify
 table notes:
   n: int
   public 'worker test'
   insert <- allow
 query notes():
   return notes first 10 by byId
 mutation post():
   insert notes {n: 1}
   if not exists connected[viewer]:
     emit notify {recipient: viewer}
 `.replace(/^ /gm, "") });
  const db = new DatabaseSync(join(f.directory, ".snapback4/store.sqlite"), { readOnly: true });
  t.after(() => db.close());
  const dependencies = () => db.prepare("SELECT COUNT(*) AS n FROM _effect_presence").get().n;
  const effects = () => db.prepare("SELECT state, attempts FROM _outbox").all();
  await (await fetch(`${f.url}/changes?wait=0`, { headers: { "x-snapback-persona": "alice" } })).json();
  assert.equal((await f.post("/m/post", { id: "note", args: {} })).state, "sent");
  assert.equal(dependencies(), replay ? 0 : 1);
  assert.equal(effects().length, replay ? 0 : 1);
  let handlers = 0, claims = 0;
  let settlementReceived = false, polledAfterSettlement = false;
  const errors = [];
  const worker = f.launch({ wait: 0, effects: { notify: () => { handlers++; } }, onError: e => errors.push(String(e)), fetch: async (url, init) => {
    const claim = String(url).endsWith("/effects/claim");
    if (claim && settlementReceived) polledAfterSettlement = true;
    const response = await fetch(url, init);
    if (String(url).endsWith("/done")) { settlementReceived = true; await settlementReply.promise; }
    if (claim) { await response.clone().json(); claims++; }
    return response;
  } });
  await until(() => claims >= 1);
  assert.equal(handlers, 0);
  assert.equal((await f.post("/dev/clock/advance", { duration: "36s" })).advancedMs, 36_000);
  await until(() => replay ? claims >= 2 : effects()[0]?.state === "sent");
  settlementReply.resolve();
  // The database commit precedes the worker's receipt of its response. Stop
  // only at the next claim, after the held settlement has been fully consumed.
  if (!replay) await until(() => polledAfterSettlement);
  f.stop.abort(); await worker.done;
  assert.deepEqual(errors, []);
  assert.equal(handlers, replay ? 0 : 1);
  assert.equal(dependencies(), 0);
  assert.equal((await f.post("/q/notes", { args: {} })).data.length, 1);
  const doctor = spawnSync(binary, ["doctor"], { cwd: f.directory, encoding: "utf8" });
  assert.equal(doctor.status, 0, doctor.stdout + doctor.stderr);
  assert.match(doctor.stdout, replay ? /1 suppressed/ : /1 sent/);
  assert.match(doctor.stdout, replay ? /replay +on/ : /replay +off/);
  if (replay) { assert.deepEqual(effects(), []); assert.equal(db.prepare("SELECT value FROM _meta WHERE key = 'dev:suppressed-effects'").get().value, "1"); }
  else { assert.equal(effects()[0].attempts, 1); }
  t.diagnostic(`replay=${replay} notes=1 handler_attempts=${handlers} dependency_rows=${dependencies()} claim_responses=${claims}`);
});

test("admission binds logout-all, single logout and refresh families over HTTP", async t => {
  const f = await actionFixture(t);
  for (const ending of ["logout-all", "logout", "refresh"]) {
    const caller = await mintSession(f.url, f.token, `member:${ending}`);
    const id = `family-${ending}`;
    assert.equal((await f.post("/a/slow?wait=0", { id, args: {} }, caller.token)).state, "pending");
    const ended = await f.post(`/auth/${ending}`, {}, caller.token);
    assert.equal(ended.status, 200);
    const claims = (await f.post("/actions/claim", { action: "slow" }, f.token)).requests;
    if (ending === "refresh") {
      assert.equal(claims.length, 1);
      await f.post(`/actions/${id}/done`, { result: "private-result" }, f.token, claims[0].session.token);
      assert.equal((await f.post("/a/slow?wait=0", { id, args: {} }, ended.session.token)).result, "private-result");
      await revokeSessions(f.url, f.token, caller.principal);
      const fresh = await mintSession(f.url, f.token, caller.principal);
      const collected = await f.post("/a/slow?wait=0", { id, args: {} }, fresh.token);
      assert.equal(collected.denied.code, "E_ACTION_UNKNOWN");
      assert.equal(JSON.stringify(collected).includes("private-result"), false);
    } else {
      assert.deepEqual(claims, []);
      const why = spawnSync(binary, ["why", id], { cwd: f.directory, encoding: "utf8" });
      assert.equal(why.status, 0, why.stderr);
      assert.match(why.stdout, /E_ACTION_AUTHORITY/);
      assert.match(why.stdout, /attempts: 0/);
    }
  }
});

test("serve supervises a worker with an explicit environment, restart backoff and shutdown", { timeout: hangBudget(8) }, async t => {
  const directory = mkdtempSync(join(tmpdir(), "sb4-serve-worker-"));
  mkdirSync(join(directory, "snapback")); mkdirSync(join(directory, "node_modules"));
  symlinkSync(join(root, "packages/snapback4"), join(directory, "node_modules/snapback4"));
  writeFileSync(join(directory, "snapback/schema.q"), actionSource);
  const entry = join(directory, "snapback/worker.mjs");
  writeFileSync(entry, `import { appendFileSync, writeFileSync } from 'node:fs';
import { runWorker } from 'snapback4/worker';
const file = new URL('../starts.jsonl', import.meta.url);
appendFileSync(file, JSON.stringify({ pid: process.pid, keys: Object.keys(process.env).sort(), inherited: process.env.A1_PARENT_ONLY ?? null }) + '\\n');
const stop = new AbortController(); process.once('SIGTERM', () => stop.abort());
const worker = runWorker({ url: process.env.SNAPBACK_URL, token: process.env.SNAPBACK_SERVICE_TOKEN, wait: 1, signal: stop.signal, actions: { echo: args => ({ message: args.message }) } });
await worker.done; writeFileSync(new URL('../stopped', import.meta.url), 'yes');
`);
  const release = join(directory, "release");
  const deploy = spawnSync(binary, ["deploy", release], { cwd: directory, encoding: "utf8" });
  assert.equal(deploy.status, 0, deploy.stderr);
  const minted = spawnSync(binary, ["token", "--release", release, "--service", "caller"], { cwd: directory, encoding: "utf8" });
  assert.equal(minted.status, 0, minted.stderr);
  const child = spawn(binary, ["serve", release, "--port", "0", "--worker", entry], { cwd: directory, env: { ...process.env, A1_PARENT_ONLY: "must-not-reach-worker" }, stdio: ["ignore", "pipe", "pipe"] });
  const exited = once(child, "exit"); let log = "", url;
  for (const stream of [child.stdout, child.stderr]) stream.on("data", chunk => { log += chunk; url ??= log.match(/http:\/\/127\.0\.0\.1:\d+/)?.[0]; });
  t.after(async () => { if (child.exitCode == null && child.signalCode == null) { child.kill("SIGTERM"); await Promise.race([exited, sleep(4000)]); } if (child.exitCode == null && child.signalCode == null) { child.kill("SIGKILL"); await exited; } rmSync(directory, { recursive: true, force: true }); });
  await until(() => { if (child.exitCode != null) throw Error(log); return url; });
  const starts = () => { try { return readFileSync(join(directory, "starts.jsonl"), "utf8").trim().split("\n").map(JSON.parse); } catch { return []; } };
  await until(() => starts().length === 1);
  const allowed = new Set(["PATH", "HOME", "TMPDIR", "LANG", "LC_ALL", "TZ", "SNAPBACK_URL", "SNAPBACK_SERVICE_TOKEN", "SNAPBACK_PROJECT_DIR", "SNAPBACK_WORKER_LEDGER", "SNAPBACK_WORKER_SUPERVISED"]);
  assert.equal(starts()[0].inherited, null);
  // macOS synthesizes this variable inside the child; it is not inherited.
  if (process.platform === "darwin") allowed.add("__CF_USER_TEXT_ENCODING");
  assert.ok(starts()[0].keys.every(key => allowed.has(key)), JSON.stringify(starts()[0].keys));
  const client = createClient({ url, session: { principal: "service:caller", kind: "service", token: minted.stdout.trim(), expiresAt: Date.now() + 86400000 } });
  t.after(() => client.close());
  assert.equal((await client.act(action("echo"), { message: "first" })).result.message, "first");
  process.kill(starts()[0].pid, "SIGKILL");
  await until(() => starts().length === 2);
  assert.match(log, /restarting in 250 ms/);
  assert.equal((await client.act(action("echo"), { message: "second" })).result.message, "second");
  assert.doesNotMatch(log, /token \(printed once\)|must-not-reach-worker/);
  const doctor = spawnSync(binary, ["doctor", "--release", release], { cwd: directory, encoding: "utf8" });
  assert.equal(doctor.status, 0, doctor.stdout + doctor.stderr);
  assert.match(doctor.stdout, /"starts":2/); assert.match(doctor.stdout, /"restarts":1/); assert.match(doctor.stdout, /"crashes":1/);
  child.kill("SIGTERM"); await exited;
  assert.equal(readFileSync(join(directory, "stopped"), "utf8"), "yes");
  assert.throws(() => process.kill(starts()[1].pid, 0), { code: "ESRCH" });
});

test("an action admitted by a delegated action session fails terminally after its parent settles", async t => {
  const f = await actionFixture(t);
  const caller = await mintSession(f.url, f.token, "member:delegator");
  assert.equal((await f.post("/a/slow?wait=0", { id: "parent", args: {} }, caller.token)).state, "pending");
  const parent = (await f.post("/actions/claim", { action: "slow" }, f.token)).requests[0];
  assert.equal(parent.session.kind, "action");
  assert.equal((await f.post("/a/echo?wait=0", { id: "nested", args: { message: "nested work" } }, parent.session.token)).state, "pending");
  assert.equal((await f.post("/actions/parent/done", { result: "done" }, f.token, parent.session.token)).ok, true);
  assert.deepEqual((await f.post("/actions/claim", { action: "echo" }, f.token)).requests, []);
  const why = spawnSync(binary, ["why", "nested"], { cwd: f.directory, encoding: "utf8" });
  assert.equal(why.status, 0, why.stderr);
  assert.match(why.stdout, /state: "failed"/);
  assert.match(why.stdout, /E_ACTION_AUTHORITY/);
  assert.match(why.stdout, /attempts: 0/);
  assert.equal((await f.post("/a/echo?wait=0", { id: "nested", args: { message: "nested work" } }, caller.token)).denied.code, "E_ACTION_UNKNOWN");
});

test("HTTP service-seat admission binds the service family and refuses work after its logout", async t => {
  const f = await actionFixture(t);
  assert.equal((await f.post("/a/gated?wait=0", { id: "service-admission", args: {} }, f.token)).state, "pending");
  const claim = (await f.post("/actions/claim", { action: "gated" }, f.token)).requests[0];
  assert.equal(claim.principal, "service:worker");
  assert.equal(claim.session.principal, "service:worker");
  assert.equal(claim.session.kind, "action");
  assert.equal((await f.post("/actions/service-admission/done", { result: "service-result" }, f.token, claim.session.token)).ok, true);
  assert.equal((await f.post("/a/gated?wait=0", { id: "service-admission", args: {} }, f.token)).result, "service-result");
  assert.equal((await f.post("/a/gated?wait=0", { id: "service-revoked", args: {} }, f.token)).state, "pending");
  assert.equal((await f.post("/auth/logout", {}, f.token)).status, 200);
  const next = f.nextToken;
  assert.equal(next.status, 0, next.stderr);
  const token = next.stdout.trim();
  assert.deepEqual((await f.post("/actions/claim", { action: "gated" }, token)).requests, []);
  assert.equal((await f.post("/a/gated?wait=0", { id: "service-admission", args: {} }, token)).denied.code, "E_ACTION_UNKNOWN");
  const why = spawnSync(binary, ["why", "service-revoked"], { cwd: f.directory, encoding: "utf8" });
  assert.equal(why.status, 0, why.stderr);
  assert.match(why.stdout, /E_ACTION_AUTHORITY/);
  assert.match(why.stdout, /attempts: 0/);
});

test("dev replaces its supervised worker when the one-day session window ends", async t => {
  const f = await actionFixture(t, { worker: { ext: "mjs", text: "setInterval(() => {}, 1000);" } });
  await until(() => (f.log().match(/worker\.mjs \(pid \d+\)/g) ?? []).length === 1);
  const first = Number(f.log().match(/worker\.mjs \(pid (\d+)\)/)[1]);
  assert.equal((await f.post("/dev/clock/advance", { duration: "1d" })).advancedMs, 86_400_000);
  await until(() => (f.log().match(/worker\.mjs \(pid \d+\)/g) ?? []).length === 2);
  assert.match(f.log(), /supervision window ended/);
  assert.throws(() => process.kill(first, 0), { code: "ESRCH" });
});

test("real HTTP redelivery after a lost settlement acknowledgement replays the durable ledger", { timeout: hangBudget(7) }, async t => {
  const f = await actionFixture(t, { source: actionSource + "\nmutation sendNotification():\n  emit notify { message: 'hello' }\n  return true\n" });
  assert.equal((await f.post("/m/sendNotification", { args: {} })).state, "sent");
  const ledger = join(f.directory, "effects.sqlite");
  let calls = 0, key;
  const firstStop = new AbortController();
  const first = runWorker({ url: f.url, token: f.token, ledger, lease: 1, wait: 0, signal: firstStop.signal,
    effects: { notify: (_payload, meta) => { calls++; key = meta.idempotencyKey; return { receipt: key }; } },
    fetch: async (url, init) => {
      if (url.endsWith("/done")) { firstStop.abort(); throw Error("lost settlement acknowledgement"); }
      if (url.endsWith("/failed")) throw Error("settlement unavailable");
      return fetch(url, init);
    }, onError() {},
  });
  f.workers.push(first);
  t.after(() => firstStop.abort());
  await first.done;
  assert.equal(calls, 1);
  assert.equal((await listEffects(f.url, f.token, "running")).length, 1);
  await sleep(1100); // Expire the real claim; the next runWorker polls the actual server.
  f.launch({ ledger, wait: 0, effects: { notify: () => { calls++; throw Error("must replay the ledger"); } } });
  const [sent] = await until(async () => { const rows = await listEffects(f.url, f.token, "sent"); return rows.length ? rows : false; });
  assert.equal(sent.id, key);
  assert.equal(sent.attempt, 2);
  assert.deepEqual(sent.result, { receipt: key });
  assert.equal(calls, 1);
});

// The worker's door on the real wire: a service token from the CLI, a
// session minted for an account the application authenticated itself,
// presence read by the mutation that emits, and the worker loop claiming
// and settling what was emitted. Only this test's child is stopped.
import test from "node:test";
import assert from "node:assert/strict";
import { spawn, spawnSync } from "node:child_process";
import { once } from "node:events";
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

test("a service mints sessions, the mutation reads presence, the worker settles what was emitted", { timeout: 30_000 }, async () => {
  const directory = mkdtempSync(join(tmpdir(), "sb4-worker-"));
  mkdirSync(join(directory, "snapback"));
  writeFileSync(join(directory, "snapback/schema.q"), source);
  // Not --fresh: the CLI mints the token into the same store file.
  const child = spawn(binary, ["dev", "--port", "0", "--no-watch"], { cwd: directory, stdio: ["ignore", "pipe", "pipe"] });
  const exited = once(child, "exit");
  let log = "", url;
  child.stdout.on("data", (data) => { log += data; url ??= log.match(/http:\/\/127\.0\.0\.1:(\d+)/)?.[0]; });
  child.stderr.on("data", (data) => { log += data; });
  const stop = new AbortController();
  try {
    const deadline = Date.now() + 10_000;
    while (!url && child.exitCode == null && Date.now() < deadline) await sleep(10);
    assert.ok(url, log || "server did not listen");
    const minted = spawnSync(binary, ["token", "--service", "pusher", "--days", "1"], { cwd: directory, encoding: "utf8" });
    assert.equal(minted.status, 0, minted.stderr);
    const serviceToken = minted.stdout.trim();
    assert.match(serviceToken, /^[A-Za-z0-9_-]{40,}$/);
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
    await sleep(150);
    const online = async (p) => (await (await fetch(`${url}/q/online`, { method: "POST", headers: as(bob), body: JSON.stringify({ args: { p } }) })).json()).data;
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
    const until = Date.now() + 15_000;
    while (delivered.length === 0 && Date.now() < until) await sleep(50);
    assert.equal(delivered.length, 1, "the retry delivered it");
    assert.equal(delivered[0].attempt, 2);
    assert.equal(delivered[0].payload.chatId, "c1");
    let sent = [];
    while (sent.length === 0 && Date.now() < until) { sent = await listEffects(url, serviceToken, "sent"); if (sent.length === 0) await sleep(50); }
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
async function until(check, timeout = 10_000) {
  const deadline = Date.now() + timeout;
  for (;;) { const value = await check(); if (value) return value; if (Date.now() >= deadline) throw Error("timed out waiting"); await sleep(20); }
}
async function actionFixture(t, { worker, source = actionSource } = {}) {
  const directory = mkdtempSync(join(tmpdir(), "sb4-actions-"));
  mkdirSync(join(directory, "snapback"));
  mkdirSync(join(directory, "devices"));
  writeFileSync(join(directory, "snapback/schema.q"), source);
  if (worker) {
    mkdirSync(join(directory, "node_modules"));
    symlinkSync(join(root, "packages/snapback4"), join(directory, "node_modules/snapback4"));
    writeFileSync(join(directory, `snapback/worker.${worker.ext ?? "ts"}`), worker.text);
  }
  const child = spawn(binary, ["dev", "--port", "0", "--no-watch"], { cwd: directory, stdio: ["ignore", "pipe", "pipe"] });
  const exited = once(child, "exit");
  let log = "", url;
  child.stdout.on("data", data => { log += data; url ??= log.match(/http:\/\/127\.0\.0\.1:\d+/)?.[0]; });
  child.stderr.on("data", data => { log += data; });
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
  const minted = spawnSync(binary, ["token", "--service", "worker"], { cwd: directory, encoding: "utf8" });
  assert.equal(minted.status, 0, minted.stderr);
  const token = minted.stdout.trim();
  const headers = credential => ({ "content-type": "application/json", ...(typeof credential === "string" ? { authorization: `Bearer ${credential}` } : { "x-snapback-persona": "alice" }) });
  const post = async (path, body, credential, lease) => {
    const response = await fetch(`${url}${path}`, { method: "POST", headers: { ...headers(credential), ...(lease ? { "x-snapback-action-lease": lease } : {}) }, body: JSON.stringify(body) });
    return { status: response.status, ...await response.json() };
  };
  return { url, directory, child, token, stop, workers, clients, post, log: safeLog, stopServer, launch(options) { const w = runWorker({ url, token, wait: 1, signal: stop.signal, ...options }); workers.push(w); return w; } };
}

test("actions run as the requesting viewer; client done/failed and replay reach both client tiers", { timeout: 30_000 }, async t => {
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
  const device = processDevice(binary, join(f.directory, "devices"), (cmd, args) => spawn(cmd, args, { stdio: ["pipe", "pipe", "inherit"] }), async (path, text) => writeFileSync(path, text));
  const local = await createLocalClient({ url: f.url, persona: "alice", device, waitSeconds: 1 }); f.clients.push(local);
  for (const [i, client] of [online, local].entries()) {
    const writes = []; client.onWrite(w => writes.push(w));
    const started = performance.now();
    const done = await client.act(action("echo"), { message: `hello-${i}` }, { id: `hello ${i}/+=%é` });
    assert.equal(done.state, "done", JSON.stringify(done));
    assert.deepEqual(done.result, { message: `hello-${i}`, principal: "dev:alice", score: 1.25 });
    t.diagnostic(`action round trip tier=${i === 0 ? "online" : "device"}: ${(performance.now() - started).toFixed(2)} ms`);
    assert.deepEqual(await client.act(action("echo"), { message: "ignored-on-replay" }, { id: done.id }), done);
    assert.equal((await f.post(`/a/echo`, { id: done.id, args: {} })).replayed, true);
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

test("actions pending then settled on retry, lease expiry, fencing, admission and worker authentication", { timeout: 20_000 }, async t => {
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

test("actions retry a throwing handler and reauthenticate a waiting caller and worker", { timeout: 20_000 }, async t => {
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
  const other = spawnSync(binary, ["token", "--service", "other"], { cwd: f.directory, encoding: "utf8" });
  assert.equal(other.status, 0);
  const claim = f.post("/actions/claim", { action: "nothing", wait: 3 }, f.token);
  await sleep(100);
  await revokeSessions(f.url, other.stdout.trim(), "service:worker");
  assert.equal((await claim).status, 401);
});

test("actions are denied offline on both tiers without entering the device queue", { timeout: 20_000 }, async t => {
  const f = await actionFixture(t);
  let offline = false, actionPosts = 0;
  const network = (...args) => { if (String(args[0]).includes("/a/")) actionPosts++; return offline ? Promise.reject(new TypeError("offline")) : fetch(...args); };
  const online = createClient({ url: f.url, persona: "alice", fetch: network }); f.clients.push(online);
  const native = processDevice(binary, join(f.directory, "devices"), (cmd, args) => spawn(cmd, args, { stdio: ["pipe", "pipe", "inherit"] }), async (path, text) => writeFileSync(path, text));
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

test("chat's real TypeScript invite worker is supervised by dev, restarts and stops with it", { timeout: 20_000 }, async t => {
  const reference = readFileSync(join(root, "apps/chat/snapback/worker.ts"), "utf8");
  const source = readFileSync(join(root, "apps/chat/snapback/schema.q"), "utf8");
  // Exercise the actual reference after one intentional crash; only this
  // fixture's worker PID is ever signalled by the test.
  const f = await actionFixture(t, { source, worker: { text: reference } });
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
  assert.equal(f.log().match(/token \(printed once\)/g).length, 1);
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

test("dev also starts a worker.mjs", { timeout: 15_000 }, async t => {
  const text = `import { runWorker } from 'snapback4/worker';
const stop = new AbortController(); process.once('SIGTERM', () => stop.abort());
await runWorker({ url: process.env.SNAPBACK_URL, token: process.env.SNAPBACK_SERVICE_TOKEN, signal: stop.signal, actions: { slow: () => 'mjs' } }).done;`;
  const f = await actionFixture(t, { worker: { ext: "mjs", text } });
  const client = createClient({ url: f.url, persona: "alice" }); f.clients.push(client);
  assert.equal((await client.act(action("slow"), {})).result, "mjs");
});

test("a lost action settlement retries its lease; a non-JSON result fails once", { timeout: 15_000 }, async t => {
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

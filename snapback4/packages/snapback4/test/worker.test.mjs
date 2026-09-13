// The worker's door on the real wire: a service token from the CLI, a
// session minted for an account the application authenticated itself,
// presence read by the mutation that emits, and the worker loop claiming
// and settling what was emitted. Only this test's child is stopped.
import test from "node:test";
import assert from "node:assert/strict";
import { spawn, spawnSync } from "node:child_process";
import { once } from "node:events";
import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { listEffects, mintSession, revokeSessions, runWorker } from "../dist/worker.js";

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

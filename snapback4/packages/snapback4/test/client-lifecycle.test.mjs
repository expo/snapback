// Real clients, real authored programs, and owned server/device processes.
// The transport gates only control ordering or inject a transient link failure.
import test from "node:test";
import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { once } from "node:events";
import { mkdtempSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { DatabaseSync } from "node:sqlite";
import { createClient } from "../dist/client.js";
import { createLocalClient } from "../dist/local.js";
import { createNativeClient, processCore } from "../dist/native.js";
import { guest, logout } from "../dist/auth.js";
import { nodeSqliteDriver, openSqlite } from "../dist/replica/index.js";

const root = join(dirname(fileURLToPath(import.meta.url)), "../../..");
const binary = process.env.SNAPBACK4_BIN ?? join(root, "target/debug/snapback4");
const query = (name) => ({ kind: "query", name });
const mutation = (name) => ({ kind: "mutation", name });
const thread = query("thread"), inbox = query("inbox"), send = mutation("send");
const args = { conversationId: "c1", c: null };
const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
const deferred = () => { let resolve; const promise = new Promise((r) => { resolve = r; }); return { promise, resolve }; };
async function until(check, message, timeout = 5000) {
  const end = Date.now() + timeout;
  do { const value = await check(); if (value) return value; await sleep(10); } while (Date.now() < end);
  assert.fail(message);
}
async function held(gate, signal) {
  signal?.throwIfAborted();
  let abort;
  try {
    await Promise.race([gate.promise, new Promise((_, reject) => {
      abort = () => reject(signal.reason);
      signal?.addEventListener("abort", abort, { once: true });
    })]);
  } finally { signal?.removeEventListener("abort", abort); }
}

const extra = `
table gates:
  open: bool
  read <- allow
  update <- allow
  sync public last 10 by byId
table secrets:
  body: text <=4000
  read <- allow
query secret(secretId: secrets):
  return secrets[secretId] ! else NOT_FOUND
query message(messageId: messages):
  return messages[messageId] ! else NOT_FOUND
mutation secretSend(secretId: secrets, conversationId: conversations):
  secret = secrets[secretId] ! else NOT_FOUND
  return insert messages { conversationId, authorId: viewer, body: secret.body, at: now }
mutation setGate(gateId: gates, open: bool):
  update gates[gateId] { open }
  return null
mutation guardedEdit(messageId: messages, gateId: gates, body: text <=4000):
  gate = gates[gateId] ! else GATE_MISSING
  require gate.open else CLOSED
  update messages[messageId] { body }
  return null
mutation guardedDelete(messageId: messages, gateId: gates):
  gate = gates[gateId] ! else GATE_MISSING
  require gate.open else CLOSED
  delete messages[messageId]
  return null
table sources:
  owner: principal
  by byOwner: owner, id
  cap 10 by owner
  read <- .owner = viewer
  insert <- .owner = viewer
  sync to .owner
table copies:
  sourceId: sources
  read <- allow
  insert <- allow
  sync public last 20 by byId
query copied():
  return copies[] first 20 by byId
mutation addSource():
  return insert sources { owner: viewer }
mutation copySources():
  for source in sources[viewer] first 10 by byOwner:
    copied = insert copies { sourceId: source.id }
  return null
table counters:
  value: int
  read <- allow
  update <- allow
  sync public last 10 by byId
query counter(counterId: counters):
  return counters[counterId] ! else NOT_FOUND
mutation increment(counterId: counters):
  counter = counters[counterId] ! else NOT_FOUND
  update counters[counter] { value: counter.value + 1 }
  return null
`;

async function fixture(t) {
  const directory = mkdtempSync(join(tmpdir(), "sb4-client-lifecycle-"));
  mkdirSync(join(directory, "snapback"));
  writeFileSync(join(directory, "snapback/schema.q"), readFileSync(join(root, "apps/chat/snapback/schema.q"), "utf8") + extra);
  const child = spawn(binary, ["dev", "--port", "0", "--fresh", "--no-watch"], { cwd: directory, stdio: ["ignore", "pipe", "pipe"] });
  const exited = once(child, "exit");
  let log = "", url;
  child.stdout.on("data", (data) => { log += data; url ??= log.match(/http:\/\/127\.0\.0\.1:\d+/)?.[0]; });
  child.stderr.on("data", (data) => { log += data; });
  const clients = new Set(), children = new Set();
  t.after(async () => {
    await Promise.allSettled([...clients].map((client) => client.close()));
    for (const device of children) if (device.exitCode == null && device.signalCode == null) device.kill("SIGTERM");
    if (child.exitCode == null && child.signalCode == null) child.kill("SIGTERM");
    await exited;
    rmSync(directory, { recursive: true, force: true });
  });
  await until(() => { assert.equal(child.exitCode, null, log); return url; }, "server did not listen");
  const seed = async (rows) => {
    const response = await fetch(url + "/seed", { method: "POST", body: JSON.stringify(rows) });
    const result = await response.json();
    assert.equal(result.seeded, rows.length, JSON.stringify(result));
  };
  const rows = [];
  for (const id of ["c1", "c2"]) {
    rows.push({ table: "conversations", row: { id, title: id, creatorId: "dev:alice" } });
    rows.push({ table: "memberships", row: { id: `alice-${id}`, conversationId: id, principal: "dev:alice", role: "admin", joinedAt: 1 } });
  }
  rows.push({ table: "memberships", row: { id: "bob-c1", conversationId: "c1", principal: "dev:bob", role: "member", joinedAt: 1 } });
  for (const [id, at] of [["msg-a", 1], ["msg-b", 2]]) rows.push({ table: "messages", row: { id, conversationId: "c1", authorId: "dev:alice", body: id, at } });
  rows.push({ table: "gates", row: { id: "gate", open: true } }, { table: "secrets", row: { id: "secret", body: "online-only result" } });
  await seed(rows);
  const server = createClient({ url, persona: "alice" });
  clients.add(server);
  const native = processCore(binary, (command, params) => {
    const device = spawn(command, params, { stdio: ["pipe", "pipe", "inherit"] });
    children.add(device);
    device.once("exit", () => children.delete(device));
    return device;
  }, async (path, text) => writeFileSync(path, text));
  async function open(tier, options = {}) {
    const dataDir = join(directory, options.name ?? tier);
    mkdirSync(dataDir, { recursive: true });
    const common = { url, persona: options.persona ?? "alice", fetch: options.fetch, waitSeconds: 1 };
    const client = tier === "native"
      ? await createNativeClient({ ...common, native: options.wrapNative ? { open: async (...params) => options.wrapNative(await native.open(...params)) } : native, dataDir })
      : tier === "online" ? createClient(common)
      : await createLocalClient({ ...common, store: { open: async (_name, schema) => {
        const store = await openSqlite(nodeSqliteDriver(new DatabaseSync(join(dataDir, "device.sqlite"))), schema);
        return options.wrapStore ? options.wrapStore(store) : store;
      } } });
    clients.add(client);
    return client;
  }
  return { url, server, open, seed, clients };
}

test("online watches retain their changes watermark; bare tokens clear on refusal", { timeout: 15_000 }, async (t) => {
  const f = await fixture(t);
  const changes = deferred();
  const online = await f.open("online", { fetch: async (input, init) => {
    if (new URL(input).pathname === "/changes") await held(changes, init.signal);
    return fetch(input, init);
  } });
  const watch = online.observe(thread, args);
  await until(() => watch.getSnapshot().data?.length === 2, "initial online watch");
  assert.equal((await f.server.mutate(send, { conversationId: "c1", body: "foreign" })).state, "sent");
  assert.equal((await online.query(thread, args)).data.length, 3);
  assert.equal(watch.getSnapshot().data.length, 2, "direct queries do not refresh or advance another observation");
  changes.resolve();
  await until(() => watch.getSnapshot().data?.length === 3, "the original changes interval must still reach the watch");
  const signedIn = await guest(f.url);
  assert.equal(signedIn.ok, true);
  const bearer = createClient({ url: f.url, token: signedIn.session.token });
  f.clients.add(bearer);
  assert.ok("data" in await bearer.query(inbox, {}));
  assert.equal(bearer.viewer(), signedIn.session.principal);
  await logout(f.url, signedIn.session.token);
  assert.equal((await bearer.query(inbox, {})).denied.code, "E_AUTH");
  assert.equal(bearer.viewer(), null);
  assert.equal(bearer.link(), "signed-out");
});

for (const tier of ["local", "native"]) {
  for (const loseReply of [false, true]) {
    test(`${tier}: sync before a ${loseReply ? "lost" : "delayed"} write reply does not apply an increment twice`, { timeout: 12_000 }, async (t) => {
      const f = await fixture(t);
      await f.seed([{ table: "counters", row: { id: "counter", value: 0 } }]);
      const reply = deferred(), entered = deferred(), laterPost = deferred();
      let sends = 0, offline = false;
      const transport = async (input, init) => {
        if (offline) throw new TypeError("offline");
        if (new URL(input).pathname === "/m/increment") {
          if (sends++ === 0) {
            const response = await fetch(input, init);
            assert.equal((await response.clone().json()).state, "sent");
            entered.resolve(); await held(reply, init.signal);
            return response;
          }
          await held(laterPost, init.signal);
        }
        return fetch(input, init);
      };
      const client = await f.open(tier, { fetch: transport });
      const counter = query("counter"), increment = mutation("increment"), counterArgs = { counterId: "counter" };
      const first = client.mutate(increment, counterArgs);
      await entered.promise;
      const second = loseReply ? null : client.mutate(increment, counterArgs);
      if (second) await until(async () => (await client.query(counter, counterArgs)).data?.value === 2, "both predictions are visible");
      await client.sync();
      const reflected = await client.query(counter, counterArgs);
      assert.equal(reflected.data.value, second ? 2 : 1, "the stream correlation replaces the already-committed prediction");
      assert.equal(reflected.data.pending, second ? true : undefined);
      if (loseReply) {
        offline = true;
        await client.close();
        assert.equal((await first).state, "pending");
        const cold = await f.open(tier, { fetch: transport });
        assert.equal((await cold.query(counter, counterArgs)).data.value, 1, "an offline reopen preserves the correlated confirmed state");
        await cold.close();
        offline = false;
        reply.resolve(); laterPost.resolve();
        const resumed = await f.open(tier, { fetch: transport });
        await until(() => sends >= 2, "the original admitted write is retried to obtain its reply");
        await resumed.sync();
        assert.equal((await f.server.query(counter, counterArgs)).data.value, 1, "deduplication preserves one authoritative increment");
      } else {
        reply.resolve();
        assert.equal((await first).state, "sent");
        assert.equal((await client.query(counter, counterArgs)).data.value, 2, "settling the earlier write keeps the later prediction");
        laterPost.resolve();
        assert.equal((await second).state, "sent");
        assert.equal((await f.server.query(counter, counterArgs)).data.value, 2);
      }
    });
  }

  test(`${tier}: background sync timestamps survive reconnect and unwraps beyond the horizon use the server`, { timeout: 12_000 }, async (t) => {
    const f = await fixture(t);
    await f.seed(Array.from({ length: 500 }, (_, n) => ({ table: "messages", row: { id: `horizon-${n}`, conversationId: "c1", authorId: "dev:alice", body: `horizon-${n}`, at: n + 3 } })));
    let offline = false;
    const transport = (input, init) => offline ? Promise.reject(new TypeError("offline")) : fetch(input, init);
    const client = await f.open(tier, { fetch: transport });
    assert.equal((await client.query(query("message"), { messageId: "msg-a" })).data?.body, "msg-a", "a missing local row is not a final NOT_FOUND beyond the horizon");
    const observed = client.observe(thread, args);
    await sleep(25);
    const changedAt = Date.now();
    assert.equal((await f.server.mutate(send, { conversationId: "c1", body: "followed sync" })).state, "sent");
    await until(() => observed.getSnapshot().fresh && observed.getSnapshot().data?.some((row) => row.body === "followed sync"), "the follower reaches the new server state");
    offline = true;
    await client.sync();
    const stale = await client.query(thread, args);
    assert.equal(stale.fresh, false);
    assert.ok(stale.since >= changedAt, "since names the latest followed sync, not initial open");
    assert.equal((await client.query(query("message"), { messageId: "msg-a" })).denied?.code, "E_OFFLINE");
    await client.close();
    const cold = await f.open(tier, { fetch: transport });
    const restored = await cold.query(thread, args);
    assert.equal(restored.fresh, false);
    assert.ok(restored.since >= changedAt, "the sync timestamp survives an offline reopen");
  });

  test(`${tier}: population growth cannot mint new IDs during prediction replay`, { timeout: 12_000 }, async (t) => {
    const f = await fixture(t);
    await f.seed([{ table: "sources", row: { id: "source-0", owner: "dev:alice" } }]);
    const entered = deferred(), release = deferred();
    let postedIds;
    const client = await f.open(tier, { fetch: async (input, init) => {
      if (new URL(input).pathname === "/m/copySources") {
        postedIds = JSON.parse(init.body).newIds;
        entered.resolve(); await held(release, init.signal);
      }
      return fetch(input, init);
    } });
    const write = client.mutate(mutation("copySources"), {});
    await entered.promise;
    const original = await client.query(query("copied"), {});
    assert.equal(original.data.length, 1);
    assert.equal(original.data[0].pending, true);
    const originalId = original.data[0].id;
    assert.equal((await f.server.mutate(mutation("addSource"), {})).state, "sent");
    await client.sync();
    const rebased = await client.query(query("copied"), {});
    assert.deepEqual(rebased.data, [], "an attempt needing another ID withdraws the prediction and uses authority");
    assert.deepEqual(postedIds, [originalId], "the in-flight request retains exactly the admitted IDs");
    release.resolve();
    assert.equal((await write).state, "sent");
    await until(async () => (await client.query(query("copied"), {})).data?.length === 2, "authority provides both final rows");
  });

  test(`${tier}: retry without observers, online-only routing and denied-watch recovery`, { timeout: 20_000 }, async (t) => {
    const f = await fixture(t);
    let failures = 1, offline = false, tries = 0;
    const deviceRefusals = [];
    const wrapNative = (core) => ({
      async call(request) {
        const result = await core.call(request);
        if (result.denied) deviceRefusals.push({ op: request.op, denied: result.denied });
        return result;
      },
      close: () => core.close(),
    });
    const transport = async (input, init) => {
      if (offline) throw new TypeError("offline");
      if (new URL(input).pathname === "/m/send") {
        tries++;
        if (failures-- > 0) return Response.json({ error: "temporarily unavailable" }, { status: 503 });
      }
      return fetch(input, init);
    };
    let client = await f.open(tier, { fetch: transport, wrapNative });
    const retried = await client.mutate(send, { conversationId: "c1", body: "retried once" });
    assert.ok(["sent", "pending"].includes(retried.state), JSON.stringify(retried));
    await until(async () => (await f.server.query(thread, args)).data.some((row) => row.body === "retried once"), `one 503 must retry without a watch or manual sync: ${JSON.stringify(deviceRefusals)}`);
    assert.equal(tries, 2);
    assert.equal((await client.query(query("secret"), { secretId: "secret" })).data.body, "online-only result");
    offline = true;
    await client.sync();
    const queued = await client.mutate(mutation("secretSend"), { secretId: "secret", conversationId: "c1" });
    assert.equal(queued.state, "pending", JSON.stringify(queued));
    await client.close();
    offline = false;
    client = await f.open(tier, { fetch: transport });
    await until(async () => (await f.server.query(thread, args)).data.some((row) => row.body === "online-only result"), "a restored online-only write must be sent without requiring prediction");
    const bob = await f.open(tier, { name: `${tier}-bob`, persona: "bob" });
    const denied = bob.observe(thread, { conversationId: "c2", c: null });
    await until(() => denied.getSnapshot().denied?.code === "MEMBERSHIP_REQUIRED", "initial denied read");
    assert.equal((await f.server.mutate(mutation("invite"), { conversationId: "c2", principal: "dev:bob" })).state, "sent");
    await until(() => "data" in denied.getSnapshot(), "a require refusal must retain membership dependencies and recover");
  });

  for (const operation of ["guardedEdit", "guardedDelete"]) {
    test(`${tier}: a rejected ${operation} restores confirmed and maintained rows under a later prediction`, { timeout: 15_000 }, async (t) => {
      const f = await fixture(t);
      const first = deferred(), second = deferred(), sync = deferred(), reached = deferred();
      let holdSync = false;
      const client = await f.open(tier, { fetch: async (input, init) => {
        const path = new URL(input).pathname;
        if (path === `/m/${operation}`) { reached.resolve(); await held(first, init.signal); }
        if (path === "/m/send") await held(second, init.signal);
        if (path === "/sync" && holdSync) await held(sync, init.signal);
        return fetch(input, init);
      } });
      holdSync = true;
      const rejected = client.mutate(mutation(operation), { messageId: "msg-a", gateId: "gate", ...(operation === "guardedEdit" ? { body: "rejected edit" } : {}) });
      await reached.promise;
      const later = client.mutate(send, { conversationId: "c1", body: "later pending" });
      await until(async () => (await client.query(thread, args)).data?.some((row) => row.body === "later pending" && row.pending), "later prediction is visible");
      assert.equal((await f.server.mutate(mutation("setGate"), { gateId: "gate", open: false })).state, "sent");
      first.resolve();
      const outcome = await rejected;
      assert.equal(outcome.state, "failed", JSON.stringify(outcome));
      assert.equal(outcome.why.code, "CLOSED");
      const read = await client.query(thread, args);
      assert.equal(read.data.find((row) => row.id === "msg-a")?.body, "msg-a", "the confirmed update/deletion before-image is restored");
      assert.equal(read.data.find((row) => row.body === "later pending")?.pending, true, "a later prediction survives rollback");
      assert.equal((await client.query(inbox, {})).data.find((row) => row.conversationId === "c1").count, 3, "the count is rebased with the source rows");
      holdSync = false;
      sync.resolve(); second.resolve();
      assert.equal((await later).state, "sent");
      await until(async () => (await client.query(thread, args)).data.every((row) => !row.pending), "the later prediction is eventually confirmed");
    });
  }
}

test("close aborts online posts and stops admission", { timeout: 10_000 }, async (t) => {
  const f = await fixture(t);
  const entered = deferred();
  let aborts = 0;
  const online = await f.open("online", { fetch: async (input, init) => {
    if (new URL(input).pathname.startsWith("/m/")) {
      entered.resolve();
      try { await held(deferred(), init.signal); }
      finally { aborts++; }
    }
    return fetch(input, init);
  } });
  const write = online.mutate(send, { conversationId: "c1", body: "never sent" });
  await entered.promise;
  await online.close();
  assert.equal(aborts, 1);
  assert.equal((await write).state, "failed");
  assert.equal((await online.mutate(send, { conversationId: "c1", body: "closed" })).why.code, "E_CLOSED");
  assert.equal((await f.server.query(thread, args)).data.length, 2);
});

test("native process failures reject opening and pending calls instead of leaving close waiting", { timeout: 3000 }, async () => {
  const opener = (script) => processCore(process.execPath, (command) => spawn(command, ["-e", script], { stdio: ["pipe", "pipe", "inherit"] }), async () => {});
  await assert.rejects(opener("process.exit(4)").open("unused", null), /exited/);
  const core = await opener('process.stdout.write(JSON.stringify({ok:true}) + "\\n"); process.stdin.once("data", () => process.exit(5));').open("unused", null);
  await assert.rejects(core.call({ op: "state" }), /exited/);
  await core.close();
  await assert.rejects(core.call({ op: "state" }), /closed|exited/);
});

test("online serialization failures retain the minted id without scheduling network retries", async () => {
  let requests = 0;
  const client = createClient({ url: "http://invalid", persona: "alice", fetch: async () => { requests++; throw Error("should not send"); } });
  const circular = {}; circular.self = circular;
  const result = await client.mutate(send, circular);
  assert.equal(result.state, "failed");
  assert.equal(result.why.code, "E_INPUT");
  assert.match(result.id, /^[0-9A-Z]{26}$/);
  assert.equal(requests, 0);
  assert.equal(client.link(), "online");
  await client.close();
});

for (const tier of ["local", "native"]) {
  test(`${tier}: close waits for an applying acknowledgment and aborts sync`, { timeout: 10_000 }, async (t) => {
    const f = await fixture(t);
    const entered = deferred(), release = deferred();
    let storeClosed = false;
    const wrapStore = (store) => ({
      setSchema: (...args) => store.setSchema(...args),
      read: (...args) => store.read(...args),
      write: (body) => store.write((tx) => body({ ...tx, side: (name) => {
        const side = tx.side(name);
        return { ...side, async put(key, value) {
          if (name === "outbox" && value.sentSeq !== undefined) { entered.resolve(); await release.promise; }
          return side.put(key, value);
        } };
      } })),
      async close() { storeClosed = true; await store.close(); },
    });
    const wrapNative = (core) => ({
      async call(request) {
        if (request.op === "settle" && request.seq !== undefined) { entered.resolve(); await release.promise; }
        return core.call(request);
      },
      async close() { storeClosed = true; await core.close(); },
    });
    const client = await f.open(tier, { wrapStore, wrapNative });
    const write = client.mutate(send, { conversationId: "c1", body: "in flight at close" });
    await entered.promise;
    const closing = client.close();
    await sleep(20);
    assert.equal(storeClosed, false, "an applying acknowledgment owns the open store");
    release.resolve();
    await closing;
    assert.equal(storeClosed, true);
    assert.equal((await write).state, "pending", "the admitted id remains durable when close ends the wait");
    const syncEntered = deferred();
    let holdSync = false, aborted = false;
    const reopened = await f.open(tier, { fetch: async (input, init) => {
      if (new URL(input).pathname === "/sync" && holdSync) {
        syncEntered.resolve();
        try { await held(deferred(), init.signal); }
        finally { aborted = init.signal.aborted; }
      }
      return fetch(input, init);
    } });
    assert.ok((await reopened.query(thread, args)).data.some((row) => row.body === "in flight at close"));
    holdSync = true;
    const sync = reopened.sync();
    await syncEntered.promise;
    await reopened.close();
    await sync;
    assert.equal(aborted, true, "closing a client cancels every sync request");
  });
}

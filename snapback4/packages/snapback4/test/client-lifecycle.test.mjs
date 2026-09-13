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
import { processDevice } from "../dist/native.js";
import { guest, logout } from "../dist/auth.js";
import { memoryPersistence, webDevice } from "../dist/web.js";

const root = join(dirname(fileURLToPath(import.meta.url)), "../../..");
const binary = process.env.SNAPBACK4_BIN ?? join(root, "target/debug/snapback4");
const wasm = readFileSync(join(root, "packages/snapback4/src/wasm/snapback4_device_bg.wasm"));
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
  update <- allow
mutation noChange():
  return null
mutation secretUpdate(secretId: secrets, body: text <=4000):
  update secrets[secretId] { body }
  return null
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

async function fixture(t, additions = "") {
  const directory = mkdtempSync(join(tmpdir(), "sb4-client-lifecycle-"));
  mkdirSync(join(directory, "snapback"));
  writeFileSync(join(directory, "snapback/schema.q"), readFileSync(join(root, "apps/chat/snapback/schema.q"), "utf8") + extra + additions);
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
  const spawnDevice = (command, params) => {
    const device = spawn(command, params, { stdio: ["pipe", "pipe", "inherit"] });
    children.add(device);
    device.once("exit", () => children.delete(device));
    return device;
  };
  // What the wasm devices keep between opens, per fixture: one store per
  // name, as one origin's IndexedDB would be.
  const kept = new Map();
  async function open(tier, options = {}) {
    const dataDir = join(directory, options.name ?? tier);
    mkdirSync(dataDir, { recursive: true });
    const common = { url, persona: options.persona ?? "alice", fetch: options.fetch, waitSeconds: 1 };
    if (tier === "online") {
      const client = createClient(common);
      clients.add(client);
      return client;
    }
    let persist = kept.get(dataDir);
    if (!persist) kept.set(dataDir, (persist = memoryPersistence()));
    const opener = tier === "native" ? processDevice(binary, dataDir, spawnDevice, async (path, text) => writeFileSync(path, text)) : webDevice({ wasm, persist });
    const device = options.wrapNative ? { open: async (...params) => options.wrapNative(await opener.open(...params)) } : opener;
    const client = await createLocalClient({ ...common, device });
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

for (const tier of ["wasm", "native"]) {
  test(`${tier}: pending metadata survives repeated profile/vote updates and offline replay`, { timeout: 20_000 }, async (t) => {
    const source = readFileSync(join(root, "crates/snapback4-device/tests/fixtures/pending-metadata.q"), "utf8");
    const f = await fixture(t, source);
    await f.seed([{ table: "people", row: { id: "alice", name: "Alice", bio: "Confirmed bio" } }]);
    let offline = false;
    const transport = (input, init) => offline ? Promise.reject(new TypeError("offline")) : fetch(input, init);
    let core;
    const options = { fetch: transport, wrapNative: (value) => (core = value) };
    const queuedIds = async () => (await core.call({ op: "queued" })).ok.map((entry) => entry.id);
    let client = await f.open(tier, options);
    offline = true;
    await client.sync();
    const commands = [
      ["profile", { person: "alice", name: "Offline Alice", bio: "Saved bio" }],
      ["profile", { person: "alice", name: "Final Alice", bio: "Final bio" }],
      ["vote", { person: "alice", answer: "answer", direction: 1 }],
      ["vote", { person: "alice", answer: "answer", direction: -1 }],
      ["updateVote", { person: "alice", answer: "answer", direction: 1 }],
      ["scanVote", { direction: -1 }],
    ];
    const ids = [];
    for (const [index, [op, input]] of commands.entries()) {
      const result = await client.mutate(mutation(op), input);
      assert.equal(result.state, "pending", JSON.stringify(result)); ids.push(result.id);
      const person = await client.query(query("person"), { person: "alice" });
      assert.equal(person.data.pending, true);
      if (index >= 2) {
        const total = await client.query(query("voteTotal"), { answer: "answer" });
        assert.equal(total.data, index % 2 === 0 ? 1 : -1);
      }
    }
    assert.equal(new Set(ids).size, commands.length);
    assert.deepEqual(await queuedIds(), ids);
    await client.close();
    client = await f.open(tier, options);
    assert.deepEqual(await queuedIds(), ids, "durable outbox retains submission order across reopen");
    const person = await client.query(query("person"), { person: "alice" });
    assert.equal(person.data.name, "Final Alice"); assert.equal(person.data.bio, "Final bio");
    assert.equal(person.data.pending, true); assert.equal(person.fresh, false);
    const votes = await client.query(query("voteRows"), {});
    assert.equal(votes.data.length, 1); assert.equal(votes.data[0].direction, -1); assert.equal(votes.data[0].pending, true);
    assert.equal((await client.query(query("voteTotal"), { answer: "answer" })).data, -1);
    assert.equal((await f.server.query(query("person"), { person: "alice" })).data.name, "Alice", "offline updates were not sent");
    await client.close();
    offline = false;
    client = await f.open(tier, options);
    await until(async () => {
      const row = await client.query(query("person"), { person: "alice" });
      const total = await client.query(query("voteTotal"), { answer: "answer" });
      const votes = await client.query(query("voteRows"), {});
      return row.data?.name === "Final Alice" && !row.data.pending && total.data === -1
        && votes.data?.length === 1 && !votes.data[0].pending;
    }, "acknowledged images must replace every pending profile, vote and aggregate");
    assert.equal((await f.server.query(query("voteTotal"), { answer: "answer" })).data, -1);
    await until(async () => (await queuedIds()).length === 0, "all durable outbox entries settle");
  });

  test(`${tier}: no-op and nosync writes retire when the partition stream is empty`, { timeout: 12_000 }, async (t) => {
    const f = await fixture(t);
    let deviceCore;
    const client = await f.open(tier, { wrapNative: (core) => { deviceCore = core; return core; } });
    const queued = async () => (await deviceCore.call({ op: "queued" })).ok;
    assert.equal((await client.mutate(mutation("noChange"), {})).state, "sent");
    await client.sync();
    assert.deepEqual(await queued(), [], "a commit with no row events is covered by the drained watermark");
    assert.equal((await client.mutate(mutation("secretUpdate"), { secretId: "secret", body: "updated without sync" })).state, "sent");
    await client.sync();
    assert.deepEqual(await queued(), [], "a nosync-only commit does not leak a sent entry forever");
    assert.equal((await client.query(query("secret"), { secretId: "secret" })).data.body, "updated without sync");
  });

  test(`${tier}: a write already sending when a snapshot starts is correlated after catch-up`, { timeout: 12_000 }, async (t) => {
    const f = await fixture(t);
    await f.seed([{ table: "counters", row: { id: "counter", value: 0 } }]);
    const sending = deferred(), releaseSend = deferred(), committed = deferred(), reply = deferred();
    const sender = await f.open(tier, { name: "snapshot-shared", fetch: async (input, init) => {
      if (new URL(input).pathname === "/m/increment") {
        sending.resolve(); await held(releaseSend, init.signal);
        const response = await fetch(input, init);
        assert.equal((await response.clone().json()).state, "sent");
        committed.resolve(); await held(reply, init.signal);
        return response;
      }
      return fetch(input, init);
    } });
    const counter = query("counter"), counterArgs = { counterId: "counter" };
    const write = sender.mutate(mutation("increment"), counterArgs);
    await sending.promise;
    let snapshots = 0, catchups = 0, pinned;
    const observer = await f.open(tier, { name: "snapshot-shared", fetch: async (input, init) => {
      const url = new URL(input);
      if (url.pathname === "/m/increment") await held(reply, init.signal);
      if (url.pathname !== "/sync") return fetch(input, init);
      if (catchups === 0 && url.searchParams.get("stream") !== "1") url.searchParams.set("from", "0");
      url.searchParams.set("limit", "1");
      const response = await fetch(url, init), page = await response.clone().json();
      if (page.snapshot) {
        if (snapshots++ === 0) {
          pinned = page.watermark;
          assert.equal(page.more, true, "the real server snapshot is paged");
          releaseSend.resolve(); await committed.promise;
        } else assert.equal(page.watermark, pinned);
      } else if (url.searchParams.get("stream") === "1") {
        catchups++;
        assert.ok(page.watermark >= pinned);
      }
      return response;
    } });
    assert.ok(snapshots > 1);
    assert.ok(catchups > 0, "a fuzzy snapshot must drain the ordinary stream before publication");
    const observed = await observer.query(counter, counterArgs);
    assert.equal(observed.data.value, 1, "a later snapshot row already contains the write, and is never predicted twice");
    assert.equal(observed.data.pending, undefined);
    await observer.close();
    await sender.close();
    assert.equal((await write).state, "pending", "the committed write keeps its ID while its full reply is unavailable");
  });

  // Two clients over one store is a native host's case (two processes on
  // one phone): on the web a tab is a device and a second tab opens its own.
  if (tier === "native") test(`${tier}: another client sending after sync capture cannot publish an uncorrelated page`, { timeout: 12_000 }, async (t) => {
    const f = await fixture(t);
    await f.seed([{ table: "counters", row: { id: "counter", value: 0 } }]);
    const entered = deferred(), release = deferred(), committed = deferred();
    let holdSync = false, refuseSync = false;
    const applyRefusals = [];
    const observer = await f.open(tier, { name: "shared", wrapNative: (core) => ({
      async call(request) {
        const result = await core.call(request);
        if (request.op === "apply" && result.denied) applyRefusals.push(result.denied);
        return result;
      },
      close: () => core.close(),
    }), fetch: async (input, init) => {
      if (new URL(input).pathname === "/sync" && holdSync) { holdSync = false; entered.resolve(); await held(release, init.signal); }
      return fetch(input, init);
    } });
    const sender = await f.open(tier, { name: "shared", fetch: async (input, init) => {
      const path = new URL(input).pathname;
      if (path === "/sync" && refuseSync) throw new TypeError("sender cannot sync");
      if (path === "/m/increment") {
        assert.equal((await (await fetch(input, init)).json()).state, "sent");
        committed.resolve(); throw new TypeError("mutation reply lost");
      }
      return fetch(input, init);
    } });
    holdSync = true; refuseSync = true;
    const sync = observer.sync().then(() => null, (error) => error);
    await entered.promise;
    const counter = query("counter"), counterArgs = { counterId: "counter" };
    const write = sender.mutate(mutation("increment"), counterArgs);
    await committed.promise;
    release.resolve();
    const error = await sync;
    assert.ok(applyRefusals.length > 0, `the device's transaction rejects the stale send revision (${error?.message ?? "no error"})`);
    assert.equal((await observer.query(counter, counterArgs)).data.value, 1, "the prediction is retained once after rejecting the stale page");
    await observer.sync();
    const confirmed = await observer.query(counter, counterArgs);
    assert.equal(confirmed.data.value, 1);
    assert.equal(confirmed.data.pending, undefined);
    await sender.close();
    assert.equal((await write).state, "pending");
  });

  test(`${tier}: a sync started before admission finishes before that write can be sent`, { timeout: 12_000 }, async (t) => {
    const f = await fixture(t);
    await f.seed([{ table: "counters", row: { id: "counter", value: 0 } }]);
    const syncEntered = deferred(), releaseSync = deferred(), committed = deferred();
    let holdSync = false, posts = 0;
    const client = await f.open(tier, { fetch: async (input, init) => {
      const path = new URL(input).pathname;
      if (path === "/sync" && holdSync) { holdSync = false; syncEntered.resolve(); await held(releaseSync, init.signal); }
      if (path === "/m/increment") {
        posts++;
        const response = await fetch(input, init);
        assert.equal((await response.json()).state, "sent");
        committed.resolve();
        throw new TypeError("reply lost after commit");
      }
      return fetch(input, init);
    } });
    holdSync = true;
    const initial = client.sync();
    await syncEntered.promise;
    const counter = query("counter"), counterArgs = { counterId: "counter" };
    const write = client.mutate(mutation("increment"), counterArgs);
    await until(async () => (await client.query(counter, counterArgs)).data?.pending, "admission is responsive while a sync request waits");
    assert.equal(posts, 0, "a new admission cannot race the captured pending-ID set");
    releaseSync.resolve();
    await initial;
    await committed.promise;
    await client.sync();
    const read = await client.query(counter, counterArgs);
    assert.equal(read.data.value, 1);
    assert.equal(read.data.pending, undefined);
    await client.close();
    assert.equal((await write).state, "pending");
  });

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
            entered.resolve();
            if (loseReply) throw new TypeError("reply lost after the server committed");
            await held(reply, init.signal);
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
      let applied = false;
      const sync = client.sync().then(() => { applied = true; });
      if (!loseReply) {
        await sleep(20);
        assert.equal(applied, false, "sync waits for the in-flight mutation request before capturing pending IDs");
        reply.resolve();
      }
      await sync;
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
    assert.equal((await client.mutate(mutation("guardedEdit"), { messageId: "msg-b", gateId: "gate", body: "edited beyond the horizon" })).state, "sent", "unknown local admission rolls back prediction and reaches authority");
    assert.equal((await f.server.query(query("message"), { messageId: "msg-b" })).data.body, "edited beyond the horizon");
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
    const entered = deferred(), release = deferred(), syncEntered = deferred(), syncRelease = deferred();
    let holdSync = false;
    let postedIds;
    const deviceRefusals = [];
    const client = await f.open(tier, { wrapNative: (core) => ({
      async call(request) {
        const result = await core.call(request);
        if (result.denied) deviceRefusals.push({ op: request.op, denied: result.denied });
        return result;
      },
      close: () => core.close(),
    }), fetch: async (input, init) => {
      if (new URL(input).pathname === "/sync" && holdSync) {
        holdSync = false; syncEntered.resolve(); await held(syncRelease, init.signal);
      }
      if (new URL(input).pathname === "/m/copySources") {
        postedIds = JSON.parse(init.body).newIds;
        entered.resolve(); await held(release, init.signal);
      }
      return fetch(input, init);
    } });
    holdSync = true;
    const syncing = client.sync();
    await syncEntered.promise;
    const write = client.mutate(mutation("copySources"), {});
    await until(async () => (await client.query(query("copied"), {})).data?.length === 1, "the write is admitted while sync is in flight");
    const original = await client.query(query("copied"), {});
    assert.equal(original.data.length, 1);
    assert.equal(original.data[0].pending, true);
    const originalId = original.data[0].id;
    assert.equal((await f.server.mutate(mutation("addSource"), {})).state, "sent");
    syncRelease.resolve();
    await syncing;
    await entered.promise;
    const rebased = await client.query(query("copied"), {});
    assert.deepEqual(deviceRefusals, [], "withdrawing an expanded replay still commits the authoritative stream transaction");
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

test("device process failures reject opening and pending calls instead of leaving close waiting", { timeout: 3000 }, async () => {
  const opener = (script) => processDevice(process.execPath, "unused", (command) => spawn(command, ["-e", script], { stdio: ["pipe", "pipe", "inherit"] }), async () => {});
  await assert.rejects(opener("process.exit(4)").open("unused", null), /exited/);
  const core = await opener('process.stdout.write(JSON.stringify({ok:true}) + "\\n"); process.stdin.once("data", () => process.exit(5));').open("unused", null);
  await assert.rejects(core.call({ op: "state" }), /exited/);
  await core.close();
  await assert.rejects(core.call({ op: "state" }), /closed|exited/);
});

test("device compatibility rejects old and malformed protocols before online or offline startup", async () => {
  const valid = { watermark: 0, generation: 1, pending_ids: [], send_revision: 0 };
  const replies = [
    { denied: { code: "E_OP", family: "op", message: "unknown op sync_state" } },
    null, {}, { ok: {} }, { ok: { ...valid, send_revision: undefined } },
    { ok: { ...valid, watermark: -1 } }, { ok: { ...valid, generation: 0.5 } },
    { ok: { ...valid, send_revision: Number.MAX_SAFE_INTEGER + 1 } },
    { ok: { ...valid, pending_ids: [1] } }, { ok: { ...valid, pending_ids: [""] } },
    { ok: { ...valid, pending_ids: Array.from({ length: 257 }, (_, n) => String(n)) } },
  ];
  for (const offline of [false, true]) for (const reply of replies) {
    const calls = [], requests = [];
    let closed = 0;
    await assert.rejects(createLocalClient({
      url: "http://incompatible.invalid", persona: "alice",
      fetch: async (input) => {
        requests.push(new URL(input).pathname);
        if (offline) throw new TypeError("offline");
        return Response.json({ generation: 1, schema: { tables: {} }, programs: [] });
      },
      device: { open: async () => ({ call: async (request) => { calls.push(request.op); return reply; }, close: async () => { await sleep(0); closed++; } }) },
    }), /E_DEVICE_VERSION:.*rebuild.*native binary/);
    assert.equal(closed, 1, "startup waits for the incompatible core to close");
    assert.deepEqual(calls, ["sync_state"], "no follower, query, admission or retry starts");
    assert.deepEqual(requests, ["/schema"]);
  }
});

test("device compatibility closes the core and preserves operational startup errors", async () => {
  for (const failure of [{ denied: { code: "E_STORE", family: "store", message: "database is locked" } }, new Error("native connection closed")]) {
    let closed = 0;
    await assert.rejects(createLocalClient({
      url: "http://native-error.invalid", persona: "alice",
      fetch: async () => { throw new TypeError("offline"); },
      device: { open: async () => ({
        call: async () => { if (failure instanceof Error) throw failure; return failure; },
        close: async () => { closed++; throw new Error("close also failed"); },
      }) },
    }), failure instanceof Error ? /native connection closed/ : /E_STORE:.*database is locked/);
    assert.equal(closed, 1);
  }
});

test("device compatibility accepts the current core online and on an offline reopen", { timeout: 12_000 }, async (t) => {
  const f = await fixture(t), calls = [];
  const wrapNative = (core) => ({
    call: async (request) => { calls.push(request.op); return core.call(request); },
    close: () => core.close(),
  });
  const online = await f.open("native", { wrapNative });
  assert.equal(calls[0], "sync_state");
  const initial = await online.query(thread, args);
  assert.equal(initial.data.length, 2); assert.equal(initial.fresh, true);
  await online.close();
  calls.length = 0;
  const offline = await f.open("native", { wrapNative, fetch: async () => { throw new TypeError("offline"); } });
  assert.equal(calls[0], "sync_state");
  const restored = await offline.query(thread, args);
  assert.equal(restored.data.length, 2); assert.equal(restored.fresh, false);
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

for (const tier of ["wasm", "native"]) {
  test(`${tier}: close waits for an applying acknowledgment and aborts sync`, { timeout: 10_000 }, async (t) => {
    const f = await fixture(t);
    const entered = deferred(), release = deferred();
    let storeClosed = false;
    const wrapNative = (core) => ({
      async call(request) {
        if (request.op === "settle" && request.seq !== undefined) { entered.resolve(); await release.promise; }
        return core.call(request);
      },
      async close() { storeClosed = true; await core.close(); },
    });
    const client = await f.open(tier, { wrapNative });
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

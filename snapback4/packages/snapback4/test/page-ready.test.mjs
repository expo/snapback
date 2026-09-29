// Calibration #19: a restored account opens a server-created chat while the
// shell's inbox and the conversation's history observe the real device.
import test from "node:test";
import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { mkdtempSync, mkdirSync, readFileSync, writeFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { setTimeout as delay } from "node:timers/promises";
import { createApp } from "../dist/app.js";
import { createClient } from "../dist/client.js";
import { createLocalClient } from "../dist/local.js";
import { memorySessionStore } from "../dist/auth.js";
import { processDevice } from "../dist/native.js";

const binary = process.env.SNAPBACK4_BIN ?? resolve(import.meta.dirname, "../../../target/debug/snapback4");
const query = name => ({ kind: "query", name });
const mutation = name => ({ kind: "mutation", name });
const until = async (read, label) => {
  for (let n = 0; n < 500; n++) { const value = await read(); if (value) return value; await delay(10); }
  assert.fail(`timed out: ${label}`);
};
const listRead = read => {
  if ("data" in read) assert.ok(Array.isArray(read.data), `ready list: ${JSON.stringify(read)}`);
  else assert.ok(read.loading || read.denied, JSON.stringify(read));
  return read;
};

const source = readFileSync(new URL("./fixtures/page-ready.q", import.meta.url), "utf8");

test("ready list reads survive account restoration, new chat acquisition and pending unread counts", { timeout: 45_000 }, async t => {
  const dir = mkdtempSync(join(tmpdir(), "sb4-page-"));
  mkdirSync(join(dir, "snapback"));
  writeFileSync(join(dir, "snapback/schema.q"), source);
  const host = spawn(binary, ["dev", "--port", "0", "--no-watch"], { cwd: dir, stdio: ["ignore", "pipe", "pipe"] });
  const exited = new Promise(resolve => host.once("exit", resolve));
  let log = "";
  host.stdout.on("data", bytes => { log += bytes; }); host.stderr.on("data", bytes => { log += bytes; });
  let app, bob;
  t.after(async () => {
    releaseWrite?.(); await app?.close(); await bob?.close();
    if (host.exitCode === null && host.signalCode === null) host.kill("SIGTERM");
    await exited; rmSync(dir, { recursive: true, force: true });
  });
  const url = await until(() => { assert.equal(host.exitCode, null, log); return log.match(/http:\/\/127\.0\.0\.1:\d+/)?.[0]; }, "server");
  let offline = false, holdSync = false, holdWrite = false, releaseWrite;
  const replies = [], requests = [];
  const fetcher = async (input, init) => {
    const path = new URL(input).pathname;
    requests.push(path);
    if (offline || (holdSync && path === "/sync")) throw Error("controlled offline link");
    if (holdWrite && path === "/m/saveProfile") {
      await new Promise((resolve, reject) => {
        releaseWrite = resolve;
        if (init.signal?.aborted) reject(Error("closed"));
        else init.signal?.addEventListener("abort", () => reject(Error("closed")), { once: true });
      });
    }
    if (offline) throw Error("controlled offline link after pending send");
    return fetch(input, init);
  };
  let underlying = processDevice({ dir: join(dir, "device"), binary });
  const device = { async open(...args) {
    const core = await underlying.open(...args);
    return { ...core, async call(request, committed) {
      const reply = await core.call(request, committed);
      if (request.op === "query") replies.push({ name: request.name, reply });
      return reply;
    } };
  } };
  const options = { url, device, fetch: fetcher, sessionStore: memorySessionStore() };
  app = createApp(options); await app.ready;
  assert.equal(app.auth.state, "signed-out");
  listRead(await app.client.query(query("inbox"), {}));
  const alice = await app.auth.signup("alice@example.com", "password-alice");
  assert.equal(alice.ok, true, JSON.stringify(alice));
  bob = createApp({ url, sessionStore: memorySessionStore() }); await bob.ready;
  const signedBob = await bob.auth.signup("bob@example.com", "password-bob");
  assert.equal(signedBob.ok, true, JSON.stringify(signedBob));
  assert.equal((await bob.mutate(mutation("saveProfile"), { handle: "bob" })).state, "sent");
  await app.close(); app = createApp(options); await app.ready;
  assert.equal(app.auth.viewer, alice.session.principal);
  const profile = await app.client.query(query("profile"), { handle: "bob" });
  assert.equal(profile.data.principal, signedBob.session.principal);
  let inbox = app.client.observe(query("inbox"), {});
  const snapshots = [];
  inbox.subscribe(() => snapshots.push(inbox.getSnapshot()));
  await until(() => "data" in inbox.getSnapshot(), "initial inbox");
  holdSync = true;
  const dm = await app.mutate(mutation("startDM"), { other: profile.data.principal });
  assert.equal(dm.state, "sent", JSON.stringify(dm));
  const chat = dm.result;
  let history = app.client.observe(query("history"), { chat });
  history.subscribe(() => snapshots.push(history.getSnapshot()));
  listRead(await app.client.query(query("history"), { chat }));
  const partial = await app.client.query(query("history"), { chat });
  assert.deepEqual(partial.data, [], "an unknown non-speculative scan is partial data even when empty");
  assert.equal(partial.complete, false);
  const observation = replies.findLast(row => row.name === "history").reply.ok;
  assert.equal(observation.unknown, true); assert.equal(Object.hasOwn(observation, "speculative"), false);
  holdSync = false;
  await until(async () => (await app.client.query(query("inbox"), {})).data?.some(row => row.chat === chat), "chat acquired");
  for (let n = 0; n < 3; n++) assert.equal((await bob.mutate(mutation("send"), { chat, body: `message ${n}` })).state, "sent");
  inbox.close(); history.close(); await app.close();
  underlying = processDevice({ dir: join(dir, "fresh-device"), binary });
  app = createApp(options); await app.ready;
  inbox = app.client.observe(query("inbox"), {});
  history = app.client.observe(query("history"), { chat });
  inbox.subscribe(() => snapshots.push(inbox.getSnapshot()));
  history.subscribe(() => snapshots.push(history.getSnapshot()));
  await until(async () => (await app.client.query(query("history"), { chat })).data?.length === 3, "server history beyond horizon");
  // Ensure the device itself has reached the 2-row horizon before cutting the link.
  await until(() => replies.some(({ name, reply }) => name === "history" && reply.ok?.data?.length === 2), "device horizon");
  holdWrite = true;
  const pending = await app.mutate(mutation("saveProfile"), { handle: "alice" });
  assert.equal(pending.state, "pending", JSON.stringify(pending));
  assert.equal(app.client.link(), "online");
  const before = requests.filter(path => path === "/q/inbox").length;
  const local = await app.client.query(query("inbox"), {});
  const raw = replies.filter(row => row.name === "inbox").at(-1).reply;
  t.diagnostic(`unavailable inbox device reply: ${JSON.stringify(raw)}`);
  listRead(local); // Before the fix: { data: null, complete: false, ... }.
  assert.equal(local.data[0].unread, 3, "the server answers the unavailable device total");
  assert.equal(app.client.link(), "online");
  assert.ok(requests.filter(path => path === "/q/inbox").length > before, "unavailable predictions do not block server fallback");
  offline = true;
  // An unexecuted server-only ping has all possible tables and is fenced.
  // Fail the pending transport itself to establish that the link is offline.
  await until(() => releaseWrite, "pending profile send entered"); releaseWrite();
  await until(() => app.client.link() === "offline", "pending send observed offline");
  const disconnected = listRead(await app.client.query(query("inbox"), {}));
  assert.ok(!("data" in disconnected), "an offline read cannot publish the unavailable total either");
  for (const read of snapshots) listRead(read);
  inbox.close(); history.close();
  // A genuine nullable point result is still a ready null.
  const online = createClient({ url, session: alice.session });
  try { assert.equal((await online.query(query("absent"), {})).data, null); }
  finally { await online.close(); }
});

test("unavailable server list responses end retention in both clients", { timeout: 30_000 }, async t => {
  const dir = mkdtempSync(join(tmpdir(), "sb4-page-server-"));
  mkdirSync(join(dir, "snapback"));
  writeFileSync(join(dir, "snapback/schema.q"), source);
  const host = spawn(binary, ["dev", "--port", "0", "--no-watch"], { cwd: dir, stdio: ["ignore", "pipe", "pipe"] });
  const exited = new Promise(resolve => host.once("exit", resolve));
  let log = "", authority;
  const clients = [];
  host.stdout.on("data", bytes => { log += bytes; }); host.stderr.on("data", bytes => { log += bytes; });
  t.after(async () => {
    await Promise.all(clients.map(client => client.close())); await authority?.close();
    if (host.exitCode === null && host.signalCode === null) host.kill("SIGTERM");
    await exited; rmSync(dir, { recursive: true, force: true });
  });
  const url = await until(() => { assert.equal(host.exitCode, null, log); return log.match(/http:\/\/127\.0\.0\.1:\d+/)?.[0]; }, "server");
  authority = createApp({ url }); await authority.ready;
  const signed = await authority.auth.signup("reader@example.com", "password-reader");
  assert.equal(signed.ok, true, JSON.stringify(signed));
  let queryOffline = false;
  const fetched = [];
  const fetcher = async (input, init) => {
    if (new URL(input).pathname === "/q/costly") {
      if (queryOffline) throw Error("query link offline");
      const response = await fetch(input, init);
      fetched.push(await response.clone().json());
      return response;
    }
    return fetch(input, init);
  };
  const setCost = async grow => assert.equal((await authority.mutate(mutation("setCost"), { grow })).state, "sent");
  await setCost(false);
  const online = createClient({ url, session: signed.session, fetch: fetcher, waitSeconds: 1 });
  const local = await createLocalClient({ url, session: signed.session, sessionStore: memorySessionStore(), fetch: fetcher,
    device: processDevice({ dir: join(dir, "device"), binary }), waitSeconds: 1 });
  clients.push(online, local);
  const watches = clients.map(client => client.observe(query("costly"), {}));
  for (const watch of watches) await until(() => "data" in watch.getSnapshot(), "initial cached server list");
  assert.ok((await local.query(query("costly"), {})).data.length === 1);
  // An unknown scalar list is a placeholder; failed fallback recovers memory.
  queryOffline = true;
  const remembered = listRead(await local.query(query("costly"), {}));
  assert.equal(remembered.complete, true);
  assert.equal(remembered.fresh, false); assert.ok(remembered.since > 0);
  queryOffline = false;
  // A partial local query does not reconnect by itself.
  // Complete a sync before asserting the next HTTP availability response.
  await local.sync();
  await setCost(true);
  for (const watch of watches) await until(() => watch.getSnapshot().loading, "heap-aborted fetch ends retention");
  await until(() => fetched.some(reply => reply.loading === true), "server evaluated the new heap-aborting control");
  for (const client of clients) {
    if (client === local) await local.sync();
    else await client.query(query("ping"), {});
    assert.deepEqual(await client.query(query("costly"), {}), { loading: true });
  }
  assert.ok(fetched.some(reply => reply.loading === true && reply.data === null && reply.complete === false), "legacy clients see an incomplete placeholder; current clients see loading");
  queryOffline = true;
  // Invalidate the online observation once more while its next query fails.
  await setCost(false);
  await until(() => clients.every(client => client.link() === "offline"), "transport loss");
  assert.deepEqual(watches[0].getSnapshot(), { loading: true });
  assert.deepEqual(watches[1].getSnapshot(), { loading: true });
  assert.equal((await local.query(query("costly"), {})).denied.code, "E_OFFLINE");
  for (const watch of watches) watch.close();
});

test("loading server replies retain expiry retries and missing data cannot become ready undefined", async t => {
  let reads = 0;
  const client = createClient({ url: "http://page.test", persona: "alice", fetch: async (input, init) => {
    const path = new URL(input).pathname;
    if (path === "/q/missing") return Response.json({});
    if (path === "/q/page") {
      reads++;
      return Response.json(reads === 1
        ? { loading: true, nextExpiry: Date.now() + 30, tables: ["pages"], seq: 1 }
        : { data: [], complete: true, tables: ["pages"], seq: 1 });
    }
    if (path === "/changes") return new Promise((_, reject) => {
      if (init.signal.aborted) reject(Error("closed"));
      else init.signal.addEventListener("abort", () => reject(Error("closed")), { once: true });
    });
    throw Error(path);
  } });
  t.after(() => client.close());
  const watch = client.observe(query("page"), {});
  await until(() => Array.isArray(watch.getSnapshot().data), "expiry retries the unavailable answer");
  assert.equal(reads, 2);
  assert.deepEqual(await client.query(query("missing"), {}), { loading: true });
  watch.close();
});

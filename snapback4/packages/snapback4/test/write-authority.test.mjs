import { captureStdout } from './helpers/server-output.mjs';
import { waitFor as awaitState, hangBudget } from './helpers/wait.mjs';
// LLP 3000.007 §8.7: real /m replies and a process device's durable queue.
import test from "node:test";
import assert from "node:assert/strict";
import { spawn, spawnSync } from "node:child_process";
import { once } from "node:events";
import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { createLocalClient } from "../dist/local.js";
import { processDevice } from "../dist/native.js";
const root = join(dirname(fileURLToPath(import.meta.url)), "../../..");
const binary = process.env.SNAPBACK4_BIN ?? join(root, "target/debug/snapback4");
const source = `use personas alice, bob, carol
table counters:
  key: text <=30
  owner: principal
  secret: text <=80
  amount: int
  unique byKey: key
  unique bySecretAmount: secret, amount
  by byOwner: owner, id
  read <- .owner = viewer
  update <- allow
  insert <- .owner = viewer
  sync to .owner
query one(key: text <=30):
  return counters[key = key]
mutation put(key: text <=30):
  return upsert counters[key = key] {amount: 0}
mutation conditional(key: text <=30):
  return update counters[key = key] {amount: 1} if .amount = 999
mutation pass(owner: principal): server
  n = 0
  for row in counters[owner] first 10 by byOwner:
    n = n + 1
  return n
`;
const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
async function until(check, message) { return awaitState(check, message); }
async function fixture(t) {
  const directory = mkdtempSync(join(tmpdir(), "sb4-write-authority-"));
  mkdirSync(join(directory, "snapback"));
  writeFileSync(join(directory, "snapback/schema.q"), source);
  const child = spawn(binary, ["dev", "--port", "0", "--fresh", "--no-watch"], { cwd: directory, stdio: ["ignore", "pipe", "pipe"] });
  const readStdout = captureStdout(child);
  const exited = once(child, "exit");
  let log = "", url;
  child.stdout.on("data", (data) => { log += data; url ??= readStdout().match(/http:\/\/127\.0\.0\.1:\d+(?=\r?\n)/)?.[0]; });
  child.stderr.on("data", (data) => { log += data; });
  const clients = [];
  t.after(async () => {
    await Promise.allSettled(clients.map((c) => c.close()));
    if (child.exitCode === null && child.signalCode === null) child.kill("SIGTERM");
    await exited;
    rmSync(directory, { recursive: true, force: true });
  });
  await until(() => { assert.equal(child.exitCode, null, log); return url; }, "server did not listen");
  const request = (path, persona, body) => fetch(`${url}${path}`, { method: "POST", headers: { "x-snapback-persona": persona }, body: JSON.stringify(body) }).then((r) => r.json());
  const seed = async (owner = "dev:alice", amount = 7) => {
    const result = await request("/seed", "alice", [{ table: "counters", row: { id: "target", key: "lookup", owner, secret: "PRIVATE", amount } }]);
    assert.equal(result.seeded, 1, JSON.stringify(result));
  };
  await seed();
  return { directory, url, clients, request, seed };
}

test("write authority: /m replay keeps only execution identity after hidden writes, dropped replies and revocation", { timeout: hangBudget(8) }, async (t) => {
  const f = await fixture(t);
  const input = { id: "hidden", args: { key: "lookup" } };
  const first = await f.request("/m/put", "bob", input);
  assert.equal(first.state, "sent");
  assert.equal(first.result, null);
  assert.deepEqual(Object.keys(first).sort(), ["generation", "head", "id", "preserved", "result", "seq", "state", "store_id"]);
  // RV certifies only table names and generation; replay still exposes no result.
  assert.equal(typeof first.generation, "number");
  assert.ok(Array.isArray(first.preserved) && first.preserved.every(t => typeof t === "string"));
  const replay = await f.request("/m/put", "bob", input);
  assert.match(first.store_id, /^[0-9a-f]{32}$/);
  assert.deepEqual(replay, { state: "sent", id: "hidden", seq: first.seq, replayed: true, store_id: first.store_id, head: first.seq });
  for (const [op, id] of [["put", "lost-result"], ["conditional", "lost-current"]]) {
    await f.seed();
    const original = await f.request(`/m/${op}`, "alice", { id, args: { key: "lookup" } }); // delivered to transport, dropped by app
    assert.equal((original.result ?? original.current).secret, "PRIVATE");
    await f.seed("dev:carol");
    const retried = await f.request(`/m/${op}`, "alice", { id, args: { key: "lookup" } });
    assert.equal(retried.state, original.state);
    assert.equal(retried.replayed, true);
    for (const key of ["result", "current", "metered", "tables", "events"]) assert.equal(key in retried, false);
    const other = await f.request(`/m/${op}`, "bob", { id, args: { key: "lookup" } });
    assert.equal(other.replayed, undefined);
    assert.equal(other.result ?? other.current ?? null, null);
  }
});

test("write authority: the client sends a queued unheld upsert without planting a pending row", { timeout: hangBudget(12) }, async (t) => {
  const f = await fixture(t);
  const storage = join(f.directory, "device"); mkdirSync(storage);
  const opener = processDevice({ binary, dir: storage, spawn: (cmd, args) => spawn(cmd, args, { stdio: ["pipe", "pipe", "inherit"] }), writeFile: async (path, text) => writeFileSync(path, text) });
  let offline = false, posts = 0, core;
  const client = await createLocalClient({ url: f.url, persona: "bob", waitSeconds: 1,
    fetch: async (input, init) => { if (offline) throw new TypeError("offline"); if (new URL(input).pathname.startsWith("/m/")) posts++; return fetch(input, init); },
    device: { open: async (...args) => { core = await opener.open(...args); return core; } },
  });
  f.clients.push(client); await client.sync(); offline = true;
  const result = await client.mutate({ kind: "mutation", name: "put" }, { key: "lookup" });
  assert.equal(result.state, "pending", JSON.stringify(result));
  const queued = (await core.call({ op: "queued" })).ok;
  assert.equal(queued.length, 1);
  assert.equal(queued[0].predictable, false);
  assert.deepEqual(queued[0].predicted, []);
  const read = () => core.call({ op: "query", name: "one", viewer: "dev:bob", args: { key: "lookup" }, now: 1000 });
  assert.equal((await read()).ok.data, null);
  offline = false; await client.sync();
  await until(async () => (await core.call({ op: "queued" })).ok.length === 0, "queued write did not settle");
  assert.ok(posts >= 1);
  assert.equal((await read()).ok.data, null);
  const owner = await f.request("/q/one", "alice", { args: { key: "lookup" } });
  assert.equal(owner.data.amount, 0);
});

test("write authority: check --cost prints the bounded uniform pass and its examined ceiling", async (t) => {
  const f = await fixture(t);
  const checked = spawnSync(binary, ["check", "--cost"], { cwd: f.directory, encoding: "utf8" });
  assert.equal(checked.status, 0, checked.stderr);
  assert.match(checked.stdout, /a pass over the first 10 rows of counters where \.owner = owner by byOwner; examined ceiling 8192/);
});

test("write authority: a lost readable key-collision reply cannot recover its key after revocation", { timeout: hangBudget(6) }, async (t) => {
  const f = await fixture(t);
  const other = { id: "other", key: "other", owner: "dev:alice", secret: "PRIVATE", amount: 0 };
  assert.equal((await f.request("/seed", "alice", [{ table: "counters", row: other }])).seeded, 1);
  const input = { id: "lost-key", args: { key: "lookup" } };
  const first = await f.request("/m/put", "alice", input); // application loses this response
  assert.equal(first.why.code, "E_CONSTRAINT");
  assert.match(first.why.message, /PRIVATE/);
  await f.seed("dev:carol");
  assert.equal((await f.request("/seed", "alice", [{ table: "counters", row: { ...other, owner: "dev:carol" } }])).seeded, 1);
  const retry = await f.request("/m/put", "alice", input);
  assert.equal(retry.why.code, first.why.code);
  assert.equal(retry.replayed, true);
  assert.doesNotMatch(JSON.stringify(retry), /PRIVATE|bySecretAmount/);
  assert.equal(retry.why.message, "the program refused with E_CONSTRAINT");
  for (const field of ["code", "site", "rewrite", "guide", "family", "retryable"]) assert.deepEqual(retry.why[field], first.why[field]);
});

for (const tier of ["online", "local"]) test(`replay card: ${tier} keeps a lost response's same-id receipt and fresh result`, { timeout: hangBudget(9) }, async (t) => {
  const f = await fixture(t);
  const { createClient } = await import("../dist/client.js");
  let lose = false, replayOverHttp = false;
  const ids = [];
  const transport = async (input, init) => {
    const response = await fetch(input, init);
    // This case proves the HTTP retry path. A concurrent sync can also
    // legitimately settle the receipt, so drop that response until the retry.
    if (replayOverHttp && ids.length < 3 && new URL(input).pathname === "/sync") {
      await response.arrayBuffer(); throw new TypeError("sync held for HTTP replay");
    }
    if (new URL(input).pathname === "/m/put") {
      ids.push(JSON.parse(init.body).id);
      if (lose) { lose = false; await response.arrayBuffer(); throw new TypeError("lost committed reply"); }
    }
    return response;
  };
  const options = { url: f.url, persona: "alice", fetch: transport, waitSeconds: 1 };
  const client = tier === "online" ? createClient(options) : await createLocalClient({ ...options, device: processDevice({ binary, dir: join(f.directory, "replay-device") }) });
  f.clients.push(client);
  const writes = [];
  client.onWrite(write => writes.push(write));
  const op = { kind: "mutation", name: "put" };
  const fresh = await client.mutate(op, { key: "lookup" });
  assert.equal(fresh.state, "sent");
  assert.equal(fresh.result.secret, "PRIVATE");
  assert.notEqual(fresh.replayed, true);
  lose = true; replayOverHttp = true;
  await client.mutate(op, { key: "lookup" });
  await until(() => writes.length === 2, "retry did not settle");
  assert.equal(ids.length, 3);
  assert.equal(ids[1], ids[2]);
  assert.equal(writes[1].replayed, true);
  assert.equal("result" in writes[1], false);
});

test("online sign-out revokes its bearer and clears the client even without a link", async () => {
  const { createClient } = await import("../dist/client.js");
  for (const offline of [false, true]) {
    const calls = [];
    const client = createClient({ url: "http://example.invalid", token: "kept-token", fetch: async (url, init) => {
      calls.push([new URL(url).pathname, init.headers.authorization]);
      if (offline) throw new TypeError("offline");
      return Response.json({ ok: true });
    } });
    await client.signOut();
    assert.deepEqual(calls, [["/auth/logout", "Bearer kept-token"]]);
    assert.equal(client.viewer(), null);
    assert.equal(client.link(), "signed-out");
    assert.equal((await client.mutate({ kind: "mutation", name: "put" }, {})).state, "failed");
  }
});

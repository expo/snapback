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
  by byOwner: owner, id
  read <- .owner = viewer
  update <- allow
  insert <- .owner = viewer
  sync to .owner
query one(key: text <=30):
  return counters[key]
mutation put(key: text <=30):
  return upsert counters[key] {amount: 0}
mutation conditional(key: text <=30):
  return update counters[key] {amount: 1} if .amount = 999
mutation pass(owner: principal): server
  n = 0
  for row in counters[owner] first 10 by byOwner:
    n = n + 1
  return n
`;
const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
async function until(check, message) {
  const end = Date.now() + 8000;
  do { if (await check()) return; await sleep(10); } while (Date.now() < end);
  assert.fail(message);
}
async function fixture(t) {
  const directory = mkdtempSync(join(tmpdir(), "sb4-write-authority-"));
  mkdirSync(join(directory, "snapback"));
  writeFileSync(join(directory, "snapback/schema.q"), source);
  const child = spawn(binary, ["dev", "--port", "0", "--fresh", "--no-watch"], { cwd: directory, stdio: ["ignore", "pipe", "pipe"] });
  const exited = once(child, "exit");
  let log = "", url;
  child.stdout.on("data", (data) => { log += data; url ??= log.match(/http:\/\/127\.0\.0\.1:\d+/)?.[0]; });
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

test("write authority: /m replay keeps only execution identity after hidden writes, dropped replies and revocation", { timeout: 20000 }, async (t) => {
  const f = await fixture(t);
  const input = { id: "hidden", args: { key: "lookup" } };
  const first = await f.request("/m/put", "bob", input);
  assert.equal(first.state, "sent");
  assert.equal(first.result, null);
  assert.deepEqual(Object.keys(first).sort(), ["id", "result", "seq", "state"]);
  const replay = await f.request("/m/put", "bob", input);
  assert.deepEqual(replay, { state: "sent", id: "hidden", seq: first.seq, replayed: true });
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

test("write authority: the client sends a queued unheld upsert without planting a pending row", { timeout: 20000 }, async (t) => {
  const f = await fixture(t);
  const storage = join(f.directory, "device"); mkdirSync(storage);
  const opener = processDevice(binary, storage, (cmd, args) => spawn(cmd, args, { stdio: ["pipe", "pipe", "inherit"] }), async (path, text) => writeFileSync(path, text));
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
  assert.match(checked.stdout, /a pass over the first 10 rows of counters\[owner\] by byOwner; examined ceiling 8192/);
});

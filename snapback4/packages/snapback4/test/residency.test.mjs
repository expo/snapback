// Real process devices: server-run watches are live, and never read an empty
// device page as an offline server answer (LLP 3000.007 §6.5).
import test from "node:test";
import assert from "node:assert/strict";
import { spawn, spawnSync } from "node:child_process";
import { once } from "node:events";
import { mkdtempSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { createLocalClient } from "../dist/local.js";
import { processDevice } from "../dist/native.js";

const root = join(dirname(fileURLToPath(import.meta.url)), "../../..");
const binary = process.env.SNAPBACK4_BIN ?? join(root, "target/debug/snapback4");
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const query = (name) => ({ kind: "query", name });
const schema = `use personas alice, bob
table notes:
  owner: principal
  text: text <=100
  at: time
  by byTime: at, id
  by byOwner: owner, id
  public 'public notes'
  insert <- .owner = viewer
  sync last 2 by byTime
maintain counts: count notes by owner
  read <- allow
table audit:
  text: text <=100
  at: time
  by byTime: at, id
  public 'audit fixture'
  insert <- allow
  online only
query audits(c: cursor ?):
  return audit after c last 10 by byTime
query auditById(id: audit):
  return audit[id]
query localNotes(c: cursor ?):
  return notes after c last 1 by byTime
query presence():
  return exists connected[viewer]
mutation add(text: text <=100):
  return insert audit { text, at: now }
`;
async function until(check, message, timeout = 8000) {
  const end = Date.now() + timeout;
  do { if (await check()) return; await sleep(10); } while (Date.now() < end);
  assert.fail(message);
}
function project(t) {
  const directory = mkdtempSync(join(tmpdir(), "sb4-residency-"));
  mkdirSync(join(directory, "snapback"));
  writeFileSync(join(directory, "snapback/schema.q"), schema);
  t.after(() => rmSync(directory, { recursive: true, force: true }));
  return directory;
}
async function fixture(t, watchSources = false) {
  const directory = project(t);
  const child = spawn(binary, ["dev", "--port", "0", "--fresh", ...(watchSources ? [] : ["--no-watch"])], { cwd: directory, stdio: ["ignore", "pipe", "pipe"] });
  const exit = once(child, "exit");
  let log = "", url;
  child.stdout.on("data", (data) => { log += data; url ??= log.match(/http:\/\/127\.0\.0\.1:\d+/)?.[0]; });
  child.stderr.on("data", (data) => { log += data; });
  const clients = [];
  t.after(async () => {
    await Promise.allSettled(clients.map((client) => client.close()));
    if (child.exitCode == null && child.signalCode == null) child.kill("SIGTERM");
    await exit;
  });
  await until(() => { assert.equal(child.exitCode, null, log); return url; }, "server did not listen");
  const seed = async (rows) => {
    const reply = await fetch(`${url}/seed`, { method: "POST", body: JSON.stringify(rows) }).then((r) => r.json());
    assert.equal(reply.seeded, rows.length, JSON.stringify(reply));
  };
  await seed([
    { table: "audit", row: { id: "a1", text: "server answer", at: 1 } },
    { table: "notes", row: { id: "n1", text: "local one", at: 1, owner: "dev:alice" } },
    { table: "notes", row: { id: "n2", text: "local two", at: 2, owner: "dev:alice" } },
  ]);
  let offline = false, requests = 0;
  const deviceReads = [];
  const open = async () => {
    const data = join(directory, "device"); mkdirSync(data, { recursive: true });
    const opener = processDevice(binary, data, (cmd, args) => spawn(cmd, args, { stdio: ["pipe", "pipe", "inherit"] }), async (path, text) => writeFileSync(path, text));
    const client = await createLocalClient({ url, persona: "alice", waitSeconds: 1,
      fetch: async (input, init) => { requests++; if (offline) throw new TypeError("test link down"); return fetch(input, init); },
      device: { open: async (...args) => { const core = await opener.open(...args); return { close: () => core.close(), call: (request) => { if (request.op === "query") deviceReads.push(request.name); return core.call(request); } }; } },
    });
    clients.push(client); return client;
  };
  return { url, directory, log: () => log, seed, open, offline: (value) => { offline = value; }, requests: () => requests, deviceReads };
}

test("server-run watches rerun on online-only commits and retain answers offline for the client lifetime", { timeout: 20000 }, async (t) => {
  const f = await fixture(t);
  const client = await f.open(); await client.sync();
  const backend = await fetch(`${f.url}/schema`, { headers: { "x-snapback-persona": "alice" } }).then((r) => r.json());
  assert.equal(backend.programs.find((p) => p.name === "audits").runs, "server");
  assert.equal(backend.schema.operations.audits.runs, "server");
  assert.equal(backend.programs.find((p) => p.name === "add").predicts, "never");
  let watch = client.observe(query("audits"), { c: null });
  await until(() => watch.getSnapshot().data?.[0]?.id === "a1", "initial server answer missing");
  await f.seed([{ table: "audit", row: { id: "a2", text: "commit touched only the server table", at: 2 } }]);
  await until(() => watch.getSnapshot().data?.[0]?.id === "a2", "online-only commit did not rerun watch");
  const last = watch.getSnapshot().data;
  f.offline(true); await client.sync();
  await until(() => watch.getSnapshot().fresh === false, "offline watch did not become stale");
  assert.deepEqual(watch.getSnapshot().data, last);
  assert.ok(watch.getSnapshot().since > 0);
  watch.close();
  watch = client.observe(query("audits"), { c: null });
  await until(() => watch.getSnapshot().fresh === false, "recreated watch lost lifetime memory");
  assert.deepEqual(watch.getSnapshot().data, last);
  assert.ok(!f.deviceReads.includes("audits"), "server-run query entered the device interpreter");
  f.offline(false); await client.sync();
  await until(() => watch.getSnapshot().fresh === true, "watch did not recover online");
  watch.close();
});

test("offline cold watches refuse E_OFFLINE, persisted local reads still work, server answers never persist", { timeout: 20000 }, async (t) => {
  const f = await fixture(t);
  let client = await f.open(); await client.sync();
  assert.equal((await client.query(query("auditById"), { id: "a1" })).data.text, "server answer");
  f.offline(true); await client.sync();
  const watch = client.observe(query("auditById"), { id: "never-observed" });
  await until(() => watch.getSnapshot().denied, "cold offline watch did not refuse");
  assert.equal(watch.getSnapshot().denied.code, "E_OFFLINE");
  assert.equal(watch.getSnapshot().denied.family, "link");
  assert.equal(watch.getSnapshot().denied.retryable, true);
  assert.ok(!("data" in watch.getSnapshot()));
  const local = await client.query(query("localNotes"), { c: null });
  assert.equal(local.data[0].id, "n2");
  assert.equal(local.fresh, false);
  watch.close(); await client.close();
  client = await f.open();
  assert.equal((await client.query(query("auditById"), { id: "a1" })).denied.code, "E_OFFLINE");
  assert.equal((await client.query(query("localNotes"), { c: null })).data[0].id, "n2");
  assert.ok(!f.deviceReads.includes("auditById"));
});

test("connected is server-run even with no ordinary tables and preserves its answer offline", { timeout: 15000 }, async (t) => {
  const f = await fixture(t), client = await f.open(); await client.sync();
  const online = await client.query(query("presence"), {});
  assert.equal(typeof online.data, "boolean");
  f.offline(true); await client.sync();
  const offline = await client.query(query("presence"), {});
  assert.equal(offline.data, online.data); assert.equal(offline.fresh, false); assert.ok(offline.since > 0);
  assert.ok(!f.deviceReads.includes("presence"));
});

test("check sidecar, why and test residency print facts, changes and measured cold rows", { timeout: 15000 }, async (t) => {
  const directory = project(t);
  const run = (...args) => { const result = spawnSync(binary, args, { cwd: directory, encoding: "utf8" }); assert.equal(result.status, 0, result.stdout + result.stderr); return result.stdout; };
  const first = run("check", "--residency");
  assert.match(first, /residency \(facts\)/); assert.match(first, /operations \(facts\)/);
  assert.match(first, /from the read rule/); assert.match(first, /inherited from notes/);
  assert.match(first, /N_MAINTAIN_SYNCED/);
  assert.match(run("why", "audits"), /server[\s\S]*audit[\s\S]*rewrite:/);
  assert.match(run("why", "notes"), /inferred from read/);
  const path = join(directory, "snapback/schema.q");
  writeFileSync(path, schema.replace("  sync last 2 by byTime", "  online only"));
  assert.match(run("check"), /N_NOW_SERVER[\s\S]*localNotes/);
  assert.doesNotMatch(run("check"), /N_NOW_SERVER/);
  writeFileSync(path, schema);
  const fixture = join(directory, "fixture"); mkdirSync(fixture);
  writeFileSync(join(fixture, "notes.jsonl"), [1, 2, 3].map((n) => JSON.stringify({ id: `n${n}`, owner: "dev:alice", text: `note${n}`, at: n })).join("\n"));
  const measured = run("test", "--residency", "--fixture", fixture);
  assert.match(measured, /alice notes: 2 rows/); assert.match(measured, /bob notes: 2 rows/);
  assert.match(measured, /alice counts: 1 rows/); assert.match(measured, /maintain counts \(measurement\): 1 value rows/);
  assert.match(measured, /total across personas: 6 rows/);
  assert.ok(readFileSync(join(directory, "snapback/generated/residency.json"), "utf8").includes('"runs"'));
  console.log(measured.split("\n").filter((line) => /\d+ rows, \d+ bytes|maintain counts \(measurement\)/.test(line)).join("\n"));
});


test("dev compares residency with the served generation even when check advanced its sidecar", { timeout: 15000 }, async (t) => {
  const f = await fixture(t, true);
  writeFileSync(join(f.directory, "snapback/schema.q"), schema.replace("  sync last 2 by byTime", "  online only"));
  const checked = spawnSync(binary, ["check"], { cwd: f.directory, encoding: "utf8" });
  assert.equal(checked.status, 0, checked.stdout + checked.stderr);
  await until(() => f.log().includes("schema adopted as generation 2"), "dev did not adopt edited schema");
  assert.match(f.log(), /N_NOW_SERVER[\s\S]*localNotes/);
  const backend = await fetch(`${f.url}/schema`, { headers: { "x-snapback-persona": "alice" } }).then((r) => r.json());
  assert.equal(backend.schema.operations.localNotes.runs, "server");
});

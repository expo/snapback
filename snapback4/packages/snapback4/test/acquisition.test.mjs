// @ref LLP 3000.008.001#2-three-facts-to-distinguish — a compiled device capability is not an acquired partition.
import test from "node:test";
import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { once } from "node:events";
import { mkdtempSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { createLocalClient } from "../dist/local.js";
import { processDevice } from "../dist/native.js";
import { memoryPersistence, webDevice } from "../dist/web.js";

const root = join(dirname(fileURLToPath(import.meta.url)), "../../..");
const binary = process.env.SNAPBACK4_BIN ?? join(root, "target/debug/snapback4");
const wasm = readFileSync(join(root, "packages/snapback4/src/wasm/snapback4_device_bg.wasm"));
const source = `use personas alice
table notes:
  body: text <=100
  public 'acquisition fixture'
  insert <- allow
  sync
query all():
  return notes first 100 by byId
query countAll():
  page = notes first 100 by byId
  return count(page)
query one():
  return notes['seed']
query guarded():
  require exists notes['seed'] else MISSING
  return true
mutation add(body: text <=100):
  require exists notes['seed'] else MISSING
  return insert notes { body }
`;
const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
async function until(check, message) {
  const end = Date.now() + 15000;
  do { if (await check()) return; await sleep(20); } while (Date.now() < end);
  assert.fail(message);
}
const query = (name) => ({ kind: "query", name });

async function fixture(t, tier, empty = false) {
  const directory = mkdtempSync(join(tmpdir(), "sb4-acquisition-"));
  mkdirSync(join(directory, "snapback"));
  const schemaPath = join(directory, "snapback/schema.q");
  writeFileSync(schemaPath, source);
  t.after(() => rmSync(directory, { recursive: true, force: true }));
  const child = spawn(binary, ["dev", "--port", "0", "--fresh"], { cwd: directory, stdio: ["ignore", "pipe", "pipe"] });
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
  const headers = { "x-snapback-persona": "alice" };
  const post = (path, body) => fetch(`${url}${path}`, { method: "POST", headers, body: JSON.stringify(body) }).then((r) => r.json());
  const backend = () => fetch(`${url}/schema`, { headers }).then((r) => r.json());
  if (!empty) assert.equal((await post("/seed", Array.from({ length: 6 }, (_, n) => ({ table: "notes", row: { id: n ? `row-${n}` : "seed", body: `note ${n}` } })))).seeded, 6);
  const deviceDir = join(directory, "device"); mkdirSync(deviceDir);
  const persist = memoryPersistence();
  let core, mode = "sync-fails", snapshots = 0, catchups = 0, posts = 0;
  const open = async () => {
    const opener = tier === "wasm" ? webDevice({ wasm, persist }) : processDevice({ binary, dir: deviceDir,
      spawn: (cmd, args) => spawn(cmd, args, { stdio: ["pipe", "pipe", "inherit"] }),
      writeFile: async (path, text) => writeFileSync(path, text) });
    const client = await createLocalClient({ url, persona: "alice", waitSeconds: 1,
      device: { open: async (...args) => { core = await opener.open(...args); return core; } },
      fetch: async (input, init) => {
        const path = new URL(input).pathname;
        if (mode === "offline") throw new TypeError("offline reopen");
        if (path === "/schema" && mode === "after-adopt") {
          const response = await fetch(input, init); mode = "sync-fails"; return response;
        }
        if (path === "/sync") {
          const body = JSON.parse(init.body);
          if (mode === "sync-fails" || (mode === "after-page" && snapshots > 0) || (mode === "before-catchup" && body.stream)) throw new TypeError("interrupted acquisition");
          const response = await fetch(input, { ...init, body: JSON.stringify({ ...body, limit: 2 }) });
          const page = await response.clone().json();
          if (page.snapshot) snapshots++;
          if (body.stream) catchups++;
          return response;
        }
        if (path.startsWith("/m/")) posts++;
        return fetch(input, init);
      },
    });
    clients.push(client); return client;
  };
  return { open, backend, schemaPath, core: () => core, mode: (next) => { mode = next; }, counts: () => ({ snapshots, catchups, posts }) };
}

async function observations(client, t) {
  const answers = {};
  for (const name of ["all", "countAll", "one", "guarded"]) answers[name] = await client.query(query(name), {});
  t.diagnostic(`unacquired answers: ${JSON.stringify(answers)}`);
  return answers;
}
function assertUnknown(answers) {
  for (const [name, answer] of Object.entries(answers)) {
    assert.equal(answer.denied?.code, "E_OFFLINE", `${name}: no fabricated absence or authoritative refusal`);
    assert.equal("data" in answer, false);
  }
}
async function unknown(client, t) { assertUnknown(await observations(client, t)); }

for (const tier of ["wasm", "process"]) {
  test(`${tier}: schema alone is not acquisition; queued guarded writes survive offline reopen`, { timeout: 30000 }, async (t) => {
    const f = await fixture(t, tier);
    let client = await f.open();
    const first = await observations(client, t);
    const pending = await client.mutate({ kind: "mutation", name: "add" }, { body: "queued before acquisition" });
    const held = (await f.core().call({ op: "queued" })).ok;
    t.diagnostic(`before acquisition write: ${JSON.stringify(pending)}; durable queue: ${JSON.stringify(held)}`);
    await client.close(); f.mode("offline");
    client = await f.open();
    const reopened = await observations(client, t);
    assertUnknown(first); assertUnknown(reopened);
    assert.equal(pending.state, "pending");
    assert.equal(held.length, 1); assert.equal(held[0].id, pending.id);
    assert.equal(held[0].predictable, false); assert.deepEqual(held[0].predicted, []);
    assert.equal((await f.core().call({ op: "queued" })).ok[0].id, pending.id);
    const terminal = []; client.onWrite((write) => terminal.push(write));
    f.mode("online"); await client.sync();
    await until(() => terminal.some((write) => write.id === pending.id), "guarded write did not settle");
    assert.equal(terminal.find((write) => write.id === pending.id).state, "sent");
    await client.sync();
    const rows = await client.query(query("all"), {});
    assert.equal(rows.complete, true); assert.equal(rows.data.length, 7);
    assert.equal(rows.data.filter((row) => row.body === "queued before acquisition").length, 1);
    assert.equal(f.counts().posts, 1, "one stable write was submitted");
  });

  test(`${tier}: snapshot and catch-up publish readiness together; later failures preserve acquired rows`, { timeout: 30000 }, async (t) => {
    const f = await fixture(t, tier);
    f.mode("after-page"); let client = await f.open();
    assert.equal(f.counts().snapshots, 1); await unknown(client, t);
    await client.close(); f.mode("offline"); client = await f.open(); await unknown(client, t);
    await client.close(); f.mode("before-catchup"); client = await f.open();
    assert.ok(f.counts().snapshots > 1); assert.equal(f.counts().catchups, 0);
    await unknown(client, t);
    f.mode("online"); await client.sync();
    const full = await client.query(query("all"), {});
    assert.equal(full.complete, true); assert.equal(full.data.length, 6); assert.ok(f.counts().catchups > 0);
    f.mode("offline"); await client.sync(); await client.close(); client = await f.open();
    const stale = await client.query(query("all"), {});
    assert.equal(stale.complete, true); assert.equal(stale.fresh, false); assert.deepEqual(stale.data, full.data);
    const queued = await client.mutate({ kind: "mutation", name: "add" }, { body: "acquired prediction" });
    assert.equal(queued.state, "pending");
    assert.equal((await f.core().call({ op: "queued" })).ok[0].predictable, true);
    // Safe literal-default evolution retains the complete old partition.
    const old = await f.backend();
    const evolved = source.replace("  body: text <=100", "  body: text <=100\n  tag: text <=20 default 'new'");
    writeFileSync(f.schemaPath, evolved);
    await until(async () => (await f.backend()).generation !== old.generation, "server did not adopt the new generation");
    await client.close(); f.mode("sync-fails"); client = await f.open();
    const inherited = await client.query(query("all"), {});
    assert.equal(inherited.complete, true); assert.equal(inherited.fresh, false); assert.equal(inherited.data.length, 7);
    assert.ok(inherited.data.every((row) => row.tag === "new"));
    assert.equal((await f.core().call({ op: "queued" })).ok[0].id, queued.id);
    f.mode("online"); await client.sync();
    await until(async () => (await f.core().call({ op: "queued" })).ok.length === 0, "old queued write did not settle after adoption");
    const current = await client.query(query("all"), {});
    assert.equal(current.complete, true); assert.equal(current.data.length, 7);
    assert.ok(current.data.every((row) => row.tag === "new"));
    // A changed horizon resets the partition. Exercise the live adopt path,
    // interrupt its acquisition, then reopen the reset generation offline.
    const acquired = await f.backend();
    f.mode("offline");
    writeFileSync(f.schemaPath, evolved.replace("  sync\n", "  sync last 100 by byId\n"));
    await until(async () => (await f.backend()).generation !== acquired.generation, "server did not change the horizon");
    f.mode("after-adopt"); await client.sync(); await unknown(client, t);
    await client.close(); f.mode("offline"); client = await f.open(); await unknown(client, t);
    f.mode("online"); await client.sync();
    const reacquired = await client.query(query("all"), {});
    assert.equal(reacquired.complete, true); assert.equal(reacquired.data.length, 7);
  });

  test(`${tier}: a genuinely empty partition at sequence zero is acquired durably`, { timeout: 20000 }, async (t) => {
    const f = await fixture(t, tier, true);
    f.mode("online"); let client = await f.open();
    assert.equal((await f.core().call({ op: "state" })).ok.watermark, 0);
    f.mode("offline"); await client.sync(); await client.close(); client = await f.open();
    const page = await client.query(query("all"), {}), count = await client.query(query("countAll"), {});
    assert.deepEqual(page.data, []); assert.equal(page.complete, true); assert.equal(page.fresh, false);
    assert.equal(count.data, 0); assert.equal(count.complete, true);
    assert.equal((await client.query(query("guarded"), {})).denied?.code, "MISSING", "acquired absence may justify the program's refusal");
  });
}

// CLI activation and inspection over real persisted stores. Test processes
// and deployment directories are isolated and removed by their owner.
import test from "node:test";
import assert from "node:assert/strict";
import { spawn, spawnSync } from "node:child_process";
import { once } from "node:events";
import { existsSync, mkdtempSync, mkdirSync, readFileSync, readlinkSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { DatabaseSync } from "node:sqlite";
import { setTimeout as delay } from "node:timers/promises";
import { fileURLToPath } from "node:url";
import { createLocalClient } from "../dist/local.js";
import { processDevice } from "../dist/native.js";

const root = join(dirname(fileURLToPath(import.meta.url)), "../../..");
const binary = process.env.SNAPBACK4_BIN ?? join(root, "target/debug/snapback4");
const source = `use identity guests
use personas alice
table items:
  body: text <=100
  read <- allow
  insert <- allow
  sync public
mutation add():
  return insert items {body: 'kept'}
query q():
  return 1
`;

function fixture(t) {
  const directory = mkdtempSync(join(tmpdir(), "sb4-cli-activation-"));
  t.after(() => rmSync(directory, { recursive: true, force: true }));
  const app = join(directory, "app"), deployment = join(directory, "deployment");
  mkdirSync(join(app, "snapback"), { recursive: true });
  const schema = join(app, "snapback/schema.q");
  writeFileSync(schema, source);
  const invoke = (...args) => spawnSync(binary, args, { cwd: app, encoding: "utf8", timeout: 4000 });
  const run = (...args) => {
    const result = invoke(...args);
    assert.equal(result.error, undefined, result.error?.message);
    assert.equal(result.status, 0, `${args.join(" ")}\n${result.stdout}\n${result.stderr}`);
    return result.stdout;
  };
  return { app, deployment, schema, invoke, run };
}

function state(path) {
  const db = new DatabaseSync(path, { readOnly: true });
  try {
    return {
      metadata: Object.fromEntries(db.prepare("SELECT key, value FROM _meta ORDER BY key").all().map(({ key, value }) => [key, value])),
      rows: db.prepare("SELECT t, id, data FROM r ORDER BY t, id").all(),
      indexes: db.prepare("SELECT ti, hex(k) AS key, id FROM i ORDER BY ti, k").all(),
      generations: db.prepare("SELECT generation, schema, programs FROM _generations ORDER BY generation").all(),
    };
  } finally { db.close(); }
}

async function serve(deployment, inspect) {
  const child = spawn(binary, ["serve", deployment, "--port", "0", "--bind", "127.0.0.1"], { stdio: ["ignore", "pipe", "pipe"] });
  const exited = once(child, "exit");
  let log = "", url;
  child.stdout.on("data", (data) => { log += data; url ??= log.match(/http:\/\/127\.0\.0\.1:\d+/)?.[0]; });
  child.stderr.on("data", (data) => { log += data; });
  try {
    const deadline = Date.now() + 3000;
    while (!url && child.exitCode == null && Date.now() < deadline) await delay(10);
    assert.ok(url, log || "release server did not listen");
    const anonymous = await fetch(url + "/schema", { signal: AbortSignal.timeout(2000) });
    assert.equal(anonymous.status, 401);
    assert.equal((await anonymous.json()).denied?.code, "E_AUTH");
    const signedIn = await (await fetch(url + "/auth/guest", { method: "POST", headers: { "content-type": "application/json" }, body: "{}" })).json();
    assert.ok(signedIn.session?.token, JSON.stringify(signedIn));
    await inspect(url, { authorization: `Bearer ${signedIn.session.token}` }, signedIn.session);
  } finally {
    if (child.exitCode == null && child.signalCode == null) child.kill("SIGTERM");
    await exited;
  }
}

test("rollback then deploy keeps immutable source identities and serving only attaches", { timeout: 15000 }, async (t) => {
  const { app, deployment, schema, run } = fixture(t);
  const database = join(deployment, "store.sqlite");
  run("deploy", deployment);
  writeFileSync(join(app, "snapback/extra.q"), "query old():\n  return 2\n");
  run("deploy", deployment);
  assert.equal(state(database).metadata.release, "2");
  run("rollback", deployment);
  assert.equal(state(database).metadata.release, "1");
  assert.equal(state(database).metadata.generation, "3");
  rmSync(join(app, "snapback/extra.q"));
  writeFileSync(schema, source.replace("return 1", "return 3"));
  run("deploy", deployment);
  const before = state(database);
  assert.equal(before.metadata.release, "3");
  assert.equal(before.metadata.generation, "4");
  assert.ok(existsSync(join(deployment, "releases/2/snapback/extra.q")));
  assert.equal(existsSync(join(deployment, "releases/3/snapback/extra.q")), false);
  assert.match(readFileSync(join(deployment, "releases/1/snapback/schema.q"), "utf8"), /return 1/);
  // A crashed pointer-copy update cannot override the database's current release.
  writeFileSync(join(deployment, "current"), "1\n");
  await serve(deployment, async (url, headers) => {
    const response = await fetch(url + "/schema", { headers, signal: AbortSignal.timeout(2000) });
    const backend = await response.json();
    assert.equal(backend.generation, 4);
    assert.deepEqual(backend.programs.map((p) => p.name).sort(), ["add", "q"]);
    assert.deepEqual(backend.programs.find((p) => p.name === "q").body, [{ Return: { Literal: { Int: 3 } } }]);
  });
  assert.deepEqual(state(database), before, "startup must not activate source or advance generation");
});

test("a live release refuses deploy and rollback until the server stops", { timeout: 15000 }, async (t) => {
  const { deployment, schema, invoke, run } = fixture(t);
  run("deploy", deployment);
  const database = join(deployment, "store.sqlite"), before = state(database);
  writeFileSync(schema, source.replace("return 1", "return 2"));
  await serve(deployment, async (url, headers) => {
    for (const args of [["deploy", deployment], ["rollback", deployment]]) {
      const blocked = invoke(...args);
      assert.equal(blocked.error, undefined);
      assert.equal(blocked.status, 1);
      assert.match(blocked.stderr, /deployment is live/);
      assert.deepEqual(state(database), before, "a refused activation must not move the database");
    }
    const backend = await (await fetch(url + "/schema", { headers, signal: AbortSignal.timeout(2000) })).json();
    assert.equal(backend.generation, Number(before.metadata.generation));
    assert.deepEqual(backend.programs.find((p) => p.name === "q").body, [{ Return: { Literal: { Int: 1 } } }]);
  });
  run("deploy", deployment);
  assert.equal(state(database).metadata.release, "2", "activation proceeds after the serving process releases the lock");
});

test("required pointer and ledger failures happen before database activation", { timeout: 15000 }, (t) => {
  const { deployment, schema, invoke, run } = fixture(t);
  run("deploy", deployment);
  const database = join(deployment, "store.sqlite"), before = state(database);
  writeFileSync(schema, source.replace("return 1", "return 2"));
  const pointer = join(deployment, "current");
  rmSync(pointer);
  mkdirSync(pointer);
  let result = invoke("deploy", deployment);
  assert.equal(result.error, undefined);
  assert.equal(result.status, 1);
  assert.match(result.stderr, /current must be a regular/);
  assert.deepEqual(state(database), before);
  rmSync(pointer, { recursive: true });
  writeFileSync(pointer, "1\n");
  const ledger = join(deployment, "releases.jsonl");
  rmSync(ledger);
  mkdirSync(ledger);
  result = invoke("deploy", deployment);
  assert.equal(result.error, undefined);
  assert.equal(result.status, 1);
  assert.deepEqual(state(database), before);
  assert.equal(readFileSync(pointer, "utf8"), "1\n");
});

test("data and doctor inspect persisted state despite destructive or broken source edits", { timeout: 15000 }, (t) => {
  const { app, schema, invoke, run } = fixture(t);
  run("run", "add", "--as", "alice");
  const database = join(app, ".snapback4/store.sqlite"), before = state(database);
  writeFileSync(schema, "table items:\n  read <- allow\nquery q():\n  return 2\n");
  assert.equal(JSON.parse(run("data", "items")).body, "kept");
  const doctor = JSON.parse(run("doctor", "--json"));
  assert.ok(doctor.lines.some((line) => line.includes(`generation ${before.metadata.generation}`)));
  assert.equal(doctor.storage.row_count, 1);
  assert.deepEqual(state(database), before);
  writeFileSync(schema, "this is not valid Quarry\n");
  assert.equal(JSON.parse(run("data", "items")).body, "kept");
  const broken = invoke("doctor", "--json");
  assert.equal(broken.status, 1);
  assert.equal(JSON.parse(broken.stdout).storage.row_count, 1, "source diagnostics must not hide persisted state");
  assert.deepEqual(state(database), before);
});

test("serving edited release schema or programs refuses without adopting them", { timeout: 15000 }, (t) => {
  const { deployment, invoke, run } = fixture(t);
  run("deploy", deployment);
  const database = join(deployment, "store.sqlite"), before = state(database);
  const released = join(deployment, "releases/1/snapback/schema.q");
  for (const changed of [source.replace("return 1", "return 9"), source.replace("<=100", "<=200")]) {
    writeFileSync(released, changed);
    const result = invoke("serve", deployment, "--port", "0", "--bind", "127.0.0.1");
    assert.equal(result.error, undefined, "mismatched source must refuse before starting a server");
    assert.equal(result.status, 1);
    assert.match(result.stderr, /release source differs from its activated backend/);
    assert.deepEqual(state(database), before);
  }
});

test("legacy pointer deployments upgrade through deploy, never implicit serving", { timeout: 15000 }, async (t) => {
  const { deployment, invoke, run } = fixture(t);
  run("deploy", deployment);
  const database = join(deployment, "store.sqlite");
  const db = new DatabaseSync(database);
  db.exec("DELETE FROM _meta WHERE key IN ('release', 'activation_hash'); DELETE FROM _generations;");
  db.close();
  const before = state(database);
  assert.equal(before.metadata.generation, "1");
  const legacy = invoke("serve", deployment, "--port", "0", "--bind", "127.0.0.1");
  assert.equal(legacy.error, undefined);
  assert.equal(legacy.status, 1);
  assert.match(legacy.stderr, /deploy its source once before serving/);
  assert.deepEqual(state(database), before);
  const doctor = spawnSync(binary, ["doctor", "--json"], { cwd: join(deployment, "releases/1"), encoding: "utf8", timeout: 4000 });
  assert.equal(doctor.status, 1, "legacy stores have no persisted backend to attach to yet");
  assert.equal(JSON.parse(doctor.stdout).storage.row_count, 0, "legacy metadata remains inspectable");
  assert.deepEqual(state(database), before);
  run("deploy", deployment);
  const upgraded = state(database);
  assert.equal(upgraded.metadata.release, "2");
  assert.equal(upgraded.metadata.generation, "2");
  await serve(deployment, async (url, headers) => {
    const backend = await (await fetch(url + "/schema", { headers, signal: AbortSignal.timeout(2000) })).json();
    assert.equal(backend.generation, 2);
  });
  assert.deepEqual(state(database), upgraded);
});

test("local dev and run cannot reactivate source inside a deployed release", { timeout: 15000 }, async (t) => {
  const { deployment, schema, run } = fixture(t);
  run("deploy", deployment);
  await serve(deployment, async () => {}); // Creates release 1's shared-store link.
  writeFileSync(schema, source.replace("return 1", "return 2"));
  run("deploy", deployment);
  const database = join(deployment, "store.sqlite"), before = state(database);
  for (const args of [["run", "q", "--as", "alice"], ["dev", "--port", "0", "--no-watch"]]) {
    const result = spawnSync(binary, args, { cwd: join(deployment, "releases/1"), encoding: "utf8", timeout: 4000 });
    assert.equal(result.error, undefined, "the local verb must refuse before serving or running source");
    assert.notEqual(result.status, 0);
    assert.match(result.stderr, /this store belongs to a deployment/);
    assert.deepEqual(state(database), before);
  }
});

test("inspection of a new project does not initialize a store", (t) => {
  const { app, invoke } = fixture(t);
  assert.notEqual(invoke("data", "items").status, 0);
  assert.notEqual(invoke("doctor", "--json").status, 0);
  assert.equal(existsSync(join(app, ".snapback4/store.sqlite")), false);
});

test("check reports generated-type write failures and data refuses malformed limits", (t) => {
  const { app, invoke, run } = fixture(t);
  mkdirSync(join(app, "snapback/generated/api.ts"), { recursive: true });
  const checked = invoke("check");
  assert.equal(checked.error, undefined);
  assert.equal(checked.status, 2);
  assert.match(checked.stderr, /cannot write generated types/);
  assert.doesNotMatch(checked.stdout, /check: ok/);

  rmSync(join(app, "snapback/generated"), { recursive: true, force: true });
  run("run", "add", "--as", "alice");
  const limited = invoke("data", "items", "--limit", "garbage");
  assert.equal(limited.status, 2);
  assert.match(limited.stderr, /--limit must be a non-negative integer/);
  const unknown = invoke("data", "nosuchtable");
  assert.equal(unknown.status, 1);
  assert.match(unknown.stderr, /no table nosuchtable; tables: items/);
});

test("run says when a job ignores --as and executes as the system", (t) => {
  const { schema, invoke, run } = fixture(t);
  writeFileSync(schema, source.replace("  insert <- allow", "  insert <- allow\n  update <- allow") + "job sweep():\n  chunk row in items first 1 by byId:\n    update items[row.id] { body: row.body }\n");
  run("check");
  const result = invoke("run", "sweep", "--as", "alice");
  assert.equal(result.status, 0, result.stderr);
  assert.match(result.stderr, /--as is ignored.*system/);
});

// @ref LLP 3000.008.004#4-operational-completeness-on-the-supported-target — a stopped full-release copy is a new, isolated recovery boundary.
test("stopped full-release restore preserves its recovery point and stays separate from the original", { timeout: 20000 }, async (t) => {
  const { app, deployment, schema, invoke, run } = fixture(t);
  const recoverySource = `use identity guests
effect notify
table items:
  body: text <=100
  photo: image <=10000000 ?
  read <- allow
  insert <- allow
  sync public
mutation add(body: text <=100, photo: image <=10000000 ?):
  item = insert items {body, photo}
  emit notify {id: item.id}
  return item
query q():
  return items first 100 by byId
job checkpoint():
  chunk item in items first 1 by byId:
    require false else RECOVERY_STOP
schedule checkpointDaily every 1d: checkpoint
`;
  writeFileSync(schema, recoverySource);
  run("deploy", deployment);
  const database = join(deployment, "store.sqlite");
  const recoveryState = (directory) => {
    const db = new DatabaseSync(join(directory, "store.sqlite"), { readOnly: true });
    try {
      return { ...state(join(directory, "store.sqlite")), durable: Object.fromEntries([
        "_principals", "_sessions", "_credentials", "_ops", "_outbox", "_jobs", "_assets", "_commits", "_log",
      ].map((table) => [table, db.prepare(`SELECT * FROM ${table} ORDER BY 1, 2, 3`).all()])) };
    } finally { db.close(); }
  };
  const post = async (url, headers, path, body) => {
    const response = await fetch(url + path, { method: "POST", headers: { ...headers, "content-type": "application/json" }, body: JSON.stringify(body), signal: AbortSignal.timeout(2000) });
    assert.equal(response.status, 200);
    return response.json();
  };
  // Advance only the fixture's persisted schedule clock so the real scheduler
  // produces a parked job promptly; no synthetic job/effect/dedup rows.
  let db = new DatabaseSync(database);
  db.prepare("INSERT INTO _meta(key, value) VALUES ('schedule:checkpointDaily', '0')").run();
  db.close();
  const png = Buffer.from("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+aX1cAAAAASUVORK5CYII=", "base64");
  let asset, session, originalHeaders, committed;
  await serve(deployment, async (url, headers, signedIn) => {
    session = signedIn; originalHeaders = headers;
    const uploaded = await (await fetch(url + "/assets", { method: "POST", headers, body: png })).json();
    assert.ok(uploaded.asset?.id);
    asset = uploaded.asset.id;
    committed = await post(url, headers, "/m/add", { id: "before-backup", args: { body: "at backup", photo: { id: asset } } });
    assert.equal(committed.state, "sent");
    const deadline = Date.now() + 4000;
    while (!recoveryState(deployment).durable._jobs.some((job) => job.state === "parked") && Date.now() < deadline) await delay(25);
    assert.equal(recoveryState(deployment).durable._jobs[0]?.state, "parked");
  }); // Owned server (including its scheduler) has exited before any copy.
  // Hold the fixture clock beyond this experiment, so restored startup cannot
  // schedule another job. External effect workers are never launched.
  db = new DatabaseSync(database);
  db.prepare("UPDATE _meta SET value = ? WHERE key = 'schedule:checkpointDaily'").run(String(Date.now() + 86400000));
  db.close();
  const before = recoveryState(deployment);
  assert.equal(before.durable._outbox.length, 1);
  assert.equal(before.durable._outbox[0].state, "queued");
  assert.equal(before.durable._ops.length, 1);
  assert.ok(before.durable._sessions.length > 0);
  assert.equal(before.durable._assets.length, 1);
  // Model a legacy deployment, including its absolute generated store link.
  const storeLink = join("releases", "1", ".snapback4", "store.sqlite");
  assert.equal(readlinkSync(join(deployment, storeLink)), "../../../store.sqlite", "new release links are relocatable");
  rmSync(join(deployment, storeLink));
  symlinkSync(database, join(deployment, storeLink));
  const backup = join(dirname(app), "backup"), restored = join(dirname(app), "restored");
  const copy = (from, to) => {
    assert.equal(existsSync(to), false, "copy into a new directory, never merge a restore");
    const copied = spawnSync("cp", ["-a", from, to], { encoding: "utf8", timeout: 4000 });
    assert.equal(copied.error, undefined);
    assert.equal(copied.status, 0, copied.stderr);
  };
  copy(deployment, backup);
  copy(backup, restored);
  assert.deepEqual(recoveryState(restored), before, "auth, dedup, jobs, effects and generation travel with the stopped database");
  for (const path of ["current", "releases.jsonl", "releases/1/snapback/schema.q", `assets/${asset}`]) {
    assert.deepEqual(readFileSync(join(restored, path)), readFileSync(join(backup, path)));
  }
  // The original remains present and acquires data beyond the recovery point.
  await serve(deployment, async (url) => {
    assert.equal((await post(url, originalHeaders, "/m/add", { id: "after-backup", args: { body: "original only" } })).state, "sent");
  });
  const originalAfter = recoveryState(deployment);
  assert.equal(originalAfter.rows.length, 2);
  await serve(restored, async (url) => {
    const rows = await post(url, originalHeaders, "/q/q", { args: {} });
    assert.deepEqual(rows.data.map((row) => row.body), ["at backup"], "copied release must not attach the original database through its legacy symlink");
    assert.equal(readlinkSync(join(restored, storeLink)), "../../../store.sqlite");
    const bytes = await fetch(`${url}/assets/${asset}`, { headers: originalHeaders });
    assert.equal(bytes.status, 200);
    assert.deepEqual(Buffer.from(await bytes.arrayBuffer()), png);
    const replay = await post(url, originalHeaders, "/m/add", { id: "before-backup", args: { body: "at backup", photo: { id: asset } } });
    assert.equal(replay.state, "sent");
    assert.equal(replay.replayed, true);
    assert.equal(replay.seq, committed.seq);
    assert.equal(recoveryState(restored).durable._outbox.length, 1, "known pre-backup replay emits nothing again");
    assert.equal(recoveryState(restored).durable._ops.some((op) => op.id === "after-backup"), false, "post-backup dedup evidence is absent, not an exactly-once continuation promise");
    // A fresh real process device acquires this recovery point: no old
    // watermarks or pending outbox are attached to the restored endpoint.
    const deviceDir = join(dirname(app), "fresh-restored-device"); mkdirSync(deviceDir);
    const client = await createLocalClient({ url, session, waitSeconds: 1,
      device: processDevice({ binary, dir: deviceDir,
        spawn: (cmd, args) => spawn(cmd, args, { stdio: ["pipe", "pipe", "inherit"] }),
        writeFile: async (path, text) => writeFileSync(path, text) }),
    });
    try {
      await client.sync();
      const local = await client.query({ kind: "query", name: "q" }, {});
      assert.equal(local.complete, true);
      assert.deepEqual(local.data.map((row) => row.body), ["at backup"]);
    } finally { await client.close(); }
  });
  assert.deepEqual(recoveryState(deployment), originalAfter, "restored serving and authentication must not touch the original");
  const restoredBeforeActivation = recoveryState(restored);
  assert.deepEqual(restoredBeforeActivation.durable._jobs, before.durable._jobs);
  assert.deepEqual(restoredBeforeActivation.durable._outbox, before.durable._outbox);
  assert.deepEqual(recoveryState(backup), before, "the backup itself is never served or modified");
  // Reuse the existing activation verbs at the recovered location: widening
  // is permitted; a destructive candidate refuses; rollback changes source,
  // while rows written after the backup remain rows of the recovered store.
  writeFileSync(schema, recoverySource.replaceAll("text <=100", "text <=200"));
  run("deploy", restored);
  await serve(restored, async (url) => {
    assert.equal((await post(url, originalHeaders, "/m/add", { id: "restored-new", args: { body: "restored only" } })).state, "sent");
  });
  const beforeRefusal = recoveryState(restored);
  writeFileSync(schema, "use identity guests\nquery q():\n  return 0\n");
  const refused = invoke("deploy", restored);
  assert.equal(refused.status, 1);
  assert.match(refused.stderr, /loses data/);
  assert.deepEqual(recoveryState(restored), beforeRefusal);
  run("rollback", restored);
  assert.equal(state(join(restored, "store.sqlite")).metadata.release, "1");
  assert.equal(state(join(restored, "store.sqlite")).metadata.generation, "3");
  await serve(restored, async (url) => {
    const rows = await post(url, originalHeaders, "/q/q", { args: {} });
    assert.deepEqual(rows.data.map((row) => row.body).sort(), ["at backup", "restored only"]);
  });
  assert.deepEqual(recoveryState(deployment), originalAfter);
  t.diagnostic(`recovery point: release ${before.metadata.release}, generation ${before.metadata.generation}, sequence ${committed.seq}; post-backup original writes excluded; queued effects never delivered`);
});

test("release serving repairs dangling legacy links and refuses an unexpected regular store file", { timeout: 10000 }, async (t) => {
  const { deployment, invoke, run } = fixture(t);
  run("deploy", deployment);
  await serve(deployment, async () => {});
  const link = join(deployment, "releases/1/.snapback4/store.sqlite");
  rmSync(link);
  symlinkSync(join(deployment, "missing-original/store.sqlite"), link);
  await serve(deployment, async () => {});
  assert.equal(readlinkSync(link), "../../../store.sqlite");
  rmSync(link);
  writeFileSync(link, "unexpected owned file");
  const before = state(join(deployment, "store.sqlite"));
  const refused = invoke("serve", deployment, "--port", "0", "--bind", "127.0.0.1");
  assert.equal(refused.error, undefined);
  assert.equal(refused.status, 1);
  assert.match(refused.stderr, /release store path must be a symbolic link/);
  assert.equal(readFileSync(link, "utf8"), "unexpected owned file");
  assert.deepEqual(state(join(deployment, "store.sqlite")), before);
});

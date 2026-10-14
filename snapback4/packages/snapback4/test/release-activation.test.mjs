import { captureStdout } from './helpers/server-output.mjs';
import { waitFor, hangBudget } from './helpers/wait.mjs';
import { cleanup, withCleanup } from './helpers/cleanup.mjs';
// CLI activation and inspection over real persisted stores. Test processes
// and deployment directories are isolated and removed by their owner.
import test from "node:test";
import assert from "node:assert/strict";
import { spawn, spawnSync } from "node:child_process";
import { once } from "node:events";
import { chmodSync, existsSync, mkdtempSync, mkdirSync, readFileSync, readlinkSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
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
  const invoke = (...args) => spawnSync(binary, args, { cwd: app, encoding: "utf8", timeout: hangBudget() });
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
  const readStdout = captureStdout(child);
  const exited = once(child, "exit");
  let log = "", url;
  child.stdout.on("data", (data) => { log += data; url ??= readStdout().match(/http:\/\/127\.0\.0\.1:\d+(?=\r?\n)/)?.[0]; });
  child.stderr.on("data", (data) => { log += data; });
  await withCleanup(async () => {
    const deadline = performance.now() + hangBudget();
    while (!url && child.exitCode == null && performance.now() < deadline) await delay(10);
    assert.ok(url, log || "release server did not listen");
    const anonymous = await fetch(url + "/schema", { signal: AbortSignal.timeout(hangBudget()) });
    assert.equal(anonymous.status, 401);
    assert.equal((await anonymous.json()).denied?.code, "E_AUTH");
    const signedIn = await (await fetch(url + "/auth/guest", { method: "POST", headers: { "content-type": "application/json" }, body: "{}" })).json();
    assert.ok(signedIn.session?.token, JSON.stringify(signedIn));
    await inspect(url, { authorization: `Bearer ${signedIn.session.token}` }, signedIn.session, () => log, child);
  }, async () => {
    if (child.exitCode == null && child.signalCode == null) child.kill("SIGTERM");
    try {
      await cleanup(() => exited, `release server ${child.pid}`, () => log, [child]);
    } finally {
      if (child.exitCode == null && child.signalCode == null) child.kill("SIGKILL");
    }
  });
}

test("rollback then deploy keeps immutable source identities and serving only attaches", { timeout: hangBudget(3) }, async (t) => {
  const { app, deployment, schema, run } = fixture(t);
  const database = join(deployment, "store.sqlite");
  run("deploy", deployment);
  const storeIdentity = state(database).metadata.store_id;
  assert.match(storeIdentity, /^[0-9a-f]{32}$/);
  writeFileSync(join(app, "snapback/extra.q"), "query old():\n  return 2\n");
  run("deploy", deployment);
  assert.equal(state(database).metadata.release, "2");
  assert.equal(state(database).metadata.store_id, storeIdentity);
  run("rollback", deployment);
  assert.equal(state(database).metadata.release, "1");
  assert.equal(state(database).metadata.store_id, storeIdentity);
  assert.equal(state(database).metadata.generation, "3");
  rmSync(join(app, "snapback/extra.q"));
  writeFileSync(schema, source.replace("return 1", "return 3"));
  run("deploy", deployment);
  const before = state(database);
  assert.equal(before.metadata.store_id, storeIdentity);
  assert.equal(before.metadata.release, "3");
  assert.equal(before.metadata.generation, "4");
  assert.ok(existsSync(join(deployment, "releases/2/snapback/extra.q")));
  assert.equal(existsSync(join(deployment, "releases/3/snapback/extra.q")), false);
  assert.match(readFileSync(join(deployment, "releases/1/snapback/schema.q"), "utf8"), /return 1/);
  // A crashed pointer-copy update cannot override the database's current release.
  writeFileSync(join(deployment, "current"), "1\n");
  await serve(deployment, async (url, headers) => {
    const response = await fetch(url + "/schema", { headers, signal: AbortSignal.timeout(hangBudget()) });
    const backend = await response.json();
    assert.equal(backend.generation, 4);
    assert.deepEqual(backend.programs.map((p) => p.name).sort(), ["add", "q"]);
    assert.deepEqual(backend.programs.find((p) => p.name === "q").body, [{ Return: { Literal: { Int: 3 } } }]);
  });
  assert.deepEqual(state(database), before, "startup must not activate source or advance generation");
});

test("live release deploy and rollback activate without restart", { timeout: hangBudget(3) }, async (t) => {
  const { deployment, schema, run } = fixture(t);
  run("deploy", deployment);
  writeFileSync(schema, source.replace("return 1", "return 2"));
  await serve(deployment, async (url, headers) => {
    run("deploy", deployment);
    let backend = await (await fetch(url + "/schema", { headers })).json();
    assert.equal(backend.generation, 2);
    assert.deepEqual(backend.programs.find((p) => p.name === "q").body, [{ Return: { Literal: { Int: 2 } } }]);
    run("rollback", deployment);
    backend = await (await fetch(url + "/schema", { headers })).json();
    assert.equal(backend.generation, 3);
    assert.deepEqual(backend.programs.find((p) => p.name === "q").body, [{ Return: { Literal: { Int: 1 } } }]);
  });
});

test("required pointer and ledger failures happen before database activation", { timeout: hangBudget(1) }, (t) => {
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

test("data and doctor inspect persisted state despite destructive or broken source edits", { timeout: hangBudget(1) }, (t) => {
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

test("serving edited release schema or programs refuses without adopting them", { timeout: hangBudget(1) }, (t) => {
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

test("legacy pointer deployments upgrade through deploy, never implicit serving", { timeout: hangBudget(3) }, async (t) => {
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
  const doctor = spawnSync(binary, ["doctor", "--json"], { cwd: join(deployment, "releases/1"), encoding: "utf8", timeout: hangBudget() });
  assert.equal(doctor.status, 1, "legacy stores have no persisted backend to attach to yet");
  assert.equal(JSON.parse(doctor.stdout).storage.row_count, 0, "legacy metadata remains inspectable");
  assert.deepEqual(state(database), before);
  run("deploy", deployment);
  const upgraded = state(database);
  assert.equal(upgraded.metadata.release, "2");
  assert.equal(upgraded.metadata.generation, "2");
  await serve(deployment, async (url, headers) => {
    const backend = await (await fetch(url + "/schema", { headers, signal: AbortSignal.timeout(hangBudget()) })).json();
    assert.equal(backend.generation, 2);
  });
  assert.deepEqual(state(database), upgraded);
});

test("local dev and run cannot reactivate source inside a deployed release", { timeout: hangBudget(1) }, async (t) => {
  const { deployment, schema, run } = fixture(t);
  run("deploy", deployment);
  await serve(deployment, async () => {}); // Creates release 1's shared-store link.
  writeFileSync(schema, source.replace("return 1", "return 2"));
  run("deploy", deployment);
  const database = join(deployment, "store.sqlite"), before = state(database);
  for (const args of [["run", "q", "--as", "alice"], ["dev", "--port", "0", "--no-watch"]]) {
    const result = spawnSync(binary, args, { cwd: join(deployment, "releases/1"), encoding: "utf8", timeout: hangBudget() });
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
// @ref LLP 3000.011.005.000#4 — password credentials and session rotation survive the same isolated recovery point.
test("stopped full-release restore preserves its recovery point and stays separate from the original", { timeout: hangBudget(25) }, async (t) => {
  const { app, deployment, schema, invoke, run } = fixture(t);
  const recoverySource = `use identity
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
    const response = await fetch(url + path, { method: "POST", headers: { ...headers, "content-type": "application/json" }, body: JSON.stringify(body), signal: AbortSignal.timeout(hangBudget()) });
    assert.equal(response.status, 200);
    return response.json();
  };
  // Keep the schedule held while identity/upload/mutation setup creates its
  // input. A slow setup must not let the job run against an empty table.
  let db = new DatabaseSync(database);
  db.prepare("INSERT INTO _meta(key, value) VALUES ('schedule:checkpointDaily', ?)").run(String(Date.now() + 86400000));
  db.close();
  const png = Buffer.from("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+aX1cAAAAASUVORK5CYII=", "base64");
  const account = { email: "recovery@example.test", password: "disposable fixture password" };
  let asset, session, originalHeaders, committed;
  await serve(deployment, async (url) => {
    session = (await post(url, {}, "/auth/signup", account)).session;
    assert.equal(session?.kind, "user");
    const headers = originalHeaders = { authorization: `Bearer ${session.token}` };
    const uploaded = await (await fetch(url + "/assets", { method: "POST", headers, body: png })).json();
    assert.ok(uploaded.asset?.id);
    asset = uploaded.asset.id;
    committed = await post(url, headers, "/m/add", { id: "before-backup", args: { body: "at backup", photo: { id: asset } } });
    assert.equal(committed.state, "sent");
  });
  // The input now exists and the server is stopped. Advance only the fixture's
  // persisted schedule clock, then let the real scheduler create/park the job.
  // No synthetic job/effect/dedup rows and no concurrent external store writer.
  db = new DatabaseSync(database);
  db.prepare("UPDATE _meta SET value = '0' WHERE key = 'schedule:checkpointDaily'").run();
  db.close();
  await serve(deployment, async () => {
    const deadline = performance.now() + hangBudget();
    while (!recoveryState(deployment).durable._jobs.some((job) => job.state === "parked") && performance.now() < deadline) await delay(25);
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
  assert.equal(before.durable._credentials.length, 1, "the password verifier belongs to the recovery point");
  assert.equal(before.durable._assets.length, 1);
  // Model a legacy deployment, including its absolute generated store link.
  const storeLink = join("releases", "1", ".snapback4", "store.sqlite");
  assert.equal(readlinkSync(join(deployment, storeLink)), "../../../store.sqlite", "new release links are relocatable");
  rmSync(join(deployment, storeLink));
  symlinkSync(database, join(deployment, storeLink));
  const backup = join(dirname(app), "backup"), restored = join(dirname(app), "restored");
  const copy = (from, to) => {
    assert.equal(existsSync(to), false, "copy into a new directory, never merge a restore");
    const copied = spawnSync("cp", ["-a", from, to], { encoding: "utf8", timeout: hangBudget() });
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
    // Recover the same account from its copied password verifier, then rotate
    // that new session. Do not log bearer values or reuse an old device outbox.
    const recovered = (await post(url, {}, "/auth/login", account)).session;
    assert.equal(recovered?.principal, session.principal);
    assert.notEqual(recovered.token, session.token);
    const recoveredHeaders = { authorization: `Bearer ${recovered.token}` };
    const rotated = (await post(url, recoveredHeaders, "/auth/refresh", {})).session;
    assert.equal(rotated?.principal, session.principal);
    assert.notEqual(rotated.token, recovered.token);
    assert.equal((await fetch(url + "/schema", { headers: recoveredHeaders })).status, 401, "rotation revokes the exchanged bearer");
    // A fresh real process device acquires this recovery point: no old
    // watermarks or pending outbox are attached to the restored endpoint.
    const deviceDir = join(dirname(app), "fresh-restored-device"); mkdirSync(deviceDir);
    const deviceChildren = [];
    const client = await createLocalClient({ url, session: rotated, waitSeconds: 1,
      device: processDevice({ binary, dir: deviceDir,
        spawn: (cmd, args) => {
          const child = spawn(cmd, args, { stdio: ["pipe", "pipe", "inherit"] });
          deviceChildren.push(child); return child;
        },
        writeFile: async (path, text) => writeFileSync(path, text) }),
    });
    await withCleanup(async () => {
      await client.sync();
      const local = await client.query({ kind: "query", name: "q" }, {});
      assert.equal(local.complete, true);
      assert.deepEqual(local.data.map((row) => row.body), ["at backup"]);
    }, async () => {
      try {
        await cleanup(() => client.close(), 'restored client close', () => JSON.stringify(deviceChildren.map(child => ({
          pid: child.pid, exitCode: child.exitCode, signalCode: child.signalCode,
        }))), deviceChildren);
      } finally {
        for (const child of deviceChildren) if (child.exitCode == null && child.signalCode == null) child.kill('SIGKILL');
      }
    });
  });
  assert.deepEqual(recoveryState(deployment), originalAfter, "restored serving and authentication must not touch the original");
  const restoredBeforeActivation = recoveryState(restored);
  assert.deepEqual(restoredBeforeActivation.durable._jobs, before.durable._jobs);
  assert.deepEqual(restoredBeforeActivation.durable._outbox, before.durable._outbox);
  assert.deepEqual(recoveryState(backup), before, "the backup itself is never served or modified");
  // Reuse the existing activation verbs at the recovered location: widening
  // is permitted; narrowing retains rows; rollback changes source,
  // while rows written after the backup remain rows of the recovered store.
  writeFileSync(schema, recoverySource.replaceAll("text <=100", "text <=200"));
  run("deploy", restored);
  await serve(restored, async (url) => {
    assert.equal((await post(url, originalHeaders, "/m/add", { id: "restored-new", args: { body: "restored only" } })).state, "sent");
  });
  writeFileSync(schema, recoverySource.replaceAll("text <=100", "text <=4"));
  run("deploy", restored);
  assert.equal(state(join(restored,"store.sqlite")).rows.length,0);
  run("rollback", restored,"--to","1");
  assert.equal(state(join(restored, "store.sqlite")).metadata.release, "1");
  assert.equal(state(join(restored, "store.sqlite")).metadata.generation, "4");
  await serve(restored, async (url) => {
    const rows = await post(url, originalHeaders, "/q/q", { args: {} });
    assert.deepEqual(rows.data.map((row) => row.body).sort(), ["at backup", "restored only"]);
  });
  assert.deepEqual(recoveryState(deployment), originalAfter);
  t.diagnostic(`recovery point: release ${before.metadata.release}, generation ${before.metadata.generation}, sequence ${committed.seq}; password login and rotation passed; fresh process device only; post-backup original writes excluded; queued effects never delivered; process/stopped-copy recovery, WAL synchronous=NORMAL, no power-loss claim`);
});

// @ref LLP 3000.011.005.000#4 — real schedule admission is durable before any chunk, across a killed serving process.
test("a queued scheduled job survives serving process death and runs once after restart", { timeout: hangBudget(12) }, async (t) => {
  const { deployment, schema, run } = fixture(t);
  writeFileSync(schema, `use identity guests
effect notify
table items:
  runs: int
  read <- allow
  insert <- allow
  update <- deny
  sync public
mutation add():
  return insert items {runs: 0}
query q():
  return items first 10 by byId
job resume():
  chunk item in items first 1 by byId:
    update items[item.id] {runs: item.runs + 1}
    emit notify {id: item.id}
schedule resumeDaily every 1d: resume
`);
  run("deploy", deployment);
  await serve(deployment, async (url, headers) => {
    const result = await (await fetch(url + "/m/add", { method: "POST", headers: { ...headers, "content-type": "application/json" }, body: '{"args":{}}' })).json();
    assert.equal(result.state, "sent");
  });
  const database = join(deployment, "store.sqlite");
  const jobs = () => {
    const db = new DatabaseSync(database, { readOnly: true });
    try { return db.prepare("SELECT id, state, chunks, rows_written FROM _jobs ORDER BY id").all().map(row => ({ ...row })); }
    finally { db.close(); }
  };
  // Only the schedule clock is fixture setup. The serving host itself admits
  // the job; no synthetic _jobs row or altered continuation state is used.
  const db = new DatabaseSync(database);
  db.prepare("UPDATE _meta SET value = '0' WHERE key = 'schedule:resumeDaily'").run();
  db.close();
  // The explicit worker's synchronous Node-version probe follows schedule
  // admission and precedes maintenance startup. Stop its parent BEFORE the
  // probe completes, so no chunk can race either the signal or our inspection.
  // The worker itself must never start; restarts below use ordinary serve.
  const probe = join(deployment, "stop-before-maintenance");
  const worker = join(deployment, "unused-worker.mjs");
  writeFileSync(probe, `#!${process.execPath}\nprocess.kill(process.ppid, 'SIGSTOP');\nconsole.log(process.version);\n`);
  chmodSync(probe, 0o700);
  writeFileSync(worker, "throw new Error('crash fixture must stop before worker startup');\n");
  const child = spawn(binary, ["serve", deployment, "--port", "0", "--bind", "127.0.0.1", "--worker", worker], {
    env: { ...process.env, SNAPBACK_NODE: probe }, stdio: ["ignore", "pipe", "pipe"],
  });
  const exited = once(child, "exit");
  let log = "";
  child.stdout.on("data", data => { log += data; });
  child.stderr.on("data", data => { log += data; });
  let queued;
  await withCleanup(async () => {
    await waitFor(() => {
      assert.equal(child.exitCode, null, log);
      assert.equal(child.signalCode, null, log);
      const status = spawnSync("ps", ["-p", String(child.pid), "-o", "stat="], { encoding: "utf8", timeout: hangBudget() });
      assert.equal(status.status, 0, status.error?.message ?? status.stderr);
      return /^T/.test(status.stdout.trim());
    }, "owned serving process stopped inside startup probe", { diagnostics: () => log });
    const admitted = jobs();
    assert.equal(admitted.length, 1);
    [queued] = admitted;
    assert.equal(queued.state, "queued", "the crash cut must precede the first chunk");
    assert.equal(queued.chunks, 0);
    assert.equal(queued.rows_written, 0);
    child.kill("SIGKILL");
    assert.deepEqual(await exited, [null, "SIGKILL"]);
  }, async () => {
    if (child.exitCode == null && child.signalCode == null) child.kill("SIGKILL");
    await cleanup(() => exited, `crashed release server ${child.pid}`, () => log, [child]);
  });
  assert.deepEqual(jobs(), [queued], "after witnessed SIGKILL and before any restart, the admitted job is unchanged");
  await serve(deployment, async (url, headers) => {
    const deadline = performance.now() + hangBudget();
    while (jobs()[0]?.state !== "done" && performance.now() < deadline) await delay(20);
    assert.deepEqual(jobs(), [{ id: queued.id, state: "done", chunks: 1, rows_written: 1 }]);
    const rows = await (await fetch(url + "/q/q", { method: "POST", headers: { ...headers, "content-type": "application/json" }, body: '{"args":{}}' })).json();
    assert.deepEqual(rows.data.map(row => row.runs), [1]);
  });
  await serve(deployment, async () => { await delay(1100); });
  assert.deepEqual(jobs(), [{ id: queued.id, state: "done", chunks: 1, rows_written: 1 }], "a second restart cannot re-admit the same schedule boundary");
  const read = new DatabaseSync(database, { readOnly: true });
  try {
    const effects = read.prepare("SELECT state FROM _outbox").all().map(row => ({ ...row }));
    assert.deepEqual(effects, [{ state: "queued" }]);
  } finally { read.close(); }
  t.diagnostic("owned serve SIGKILL after durable schedule admission, before first chunk; same job id resumed once; one queued effect; no external worker; WAL synchronous=NORMAL, no power-loss claim");
});

test("release serving repairs dangling legacy links and refuses an unexpected regular store file", { timeout: hangBudget(2) }, async (t) => {
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

for (const authority of ["owner", "failed branch", "second witness", "multiple witnesses", "correlated branches"]) {
  test(`release nextExpiry excludes irrelevant hidden grants: ${authority}`, { timeout: hangBudget(6) }, async t => {
    const { deployment, schema, run } = fixture(t);
    const witness = authority === "multiple witnesses"
      ? "(exists grants[parent = .parent, who = viewer, slot = 0, kind = 'admin'] or exists grants[parent = .parent, who = viewer, slot = 1, kind = 'admin'])"
      : "exists grants[parent = .parent, who = viewer, kind = 'admin']";
    const rule = authority === "owner" ? `${witness} or .owner = viewer`
      : authority === "failed branch" ? `(${witness} and .owner != viewer) or .owner = viewer`
      : authority === "multiple witnesses" ? witness
      : authority === "correlated branches" ? `${witness} or not ${witness}`
      : `${witness} or exists otherGrants[parent = .parent, who = viewer]`;
    writeFileSync(schema, `use identity guests
table parents:
  public
  online only
table grants:
  parent: parents
  who: principal
  kind: text <=20
  until: time ?
  expire at .until
  ${authority === "multiple witnesses" ? "slot: int default 0\n  unique parent, who, slot" : "unique parent, who"}
  read <- deny
  insert <- allow
  update <- allow
  online only
table otherGrants:
  parent: parents
  who: principal
  until: time ?
  expire at .until
  unique parent, who
  read <- deny
  insert <- allow
  online only
table messages:
  parent: parents
  owner: principal default viewer
  ordinal: sequence by parent
  read <- ${rule}
  insert <- allow
  online only
mutation prepare(until: time, stable: time):
  insert grants { id: 'hidden', parent: 'p', who: viewer, kind: 'guest', until }
  insert otherGrants { id: 'stable', parent: 'p', who: viewer, until: stable }
  ${authority === "multiple witnesses" ? "insert grants { id: 'later', parent: 'p', who: viewer, slot: 1, kind: 'admin', until: stable }" : ""}
  insert messages { id: 'own', parent: 'p' }
mutation change(until: time, kind: text <=20):
  update grants['hidden'] { until, kind }
query one():
  return messages['own']
query page():
  return messages where .parent = 'p' first 2 by .ordinal
query reverse():
  return messages where .parent = 'p' last 2 by .ordinal
`);
    run("deploy", deployment);
    await serve(deployment, async (url, headers) => {
      const post = async (path, args) => (await fetch(url + path, { method: "POST", headers, body: JSON.stringify({ args }) })).json();
      const early = Date.now() + 3600000, stable = early + 28800000;
      assert.equal((await post("/m/prepare", { until: early, stable })).state, "sent");
      const before = await Promise.all(["one", "page", "reverse"].map(name => post(`/q/${name}`, {})));
      for (const kind of ["guest", "admin"]) {
        assert.equal((await post("/m/change", { until: early + 3600000, kind })).state, "sent");
        const after = await Promise.all(["one", "page", "reverse"].map(name => post(`/q/${name}`, {})));
        for (let n = 0; n < after.length; n++) {
          assert.equal(after[n].denied, undefined);
          assert.equal(after[n].meter, undefined, "exercise the release response, without dev meters");
          assert.equal(after[n].nextExpiry, ["second witness", "multiple witnesses"].includes(authority) ? stable : null);
          const { seq: priorSeq, ...prior } = before[n];
          const { seq: laterSeq, ...later } = after[n];
          assert.deepEqual(later, prior, "only the public mutation's commit sequence changes");
        }
      }
    });
  });
}

async function releasePost(url, headers, path, args = {}, id) {
  const response = await fetch(url + path, { method: 'POST', headers: { ...headers, 'content-type': 'application/json' }, body: JSON.stringify({ args, ...(id ? { id } : {}) }), signal: AbortSignal.timeout(hangBudget()) });
  const value = await response.json();
  if (path.startsWith('/m/')) assert.equal(value.state, 'sent', JSON.stringify(value));
  return value;
}
async function invokeAsync(app, ...args) {
  const child = spawn(binary, args, { cwd: app, stdio: ['ignore', 'pipe', 'pipe'], env: { ...process.env, CARGO_INCREMENTAL: '0', CARGO_PROFILE_DEV_DEBUG: '0', CARGO_PROFILE_TEST_DEBUG: '0' } });
  let stdout = '', stderr = '';
  child.stdout.on('data', data => { stdout += data; });
  child.stderr.on('data', data => { stderr += data; });
  const [status] = await once(child, 'exit');
  return { status, stdout, stderr };
}
function localReleaseDevice(dir, children, capture) {
  const opener = processDevice({ binary, dir, spawn: (cmd, args) => {
    const child = spawn(cmd, args, { stdio: ['pipe', 'pipe', 'inherit'] }); children.push(child); return child;
  }, writeFile: async (path, text) => writeFileSync(path, text) });
  return { async open(...args) { const core = await opener.open(...args); capture?.(core); return core; } };
}
async function closeReleaseClient(client, children) {
  try { await cleanup(() => client.close(), 'release client close', () => JSON.stringify(children.map(c => ({ pid: c.pid, exitCode: c.exitCode, signalCode: c.signalCode }))), children); }
  finally { for (const child of children) if (child.exitCode === null && child.signalCode === null) child.kill('SIGKILL'); }
}

test('hot additive rollback and forward preserve dormant data, old writes and a connected client', { timeout: hangBudget(15) }, async t => {
  const { app, deployment, schema, invoke, run } = fixture(t);
  const first = source.replace('  read <- allow', '  read <- allow\n  update <- allow\n  delete <- allow').replace('  body: text', "  status: enum('active') default 'active'\n  body: text") + `
query all():
  return items[] first 20 by byId
mutation edit(item: items, body: text <=100):
  update items[item] {body}
mutation remove(item: items):
  delete items[item]
`;
  const second = first.replace('  body: text', '  extra: int default 7\n  by byExtra: extra, id\n  body: text').replace("enum('active')", "enum('active', 'new')").replace('return 1', 'return 2') + `
table extraRows:
  n: int
  read <- allow
  insert <- allow
  sync public
mutation setExtra(item: items, extra: int):
  update items[item] {extra}
mutation newStatus(item: items):
  update items[item] {status: 'new'}
mutation repairStatus(item: items):
  update items[item] {status: 'active'}
mutation addExtra(n: int):
  return insert extraRows {n}
query extras():
  return extraRows[] first 20 by byId
`;
  writeFileSync(schema, first); run('deploy', deployment);
  await serve(deployment, async (url, headers, session) => {
    const added = await releasePost(url, headers, '/m/add', {}, 'v1-add'); assert.equal(added.state, 'sent'); const id = added.result.id;
    const removed = await releasePost(url, headers, '/m/add', {}, 'v1-remove'); const gone = removed.result.id;
    const deviceDir = join(dirname(app), 'lifecycle-device'); mkdirSync(deviceDir);
    const children = [];
    const client = await createLocalClient({ url, session, waitSeconds: 1, device: localReleaseDevice(deviceDir, children) });
    await withCleanup(async () => {
      await client.sync(); assert.equal((await client.query({ kind: 'query', name: 'all' }, {})).data.length, 2);
      writeFileSync(schema, second);
      let stop = false, observations = [];
      const traffic = (async () => { while (!stop) { const value = await releasePost(url, headers, '/q/q'); if (!value.denied) observations.push([value.generation, value.data]); } })();
      try { const deployed = await invokeAsync(app, 'deploy', deployment); assert.equal(deployed.status, 0, deployed.stderr); }
      finally { stop = true; await traffic; }
      assert.ok(observations.length > 0); assert.ok(observations.every(([g, v]) => (g === 1 && v === 1) || (g === 2 && v === 2)), JSON.stringify(observations));
      assert.equal((await releasePost(url, headers, '/m/setExtra', { item: id, extra: 42 }, 'v2-extra')).state, 'sent');
      assert.equal((await releasePost(url, headers, '/m/addExtra', { n: 45 }, 'v2-row')).state, 'sent');
      await client.sync(); let local = await client.query({ kind: 'query', name: 'all' }, {}); assert.equal(local.data.find(row => row.id === id).extra, 42);
      const oldGeneration = JSON.parse(run('releases', deployment)).generation;
      await releasePost(url, headers, '/m/newStatus', { item: id }, 'v2-new-status');
      run('rollback', deployment); await client.sync();
      assert.ok((await client.query({kind:'query',name:'all'},{})).data.every(row=>row.id!==id));
      run('rollback',deployment,'--to','2'); await client.sync();
      assert.equal((await client.query({kind:'query',name:'all'},{})).data.find(row=>row.id===id).status,'new');
      await releasePost(url, headers, '/m/repairStatus', { item: id }, 'v2-repair');
      run('rollback', deployment);
      const current = JSON.parse(run('releases', deployment)); assert.equal(current.release, 1); assert.equal(current.generation, oldGeneration + 3);
      const stale = await (await fetch(url + '/sync', { method: 'POST', headers: {...headers,'x-snapback-device':JSON.stringify(await processDevice({binary,dir:process.cwd()}).engineInfo())}, body: JSON.stringify({ generation: oldGeneration, from: 0, limit: 100, after: null, stream: false, pending: [] }) })).json(); assert.equal(stale.denied.code, 'E_SYNC_GENERATION');
      await client.sync(); local = await client.query({ kind: 'query', name: 'all' }, {}); assert.ok(local.data.every(row => !Object.hasOwn(row, 'extra')));
      assert.equal((await releasePost(url, headers, '/m/edit', { item: id, body: 'old write' }, 'v1-edit')).state, 'sent');
      assert.equal((await releasePost(url, headers, '/m/remove', { item: gone }, 'v1-delete')).state, 'sent');
      const newRow = await releasePost(url, headers, '/m/add', {}, 'v1-new'); assert.equal(newRow.state, 'sent');
      // A new-source deployment must explicitly select retained name reuse.
      const unselected = invoke('deploy', deployment); assert.equal(unselected.status, 1); assert.match(unselected.stderr, /--restore-dormant/);
      run('rollback', deployment, '--to', '2');
      await client.sync(); local = await client.query({ kind: 'query', name: 'all' }, {});
      assert.equal(local.data.find(row => row.id === id).extra, 42); assert.equal(local.data.find(row => row.id === id).body, 'old write');
      assert.equal(local.data.find(row => row.id === newRow.result.id).extra, 7); assert.ok(local.data.every(row => row.id !== gone));
      assert.deepEqual((await releasePost(url, headers, '/q/extras')).data.map(row => row.n), [45]);
      // Failed hot narrowing leaves this generation and the connected client usable.
      writeFileSync(schema, second.replace('  body: text', '  mustBackfill: int\n  body: text').replace("{body: 'kept'}","{body: 'kept', mustBackfill: 1}"));
      const before = JSON.parse(run('releases', deployment)); const failed = await invokeAsync(app, 'deploy', deployment); assert.equal(failed.status, 1); assert.match(failed.stderr, /E_ADOPT/);
      const after = JSON.parse(run('releases', deployment)); assert.equal(after.release, before.release); assert.equal(after.generation, before.generation); assert.equal(after.revision, before.revision);
      assert.equal((await releasePost(url, headers, '/q/all')).data.find(row => row.id === id).extra, 42);
      run('rollback', deployment, '--to', '1');
      const preview = run('prune', deployment); assert.match(preview, /extraRows/); assert.match(preview, /preview only/);
      const pruned = run('prune', deployment, '--allow-destructive'); assert.match(pruned, /"pruned": true/);
      run('rollback', deployment, '--to', '2'); await client.sync();
      assert.equal((await client.query({ kind: 'query', name: 'all' }, {})).data.find(row => row.id === id).extra, 7);
      assert.deepEqual((await releasePost(url, headers, '/q/extras')).data, []);
    }, () => closeReleaseClient(client, children));
  });
});

test('native-only hot activation advances generation and refreshes an already connected device', { timeout: hangBudget(25) }, async t => {
  const { app, deployment, schema, run } = fixture(t);
  writeFileSync(schema, source + '\nquery nativeRead(): native\n');
  const native = join(app, 'snapback/native'); mkdirSync(join(native, 'src'), { recursive: true });
  writeFileSync(join(native, 'Cargo.toml'), `[package]\nname="sb4-roll-native"\nversion="0.0.0"\nedition="2024"\n[lib]\ncrate-type=["cdylib"]\n[dependencies]\nsnapback4-native={path=${JSON.stringify(join(root, 'crates/snapback4-native'))}}\n[workspace]\n[profile.release]\nopt-level="z"\nlto=true\ncodegen-units=1\npanic="abort"\nstrip=true\n`);
  const code = value => `use snapback4_native::{Ctx,Json,Result,json};\nsnapback4_native::module!{reads:[nativeRead]}\n#[allow(non_snake_case)]\nfn nativeRead(_ctx:&Ctx,_args:&Json)->Result<Json>{Ok(json!("${value}"))}\n`;
  writeFileSync(join(native, 'src/lib.rs'), code('A'));
  const initial = await invokeAsync(app, 'deploy', deployment); assert.equal(initial.status, 0, initial.stderr);
  await serve(deployment, async (url, headers, session) => {
    const backendA = await (await fetch(url + '/schema', { headers })).json();
    const bytesA = Buffer.from(await (await fetch(url + '/native.wasm', { headers })).arrayBuffer());
    const deviceDir = join(dirname(app), 'native-generation-device'); mkdirSync(deviceDir); const children = []; let core;
    const client = await createLocalClient({ url, session, waitSeconds: 1, device: localReleaseDevice(deviceDir, children, value => { core = value; }) });
    await withCleanup(async () => {
      await client.sync(); assert.equal((await client.query({ kind: 'query', name: 'nativeRead' }, {})).data, 'A');
      writeFileSync(join(native, 'src/lib.rs'), code('B'));
      const deployed = await invokeAsync(app, 'deploy', deployment); assert.equal(deployed.status, 0, deployed.stderr);
      const backendB = await (await fetch(url + '/schema', { headers })).json(); assert.equal(backendB.generation, backendA.generation + 1); assert.notEqual(backendB.native.digest, backendA.native.digest);
      assert.deepEqual(backendB.programs, backendA.programs, 'Quarry declarations did not change');
      await client.sync(); assert.equal((await client.query({ kind: 'query', name: 'nativeRead' }, {})).data, 'B');
      assert.equal((await releasePost(url, headers, '/q/nativeRead')).data, 'B');
      const late = await core.call({ op: 'install_native', wasm: bytesA.toString('hex'), digest: backendA.native.digest, generation: backendA.generation });
      assert.equal(late.denied.code, 'E_GENERATION'); assert.equal((await client.query({ kind: 'query', name: 'nativeRead' }, {})).data, 'B');
      run('rollback', deployment); await client.sync(); assert.equal((await client.query({ kind: 'query', name: 'nativeRead' }, {})).data, 'A');
    }, () => closeReleaseClient(client, children));
  });
});


test('hot release replaces, adds and retires named workers without restarting serve', { timeout: hangBudget(12) }, async t => {
  const { app, deployment, run } = fixture(t);
  const workers=join(app,'snapback/workers');mkdirSync(workers,{recursive:true});
  const worker=marker=>`console.log('${marker}');setInterval(() => {}, 1000);\n`;
  writeFileSync(join(workers,'alpha.mjs'),worker('ROLL_ALPHA_V1'));
  run('deploy',deployment);
  const statuses=()=>{const db=new DatabaseSync(join(deployment,'store.sqlite'),{readOnly:true});try{return Object.fromEntries(db.prepare("SELECT key,value FROM _meta WHERE key LIKE 'worker:status:%'").all().map(r=>[r.key,JSON.parse(r.value)]));}finally{db.close();}};
  await serve(deployment,async(_url,_headers,_session,logs)=>{
    await waitFor(()=>logs().includes('ROLL_ALPHA_V1'),'first named worker starts',{diagnostics:logs});
    const first=statuses()['worker:status:alpha'].pid;
    const before=JSON.parse(run('releases',deployment));
    writeFileSync(join(workers,'alpha.mjs'),"// snapback4 secrets: NOT_DECLARED\n"+worker('ROLL_BAD_SECRET'));
    const failure=spawnSync(binary,['deploy',deployment],{cwd:app,encoding:'utf8',timeout:hangBudget()});
    assert.equal(failure.status,1);assert.match(failure.stderr,/alpha.*NOT_DECLARED|NOT_DECLARED/);
    const unchanged=JSON.parse(run('releases',deployment));
    for (const field of ['release','revision','generation'])assert.equal(unchanged[field],before[field]);
    assert.equal(statuses()['worker:status:alpha'].pid,first);assert.equal(logs().includes('ROLL_BAD_SECRET'),false);

    writeFileSync(join(workers,'alpha.mjs'),worker('ROLL_ALPHA_V2'));
    writeFileSync(join(workers,'beta.mjs'),worker('ROLL_BETA_V2'));
    run('deploy',deployment);
    await waitFor(()=>logs().includes('ROLL_ALPHA_V2')&&logs().includes('ROLL_BETA_V2'),'replacement and added worker start',{diagnostics:logs});
    assert.notEqual(statuses()['worker:status:alpha'].pid,first);
    rmSync(join(workers,'alpha.mjs'));writeFileSync(join(workers,'beta.mjs'),worker('ROLL_BETA_V3'));
    run('deploy',deployment);
    await waitFor(()=>logs().includes('ROLL_BETA_V3')&&statuses()['worker:status:alpha']?.state==='stopped','removed worker retires and remaining worker restarts',{diagnostics:()=>logs()+JSON.stringify(statuses())});
    const history=JSON.parse(run('releases',deployment));assert.equal(history.release,4);
    assert.equal(history.workers.find(([key])=>key==='worker:status:beta')[1].includes('running'),true);
  });
});


test('an unserved release cannot create a shadow development store', { timeout: hangBudget(3) }, t => {
  const { deployment, run }=fixture(t);run('deploy',deployment);
  const release=join(deployment,'releases/1');
  assert.equal(readlinkSync(join(release,'.snapback4/store.sqlite')),'../../../store.sqlite');
  for (const args of [['run','q'],['dev','--port','0']]) {
    const result=spawnSync(binary,args,{cwd:release,encoding:'utf8',timeout:hangBudget()});
    assert.notEqual(result.status,0,`${result.stdout}\n${result.stderr}`);assert.match(result.stderr,/belongs to a deployment/);
  }
});

test('owned serve death before hot commit and after commit recovers database authority', { timeout: hangBudget(12) }, async t => {
  const { app, deployment, schema, run, invoke }=fixture(t);run('deploy',deployment);
  await serve(deployment,async(url,headers,_session,_logs,child)=>{
    const written=await(await fetch(url+'/m/add',{method:'POST',headers,body:JSON.stringify({id:'before-crash',args:{}})})).json();assert.equal(written.state,'sent');
    writeFileSync(schema,source.replace('return 1','return 2'));
    const db=new DatabaseSync(join(deployment,'store.sqlite'));db.exec('PRAGMA busy_timeout=5000; BEGIN IMMEDIATE');
    const pending=invokeAsync(app,'deploy',deployment);
    try {
      await waitFor(()=>existsSync(join(deployment,`.current-${child.pid}-2`)),'hot command prepared before blocked transaction');
      const exit=once(child,'exit');child.kill('SIGKILL');await exit;
    } finally {db.exec('ROLLBACK');db.close();}
    const failed=await pending;assert.equal(failed.status,1);assert.match(failed.stderr,/unknown|inspect/);
    assert.equal(state(join(deployment,'store.sqlite')).metadata.release,'1');
  });
  await serve(deployment,async(url,headers,_session,_logs,child)=>{
    const before=await(await fetch(url+'/q/q',{method:'POST',headers,body:'{"args":{}}'})).json();assert.equal(before.data,1);
    assert.equal(invoke('rollback',deployment,'--to','2').status,1,'precommit killed candidate cannot be selected');
    run('deploy',deployment);
    assert.equal(state(join(deployment,'store.sqlite')).metadata.release,'3');
    const exit=once(child,'exit');child.kill('SIGKILL');await exit;
    writeFileSync(join(deployment,'current'),'1\n');
  });
  await serve(deployment,async(url,headers)=>{
    const after=await(await fetch(url+'/q/q',{method:'POST',headers,body:'{"args":{}}'})).json();assert.equal(after.data,2);
    const rows=state(join(deployment,'store.sqlite')).rows;assert.equal(rows.length,1);assert.match(rows[0].data,/kept/);
  });
});

test('REL identical source is a no-op; latest and exact previews never activate', {timeout:hangBudget(3)}, async(t)=>{
  const {deployment,schema,run}=fixture(t);
  assert.match(run('rollback','--help'),/dormant per row/);
  const first=run('deploy',deployment);assert.match(first,/release 1 is current as generation 1/);
  assert.equal(first.trim().split('\n').length,1);
  const before=JSON.parse(run('releases',deployment));
  assert.match(run('deploy',deployment),/unchanged; release 1 stays current/);
  assert.deepEqual(JSON.parse(run('releases',deployment)),before);
  writeFileSync(schema,source.replace('return 1','return 2'));
  run('deploy',deployment);
  await serve(deployment,async(url,headers)=>{
    const saved=state(join(deployment,'store.sqlite'));
    assert.match(run('rollback',deployment,'--to','1','--check'),/preview: release 1 would be current/);
    assert.match(run('check','--store',join(deployment,'store.sqlite'),'--release','1'),/live release unchanged/);
    assert.deepEqual(state(join(deployment,'store.sqlite')),saved);
    assert.equal((await releasePost(url,headers,'/q/q')).data,2);
    assert.match(run('rollback',deployment,'--to','1'),/release 1 is current as generation 3/);
    const status=JSON.parse(run('releases',deployment));assert.equal(status.release,1);assert.equal(status.latest,2);
    const selected=JSON.parse(run('releases',deployment,'latest'));assert.equal(selected.release,1);assert.equal(selected.selected.release,2);assert.equal(selected.selected.current,false);assert.equal(typeof selected.selected.digest,'string');
    assert.equal(JSON.parse(run('releases',deployment,'1')).selected.current,true);
    assert.match(run('rollback',deployment,'--to','latest'),/release 2 is current as generation 4/);
    assert.equal((await releasePost(url,headers,'/q/q')).data,2);
  });
});

test('REL 16 concurrent callers remain request-safe over six hot switch pairs', {timeout:hangBudget(4)}, async(t)=>{
  const {app,deployment,schema,run}=fixture(t);
  const v1=source+`mutation echo(v: enum('old')):\n  return v\n`;
  const v2=v1.replace('return 1','return 2').replace("enum('old')","enum('old','new')")+`query newOnly():\n  return 9\nmutation newMutation():\n  return 9\n`;
  writeFileSync(schema,v1);run('deploy',deployment);
  writeFileSync(schema,v2);run('deploy',deployment);run('rollback',deployment,'--to','1');
  await serve(deployment,async(url,headers)=>{
    let stopped=false,replies=0;
    const callers=Array.from({length:16},(_,lane)=>(async()=>{
      for(let n=0;!stopped || n<12;n++) {
        const route=n%4===0?'/q/q':n%4===1?'/q/newOnly':n%4===2?'/m/newMutation':'/m/echo';
        const response=await fetch(url+route,{method:'POST',headers:{...headers,'content-type':'application/json'},body:JSON.stringify({args:route==='/m/echo'?{v:'new'}:{},...(route.startsWith('/m/')?{id:`stress-${lane}-${n}`}:{})}),signal:AbortSignal.timeout(hangBudget())});
        const body=await response.json();replies++;
        assert.notEqual(response.status,500,JSON.stringify(body));
        assert.equal(body.loading,undefined,JSON.stringify(body));
        assert.ok(Number.isSafeInteger(body.generation),JSON.stringify(body));
        assert.equal(Number(response.headers.get('x-snapback-generation')),body.generation);
        assert.notEqual(body.denied?.code,'E_GENERATION');assert.notEqual(body.why?.code,'E_GENERATION');
        if(route==='/q/q') {assert.equal(response.status,200);assert.equal(body.data,body.generation%2===1?1:2);}
        if(body.denied?.code==='E_OP') {assert.equal(response.status,404);assert.equal(body.state,undefined);}
        if(route==='/m/echo' && body.generation%2===1) {assert.equal(response.status,200);assert.equal(body.state,'failed');assert.equal(body.why?.code,'E_INPUT');assert.equal(body.denied,undefined);}
        if(body.why?.code==='E_INPUT') {assert.equal(response.status,200);assert.equal(body.state,'failed');}
      }
    })());
    try {
      for(let pair=0;pair<6;pair++) {
        for(const release of ['2','1']) {
          const switched=await invokeAsync(app,'rollback',deployment,'--to',release);
          assert.equal(switched.status,0,switched.stderr);assert.match(switched.stdout,/is current as generation/);
          const reply=await releasePost(url,headers,'/q/q');assert.equal(reply.data,Number(release));
        }
      }
    } finally {stopped=true;await Promise.all(callers);}
    assert.ok(replies>=192,`only ${replies} stress replies`);
    t.diagnostic(`${replies} HTTP replies across 12 hot activations`);
  });
});


test('REL mutation decoding and many-item previews report complete plans', {timeout:hangBudget(3)}, async(t)=>{
  const {deployment,schema,run}=fixture(t);
  const first=(source.replace('  read <- allow','  read <- allow\n  update <- allow').replace('  body: text',"  status: enum('old') default 'old'\n  body: text")+`mutation echo(v: enum('old')):
  return v
query input(n: int):
  return n
`).replaceAll('items','values');
  writeFileSync(schema,first);run('deploy',deployment);
  const columns=Array.from({length:20},(_,n)=>`  spare${n}: bool default false`).join('\n');
  const second=first.replace('  body: text',columns+'\n  body: text').replaceAll("enum('old')","enum('old','new')")+`mutation setStatus(item: values):
  update values[item] {status:'new'}
`;
  writeFileSync(schema,second);run('deploy',deployment);
  await serve(deployment,async(url,headers)=>{
    for(const args of [{},[],{n:'bad'}]) {
      const response=await fetch(url+'/q/input',{method:'POST',headers:{...headers,'content-type':'application/json'},body:JSON.stringify({args})});
      const reply=await response.json();assert.equal(response.status,400,JSON.stringify(reply));assert.equal(reply.denied.code,'E_INPUT');
      assert.equal(reply.generation,2);assert.equal(Number(response.headers.get('x-snapback-generation')),2);
    }
    const added=await releasePost(url,headers,'/m/add',{},'large-plan-add');assert.equal(added.state,'sent');
    assert.equal((await releasePost(url,headers,'/m/setStatus',{item:added.result.id},'narrow-held')).state,'sent');
    const required=second.replace('  body: text','  mustBackfill: int\n  body: text').replace("{body: 'kept'}","{body: 'kept', mustBackfill: 1}");
    writeFileSync(schema,required);
    const failure=spawnSync(binary,['deploy',deployment],{cwd:dirname(dirname(schema)),encoding:'utf8',timeout:hangBudget()});
    assert.equal(failure.status,1);assert.match(failure.stderr,/E_ADOPT/);
    const inspect=failure.stderr.match(/inspect: snapback4 sql "([^"]+)"/);assert.ok(inspect,failure.stderr);
    run('sql',inspect[1],'--release',deployment,'--json');
    const saved=state(join(deployment,'store.sqlite'));
    const plan=run('rollback',deployment,'--to','1','--check');
    assert.match(plan,/1 row, 0 cells, 0 index entries dormant/);assert.match(plan,/rows:values/);
    for(const flags of [[],['--verbose']]) {
      const structured=JSON.parse(run('rollback',deployment,'--to','1','--check','--json',...flags));
      assert.equal(structured.preview,true);assert.ok(structured.steps.length>0);
      assert.equal(structured.plan.generation,3);
      assert.ok(structured.plan.items.some(item=>item.key==='rows:values' && item.rows===1));
    }
    const checked=JSON.parse(run('check','--store',join(deployment,'store.sqlite'),'--release','1','--json'));
    assert.equal(checked.preview,true);assert.ok(checked.steps.length>0);
    assert.deepEqual(state(join(deployment,'store.sqlite')),saved);
    run('rollback',deployment,'--to','1');
    for(const args of [{v:'new'},{v:7},{v:'old',extra:true}]) {
      const response=await fetch(url+'/m/echo',{method:'POST',headers:{...headers,'content-type':'application/json'},body:JSON.stringify({id:'decode-'+JSON.stringify(args),args})});
      const reply=await response.json();assert.equal(response.status,200);assert.equal(reply.state,'failed');assert.equal(reply.why.code,'E_INPUT');assert.equal(reply.denied,undefined);assert.equal(reply.generation,3);
    }
  });
});


test('REL minimum-text widening warns in both deploy and rollback directions', {timeout:hangBudget(2)}, (t)=>{
  const {deployment,schema,invoke,run}=fixture(t);
  const code=(min)=>`table codes:
  code: text ${min}..12
  public
`;
  writeFileSync(schema,code(6));run('deploy',deployment);
  writeFileSync(schema,code(4));
  const widened=invoke('deploy',deployment);assert.equal(widened.status,0);assert.doesNotMatch(widened.stderr,/WARNING rollback compatibility/);
  writeFileSync(schema,code(8));run('deploy',deployment);
  const rolled=invoke('rollback',deployment,'--to','2');assert.equal(rolled.status,0);assert.doesNotMatch(rolled.stderr,/WARNING rollback compatibility/);
  const media=(bound,types)=>`table documents:
  photo: image <=${bound} ?
  files: [file <=${bound} (${types})] <=4
  public
`;
  writeFileSync(schema,media(10,"'application/pdf'"));run('deploy',deployment);
  writeFileSync(schema,media(1000,"'application/pdf','text/plain'"));
  const assets=invoke('deploy',deployment);assert.equal(assets.status,0);assert.doesNotMatch(assets.stderr,/WARNING rollback compatibility/);
  writeFileSync(schema,media(5,"'application/pdf'"));run('deploy',deployment);
  const assetRollback=invoke('rollback',deployment,'--to','5');assert.equal(assetRollback.status,0);assert.doesNotMatch(assetRollback.stderr,/WARNING rollback compatibility/);
});

test('REL2 refused deploy is unselectable and latest restores the adopted source', {timeout:hangBudget(3)}, async t=>{
  const {deployment,schema,run,invoke}=fixture(t);
  run('deploy',deployment);
  const v2=source.replace('  body: text','  extra: int default 9\n  body: text');
  writeFileSync(schema,v2);run('deploy',deployment);run('rollback',deployment,'--to','1');
  const refused=invoke('deploy',deployment);assert.equal(refused.status,1);
  assert.match(refused.stderr,/E_ADOPT: source matches latest; use `snapback4 rollback .* --to latest`/);
  assert.doesNotMatch(refused.stderr,/"sample_ids"/);
  const structured=invoke('deploy',deployment,'--json');assert.equal(structured.status,1);assert.equal(JSON.parse(structured.stdout).dormant[0].key,'column:items.extra');
  rmSync(join(deployment,'releases/3/.pending-adoption'));
  assert.equal(JSON.parse(run('releases',deployment)).latest,2);
  for(const args of [['rollback',deployment,'--to','3'],['rollback',deployment,'--to','3','--check'],['releases',deployment,'3'],['check','--store',join(deployment,'store.sqlite'),'--release','3']]) {
    const r=invoke(...args);assert.equal(r.status,1,r.stdout);assert.match(r.stderr,/did not complete adoption/);
  }
  await serve(deployment,async()=>{
    run('rollback',deployment,'--to','latest');assert.equal(state(join(deployment,'store.sqlite')).metadata.release,'2');
    run('rollback',deployment,'--to','1');
    assert.equal(invoke('deploy',deployment).status,1);
    assert.equal(JSON.parse(run('releases',deployment)).latest,2);
    run('rollback',deployment,'--to','latest');
  });
});

test('REL2 bare rollback follows active history and committed pending sources recover', {timeout:hangBudget(2)},t=>{
  const {deployment,schema,run}=fixture(t);
  run('deploy',deployment);
  writeFileSync(schema,source.replace('return 1','return 2'));run('deploy',deployment);
  writeFileSync(schema,source.replace('return 1','return 3'));run('deploy',deployment);
  run('rollback',deployment,'--to','1');run('rollback',deployment);
  assert.equal(state(join(deployment,'store.sqlite')).metadata.release,'3');
  // Models process loss after DB commit, before marker cleanup.
  writeFileSync(join(deployment,'releases/3/.pending-adoption'),'pending\n');
  assert.equal(JSON.parse(run('releases',deployment)).latest,3);
  run('rollback',deployment,'--to','3');
  // A crash-reserved directory without source is never latest.
  mkdirSync(join(deployment,'releases/99'));
  assert.equal(JSON.parse(run('releases',deployment)).latest,3);
});

test('REL2 CLI help, guide list and dry-run refusal are discoverable',t=>{
  const {run,invoke}=fixture(t);
  for(const [verb,flags] of [['deploy',['check','restore-dormant','json','verbose','allow-feed-adoption']],['rollback',['check','to','json','verbose']],['serve',['port','bind','worker','claim-waits']]]) {
    const help=run(verb,'--help');for(const flag of flags)assert.ok(help.includes('--'+flag),help);
  }
  assert.match(run('serve','--help'),/running serve adopts/);
  assert.match(run('rollback','--help'),/previously active/);
  assert.equal(run('guide','--list'),run('guide'));
  assert.match(invoke('rollback','unused','--dry-run').stderr,/preview is --check/);
});

test('REL2 deploy preview preserves live state, refuses name reuse and narrates dormancy', {timeout:hangBudget(3)},async t=>{
  const {deployment,schema,run,invoke}=fixture(t);
  const base=source+`table holds:
  item: items
  read <- allow
  insert <- allow
mutation hold(item: items):
  return insert holds {item}
job sweep():
  chunk row in items first 1 by byId:
    update items[row.id] {body: row.body}
schedule sweepEvery every 1d: sweep
`;
  const v1=base.replace('  insert <- allow\n  sync public','  insert <- allow\n  update <- allow\n  sync public');
  writeFileSync(schema,v1);run('deploy',deployment);
  await serve(deployment,async(url,headers)=>{
    const added=await releasePost(url,headers,'/m/add',{},'rel2-preview-add');
    await releasePost(url,headers,'/m/hold',{item:added.result.id},'rel2-preview-hold');
    const before=state(join(deployment,'store.sqlite'));
    writeFileSync(schema,source);
    const preview=run('deploy',deployment,'--check');
    assert.doesNotMatch(preview,/rows are lost|values are lost|engine capture.*filled/);
    assert.match(preview,/holds.*1 row dormant/);assert.match(preview,/sample ids/);
    assert.match(preview,/WARNING release 2 lacks schedule sweepEvery \(job sweep\)/);assert.match(preview,/target|release 2 lacks this table\'s behavior/);
    assert.deepEqual(state(join(deployment,'store.sqlite')),before);
    assert.equal(JSON.parse(run('releases',deployment)).latest,1);
    run('deploy',deployment);
    writeFileSync(schema,v1);
    assert.equal(invoke('deploy',deployment,'--check').status,1);
    assert.match(run('deploy',deployment,'--check','--restore-dormant'),/preview/);
  });
});

test('REL2 served job uses a full service token and served source', {timeout:hangBudget(3)},async t=>{
  const {app,deployment,schema,run}=fixture(t);
  writeFileSync(schema,source.replace('  insert <- allow','  insert <- allow\n  update <- allow')+`job sweep():
  chunk row in items first 1 by byId:
    update items[row.id] {body: 'swept'}
`);run('deploy',deployment);
  await serve(deployment,async(url,headers)=>{
    await releasePost(url,headers,'/m/add',{},'rel2-job-add');
    const read=(await(await fetch(url+'/auth/narrow',{method:'POST',headers,body:'{}'})).json()).session;assert.ok(read?.token);
    for(const h of [{},headers,{'x-snapback-persona':'alice'},{authorization:`Bearer ${read.token}`}]) {
      const response=await fetch(url+'/jobs/sweep',{method:'POST',headers:h,body:'{"args":{}}'});
      assert.ok([401,403].includes(response.status));
    }
    const token=run('token','--service','ops','--release',deployment).trim();
    writeFileSync(schema,'broken source is deliberately unused\n');
    const result=spawnSync(binary,['run','sweep','--release',deployment,'--json'],{cwd:tmpdir(),env:{...process.env,SNAPBACK4_SERVICE_TOKEN:token},encoding:'utf8',timeout:hangBudget()});
    assert.equal(result.status,0,result.stderr+result.stdout);assert.equal(JSON.parse(result.stdout).state,'done');
    const db=new DatabaseSync(join(deployment,'store.sqlite'),{readOnly:true});
    try{assert.ok(db.prepare('SELECT data FROM r').all().some(row=>row.data.includes('swept')));}finally{db.close();}
    const dev=await fetch(url+'/dev/jobs/sweep',{method:'POST',headers:{authorization:`Bearer ${token}`},body:'{}'});assert.equal(dev.status,403);
  });
});

test('REL2 stale lock is reclaimed and live conflict identifies PID URL and directory', {timeout:hangBudget(3)},async t=>{
  const {deployment,run,invoke}=fixture(t);run('deploy',deployment);
  const dead=spawn(process.execPath,['-e','process.exit(0)']);await once(dead,'exit');
  writeFileSync(join(deployment,'serve.lock'),`4400\nhttp://127.0.0.1:4400\npid ${dead.pid}\n`);
  chmodSync(join(deployment,'serve.lock'),0o600);
  const silent=invoke('rollback',deployment,'--to','1');assert.equal(silent.status,0,silent.stderr);assert.doesNotMatch(silent.stderr,/stale serve.lock|reclaimed/);
  writeFileSync(join(deployment,'serve.lock'),`4400\nhttp://127.0.0.1:4400\npid ${dead.pid}\n`);chmodSync(join(deployment,'serve.lock'),0o600);
  const reclaimed=invoke('rollback',deployment,'--to','1','--verbose');assert.equal(reclaimed.status,0,reclaimed.stderr);
  assert.match(reclaimed.stderr,new RegExp(`reclaimed stale serve.lock: dead PID ${dead.pid}`));
  await serve(deployment,async(url,_headers,_session,_log,child)=>{
    const conflict=invoke('serve',deployment,'--port','0');assert.equal(conflict.status,1);
    assert.ok(conflict.stderr.includes(url),conflict.stderr);assert.ok(conflict.stderr.includes(String(child.pid)),conflict.stderr);assert.ok(conflict.stderr.includes(deployment),conflict.stderr);
  });
});

test('REL2 old release sees E_OP, NOT_FOUND and null; forward restores exact values', {timeout:hangBudget(3)},async t=>{
  const {deployment,schema,run}=fixture(t);
  const v1=source.replace('  body: text',"  status: enum('old') default 'old'\n  body: text").replace('  insert <- allow','  insert <- allow\n  update <- allow')+`query readItem(item: items):
  return items[item]
mutation editItem(item: items):
  row = items[item]! else NOT_FOUND
  update items[row.id] {body: 'edited'}
`;
  writeFileSync(schema,v1);run('deploy',deployment);
  const v2=v1.replace("enum('old')","enum('old','new')")+`query newOnly():
  return 2
mutation makeNew(item: items):
  update items[item] {status: 'new'}
`;
  writeFileSync(schema,v2);run('deploy',deployment);
  await serve(deployment,async(url,headers)=>{
    const item=(await releasePost(url,headers,'/m/add',{},'rel2-proof-add')).result.id;
    await releasePost(url,headers,'/m/makeNew',{item},'rel2-proof-new');
    const receipt=run('rollback',deployment,'--to','1');assert.ok(receipt.includes(item),receipt);
    const absent=await fetch(url+'/q/newOnly',{method:'POST',headers,body:'{"args":{}}'});assert.equal(absent.status,404);assert.equal((await absent.json()).denied.code,'E_OP');
    const edit=await(await fetch(url+'/m/editItem',{method:'POST',headers,body:JSON.stringify({id:'rel2-proof-edit',args:{item}})})).json();
    assert.equal(edit.why.code,'NOT_FOUND');
    assert.equal((await releasePost(url,headers,'/q/readItem',{item})).data,null);
    run('rollback',deployment,'--to','latest');
    const original=(await releasePost(url,headers,'/q/readItem',{item})).data;
    assert.equal(original.status,'new');assert.equal(original.body,'kept');
  });
});

test('REL2 first deploy check creates no live store or numbered release', {timeout:hangBudget(2)},t=>{
  const {deployment,run}=fixture(t);
  assert.match(run('deploy',deployment,'--check'),/preview/);
  assert.equal(existsSync(join(deployment,'store.sqlite')),false);
  assert.equal(existsSync(join(deployment,'releases/1')),false);
});

test('NARR populated widening describes future risk without miscounting compatible rows', {timeout:hangBudget(3)},async t=>{
  const {deployment,schema,run,invoke}=fixture(t);
  const old=source.replace('  body: text <=100','  body: text 4..100');
  writeFileSync(schema,old);run('deploy',deployment);
  await serve(deployment,async(url,headers)=>{
    await releasePost(url,headers,'/m/add',{},'rel2-warning-row');
    writeFileSync(schema,source);
    const r=invoke('deploy',deployment);assert.equal(r.status,0,r.stderr);assert.doesNotMatch(r.stderr,/WARNING|existing rows/);assert.match(r.stderr,/note: items.body admits values outside release 1's column declaration/);
  });
});

test('REL2 successful preview reports a rebuilt maintain instead of its speculative refusal', {timeout:hangBudget(3)},async t=>{
  const {deployment,schema,run}=fixture(t);
  const v1=source.replace('  body: text',"  status: enum('old') default 'old'\n  body: text").replace('  insert <- allow','  insert <- allow\n  update <- allow')+`view noteCounts: count items where .status = 'old' by .body
`;
  writeFileSync(schema,v1);run('deploy',deployment);
  const v2=v1.replace("enum('old')","enum('old','new')").replace(" where .status = 'old'",'')+`mutation markNew(item: items):
  update items[item] {status: 'new'}
`;
  writeFileSync(schema,v2);run('deploy',deployment);
  await serve(deployment,async(url,headers)=>{
    const first=(await releasePost(url,headers,'/m/add',{},'rel2-maintain-one')).result.id;
    await releasePost(url,headers,'/m/add',{},'rel2-maintain-two');
    await releasePost(url,headers,'/m/markNew',{item:first},'rel2-maintain-mark');
    for(const flags of [[],['--json']]) {
      const preview=run('rollback',deployment,'--to','1','--check',...flags);
      assert.match(preview,/maintain noteCounts: rebuilt from 1 source rows/);
      assert.doesNotMatch(preview,/cannot adopt|rows are lost|values are lost|keep the prior maintain definition/);
    }
  });
});

test('REL2 legacy predecessor stays selectable after release-history upgrade', {timeout:hangBudget(2)},t=>{
  const {deployment,schema,run}=fixture(t);run('deploy',deployment);
  const legacy=new DatabaseSync(join(deployment,'store.sqlite'));
  try{legacy.exec(`DROP TABLE IF EXISTS _release_event_items; DROP TABLE IF EXISTS _release_events; DROP TABLE IF EXISTS _dormant_refs; DROP TABLE IF EXISTS _dormant_values; DROP TABLE IF EXISTS _dormant_rows; DROP TABLE IF EXISTS _dormant_tables; DROP TABLE IF EXISTS _dormant_columns; DROP TABLE IF EXISTS _dormant_indexes; DROP TABLE IF EXISTS _dormant_narrow_rows; UPDATE _meta SET value='snapback4-store-1' WHERE key='version'; DELETE FROM _meta WHERE key='release_revision';`);}finally{legacy.close();}
  writeFileSync(schema,source.replace('return 1','return 2'));run('deploy',deployment);
  run('rollback',deployment);assert.equal(state(join(deployment,'store.sqlite')).metadata.release,'1');
  run('rollback',deployment,'--to','2');run('rollback',deployment,'--to','1');
});

test('REL2 successful preview validates uniqueness after narrowed rows become dormant', {timeout:hangBudget(3)},async t=>{
  const {deployment,schema,run}=fixture(t);
  const broad=source.replace('  body: text',"  status: enum('old','new') default 'old'\n  body: text").replace('  insert <- allow','  insert <- allow\n  update <- allow')+`mutation makeNew(item: items):
  update items[item] {status:'new'}
`;
  writeFileSync(schema,broad);run('deploy',deployment);
  await serve(deployment,async(url,headers)=>{
    const first=(await releasePost(url,headers,'/m/add',{},'rel2-unique-first')).result.id;
    await releasePost(url,headers,'/m/add',{},'rel2-unique-second');await releasePost(url,headers,'/m/makeNew',{item:first},'rel2-unique-mark');
    const narrower=broad.replace("enum('old','new')","enum('old')").replace('  read <- allow','  unique body\n  read <- allow').split('mutation makeNew')[0];
    writeFileSync(schema,narrower);
    for(const flags of [[],['--json']]) {
      const preview=run('deploy',deployment,'--check',...flags);assert.doesNotMatch(preview,/conflict|repair|inspect:/);assert.match(preview,/active rows satisfy/);
    }
    run('deploy',deployment);
  });
});

test('REL2 deploy check validates declared worker secret selection without launching', {timeout:hangBudget(2)},t=>{
  const {app,deployment,schema,run,invoke}=fixture(t);run('deploy',deployment);
  writeFileSync(schema,source.replace('return 1','return 2'));
  mkdirSync(join(app,'snapback/workers'),{recursive:true});writeFileSync(join(app,'snapback/workers/ops.mjs'),'// snapback4 secrets: UNDECLARED_REVIEW_KEY\n');
  const saved=state(join(deployment,'store.sqlite'));
  for(const flags of [['--check'],[]]) {
    const r=invoke('deploy',deployment,...flags);assert.equal(r.status,1,r.stdout+r.stderr);assert.match(r.stderr,/not a declared action, effect or route secret/);
    assert.deepEqual(state(join(deployment,'store.sqlite')),saved);
  }
});

test('REL2 receipts find dormant sample ids beyond empty inventory definitions', {timeout:hangBudget(3)},async t=>{
  const {deployment,schema,run}=fixture(t);run('deploy',deployment);
  const emptyColumns=Array.from({length:20},(_,n)=>`  empty${n}: int ?`).join('\n');
  const added=source.replace('  body: text',emptyColumns+'\n  body: text')+`table zebraHolds:
  n: int
  public
  insert <- allow
mutation createHold():
  return insert zebraHolds {n: 7}
`;
  writeFileSync(schema,added);run('deploy',deployment);
  await serve(deployment,async(url,headers)=>{
    const hold=(await releasePost(url,headers,'/m/createHold',{},'rel2-late-sample')).result.id;
    const receipt=run('rollback',deployment,'--to','1');assert.ok(receipt.includes(hold),receipt);
  });
});

// @ref LLP 3000.000.000.000#4-rollback-safeguards — exact dormant rows and a real old-source safety gap.
test("release-spanning frontend capabilities, baseline types and bridge safeguard", { timeout: hangBudget(4) }, async t => {
  const { app, deployment, schema, run } = fixture(t);
  const v1 = `use identity guests
use personas alice
table grounding:
  state: enum('clear', 'hold')
  body: text <=100
  public 'safety rows'
  insert <- allow
  online only
mutation ground():
  return insert grounding {state: 'hold', body: 'gate'}
mutation book():
  require count(grounding[] first 20 by byId) = 0 else GROUNDED
  return true
query rows():
  return grounding[] first 20 by byId
query one(id: grounding):
  return grounding[id]
`;
  const v2 = v1.replace("enum('clear', 'hold')", "enum('clear', 'hold', 'inspection')").replace("  body: text <=100", "  body: text <=100\n  color: text <=20 default 'none'").replace("state: 'hold'", "state: 'inspection'") + '\nquery newOnly():\n  return true\n';
  writeFileSync(schema, v1); run('deploy', deployment);
  writeFileSync(schema, v2); run('deploy', deployment);
  mkdirSync(join(app,'versions')); writeFileSync(join(app,'versions/v1.q'),v1);
  writeFileSync(join(app,'snapback/client-compatibility.json'),JSON.stringify({baseline:'versions/v1.q',since_release:2}));
  run('check');
  const generated = readFileSync(join(app,'snapback/generated/api.ts'),'utf8');
  assert.match(generated,/Since release 2/); assert.match(generated,/color\?: string/);
  assert.match(generated,/available\(release: ReleaseSnapshot\)/);
  // The same generated API typechecks with baseline-optional row fields.
  const { createRequire } = await import('node:module');
  const require = createRequire(join(root,'package.json'));
  const ts = require('typescript');
  mkdirSync(join(app,'node_modules')); symlinkSync(join(root,'packages/snapback4'),join(app,'node_modules/snapback4'));
  const usage = join(app,'usage.ts');
  writeFileSync(usage, `import {api, type Rows} from './snapback/generated/api';\nimport type {ArgsOf} from 'snapback4/contract';\ndeclare const row: Rows['grounding'];\nconst color: string | undefined = row.color;\n// @ts-expect-error spanning fields need their baseline fallback\nconst required: string = row.color;\nconst args: ArgsOf<typeof api.one> = {id:'x'};\napi.newOnly.available({loading:true});\n`);
  const program=ts.createProgram([usage],{strict:true,noEmit:true,skipLibCheck:true,target:ts.ScriptTarget.ES2022,module:ts.ModuleKind.ESNext,moduleResolution:ts.ModuleResolutionKind.Bundler});
  assert.deepEqual(ts.getPreEmitDiagnostics(program).map(d=>ts.flattenDiagnosticMessageText(d.messageText,'\n')),[]);
  const { createClient } = await import('../dist/client.js');
  const { operationAvailable } = await import('../dist/contract.js');
  await serve(deployment, async (url, headers, session) => {
    assert.equal((await fetch(url+'/')).status,401);
    const client=createClient({url,session}); const stop=client.release.subscribe(()=>{});
    t.after(()=>client.close());
    const waitGeneration=async n=>waitFor(()=>client.release.getSnapshot().generation===n,`served generation ${n}`);
    const post=async (path,args={})=>(await fetch(url+path,{method:'POST',headers:{...headers,'content-type':'application/json'},body:JSON.stringify({args})})).json();
    try {
      await waitGeneration(2);
      assert.equal(operationAvailable(client.release.getSnapshot(),'newOnly','query',{}),true);
      assert.equal(client.release.getSnapshot().tables.grounding.fields.color.Text.max,20);
      const created=await post('/m/ground'); assert.equal(created.state,'sent');
      assert.equal((await post('/m/book')).why.code,'GROUNDED');
      const before=state(join(deployment,'store.sqlite'));
      const preview=JSON.parse(run('rollback',deployment,'--to','1','--check','--json'));
      assert.deepEqual(state(join(deployment,'store.sqlite')),before);
      assert.ok(preview.hazards.some(h=>h.includes("release 1's `book` cannot see 1 dormant grounding row")),JSON.stringify(preview));
      assert.ok(!preview.hazards.some(h=>h.includes("`newOnly` cannot see")));
      run('rollback',deployment,'--to','1'); await waitGeneration(3);
      assert.equal(operationAvailable(client.release.getSnapshot(),'newOnly','query',{}),false);
      assert.equal(client.release.getSnapshot().tables.grounding.fields.color,undefined);
      assert.equal((await post('/m/book')).state,'sent');
      assert.deepEqual((await post('/q/rows')).data,[]);
      run('rollback',deployment,'--to','latest'); await waitGeneration(4);
      assert.equal((await post('/q/rows')).data[0].state,'inspection');
      assert.equal((await post('/q/rows')).data[0].color,'none');
      assert.equal((await post('/m/book')).why.code,'GROUNDED');
      // A bridge keeps the new value domain and the gate while dropping new-only UI.
      writeFileSync(schema,v1.replace("enum('clear', 'hold')","enum('clear', 'hold', 'inspection')"));
      run('deploy',deployment); await waitGeneration(5);
      assert.equal((await post('/m/book')).why.code,'GROUNDED');
      const bridgePreview=JSON.parse(run('rollback',deployment,'--to','latest','--check','--json'));
      assert.ok(!bridgePreview.hazards.some(h=>h.includes('cannot see') && h.includes('grounding')));
    } finally { stop(); await client.close(); }
  });
});

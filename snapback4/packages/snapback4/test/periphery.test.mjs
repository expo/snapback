import test from "node:test";
import assert from "node:assert/strict";
import { spawn, spawnSync } from "node:child_process";
import { once } from "node:events";
import { mkdtempSync, mkdirSync, readFileSync, writeFileSync, rmSync, existsSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { createRequire } from "node:module";
import { DatabaseSync } from "node:sqlite";
import { setTimeout as delay } from "node:timers/promises";
import vm from "node:vm";

const root = join(dirname(fileURLToPath(import.meta.url)), "../../..");
const binary = process.env.SNAPBACK4_BIN ?? join(root, "target/debug/snapback4");
const read = (file) => readFileSync(file, "utf8");
const json = (file) => JSON.parse(read(file));
function fixture(t) {
  const dir = mkdtempSync(join(tmpdir(), "sb4-periphery-"));
  t.after(() => rmSync(dir, { recursive: true, force: true }));
  const invoke = (...args) => spawnSync(binary, args, { cwd: dir, encoding: "utf8", timeout: 5000 });
  const run = (...args) => {
    const result = invoke(...args);
    assert.equal(result.error, undefined);
    assert.equal(result.status, 0, `${args}\n${result.stdout}\n${result.stderr}`);
    return result;
  };
  return { dir, invoke, run };
}

test("init keeps the local default and makes a compiled online starter without sync", (t) => {
  const { dir, run, invoke } = fixture(t);
  run("init", "local");
  assert.match(read(join(dir, "local/snapback/schema.q")), /\n  sync /);
  run("init", "--online", "online");
  const source = read(join(dir, "online/snapback/schema.q"));
  assert.doesNotMatch(source, /\n\s*sync /);
  assert.match(source, /read <- \.ownerId = viewer/);
  assert.match(read(join(dir, "online/src/client.ts")), /createClient/);
  for (const mode of ["local", "online"]) {
    const checked = spawnSync(binary, ["check", "--json"], { cwd: join(dir, mode), encoding: "utf8" });
    assert.equal(checked.status, 0, checked.stdout + checked.stderr);
    const result = JSON.parse(checked.stdout);
    assert.equal(result.synced, mode === "online" ? 0 : 1);
    assert.equal(result.notes.length, 0);
  }
  assert.equal(invoke("init", "--online", "--expo", "bad").status, 2);
  assert.equal(existsSync(join(dir, "bad")), false);
  mkdirSync(join(dir, "occupied"));
  writeFileSync(join(dir, "occupied/package.json"), "kept");
  assert.equal(invoke("init", "occupied", "--online").status, 1);
  assert.equal(existsSync(join(dir, "occupied/snapback/schema.q")), false);
  assert.equal(read(join(dir, "occupied/package.json")), "kept");
});

test("Expo starter copies reference pins, parses configs, and carries both client tiers", (t) => {
  const { dir, run } = fixture(t);
  run("init", "--expo");
  const reference = join(root, "apps/chat-expo");
  const expected = json(join(reference, "package.json")), actual = json(join(dir, "package.json"));
  for (const group of ["dependencies", "devDependencies"]) {
    for (const [name, version] of Object.entries(expected[group])) {
      assert.equal(actual[group][name], version === "workspace:*" ? json(join(root, "packages", name, "package.json")).version : version, name);
    }
  }
  const require = createRequire(join(reference, "package.json"));
  assert.equal(actual.devDependencies["babel-preset-expo"], require("babel-preset-expo/package.json").version);
  assert.deepEqual(json(join(dir, "app.json")), json(join(reference, "app.json")));
  assert.deepEqual(json(join(dir, "tsconfig.json")), json(join(reference, "tsconfig.json")));
  assert.equal(read(join(dir, "babel.config.js")), read(join(reference, "babel.config.js")));
  const babel = { module: { exports: {} } };
  vm.runInNewContext(read(join(dir, "babel.config.js")), babel);
  assert.deepEqual(Array.from(babel.module.exports({ cache(value) { assert.equal(value, true); } }).presets), ["babel-preset-expo"]);
  const metro = { module: { exports: {} }, __dirname: dir, require(name) { assert.equal(name, "expo/metro-config"); return { getDefaultConfig: () => ({ resolver: {} }) }; } };
  vm.runInNewContext(read(join(dir, "metro.config.js")), metro);
  assert.equal(metro.module.exports.resolver.unstable_enablePackageExports, true);
  assert.equal(read(join(dir, "src/client.ts")), read(join(reference, "src/client.ts")));
  assert.equal(read(join(dir, "snapback/worker.ts")), read(join(root, "apps/chat/snapback/worker.ts")));
  assert.match(read(join(dir, "src/client.ts")), /nativeAvailable\(\) \? "native" : "online"/);
  assert.doesNotMatch(read(join(dir, "App.tsx")), /runWitness|EXPO_PUBLIC_WITNESS/);
  for (const screen of ["Inbox", "Thread"]) assert.match(read(join(dir, `src/${screen}.tsx`)), /\.\.\/snapback\/generated\/api/);
  run("check");
});

const ambiguous = `use personas alice
table items:
  owner: principal
  title: text <=100
  by byOwner: owner, title
  by byTitle: title, id
  public 'demo'
query list(c: cursor ?):
  return items[viewer] after c first 10 -- keep this comment
`;

test("check --fix repairs ambiguity then the cursor index in one run and preserves comments", (t) => {
  const { dir, run, invoke } = fixture(t);
  mkdirSync(join(dir, "snapback"));
  writeFileSync(join(dir, "snapback/schema.q"), ambiguous.replace("  by byTitle: title, id", "  by byOtherOwner: owner, title, id"));
  const before = invoke("check", "--json");
  assert.equal(before.status, 1);
  assert.equal(JSON.parse(before.stdout).problems[0].code, "E_QUARRY_AMBIGUOUS");
  const fixed = run("check", "--fix", "--json");
  assert.equal(JSON.parse(fixed.stdout).ok, true);
  assert.match(fixed.stderr, /fix: .*E_QUARRY_AMBIGUOUS/);
  assert.match(fixed.stderr, /fix: .*E_QUARRY_UNKNOWN/);
  assert.match(read(join(dir, "snapback/schema.q")), /by byOwner -- keep this comment/);
  // Force the cursor tie-break repair across module files as well.
  writeFileSync(join(dir, "snapback/schema.q"), ambiguous.split("query list")[0]);
  writeFileSync(join(dir, "snapback/reads.q"), "query list(c: cursor ?):\n  return items[viewer] after c first 10 by byOwner -- keep me\n");
  const cursor = run("check", "--fix");
  assert.match(cursor.stderr, /E_QUARRY_UNKNOWN/);
  assert.match(read(join(dir, "snapback/schema.q")), /by byOwner: owner, title, id/);
  assert.match(read(join(dir, "snapback/reads.q")), /-- keep me/);
  const stable = read(join(dir, "snapback/schema.q"));
  run("check", "--fix");
  assert.equal(read(join(dir, "snapback/schema.q")), stable);
});

test("check --fix leaves unmarked rewrites and prints the diagnostic", (t) => {
  const { dir, invoke } = fixture(t);
  mkdirSync(join(dir, "snapback"));
  const source = "query q():\n  return missingName\n";
  writeFileSync(join(dir, "snapback/schema.q"), source);
  const result = invoke("check", "--fix", "--json");
  assert.equal(result.status, 1);
  assert.equal(JSON.parse(result.stdout).problems[0].mechanical, false);
  assert.equal(read(join(dir, "snapback/schema.q")), source);
});

test("an elif and an ambiguous key are fixed together when lane L's diagnostic is available", (t) => {
  const { dir, run, invoke } = fixture(t);
  mkdirSync(join(dir, "snapback"));
  const source = ambiguous.replace("  by byTitle: title, id", "  by byOtherOwner: owner, title, id") + "\nquery choose(n: int):\n  if n = 0:\n    return 0\n  elif n = 1:\n    return 1\n  else:\n    return 2\n";
  writeFileSync(join(dir, "snapback/schema.q"), source);
  const before = JSON.parse(invoke("check", "--json").stdout);
  const alias = before.problems?.find((d) => d.code === "E_QUARRY_UNSUPPORTED" && /elif/.test(d.message));
  if (!alias) { t.skip("lane L's exact E_QUARRY_UNSUPPORTED elif diagnostic is not in this checkout"); return; }
  assert.equal(alias.mechanical, true, "lane L's exact spelling rewrite must call .mechanical()");
  run("check", "--fix");
  assert.doesNotMatch(read(join(dir, "snapback/schema.q")), /\belif\b/);
  assert.match(read(join(dir, "snapback/schema.q")), /first 10 by byOwner/);
  run("check");
});

test("SQL reads chat views while dev writes in WAL, refuses raw access, and bounds rows", { timeout: 20000 }, async (t) => {
  const { dir, run, invoke } = fixture(t);
  mkdirSync(join(dir, "snapback"));
  writeFileSync(join(dir, "snapback/schema.q"), read(join(root, "apps/chat/snapback/schema.q")));
  const child = spawn(binary, ["dev", "--port", "0", "--no-watch"], { cwd: dir, stdio: ["ignore", "pipe", "pipe"] });
  const exited = once(child, "exit");
  let log = "", url;
  child.stdout.on("data", (data) => { log += data; url ??= log.match(/http:\/\/127\.0\.0\.1:\d+/)?.[0]; });
  child.stderr.on("data", (data) => { log += data; });
  try {
    const deadline = Date.now() + 5000;
    while (!url && child.exitCode == null && Date.now() < deadline) await delay(10);
    assert.ok(url, log);
    const post = async (route, body) => {
      const response = await fetch(url + route, { method: "POST", headers: { "content-type": "application/json", "x-snapback-persona": "alice" }, body: JSON.stringify(body), signal: AbortSignal.timeout(3000) });
      assert.equal(response.status, 200);
      return response.json();
    };
    const seeded = await post("/seed", [
      { table: "conversations", row: { id: "c1", title: "General", creatorId: "dev:alice" } },
      { table: "memberships", row: { id: "m1", conversationId: "c1", principal: "dev:alice", role: "admin", joinedAt: 1 } },
      ...Array.from({ length: 205 }, (_, i) => ({ table: "messages", row: { id: `s${i}`, conversationId: "c1", authorId: "dev:alice", body: i === 0 ? "Null" : `body ${i}`, at: i } })),
    ]);
    assert.equal(seeded.seeded, 207);
    // A broken working copy must not replace the store's compiled columns.
    writeFileSync(join(dir, "snapback/schema.q"), "broken source\n");
    const answer = (statement, ...flags) => JSON.parse(run("sql", statement, "--json", ...flags).stdout);
    const rows = answer("SELECT m.body, m.at, c.title FROM messages m JOIN conversations c ON c.id = m.conversationId ORDER BY m.at");
    assert.deepEqual(rows.rows[0], ["Null", 0, "General"]);
    assert.equal(rows.rows.length, 200);
    assert.equal(rows.more, true);
    assert.equal(rows.ruleFiltered, false);
    assert.match(rows.header, /developer's own store.*not rule-filtered/);
    assert.deepEqual(answer("/* comment */ WITH selected AS (SELECT body FROM messages WHERE at = 0) SELECT * FROM selected; -- trailing").rows, [["Null"]]);
    assert.deepEqual(answer("SELECT ';--literal' AS text").rows, [[";--literal"]]);
    assert.equal(answer("SELECT id FROM messages", "--limit=205").more, false);
    assert.match(run("sql", "SELECT body FROM messages", "--limit", "1").stdout, /1 row\(s\) — more rows exist/);
    for (const [statement, code] of [
      ["UPDATE messages SET body = 'bad'", "E_SQL_READ_ONLY"],
      ["WITH chosen AS (SELECT 1) UPDATE r SET data = '{}'", "E_SQL_READ_ONLY"],
      ["SELECT 1; SELECT 2", "E_SQL_READ_ONLY"],
      ["SELECT 1; DELETE FROM r", "E_SQL_READ_ONLY"],
      ["PRAGMA journal_mode=DELETE", "E_SQL_READ_ONLY"],
      ["SELECT load_extension('x')", "E_SQL_READ_ONLY"],
      ...["_sessions", "r", "i", "sqlite_master", "sqlite_temp_master"].map((table) => [`SELECT * FROM ${table}`, "E_SQL_INTERNAL"]),
      ['SELECT * FROM "_sessions"', "E_SQL_INTERNAL"],
      ["WITH messages AS (SELECT data FROM r) SELECT * FROM messages", "E_SQL_INTERNAL"],
      ["WITH _snapback_sql_1 AS (SELECT data FROM r) SELECT * FROM _snapback_sql_1", "E_SQL_INTERNAL"],
    ]) {
      const result = invoke("sql", statement, "--json");
      assert.equal(result.status, 1, statement);
      assert.equal(JSON.parse(result.stdout).denied.code, code, statement + result.stdout);
    }
    const db = new DatabaseSync(join(dir, ".snapback4/store.sqlite"));
    try {
      assert.equal(db.prepare("PRAGMA journal_mode").get().journal_mode, "wal");
      db.exec("BEGIN IMMEDIATE; UPDATE r SET data=data");
      // Even with the writer lock held, SQL finishes and sees committed rows.
      const started = performance.now();
      assert.deepEqual(answer("SELECT count(*) FROM messages").rows, [[205]]);
      t.diagnostic(`SQL count of 205 messages with WAL writer held: ${(performance.now() - started).toFixed(2)} ms`);
      db.exec("ROLLBACK");
      assert.equal(db.prepare("SELECT count(*) AS n FROM sqlite_master WHERE type='view'").get().n, 0);
    } finally { db.close(); }
    assert.equal((await post("/m/send", { id: "after-sql", args: { conversationId: "c1", body: "dev still writes" } })).state, "sent");
    assert.deepEqual(answer("SELECT count(*) FROM messages").rows, [[206]]);
  } finally {
    if (child.exitCode == null && child.signalCode == null) child.kill("SIGTERM");
    await exited;
  }
});

test("SQL attaches to a release without source and never creates a missing store", (t) => {
  const { dir, run, invoke } = fixture(t);
  run("init", "--online");
  run("deploy", join(dir, "release"));
  rmSync(join(dir, "snapback"), { recursive: true });
  const result = JSON.parse(run("sql", "SELECT * FROM todos", "--release", join(dir, "release"), "--json").stdout);
  assert.deepEqual(result.rows, []);
  const missing = join(dir, "missing");
  const refused = invoke("sql", "SELECT 1", "--release", missing, "--json");
  assert.equal(refused.status, 1);
  assert.equal(JSON.parse(refused.stdout).denied.code, "E_STORE");
  assert.equal(existsSync(missing), false);
});

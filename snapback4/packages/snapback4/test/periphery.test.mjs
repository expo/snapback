import { captureStdout } from './helpers/server-output.mjs';
import { waitFor as awaitState, hangBudget } from './helpers/wait.mjs';
import test from "node:test";
import assert from "node:assert/strict";
import { spawn, spawnSync } from "node:child_process";
import { once } from "node:events";
import { mkdtempSync, mkdirSync, readFileSync, writeFileSync, rmSync, existsSync, readdirSync, copyFileSync, cpSync, realpathSync, symlinkSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { createRequire } from "node:module";
import { DatabaseSync } from "node:sqlite";
import { setTimeout as delay } from "node:timers/promises";
import vm from "node:vm";
import ts from "typescript";
import { processDevice } from "../dist/native.js";

const adapter = ts.transpileModule(readFileSync(new URL("../../snapback4-expo/src/session-store.ts", import.meta.url), "utf8"), {
  compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.ESNext },
}).outputText;
const { secureStoreSessionStore } = await import(`data:text/javascript;base64,${Buffer.from(adapter).toString("base64")}`);

const root = join(dirname(fileURLToPath(import.meta.url)), "../../..");
const binary = process.env.SNAPBACK4_BIN ?? join(root, "target/debug/snapback4");
const read = (file) => readFileSync(file, "utf8");
const json = (file) => JSON.parse(read(file));
function fixture(t) {
  const dir = mkdtempSync(join(tmpdir(), "sb4-periphery-"));
  t.after(() => rmSync(dir, { recursive: true, force: true }));
  const invoke = (...args) => spawnSync(binary, args, { cwd: dir, encoding: "utf8", timeout: hangBudget() });
  const run = (...args) => {
    const result = invoke(...args);
    assert.equal(result.error, undefined);
    assert.equal(result.status, 0, `${args}\n${result.stdout}\n${result.stderr}`);
    return result;
  };
  return { dir, invoke, run };
}

for (const mode of ["dev", "serve"]) test(`${mode}: offline and live piped token stdout is one usable bearer, and server stdout carries its URL and optional dev token`, { timeout: hangBudget(10) }, async (t) => {
  const { dir, run, invoke } = fixture(t);
  run("init", "--online");
  const schema = join(dir, "snapback/schema.q");
  writeFileSync(schema, read(schema) + "\nquery who():\n  return viewer\n");
  const release = join(dir, "release");
  if (mode === "serve") {
    run("deploy", release);
    rmSync(join(dir, "snapback"), { recursive: true });
  } else {
    writeFileSync(join(dir, "snapback/worker.mjs"), 'console.log("worker stdout witness"); console.error("worker stderr witness"); setInterval(() => {}, 1000);\n');
  }
  if (mode === "dev") run("test", "--residency");
  const releaseFlags = mode === "serve" ? ["--release", release] : [];
  const mint = phase => [[], ["--days", "1"], ["--days=2", "--service=worker"], ["--quiet"], ["--json"]]
    .map(flags => ({ phase, flags, minted: run("token", "--service", "worker", ...releaseFlags, ...flags) }));
  const tokens = mint("offline");
  const invalid = invoke("token", "--service", "bad name", ...releaseFlags);
  assert.equal(invalid.status, 1);
  assert.equal(invalid.stdout, "");
  assert.match(invalid.stderr, /^token:/);
  const args = mode === "serve" ? ["serve", release, "--port", "0"] : ["dev", "--port", "0"];
  const child = spawn(binary, args, { cwd: dir, stdio: ["ignore", "pipe", "pipe"] });
  const exited = once(child, "exit");
  let stdout = "", stderr = "";
  child.stdout.on("data", data => { stdout += data; });
  child.stderr.on("data", data => { stderr += data; });
  const withoutToken = () => stdout.replace(/^snapback4 dev worker: service:worker token \(printed once\): \S+\n/gm, "");
  const until = async (predicate) => {
    await awaitState(() => predicate() || child.exitCode !== null || child.signalCode !== null, "child progress");
    assert.ok(predicate(), (stdout + stderr).replace(/token \(printed once\): \S+/g, "token (printed once): <redacted>"));
  };
  try {
    await until(() => withoutToken().includes("\n"));
    const url = withoutToken().trim();
    assert.ok(/^http:\/\/127\.0\.0\.1:\d+$/.test(url), (stdout + stderr).replace(/token \(printed once\): \S+/g, "token (printed once): <redacted>"));
    assert.ok(withoutToken() === `${url}\n`, (stdout + stderr).replace(/token \(printed once\): \S+/g, "token (printed once): <redacted>"));
    await until(() => stderr.includes(`snapback4 ${mode}: ${url}`));
    if (mode === "dev") {
      await until(() => stderr.includes("worker stdout witness") && stderr.includes("worker stderr witness"));
      writeFileSync(schema, read(schema) + "\nquery alive():\n  return true\n");
      await until(() => stderr.includes("schema adopted as generation 2"));
    }
    const post = async (path, token, body) => {
      const response = await fetch(url + path, { method: "POST", headers: { "content-type": "application/json", authorization: `Bearer ${token}` }, body: JSON.stringify(body), signal: AbortSignal.timeout(hangBudget()) });
      assert.equal(response.status, 200, await response.clone().text());
      return response.json();
    };
    tokens.push(...mint("live"));
    for (const { phase, flags, minted } of tokens) {
      const store = mode === "serve" ? join(release, "store.sqlite") : realpathSync(join(dir, ".snapback4/store.sqlite"));
      let token;
      if (flags.includes("--json")) {
        const record=JSON.parse(minted.stdout);token=record.token;
        assert.equal(record.principal,"service:worker");assert.equal(record.store,store);assert.ok(record.expiresAt>Date.now());
        assert.equal(minted.stderr,"");
      } else {
        const match = minted.stdout.match(/^([A-Za-z0-9_-]{43})\n$/);
        assert.ok(match, "stdout must contain only the base64url token and one newline");
        token=match[1];
        if (flags.includes("--quiet")) assert.equal(minted.stderr,"");
        else {
          const [status, ownership, end] = minted.stderr.split("\n");
          assert.match(status, /^token: a session for service:worker until \d+; printed once; keep it where the worker keeps secrets$/);
          assert.equal(ownership, `store: ${store}; this token belongs only to this store; each isolated store needs its own`);
          assert.equal(end, ""); assert.equal(minted.stderr.split("\n").length, 3);
        }
      }
      assert.ok(!minted.stderr.includes(token), "the token is printed only once");
      const { session } = await post("/auth/session", token, { principal: "member:captured", kind: "member", days: 1 });
      assert.equal(session.principal, "member:captured");
      assert.equal((await post("/q/who", session.token, { args: {} })).data, "member:captured");
      t.diagnostic(`token ${mode} ${phase} ${flags.join(" ") || "default"}: stdout ${Buffer.byteLength(minted.stdout)} B; redeemed session queried as ${session.principal}`);
    }
    const refused = invoke("token", "--service", "bad name", ...releaseFlags);
    assert.equal(refused.status, 1);
    assert.equal(refused.stdout, "");
    assert.match(refused.stderr, /E_AUTH/);
    assert.ok(withoutToken() === `${url}\n`, (stdout + stderr).replace(/token \(printed once\): \S+/g, "token (printed once): <redacted>"));
  } finally {
    if (child.exitCode == null && child.signalCode == null) child.kill("SIGTERM");
    await exited;
  }
});

test("types prints a capturable generated path with its status on stderr", (t) => {
  const { run } = fixture(t);
  run("init");
  const result = run("types");
  assert.equal(result.stdout, `${result.stdout.trim()}\n`);
  assert.ok(existsSync(result.stdout.trim()));
  assert.match(read(result.stdout.trim()), /export/);
  assert.equal(result.stderr, `types: wrote ${result.stdout}`);
});

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
    assert.deepEqual(result.notes.map(note => note.code), ["N_NO_PRODUCTION_WRITER"]);
  }
  assert.equal(invoke("init", "--online", "--expo", "bad").status, 2);
  assert.equal(existsSync(join(dir, "bad")), false);
  mkdirSync(join(dir, "occupied"));
  writeFileSync(join(dir, "occupied/package.json"), "kept");
  assert.equal(invoke("init", "occupied", "--online").status, 1);
  assert.equal(existsSync(join(dir, "occupied/snapback/schema.q")), false);
  assert.equal(read(join(dir, "occupied/package.json")), "kept");
});

for (const template of [[], ["--template", "chat"]]) test(`Expo ${template.length ? "chat " : ""}starter copies reference pins, parses configs, and carries both client tiers`, (t) => {
  const { dir, run } = fixture(t);
  const chat = template.length > 0;
  run("init", "--expo", ...template);
  const reference = join(root, "apps/chat-expo");
  const expected = json(join(reference, "package.json")), actual = json(join(dir, "package.json"));
  for (const group of ["dependencies", "devDependencies"]) {
    for (const [name, version] of Object.entries(expected[group])) {
      assert.equal(actual[group][name], version === "workspace:*" ? json(join(root, "packages", name, "package.json")).version : version, name);
    }
  }
  const require = createRequire(join(reference, "package.json"));
  assert.equal(actual.devDependencies["babel-preset-expo"], require("babel-preset-expo/package.json").version);
  const starterConfig = json(join(reference, "app.json"));
  // Expo's favicon pipeline accepts only raster images, so the starter ships none (0.4.27).
  if (chat) assert.deepEqual(json(join(dir, "app.json")), starterConfig);
  else assert.deepEqual(json(join(dir, "app.json")).expo.plugins, starterConfig.expo.plugins);
  assert.equal(read(join(dir, "expo-env.d.ts")), '/// <reference types="expo/types" />\n');
  assert.deepEqual(json(join(dir, "tsconfig.json")), json(join(reference, "tsconfig.json")));
  assert.equal(read(join(dir, "babel.config.js")), read(join(reference, "babel.config.js")));
  const babel = { module: { exports: {} } };
  vm.runInNewContext(read(join(dir, "babel.config.js")), babel);
  assert.deepEqual(Array.from(babel.module.exports({ cache(value) { assert.equal(value, true); } }).presets), ["babel-preset-expo"]);
  const metroRequire = Object.assign((name) => { assert.equal(name, "expo/metro-config"); return { getDefaultConfig: () => ({ resolver: { assetExts: ["png"] }, transformer: {} }) }; }, { resolve: name => join(dir, name) });
  const metro = { module: { exports: {} }, __dirname: dir, require: metroRequire };
  vm.runInNewContext(read(join(dir, "metro.config.js")), metro);
  assert.equal(metro.module.exports.resolver.unstable_enablePackageExports, true);
  assert.ok(metro.module.exports.resolver.assetExts.includes("wasm"));
  assert.match(metro.module.exports.transformer.babelTransformerPath, /metro-wasm-transformer.cjs$/);
  const transformer = { module: { exports: {} }, require(name) { assert.equal(name, "@expo/metro-config/babel-transformer"); return { transform: args => args }; } };
  vm.runInNewContext(read(join(dir, "metro-wasm-transformer.cjs")), transformer);
  const src = 'const wasm = new URL("./wasm/snapback4_device_bg.wasm", import.meta.url);';
  const transform = transformer.module.exports.transform;
  assert.equal(transform({ src, options: { platform: "web" } }).src, 'const wasm = require("./wasm/snapback4_device_bg.wasm");');
  assert.equal(transform({ src, options: { platform: "ios" } }).src, src);
  const shipped = read(join(root, "packages/snapback4/dist/web.js"));
  assert.ok(transform({ src: shipped, options: { platform: "web" } }).src.includes('options.wasm ?? require("./wasm/snapback4_device_bg.wasm")'));
  assert.match(read(join(dir, "src/client.ts")), /createApp/);
  assert.match(read(join(dir, "App.tsx")), /AppProvider|useAuth/);
  assert.equal(actual.scripts["build:web"], chat ? "expo export -p web --max-workers 2 && snapback4 web-shell dist" : "expo export --platform web --max-workers 2 --clear && snapback4 web-shell dist");
  const schema = read(join(dir, "snapback/schema.q"));
  assert.doesNotMatch(schema, /^\s*(?:use\s+server\b|action\s|route\s)/m);
  assert.doesNotMatch(schema, /^\s*schedule\b.*:\s*invite\b/m);
  assert.match(read(join(dir, "src/client.ts")), /nativeAvailable\(\) \? "native" : "online"/);
  assert.doesNotMatch(read(join(dir, "App.tsx")), /runWitness|EXPO_PUBLIC_WITNESS/);
  if (chat) for (const screen of ["Inbox", "Thread"]) assert.match(read(join(dir, `src/${screen}.tsx`)), /\.\.\/snapback\/generated\/api/);
  else assert.match(read(join(dir, "App.tsx")), /\.\/snapback\/generated\/api/);
  run("check");
  function assertCoreTree(directory) {
    for (const entry of readdirSync(directory, { withFileTypes: true })) {
      const path = join(directory, entry.name);
      if (entry.isDirectory()) assertCoreTree(path);
      else {
        assert.doesNotMatch(entry.name, /^worker\./, path);
        assert.doesNotMatch(read(path), /invite/, path);
      }
    }
  }
  assertCoreTree(dir);
});

// Wave 5 (LLP 3000.013 §6.6): the adapted Home renders the schema's first
// argument-free query through matchRead; it must typecheck against api.ts.
for (const starter of ["expo", "web"]) test(`${starter} adapted Home reads the schema's first argument-free query and typechecks`, (t) => {
  const { dir, run } = fixture(t);
  run("init", `--${starter}`);
  writeFileSync(join(dir, "snapback/schema.q"), `use personas carol, dave
table notes:
  owner: principal
  body: text <=100
  read <- .owner = viewer
  insert <- .owner = viewer
  online only
query one(n: notes):
  return notes[n]
query mine(c: cursor ?):
  return notes where .owner = viewer first 20 by .id after c
mutation post(body: text 1..100):
  return insert notes { owner: viewer, body }
`);
  run("init", "--adapt", "--apply"); run("check");
  const app = readFileSync(join(dir, starter === "expo" ? "App.tsx" : "src/App.tsx"), "utf8");
  assert.match(app, /const read = useQuery\(api\.mine, \{\}\);/);
  // Wave 7 (R2): the spread comes first, so a handler added after it wins.
  assert.match(app, /matchRead\(read, \{ \.\.\.otherwiseAll\(other => readPresentation\(other\)\.why\?\.message \?\? "…"\), present: .*absent: \(\) => "nothing yet" \}\)/);
  linkDeclaredDependencies(dir, starter);
  const checked = spawnSync(process.execPath, [join(dir, "node_modules/typescript/bin/tsc"), "--noEmit"], { cwd: dir, encoding: "utf8" });
  assert.equal(checked.status, 0, checked.stdout + checked.stderr);
});

function linkDeclaredDependencies(dir, starter) {
  const reference = join(root, "apps", starter === "expo" ? "chat-expo" : "chat");
  const packageJson = json(join(dir, "package.json"));
  const require = createRequire(join(reference, "package.json"));
  for (const name of Object.keys({ ...packageJson.dependencies, ...packageJson.devDependencies })) {
    const target = join(dir, "node_modules", name);
    mkdirSync(dirname(target), { recursive: true });
    if (name === "snapback4") {
      mkdirSync(target);
      copyFileSync(join(root, "packages/snapback4/package.json"), join(target, "package.json"));
      cpSync(join(root, "packages/snapback4/dist"), join(target, "dist"), { recursive: true });
    } else {
      const installed = require.resolve.paths(name).map(path => join(path, name)).find(existsSync);
      if (installed) symlinkSync(realpathSync(installed), target, "dir");
    }
  }
}

for (const starter of ["expo", "web"]) for (const template of [[], ["--template", "chat"]]) test(`${starter} ${template.length ? "chat " : ""}fresh template and generated server typecheck with only declared dependencies`, (t) => {
  const { dir, run } = fixture(t);
  run("init", `--${starter}`, ...template); run("check");
  const reference = join(root, "apps", starter === "expo" ? "chat-expo" : "chat");
  const packageJson = json(join(dir, "package.json"));
  const require = createRequire(join(reference, "package.json"));
  for (const name of Object.keys({ ...packageJson.dependencies, ...packageJson.devDependencies })) {
    const target = join(dir, "node_modules", name);
    mkdirSync(dirname(target), { recursive: true });
    if (name === "snapback4") {
      // Copy the package boundary, so undeclared workspace @types cannot leak
      // into the generated server's resolution through the package symlink.
      mkdirSync(target);
      copyFileSync(join(root, "packages/snapback4/package.json"), join(target, "package.json"));
      cpSync(join(root, "packages/snapback4/dist"), join(target, "dist"), { recursive: true });
    } else {
      const installed = require.resolve.paths(name).map(path => join(path, name)).find(existsSync);
      // Template-only build packages (e.g. react-native-web) need not be
      // installed in the reference app; TypeScript must pass without them.
      if (installed) symlinkSync(realpathSync(installed), target, "dir");
    }
  }
  const compiler = join(dir, "node_modules/typescript/bin/tsc");
  const checked = spawnSync(process.execPath, [compiler, "--noEmit"], { cwd: dir, encoding: "utf8" });
  assert.equal(checked.status, 0, checked.stdout + checked.stderr);
  // Expo's app config does not include this unused generated module. Check it
  // explicitly too, in an environment that grants no ambient Node globals.
  writeFileSync(join(dir, "tsconfig.server.json"), JSON.stringify({
    compilerOptions: { strict: true, target: "ES2022", module: "ESNext", moduleResolution: "Bundler", allowImportingTsExtensions: true, skipLibCheck: true, types: [] },
    files: ["snapback/generated/server.ts"],
  }));
  const server = spawnSync(process.execPath, [compiler, "--noEmit", "-p", "tsconfig.server.json"], { cwd: dir, encoding: "utf8" });
  assert.equal(server.status, 0, server.stdout + server.stderr);
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

test("check --fix preserves ambiguous positional intent and repairs an explicit cursor index", (t) => {
  const { dir, run, invoke } = fixture(t);
  mkdirSync(join(dir, "snapback"));
  const source = ambiguous.replace("  by byTitle: title, id", "  by byOtherOwner: owner, title, id");
  writeFileSync(join(dir, "snapback/schema.q"), source);
  const fixed = invoke("check", "--fix", "--json");
  assert.equal(fixed.status, 1);
  assert.equal(JSON.parse(fixed.stdout).problems[0].code, "E_QUARRY_POSITIONAL_SCAN");
  assert.equal(read(join(dir, "snapback/schema.q")), source);
  // Force the cursor tie-break repair across module files as well.
  writeFileSync(join(dir, "snapback/schema.q"), ambiguous.split("query list")[0]);
  writeFileSync(join(dir, "snapback/reads.q"), "query list(c: cursor ?):\n  return items[viewer] after c first 10 by byOwner -- keep me\n");
  const cursor = run("check", "--fix");
  assert.match(cursor.stderr, /E_CURSOR_INDEX/);
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

test("an elif is repaired while an ambiguous positional key needs an author choice", (t) => {
  const { dir, run, invoke } = fixture(t);
  mkdirSync(join(dir, "snapback"));
  const source = ambiguous.replace("  by byTitle: title, id", "  by byOtherOwner: owner, title, id") + "\nquery choose(n: int):\n  if n = 0:\n    return 0\n  elif n = 1:\n    return 1\n  else:\n    return 2\n";
  writeFileSync(join(dir, "snapback/schema.q"), source);
  const before = JSON.parse(invoke("check", "--json").stdout);
  const alias = before.problems?.find((d) => d.code === "E_QUARRY_UNSUPPORTED" && /elif/.test(d.message));
  assert.ok(alias, "elif has an exact mechanical diagnostic");
  assert.equal(alias.mechanical, true, "lane L's exact spelling rewrite must call .mechanical()");
  const fixed = invoke("check", "--fix", "--json");
  assert.equal(fixed.status, 1);
  assert.equal(JSON.parse(fixed.stdout).problems[0].code, "E_QUARRY_POSITIONAL_SCAN");
  const repaired = read(join(dir, "snapback/schema.q"));
  assert.doesNotMatch(repaired, /\belif\b/);
  assert.equal(repaired, source.replace("elif", "else if"));
  writeFileSync(join(dir, "snapback/schema.q"), repaired.replace("items[viewer]", "items[viewer] by byOtherOwner"));
  run("check");
});

test("SQL reads chat views while dev writes in WAL, refuses raw access, and bounds rows", { timeout: hangBudget(5) }, async (t) => {
  const { dir, run, invoke } = fixture(t);
  mkdirSync(join(dir, "snapback"));
  writeFileSync(join(dir, "snapback/schema.q"), read(join(root, "apps/chat/snapback/schema.q")));
  const child = spawn(binary, ["dev", "--port", "0", "--no-watch"], { cwd: dir, stdio: ["ignore", "pipe", "pipe"] });
  const readStdout = captureStdout(child);
  const exited = once(child, "exit");
  let log = "", url;
  child.stdout.on("data", (data) => { log += data; url ??= readStdout().match(/http:\/\/127\.0\.0\.1:\d+(?=\r?\n)/)?.[0]; });
  child.stderr.on("data", (data) => { log += data; });
  try {
    const deadline = performance.now() + hangBudget();
    while (!url && child.exitCode == null && performance.now() < deadline) await delay(10);
    assert.ok(url, log);
    const post = async (route, body) => {
      const response = await fetch(url + route, { method: "POST", headers: { "content-type": "application/json", "x-snapback-persona": "alice" }, body: JSON.stringify(body), signal: AbortSignal.timeout(hangBudget()) });
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
    const catalog = answer("\\dt");
    assert.ok(catalog.generation > 0);
    assert.equal(catalog.ruleFiltered, false);
    assert.deepEqual(answer(".tables"), catalog);
    const messages = catalog.tables.find(t => t.name === "messages");
    assert.deepEqual(messages.rows, { count: 205, exact: true });
    assert.ok(!catalog.tables.some(t => t.name.startsWith("_") || ["r", "i", "sqlite_master"].includes(t.name)));
    const description = answer("\\d messages");
    assert.deepEqual(answer(".schema messages"), description);
    assert.ok(description.tables[0].columns.some(c => c.name === "body" && c.type.startsWith("text") && c.nullable === true));
    assert.ok(description.tables[0].indexes.some(i => i.unique && i.keys.includes("id")));
    const human = run("sql", "\\d messages");
    assert.match(human.stdout, /Schema generation: \d+/);
    assert.match(human.stdout, /body: text.*nullable/);
    assert.match(run("sql", "\\dt").stdout, /messages \| table \| rows: 205/);
    for (const statement of ["\\d sqlite_master", ".schema r", "\\dt; DELETE FROM r", ".schema messages;", "\\d", ".tables messages"]) {
      const invalid = invoke("sql", statement, "--json");
      assert.equal(invalid.status, 1, statement);
      assert.ok(JSON.parse(invalid.stdout).denied.message.includes("`\\dt` lists tables; `\\d messages` describes one"));
    }
    const rows = answer("SELECT m.body, m.at, c.title FROM messages m JOIN conversations c ON c.id = m.conversationId ORDER BY m.at");
    assert.deepEqual(rows.rows[0], ["Null", 0, "General"]);
    assert.equal(rows.rows.length, 200);
    assert.equal(rows.more, true);
    assert.equal(rows.ruleFiltered, false);
    assert.match(rows.header, /developer's own store.*not rule-filtered/);
    assert.deepEqual(answer("/* comment */ WITH selected AS (SELECT body FROM messages WHERE at = 0) SELECT * FROM selected; -- trailing").rows, [["Null"]]);
    assert.deepEqual(answer("SELECT ';--literal' AS text").rows, [[";--literal"]]);
    assert.equal(answer("SELECT id FROM messages", "--limit=205").more, false);
    const table = run("sql", "SELECT body FROM messages ORDER BY at", "--limit", "1");
    assert.equal(table.stdout, "body\n----\nNull\n");
    assert.match(table.stderr, /developer's own store.*read-only, not rule-filtered/);
    assert.match(table.stderr, /1 row\(s\) — more rows exist/);
    const data = run("data", "messages", "--limit", "1");
    assert.equal(data.stdout.trim().split("\n").length, 1);
    assert.equal(typeof JSON.parse(data.stdout).body, "string");
    assert.match(data.stderr, /… more rows \(increase --limit\)/);
    const allData = run("data", "messages", "--limit", "205");
    assert.equal(allData.stdout.trim().split("\n").map(line => JSON.parse(line)).length, 205);
    assert.equal(allData.stderr, "");
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
      if (code === "E_SQL_INTERNAL") assert.ok(JSON.parse(result.stdout).denied.message.includes("`\\dt` lists tables; `\\d messages` describes one"));
    }
    const db = new DatabaseSync(join(dir, ".snapback4/store.sqlite"));
    try {
      assert.equal(db.prepare("PRAGMA journal_mode").get().journal_mode, "wal");
      db.exec("BEGIN IMMEDIATE; UPDATE r SET data=data");
      // Even with the writer lock held, SQL finishes and sees committed rows.
      const started = performance.now();
      assert.deepEqual(answer("SELECT count(*) FROM messages").rows, [[205]]);
      assert.deepEqual(answer("\\dt"), catalog);
      assert.deepEqual(answer("\\d messages"), description);
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
  const catalog = JSON.parse(run("sql", "\\dt", "--release", join(dir, "release"), "--json").stdout);
  assert.deepEqual(catalog.tables.find(t => t.name === "todos").rows, {count: 0, exact: true});
  const missing = join(dir, "missing");
  const refused = invoke("sql", "SELECT 1", "--release", missing, "--json");
  assert.equal(refused.status, 1);
  assert.equal(JSON.parse(refused.stdout).denied.code, "E_STORE");
  assert.equal(existsSync(missing), false);
});

test("check --fix repairs every remaining guessed spelling and the repaired program runs", (t) => {
  const { dir, invoke, run } = fixture(t);
  mkdirSync(join(dir, "snapback"));
  const file = join(dir, "snapback/schema.q");
  writeFileSync(file, "# header\n// another header\nquery choose(cond: bool, a: int, b: int):\n  return cond ? a : b -- keep\nquery member():\n  a = { b: 7 }\n  return a?.b\nquery size():\n  return len([1, 2, 3])\n");
  const before = invoke("check", "--json");
  assert.equal(before.status, 1);
  assert.ok(JSON.parse(before.stdout).problems.some((d) => d.code === "E_QUARRY_UNSUPPORTED" && d.mechanical));
  run("check", "--fix");
  const repaired = read(file);
  assert.match(repaired, /-- header\n-- another header/);
  assert.match(repaired, /a if cond else b/);
  assert.match(repaired, /return a\.b\n/);
  assert.match(repaired, /len\(\[1, 2, 3\]\)/);
  assert.match(repaired, /-- keep/);
  assert.equal(JSON.parse(run("run", "choose", '{"cond":true,"a":5,"b":9}', "--json").stdout).data, 5);
  assert.equal(JSON.parse(run("run", "member", "--json").stdout).data, 7);
  assert.equal(JSON.parse(run("run", "size", "--json").stdout).data, 3);
});

test("check --cost describes expression ranges, filtered probes, pages and seeks", (t) => {
  const { dir, run } = fixture(t);
  mkdirSync(join(dir, "snapback"));
  writeFileSync(join(dir, "snapback/schema.q"), "table items:\n  n: int\n  by byN: n, id\n  read <- allow\nquery scan(n: int, c: cursor ?):\n  total = 0\n  for i in range(0, n + 1):\n    total = total + i\n  return items[] after c first 10 by byN where .n > total and exists items[.id]\nquery seek(n: int, c: cursor ?):\n  return items[n > n] after c first 10 by byN\n");
  const output = run("check", "--cost").stdout;
  for (const text of ["steps ≤ meter", "filter over ≤ examined ceiling", "probe × examined", "prefix seek", "consume this page"]) assert.ok(output.includes(text), output);
  const structured = run("check", "--cost", "--json");
  assert.equal(JSON.parse(structured.stdout).ok, true);
  assert.match(structured.stderr, /steps ≤ meter/);
  assert.ok(output.endsWith(structured.stderr));
});

test("processDevice requires its directory synchronously before spawning", () => {
  let spawned = 0;
  const spawn = () => { spawned++; throw new Error("must not spawn"); };
  for (const options of [undefined, null, "devices", {}, { dir: undefined, spawn }, { dir: null, spawn }, { dir: 7, spawn }, { dir: {}, spawn }, { dir: "", spawn }, { dir: " \t\n", spawn }]) {
    assert.throws(() => processDevice(options), { name: "Error", message: "processDevice needs { dir }: the directory its stores live in" });
  }
  assert.equal(spawned, 0);
});

test("processDevice imports without Node builtins and opens with injected host functions", () => {
  const result = spawnSync(process.execPath, ["--input-type=module", "-e", `
    import assert from "node:assert/strict";
    import { registerHooks } from "node:module";
    registerHooks({ resolve(specifier, context, next) {
      if (specifier.startsWith("node:")) throw new Error("Node builtin unavailable: " + specifier);
      return next(specifier, context);
    } });
    const { processDevice } = await import(${JSON.stringify(new URL("../dist/native.js", import.meta.url).href)});
    const writes = [], spawns = [];
    let killed = 0, receive;
    const opener = processDevice({ dir: "devices/", binary: "host-cli", writeFile: async (...args) => { writes.push(args); }, spawn: (...args) => {
      spawns.push(args);
      return { stdin: { write(text) { assert.deepEqual(JSON.parse(text), { op: "probe" }); queueMicrotask(() => receive('{"ok":42}\\n')); } },
        stdout: { on(event, listener) { receive = listener; queueMicrotask(() => receive('{"ok":true}\\n')); } }, kill() { killed++; } };
    } });
    const core = await opener.open("alice", { fixture: true });
    assert.deepEqual(writes, [["devices/alice.sqlite.backend.json", '{"fixture":true}']]);
    assert.deepEqual(spawns, [["host-cli", ["device", "devices/alice.sqlite", "devices/alice.sqlite.backend.json"]]]);
    assert.deepEqual(await core.call({ op: "probe" }), { ok: 42 });
    await core.close();
    const cold = await opener.open("alice", null);
    assert.equal(writes.length, 1);
    assert.deepEqual(spawns[1], ["host-cli", ["device", "devices/alice.sqlite"]]);
    await cold.close();
    assert.equal(killed, 2);
  `], { encoding: "utf8", timeout: hangBudget() });
  assert.equal(result.status, 0, result.stdout + result.stderr);
});

test("CLI and Node device share environment, platform-package and repository binary resolution", async (t) => {
  const { dir } = fixture(t);
  const pkgDir = join(dir, "packages/snapback4");
  const platformDir = join(pkgDir, `node_modules/snapback4-${process.platform}-${process.arch}`);
  for (const path of [join(pkgDir, "dist"), join(pkgDir, "bin"), platformDir, join(dir, "target/release"), join(dir, "target/debug")]) mkdirSync(path, { recursive: true });
  writeFileSync(join(pkgDir, "package.json"), '{"type":"module"}');
  for (const file of ["dist/native.js", "dist/resolve-binary.js", "bin/snapback4.js"]) copyFileSync(join(root, "packages/snapback4", file), join(pkgDir, file));
  writeFileSync(join(platformDir, "package.json"), '{"name":"fixture"}');
  const candidates = [join(dir, "override"), join(platformDir, "snapback4"), join(dir, "target/release/snapback4"), join(dir, "target/debug/snapback4")];
  for (const file of candidates) writeFileSync(file, "binary resolution fixture");
  const env = { ...process.env, SNAPBACK4_BIN: "./override" };
  for (const expected of candidates) {
    const cli = spawnSync(process.execPath, ["--input-type=module", "-e", `
      import childProcess from "node:child_process";
      import { EventEmitter } from "node:events";
      import { syncBuiltinESMExports } from "node:module";
      childProcess.spawn = (binary) => {
        console.log(binary);
        const child = new EventEmitter();
        child.kill = () => {};
        queueMicrotask(() => child.emit("exit", 0));
        return child;
      };
      syncBuiltinESMExports();
      await import(${JSON.stringify(join(pkgDir, "bin/snapback4.js"))});
    `], { cwd: dir, env, encoding: "utf8", timeout: hangBudget() });
    assert.equal(cli.status, 0, cli.stderr);
    assert.equal(realpathSync(cli.stdout.trim()), realpathSync(expected));
    const device = spawnSync(process.execPath, ["--input-type=module", "-e", `
      import { processDevice } from ${JSON.stringify(join(pkgDir, "dist/native.js"))};
      const opener = processDevice({ dir: "unused", spawn(binary) {
        console.log(binary);
        return { stdin: { write() {} }, stdout: { on(event, receive) { queueMicrotask(() => receive('{"ok":true}\\n')); } }, kill() {} };
      }, writeFile: async () => {} });
      await (await opener.open("alice", null)).close();
    `], { cwd: dir, env, encoding: "utf8", timeout: hangBudget() });
    assert.equal(device.status, 0, device.stderr);
    assert.equal(realpathSync(device.stdout.trim()), realpathSync(expected));
    rmSync(expected);
  }
  const missing = spawnSync(process.execPath, [join(pkgDir, "bin/snapback4.js")], { cwd: dir, env, encoding: "utf8", timeout: hangBudget() });
  assert.equal(missing.status, 2);
  assert.match(missing.stderr, /^snapback4: no binary for /);
});

// Wave 3: scripts read stdout and stderr through one handler, SIGKILLed the
// wrapper and orphaned the binary, and compared /dev/status's pid to the
// wrapper's. The tagged ready line, both PIDs and the parent-death stop.
test("the npm wrapper's dev prints a tagged ready line, reports both PIDs and stops when the wrapper is SIGKILLed", { timeout: hangBudget(5) }, async (t) => {
  const { dir, run } = fixture(t);
  run("init");
  const wrapper = spawn(process.execPath, [join(root, "packages/snapback4/bin/snapback4.js"), "dev", "--port", "0", "--memory", "--no-watch"],
    { cwd: dir, env: { ...process.env, SNAPBACK4_BIN: binary }, stdio: ["ignore", "pipe", "pipe"] });
  let merged = "", closed = false;
  wrapper.stdout.on("data", data => { merged += data; });
  wrapper.stderr.on("data", data => { merged += data; });
  wrapper.stdout.on("close", () => { closed = true; });
  const wrapperExit = once(wrapper, "exit");
  let server;
  t.after(() => { try { if (server) process.kill(server, "SIGKILL"); } catch { /* gone */ } });
  const ready = await awaitState(() => merged.match(/^SNAPBACK4_READY verb=dev generation=\d+ url=(http:\/\/127\.0\.0\.1:\d+) pid=(\d+) wrapperPid=(\d+)$/m), "the tagged ready line", { diagnostics: () => merged });
  const [, url, pid, wrapperPid] = ready;
  server = Number(pid);
  assert.equal(Number(wrapperPid), wrapper.pid);
  assert.notEqual(server, wrapper.pid);
  // stdout's first line is still the URL alone.
  assert.ok(merged.includes(`${url}\n`), merged);
  const status = await (await fetch(`${url}/dev/status`, { signal: AbortSignal.timeout(hangBudget()) })).json();
  assert.equal(status.pid, server);
  assert.equal(status.wrapperPid, wrapper.pid);
  assert.ok(merged.includes(`pid ${server}, wrapper pid ${wrapper.pid}`), merged);
  // SIGKILL cannot be forwarded; the binary stops itself when its parent is gone.
  wrapper.kill("SIGKILL");
  await wrapperExit;
  await awaitState(async () => {
    if (!closed) return false;
    try { await fetch(`${url}/dev/status`, { signal: AbortSignal.timeout(2000) }); return false; } catch { return true; }
  }, "the server stops with its SIGKILLed wrapper", { diagnostics: () => merged });
  assert.match(merged, /SNAPBACK4_SIGNAL verb=dev generation=\d+ reason=SIGTERM/);
  server = undefined;
});

test("processDevice defaults to Node spawn and file writing in a new directory", (t) => {
  const { dir } = fixture(t);
  // Node stands in for the CLI here; native-e2e runs the actual Rust device.
  writeFileSync(join(dir, "device"), `
    const fs = require("node:fs");
    const readline = require("node:readline");
    const backend = JSON.parse(fs.readFileSync(process.argv[3], "utf8"));
    console.log(JSON.stringify({ ok: true }));
    readline.createInterface({ input: process.stdin }).on("line", line => {
      console.log(JSON.stringify({ ok: { backend, request: JSON.parse(line) } }));
    });
  `);
  const result = spawnSync(process.execPath, ["--input-type=module", "-e", `
    import assert from "node:assert/strict";
    import { readFile } from "node:fs/promises";
    import { processDevice } from ${JSON.stringify(new URL("../dist/native.js", import.meta.url).href)};
    const backend = { fixture: true };
    const core = await processDevice({ dir: "new/devices", binary: process.execPath }).open("alice", backend);
    try {
      assert.deepEqual(await core.call({ op: "probe" }), { ok: { backend, request: { op: "probe" } } });
      assert.equal(await readFile("new/devices/alice.sqlite.backend.json", "utf8"), JSON.stringify(backend));
    } finally { await core.close(); }
  `], { cwd: dir, encoding: "utf8", timeout: hangBudget() });
  assert.equal(result.error, undefined);
  assert.equal(result.status, 0, result.stdout + result.stderr);
});


test("Expo starter selects web, native and online app devices with explicit session stores", async (t) => {
  const { dir, run } = fixture(t);
  run("init", "--expo");
  const compiled = ts.transpileModule(read(join(dir, "src/client.ts")), { compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS } }).outputText;
  for (const [platform, native, tier] of [["web", false, "web"], ["ios", true, "native"], ["ios", false, "online"]]) {
    const nativeDevice = {}, webDevice = {}, webStore = {};
    const sessions = new Map();
    const secureStore = {
      getItemAsync: async key => sessions.get(key) ?? null,
      setItemAsync: async (key, value) => { assert.match(key, /^[\w.-]+$/); sessions.set(key, value); },
      deleteItemAsync: async key => { sessions.delete(key); },
    };
    let options;
    const context = { exports: {}, process: { env: {} }, URLSearchParams, window: { location: { search: "" } }, require: name => {
      if (name === "./intents") {
        const child = { exports: {} };
        const helper = ts.transpileModule(read(join(dir, "src/intents.ts")), { compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS } }).outputText;
        vm.runInNewContext(helper, child); return child.exports;
      }
      if (name === "./intent-store") return { intentStorage: { getItem: () => null, setItem: () => {}, removeItem: () => {} } };
      if (name === "react-native") return { Platform: { OS: platform } };
      if (name === "snapback4/witness-web") return { registerWebWitness: () => {} };
      if (name === "snapback4/app") return { createApp: value => { options = value; return value; } };
      if (name === "snapback4/auth") return { localStorageSessionStore: () => webStore };
      if (name === "snapback4/web") return { webDevice: () => webDevice };
      if (name === "snapback4-expo/witness") return { smokeOrigin: fallback => fallback };
      if (name === "snapback4-expo") return { nativeAvailable: () => native, nativeDevice, secureStoreSessionStore };
      if (name === "expo-secure-store") return secureStore;
      return {};
    } };
    vm.runInNewContext(compiled, context);
    assert.equal(context.exports.tier, tier);
    assert.equal(options.device, tier === "web" ? webDevice : native ? nativeDevice : undefined);
    assert.ok(options.sessionStore);
    if (tier === "web") assert.equal(options.sessionStore, webStore);
    else {
      await options.sessionStore.set("https://backend.test/session", "kept-session");
      assert.equal(await options.sessionStore.get("https://backend.test/session"), "kept-session");
      await options.sessionStore.delete("https://backend.test/session");
      assert.equal(await options.sessionStore.get("https://backend.test/session"), null);
    }
  }
});

for (const pkg of ["snapback4", "snapback4-expo"]) test(`${pkg} README teaches background proof and reading its result`, () => {
  const readme = read(join(root, "packages", pkg, "README.md"));
  for (const fact of ["npm run export:ios", "background QoS", "npx snapback4 witness status --wait", "npx snapback4 doctor", "npm run native:smoke", "supersedes pending proof", "without failing a successful export"])
    assert.ok(readme.includes(fact), `${pkg}: missing ${fact}`);
  assert.ok(!readme.includes("SNAPBACK4_NATIVE_SMOKE=off"));
});


test("smoke origin preserves ordinary/remote app configuration and accepts only simulator loopback", () => {
  const compiled = ts.transpileModule(read(join(root, "packages/snapback4-expo/src/witness.ts")), { compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS } }).outputText;
  for (const [launch, expected] of [[null, "https://app.example"], [{ smoke: false, origin: "http://127.0.0.1:1234" }, "https://app.example"], [{ smoke: true, origin: "https://other.example" }, "https://app.example"], [{ smoke: true, origin: "http://127.0.0.1:1234" }, "http://127.0.0.1:1234"]]) {
    const context = { exports: {}, require: name => name === "expo-modules-core" ? { requireOptionalNativeModule: () => launch && ({ witnessLaunch: JSON.stringify(launch) }) } : {} };
    vm.runInNewContext(compiled, context);
    assert.equal(context.exports.smokeOrigin("https://app.example"), expected);
  }
});

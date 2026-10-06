import test from "node:test";
import assert from "node:assert/strict";
import { execFile, spawnSync } from "node:child_process";
import { promisify } from "node:util";
import { symlinkSync, writeFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { DatabaseSync } from "node:sqlite";
import ts from "typescript";
import { signup, login, logout } from "snapback4/auth";
import { createClient } from "snapback4/client";
import { binary, server } from "./helpers/app-server.mjs";
import { hangBudget } from "./helpers/wait.mjs";

const exec = promisify(execFile);
const root = resolve(import.meta.dirname, "../../..");

test("guide auth runs headlessly; two password accounts sign in and enforce own-row writes", { timeout: hangBudget(12) }, async t => {
  const guide = spawnSync(binary, ["guide", "auth"], { encoding: "utf8" });
  assert.equal(guide.status, 0, guide.stderr);
  for (const alias of ["headless", "signup", "sign-up", "register", "replay adapter"]) {
    // One argument also exercises the quoted multi-word CLI spelling.
    const found = spawnSync(binary, ["guide", alias], { encoding: "utf8" });
    assert.equal(found.status, 0, `${alias}: ${found.stderr}`);
    assert.equal(found.stdout, guide.stdout, `${alias} opens the auth recipe`);
  }
  const quarry = [...guide.stdout.matchAll(/```quarry\n([\s\S]*?)```/g)].map(m => m[1]);
  const scripts = [...guide.stdout.matchAll(/```js\n([\s\S]*?)```/g)].map(m => m[1]);
  assert.equal(quarry.length, 1);
  assert.equal(scripts.length, 1);
  const { url, dir } = await server(t, undefined, quarry[0] + `
table notes:
  owner: principal
  body: text <=200
  by byOwner: owner, id
  read <- .owner = viewer
  insert <- .owner = viewer
  update <- .owner = viewer
mutation add(owner: principal, body: text <=200):
  return insert notes { owner, body }
mutation edit(id: notes, body: text <=200):
  update notes[id] { body }
query list():
  return notes[viewer] first 100 by byOwner
`);
  symlinkSync(join(root, "node_modules"), join(dir, "node_modules"), "dir");
  const script = join(dir, "seed.mjs");
  writeFileSync(script, scripts[0]);
  // Compile the literal published JS and generated API, then execute that same file.
  const program = ts.createProgram([script], { allowJs: true, checkJs: true, noEmit: true,
    strict: true, skipLibCheck: true, target: ts.ScriptTarget.ES2022,
    module: ts.ModuleKind.NodeNext, moduleResolution: ts.ModuleResolutionKind.NodeNext,
    allowImportingTsExtensions: true, types: ["node"], typeRoots: [join(root, "node_modules/@types")] });
  const diagnostics = ts.getPreEmitDiagnostics(program);
  assert.equal(diagnostics.length, 0, ts.formatDiagnosticsWithColorAndContext(diagnostics, {
    getCanonicalFileName: n => n, getCurrentDirectory: () => dir, getNewLine: () => "\n",
  }));
  const password = "headless-private-test-password";
  const run = mode => exec(process.execPath, [script], { cwd: dir,
    env: { ...process.env, SNAPBACK_URL: url, SEED_PASSWORD: password, SEED_AUTH: mode } });
  await assert.rejects(run("singup"), error => {
    assert.match(error.stderr, /SEED_AUTH must be signup or login/);
    assert.equal(error.stdout, "");
    assert.equal(error.stderr.includes(password), false);
    return true;
  });
  const registered = await run("signup"), signedIn = await run("login");
  const first = registered.stdout.trim();
  assert.match(first, /^user:/);
  assert.equal(signedIn.stdout.trim(), first, "login recovers the guide's account");
  await assert.rejects(run("signup"), error => {
    assert.match(error.stderr, /E_AUTH: that email already has an account; sign in instead/);
    assert.equal(error.stdout, "");
    assert.equal(error.stderr.includes(password), false);
    return true;
  });
  const second = await signup(url, "seed2@example.test", password);
  assert.equal(second.ok, true);
  assert.notEqual(second.session.principal, first);
  await logout(url, second.session.token);
  const clients = [];
  for (const email of ["seed1@example.test", "seed2@example.test"]) {
    const account = await login(url, email, password);
    assert.equal(account.ok, true);
    const client = createClient({ url, session: account.session });
    clients.push(client);
    t.after(() => client.signOut());
    assert.equal((registered.stdout + signedIn.stdout + registered.stderr + signedIn.stderr).includes(account.session.token), false);
  }
  const { api } = await import(join(dir, "snapback/generated/api.ts"));
  const [alice, bob] = clients;
  const rows = [];
  for (const client of clients) {
    const write = await client.mutate(api.add, { owner: client.viewer(), body: "own note" });
    assert.equal(write.state, "sent");
    rows.push(write.result.id);
  }
  const forged = await bob.mutate(api.add, { owner: alice.viewer(), body: "forged owner" });
  assert.equal(forged.state, "failed");
  assert.equal(forged.why.code, "E_RULE");
  const crossUser = await bob.mutate(api.edit, { id: rows[0], body: "cross-user edit" });
  assert.equal(crossUser.state, "failed");
  assert.equal(crossUser.why.code, "NOT_FOUND", "hidden rows do not reveal their existence");
  for (const [n, client] of clients.entries()) {
    const read = await client.query(api.list, {});
    assert.equal(read.complete, true);
    assert.deepEqual(read.data.map(row => [row.id, row.body]), [[rows[n], "own note"]]);
  }
  assert.equal((await login(url, "seed1@example.test", "wrong-password")).ok, false);
  assert.equal((registered.stdout + signedIn.stdout + registered.stderr + signedIn.stderr).includes(password), false);
  const db = new DatabaseSync(join(dir, ".snapback4/store.sqlite"), { readOnly: true });
  try {
    const credentials = db.prepare("SELECT hash FROM _credentials").all();
    assert.equal(credentials.length, 2);
    assert.ok(credentials.every(row => row.hash.startsWith("$argon2id$") && !row.hash.includes(password)));
    assert.notEqual(credentials[0].hash, credentials[1].hash, "equal passwords have independent salts");
  } finally { db.close(); }
});

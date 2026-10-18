import test from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, rmSync, readdirSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { cli, deploy, startDev, startServe, seedAccounts, rollback } from "../dist/proof.js";
import { login, signup } from "../dist/auth.js";
const root = fileURLToPath(new URL("../../../", import.meta.url));
process.env.SNAPBACK4_BIN ??= join(root, "target/debug/snapback4");
const guide = readFileSync(join(root, "crates/snapback4-lang/src/guide/staging.md"), "utf8");
const schema = guide.match(/```quarry\n([\s\S]*?)\n```/)[1];
function fixture(t) {
  const cwd = mkdtempSync(join(tmpdir(), "sb4-staging-"));
  mkdirSync(join(cwd, "snapback")); writeFileSync(join(cwd, "snapback/schema.q"), schema);
  t.after(() => rmSync(cwd, { recursive: true, force: true })); return cwd;
}
const config = async host => (await fetch(host.url + "/auth/config")).json();
const post = async (host, path, token, args = {}) => (await fetch(host.url + path, { method: "POST",
  headers: { "content-type": "application/json", ...(token ? { authorization: `Bearer ${token}` } : {}) }, body: JSON.stringify({ args }), signal: AbortSignal.timeout(10000) })).json();
const seedUsers = { roles: { admin: 2, member: 2 }, provision: { name: "provision" } };

test("staging accounts are real password users; service grants obey rules; marker survives release switches", { timeout: 90000 }, async t => {
  const cwd = fixture(t);
  await deploy("staging", "snapback", { cwd, args: ["--staging"] });
  let host = await startServe("staging", { cwd, seedUsers });
  try {
    assert.equal((await config(host)).environment, "staging");
    assert.equal((await config(host)).development, false);
    for (const [role, accounts] of Object.entries(host.sessions)) {
      assert.equal(accounts.length, 2);
      for (const account of accounts) {
        assert.ok(account.principal.startsWith("user:"));
        const signed = await login(host.url, account.email, account.password); assert.equal(signed.ok, true);
        const me = await post(host, "/q/myRole", signed.session.token); assert.equal(me.data.role, role);
        assert.equal((await post(host, "/m/add", signed.session.token, { body: "real user data" })).state, "sent");
        const forged = await post(host, "/m/provision", signed.session.token, { principal: account.principal, role: "admin" });
        assert.equal(forged.why.code, "NOT_OPERATOR");
      }
    }
    for (const path of ["/seed", "/dev/reset", "/dev/clock/advance", "/dev/jobs/foo", "/dev/token"]) {
      assert.equal((await fetch(host.url + path, { method: "POST", body: "[]" })).status, 403, path);
    }
    assert.equal((await fetch(host.url + "/q/myRole", { method: "POST", headers: { "x-snapback-persona": "alice" }, body: '{"args":{}}' })).status, 401);
    const v2 = join(cwd, "v2"); mkdirSync(v2); writeFileSync(join(v2, "schema.q"), schema + "\nquery version():\n  return 2\n");
    await deploy("staging", v2, { cwd }); assert.equal((await config(host)).environment, "staging");
    await rollback("staging", 1, { cwd }); assert.equal((await config(host)).environment, "staging");
    const repeated = await cli(["deploy", "staging", "--schema", "snapback", "--staging"], { cwd });
    assert.equal(repeated.code, 0, repeated.stderr);
    const token = await host.operatorToken();
    for (const file of readdirSync(join(cwd, "logs"))) assert.ok(!readFileSync(join(cwd, "logs", file), "utf8").includes(token), "operator token never enters logs");
  } finally { await host.stop(); }
  host = await startServe("staging", { cwd });
  try { assert.equal((await config(host)).environment, "staging"); } finally { await host.stop(); }
});

test("production cannot be relabelled; bulk setup refuses before token mint or account creation; first admin uses explicit operator", { timeout: 60000 }, async t => {
  const cwd = fixture(t);
  await deploy("production", "snapback", { cwd });
  let host = await startServe("production", { cwd });
  try {
    assert.equal((await config(host)).environment, "production");
    let minted = false;
    await assert.rejects(seedAccounts({ url: host.url, operatorToken: async () => { minted = true; return "must not mint"; } }, seedUsers), /E_STAGING:/);
    assert.equal(minted, false);
    const relabel = await cli(["deploy", "production", "--staging"], { cwd });
    assert.notEqual(relabel.code, 0); assert.match(relabel.stderr, /E_STAGING.*cannot be relabelled/);
    const account = await signup(host.url, "first@example.test", "operator-selected-password"); assert.equal(account.ok, true);
    assert.equal((await post(host, "/q/myRole", account.session.token)).data, null, "signup grants no role");
    assert.equal((await post(host, "/m/provision", account.session.token, { principal: account.session.principal, role: "admin" })).why.code, "NOT_OPERATOR");
    assert.equal((await post(host, "/m/provision", await host.operatorToken(), { principal: account.session.principal, role: "admin" })).state, "sent");
    assert.equal((await post(host, "/q/myRole", account.session.token)).data.role, "admin");
  } finally { await host.stop(); }
  await assert.rejects(startServe("production", { cwd, seedUsers }), /E_STAGING:/, "failed setup cleans up its own host");
  const relabel = await cli(["deploy", "production", "--staging"], { cwd }); assert.notEqual(relabel.code, 0);
});

test("password dev closes fixture and persona doors; explicit opt-in, declared cast, and persistent defaults", { timeout: 90000 }, async t => {
  const cwd = fixture(t);
  let host = await startDev({ cwd, args: ["--no-watch"] });
  try {
    assert.deepEqual(await config(host).then(({ development, devDoors, environment }) => ({ development, devDoors, environment })), { development: true, devDoors: false, environment: "development" });
    for (const path of ["/seed", "/dev/status", "/dev/catalog", "/dev/reset", "/dev/clock/advance", "/dev/jobs/foo"]) {
      const response = await fetch(host.url + path, { method: path.endsWith("status") || path.endsWith("catalog") ? "GET" : "POST", body: path.endsWith("status") || path.endsWith("catalog") ? undefined : "[]" });
      assert.equal(response.status, 403, path);
    }
    await assert.rejects(host.now(), /unsafe-dev-doors/);
    const account = await signup(host.url, "persistent@example.test", "persistent-password"); assert.equal(account.ok, true);
  } finally { await host.stop(); }
  host = await startDev({ cwd, args: ["--unsafe-dev-doors", "--no-watch"] });
  try {
    assert.equal((await config(host)).devDoors, true);
    assert.equal((await login(host.url, "persistent@example.test", "persistent-password")).ok, true, "default dev preserves password verifiers across restart");
    assert.equal((await fetch(host.url + "/dev/status")).status, 200);
    assert.equal((await fetch(host.url + "/q/myRole", { method: "POST", headers: { "x-snapback-persona": "undeclared" }, body: '{"args":{}}' })).status, 401, "empty cast admits no persona");
  } finally { await host.stop(); }
  host = await startDev({ cwd, args: ["--memory", "--no-watch"] });
  try { assert.equal((await login(host.url, "persistent@example.test", "persistent-password")).ok, false, "memory explicitly isolates accounts"); }
  finally { await host.stop(); }
});

test("adopting password-only identity closes existing dev doors and declared personas", { timeout: 60000 }, async t => {
  const cwd = fixture(t);
  writeFileSync(join(cwd, "snapback/schema.q"), schema.replace("use identity password", "use identity\nuse personas alice"));
  const host = await startDev({ cwd, args: ["--memory"] });
  try {
    assert.equal((await config(host)).devDoors, true);
    assert.equal((await fetch(host.url + "/q/myRole", { method: "POST", headers: { "x-snapback-persona": "alice" }, body: '{"args":{}}' })).status, 200);
    writeFileSync(join(cwd, "snapback/schema.q"), schema + "\nuse personas alice\n");
    const end = Date.now() + 10000;
    while ((await config(host)).devDoors && Date.now() < end) await new Promise(resolve => setTimeout(resolve, 50));
    assert.equal((await config(host)).devDoors, false);
    assert.equal((await fetch(host.url + "/seed", { method: "POST", body: "[]" })).status, 403);
    assert.equal((await fetch(host.url + "/q/myRole", { method: "POST", headers: { "x-snapback-persona": "alice" }, body: '{"args":{}}' })).status, 401);
  } finally { await host.stop(); }
});

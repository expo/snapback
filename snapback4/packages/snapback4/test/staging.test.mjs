import test from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, rmSync, readdirSync } from "node:fs";
import { tmpdir, networkInterfaces } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { cli, deploy, startDev, startServe, seedAccounts, rollback } from "../dist/proof.js";
import { createClient } from "../dist/client.js";
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

test("staging accepts the generated handle of a qualified mutation module", { timeout: 60000 }, async t => {
  const cwd = fixture(t);
  const provision = schema.match(/mutation provision[\s\S]*?(?=query myRole)/)[0];
  writeFileSync(join(cwd, "snapback/schema.q"), schema.replace(provision, ""));
  writeFileSync(join(cwd, "snapback/accounts.q"), provision);
  const checked = await cli(["check"], { cwd }); assert.equal(checked.code, 0, checked.stderr);
  const generated = await import(new URL("file://" + join(cwd, "snapback/generated/api.ts")));
  assert.equal(generated.api.accounts.provision.name, "accounts.provision");
  await deploy("staging", "snapback", { cwd, args: ["--staging"] });
  const host = await startServe("staging", { cwd, seedUsers: { roles: { member: 1 }, provision: generated.api.accounts.provision } });
  try { assert.equal(host.sessions.member.length, 1); } finally { await host.stop(); }
});

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
        assert.equal(account.kind, "user");
        const client = createClient({url:host.url, session:account});
        try { assert.equal((await client.query({name:"myRole"}, {})).data.role, role); }
        finally { await client.close(); }
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
    assert.ok(Math.abs((await host.now()) - Date.now()) < 5000, "operator-authenticated clock reads work while fixture doors stay closed");
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


test("MIG staging clock is operator-only and production never accepts an offset", { timeout: 90000 }, async t => {
  const cwd = fixture(t);
  let persistedSkew = 0;
  await deploy("production", "snapback", { cwd });
  await assert.rejects(startServe("production", { cwd, clockOffset: "+4h" }), /E_CLOCK_DEV_ONLY/);
  let host = await startServe("production", { cwd });
  try {
    await assert.rejects(host.now(), /E_CLOCK_DEV_ONLY/);
    const token = await host.operatorToken();
    const refused = await fetch(host.url + "/dev/clock/advance", { method: "POST", headers: { Authorization: `Bearer ${token}` }, body: '{"duration":"+1h"}' });
    assert.equal(refused.status, 403); assert.equal((await refused.json()).denied.code, "E_CLOCK_DEV_ONLY");
  } finally { await host.stop(); }
  await deploy("staging", "snapback", { cwd, args: ["--staging"] });
  host = await startServe("staging", { cwd, clockOffset: "+4h", seedUsers: { roles: { member: 1 }, provision: { name: "provision" } } });
  try {
    const before = await host.now(); assert.ok(Math.abs(before - Date.now() - 4 * 3600000) < 5000);
    for (const token of [undefined, host.sessions.member[0].token]) {
      const response = await fetch(host.url + "/dev/clock/advance", { method: "POST", headers: token ? { Authorization: `Bearer ${token}` } : {}, body: '{"duration":"+1h"}' });
      assert.equal(response.status, 403); assert.equal((await response.json()).denied.code, "E_AUTH");
    }
    const advanced = await host.advance("+2h"); assert.ok(Math.abs(advanced.now - before - 7200000) < 5000);
    const result = await cli(["clock", "advance", "+1h", "--release", "staging"], { cwd });
    assert.equal(result.code, 0, result.stderr); assert.ok((await host.now()) - advanced.now >= 3600000);
    const token = await host.operatorToken();
    for (const path of ["/seed", "/dev/reset", "/dev/jobs/foo"]) assert.equal((await fetch(host.url + path, { method: "POST", headers: { Authorization: `Bearer ${token}` }, body: "[]" })).status, 403, path);
    persistedSkew = (await host.now()) - Date.now();
  } finally { await host.stop(); }
  host = await startServe("staging", { cwd });
  try { assert.ok(Math.abs((await host.now()) - Date.now() - persistedSkew) < 5000, "restart retains the durable staging offset"); } finally { await host.stop(); }
});


test("MIG hot adoption and exact previews use both signs of the staging clock", {timeout:90000}, async t=>{
 const cwd=fixture(t);
 const base=`use identity password
table facts:
  owner: principal
  opensAt: time
  expiresAt: time
  not before .opensAt
  expire at .expiresAt
  read <- .owner = viewer
  insert <- .owner = viewer
  online only
table reports:
  owner: principal
  fact: facts
  read <- .owner = viewer
  insert <- .owner = viewer
  online only
mutation fact(opensAt: time, expiresAt: time):
  return insert facts {owner:viewer, opensAt, expiresAt}
mutation report(fact: facts):
  require exists facts[fact] else NOT_FOUND
  return insert reports {owner:viewer, fact}
query readReport(id: reports):
  return reports[id]
`;
 mkdirSync(join(cwd,"v2"));
 const nonloop=Object.values(networkInterfaces()).flat().find(n=>n && !n.internal && n.family==="IPv4")?.address;
 if(!nonloop)t.diagnostic("non-loopback bind witness unavailable: no external IPv4 interface");
 for(const bind of [undefined,...(nonloop?[nonloop]:[])])for(const offset of ["-2h","+2h"]){
  // A not-before store already deployed at wall time has a disclosure floor.
  // Test negative expiry without that floor; positive tests not-before as well.
  const current=offset==="-2h"?base.replace("  not before .opensAt\n",""):base;
  writeFileSync(join(cwd,"snapback/schema.q"),current);
  const v2=current.replace("table reports:","table reports:\n  copied: time").replace("return insert reports {owner:viewer, fact}","f = facts[fact] ! else NOT_FOUND\n  return insert reports {owner:viewer, fact, copied:f.expiresAt}")+`backfill reports deadlines(fact: facts):
  {copied:(facts[fact] ! else NOT_FOUND).expiresAt}
`;
  writeFileSync(join(cwd,"v2/schema.q"),v2);
  const dir=(offset==="-2h"?"negative":"positive")+(bind?"-lan":"");
  await deploy(dir,"snapback",{cwd,args:["--staging"]});
  const host=await startServe(dir,{cwd,clockOffset:offset,...(bind?{args:["--bind",bind,"--i-understand-cleartext"]}:{})});
  try{
   const account=await signup(host.url,dir+"@example.test","valid-staging-test-password");assert.equal(account.ok,true);
   const expiresAt=Date.now()+(offset==="-2h"?-3600000:10800000);
   const fact=await post(host,"/m/fact",account.session.token,{opensAt:offset==="-2h"?0:Date.now()+3600000,expiresAt});assert.equal(fact.state,"sent",JSON.stringify(fact));
   const report=await post(host,"/m/report",account.session.token,{fact:fact.result.id});assert.equal(report.state,"sent",JSON.stringify(report));
   const preview=await cli(["deploy",dir,"--schema","v2","--check"],{cwd});assert.equal(preview.code,0,preview.stderr+preview.stdout);assert.match(preview.stdout,/transformed 1 row/);
   await deploy(dir,"v2",{cwd});
   const got=await post(host,"/q/readReport",account.session.token,{id:report.result.id});assert.equal(got.data.copied,expiresAt,offset);
   const status=await cli(["releases",dir,"--json"],{cwd});assert.equal(status.code,0,status.stderr);if(!bind)assert.ok(Math.abs((await host.now()) - Date.now() - (offset==="-2h"?-7200000:7200000))<5000);
  }finally{await host.stop();}
 }
});


test("DX4 custom provisioning merges principal/role and chooses its authorized service seat", {timeout:60000}, async t => {
  const cwd=fixture(t);
  writeFileSync(join(cwd,"snapback/schema.q"), schema.replaceAll("service:operator","service:ops").replace("role: enum('admin', 'member')):","role: enum('admin', 'member'), label: text <=100):"));
  await deploy("staging","snapback",{cwd,args:["--staging"]});
  const host=await startServe("staging",{cwd,seedUsers:{roles:{member:1},provision:{name:"provision"},service:"ops",args:()=>({label:"custom-only",role:"admin"})}});
  try {
    const user=host.sessions.member[0];
    assert.equal((await post(host,"/q/myRole",user.token)).data.role,"admin","custom keys override defaults; principal remains merged");
    await assert.rejects(host.seedAccounts({roles:{member:1},provision:{name:"provision"},service:"bad:seat"}),/E_STAGING_INPUT/);
  } finally {await host.stop();}
});

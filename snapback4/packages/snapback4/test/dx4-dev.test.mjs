import test from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, rmSync, readdirSync } from "node:fs";
import { tmpdir, networkInterfaces } from "node:os";
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

test("DX4 memory dev service token discovers the right host with closed doors", {timeout:60000}, async t => {
  const cwd=fixture(t);
  const first=await startDev({cwd,args:["--memory","--no-watch"]});
  let second;
  try {
    const mint=await cli(["token","--service","operator","--quiet"],{cwd});
    assert.equal(mint.code,0,mint.stderr);
    const signed=await signup(first.url,"memory@example.test","memory-password");assert.equal(signed.ok,true);
    assert.equal((await post(first,"/m/provision",mint.stdout.trim(),{principal:signed.session.principal,role:"admin"})).state,"sent");
    for (const port of ["not-a-port","65536","-1","0"]) {
      const bad=await cli(["token","--service","operator","--port",port,"--quiet"],{cwd});assert.notEqual(bad.code,0);assert.equal(bad.stdout,"");assert.match(bad.stderr,/--port must/);
    }
    second=await startDev({cwd,args:["--memory","--no-watch"]});
    const ambiguous=await cli(["token","--service","operator","--quiet"],{cwd});assert.notEqual(ambiguous.code,0);assert.match(ambiguous.stderr,/multiple live dev/);
    const selected=await cli(["token","--service","operator","--port",new URL(first.url).port,"--quiet"],{cwd});assert.equal(selected.code,0,selected.stderr);
    assert.equal((await post(first,"/q/myRole",selected.stdout.trim())).denied,undefined);
    assert.ok((await post(second,"/q/myRole",selected.stdout.trim())).denied,"selected token cannot cross memory hosts");
    assert.equal((await fetch(first.url+"/dev/status")).status,403,"token discovery opens no fixture doors");
    const clock=await cli(["clock","advance","8d","--port",new URL(first.url).port],{cwd});assert.equal(clock.code,0,clock.stderr);
    assert.equal(JSON.parse(clock.stdout).sessionsPreserved,true);assert.match(clock.stderr,/keep their remaining lifetime/);
    assert.equal((await post(first,"/q/myRole",signed.session.token)).data.role,"admin","authenticated dev clock preserves the existing user session with fixture doors closed");
  } finally {await second?.stop();await first.stop();}
});

test("DX4 clock/reset explain session recovery and freshly minted dev service tokens use the host clock", {timeout:60000}, async t => {
  const cwd=fixture(t);const host=await startDev({cwd,args:["--memory","--unsafe-dev-doors","--no-watch"]});
  try {
    const signed=await signup(host.url,"clock@example.test","clock-password");assert.equal(signed.ok,true);
    const jump=await cli(["clock","advance","8d","--port",new URL(host.url).port],{cwd});assert.equal(jump.code,0,jump.stderr);
    assert.match(jump.stderr,/keep their remaining lifetime/);assert.equal(JSON.parse(jump.stdout).sessionsPreserved,true);
    assert.equal((await post(host,"/q/myRole",signed.session.token)).data,null,"the default jump preserves the signed-in session");
    const expiry=await cli(["clock","advance","8d","--expire-sessions","--port",new URL(host.url).port],{cwd});assert.equal(expiry.code,0,expiry.stderr);
    assert.match(expiry.stderr,/Sign in again/);assert.equal(JSON.parse(expiry.stdout).sessionsPreserved,false);
    assert.ok((await post(host,"/q/myRole",signed.session.token)).denied);
    const fresh=await login(host.url,"clock@example.test","clock-password");assert.equal(fresh.ok,true);
    const mint=await cli(["token","--service","operator","--quiet"],{cwd});assert.equal(mint.code,0,mint.stderr);
    assert.equal((await post(host,"/m/provision",mint.stdout.trim(),{principal:fresh.session.principal,role:"admin"})).state,"sent");
    const reset=await fetch(host.url+"/dev/reset",{method:"POST",body:"{}"}).then(r=>r.json());assert.match(reset.sessionNotice,/removed its accounts and sessions/);
    assert.equal((await login(host.url,"clock@example.test","clock-password")).ok,false);
  } finally {await host.stop();}
});


test("DX4 store conflicts name the recorded owner PID and disposable-memory fix", {timeout:30000}, async t => {
 const cwd=fixture(t);const host=await startDev({cwd,args:["--no-watch"]});
 try {
  await assert.rejects(startDev({cwd,args:["--no-watch"],timeoutMs:10000}),error=>{
   assert.match(error.message,/E_STORE_BUSY/);assert.match(error.message,new RegExp("pid "+host.pid));assert.match(error.message,/--memory/);return true;
  });
 }finally{await host.stop();}
});

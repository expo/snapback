import './test-npm-cache.mjs';
import { guideReference } from "./publication-guide.mjs";
// Execute the packed staging guide verbatim; production refuses bulk setup.
import assert from "node:assert/strict";
import { mkdirSync, writeFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { spawnSync } from "node:child_process";
import { runToolchainCommand } from "./publication-starters.mjs";

export async function proveStaging(client, platform, directory) {
  const cwd = join(resolve(directory), "staging-recipe"); mkdirSync(cwd, { recursive: true });
  const env = { ...process.env, npm_config_audit: "false", npm_config_fund: "false" };
  delete env.SNAPBACK4_BIN; delete env.PORT_LO; delete env.PORT_HI;
  const run = (cmd, args, extra = {}) => runToolchainCommand(cmd, args, { cwd, env: { ...env, ...extra }, timeout: 300_000 });
  writeFileSync(join(cwd, "package.json"), '{"private":true,"type":"module"}');
  await run("npm", ["install", "--ignore-scripts", "--no-audit", "--no-fund", resolve(client), resolve(platform)]);
  const cli = join(cwd, "node_modules/snapback4/bin/snapback4.js");
  const guide = ({status:0,stderr:"",stdout:guideReference(cli,"staging",{cwd,env})});
  // The source of every executed recipe is the
  // installed binary's card, never this checkout's authoring text.
  assert.equal(guide.status, 0, guide.stderr);
  const text = guide.stdout;
  assert.equal(typeof text, "string");
  const schema = [...text.matchAll(/```quarry\n([\s\S]*?)\n```/g)].map(match => match[1]);
  const scripts = [...text.matchAll(/```js\n([\s\S]*?)\n```/g)].map(match => match[1]);
  assert.equal(schema.length, 1); assert.equal(scripts.length, 2);
  mkdirSync(join(cwd, "snapback")); writeFileSync(join(cwd, "snapback/schema.q"), schema[0]);
  await run(process.execPath, [cli, "check"]);
  writeFileSync(join(cwd, "staging.mjs"), scripts[0]); writeFileSync(join(cwd, "first-admin.mjs"), scripts[1]);
  await run(process.execPath, ["staging.mjs", "--once"]);
  await run(process.execPath, [cli, "deploy", "production"]);
  await run(process.execPath, ["first-admin.mjs"], { FIRST_ADMIN_EMAIL: "chosen-admin@example.test", FIRST_ADMIN_PASSWORD: "explicit-production-password" });
  await run(process.execPath, ["first-admin.mjs"], { FIRST_ADMIN_EMAIL: "chosen-admin@example.test", FIRST_ADMIN_PASSWORD: "explicit-production-password" });
  writeFileSync(join(cwd, "verify.mjs"), verify);
  await run(process.execPath, ["verify.mjs"]);
  return { status: "passed", guide: "staging", recipes: "verbatim installed card", roles: { admin: 2, member: 2 },
    mode: "serve", realPasswordLogin: "passed", data: "passed", selfGrant: "refused", productionBulkSeed: "refused before mint", productionRelabel: "refused", firstAdmin: "passed", privateCredentials: "0600" };
}

const verify = String.raw`
import assert from "node:assert/strict";
import {readFileSync, readdirSync, statSync} from "node:fs";
import {startServe, seedAccounts, cli} from "snapback4/proof";
import {login} from "snapback4/auth";
const plan = {roles:{admin:2,member:2},provision:{name:"provision"}};
const credentialsFiles=readdirSync(".").filter(name=>/^staging-users-[a-f0-9-]{36}\.json$/.test(name));
assert.equal(credentialsFiles.length,1,"the installed guide writes one uniquely named credentials file");
const credentialsFile=credentialsFiles[0];
const sessions=JSON.parse(readFileSync(credentialsFile,"utf8"));
assert.equal(statSync(credentialsFile).mode & 0o777,0o600);
let host=await startServe("staging", {clockOffset:"+25h"});
const post=async(path,token,args={})=>(await fetch(host.url+path,{method:"POST",headers:{"content-type":"application/json",authorization:"Bearer "+token},body:JSON.stringify({args}),signal:AbortSignal.timeout(10000)})).json();
try {
 const config=await fetch(host.url+"/auth/config").then(r=>r.json());
 assert.equal(config.development,false); assert.equal(config.devDoors,false); assert.equal(config.environment,"staging");
 for(const [role,users] of Object.entries(sessions)){
  assert.equal(users.length,2);
  for(const user of users){
   const signed=await login(host.url,user.email,user.password);assert.equal(signed.ok,true);assert.ok(signed.session.principal.startsWith("user:"));
   assert.equal((await post("/q/myRole",signed.session.token)).data.role,role);
   assert.equal((await post("/q/myNotes",signed.session.token)).data[0].body,"Welcome "+role);
   assert.equal((await post("/m/provision",signed.session.token,{principal:user.principal,role:"admin"})).why.code,"NOT_OPERATOR");
  }
 }
 const now=await host.now(); assert.ok(Math.abs(now-Date.now()-25*3600000)<5000);
 const advanced=await host.advance("+2h"); assert.ok(advanced.now-now>=2*3600000);
 const clock=await cli(["clock","advance","+1h","--release","staging"]);assert.equal(clock.code,0,clock.stderr);
 assert.ok(await host.now()-advanced.now>=3600000);
 for(const path of ["/seed","/dev/reset","/dev/clock/advance","/dev/jobs/foo","/dev/token"])
  assert.equal((await fetch(host.url+path,{method:"POST",body:"[]"})).status,403,path);
} finally {await host.stop();}
host=await startServe("production");
try {
 assert.equal((await fetch(host.url+"/auth/config").then(r=>r.json())).environment,"production");
 let minted=false;
 await assert.rejects(seedAccounts({url:host.url,operatorToken:async()=>{minted=true;throw Error("must not mint");}},plan),/E_STAGING:/);
 assert.equal(minted,false);
 const relabel=await cli(["deploy","production","--staging"]);assert.notEqual(relabel.code,0);assert.match(relabel.stderr,/E_STAGING/);
 const signed=await login(host.url,"chosen-admin@example.test","explicit-production-password");assert.equal(signed.ok,true);
 assert.equal((await post("/q/myRole",signed.session.token)).data.role,"admin");
} finally {await host.stop();}
await assert.rejects(startServe("production",{seedUsers:plan}),/E_STAGING:/);
console.log("packed staging: serve, real users/data, first admin, production refusal passed");
`;

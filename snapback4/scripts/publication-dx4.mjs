// Packed DX4 witnesses; every changed guide recipe is read from the installed CLI.
import assert from "node:assert/strict";
import {proveWave19} from "./publication-wave19.mjs";
import {mkdirSync, writeFileSync, rmSync, mkdtempSync} from "node:fs";
import {join, resolve} from "node:path";
import {spawnSync} from "node:child_process";
import {runToolchainCommand} from "./publication-starters.mjs";
export async function proveDX4(directory) {
  const parent=resolve(directory), cwd=mkdtempSync(join(parent,"dx4-"));
  const cli=join(parent,"node_modules/snapback4/bin/snapback4.js");
  const env={...process.env};delete env.SNAPBACK4_BIN;delete env.PORT_LO;delete env.PORT_HI;
  const run=(args)=>runToolchainCommand(process.execPath,args,{cwd,env,timeout:180000});
  const card=async(name,section)=>{
    const result=spawnSync(process.execPath,[cli,"guide",name,...(section?["--section",section]:["--full"])],{cwd,env,encoding:"utf8",timeout:30000,maxBuffer:4*1024*1024});
    assert.equal(result.status,0,result.stderr);return result.stdout;
  };
  const fences=(text,kind)=>[...text.matchAll(new RegExp("```"+kind+"\\n([\\s\\S]*?)\\n```","g"))].map(m=>m[1]);
  try {
    mkdirSync(join(cwd,"snapback"));
    const assets=await card("uploads","Placement replay");
    const assetSchema=fences(assets,"quarry"),assetScripts=fences(assets,"js");
    assert.equal(assetSchema.length,1);assert.equal(assetScripts.length,1);
    writeFileSync(join(cwd,"snapback/schema.q"),assetSchema[0]);await run([cli,"check"]);
    writeFileSync(join(cwd,"placements.mjs"),assetScripts[0]);await run(["placements.mjs"]);
    const personas=await card("personas");
    writeFileSync(join(cwd,"snapback/schema.q"),fences(personas,"quarry")[0]);await run([cli,"check"]);
    writeFileSync(join(cwd,"personas.mjs"),fences(personas,"js")[0]);
    writeFileSync(join(cwd,"local.mjs"),local);
    await run(["local.mjs"]);
    // Builders first see the default truncated view, not --full.
    for (const name of ["start","cheatsheet","personas"]) {
      const reply=spawnSync(process.execPath,[cli,"guide",name],{cwd,env,encoding:"utf8",timeout:30000});
      assert.equal(reply.status,0,reply.stderr);assert.match(reply.stdout,/guide staging/,`default guide ${name} must surface staging`);
      if(name==="cheatsheet") {assert.match(reply.stdout,/deploy staging --staging/);assert.match(reply.stdout,/serve staging/);}
    }
    const wave19=await proveWave19(cwd,run,fences(await card("staging"),"quarry")[0]);
    return {wave19,status:"passed",recipes:"verbatim installed guide",uploads:"file hint, one home, foreign upload refusal, reference and download",staging:"discoverable, custom seat and merged args",dev:"memory mint selection, clock and reset recovery",upgrade:"project warning scan"};
  } finally {rmSync(cwd,{recursive:true,force:true});}
}
const local=String.raw`
import assert from "node:assert/strict";
import {writeFileSync, mkdirSync} from "node:fs";
import {spawnSync} from "node:child_process";
import {cli,deploy,startDev,startServe} from "snapback4/proof";
import {signup,login} from "snapback4/auth";
let host=await startDev({args:["--memory","--no-watch"]});
try {
 const reply=spawnSync(process.execPath,["personas.mjs"],{env:{...process.env,SNAPBACK_URL:host.url,SEED_PASSWORD:"local-example-password"},encoding:"utf8",timeout:30000});assert.equal(reply.status,0,reply.stderr);
 const again=spawnSync(process.execPath,["personas.mjs"],{env:{...process.env,SNAPBACK_URL:host.url,SEED_PASSWORD:"local-example-password"},encoding:"utf8",timeout:30000});assert.equal(again.status,0,again.stderr);
 const mint=await cli(["token","--service","operator","--quiet"]);assert.equal(mint.code,0,mint.stderr);
 const who=await fetch(host.url+"/q/whoAmI",{method:"POST",headers:{authorization:"Bearer "+mint.stdout.trim()},body:'{"args":{}}'}).then(r=>r.json());assert.equal(who.data,"service:operator");
} finally {await host.stop();}
writeFileSync("snapback/schema.q","use identity password\ntable roles:\n  principal: principal\n  role: enum('admin','member')\n  unique principal\n  immutable principal\n  read <- .principal = viewer or viewer = 'service:ops'\n  insert <- viewer = 'service:ops'\n  update <- viewer = 'service:ops'\n  online only\nmutation provision(principal: principal, role: enum('admin','member'), label: text <=100):\n  require viewer = 'service:ops' else NOT_OPERATOR\n  return upsert roles[principal] {principal,role}\nquery myRole():\n  return roles[viewer]\n");
await deploy("staging","snapback",{args:["--staging"]});
host=await startServe("staging",{seedUsers:{roles:{member:1},provision:{name:"provision"},service:"ops",args:()=>({label:"extra",role:"admin"})}});
try {
 const user=host.sessions.member[0];const role=await fetch(host.url+"/q/myRole",{method:"POST",headers:{authorization:"Bearer "+user.token},body:'{"args":{}}'}).then(r=>r.json());assert.equal(role.data.role,"admin");
 const before=await host.now();assert.ok(await host.advance("8d")-before>=8*86400000);
 assert.equal((await login(host.url,user.email,user.password)).ok,true);
}finally{await host.stop();}
host=await startDev({args:["--memory","--unsafe-dev-doors","--no-watch"]});
try {
 const signed=await signup(host.url,"clock@example.test","clock-example-password");assert.equal(signed.ok,true);
 const clock=await cli(["clock","advance","8d","--port",new URL(host.url).port]);assert.equal(clock.code,0,clock.stderr);assert.match(clock.stderr,/Sign in again/);
 const token=await cli(["token","--service","ops","--quiet"]);assert.equal(token.code,0,token.stderr);
 const reset=await fetch(host.url+"/dev/reset",{method:"POST",body:"{}"}).then(r=>r.json());assert.match(reset.sessionNotice,/removed its accounts/);
}finally{await host.stop();}
const {upgradeWarnings}=await import("../node_modules/snapback4/bin/upgrade-warnings.js");
mkdirSync("scripts");writeFileSync("scripts/accept.mjs",'startDev(); fetch("/seed"); fetch("/dev/reset");');
const warnings=upgradeWarnings(process.cwd(),"use identity password");assert.match(warnings.join("\n"),/scripts\/accept.mjs/);assert.match(warnings.join("\n"),/--memory/);
console.log("DX4 packed local/provisioning/upgrade cases passed");
`;

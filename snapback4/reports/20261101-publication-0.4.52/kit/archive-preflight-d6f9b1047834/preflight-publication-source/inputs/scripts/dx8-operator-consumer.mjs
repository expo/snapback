import './test-npm-cache.mjs';
// Runs unchanged from a packed client/platform installation in the cwd.
import assert from "node:assert/strict";
import {mkdirSync,writeFileSync,readFileSync,existsSync,unlinkSync} from "node:fs";
import {spawn,execFileSync} from "node:child_process";
import {createClient} from "snapback4/client";
import {narrowSession,signup} from "snapback4/auth";
import {cli,command,deploy,startDev,startServe,cleanup} from "snapback4/proof";

mkdirSync("snapback",{recursive:true});
writeFileSync("snapback/schema.q",`use identity password
table roles:
  principal: principal
  role: enum('member')
  unique principal
  read <- .principal = viewer
  insert <- viewer = 'service:operator'
  online only
mutation provision(principal: principal, role: enum('member')):
  require viewer = 'service:operator' else NOT_OPERATOR
  return upsert roles[principal] {principal, role}
query myRole():
  return roles[viewer]
`);
assert.equal((await cli(["check"])).code,0);

// Password development keeps fixture doors closed while an operator clock is
// available. Both full and read session families reconcile after the jump.
let dev=await startDev({args:["--no-watch"]});
let full,read,expiringFull,expiringRead;
let jumped;
try{
 const signed=await signup(dev.url,"dx8@example.test","dx8-password");assert.equal(signed.ok,true);
 const operator=await dev.operatorToken();
 let response=await fetch(dev.url+"/m/provision",{method:"POST",headers:{authorization:`Bearer ${operator}`,"content-type":"application/json"},body:JSON.stringify({args:{principal:signed.session.principal,role:"member"}})});
 assert.equal(response.status,200);assert.equal((await response.json()).state,"sent");
 const narrowed=await narrowSession(dev.url,signed.session);assert.equal(narrowed.ok,true);
 full=createClient({url:dev.url,session:signed.session});read=createClient({url:dev.url,session:narrowed.session,readOnly:true,waitSeconds:1});
 assert.equal((await full.query({kind:"query",name:"myRole"},{})).data.role,"member");
 assert.equal((await read.query({kind:"query",name:"myRole"},{})).data.role,"member");
 assert.equal((await fetch(dev.url+"/seed",{method:"POST",body:"[]"})).status,403,"fixture door remains closed");
 const before=await dev.now();jumped=await dev.advance("8d");assert.ok(jumped.now-before>=8*86400000);
 assert.equal((await full.query({kind:"query",name:"myRole"},{})).data.role,"member");
 assert.equal((await read.query({kind:"query",name:"myRole"},{})).data.role,"member");
 assert.ok(full.session().expiresAt>signed.session.expiresAt);assert.ok(read.session().expiresAt>narrowed.session.expiresAt);
 const expiring=await signup(dev.url,"dx8-expire@example.test","dx8-password");assert.equal(expiring.ok,true);
 const expiringNarrow=await narrowSession(dev.url,expiring.session);assert.equal(expiringNarrow.ok,true);
 expiringFull=createClient({url:dev.url,session:expiring.session});expiringRead=createClient({url:dev.url,session:expiringNarrow.session,readOnly:true,waitSeconds:1});
 assert.equal((await expiringFull.query({kind:"query",name:"myRole"},{})).denied,undefined);
 assert.equal((await expiringRead.query({kind:"query",name:"myRole"},{})).denied,undefined);
 await dev.advance("8d",{sessions:"expire"});
 assert.equal((await expiringFull.query({kind:"query",name:"myRole"},{})).denied?.code,"E_AUTH");
 assert.equal((await expiringRead.query({kind:"query",name:"myRole"},{})).denied?.code,"E_AUTH");
}finally{await cleanup(()=>full?.close(),()=>read?.close(),()=>expiringFull?.close(),()=>expiringRead?.close(),()=>dev.stop());}
dev=await startDev({args:["--no-watch"]});
try{assert.ok(await dev.now()<jumped.now-7*86400000,"development clock returns to wall time on restart");}
finally{await dev.stop();}

// Production account provisioning uses the same role plan/ordinary mutation
// contract as staging, and a retained server can stop itself by directory.
await deploy("production","snapback");
let host=await startServe("production",{provisionUsers:{roles:{member:1},provision:{name:"provision"}}});
try{
 const user=host.sessions.member[0],client=createClient({url:host.url,session:user});
 try{assert.equal((await client.query({kind:"query",name:"myRole"},{})).data.role,"member");}
 finally{await client.close();}
 const stopped=await cli(["stop","production"]);assert.equal(stopped.code,0,stopped.stderr);assert.match(stopped.stdout,/store stopped/);
}finally{await host.stop();}
host=await startServe("production");await host.stop();

// npm's shell and descendants share keeper custody. Establish a real child
// tree before testing exit cleanup; a separate command retains timeout coverage.
// @ref LLP 3000.037.000#18-bounded-package-reference-and-wiring-lookups-tok6 — packed verification retains positive readiness rather than racing npm startup.
writeFileSync("hold.mjs",`import{spawn}from'node:child_process';import{writeFileSync,existsSync,renameSync}from'node:fs';const c=spawn(process.execPath,['-e','setInterval(()=>{},1000)']);writeFileSync(process.argv[2]+'.tmp',JSON.stringify([process.pid,c.pid]));renameSync(process.argv[2]+'.tmp',process.argv[2]);setInterval(()=>{if(existsSync('finish'))process.exit(7)},25);`);
const manifest=JSON.parse(readFileSync("package.json","utf8"));manifest.scripts={...(manifest.scripts??{}),hold:"node hold.mjs npm-pids.json"};writeFileSync("package.json",JSON.stringify(manifest));
const marker=file=>{try{return JSON.parse(readFileSync(file,"utf8"));}catch(error){if(error.code!=="ENOENT")throw error;}};
const waitFor=async(accepts,label)=>{const end=performance.now()+30000;while(performance.now()<end){if(accepts())return;await new Promise(r=>setTimeout(r,20));}assert.fail(label);};
const live=pid=>{
 try{return !execFileSync("ps",["-p",String(pid),"-o","stat="],{encoding:"utf8",timeout:30000,stdio:["ignore","pipe","pipe"]}).trim().startsWith("Z");}
 catch(error){if(error.status===1&&!String(error.stdout).trim())return false;throw error;}
};
const started=file=>waitFor(()=>{const pids=marker(file);return Array.isArray(pids)&&pids.length===2&&pids.every(pid=>Number.isSafeInteger(pid)&&pid>0)&&pids[0]!==pids[1]&&pids.every(live);},`proof descendants never started: ${file}`);
const gone=file=>waitFor(()=>marker(file)?.every(pid=>!live(pid)),`proof process tree survived: ${file}`);
const running=command("npm",["run","--silent","hold"],{timeoutMs:120000,stopTimeoutMs:30000});
void running.catch(()=>{});
try{await started("npm-pids.json");}
finally{writeFileSync("finish","yes");}
assert.equal((await running).code,7);await gone("npm-pids.json");
await assert.rejects(command(process.execPath,["-e","setInterval(()=>{},1000)"],{timeoutMs:300,stopTimeoutMs:30000}),/timed out/);
unlinkSync("finish");
writeFileSync("caller.mjs",`import{command}from'snapback4/proof';command(process.execPath,['hold.mjs','caller-pids.json'],{timeoutMs:60000});setInterval(()=>{},1000);`);
const caller=spawn(process.execPath,["caller.mjs"],{stdio:"ignore"});
const closed=new Promise(resolve=>caller.once("close",resolve));
try{await started("caller-pids.json");}
finally{caller.kill("SIGKILL");await closed;}
await gone("caller-pids.json");
console.log("DX8 operator consumer passed: dev auth clock/session families, production accounts, retained stop, npm/caller-death group cleanup");

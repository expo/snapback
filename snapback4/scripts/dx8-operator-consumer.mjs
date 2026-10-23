// Runs unchanged from a packed client/platform installation in the cwd.
import assert from "node:assert/strict";
import {mkdirSync,writeFileSync,readFileSync,existsSync} from "node:fs";
import {spawn} from "node:child_process";
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
let full,read;
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
}finally{await cleanup(()=>full?.close(),()=>read?.close(),()=>dev.stop());}
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

// npm's shell and every descendant share keeper custody. Timeout and abrupt
// caller death both remove the complete tree rather than just the direct child.
writeFileSync("hold.mjs",`import{spawn}from'node:child_process';import{writeFileSync}from'node:fs';const c=spawn(process.execPath,['-e','setInterval(()=>{},1000)']);writeFileSync(process.argv[2],JSON.stringify([process.pid,c.pid]));setInterval(()=>{},1000);`);
const manifest=JSON.parse(readFileSync("package.json","utf8"));manifest.scripts={...(manifest.scripts??{}),hold:"node hold.mjs npm-pids.json"};writeFileSync("package.json",JSON.stringify(manifest));
await assert.rejects(command("npm",["run","--silent","hold"],{timeoutMs:300,stopTimeoutMs:300}),/timed out/);
const gone=async file=>{for(let n=0;n<100;n++){if(readFileSync(file,"utf8").length){const pids=JSON.parse(readFileSync(file,"utf8"));if(pids.every(pid=>{try{process.kill(pid,0);return false}catch(e){return e.code==="ESRCH"}}))return;}await new Promise(r=>setTimeout(r,20));}assert.fail(`proof process tree survived: ${file}`);};
await gone("npm-pids.json");
writeFileSync("caller.mjs",`import{command}from'snapback4/proof';command(process.execPath,['hold.mjs','caller-pids.json'],{timeoutMs:60000});setInterval(()=>{},1000);`);
const caller=spawn(process.execPath,["caller.mjs"],{stdio:"ignore"});
for(let n=0;n<100&&(!existsSync("caller-pids.json")||!readFileSync("caller-pids.json","utf8").length);n++)await new Promise(r=>setTimeout(r,20));
caller.kill("SIGKILL");await new Promise(resolve=>caller.once("exit",resolve));await gone("caller-pids.json");
console.log("DX8 operator consumer passed: dev auth clock/session families, production accounts, retained stop, npm/caller-death group cleanup");

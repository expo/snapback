// The same executable case runs against source dist and the installed tarball.
import assert from "node:assert/strict";
import {mkdirSync, writeFileSync} from "node:fs";
import {deploy, startServe, cli} from "snapback4/proof";
import {createClient} from "snapback4/client";
import {createApp} from "snapback4/app";
import {narrowSession, memorySessionStore, sessionKey} from "snapback4/auth";
import {processDevice} from "snapback4/native";


mkdirSync("snapback", {recursive:true});
writeFileSync("snapback/schema.q", `use identity password
table roles:
  principal: principal
  role: enum('admin', 'member')
  unique principal
  read <- .principal = viewer
  insert <- viewer = 'service:operator'
  update <- viewer = 'service:operator'
  online only
mutation provision(principal: principal, role: enum('admin', 'member')):
  require viewer = 'service:operator' else NOT_OPERATOR
  return upsert roles[principal] {principal, role}
query myRole():
  return roles[viewer]
table items:
  owner: principal
  deadline: time
  status: enum('pending', 'expired')
  read <- .owner = viewer
  insert <- .owner = viewer
  update <- .owner = viewer
  online only
mutation add():
  return insert items {owner:viewer, deadline:now + 21d, status:'pending'}
mutation approve(id: id):
  item = items[id] ! else MISSING
  require item.status = 'pending' else ALREADY_SWEPT
  require now < item.deadline else DEADLINE
  return true
query mine():
  return items where .owner = viewer first 50 by .id
job sweep():
  for item in items by .id:
    if item.deadline <= now:
      update items[item.id] {status:'expired'}
schedule expiryHourly every 1h: sweep
`);
await deploy("staging", "snapback", {args:["--staging"]});
let host = await startServe("staging", {seedUsers:{roles:{member:1},provision:{name:"provision"}}});
let user = host.sessions.member[0];
let retainedRead;
let localApp;
const readStore=memorySessionStore(), localStore=memorySessionStore();
const post = async (path,args={}) => {
  const response=await fetch(host.url+path,{method:"POST",headers:{authorization:`Bearer ${user.token}`,"content-type":"application/json"},body:JSON.stringify({args}),signal:AbortSignal.timeout(10000)});
  return {status:response.status,body:await response.json()};
};
try {
  assert.equal(user.kind,"user");
  for (const session of [user,{principal:user.principal,token:user.token},{principal:user.principal,token:user.token,expiresAt:new Date(user.expiresAt).toISOString()}]) {
    const client=createClient({url:host.url,session});
    try {assert.equal((await client.query({name:"myRole"},{})).data.role,"member");}
    finally {await client.close();}
  }
  const narrowed=await narrowSession(host.url,user);assert.ok(narrowed.ok);
  retainedRead=createClient({url:host.url,session:narrowed.session,readOnly:true});
  assert.equal((await retainedRead.query({kind:"query",name:"myRole"},{})).data.role,"member");
  await localStore.set(sessionKey(host.url),JSON.stringify(user));
  const device=processDevice({dir:"clock-device",...(process.env.SNAPBACK4_BIN?{binary:process.env.SNAPBACK4_BIN}:{})});
  localApp=createApp({url:host.url,device,sessionStore:localStore,waitSeconds:1});
  assert.equal((await localApp.ready).ok,true);
  const added=await post("/m/add");assert.equal(added.body.state,"sent");
  const id=added.body.result.id;
  const before=await host.now();
  const report=await host.advance("22d",{drain:false});
  assert.ok(report.now-before>=22*86400000);
  assert.equal(report.maintenancePaused,true);
  assert.equal(Number(report),report.now);assert.equal(+report,report.now);
  assert.equal(new Date(report).getTime(),report.now);
  const retained=await retainedRead.query({kind:"query",name:"myRole"},{});
  assert.equal(retained.data.role,"member","retained read session survives its original expiry");
  assert.ok(retainedRead.session().expiresAt>user.expiresAt);
  assert.ok(retainedRead.session().token===narrowed.session.token,"preservation never rotates read bearers");
  // Restored read metadata may itself be locally expired. Only authenticated
  // classified-staging timing, not the caller's literal, can supersede it.
  await readStore.set(sessionKey(host.url,true),JSON.stringify({...narrowed.session,expiresAt:Date.now()-1,capExpiresAt:Date.now()-1}));
  const restoredRead=createApp({url:host.url,readOnly:true,sessionStore:readStore});
  try {
    assert.equal((await restoredRead.ready).ok,true);
    assert.equal((await restoredRead.client.query({kind:"query",name:"myRole"},{})).data.role,"member");
  } finally {await restoredRead.close();}
  const keptRead=JSON.parse(await readStore.get(sessionKey(host.url,true)));
  assert.ok(keptRead.expiresAt>user.expiresAt);assert.ok(keptRead.token===narrowed.session.token,"restored read bearer unchanged");
  assert.equal((await localApp.client.query({kind:"query",name:"myRole"},{})).data.role,"member");
  await localApp.close();localApp=undefined;
  // The device retains its advanced clock while custody intentionally restores
  // the original full-session bytes. Startup must reconcile before the floor check.
  await localStore.set(sessionKey(host.url),JSON.stringify(user));
  localApp=createApp({url:host.url,device,sessionStore:localStore,waitSeconds:1});
  assert.equal((await localApp.ready).ok,true);
  assert.equal((await localApp.client.query({kind:"query",name:"myRole"},{})).data.role,"member");
  const approval=await post("/m/approve",{id});
  assert.equal(approval.body.why.code,"DEADLINE","mutation runs before due sweeps");
  const live=await post("/q/mine");assert.equal(live.status,200);assert.equal(live.body.data[0].status,"pending");
  // Several maintenance ticks must not sneak a sweep in while paused.
  await new Promise(resolve=>setTimeout(resolve,1200));
  assert.equal((await post("/q/mine")).body.data[0].status,"pending");
  const drained=await host.drain();assert.equal(drained.maintenancePaused,false);
  assert.equal(drained.fired[0].name,"expiryHourly");
  assert.equal((await post("/q/mine")).body.data[0].status,"expired");
  const cliPause=await cli(["clock","advance","1ms","--release","staging","--no-drain"]);
  assert.equal(cliPause.code,0,cliPause.stderr);assert.equal(JSON.parse(cliPause.stdout).maintenancePaused,true);
  const cliDrain=await cli(["clock","drain","--release","staging","--allow-held"]);
  assert.equal(cliDrain.code,0,cliDrain.stderr);assert.equal(JSON.parse(cliDrain.stdout).maintenancePaused,false);
  await host.advance("8d",{sessions:"expire"});
  assert.equal((await post("/q/mine")).status,401,"explicit mode still expires sessions");
} finally {
  const cleanup=await Promise.allSettled([retainedRead?.close(),localApp?.close()]);
  await host.stop();
  for(const result of cleanup) if(result.status==="rejected") throw result.reason;
}
host=await startServe("staging");
try {
  const before=await host.now();
  await assert.rejects(host.advance("1h"),error=>/E_CLOCK_HELD/.test(error.message)&&!error.report.now);
  assert.ok((await host.now())-before<60000,"held refusal moves no time");
  const refused=await cli(["clock","advance","1h","--release","staging"]);
  assert.notEqual(refused.code,0);assert.match(refused.stderr,/E_CLOCK_HELD/);
  const accepted=await host.advance("1h",{allowHeld:true});
  assert.equal(accepted.held[0].holdCode,"saved-boundary");
} finally {await host.stop();}
console.log("DX6 packed clock: legacy sessions, actual kind, numeric coercion, 22-day preserved user, mutation-before-sweep, drain, explicit expiry and no-effect held refusal passed");

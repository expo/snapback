import assert from "node:assert/strict";
import { mkdirSync, writeFileSync } from "node:fs";
import { cli, deploy, startServe } from "snapback4/proof";
import { signup } from "snapback4/auth";
mkdirSync("snapback",{recursive:true});
writeFileSync("snapback/schema.q",`use identity password
table names:
  owner: principal
  key: text 1..80
  n: int
  unique key else NAME_TAKEN
  read <- .owner = viewer
  insert <- .owner = viewer
  online only
mutation claim(key: text 1..80):
  return insert names {owner:viewer, key, n:1}
mutation ordinary(key: text 1..80, owner: principal):
  return insert names {owner, key, n:1}
mutation probe(key: text 1..80):
  row = names[key] ! else NOT_FOUND
  require row.n > 1 else TOO_LOW
  return row.n
query optional(key: text 1..80):
  return names[key]
`);
const checked=await cli(["check","--json"]);assert.equal(checked.code,0,checked.stderr);
const notes=JSON.parse(checked.stdout).notes;
assert.ok(notes.some(n=>n.code==="N_LOOKUP_FILTERED" && /read <- \.owner = viewer/.test(n.message)));
assert.ok(notes.some(n=>n.code==="N_UNIQUE_HIDDEN" && /NAME_TAKEN.*E_RULE/.test(n.message)));
await deploy("staging","snapback",{args:["--staging"]});
const host=await startServe("staging");
try {
  const alice=await signup(host.url,"alice@example.test","diagnostic-password"),bob=await signup(host.url,"bob@example.test","diagnostic-password");
  assert.equal(alice.ok,true);assert.equal(bob.ok,true);
  const post=async(route,session,args)=>fetch(host.url+route,{method:"POST",headers:{authorization:`Bearer ${session.token}`},body:JSON.stringify({args}),signal:AbortSignal.timeout(10000)}).then(r=>r.json());
  const own=await post("/m/claim",alice.session,{key:"PRIVATE-HANDLE"});assert.equal(own.state,"sent");
  const collision=await post("/m/claim",bob.session,{key:"PRIVATE-HANDLE"});
  const ordinary=await post("/m/ordinary",bob.session,{key:"fresh",owner:alice.session.principal});
  assert.equal(collision.why.code,"E_RULE");assert.deepEqual(collision.why,ordinary.why);
  assert.doesNotMatch(JSON.stringify(collision),new RegExp(`PRIVATE-HANDLE|NAME_TAKEN|${own.result.id}`));
  assert.match(collision.why.message,/else CODE.*readable conflict/);
  assert.equal((await post("/m/claim",alice.session,{key:"PRIVATE-HANDLE"})).why.code,"NAME_TAKEN");
  const hidden=await post("/m/probe",bob.session,{key:"PRIVATE-HANDLE"}),missing=await post("/m/probe",bob.session,{key:"missing"});
  assert.equal(hidden.why.code,"NOT_FOUND");assert.deepEqual(hidden.why,missing.why);
  const hiddenRead=await post("/q/optional",bob.session,{key:"PRIVATE-HANDLE"}),missingRead=await post("/q/optional",bob.session,{key:"missing"});
  assert.equal(hiddenRead.data,null);assert.deepEqual(hiddenRead,missingRead);
  const data=await cli(["data","names","--json","--release","staging"]);assert.equal(data.code,0,data.stderr);
  const envelope=JSON.parse(data.stdout);assert.equal(envelope.rows.length,1);assert.equal(envelope.more,false);assert.equal(envelope.limit,50);
  console.log("DX5 diagnostics: located advice, hidden/missing equality, generic/private and named/readable conflicts, JSON rows passed");
} finally {await host.stop();}

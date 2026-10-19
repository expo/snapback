// Wave-19 DX4 consumer witnesses run with installed package bytes and real limits.
import assert from "node:assert/strict";
import {writeFileSync} from "node:fs";
import {join} from "node:path";
export async function proveWave19(cwd,run,stagingSchema) {
  writeFileSync(join(cwd,"wave19-sdk.mjs"),sdk);
  await run(["wave19-sdk.mjs"]);
  writeFileSync(join(cwd,"snapback/schema.q"),stagingSchema);
  writeFileSync(join(cwd,"wave19-seed.mjs"),seed);
  await run(["wave19-seed.mjs"]);
  return {identity:"real 30/minute limits: SDK guest and proof seedUsers honor retryAfterMs",lifecycle:"worker-held store release precedes stop resolution, rollback and deploy",inspection:"default 50-row JSON more and explicit limit boundaries"};
}
const sdk=String.raw`
import assert from "node:assert/strict";
import {writeFileSync,readFileSync} from "node:fs";
import {resolve} from "node:path";
import {deploy,startServe,rollback,cli} from "snapback4/proof";
import {guest} from "snapback4/auth";
const schema="use identity guests\ntable notes:\n  body: text <=80\n  public 'proof'\n  online only\nmutation add(body: text <=80):\n  return insert notes {body}\nquery version():\n  return 1\n";
writeFileSync("snapback/schema.q",schema);
const worker=resolve("snapback/worker.mjs"),root=process.cwd();
writeFileSync(worker,"import {writeFileSync} from 'node:fs';const root="+JSON.stringify(root)+";process.on('SIGTERM',()=>setTimeout(()=>{writeFileSync(root+'/wave19-worker-stopped','yes');process.exit(0);},700));writeFileSync(root+'/wave19-worker-ready','yes');setInterval(()=>{},1000);");
assert.equal((await deploy("wave19-production","snapback")).code,0);
const host=await startServe("wave19-production",{args:["--worker",worker]});
try {
 const empty=await cli(["data","notes","--release","wave19-production","--json"]);assert.equal(empty.code,0,empty.stderr);assert.deepEqual(JSON.parse(empty.stdout),{rows:[],more:false,limit:50});
 let signed;
 for(let i=0;i<30;i++) {const r=await fetch(host.url+"/auth/guest",{method:"POST",body:"{}"});assert.equal(r.status,200);signed=(await r.json()).session;assert.ok(signed.token);}
 let refusals=0,delay=0;const began=performance.now();
 const retried=await guest(host.url,{timeoutMs:90000},async(...args)=>{const r=await fetch(...args);if(r.status===429){refusals++;delay=(await r.clone().json()).denied.retryAfterMs;assert.ok(delay>0);}return r;});
 assert.equal(retried.ok,true);assert.equal(refusals,1);assert.ok(performance.now()-began>=delay-100);
 for(let i=0;i<65;i++){const r=await fetch(host.url+"/m/add",{method:"POST",headers:{authorization:"Bearer "+signed.token},body:JSON.stringify({args:{body:"row "+i}})});assert.equal((await r.json()).state,"sent");}
 for(const [flags,count,more,limit] of [[[],50,true,50],[["--limit","65"],65,false,65],[["--limit","0"],0,true,0]]) {
  const r=await cli(["data","notes","--release","wave19-production","--json",...flags]);assert.equal(r.code,0,r.stderr);const page=JSON.parse(r.stdout);assert.equal(page.rows.length,count);assert.equal(page.more,more);assert.equal(page.limit,limit);
 }
 readFileSync("wave19-worker-ready");await Promise.all([host.stop(),host.stop()]);assert.equal(readFileSync("wave19-worker-stopped","utf8"),"yes");
 assert.equal((await cli(["serve","wave19-production","--wait-stopped"])).code,0);
 writeFileSync("snapback/schema.q",schema.replace("return 1","return 2"));assert.equal((await deploy("wave19-production","snapback")).code,0);
 assert.equal((await rollback("wave19-production",1)).code,0);assert.equal((await rollback("wave19-production","latest")).code,0);await host.stop();
}finally{await host.stop();}
console.log("wave19 SDK rate, store-release and JSON pagination packed witnesses passed");
`;
const seed=String.raw`
import assert from "node:assert/strict";
import {deploy,startServe,cli} from "snapback4/proof";
assert.equal((await deploy("wave19-staging","snapback",{args:["--staging"]})).code,0);
const began=performance.now();
const host=await startServe("wave19-staging",{seedUsers:{roles:{member:35},provision:{name:"provision"},timeoutMs:150000}});
try {
 assert.equal(host.sessions.member.length,35);assert.ok(performance.now()-began>=59000,"35 real signups must encounter the real 30/minute peer limit");
 const r=await cli(["data","roles","--release","wave19-staging","--json","--limit","100"]);assert.equal(r.code,0,r.stderr);const page=JSON.parse(r.stdout);assert.equal(page.rows.length,35);assert.equal(page.more,false);
 for(const user of [host.sessions.member[0],host.sessions.member[34]]){const r=await fetch(host.url+"/q/myRole",{method:"POST",headers:{authorization:"Bearer "+user.token},body:'{"args":{}}'});assert.equal((await r.json()).data.role,"member");}
}finally{await host.stop();}
console.log("wave19 proof seedUsers real-server retryAfterMs packed witness passed");
`;

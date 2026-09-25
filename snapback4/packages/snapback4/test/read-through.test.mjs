// LLP 3000.014: the same capture images and parent fallback on wasm and native.
import test from "node:test";
import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { once } from "node:events";
import { mkdtempSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { createLocalClient } from "../dist/local.js";
import { processDevice } from "../dist/native.js";
import { memoryPersistence, webDevice } from "../dist/web.js";
const root=join(dirname(fileURLToPath(import.meta.url)),"../../..");
const binary=process.env.SNAPBACK4_BIN??join(root,"target/debug/snapback4");
const wasm=readFileSync(join(root,"packages/snapback4/src/wasm/snapback4_device_bg.wasm"));
const clique=readFileSync(join(root,"crates/snapback4-lang/tests/fixtures/read-through-clique.q"),"utf8");
const sleep=ms=>new Promise(r=>setTimeout(r,ms));
async function server(t,tier,source) {
  const dir=mkdtempSync(join(tmpdir(),"sb4-through-"));mkdirSync(join(dir,"snapback"));mkdirSync(join(dir,"device"));
  writeFileSync(join(dir,"snapback/schema.q"),"use personas alice, bob\n"+source);
  const child=spawn(binary,["dev","--port","0","--fresh","--no-watch"],{cwd:dir,stdio:["ignore","pipe","pipe"]});
  const exit=once(child,"exit");let log="",url,client,core,paused=false;const deliveries=new Set();
  child.stdout.on("data",d=>{log+=d;url??=log.match(/http:\/\/127\.0\.0\.1:\d+/)?.[0];});child.stderr.on("data",d=>log+=d);
  t.after(async()=>{paused=false;for(const resume of deliveries)resume();deliveries.clear();await client?.close();if(child.exitCode==null&&child.signalCode==null)child.kill("SIGTERM");await exit;rmSync(dir,{recursive:true,force:true});});
  for(let i=0;!url&&i<750;i++){assert.equal(child.exitCode,null,log);await sleep(20);}assert.ok(url,log);
  const post=(path,body)=>fetch(url+path,{method:"POST",headers:{"x-snapback-persona":"bob"},body:JSON.stringify(body)}).then(r=>r.json());
  const opener=tier==="wasm"?webDevice({wasm,persist:memoryPersistence()}):processDevice({binary,dir:join(dir,"device"),spawn:(cmd,args)=>spawn(cmd,args,{stdio:["pipe","pipe","inherit"]}),writeFile:async(path,text)=>writeFileSync(path,text)});
  const requests=[],answers=[];
  return {post,requests,answers,get core(){return core;},pauseSync(){paused=true;},async open(){
    client=await createLocalClient({url,persona:"bob",waitSeconds:1,fetch:async(input,init)=>{
      const path=new URL(input).pathname;requests.push(path);const response=await fetch(input,init);
      if(paused&&path==="/sync")await new Promise(resolve=>deliveries.add(resolve));
      return response;
    },device:{open:async(...args)=>{core=await opener.open(...args);return {close:()=>core.close(),call:async(request,committed)=>{const reply=await core.call(request,committed);if(request.op==="query")answers.push({name:request.name,...reply.ok});return reply;}};}}});
    await client.sync();return client;
  }};
}
for(const tier of ["wasm","process"]) test(`${tier}: Clique capture partitions and answers equal the flattened program`,{timeout:60000},async t=>{
  const results=[];
  const until=Date.now()+3_600_000;
  for(const flat of [false,true]) {
    const source=flat?clique.replaceAll("  read through .message","  chat: chats\n  until: time ?\n  immutable chat, until\n  expire at .until\n  read <- exists members[.chat, viewer]").replace("by .message.chat, .principal","by .chat, .principal"):clique;
    const host=await server(t,tier,source);
    const rows=[
      {table:"chats",row:{id:"a"}},{table:"chats",row:{id:"b"}},
      {table:"members",row:{id:"ma",chat:"a",principal:"dev:bob"}},{table:"members",row:{id:"mb",chat:"b",principal:"dev:alice"}},
      ...["a","b"].map(chat=>({table:"messages",row:{id:"m"+chat,chat,sender:chat==="a"?"dev:bob":"dev:alice",body:"message",until}})),
      ...["a","b"].flatMap(chat=>[
        {table:"receipts",row:{id:"r"+chat,message:"m"+chat,principal:chat==="a"?"dev:bob":"dev:alice",state:1,...(flat?{chat,until}:{})}},
        {table:"reactions",row:{id:"x"+chat,message:"m"+chat,principal:chat==="a"?"dev:bob":"dev:alice",emoji:"yes",...(flat?{chat,until}:{})}},
      ]),
    ];
    const seed=await host.post("/seed",rows);assert.equal(seed.seeded,10,JSON.stringify(seed));
    const snap=await host.post("/sync",{from:0,limit:100});
    assert.deepEqual(snap.events.filter(e=>["receipts","reactions"].includes(e.table)).map(e=>e.id).sort(),["ra","xa"]);
    if(!flat)for(const e of snap.events.filter(e=>["receipts","reactions"].includes(e.table))){assert.equal(e.data["$message.chat"],"a");assert.equal(e.data["$parentDeadline"],until);assert.equal(e.data.chat,undefined);assert.equal(e.data.until,undefined);}
    const client=await host.open();
    const query=(name,args)=>client.query({kind:"query",name},args);
    const output=[];
    for(const [name,args]of[["received",{message:"ma"}],["reacted",{message:"ma"}],["unreadFor",{chat:"a"}]]){
      const result=await query(name,args);assert.equal(result.complete,true,JSON.stringify(result));assert.ok("data"in result);output.push(result.data);
      const local=host.answers.findLast(a=>a.name===name);assert.equal(local.complete,true,JSON.stringify(local));assert.equal(local.unknown,false);assert.equal(local.nextExpiry,until);
      assert.ok(!host.requests.includes("/q/"+name),"a covered answer stays local");
    }
    const clock=await host.post("/dev/clock/advance",{duration:"+61m"});assert.equal(clock.denied,undefined,JSON.stringify(clock));
    await client.sync();
    const expired=await query("received",{message:"ma"});assert.deepEqual(expired.data,[]);
    assert.equal((await query("unreadFor",{chat:"a"})).data,0);
    results.push({output,held:snap.held,ids:snap.events.map(e=>e.table+"/"+e.id).sort()});
  }
  assert.deepEqual(results[0],results[1]);
});
const fallback=`table parents:
  owner: principal
  immutable owner
  read <- .owner = viewer
  sync last 1 by .id

table children:
  parent: parents
  body: text <=40
  immutable parent
  read through .parent
  insert <- allow
  delete <- allow
  retain delivered-history
  sync
query page(parent: parents):
  children where .parent = parent first 10 by .id { id, body }
mutation replace(old: children, parent: parents):
  delete children[old]
  insert children {id: 'new', parent, body: 'current'}
`;
for(const tier of ["wasm","process"]) test(`${tier}: an unheld parent falls back without losing retained rows`,{timeout:60000},async t=>{
  const host=await server(t,tier,fallback);
  assert.equal((await host.post("/seed",[
    {table:"parents",row:{id:"a",owner:"dev:bob"}},{table:"parents",row:{id:"z",owner:"dev:bob"}},
    {table:"children",row:{id:"old",parent:"a",body:"delivered"}},
  ])).seeded,3);
  const client=await host.open();
  const read=()=>client.query({kind:"query",name:"page"},{parent:"a"});
  assert.deepEqual((await read()).data,[{id:"old",body:"delivered"}]);
  assert.ok(host.requests.includes("/q/page"));
  const local=host.answers.findLast(a=>a.name==="page");assert.equal(local.unknown,true);assert.equal(local.complete,false);assert.deepEqual(local.data,[]);
  host.pauseSync(); // Hold future sync responses; query fallback remains online.
  // Apply a departure before the cross-partition parent delivery. The next
  // server page has a different current child; the delivered row stays local.
  const state=(await host.core.call({op:"state"})).ok;
  const applied=await host.core.call({op:"apply",first:false,page:{snapshot:false,watermark:state.watermark,generation:state.generation,more:false,events:[{table:"children",kind:"scope",id:"left",data:["dev:bob"]}]}});
  assert.equal(applied.denied,undefined,JSON.stringify(applied));
  const replaced=await host.post("/m/replace",{id:"replace",args:{old:"old",parent:"a"}});assert.equal(replaced.state,"sent",JSON.stringify(replaced));
  // Reading immediately uses the current server page and the still-held history.
  const result=await read();
  assert.deepEqual(result.data,[{id:"new",body:"current"},{id:"old",body:"delivered",retained:true}],JSON.stringify(result));
  assert.equal(result.fresh,false);assert.equal(result.complete,false);
});

const chain=readFileSync(join(root,"crates/snapback4-lang/tests/fixtures/read-through-device.q"),"utf8");
for(const tier of ["wasm","process"]) test(`${tier}: four-level capture, covered prediction and inherited expiry`,{timeout:60000},async t=>{
  const host=await server(t,tier,chain);const until=Date.now()+3_600_000;
  const setup=await host.post("/m/setup",{id:"setup",args:{org:"o",project:"p",task:"t",until}});assert.equal(setup.state,"sent",JSON.stringify(setup));
  const snapshot=await host.post("/sync",{from:0,limit:100});
  for(const table of ["orgs","projects","tasks"])assert.ok(snapshot.events.some(e=>e.table===table),table);
  const client=await host.open();
  const predict=task=>host.core.call({op:"predict",name:"post",viewer:"dev:bob",args:{id:"c",task,body:"pending"},now:Date.now()});
  assert.deepEqual((await predict("t")).ok.predicted,["comments/c"]);
  const read=await host.core.call({op:"query",name:"page",viewer:"dev:bob",args:{task:"t"},now:Date.now()});
  assert.equal(read.ok.data[0].id,"c");assert.equal(read.ok.complete,true);assert.equal(read.ok.nextExpiry,until);
  assert.equal((await predict("unheld")).ok.denied.code,"E_PREDICT");
  await host.core.call({op:"withdraw",predicted:["comments/c"]});
  assert.equal((await host.post("/m/post",{id:"post",args:{id:"c",task:"t",body:"confirmed"}})).state,"sent");await client.sync();
  assert.equal((await client.query({kind:"query",name:"countFor"},{task:"t"})).data,1);
  await host.post("/dev/clock/advance",{duration:"+61m"});await client.sync();
  const expired=await host.core.call({op:"query",name:"page",viewer:"dev:bob",args:{task:"t"},now:until-1});
  assert.deepEqual(expired.ok.data,[]);
  const authoritative=await client.query({kind:"query",name:"page"},{task:"t"});assert.deepEqual(authoritative.data,[]);assert.equal(authoritative.complete,true);
});

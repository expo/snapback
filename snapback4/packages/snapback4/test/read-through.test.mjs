// LLP 3000.014: capture images and parent fallback on wasm and native.
import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { server, root } from "./helpers/read-through-server.mjs";
const clique=readFileSync(join(root,"crates/snapback4-lang/tests/fixtures/read-through-clique.q"),"utf8");
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
query nested(parent: parents):
  rows = children where .parent = parent first 10 by .id { id, body }
  return [{ rows }]
query sampled(parent: parents):
  sample = connected[viewer]
  return children where .parent = parent first 10 by .id { id, body }
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
  // A partial rejoin still retains the old image, while the server has its
  // current row. The server row wins the ID collision, without a duplicate.
  const rejoined=await host.core.call({op:"apply",page:{snapshot:false,watermark:state.watermark,generation:state.generation,more:false,events:[],joined:{children:[["dev:bob"]]}}});
  assert.equal(rejoined.denied,undefined,JSON.stringify(rejoined));
  assert.deepEqual((await read()).data,[{id:"old",body:"delivered"}]);
  const replaced=await host.post("/m/replace",{id:"replace",args:{old:"old",parent:"a"}});assert.equal(replaced.state,"sent",JSON.stringify(replaced));
  // Reading immediately uses the current server page and the still-held history.
  const result=await read();
  assert.deepEqual(result.data,[{id:"new",body:"current"},{id:"old",body:"delivered",retained:true}],JSON.stringify(result));
  assert.equal(result.fresh,false);assert.equal(result.complete,false);
  const nested=await client.query({kind:"query",name:"nested"},{parent:"a"});
  assert.deepEqual(nested.data,[{rows:[{id:"new",body:"current"}]},{rows:[{id:"old",body:"delivered",retained:true}]}],"unpaired retained wrappers survive beside the current server rows");
  assert.equal(nested.complete,false);
  const nestedLocal=host.answers.findLast(a=>a.name==="nested");
  assert.equal(nestedLocal.retainedRows[0].source,null);
  assert.deepEqual(nestedLocal.retainedRows[0].fields.rows[0].source,["children","old"]);
  // LLP 3000.018 §3.1: a query that may read presence composes retained rows the same way, and the
  // composed answer keeps the server's refresh, so the watch keeps re-reading.
  host.refresh=300;
  const sampled=client.observe({kind:"query",name:"sampled"},{parent:"a"});
  t.after(()=>sampled.close());
  const asked=()=>host.requests.filter(path=>path==="/q/sampled").length;
  for(let i=0;i<500&&asked()<3;i++)await new Promise(resolve=>setTimeout(resolve,20));
  assert.ok(asked()>=3,`the composed presence answer stopped refreshing after ${asked()} reads`);
  assert.deepEqual(sampled.getSnapshot().data,[{id:"new",body:"current"},{id:"old",body:"delivered",retained:true}],JSON.stringify(sampled.getSnapshot()));
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
  // Advance only the applied clock: every physical parent/child is still held.
  const state=(await host.core.call({op:"state"})).ok;
  const clock=await host.core.call({op:"apply",page:{snapshot:false,events:[],watermark:state.watermark,generation:state.generation,more:false,now:until+1}});
  assert.equal(clock.denied,undefined,JSON.stringify(clock));
  const beforeSweep=await host.core.call({op:"query",name:"page",viewer:"dev:bob",args:{task:"t"},now:until-1});
  assert.deepEqual(beforeSweep.ok.data,[]);assert.equal(beforeSweep.ok.complete,true);assert.equal(beforeSweep.ok.unknown,false);assert.equal(beforeSweep.ok.nextExpiry,null);
  await host.post("/dev/clock/advance",{duration:"+61m"});await client.sync();
  const expired=await host.core.call({op:"query",name:"page",viewer:"dev:bob",args:{task:"t"},now:until-1});
  assert.deepEqual(expired.ok.data,[]);
  const authoritative=await client.query({kind:"query",name:"page"},{task:"t"});assert.deepEqual(authoritative.data,[]);assert.equal(authoritative.complete,true);
});
import { hasRetainedRows, keepRetainedRows } from "../dist/local-through.js";

const mask=(table,id,retained=false,fields={})=>({source:[table,id],retained,fields});
test("retained fallback uses provenance identities, not projected fields", () => {
  const ordinary={id:"ordinary",retained:true}, history={id:"history",retained:true}, server={id:"server"};
  const localMask=[mask("rows","ordinary"),mask("rows","history",true)];
  assert.equal(hasRetainedRows(localMask),true);
  assert.equal(hasRetainedRows([mask("rows","ordinary",false,{retained:null})]),false);
  assert.deepEqual(keepRetainedRows([server],[ordinary,history],localMask,[mask("rows","server")]),[server,history]);
  assert.deepEqual(keepRetainedRows([], [ordinary], undefined), []);
});
test("retained fallback preserves unpaired history and prefers matching source IDs", () => {
  const old={body:"history",retained:true}, duplicate={body:"stale",retained:true}, current={body:"current"};
  assert.deepEqual(keepRetainedRows([current],[duplicate,old],[mask("rows","live",true),mask("rows","old",true)],[mask("rows","live")]),[current,old]);
  const local=[{rows:[old]}], provenance=[{source:null,retained:false,fields:{rows:[mask("rows","old",true)]}}];
  assert.deepEqual(keepRetainedRows([{rows:[current]}],local,provenance,[{source:null,retained:false,fields:{rows:[mask("rows","live")]}}]),[{rows:[current]},...local]);
  assert.deepEqual(keepRetainedRows([current],[old],[mask("rows","old",true)]),[old],"a missing server envelope cannot authorize identity guesses");
});

for(const tier of ["wasm","process"]) test(`${tier}: retained children do not terminally refuse a reused parent delete`,{timeout:60000},async t=>{
  const source=chain.replace("table comments:","table comments:\n  retain delivered-history")+`
mutation reuse():
  delete comments['old']
  delete tasks['t']
  insert tasks {id: 't', project: 'p2'}
mutation dropComment(id: comments):
  delete comments[id]
`;
  const host=await server(t,tier,source);
  for(const [org,project,task] of [["o","p","t"],["o2","p2","other"]])
    assert.equal((await host.post("/m/setup",{id:"setup-"+org,args:{org,project,task,until:null}})).state,"sent");
  assert.equal((await host.post("/m/post",{id:"post",args:{id:"old",task:"t",body:"old"}})).state,"sent");
  await host.open();host.pauseSync();
  const state=(await host.core.call({op:"state"})).ok;
  const apply=events=>host.core.call({op:"apply",page:{snapshot:false,watermark:state.watermark,generation:state.generation,events,more:false}});
  assert.equal((await apply([{table:"comments",kind:"scope",id:"left",data:["o"]}])).denied,undefined);
  assert.equal((await host.post("/m/reuse",{id:"reuse",args:{}})).state,"sent");
  const snapshot=await host.post("/sync",{from:0,limit:100});
  const parent=snapshot.events.find(e=>e.table==="tasks"&&e.id==="t");assert.ok(parent);
  assert.equal((await apply([parent])).denied,undefined);
  const retained=(await host.core.call({op:"query",name:"page",viewer:"dev:bob",args:{task:"t"},now:Date.now()})).ok;
  assert.equal(retained.data[0].id,"old");assert.equal(retained.data[0].retained,true);
  // The old retained child sorts first. It must not hide a later live child.
  assert.equal((await host.post("/m/post",{id:"live",args:{id:"z-live",task:"t",body:"live"}})).state,"sent");
  const populated=await host.post("/sync",{from:0,limit:100});
  const live=populated.events.find(e=>e.table==="comments"&&e.id==="z-live");assert.ok(live);
  assert.equal((await apply([live])).denied,undefined);
  const blocked=await host.core.call({op:"admit",entry:{id:"blocked-delete",seq:0,op:"dropTask",args:{id:"t"},viewer:"dev:bob",now:Date.now(),predictable:true}});
  assert.equal(blocked.denied?.code,"E_PARENT_HAS_CHILDREN",JSON.stringify(blocked));
  assert.equal((await host.post("/m/dropComment",{id:"remove-live",args:{id:"z-live"}})).state,"sent");
  assert.equal((await apply([{table:"comments",kind:"del",id:"z-live"}])).denied,undefined);
  const deletion=await host.core.call({op:"admit",entry:{id:"delete-reused",seq:0,op:"dropTask",args:{id:"t"},viewer:"dev:bob",now:Date.now(),predictable:true}});
  assert.equal(deletion.denied,undefined,JSON.stringify(deletion));
  assert.equal(deletion.ok.predictable,true);assert.deepEqual(deletion.ok.predicted,["tasks/t"]);
  assert.equal((await host.post("/m/dropTask",{id:"delete-server",args:{id:"t"}})).state,"sent");
});

for(const tier of ["wasm","process"]) test(`${tier}: an expired unswept matching child queues its parent delete`,{timeout:60000},async t=>{
  const source=chain.replace("table comments:","table comments:\n  until: time ?\n  expire at .until")+`
mutation postUntil(id: comments, task: tasks, until: time):
  insert comments {id, task, until, body: 'soon', at: 1}
`;
  const host=await server(t,tier,source), now=Date.now();
  assert.equal((await host.post("/m/setup",{id:"setup",args:{org:"o",project:"p",task:"t",until:now+300000}})).state,"sent");
  assert.equal((await host.post("/m/postUntil",{id:"post",args:{id:"c",task:"t",until:now+150000}})).state,"sent");
  await host.open();host.pauseSync();
  const before=(await host.core.call({op:"query",name:"page",viewer:"dev:bob",args:{task:"t"},now})).ok;
  assert.equal(before.data[0].id,"c");
  const queued=await host.core.call({op:"admit",entry:{id:"delete-after-expiry",seq:0,op:"dropTask",args:{id:"t"},viewer:"dev:bob",now:now+200000,predictable:true}});
  assert.equal(queued.denied,undefined,JSON.stringify(queued));
  assert.equal(queued.ok.predictable,false);assert.deepEqual(queued.ok.predicted,[]);
  assert.equal((await host.core.call({op:"queued"})).ok.length,1);
});

// Ambiguous identities stay unpaired, without blocking uniquely identified
// siblings. Each distinct local history survives once; it cannot be attached
// to both projections of the same parent.
for(const repeated of ["local", "server", "both"]) test(`retained fallback leaves ${repeated} duplicate identities unpaired`,()=>{
  const history=label=>({label,rows:[{body:label,retained:true}]});
  const provenance=(id,label,retained)=>mask("parents",id,false,{rows:[mask("children",label,retained)]});
  const locals=[history("A1"),...(repeated!=="server"?[history("A2")]:[]),history("B-old")];
  const localMasks=[provenance("A","A1",true),...(repeated!=="server"?[provenance("A","A2",true)]:[]),provenance("B","B-old",true)];
  const current=label=>({label,rows:[{body:label}]});
  const servers=[current("A-current-1"),...(repeated!=="local"?[current("A-current-2")]:[]),current("B-current")];
  const serverMasks=[provenance("A","A-current-1",false),...(repeated!=="local"?[provenance("A","A-current-2",false)]:[]),provenance("B","B-current",false)];
  assert.deepEqual(keepRetainedRows(servers,locals,localMasks,serverMasks),[
    ...servers.slice(0,-1),{label:"B-current",rows:[{body:"B-current"},{body:"B-old",retained:true}]},...locals.slice(0,-1),
  ]);
});


test("retained fallback never attaches one object's history to a different source",()=>{
  const local={title:"A",rows:[{body:"old-A",retained:true}]};
  const current={title:"B",rows:[{body:"new-B"}]};
  const localMask=mask("parents","A",false,{rows:[mask("children","old-A",true)]});
  const currentMask=mask("parents","B",false,{rows:[mask("children","new-B")]});
  assert.deepEqual(keepRetainedRows(current,local,localMask,currentMask),local);
});

test("anonymous retained projections use nested source identities and keep identified leftovers whole",()=>{
  const ordinary={id:"projected",body:"stale"}, old={id:"projected",body:"history",retained:true};
  const current=[{rows:[{id:"projected",body:"fresh"}]}];
  const anonymous=fields=>({source:null,retained:false,fields});
  const local=[{label:"current label",rows:[ordinary,{body:"unreturned current"},old]}];
  const fields={label:null,rows:[mask("comments","x"),mask("comments","unreturned"),mask("reactions","x",true,{id:null,body:null,retained:null})]};
  const serverMask=[anonymous({rows:[mask("comments","x")]})];
  assert.deepEqual(keepRetainedRows(current,local,[anonymous(fields)],serverMask),[...current,{rows:[old]}],"table qualification keeps the reaction; projected IDs and stale wrapper fields cannot supply identity");
  assert.deepEqual(keepRetainedRows(current,local,[mask("parents","A",false,fields)],serverMask),[...current,...local],"identified unpaired elements remain whole");
});


test("anonymous projection preserves retained JSON fields but excludes nested current rows",()=>{
  const details={labels:["kept",null],seen:false};
  const stale={body:"stale"}, history={body:"history",retained:true,details,related:[stale]};
  const anonymous=fields=>({source:null,retained:false,fields});
  const provenance=[anonymous({rows:[mask("comments","old",true,{
    body:null,retained:null,details:anonymous({labels:[null,null],seen:null}),related:[mask("reactions","current",false,{body:null})],
  })]})];
  assert.deepEqual(keepRetainedRows([], [{rows:[history]}],provenance,[]),[{rows:[{body:"history",retained:true,details,related:[]}]}]);
});

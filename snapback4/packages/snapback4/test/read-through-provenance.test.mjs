// LLP 3000.014 round 10: actual device/server provenance, never projected IDs.
import test from "node:test";
import assert from "node:assert/strict";
import { server } from "./helpers/read-through-server.mjs";
const source=`table parents:
  owner: principal
  rank: int
  visible: bool
  title: text <=40
  immutable owner
  read <- .owner = viewer
  update <- allow
  sync

table children:
  parent: parents
  body: text <=40
  immutable parent
  read through .parent
  insert <- allow
  update <- allow
  delete <- allow
  retain delivered-history
  sync

table reactions:
  update <- allow
  parent: parents
  body: text <=40
  immutable parent
  read through .parent
  delete <- allow
  retain delivered-history
  sync

fn rowsFor(parent: parents):
  return children where .parent = parent first 10 by .id {roomId: .parent, body}

query outer():
  parents where .visible = true first 10 by .rank {title, rows: rowsFor(.id)}

query nested(parent: parents):
  rows = children where .parent = parent first 10 by .id {id, body}
  return [{rows}]

query page(parent: parents):
  children where .parent = parent first 10 by .id {roomId: .parent, body}

fn mixedRows(parent: parents):
  history = reactions where .parent = parent first 10 by .id
  c = children['x'] {id, kind: 'comment', body}
  r = reactions['x'] {id, kind: 'reaction', body}
  if count(history) > 0 and c != null and r != null:
    return [c, r]
  if c != null:
    return [c]
  if r != null:
    return [r]
  return []

query mixed(parent: parents):
  mixedRows(parent)

query wrapped(parent: parents):
  return {items: mixedRows(parent)}

query partial():
  a = parents['A'] ! else MISSING
  c = parents['C'] ! else MISSING
  d = parents['D'] ! else MISSING
  first = {...(a {title, rows: rowsFor(.id)})}
  last = {...(c {title, rows: rowsFor(.id)})}
  ambiguous = {...a, ...c}
  middle = ambiguous {title: 'unidentified'}
  if d.visible:
    return [first, middle, last, {...(d {title})}]
  return [first, middle, last]

mutation editReaction(id: reactions):
  update reactions[id] {body: 'new-reaction'}

mutation rerank(parent: parents, rank: int, visible: bool):
  update parents[parent] {rank, visible}

mutation replace(old: children, id: children, parent: parents):
  delete children[old]
  insert children {id, parent, body: 'current'}

mutation edit(id: children):
  update children[id] {body: 'current'}

mutation dropChild(id: children):
  delete children[id]

mutation dropReaction(id: reactions):
  delete reactions[id]
`;
const parent=(id,rank)=>({table:"parents",row:{id,rank,title:id,owner:"dev:bob",visible:true}});
const child=(id,room)=>({table:"children",row:{id,parent:room,body:"old-"+room}});
async function leave(host,table) {
  host.pauseSync();
  const state=(await host.core.call({op:"state"})).ok;
  const applied=await host.core.call({op:"apply",page:{snapshot:false,watermark:state.watermark,generation:state.generation,more:false,events:[{table,kind:"scope",id:"left",data:["dev:bob"]}]}});
  assert.equal(applied.denied,undefined,JSON.stringify(applied));
}
async function mutate(host,name,args,id=name) {
  const result=await host.post("/m/"+name,{id,args});assert.equal(result.state,"sent",JSON.stringify(result));
}
for(const tier of ["wasm","process"]) {
  for(const shifted of [false,true]) test(`${tier}: retained nested rows follow source parents on ${shifted?"shifted":"reordered"} pages`,{timeout:60000},async t=>{
    const host=await server(t,tier,source);const ids=shifted?["A","B","C"]:["A","B"];
    assert.equal((await host.post("/seed",ids.flatMap((id,i)=>[parent(id,i),child("old-"+id,id)]))).seeded,ids.length*2);
    const client=await host.open();await leave(host,"children");
    const local=(await host.core.call({op:"query",name:"outer",args:{},viewer:"dev:bob",now:Date.now()})).ok;
    assert.equal(local.unknown,true);assert.deepEqual(local.retainedRows.map(m=>m.source),ids.map(id=>["parents",id]));
    assert.ok(local.data.every(row=>!("id" in row)),"outer identity is absent from projection");
    for(const id of ids)await mutate(host,"replace",{old:"old-"+id,id:"new-"+id,parent:id},"replace-"+id);
    if(shifted)await mutate(host,"rerank",{parent:"B",rank:1,visible:false});
    else await mutate(host,"rerank",{parent:"A",rank:3,visible:true});
    const remote=await host.post("/q/outer",{args:{},provenance:true});
    assert.equal(remote.denied,undefined,JSON.stringify(remote));
    const order=shifted?["A","C"]:["B","A"];
    assert.deepEqual(remote.rowProvenance.map(m=>m.source),order.map(id=>["parents",id]));
    const result=await client.query({kind:"query",name:"outer"},{});
    assert.equal(result.complete,false);assert.equal(result.fresh,false);
    assert.deepEqual(result.data.map(row=>row.title),shifted?["A","C","B"]:order);
    for(const row of result.data) {
      const old={roomId:row.title,body:"old-"+row.title,retained:true};
      assert.deepEqual(row.rows,shifted&&row.title==="B"?[old]:[{roomId:row.title,body:"current"},old],JSON.stringify(result));
    }
  });
  test(`${tier}: composed tables sharing an ID keep independent retained rows`,{timeout:60000},async t=>{
    const host=await server(t,tier,source);
    assert.equal((await host.post("/seed",[parent("A",0),child("x","A"),{table:"reactions",row:{id:"x",parent:"A",body:"reaction"}}])).seeded,3);
    const client=await host.open();await leave(host,"reactions");
    await mutate(host,"dropReaction",{id:"x"});await mutate(host,"edit",{id:"x"});
    const result=await client.query({kind:"query",name:"mixed"},{parent:"A"});
    assert.deepEqual(result.data,[{id:"x",kind:"comment",body:"current"},{id:"x",kind:"reaction",body:"reaction",retained:true}]);
    assert.equal(result.complete,false);
    const mask=host.answers.findLast(a=>a.name==="mixed").retainedRows;
    assert.deepEqual(mask.map(m=>m.source),[["children","x"],["reactions","x"]]);
  });
  test(`${tier}: projections without id replace a retained copy using its source envelope`,{timeout:60000},async t=>{
    const host=await server(t,tier,source);
    assert.equal((await host.post("/seed",[parent("A",0),child("x","A")])).seeded,2);
    const client=await host.open();await leave(host,"children");await mutate(host,"edit",{id:"x"});
    const plain=await host.post("/q/page",{args:{parent:"A"}});assert.equal(plain.rowProvenance,undefined,"ordinary replies keep their contract");
    const envelope=await host.post("/q/page",{args:{parent:"A"},provenance:true});
    assert.deepEqual(envelope.rowProvenance[0].source,["children","x"]);
    assert.ok(envelope.meter.outputBytes>plain.meter.outputBytes,"the opt-in envelope is metered");
    const result=await client.query({kind:"query",name:"page"},{parent:"A"});
    assert.deepEqual(result.data,[{roomId:"A",body:"current"}]);assert.equal(result.complete,false);
    const local=host.answers.findLast(a=>a.name==="page");
    assert.deepEqual(local.data,[{roomId:"A",body:"old-A",retained:true}]);
    assert.deepEqual(local.retainedRows[0].source,["children","x"]);
  });
}

for(const tier of ["wasm","process"]) {
  test(`${tier}: an identityless object merges its identified child rows`,{timeout:60000},async t=>{
    const host=await server(t,tier,source);
    assert.equal((await host.post("/seed",[parent("A",0),child("x","A"),{table:"reactions",row:{id:"x",parent:"A",body:"reaction"}}])).seeded,3);
    const client=await host.open();await leave(host,"reactions");
    await mutate(host,"edit",{id:"x"});await mutate(host,"editReaction",{id:"x"});
    const result=await client.query({kind:"query",name:"wrapped"},{parent:"A"});
    assert.deepEqual(result.data,{items:[{id:"x",kind:"comment",body:"current"},{id:"x",kind:"reaction",body:"new-reaction"}]});
    assert.equal(result.complete,false);
    const local=host.answers.findLast(a=>a.name==="wrapped");
    assert.equal(local.retainedRows.source,null);
    assert.deepEqual(local.retainedRows.fields.items.map(m=>m.source),[["children","x"],["reactions","x"]]);
    assert.equal(local.retainedRows.fields.items[1].retained,true);
    const remote=await host.post("/q/wrapped",{args:{parent:"A"},provenance:true});
    assert.equal(remote.rowProvenance.source,null);
    assert.deepEqual(remote.rowProvenance.fields.items.map(m=>m.source),[["children","x"],["reactions","x"]]);
  });
  test(`${tier}: an unidentified sibling preserves paired parents and drops an unpaired current row`,{timeout:60000},async t=>{
    const host=await server(t,tier,source);
    assert.equal((await host.post("/seed",[parent("A",0),parent("C",1),parent("D",2),child("old-A","A"),child("old-C","C")])).seeded,5);
    const client=await host.open();await leave(host,"children");
    for(const id of ["A","C"])await mutate(host,"replace",{old:"old-"+id,id:"new-"+id,parent:id},"replace-"+id);
    await mutate(host,"rerank",{parent:"D",rank:2,visible:false});
    const result=await client.query({kind:"query",name:"partial"},{});
    assert.deepEqual(result.data,[
      {title:"A",rows:[{roomId:"A",body:"current"},{roomId:"A",body:"old-A",retained:true}]},
      {title:"unidentified"},
      {title:"C",rows:[{roomId:"C",body:"current"},{roomId:"C",body:"old-C",retained:true}]},
    ]);
    assert.equal(result.complete,false);
    const local=host.answers.findLast(a=>a.name==="partial");
    assert.deepEqual(local.retainedRows.map(m=>m.source),[["parents","A"],null,["parents","C"],["parents","D"]]);
    assert.equal(local.retainedRows[3].retained,false);
  });
}

for(const tier of ["wasm","process"]) {
  test(`${tier}: an anonymous nested page appends only retained history after a partial rejoin`,{timeout:60000},async t=>{
    const host=await server(t,tier,source);
    assert.equal((await host.post("/seed",[parent("A",0),child("c","A"),child("old","A")])).seeded,3);
    const client=await host.open();await leave(host,"children");
    const state=(await host.core.call({op:"state"})).ok;
    const snapshot=await host.post("/sync",{from:0,limit:100});
    const current=snapshot.events.find(e=>e.table==="children"&&e.id==="c");assert.ok(current);
    const rejoined=await host.core.call({op:"apply",page:{snapshot:false,watermark:state.watermark,generation:state.generation,more:false,events:[current],joined:{children:[["dev:bob"]]}}});
    assert.equal(rejoined.denied,undefined,JSON.stringify(rejoined));
    await mutate(host,"edit",{id:"c"});await mutate(host,"dropChild",{id:"old"});
    const local=(await host.core.call({op:"query",name:"nested",args:{parent:"A"},viewer:"dev:bob",now:Date.now()})).ok;
    assert.equal(local.unknown,true);assert.equal(local.complete,false);
    assert.deepEqual(local.data,[{rows:[{id:"c",body:"old-A"},{id:"old",body:"old-A",retained:true}]}]);
    assert.equal(local.retainedRows[0].source,null);
    assert.deepEqual(local.retainedRows[0].fields.rows.map(m=>[m.source,m.retained]),[[["children","c"],false],[["children","old"],true]]);
    const result=await client.query({kind:"query",name:"nested"},{parent:"A"});
    assert.deepEqual(result.data,[{rows:[{id:"c",body:"current"}]},{rows:[{id:"old",body:"old-A",retained:true}]}]);
    assert.equal(result.complete,false);assert.equal(result.fresh,false);
  });
  test(`${tier}: an in-place edit under an anonymous nested page replaces its retained copy`,{timeout:60000},async t=>{
    const host=await server(t,tier,source);
    assert.equal((await host.post("/seed",[parent("A",0),child("x","A")])).seeded,2);
    const client=await host.open();await leave(host,"children");await mutate(host,"edit",{id:"x"});
    const local=(await host.core.call({op:"query",name:"nested",args:{parent:"A"},viewer:"dev:bob",now:Date.now()})).ok;
    assert.equal(local.unknown,true);
    assert.deepEqual(local.data,[{rows:[{id:"x",body:"old-A",retained:true}]}]);
    assert.deepEqual(local.retainedRows[0].fields.rows[0].source,["children","x"]);
    const remote=await host.post("/q/nested",{args:{parent:"A"},provenance:true});
    assert.deepEqual(remote.rowProvenance[0].fields.rows[0].source,["children","x"]);
    const result=await client.query({kind:"query",name:"nested"},{parent:"A"});
    assert.deepEqual(result.data,[{rows:[{id:"x",body:"current"}]}],"no stale retained duplicate or empty anonymous wrapper");
    assert.equal(result.complete,false);assert.equal(result.fresh,false);
  });
}

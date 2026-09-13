import test from "node:test";
import assert from "node:assert/strict";
import { DatabaseSync } from "node:sqlite";
import { MemoryStore } from "../dist/replica/store.js";
import { openSqlite, nodeSqliteDriver, expoSqliteDriver } from "../dist/replica/sqlite.js";
import { Replica } from "../dist/replica/replica.js";
import { Interpreter, Refused } from "../dist/replica/interpreter.js";
import { createClient, mintId } from "../dist/client.js";

const schema = {tables:{t:{columns:{id:"Id",value:"Int"},indexes:{byId:{components:[{Column:"id"}],unique:true},byValue:{components:[{Column:"value"},{Column:"id"}],unique:false}},rules:{read:"Allow",insert:"Allow",update:"Allow",delete:"Allow"},sync:{audience:"Public"}}}};
const context = () => ({viewer:"dev:alice",args:{},now:1,newIds:[],mint:()=>"mint"});
const defer = () => { let resolve; const promise = new Promise(r=>resolve=r); return {promise,resolve}; };
const tick = () => new Promise(r=>setTimeout(r,0));
const factories = {memory: async()=>new MemoryStore(schema), sqlite:()=>openSqlite(nodeSqliteDriver(new DatabaseSync(":memory:")),schema)};

for (const [name, open] of Object.entries(factories)) {
  test(`${name}: a snapshot stays hidden through catch-up puts, deletes and scope tombstones`, async()=>{
    const store=await open();
    const grouped={...schema.tables.t,columns:{...schema.tables.t.columns,owner:"Principal"},sync:{audience:{Column:"owner"}}};
    const stagedSchema={tables:{...schema.tables,g:grouped,h:{...grouped,leave:"delivered-history"}}};
    store.setSchema(stagedSchema);
    await store.write(async tx=>{await tx.put("t",{id:"old",value:1});await tx.setMeta("watermark",5);await tx.setMeta("generation",1);});
    const replica=new Replica(store,stagedSchema,{sync:async()=>{throw Error("unused")}},1), touched=new Set();
    let rebases=0;
    replica.reconcile=async(tx,apply,ack)=>{rebases++;await apply();assert.deepEqual(ack,{write:12});assert.equal(await tx.getMeta("watermark"),12);};
    const put=(table,id,value,owner)=>({kind:"put",table,id,data:{id,value,...(owner?{owner}:{})}});
    await replica.apply({snapshot:true,stage_snapshot:true,events:[put("t","a",12),put("t","b",10),put("g","gone",10,"alice"),put("g","kept",10,"bob"),put("h","history",10,"alice")],watermark:10,more:false},touched,true);
    assert.equal((await store.read(tx=>tx.get("t","old"))).value,1);
    assert.equal((await replica.state()).watermark,5);
    const partial={snapshot:false,snapshot_catchup:true,events:[put("t","a",11),{kind:"del",table:"t",id:"b"},{kind:"scope",table:"g",id:"",data:["alice"]},{kind:"scope",table:"h",id:"",data:["alice"]}],watermark:11,more:true};
    await replica.apply(partial,touched,false);
    assert.equal(rebases,0,"intermediate catch-up must not replay against fuzzy row images");
    assert.equal(touched.size,0);
    assert.equal((await store.read(tx=>tx.get("t","old"))).value,1);
    await assert.rejects(replica.apply({...partial,watermark:10},touched,false),/stale snapshot catch-up/);
    const final={snapshot:false,snapshot_catchup:true,events:[put("t","a",12)],watermark:12,more:false,acknowledged:{write:12}};
    const reopened=new Replica(store,stagedSchema,{sync:async()=>{throw Error("unused")}},1);
    await assert.rejects(reopened.apply(final,touched,false),/owner/);
    await replica.apply(final,touched,false);
    assert.equal(rebases,1);
    await store.read(async tx=>{
      assert.equal(await tx.get("t","old"),undefined);assert.equal(await tx.get("t","b"),undefined);
      assert.equal((await tx.get("t","a")).value,12);assert.equal(await tx.get("g","gone"),undefined);
      assert.ok(await tx.get("g","kept"));assert.ok(await tx.get("h","history"));
      assert.equal(await tx.getMeta("watermark"),12);assert.deepEqual(await tx.side("snapshot").all(),[]);
    });
    await assert.rejects(replica.apply(final,touched,false),/owner|finished/);
    await store.close();
  });
  test(`${name}: another sender invalidates captured stream and snapshot receipts`,async()=>{
    const store=await open();
    await store.write(async tx=>{await tx.put("t",{id:"old",value:1});await tx.setMeta("watermark",1);await tx.setMeta("generation",1);await tx.setMeta("outbox:sendRevision",1);});
    const replica=new Replica(store,schema,{sync:async()=>{throw Error("unused")}},1);
    const page={snapshot:false,events:[{table:"t",kind:"put",id:"old",data:{id:"old",value:2}}],watermark:2,more:false,send_revision:0};
    await assert.rejects(replica.apply(page,new Set()),/write was sent/);
    assert.equal((await replica.state()).watermark,1);
    assert.equal((await store.read(tx=>tx.get("t","old"))).value,1);
    await replica.apply({...page,snapshot:true,more:true,next:"next",send_revision:1},new Set(),true);
    await store.write(tx=>tx.setMeta("outbox:sendRevision",2));
    await assert.rejects(replica.apply({...page,snapshot:true,send_revision:2},new Set(),false),/snapshot/);
    assert.equal((await store.read(tx=>tx.get("t","old"))).value,1);
    await store.close();
  });
  test(`${name}: finalized and competing snapshot continuations cannot truncate the partition`, async()=>{
    const store=await open();
    const first=new Replica(store,schema,{sync:async()=>{throw Error("unused")}},1);
    const second=new Replica(store,schema,{sync:async()=>{throw Error("unused")}},1);
    const page=(id,more)=>({snapshot:true,events:[{table:"t",kind:"put",id,data:{id,value:1}}],watermark:10,more,...(more?{next:"more"}:{})});
    await first.apply(page("a",true),new Set(),true);
    await first.apply(page("b",false),new Set(),false);
    await assert.rejects(first.apply(page("b",false),new Set(),false),/owner|finished/);
    assert.deepEqual((await store.read(tx=>tx.scan("t","byId",[],{},"asc",10))).map(e=>e.row.id),["a","b"]);
    await first.apply(page("c",true),new Set(),true);
    await second.apply(page("d",true),new Set(),true);
    await assert.rejects(first.apply(page("e",false),new Set(),false),/owner/);
    await second.apply(page("f",false),new Set(),false);
    assert.deepEqual((await store.read(tx=>tx.scan("t","byId",[],{},"asc",10))).map(e=>e.row.id),["d","f"]);
    await first.apply(page("g",true),new Set(),true);
    const reopened=new Replica(store,schema,{sync:async()=>{throw Error("unused")}},1);
    await assert.rejects(reopened.apply(page("h",false),new Set(),false),/owner/);
    assert.deepEqual((await store.read(tx=>tx.scan("t","byId",[],{},"asc",10))).map(e=>e.row.id),["d","f"]);
    await store.close();
  });
  test(`${name}: overlapping writes, reads, indexes, metadata and side tables isolate rollback`, async()=>{
    const store=await open(); const entered=defer(), release=defer();
    const first=store.write(async tx=>{ await tx.put("t",{id:"a",value:1}); await tx.setMeta("n",1); await tx.side("outbox").put("a",{id:"a"}); entered.resolve(); await release.promise; throw Error("abort"); });
    first.catch(()=>{}); await entered.promise;
    let observed=false;
    const second=store.write(async tx=>{ assert.equal(await tx.get("t","a"),undefined); await tx.put("t",{id:"b",value:2}); observed=true; });
    await tick(); assert.equal(observed,false,"an unrelated write must wait for ownership");
    release.resolve(); await assert.rejects(first); await second;
    await store.read(async tx=>{ assert.deepEqual(await tx.get("t","b"),{id:"b",value:2}); assert.equal(await tx.lookup("t","byValue",[1]),undefined); assert.equal(await tx.getMeta("n"),undefined); assert.deepEqual(await tx.side("outbox").all(),[]); });
    await store.close();
  });
  test(`${name}: paged snapshots publish all rows and watermark together`,async()=>{
    const store=await open();
    await store.write(async tx=>{await tx.put("t",{id:"old",value:10});await tx.setMeta("watermark",10);await tx.setMeta("generation",1);});
    const replica=new Replica(store,schema,{sync:async()=>{throw Error("unused");}},1);
    const touched=new Set();
    await replica.apply({snapshot:true,events:[{table:"t",kind:"put",id:"a",data:{id:"a",value:11}}],watermark:11,more:true,next:"page2"},touched,true);
    assert.deepEqual(await store.read(tx=>tx.get("t","old")),{id:"old",value:10});
    assert.equal((await replica.state()).watermark,10);
    await assert.rejects(replica.apply({snapshot:true,events:[{table:"missing",kind:"put",id:"bad",data:{id:"bad"}}],watermark:11,more:false},touched,false));
    assert.equal((await replica.state()).watermark,10); assert.ok(await store.read(tx=>tx.get("t","old")));
    await replica.apply({snapshot:true,events:[{table:"t",kind:"put",id:"b",data:{id:"b",value:12}}],watermark:11,more:false},touched,false);
    assert.equal(await store.read(tx=>tx.get("t","old")),undefined);
    assert.deepEqual((await store.read(tx=>tx.scan("t","byId",[],{},"asc",10))).map(e=>e.row.id),["a","b"]);
    assert.equal((await replica.state()).watermark,11);
    await replica.close();
  });
}

test("a zero-watermark snapshot explicitly requests a delta before publishing",async()=>{
  const store=new MemoryStore(schema), calls=[];
  const replica=new Replica(store,schema,{sync:async(from,_limit,after,stream)=>{
    calls.push({from,after,stream});
    assert.equal((await replica.state()).generation,0,"even the final snapshot page remains unpublished");
    return {snapshot:!stream,events:[],watermark:0,more:false};
  }},1);
  assert.equal((await replica.syncOnce()).ok,true);
  assert.deepEqual(calls,[{from:0,after:undefined,stream:false},{from:0,after:undefined,stream:true}]);
  assert.equal((await replica.state()).generation,1);
  await replica.close();
});

test("memory metadata writes do not clone existing replica values; touched-container rollback preserves them",async()=>{
  const store=new MemoryStore(schema);
  await store.write(async tx=>{
    for(let n=0;n<1000;n++)await tx.put("t",{id:String(n),value:n,payload:"x".repeat(1000)});
    await tx.side("outbox").put("existing",{body:"untouched"});
  });
  const clone=globalThis.structuredClone, inputs=[];
  globalThis.structuredClone=(value,options)=>{inputs.push(value);return clone(value,options)};
  try { await store.write(async tx=>{await tx.setMeta("watermark",4);await tx.side("outbox").put("new",{body:"small"});}); }
  finally {globalThis.structuredClone=clone;}
  assert.deepEqual(inputs,[4,{body:"small"}],"metadata-only work clones only its new values");
  await assert.rejects(store.write(async tx=>{
    await tx.put("t",{id:"3",value:-1});await tx.delete("t","4");
    const before=tx.side("outbox");await tx.side("outbox").delete("existing");
    assert.equal(await before.get("existing"),undefined,"handles see the same transaction state");
    await tx.clearRows();await tx.put("t",{id:"replacement",value:2});
    throw Error("rollback");
  }));
  assert.equal((await store.read(tx=>tx.get("t","3"))).value,3);
  assert.equal((await store.read(tx=>tx.lookup("t","byValue",[4]))).id,"4");
  assert.equal(await store.read(tx=>tx.get("t","replacement")),undefined);
  assert.deepEqual(await store.read(tx=>tx.side("outbox").get("existing")),{body:"untouched"});
  await store.close();
});

test("sync callers share one flight and stale generation/pages cannot overwrite it",async()=>{
  const store=new MemoryStore(schema); await store.write(async tx=>{await tx.setMeta("watermark",1);await tx.setMeta("generation",1);});
  const response=defer(); let calls=0;
  const replica=new Replica(store,schema,{sync(){calls++;return response.promise;}},1);
  const a=replica.syncOnce(),b=replica.syncOnce(); assert.equal(a,b);
  await tick(); assert.equal(calls,1);
  response.resolve({snapshot:false,events:[{table:"t",kind:"put",id:"a",data:{id:"a",value:3}}],watermark:3,more:false,generation:1});
  await Promise.all([a,b]);
  await assert.rejects(replica.apply({snapshot:false,events:[],watermark:2,more:false},new Set()));
  assert.equal((await replica.state()).watermark,3);
  replica.adopt(schema,2); assert.equal(replica.isCaughtUp,false);
  await assert.rejects(replica.apply({snapshot:true,events:[],watermark:4,more:false,generation:1},new Set()));
  assert.equal((await replica.state()).watermark,3);
  await replica.close();
});

test("Expo driver uses the transaction-owned connection and serializes callers",async()=>{
  const calls=[]; const entered=defer(), release=defer();
  const owned={async runAsync(sql){calls.push(sql)},async getAllAsync(){return []}};
  const driver=expoSqliteDriver({async runAsync(){throw Error("ambient connection used")},async getAllAsync(){throw Error("ambient connection used")},async withTransactionAsync(){throw Error("nonexclusive transaction used")},async withExclusiveTransactionAsync(body){await body(owned)},async closeAsync(){}});
  const a=driver.transaction(async()=>{await driver.run("a");entered.resolve();await release.promise;});
  await entered.promise; const b=driver.transaction(()=>driver.run("b")); await tick(); assert.deepEqual(calls,["a"]); release.resolve(); await Promise.all([a,b]); assert.deepEqual(calls,["a","b"]);
});

test("ids preserve their timestamp and a burst's submission order",()=>{
  const now=Date.now()+10000,ids=Array.from({length:200},()=>mintId(now));
  assert.deepEqual(ids,[...ids].sort()); assert.equal(new Set(ids).size,ids.length);
  const digits="0123456789ABCDEFGHJKMNPQRSTVWXYZ";
  let number=0n;for(const digit of ids[0])number=(number<<5n)|BigInt(digits.indexOf(digit));
  assert.equal(Number(number>>80n),now);
});

const literal=(value)=>({Literal:typeof value==="number"?{Int:value}:{String:value}});
const returning=(expression)=>({name:"q",kind:"Query",args:{},body:[{Return:expression}]});
const evaluate=(expression,s=schema)=>{const store=new MemoryStore(s);return store.read(tx=>new Interpreter(tx,s,context(),"query").run(returning(expression)));};
test("authored IR arithmetic, Unicode ordering and Euclidean divmod match the value model",async()=>{
  for(const [op,a,b] of [["Add",Number.MAX_SAFE_INTEGER,1],["Sub",-Number.MAX_SAFE_INTEGER,1],["Mul",Number.MAX_SAFE_INTEGER,2]]) await assert.rejects(evaluate({Binary:{op,left:literal(a),right:literal(b)}}),e=>e instanceof Refused&&e.refusal.code==="E_OVERFLOW");
  assert.equal((await evaluate({Binary:{op:"Lt",left:literal("\u{10000}"),right:literal("\ue000")}})).data,false);
  assert.deepEqual((await evaluate({Builtin:{builtin:"Divmod",args:[literal(-7),literal(-3)]}})).data,{quotient:3,remainder:2,sink:"lexicographic-id"});
});

test("a missing point and another index on a horizon remain incomplete after deletion",async()=>{
  const s=structuredClone(schema);s.tables.t.sync.horizon={last:2,by:"byId"};const store=new MemoryStore(s);
  await store.write(async tx=>{await tx.put("t",{id:"y",value:1});await tx.put("t",{id:"z",value:2});await tx.delete("t","y");});
  const point=returning({Get:{table:"t",index:"byId",key:[{Literal:{Id:"old"}}],site:"q"}});
  assert.equal((await store.read(tx=>new Interpreter(tx,s,context(),"query").run(point))).complete,false);
  const scan=returning({Scan:{site:"q",table:"t",index:"byValue",prefix:[],order:"Asc",take:{Literal:10}}});
  assert.equal((await store.read(tx=>new Interpreter(tx,s,context(),"query").run(scan))).complete,false);
});

test("bare tokens reach the server; expired tokens become signed out",async()=>{
  let expired=false,calls=0;
  const client=createClient({url:"http://test.invalid",token:"token",fetch:async(_url,init)=>{calls++;assert.equal(init.headers.authorization,"Bearer token");return Response.json(expired?{denied:{code:"E_AUTH",family:"auth",message:"expired"}}:{data:1,complete:true,seq:1,viewer:"user:alice"},{status:expired?401:200});}});
  assert.equal((await client.query({kind:"query",name:"q"},{})).data,1);assert.equal(client.viewer(),"user:alice");
  expired=true;assert.equal((await client.query({kind:"query",name:"q"},{})).denied.code,"E_AUTH");assert.equal(client.link(),"signed-out");assert.equal(calls,2);await client.close();
});

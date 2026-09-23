// Real HTTP projection, both client stores, watch invalidation and cold restoration.
import test from "node:test";
import assert from "node:assert/strict";
import { spawn, spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import { once } from "node:events";
import { mkdtempSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { createLocalClient } from "../dist/local.js";
import { processDevice } from "../dist/native.js";
import { memoryPersistence, webDevice } from "../dist/web.js";

const root = fileURLToPath(new URL("../../../", import.meta.url));
const binary = process.env.SNAPBACK4_BIN ?? join(root,"target/debug/snapback4");
const fixture = readFileSync(join(root,"crates/snapback4-lang/tests/fixtures/maintained-columns.q"),"utf8");
const source = "use personas alice, bob\n" + fixture.replaceAll("  online only","  sync public");
const api = { kind:"query",name:"postRow" };
const privateTarget="$column:"+createHash("sha256").update(JSON.stringify(["posts","likeCount"])).digest("hex");
async function until(check) {
  const deadline = Date.now()+30000;
  for (;;) { const result=await check(); if(result) return result; if(Date.now()>deadline) throw Error("watch did not converge"); await new Promise(r=>setTimeout(r,20)); }
}

for (const family of ["sqlite","web"]) test(`maintained columns: ${family} watches use server values across interrupted sync and reopen`, {timeout:180000}, async t => {
  const directory=mkdtempSync(join(tmpdir(),"sb4-columns-"));
  mkdirSync(join(directory,"snapback"));
  writeFileSync(join(directory,"snapback/schema.q"),source);
  const server=spawn(binary,["dev","--port","0","--no-watch","--hold-schedules"],{cwd:directory,stdio:["ignore","pipe","pipe"]});
  const exited=once(server,"exit");
  let log="",client,watch,core;
  server.stderr.on("data",chunk=>{log+=chunk});
  t.after(async()=>{watch?.close();await client?.close();if(server.exitCode==null&&server.signalCode==null)server.kill();await exited;rmSync(directory,{recursive:true,force:true})});
  const url=await new Promise((resolve,reject)=>{
    const timer=setTimeout(()=>reject(Error(log)),60000);
    server.once("exit",()=>{clearTimeout(timer);reject(Error(log))});
    server.stdout.on("data",chunk=>{log+=chunk;const address=log.match(/http:\/\/127\.0\.0\.1:\d+/)?.[0];if(address){clearTimeout(timer);resolve(address)}});
  });
  const post=async(path,body)=>{const response=await fetch(url+path,{method:"POST",headers:{"x-snapback-persona":"alice","content-type":"application/json"},body:JSON.stringify(body)});const answer=await response.json();assert.equal(response.status,200,JSON.stringify(answer));return answer};
  const mutation=async(name,id,args)=>{const result=await post(`/m/${name}`,{id,args});assert.equal(result.state,"sent",JSON.stringify(result));return result};
  await mutation("post","parent",{id:"p",at:1});
  const schemaResponse=await fetch(url+"/schema",{headers:{"x-snapback-persona":"alice"}});
  const projection=await schemaResponse.json();
  assert.equal(schemaResponse.status,200,JSON.stringify(projection));
  assert.doesNotMatch(JSON.stringify(projection),/\$column/);
  assert.equal(Object.keys(projection.schema.tables).length,2);
  assert.equal(projection.schema.maintains.length,0);
  assert.equal(Object.keys(projection.schema.tables.posts.maintained).length,3);
  const command=args=>spawnSync(binary,args,{cwd:directory,encoding:"utf8",timeout:30000});
  for(const args of [["check","--json"],["doctor","--json"]]) {
    const out=command(args);assert.equal(out.status,0,out.stdout+out.stderr);assert.doesNotMatch(out.stdout,/\$column/);
    if(args[0]==="check")assert.equal(JSON.parse(out.stdout).tables,2);
    else assert.match(JSON.parse(out.stdout).lines.find(line=>line.startsWith("schema")),/2 tables/);
  }
  assert.doesNotMatch(readFileSync(join(directory,"snapback/generated/api.ts"),"utf8"),/\$column/);
  const privateData=command(["data",privateTarget]);
  assert.notEqual(privateData.status,0);assert.match(privateData.stderr,/posts.likeCount/);
  const privateSql=command(["sql",`select * from "${privateTarget}"`,"--json"]);
  assert.notEqual(privateSql.status,0);assert.match(privateSql.stdout,/posts.likeCount/);assert.doesNotMatch(privateSql.stdout,/\$column/);
  const why=command(["why",privateTarget]);assert.notEqual(why.status,0);assert.match(why.stderr,/posts.likeCount/);assert.doesNotMatch(why.stderr,/\$column/);
  const sql=command(["sql","select likeCount from posts","--json"]);assert.equal(sql.status,0,sql.stderr);assert.match(sql.stdout,/0/);
  const opener=family==="sqlite"?processDevice({dir:join(directory,"devices"),binary}):webDevice({wasm:readFileSync(join(root,"packages/snapback4/src/wasm/snapback4_device_bg.wasm")),persist:memoryPersistence()});
  let offline=false,interrupt=false,pages=0,interruptions=0,delivered=0;
  const open=()=>createLocalClient({url,persona:"alice",waitSeconds:1,device:{open:async(...args)=>{core=await opener.open(...args);return core}},fetch:async(input,init)=>{
    if(offline)throw new TypeError("offline");
    if(String(input).includes("/sync") && init?.body) {
      const catchup=interrupt;
      if(catchup && pages++>0){interruptions++;throw new TypeError("interrupted catch-up")}
      const request=JSON.parse(init.body);request.limit=1;
      const response=await fetch(input,{...init,body:JSON.stringify(request)});
      if(catchup && response.ok)delivered++;
      return response;
    }
    return fetch(input,init);
  }});
  client=await open();
  assert.equal((await client.query(api,{id:"p"})).data.likeCount,0);
  watch=client.observe(api,{id:"p"});
  const observed=[];watch.subscribe(()=>{const row=watch.getSnapshot().data;if(row)observed.push([row.likeCount,row.selected,row.total])});
  await until(()=>watch.getSnapshot().data?.likeCount===0);
  await client.sync();
  offline=true;
  await client.mutate({kind:"mutation",name:"like"},{id:"l",postId:"p",active:true,amount:3});
  assert.equal((await client.query(api,{id:"p"})).data.likeCount,0,"a predicted like never increments its parent");
  await client.mutate({kind:"mutation",name:"post"},{id:"pending-parent",at:3});
  const pendingParent=(await client.query(api,{id:"pending-parent"})).data;
  assert.equal(pendingParent.likeCount,0);
  assert.equal(pendingParent.pending,true);
  const predicted=await core.call({op:"query",name:"postRow",viewer:"dev:alice",args:{id:"p"},now:1000});
  assert.equal(predicted.ok.data.likeCount,0);
  await mutation("post","second-parent",{id:"q",at:2});
  offline=false;interrupt=true;pages=0;
  await until(async()=>{await client.sync();return interruptions>0});
  assert.equal(delivered,1,"catch-up received a page before its next request was interrupted");
  watch.close();await client.close();
  interrupt=false;client=await open();
  watch=client.observe(api,{id:"p"});watch.subscribe(()=>{});
  await until(async()=>{await client.sync();return watch.getSnapshot().data?.likeCount===1});
  assert.equal(watch.getSnapshot().data.total,3);
  // The earlier like can settle before the independently queued parent insert.
  const confirmedParent=await until(async()=>{
    await client.sync();
    const row=(await client.query(api,{id:"pending-parent"})).data;
    return row&&row.pending!==true&&row;
  });
  assert.equal(confirmedParent.likeCount,0);
  assert.notEqual(confirmedParent.pending,true);
  for(const [name,id,args,expected] of [
    ["change","filter",{id:"l",postId:"p",active:false,amount:9},[1,0,0]],
    ["change","move",{id:"l",postId:"q",active:true,amount:2},[0,0,0]],
  ]) {
    await mutation(name,id,args);await client.sync();
    await until(()=>{const r=watch.getSnapshot().data;return r&&[r.likeCount,r.selected,r.total].every((n,i)=>n===expected[i])});
    const serverRow=(await post("/q/postRow",{args:{id:"p"}})).data;
    assert.deepEqual(watch.getSnapshot().data,serverRow);
  }
  const changes=await(await fetch(url+"/changes?since=0&wait=0",{headers:{"x-snapback-persona":"alice"}})).json();
  assert.deepEqual(changes.tables,["likes","posts"]);
  assert.ok(observed.every(([n])=>n===0||n===1));
  watch.close();await client.close();client=undefined;
});

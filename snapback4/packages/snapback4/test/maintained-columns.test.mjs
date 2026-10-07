import { captureStdout } from './helpers/server-output.mjs';
import { waitFor as awaitState, hangBudget } from './helpers/wait.mjs';
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
const triple = row => { publicJson(row); return [row.likeCount,row.selected,row.total]; };
const publicJson = value => assert.doesNotMatch(JSON.stringify(value),/\$column:/i);
const privateTarget="$column:"+createHash("sha256").update(JSON.stringify(["posts","likeCount"])).digest("hex");
async function until(check) { return awaitState(check); }
// These assertions inspect speculative/partially acquired views. One-shots now
// wait for dependent observation; the observation arm still exposes predictions.
async function snapshot(client, args) {
  const view = client.observe(api, args), stop = view.subscribe(() => {});
  try { return await until(() => view.getSnapshot().data); }
  finally { stop(); view.close(); }
}

for (const family of ["sqlite","web"]) for (const queuedTail of [false,true]) test(`maintained columns: ${family} watches use server values across interrupted sync and reopen (${queuedTail ? "queued tail" : "one write"})`, {timeout:hangBudget(51)}, async t => {
  const directory=mkdtempSync(join(tmpdir(),"sb4-columns-"));
  mkdirSync(join(directory,"snapback"));
  writeFileSync(join(directory,"snapback/schema.q"),source);
  const server=spawn(binary,["dev","--port","0","--no-watch","--hold-schedules"],{cwd:directory,stdio:["ignore","pipe","pipe"]});
  const readStdout = captureStdout(server);
  const exited=once(server,"exit");
  let log="",client,watch,core;
  server.stderr.on("data",chunk=>{log+=chunk});
  t.after(async()=>{watch?.close();await client?.close();if(server.exitCode==null&&server.signalCode==null)server.kill();await exited;rmSync(directory,{recursive:true,force:true})});
  const url=await new Promise((resolve,reject)=>{
    const timer=setTimeout(()=>reject(Error(log)),hangBudget());
    server.once("exit",()=>{clearTimeout(timer);reject(Error(log))});
    server.stdout.on("data",chunk=>{log+=chunk;const address=readStdout().match(/http:\/\/127\.0\.0\.1:\d+(?=\r?\n)/)?.[0];if(address){clearTimeout(timer);resolve(address)}});
  });
  const post=async(path,body)=>{const response=await fetch(url+path,{method:"POST",headers:{"x-snapback-persona":"alice","content-type":"application/json"},body:JSON.stringify(body)});const answer=await response.json();assert.equal(response.status,200,JSON.stringify(answer));publicJson(answer);return answer};
  const mutation=async(name,id,args)=>{const result=await post(`/m/${name}`,{id,args});assert.equal(result.state,"sent",JSON.stringify(result));return result};
  await mutation("post","parent",{id:"p",at:1});
  const schemaResponse=await fetch(url+"/schema",{headers:{"x-snapback-persona":"alice"}});
  const projection=await schemaResponse.json();
  assert.equal(schemaResponse.status,200,JSON.stringify(projection));
  assert.doesNotMatch(JSON.stringify(projection),/\$column/);
  assert.equal(Object.keys(projection.schema.tables).length,2);
  assert.equal(projection.schema.maintains.length,0);
  assert.equal(Object.keys(projection.schema.tables.posts.maintained).length,3);
  const command=args=>spawnSync(binary,args,{cwd:directory,encoding:"utf8",timeout:hangBudget()});
  for(const args of [["check","--json"],["doctor","--json"]]) {
    const out=command(args);assert.equal(out.status,0,out.stdout+out.stderr);assert.doesNotMatch(out.stdout,/\$column/);
    if(args[0]==="check")assert.equal(JSON.parse(out.stdout).tables,2);
    else assert.match(JSON.parse(out.stdout).lines.find(line=>line.startsWith("schema")),/2 tables/);
  }
  assert.doesNotMatch(readFileSync(join(directory,"snapback/generated/api.ts"),"utf8"),/\$column/);
  const privateData=command(["data",privateTarget]);
  assert.notEqual(privateData.status,0);assert.match(privateData.stderr,/posts\.likeCount/);assert.doesNotMatch(privateData.stderr,/\$column/);
  const privateSql=command(["sql",`select * from "${privateTarget}"`,"--json"]);
  assert.notEqual(privateSql.status,0);assert.match(privateSql.stdout,/posts\.likeCount/);assert.doesNotMatch(privateSql.stdout,/\$column/);
  for(const alias of ["\\d", ".schema"]) for(const target of [privateTarget, privateTarget.toUpperCase()]) for(const json of [false,true]) {
    const refused=command(["sql",`${alias} ${target}`,...(json?["--json"]:[])]);
    assert.equal(refused.status,1,refused.stdout+refused.stderr);
    const output=json?refused.stdout:refused.stderr;
    assert.match(output,/E_MAINTAINED_COLUMN_PRIVATE/);assert.match(output,/posts\.likeCount/);
    assert.doesNotMatch(output,/\$column:/i);assert.ok(!output.toLowerCase().includes(privateTarget.slice(8)));
    const message=json?JSON.parse(output).denied.message:output;
    assert.ok(message.includes(JSON.parse(privateSql.stdout).denied.message));
    assert.ok(message.includes("`\\dt` lists tables; `\\d messages` describes one"));
  }
  const catalog=command(["sql","\\dt","--json"]);
  assert.equal(catalog.status,0,catalog.stderr);assert.doesNotMatch(catalog.stdout,/\$column/);
  assert.equal(JSON.parse(catalog.stdout).tables.length,2);
  const described=command(["sql","\\d posts","--json"]);
  assert.equal(described.status,0,described.stderr);assert.doesNotMatch(described.stdout,/\$column/);
  assert.equal(JSON.parse(described.stdout).tables[0].columns.find(c=>c.name==="likeCount").maintained,true);
  const why=command(["why",privateTarget]);assert.notEqual(why.status,0);assert.match(why.stderr,/posts\.likeCount/);assert.doesNotMatch(why.stderr,/\$column/);
  const sql=command(["sql","select likeCount from posts","--json"]);assert.equal(sql.status,0,sql.stderr);assert.deepEqual(JSON.parse(sql.stdout).rows,[[0]]);
  const opener=family==="sqlite"?processDevice({dir:join(directory,"devices"),binary}):webDevice({wasm:readFileSync(join(root,"packages/snapback4/src/wasm/snapback4_device_bg.wasm")),persist:memoryPersistence()});
  const receivedPages=[];
  let offline=false,interrupt=false,interruptions=0,delivered=0,interruptedPage,tailPosted=false;
  const open=()=>createLocalClient({url,persona:"alice",waitSeconds:1,device:{open:async(...args)=>{core=await opener.open(...args);return core}},fetch:async(input,init)=>{
    if(offline)throw new TypeError("offline");
    if(String(input).includes("/sync") && init?.body) {
      // Explicit/background sync can race the FIFO drain. Exercise the page
      // whose image head includes both commits, regardless of that scheduling.
      if(interrupt && queuedTail && !tailPosted)throw new TypeError("catch-up held until queued tail posted");
      const catchup=interrupt;
      if(catchup && interruptedPage){interruptions++;throw new TypeError("interrupted catch-up")}
      const request=JSON.parse(init.body);request.limit=1;
      const response=await fetch(input,{...init,body:JSON.stringify(request)});
      if(response.ok) {
        const page=await response.clone().json();receivedPages.push(page);publicJson(page);
        if(catchup){
          delivered++;
          if(page.events?.some(event=>event.table==="posts" && event.id==="p" && event.kind==="put" && event.data?.likeCount===1))interruptedPage=page;
        }
      }
      return response;
    }
    const response=await fetch(input,init);
    if(String(input).includes("/m/post") && response.ok && JSON.parse(init.body).args.id==="pending-parent")tailPosted=true;
    return response;
  }});
  client=await open();
  assert.equal((await client.query(api,{id:"p"})).data.likeCount,0);
  watch=client.observe(api,{id:"p"});
  const observed=[];
  const record=()=>{const row=watch.getSnapshot().data;if(row)observed.push(triple(row))};
  watch.subscribe(record);
  await until(()=>watch.getSnapshot().data?.likeCount===0);
  await client.sync();
  offline=true;
  await client.mutate({kind:"mutation",name:"like"},{id:"l",postId:"p",active:true,amount:3});
  assert.equal((await snapshot(client,{id:"p"})).likeCount,0,"a predicted like never increments its parent");
  const predictParent=async()=>{
    await client.mutate({kind:"mutation",name:"post"},{id:"pending-parent",at:3});
    const pendingParent=await snapshot(client,{id:"pending-parent"});
    assert.deepEqual(triple(pendingParent),[0,0,0]);
    assert.equal(pendingParent.pending,true);
  };
  if(queuedTail)await predictParent();
  const predicted=await core.call({op:"query",name:"postRow",viewer:"dev:alice",args:{id:"p"},now:1000});
  assert.equal(predicted.ok.data.likeCount,0);
  await mutation("post","second-parent",{id:"q",at:2});
  offline=false;interrupt=true;
  await until(async()=>{await client.sync();return interruptions>0});
  assert.ok(delivered>=1,"catch-up received the parent image before its next request was interrupted");
  const deliveredParents=interruptedPage.events.filter(event=>event.table==="posts" && event.id==="p" && event.kind==="put" && event.data?.likeCount===1);
  assert.equal(deliveredParents.length,1);
  const deliveredParent=deliveredParents[0].data;
  assert.deepEqual(triple(deliveredParent),[1,1,3],"interrupt only after receiving a nonzero authoritative parent image");
  const interrupted=await snapshot(client,{id:"p"});
  // @ref LLP 3000.001#repair-b-never-install-a-confirmed-image-over-a-row-a-live-prediction-writes — receiving an image ahead of another queued commit does not publish it.
  if(queuedTail){
    assert.ok(interruptedPage.images_at>interruptedPage.watermark);
    assert.equal(Object.keys(interruptedPage.committed_above).length,1,"the queued parent committed above this page's cut");
    const state=(await core.call({op:"sync_state",capture:false})).ok;
    assert.ok(state.watermark<interruptedPage.watermark,"the public watermark stays with the unchanged base");
    assert.equal(state.transfer_watermark,interruptedPage.watermark,"only private transfer progress advances");
    assert.deepEqual(triple(interrupted),[0,0,0],"a deferred page cannot publish its maintained values");
  }else{
    assert.equal(interruptedPage.images_at,interruptedPage.watermark);
    assert.deepEqual(triple(interrupted),triple(deliveredParent),"an eligible delivered image is readable before resuming sync");
  }
  await until(()=>JSON.stringify(triple(watch.getSnapshot().data??{}))===JSON.stringify(triple(interrupted)));
  assert.deepEqual(triple(watch.getSnapshot().data),triple(interrupted));
  watch.close();await client.close();
  offline=true;interrupt=false;client=await open();
  assert.deepEqual(triple(await snapshot(client,{id:"p"})),triple(interrupted),"the published base survives reopening while an interrupted page remains private");
  if(!queuedTail)await predictParent();
  offline=false;
  watch=client.observe(api,{id:"p"});watch.subscribe(record);
  await until(async()=>{await client.sync();return watch.getSnapshot().data?.likeCount===1});
  assert.deepEqual(triple(watch.getSnapshot().data),[1,1,3]);
  // The earlier like can settle before the independently queued parent insert.
  const confirmedParent=await until(async()=>{
    await client.sync();
    const row=(await client.query(api,{id:"pending-parent"})).data;
    return row&&row.pending!==true&&row;
  });
  assert.equal(confirmedParent.likeCount,0);
  assert.notEqual(confirmedParent.pending,true);
  assert.deepEqual(confirmedParent,(await post("/q/postRow",{args:{id:"pending-parent"}})).data);
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
  assert.deepEqual(changes.tables,["likes","posts"]);publicJson(changes);
  const destination=(await client.query(api,{id:"q"})).data;
  assert.deepEqual(triple(destination),[1,1,2]);
  assert.deepEqual(destination,(await post("/q/postRow",{args:{id:"q"}})).data);
  assert.equal(privateData.stdout,"");
  assert.equal(why.stdout,"");
  assert.deepEqual(Object.keys(JSON.parse(privateSql.stdout)).filter(key=>!["ok","denied","error"].includes(key)),[]);
  for(const result of [privateData,privateSql,why]) {
    const text=result.stdout+result.stderr;
    // A refusal may name posts.likeCount; it must carry no JSON value or total.
    assert.doesNotMatch(text,/\$column:/i);assert.doesNotMatch(text,/"(?:value|likeCount|selected|total)"\s*:/);
  }
  publicJson(log);
  for(const page of receivedPages)publicJson(page);
  for(const sample of observed) {
    assert.equal(sample.length,3);
    assert.ok(sample[0]===0 || sample[0]===1);
    assert.ok(sample[1]===0 || sample[1]===1);
    assert.ok(sample[2]===0 || sample[2]===3);
  }
  let position=0;
  for(const expected of [[0,0,0],[1,1,3],[1,0,0],[0,0,0]]) {
    while(position<observed.length && !observed[position].every((n,i)=>n===expected[i]))position++;
    assert.ok(position<observed.length,`watch missed ${JSON.stringify(expected)}: ${JSON.stringify(observed)}`);
    position++;
  }
  watch.close();await client.close();client=undefined;
  offline=true;client=await open();
  watch=client.observe(api,{id:"q"});watch.subscribe(()=>{});
  await until(()=>watch.getSnapshot().data?.likeCount===1);
  assert.deepEqual(triple(watch.getSnapshot().data),[1,1,2],"cold offline watched row preserves the server image");
  watch.close();await client.close();client=undefined;
});

import { captureStdout } from './helpers/server-output.mjs';
import { hangBudget } from './helpers/wait.mjs';
// A composed mutation at the maintained-column source-attempt ceiling. Its
// distinct old/new parent images exceed 16 MiB; the real HTTP recovery path
// must restart the snapshot at the same generation, on both device stores.
import test from "node:test";
import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { once } from "node:events";
import { mkdtempSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { setTimeout as delay } from "node:timers/promises";
import { createLocalClient } from "../dist/local.js";
import { processDevice } from "../dist/native.js";
import { memoryPersistence, webDevice } from "../dist/web.js";

const root = fileURLToPath(new URL("../../../", import.meta.url));
const binary = process.env.SNAPBACK4_BIN ?? join(root, "target/debug/snapback4");
const ceiling = 16 << 20, moves = 204, width = 42000;
const source = `use personas alice
table posts:
  body: text <=42000
  likeCount: count likes by postId
  public
  sync public
table likes:
  postId: posts
  public
  update <- allow
  online only
query one(id: posts):
  return posts[id]
mutation moveAll():
` + Array.from({length:moves}, (_, n) => `  update likes['l${n}'] { postId: 'q${n}' }\n`).join("");

function parkedChanges(signal) {
  let cleanup;
  return new Response(new ReadableStream({start(controller){
    const beat=()=>controller.enqueue(new Uint8Array([32,10]));
    const timer=setInterval(beat,500);
    const abort=()=>{cleanup();controller.error(signal.reason)};
    cleanup=()=>{clearInterval(timer);signal.removeEventListener("abort",abort)};
    if(signal.aborted)abort();else{signal.addEventListener("abort",abort,{once:true});beat()}
  },cancel(){cleanup()}}));
}

test("the largest row-bounded source batch recovers oversized parent mirrors by snapshot", {timeout:hangBudget(1020)}, async t => {
  const dir = mkdtempSync(join(tmpdir(),"sb4-column-stream-"));
  mkdirSync(join(dir,"snapback")); writeFileSync(join(dir,"snapback/schema.q"),source);
  const child = spawn(binary,["dev","--port","0","--no-watch","--hold-schedules"],{cwd:dir,stdio:["ignore","pipe","pipe"]});
  const readStdout = captureStdout(child);
  const exited = once(child,"exit");
  let url, log="";
  const clients=[];
  for(const stream of [child.stdout,child.stderr]) stream.on("data",bytes=>{log+=bytes;url ??= readStdout().match(/http:\/\/127\.0\.0\.1:\d+(?=\r?\n)/)?.[0]});
  t.after(async()=>{for(const d of clients)await d.client.close();if(child.exitCode==null&&child.signalCode==null)child.kill();await exited;rmSync(dir,{recursive:true,force:true})});
  const deadline=performance.now() + hangBudget();
  while(!url){assert.equal(child.exitCode,null,log);assert.ok(performance.now()<deadline,log);await delay(20)}
  const engine = await processDevice({binary,dir:join(dir,"identity")}).engineInfo();
  const post=async(path,body)=>{
    const response=await fetch(url+path,{method:"POST",headers:{"x-snapback-persona":"alice","x-snapback-device":JSON.stringify(engine)},body:JSON.stringify(body)});
    assert.equal(response.status,200);return response.json();
  };
  const parents=Array.from({length:moves},(_,n)=>["p","q"].map(prefix=>({table:"posts",row:{id:prefix+n,body:"x".repeat(width)}}))).flat();
  for(let i=0;i<parents.length;i+=32)assert.equal((await post("/seed",parents.slice(i,i+32))).seeded,Math.min(32,parents.length-i));
  assert.equal((await post("/seed",Array.from({length:moves},(_,n)=>({table:"likes",row:{id:"l"+n,postId:"p"+n}})))).seeded,moves);
  const head=await post("/sync",{from:0,limit:1});
  for(const tier of ["sqlite","wasm"]){
    const opener=tier==="sqlite"?processDevice({binary,dir:join(dir,tier)}):webDevice({wasm:readFileSync(join(root,"packages/snapback4/src/wasm/snapback4_device_bg.wasm")),persist:memoryPersistence()});
    const d={tier,pages:[],core:null,client:null,offline:false,record:false};
    d.client=await createLocalClient({url,persona:"alice",waitSeconds:1,device:{engineInfo:()=>opener.engineInfo(),open:async(...args)=>d.core=await opener.open(...args)},fetch:async(input,init)=>{
      if(new URL(input).pathname==="/changes")return parkedChanges(init.signal);
      if(d.offline)throw new TypeError("paused device");
      const response=await fetch(input,init);
      if(d.record && new URL(input).pathname==="/sync"){
        const bytes=await response.clone().arrayBuffer();assert.ok(bytes.byteLength<=ceiling);
        d.pages.push({request:JSON.parse(init.body),page:JSON.parse(new TextDecoder().decode(bytes)),bytes:bytes.byteLength});
      }
      return response;
    }});
    clients.push(d);assert.equal(d.client.acquired,true);
    assert.equal((await d.client.query({kind:"query",name:"one"},{id:"p0"})).data.likeCount,1);
    d.offline=true;d.pages.length=0;
  }
  const mutation=await post("/m/moveAll",{id:"all",args:{}});assert.equal(mutation.state,"sent",JSON.stringify(mutation));
  const refused=await post("/sync",{from:head.watermark,stream:true,limit:1,generation:head.generation});
  assert.equal(refused.denied?.code,"E_BOUND");assert.equal(refused.snapshot,true);
  assert.equal(refused.generation,head.generation);
  for(const d of clients){
    d.record=true;d.offline=false;await d.client.sync();
    const state=(await d.core.call({op:"state"})).ok;
    assert.equal(state.generation,head.generation);
    const refusedPage=d.pages.find(({request,page})=>request.limit===1 && page.denied?.code==="E_BOUND" && page.snapshot);
    assert.ok(refusedPage);
    assert.equal(refusedPage.page.watermark,refused.watermark);
    const accepted=d.pages.find(({request,page})=>request.from===0 && page.snapshot && !page.denied);
    assert.ok(accepted);
    assert.equal(state.watermark,accepted.page.watermark, "successful snapshot owns progress");
    assert.equal(accepted.page.watermark,mutation.seq, "snapshot includes the committed move");
    for(let n=0;n<moves;n++)for(const [prefix,value] of [["p",0],["q",1]]){
      const id=prefix+n;
      const row=(await d.core.call({op:"query",name:"one",viewer:"dev:alice",args:{id},now:1000})).ok.data;
      assert.equal(row.likeCount,value);assert.equal(row.body.length,width);
    }
    t.diagnostic(JSON.stringify({tier:d.tier,source_moves:moves,parent_images:2*moves,parent_body_bytes:2*moves*width,ceiling,generation:state.generation,watermark:state.watermark,max_response_bytes:Math.max(...d.pages.map(p=>p.bytes))}));
  }
});

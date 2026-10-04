import { captureStdout } from './server-output.mjs';
import { waitFor as awaitState } from './wait.mjs';
// LLP 3000.014: the same capture images and parent fallback on wasm and native.
import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { once } from "node:events";
import { mkdtempSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { createLocalClient } from "../../dist/local.js";
import { processDevice } from "../../dist/native.js";
import { memoryPersistence, webDevice } from "../../dist/web.js";
export const root=join(dirname(fileURLToPath(import.meta.url)),"../../../..");
const binary=process.env.SNAPBACK4_BIN??join(root,"target/debug/snapback4");
const wasm=readFileSync(join(root,"packages/snapback4/src/wasm/snapback4_device_bg.wasm"));
const sleep=ms=>new Promise(r=>setTimeout(r,ms));
export async function server(t,tier,source) {
  const dir=mkdtempSync(join(tmpdir(),"sb4-through-"));mkdirSync(join(dir,"snapback"));mkdirSync(join(dir,"device"));
  writeFileSync(join(dir,"snapback/schema.q"),"use personas alice, bob\n"+source);
  const child=spawn(binary,["dev","--port","0","--fresh","--no-watch"],{cwd:dir,stdio:["ignore","pipe","pipe"]});
  const readStdout = captureStdout(child);
  const exit=once(child,"exit");let log="",url,client,core,paused=false;const deliveries=new Set();
  child.stdout.on("data",d=>{log+=d;url??=readStdout().match(/http:\/\/127\.0\.0\.1:\d+(?=\r?\n)/)?.[0];});child.stderr.on("data",d=>log+=d);
  t.after(async()=>{paused=false;for(const resume of deliveries)resume();deliveries.clear();await client?.close();if(child.exitCode==null&&child.signalCode==null)child.kill("SIGTERM");await exit;rmSync(dir,{recursive:true,force:true});});
  await awaitState(async () => !(!url), "helpers/read-through-server.mjs: !url", { poll: async () => {assert.equal(child.exitCode,null,log);await sleep(20);} });assert.ok(url,log);
  const post=(path,body)=>fetch(url+path,{method:"POST",headers:{"x-snapback-persona":"bob"},body:JSON.stringify(body)}).then(r=>r.json());
  const opener=tier==="wasm"?webDevice({wasm,persist:memoryPersistence()}):processDevice({binary,dir:join(dir,"device"),spawn:(cmd,args)=>spawn(cmd,args,{stdio:["pipe","pipe","inherit"]}),writeFile:async(path,text)=>writeFileSync(path,text)});
  const requests=[],answers=[];let refresh;
  // `host.refresh = ms` shortens the presence refresh a server asks of its /q/ replies.
  return {post,requests,answers,get core(){return core;},pauseSync(){paused=true;},set refresh(ms){refresh=ms;},async open(){
    client=await createLocalClient({url,persona:"bob",waitSeconds:1,fetch:async(input,init)=>{
      const path=new URL(input).pathname;requests.push(path);const response=await fetch(input,init);
      if(paused&&path==="/sync")await new Promise(resolve=>deliveries.add(resolve));
      if(refresh!==undefined&&path.startsWith("/q/")){const json=await response.json();if(json.refresh!==undefined)json.refresh=refresh;return Response.json(json,{status:response.status});}
      return response;
    },device:{open:async(...args)=>{core=await opener.open(...args);return {close:()=>core.close(),call:async(request,committed)=>{const reply=await core.call(request,committed);if(request.op==="query")answers.push({name:request.name,...reply.ok});return reply;}};}}});
    await client.sync();return client;
  }};
}

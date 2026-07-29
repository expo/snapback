import { createClient } from "@supabase/supabase-js";
import { mkdir, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { performance } from "node:perf_hooks";
import { spawn } from "node:child_process";

const arm = new URL("..",import.meta.url).pathname.replace(/\/$/,"");
const evidenceDir = process.env.EVIDENCE_DIR ?? join(arm,"evidence-r2");
await mkdir(join(evidenceDir,"scenarios"),{recursive:true});
const target = process.env.TARGET_IDENTITY ?? "llp0102-research-supabase-w2-r2";
const url=process.env.SUPABASE_URL!;
const key=process.env.SUPABASE_PUBLISHABLE_KEY!;
if(!url||!key) throw new Error("missing performance credentials");
const alice=()=>createClient(url,key,{auth:{persistSession:false,autoRefreshToken:false}});
const warmups=2;
const recorded=7;
const room="10000000-0000-4000-8000-000000000001";
const samples:Record<string,number[]>={searchMs:[],writeMs:[],progressBroadcastMs:[],reconnectMs:[],artifactBuildMs:[]};

async function login() {
  const c=alice();
  const {data,error}=await c.auth.signInWithPassword({email:"alice@research.invalid",password:"Alice-research-0102!"});
  if(error||!data.session) throw new Error(`login: ${error?.message}`);
  await c.realtime.setAuth(data.session.access_token);
  return c;
}
const primary=await login();
async function runCommand(command:string,args:string[],cwd:string) {
  await new Promise<void>((resolve,reject)=>{
    const child=spawn(command,args,{cwd,stdio:"ignore"});
    child.on("exit",code=>code===0?resolve():reject(new Error(`${command} exited ${code}`)));
    child.on("error",reject);
  });
}
function percentile(values:number[],p:number) {
  const sorted=[...values].sort((a,b)=>a-b);
  return sorted[Math.min(sorted.length-1,Math.ceil(sorted.length*p)-1)];
}
for(let iteration=0;iteration<warmups+recorded;iteration++){
  let begin=performance.now();
  const searched=await primary.rpc("keyword_search",{target_room:room,terms:"quasar"});
  if(searched.error||searched.data.length!==3) throw new Error("search sample failed");
  const search=performance.now()-begin;

  begin=performance.now();
  const written=await primary.rpc("start_question",{target_room:room,question_prompt:`performance ${iteration}`,client_dedupe_key:`perf-write-${iteration}`});
  if(written.error) throw new Error(`write sample: ${written.error.message}`);
  const write=performance.now()-begin;

  const topic=`question:${written.data.id}`;
  const channel=primary.channel(topic,{config:{private:true}});
  let settleProgress:(value:number)=>void=()=>{};
  const observed=new Promise<number>(resolve=>{settleProgress=resolve;});
  channel.on("broadcast",{event:"progress"},()=>settleProgress(performance.now()));
  await new Promise<void>((resolve,reject)=>{
    const timer=setTimeout(()=>reject(new Error("progress subscribe timeout")),10_000);
    channel.subscribe(status=>{
      if(status==="SUBSCRIBED"){clearTimeout(timer);resolve();}
      if(status==="CHANNEL_ERROR"){clearTimeout(timer);reject(new Error("progress subscribe denied"));}
    });
  });
  begin=performance.now();
  const appended=await primary.rpc("append_progress",{target_question:written.data.id,progress_seq:1,progress_stage:"performance"});
  if(appended.error||appended.data!==true) throw new Error("progress append failed");
  const progress=(await Promise.race([observed,new Promise<number>((_,reject)=>setTimeout(()=>reject(new Error("progress event timeout")),10_000))]))-begin;
  await primary.removeChannel(channel);

  const reconnectClient=await login();
  const reconnectChannel=reconnectClient.channel(topic,{config:{private:true}});
  begin=performance.now();
  const reconnect=await new Promise<number>((resolve,reject)=>{
    const timer=setTimeout(()=>reject(new Error("reconnect timeout")),10_000);
    reconnectChannel.subscribe(status=>{
      if(status==="SUBSCRIBED"){clearTimeout(timer);resolve(performance.now()-begin);}
      if(status==="CHANNEL_ERROR"){clearTimeout(timer);reject(new Error("reconnect denied"));}
    });
  });
  await reconnectClient.removeChannel(reconnectChannel);

  begin=performance.now();
  await runCommand("npm",["run","build","--silent"],arm);
  const build=performance.now()-begin;

  if(iteration>=warmups){
    samples.searchMs.push(search);
    samples.writeMs.push(write);
    samples.progressBroadcastMs.push(progress);
    samples.reconnectMs.push(reconnect);
    samples.artifactBuildMs.push(build);
  }
}
const summary=Object.fromEntries(Object.entries(samples).map(([name,values])=>[name,{
  median:Number(percentile(values,.5).toFixed(3)),
  p95:Number(percentile(values,.95).toFixed(3)),
  min:Number(Math.min(...values).toFixed(3)),
  max:Number(Math.max(...values).toFixed(3))
}]));
const value={
  schemaVersion:1,
  provider:"supabase",
  app:"research-room",
  target,
  extension:true,
  lineage:{frozenOriginalTarget:"llp0102-research-supabase-w2",originalMetricWindow:"frozen-at-stop"},
  warmups,
  recordedSamples:recorded,
  samples,
  summary,
  paths:{
    search:"PostgREST RPC -> PostgreSQL FTS GIN",
    write:"PostgREST RPC -> transactional PostgreSQL function",
    progress:"PostgreSQL AFTER INSERT -> realtime.broadcast_changes -> private Phoenix WebSocket",
    reconnect:"fresh authenticated Supabase client -> private Realtime topic",
    artifactBuild:"Vite production client build",
    hostedDeploy:"not sampled: shared hosted credentials did not include a project-scoped CLI access token"
  },
  costWindow:{
    localActualUsd:0,
    localPlan:"official local CLI stack",
    hostedActualUsd:null,
    hostedListPriceExtrapolation:null,
    confidence:"local-only; no hosted cost claim"
  }
};
await writeFile(join(evidenceDir,"performance.json"),JSON.stringify(value,null,2)+"\n");
await writeFile(join(evidenceDir,"scenarios","RESEARCH-14-PERFORMANCE.json"),JSON.stringify({
  schemaVersion:1,id:"RESEARCH-14-PERFORMANCE",status:"pass-local-with-hosted-deploy-gap",checkedAt:new Date().toISOString(),
  evidence:{warmups,recordedSamples:recorded,rawSamples:"../performance.json",summary,costWindow:value.costWindow,hostedDeployGap:value.paths.hostedDeploy}
},null,2)+"\n");
console.log(JSON.stringify({ok:true,warmups,recorded,summary}));

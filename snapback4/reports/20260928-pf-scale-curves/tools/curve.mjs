import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { execFileSync } from 'node:child_process';
import { performance } from 'node:perf_hooks';
const base=path.resolve(process.env.PF_ROOT ?? 'target/pf');
const repo=path.resolve('.');
const {createClient, read}=await import(pathToFileURL(path.join(base,'replay/scripts/api-client.mjs')));
const {defaultFetch}=await import(pathToFileURL(path.join(repo,'snapback4/packages/snapback4/dist/node-fetch.js')));
const tag=process.argv[2];
const bin=path.resolve(process.env.PF_BIN ?? path.join(base,'snapback4-before'));
const register=fs.readFileSync('benchmarks/fixtures/social-messenger/scale.log','utf8').split('\n').find(s=>s.includes('u0500 register '));
const parts=register.match(/"(?:\\.|[^"\\])*"|\S+/g).map(x=>x[0]==='"'?JSON.parse(x):x);
const host=()=>({at:new Date().toISOString(),loadavg:os.loadavg(),cpus:os.cpus().length,freeBytes:os.freemem(),cpu:fs.readFileSync('/proc/stat','utf8').split('\n')[0],pressure:fs.readFileSync('/proc/pressure/cpu','utf8')});
const specs=[['search100','chat.searchMessages',{q:'coffee',conversation:null,c:null}],['insights','insights.summary',{}]];
const result={tag,host:host(),method:'9 balanced rounds; 10 reads per probe using the exact builder read helper; 3 warmups per op; p95=max as in the builder',rounds:[],supplements:[],doctor:{}};
const clients=[];
try{
 for(const [stage,port] of [['10pct',49462],['50pct',49463],['full',49460]]){
  const url=`http://127.0.0.1:${port}`,cwd=path.join(base,stage);
  const auth=await defaultFetch(url+'/auth/login',{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({email:parts[3],password:parts[4]})}).then(r=>r.json());
  if(!auth.session)throw Error(JSON.stringify(auth));
  const captured=[];
  const fetch=async(input,init)=>{const r=await defaultFetch(input,init);if(String(input).includes('/q/'))captured.push(r.headers.get('server-timing'));return r;};
  const client=createClient({url,token:auth.session.token,fetch});
  for(const [,op,args]of specs)for(let i=0;i<3;i++)await read(client,op,args);
  captured.length=0;
  execFileSync(bin,['doctor','--latency','--reset','--json'],{cwd});
  clients.push({stage,url,cwd,client,captured,token:auth.session.token});
 }
 for(let round=0;round<9;round++)for(let position=0;position<3;position++){
  const c=clients[(round+position)%3];
  const batch={round,stage:c.stage,host:host(),probes:{}};
  for(const [name,op,args] of specs){
   const times=[];c.captured.length=0;let last;
   for(let i=0;i<10;i++){const start=performance.now();last=await read(c.client,op,args);times.push(performance.now()-start);}
   if(!last.complete || (name==='search100'&&last.data.length!==20))throw Error('Incomplete '+name);
   const sorted=[...times].sort((a,b)=>a-b);
   batch.probes[name]={p50:sorted[4],p95:sorted[9],max:sorted[9],times,serverTiming:[...c.captured],meter:last.meter,complete:last.complete,data:last.data};
  }
  result.rounds.push(batch);
 }
 for(const c of clients){
  result.doctor[c.stage]=JSON.parse(execFileSync(bin,['doctor','--latency','--json'],{cwd:c.cwd,encoding:'utf8'}));
  const baseRead=await read(c.client,specs[0][1],specs[0][2]);
  const ids=baseRead.data.map(r=>r.id).concat('00000000000000000000000000');
  for(const n of [0,21]){
   const samples=[];let json;
   for(let i=0;i<10;i++){
    const start=performance.now();const r=await defaultFetch(c.url+'/q/chat.pfOrdinary',{method:'POST',headers:{authorization:'Bearer '+c.token,'content-type':'application/json'},body:JSON.stringify({args:{q:'coffee',c:null},searchRetained:ids.slice(0,n)})});
    json=await r.json();samples.push({ms:performance.now()-start,timing:r.headers.get('server-timing')});
    if(json.denied||!json.complete||json.data.length!==20)throw Error(JSON.stringify(json));
    if(JSON.stringify(json.data)!==JSON.stringify(baseRead.data))throw Error('ordinary page differs');
    if(JSON.stringify(json.searchCurrent)!==JSON.stringify(ids.slice(0,n===0?0:20)))throw Error('overlap differs');
   }
   result.supplements.push({stage:c.stage,retained:n,host:host(),samples,meter:json.meter,current:json.searchCurrent,scopes:json.searchScopes?.length});
  }
 }
 result.end=host();
 fs.writeFileSync(path.join(base,tag+'-curve.json'),JSON.stringify(result,null,2));
 for(const name of ['search100','insights']){
  const points=clients.map(c=>{const a=result.rounds.filter(r=>r.stage===c.stage).map(r=>r.probes[name].p95).sort((a,b)=>a-b);return a[4];});
  const ceiling=points[0]+(points[2]-points[0])*4/9;
  console.log(name,JSON.stringify({points,ceiling,margin:ceiling-points[1],ratio:points[2]/points[0]}));
 }
}finally{for(const c of clients)await c.client.close();}

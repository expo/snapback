// PF's protocol expanded to every calibration read. No builds; no source store writes.
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {pathToFileURL} from 'node:url';
import {performance} from 'node:perf_hooks';
import {createHash} from 'node:crypto';
const base=path.resolve(process.env.SQ_ROOT??'target/sq');
const {createClient,read,idFrom}=await import(pathToFileURL(path.join(base,'replay/scripts/api-client.mjs')));
const {defaultFetch}=await import(pathToFileURL(path.resolve('snapback4/packages/snapback4/dist/node-fetch.js')));
export const host=()=>({at:new Date().toISOString(),loadavg:os.loadavg(),cpus:os.cpus().length,freeBytes:os.freemem(),...Object.fromEntries(['/proc/stat','/proc/pressure/cpu'].filter(p=>fs.existsSync(p)).map(p=>[p,fs.readFileSync(p,'utf8').split('\n').slice(0,2).join('\n')]))});
const tag=process.env.SQ_TAG??process.argv[2]??'before';
const stages=JSON.parse(process.env.SQ_STAGES??'[["10pct",49562],["50pct",49563],["full",49560]]');
const specs=[['busyHistory','u0001','chat.history',{conversation:idFrom('g0001'),c:null}],['following500','u0500','home',{c:null}],['following5','u0005','home',{c:null}],['celebrityFollower','u0901','home',{c:null}],['search100','u0500','chat.searchMessages',{q:'coffee',conversation:null,c:null}],['insights','u0500','insights.summary',{}],['trending','u0500','insights.trending',{c:null}]];
const registrations=new Map();
for(const file of ['starter-m1.log','starter-m2.log','starter-m3.log','scale.log']){
 for(const line of fs.readFileSync('benchmarks/fixtures/social-messenger/'+file,'utf8').split('\n')){
  if(!line.includes(' register '))continue;
  const [,who,,email,password]=line.match(/"(?:\\.|[^"\\])*"|\S+/g).map(x=>x[0]==='"'?JSON.parse(x):x);
  registrations.set(who,{email,password});
 }
}
const clients=[];
const result={tag,host:host(),method:'PF: nine rotating checkpoint rounds, three warmups, ten reads; p50=item4 p95=max=item9',rounds:[]};
try{
 for(const [stage,port]of stages){
  const state=JSON.parse(fs.readFileSync(path.join(base,stage,stage==='full'?'../original-state.private.json':'state.private.json')));
  const c={stage,port,users:{},capture:[],warm:[]};
  for(const who of new Set(specs.map(s=>s[1]))){
   let token=state.users[who].token;
   if(process.env.SQ_LOGIN!=='0'){
    const r=await defaultFetch(`http://127.0.0.1:${port}/auth/login`,{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify(registrations.get(who))}).then(r=>r.json());
    if(!r.session)throw Error('login '+who+' '+JSON.stringify(r));
    token=r.session.token;
   }
   const fetch=async(input,init)=>{const r=await defaultFetch(input,init);if(String(input).includes('/q/'))c.capture.push({timing:r.headers.get('server-timing'),op:String(input).split('/q/')[1]});return r;};
   c.users[who]=createClient({url:`http://127.0.0.1:${port}`,token,fetch});
  }
  clients.push(c);
  for(const [name,who,op,args]of specs)for(let i=0;i<Number(process.env.SQ_WARMUPS??3);i++){
   const t=performance.now();c.capture.length=0;const r=await read(c.users[who],op,args);c.warm.push({name,i,ms:performance.now()-t,serverTiming:[...c.capture]});
  }
  result[stage]={warmups:c.warm};
 }
 for(let round=0;round<Number(process.env.SQ_ROUNDS??9);round++)for(let position=0;position<clients.length;position++){
  const c=clients[(round+position)%clients.length];
  const batch={round,stage:c.stage,host:host(),probes:{}};
  for(const [name,who,op,args]of specs){
   const times=[],timestamps=[],completeness=[];let last;c.capture.length=0;
   for(let i=0;i<10;i++){const start=performance.now();timestamps.push(Date.now());last=await read(c.users[who],op,args);times.push(performance.now()-start);completeness.push(last.complete);}

   const data=structuredClone(last.data);if(name==='insights')delete data.asOf;
   const sorted=[...times].sort((a,b)=>a-b);
   batch.probes[name]={p50:sorted[4],p95:sorted[9],max:sorted[9],times,timestamps,serverTiming:[...c.capture],meter:last.meter,complete:last.complete,completeness,dataHash:createHash('sha256').update(JSON.stringify(data)).digest('hex')};
  }
  result.rounds.push(batch);
 }
 // Deep page uses the same nine rotating rounds and three warmups.
 const deepClients=[];
 for(const c of process.env.SQ_SKIP_DEEP==='1'?[]:clients){
  let cursor=null;for(let i=1;i<50;i++){cursor=(await read(c.users.u0001,'chat.history',{conversation:idFrom('g0001'),c:cursor})).next;if(!cursor)break;}
  if(!cursor){result[c.stage].deepPaging={unavailable:true};continue;}
  c.deepCursor=cursor;deepClients.push(c);result[c.stage].deepPaging={rounds:[]};
  for(let i=0;i<3;i++)await read(c.users.u0001,'chat.history',{conversation:idFrom('g0001'),c:cursor});
 }
 for(let round=0;round<9;round++)for(let position=0;position<deepClients.length;position++){
  const c=deepClients[(round+position)%deepClients.length],samples=[],load=host();
  for(let i=0;i<10;i++){const start=performance.now();await read(c.users.u0001,'chat.history',{conversation:idFrom('g0001'),c:c.deepCursor});samples.push(performance.now()-start);}
  const sorted=[...samples].sort((a,b)=>a-b);
  result[c.stage].deepPaging.rounds.push({round,host:load,p50:sorted[4],p95:sorted[9],samples});
 }
 for(const c of deepClients){const d=result[c.stage].deepPaging;d.p95=d.rounds.map(r=>r.p95).sort((a,b)=>a-b)[4];d.max=Math.max(...d.rounds.flatMap(r=>r.samples));}
 result.end=host();
 fs.writeFileSync(path.join(base,tag+'-curve.json'),JSON.stringify(result,null,2));
 console.log(tag,'completed',result.rounds.length,'batches');
}finally{for(const c of clients)for(const client of Object.values(c.users))await client.close();}

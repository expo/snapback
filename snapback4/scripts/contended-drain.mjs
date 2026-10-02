#!/usr/bin/env node
// Real calibration backlog, unchanged published client and eight builder probes.
// Restore the same stopped 50%-checkpoint store for EVERY design/load/repetition.
import assert from 'node:assert/strict';
import {spawn} from 'node:child_process';
import {once} from 'node:events';
import {Worker} from 'node:worker_threads';
import {openSync,closeSync,readFileSync} from 'node:fs';
import {mkdir,readFile,writeFile,cp,access} from 'node:fs/promises';
import {availableParallelism,hostname,cpus} from 'node:os';
import {resolve,join} from 'node:path';
import {pathToFileURL} from 'node:url';
import {createHash} from 'node:crypto';
import {hostSample,maintenanceSnapshot,waitForMaintenance} from './contended-observation.mjs';
const argv=process.argv.slice(2),option=(name,fallback)=>{const i=argv.indexOf(name);return i<0?fallback:argv[i+1]};
const pristine=resolve(option('--pristine','target/ct-round3/pristine'));
const work=resolve(option('--work','target/ct-round3/drain-work'));
const out=resolve(option('--out','/tmp/ct-drain'));
const binary=resolve(option('--binary','target/production/snapback4'));
const busy=Number(option('--busy','0')),port=Number(option('--port','49378')),url='http://127.0.0.1:'+port;
assert(Number.isInteger(busy)&&busy>=0);
const sleep=ms=>new Promise(r=>setTimeout(r,ms));
const sha=bytes=>createHash('sha256').update(bytes).digest('hex');
const normalized=value=>Array.isArray(value)?value.map(normalized):value&&typeof value==='object'?Object.fromEntries(Object.entries(value).filter(([k])=>k!=='asOf').map(([k,v])=>[k,normalized(v)])):value;
const digest=r=>sha(JSON.stringify(normalized({data:r.data,complete:r.complete,next:r.next})));
const distribution=values=>{const sorted=values.toSorted((a,b)=>a-b);assert(sorted.length>0,'no samples during backlog');return {n:sorted.length,p50:sorted[Math.ceil(sorted.length*.5)-1],p95:sorted[Math.ceil(sorted.length*.95)-1]}};
await mkdir(out,{recursive:true});
assert(!(await access(join(out,'metadata.json')).then(()=>true,()=>false)),'fresh --out required');
assert(!(await access(work).then(()=>true,()=>false)),'fresh --work required');
await cp(join(pristine,'replay-instance'),work,{recursive:true});
const store=join(work,'.snapback4/store.sqlite');
const initial=maintenanceSnapshot(store);assert(initial.pending>1000,'need the actual un-drained 50%-scale backlog');
const actors=JSON.parse(await readFile(join(pristine,'evidence/actors.json'),'utf8'));
const sdk=await import(pathToFileURL(join(pristine,'node_modules/snapback4/dist/client.js')));
const auth=await import(pathToFileURL(join(pristine,'node_modules/snapback4/dist/auth.js')));
const api=(await import(pathToFileURL(join(pristine,'snapback/generated/api.ts')))).api;
const endpoints=[['following500','u0500','home',{}],['following5','u0005','home',{}],['celebrityFollowing','u0901','home',{}],['globalSearch','u0500','searchMessages',{q:'coffee'}],['insights','u0500','insights',{}],['trending','u0500','trending',{}],['busyPage1','u0005','history',{conversation:sdk.idFrom('g0001')}]];
// A stopped SQLite project may retain committed WAL frames. Bind both data
// files; the shared-memory file is a rebuildable lock/index, not durable data.
const pristineStoreFiles={};
for(const name of ['store.sqlite','store.sqlite-wal']){
  try{const bytes=readFileSync(join(pristine,'replay-instance/.snapback4',name));pristineStoreFiles[name]={bytes:bytes.length,sha256:sha(bytes)}}
  catch(error){if(error.code!=='ENOENT')throw error}
}
const metadata={started:new Date().toISOString(),host:hostname(),node:process.version,cpu:cpus()[0].model,cores:availableParallelism(),busy,binary,binarySha256:sha(readFileSync(binary)),client:JSON.parse(readFileSync(join(pristine,'node_modules/snapback4/package.json'))).version,actions:actors.count,initial,pristineStoreSha256:pristineStoreFiles['store.sqlite'].sha256,pristineStoreFiles};
await writeFile(join(out,'metadata.json'),JSON.stringify(metadata,null,2),{flag:'wx'});
const owned=new Set(),track=p=>{owned.add(p);p.once('exit',()=>owned.delete(p));return p};
async function stop(p){if(p.exitCode!==null||p.signalCode!==null)return;const done=once(p,'exit');p.kill('SIGTERM');const timer=setTimeout(()=>p.kill('SIGKILL'),10000);try{await done}finally{clearTimeout(timer)}}
for(const [signal,code] of [['SIGINT',130],['SIGTERM',143]])process.once(signal,()=>{void Promise.all([...owned].map(stop)).finally(()=>process.exit(code))});
const children=[],clients=new Map(),samples=[],observations=[];
let server,observer,observerWorker,observerError;
try {
  // Establish full contention BEFORE the server can start draining.
  for(let i=0;i<busy;i++){
    const p=track(spawn(process.execPath,['-e','process.stdout.write("ready\\n"); let x=1; for(;;) {for(let i=0;i<1000000;i++) x=Math.imul(x,1664525)+1013904223|0;}'],{stdio:['ignore','pipe','inherit']}));children.push(p);
    await Promise.race([once(p.stdout,'data'),once(p,'error').then(([e])=>{throw e}),once(p,'exit').then(()=>{throw Error('busy child exited')})]);
  }
  await sleep(2000);
  const logPath=join(out,'server.log'),fd=openSync(logPath,'w');
  metadata.spawnAt=Date.now();
  const env={...process.env};delete env.SNAPBACK4_READ_TRACE;
  server=track(spawn(binary,['dev','--port',String(port),'--replay','--no-watch'],{cwd:work,env,stdio:['ignore',fd,fd]}));closeSync(fd);
  // No pre-measurement settlement. Observe throughout login/cursor warmup too.
  observerWorker=new Worker(`
    const {parentPort,workerData}=require('node:worker_threads');
    (async()=>{
      const {maintenanceSnapshot}=await import(workerData.module);
      for(;;){
        const sample=maintenanceSnapshot(workerData.store);parentPort.postMessage(sample);
        if(sample.pending===0)break;
        if(Date.now()-workerData.started>=30*60*1000)throw Error('drain exceeded 30 minutes');
        await new Promise(r=>setTimeout(r,100));
      }
    })().catch(error=>{throw error});
  `,{eval:true,workerData:{module:new URL('./contended-observation.mjs',import.meta.url).href,store,started:metadata.spawnAt}});
  observer=new Promise(resolve=>{
    observerWorker.on('message',sample=>{
      observations.push(sample);
      if(sample.tables.some(t=>t.states.some(v=>v.state==='parked'&&v.n>0)))observerError=Error('parked backlog');
    });
    observerWorker.once('error',error=>{observerError=error;resolve()});
    observerWorker.once('exit',code=>{if(code!==0&&!observerError)observerError=Error('observer exited '+code);resolve()});
  });
  for(let i=0;;i++){
    assert(server.exitCode===null&&server.signalCode===null,'server exited before readiness');
    if((await readFile(logPath,'utf8')).split('\n').includes(url)&&(await fetch(url+'/auth/config')).ok)break;
    assert(i<600,'server readiness timeout');await sleep(50);
  }
  metadata.readyAt=Date.now();metadata.hostStart=hostSample([process.pid,server.pid,...children.map(p=>p.pid)]);
  for(const [,actor] of endpoints)if(!clients.has(actor)){
    const result=await auth.login(url,...actors.credentials[actor]);assert(result.ok,JSON.stringify(result));
    clients.set(actor,sdk.createClient({url,token:result.session.token}));
  }
  let cursor=null;
  for(let i=1;i<50;i++){
    const r=await clients.get('u0005').query(api.history,{conversation:sdk.idFrom('g0001'),c:cursor});assert('data'in r);cursor=r.next??null;assert(cursor,'missing page 50');
  }
  endpoints.push(['busyPage50','u0005','history',{conversation:sdk.idFrom('g0001'),c:cursor}]);
  metadata.probeStartedAt=Date.now();
  let round=0;
  while(!observerError && !observations.some(s=>s.pending===0)){
    // Same 23 sequential calls and rank-19/20 cohort convention as the builder.
    for(const [endpoint,actor,op,args] of endpoints)for(let index=0;index<23;index++){
      const startedAt=Date.now(),start=performance.now();
      const r=await clients.get(actor).query(api[op],args);
      const ms=performance.now()-start,endedAt=Date.now();assert('data'in r,JSON.stringify(r));
      samples.push({endpoint,round,index,startedAt,endedAt,ms,answer:digest(r),complete:r.complete});
    }
    round++;
  }
  if(observerError)throw observerError;
  await observer;
  const firstEmpty=observations.find(s=>s.pending===0),lastPending=observations.findLast(s=>s.pending>0);
  assert(firstEmpty&&lastPending,'missing drain boundary');
  assert(children.every(p=>p.exitCode===null&&p.signalCode===null),'busy child died');
  metadata.hostEnd=hostSample([process.pid,server.pid,...children.map(p=>p.pid)]);
  const finalWait=await waitForMaintenance(store,join(out,'final-settlement.json'),server);
  const finalAnswers={};for(const [endpoint,actor,op,args] of endpoints){const r=await clients.get(actor).query(api[op],args);assert('data'in r);finalAnswers[endpoint]=digest(r)}
  // Conservative window: each included response precedes a later positive
  // observation. The final polling-uncertainty interval is retained, excluded.
  const during=samples.filter(s=>s.endedAt<lastPending.at);
  const reads=endpoints.map(([endpoint])=>{
    const selected=during.filter(s=>s.endpoint===endpoint&&s.index>=3);
    const cohorts=[...new Set(selected.map(s=>s.round))].map(round=>{const rows=selected.filter(s=>s.round===round);return {round,...distribution(rows.map(s=>s.ms))}});
    return {endpoint,...distribution(selected.map(s=>s.ms)),cohorts,answerVersions:new Set(during.filter(s=>s.endpoint===endpoint).map(s=>s.answer)).size};
  });
  const summary={busy,initialPending:initial.pending,initialTables:initial.tables,firstEmptyAt:firstEmpty.at,lastPendingAt:lastPending.at,drainFromSpawnMs:firstEmpty.at-metadata.spawnAt,drainFromReadyMs:firstEmpty.at-metadata.readyAt,probeWindowMs:lastPending.at-metadata.probeStartedAt,pollUncertaintyMs:firstEmpty.at-lastPending.at,reads,allSampleCount:samples.length,duringDrainCount:during.length,finalAnswers,finalWait};
  await writeFile(join(out,'summary.json'),JSON.stringify(summary,null,2));
  console.log(JSON.stringify({busy,initialPending:summary.initialPending,drainFromSpawnMs:summary.drainFromSpawnMs,reads:summary.reads.map(({endpoint,n,p50,p95})=>({endpoint,n,p50,p95}))}));
}finally{
  if(observerWorker)await observerWorker.terminate();if(observer)await observer;
  for(const c of clients.values())c.close();
  await Promise.all([...owned].map(stop));
  await writeFile(join(out,'metadata.json'),JSON.stringify({...metadata,finished:new Date().toISOString()},null,2));
  await writeFile(join(out,'samples.json'),JSON.stringify(samples));
  await writeFile(join(out,'backlog.json'),JSON.stringify(observations));
}

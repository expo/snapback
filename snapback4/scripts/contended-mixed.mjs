// Real-clock mixed qualification, invoked by contended-reads.mjs --mixed.
// No replay: schedules, supervised effects, expiry and maintenance stay live.
// @ref LLP 3000#contended-read-serving — background deadlines qualify beside reads.
import assert from 'node:assert/strict';
import { spawn, execFileSync } from 'node:child_process';
import { once } from 'node:events';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { openSync, closeSync, readFileSync } from 'node:fs';
import { DatabaseSync } from 'node:sqlite';
import { availableParallelism, cpus, hostname, loadavg, platform } from 'node:os';
import { resolve, join } from 'node:path';
import { createHash } from 'node:crypto';
import { hostSample } from './contended-observation.mjs';
const sleep = ms => new Promise(r=>setTimeout(r,ms));
const schema = `use personas alice

effect deliver retry 3 backoff 1s deadline 30s
effect slow retry 1 deadline 1s
effect leaseProbe retry 2 backoff 1s deadline 30s
effect abandoned retry 3 backoff 1s deadline 30s

table items:
  n: int
  until: time
  expire at .until
  read <- allow
  insert <- allow
  online only

table ticks:
  boundary: time
  at: time
  read <- allow
  online only

mutation add(n: int):
  row = insert items { n, until: now + 2000 }
  emit deliver { n }
  return { id: row.id, until: row.until }
mutation probes():
  emit leaseProbe {}
  return true
mutation deadline():
  emit slow {}
  return true
mutation abandon():
  emit abandoned {}
  return true
query read():
  return items first 100 by byId
table clockSeed:
  n: int
  read <- allow
  insert <- allow
  online only
mutation init():
  insert clockSeed { n: 1 }
  return true
job pulse(periodStart: time, periodEnd: time):
  for seed in clockSeed:
    insert ticks { boundary: periodEnd, at: now }
schedule eachMinute every 1m: pulse
`;
const worker = `
const url=process.env.SNAPBACK_URL, token=process.env.SNAPBACK_SERVICE_TOKEN;
const sleep=ms=>new Promise(r=>setTimeout(r,ms));
const record=(kind,data)=>console.log('CT_EVENT '+JSON.stringify({kind,at:Date.now(),...data}));
async function post(path,body,lease){
 const started=Date.now();
 const r=await fetch(url+path,{method:'POST',headers:{Authorization:'Bearer '+token,'Content-Type':'application/json',...(lease?{'x-snapback-effect-lease':lease}:{})},body:JSON.stringify(body)});
 const result=await r.json();record('http',{path,started});return result;
}
let pausedUntil=0;
async function loop(effect){for(;;){
 while(Date.now()<pausedUntil)await sleep(50);
 const reply=await post('/effects/claim',{effect,limit:4,wait:1,lease:effect==='abandoned'?2:10,fenced:true});
 if(reply.denied) {record('refusal',{code:reply.denied.code});await sleep(100);continue;}
 for(const e of reply.effects){
  record('claim',{id:e.id,effect,attempt:e.attempt,leaseUntil:e.leaseUntil,deadline:e.deadline,emitted:e.at});
  if(effect==='abandoned' && e.attempt===1){pausedUntil=Date.now()+8000;record('pause',{until:pausedUntil});continue;}
  while(Date.now()<pausedUntil)await sleep(50);
  await sleep(effect==='slow'?1300:effect==='leaseProbe'?3000:40);
  const retry=effect==='deliver' && e.payload.n%5===0 && e.attempt===1;
  const result=await post('/effects/'+encodeURIComponent(e.id)+(retry?'/failed':'/done'),retry?{error:'qualification retry',retry:true}:{result:{ok:true}},e.leaseToken);
  record('settle',{id:e.id,effect,attempt:e.attempt,retry,code:result.denied?.code??null});
 }
}}
await Promise.all(['deliver','slow','leaseProbe','abandoned'].map(loop));
`;
export function assertLeaseObservations({raw,effects,events,abandoned,deliberatelyAbandoned}) {
   assert.equal(raw.filter(r=>r.kind==='leaseChange').length,0,'unexpected fixed-lease change');
   const abandonedEffects=effects.filter(e=>e.effect==='abandoned');
   const abandonedClaims=events.filter(e=>e.kind==='claim'&&e.effect==='abandoned'&&e.attempt===1);
   assert(deliberatelyAbandoned>0,'no deliberate abandonment');
   assert.equal(abandonedEffects.length,deliberatelyAbandoned,'missing abandoned effect');
   assert.equal(abandonedClaims.length,deliberatelyAbandoned,'missing first-attempt abandoned claim');
   assert.equal(abandoned.size,deliberatelyAbandoned,'poller missed an abandoned claim');
   for(const claim of abandonedClaims){
    const observed=abandoned.get(claim.id);
    assert(observed,'poller missed abandoned claim '+claim.id);
    assert.equal(observed.expires,claim.leaseUntil,'observer and worker disagree about abandoned lease');
   }
}

export async function runMixed(argv) {
 const option=(name,fallback)=>{const i=argv.indexOf(name);return i<0?fallback:argv[i+1]};
 const binary=resolve(option('--binary','target/production/snapback4'));
 const out=resolve(option('--out','/tmp/ct-mixed'));
 const port=Number(option('--port','49377')), url='http://127.0.0.1:'+port;
 const seconds=Number(option('--seconds','125')), cores=availableParallelism();
 const deadlineOnly=argv.includes('--deadline-only');
 const levels=option('--levels','0,0.5,1,1.5').split(',').map(Number);
 assert(seconds>=65 && levels.every(v=>[0,.5,1,1.5].includes(v)),'mixed cells need at least 65 seconds and valid levels');
 await mkdir(out,{recursive:true});
 const metadata={host:hostname(),platform:platform(),node:process.version,cpu:cpus()[0].model,cores,binary,binarySha256:createHash('sha256').update(readFileSync(binary)).digest('hex'),seconds,levels,deadlineOnly,started:new Date().toISOString()};
 await writeFile(join(out,'metadata.json'),JSON.stringify(metadata,null,2),{flag:'wx'});
 const owned=new Set();
 const track=p=>{owned.add(p);p.once('exit',()=>owned.delete(p));return p};
 async function stop(p){if(p.exitCode!==null||p.signalCode!==null)return;const done=once(p,'exit');p.kill('SIGTERM');const timer=setTimeout(()=>p.kill('SIGKILL'),10000);try{await done}finally{clearTimeout(timer)}}
 for(const [signal,code] of [['SIGINT',130],['SIGTERM',143]])process.once(signal,()=>{void Promise.all([...owned].map(stop)).finally(()=>process.exit(code))});
 const results=[];
 async function post(path,body){const r=await fetch(url+path,{method:'POST',headers:{'Content-Type':'application/json','x-snapback-persona':'alice'},body:JSON.stringify(body)});const j=await r.json();assert(!j.denied,JSON.stringify(j));return j}
 try {for(const level of levels){
  const dir=join(out,'level-'+level), project=join(dir,'project');
  await mkdir(join(project,'snapback/workers'),{recursive:true});
  await writeFile(join(project,'snapback/schema.q'),schema);
  await writeFile(join(project,'snapback/workers/worker.mjs'),worker);
  const logPath=join(dir,'server.log'),fd=openSync(logPath,'w');
  const server=track(spawn(binary,['dev','--no-watch','--port',String(port)],{cwd:project,stdio:['ignore',fd,fd]}));closeSync(fd);
  let db;const children=[],raw=[],rows=new Map(),leases=new Map(),abandoned=new Map();let deliberatelyAbandoned=0;
  try {
   for(let i=0;;i++){
    assert(server.exitCode===null&&server.signalCode===null,'server exited: '+await readFile(logPath,'utf8'));
    if((await readFile(logPath,'utf8')).split('\n').includes(url))break;
    assert(i<600,'server readiness timeout');await sleep(100);
   }
   await post('/m/init',{args:{},id:'init'});
   db=new DatabaseSync(join(project,'.snapback4/store.sqlite'),{readOnly:true});
   db.exec('PRAGMA busy_timeout=1000');
   for(let i=0;i<Math.round(cores*level);i++){
    const p=track(spawn(process.execPath,['-e','process.stdout.write("ready\\n"); let x=1; for(;;) {for(let i=0;i<1000000;i++) x=Math.imul(x,1664525)+1013904223|0;}'],{stdio:['ignore','pipe','inherit']}));children.push(p);
    await Promise.race([once(p.stdout,'data'),once(p,'error').then(([e])=>{throw e}),once(p,'exit').then(()=>{throw Error('busy child exited')})]);
   }
   await sleep(2000);
   // A short independent control: real clock only, while reads are active.
   // This also makes the deadline outcome reproducible without minute jobs.
   if(deadlineOnly){
    let reading=true,reads=0,readError;
    const reader=(async()=>{while(reading){try{await post('/q/read',{args:{}});reads++}catch(e){readError=e;break}}})();
    let row,observed;
    try{
     await post('/m/deadline',{args:{},id:'deadline'});
     const end=Date.now()+15000;
     do{
      row=db.prepare("SELECT id,state,at,deadline,settled_at,error_code FROM _outbox WHERE effect='slow'").get();
      observed=Date.now();
      if(row?.state==='failed')break;
      assert(observed<end,'real-clock deadline probe did not finish');await sleep(25);
     }while(true);
    }finally{reading=false;await reader}
    if(readError)throw readError;
    assert.equal(row.error_code,'E_EFFECT_DEADLINE');
    assert.equal(row.deadline-row.at,1000);
    assert(observed>=row.deadline && reads>0);
    assert(children.every(p=>p.exitCode===null&&p.signalCode===null),'busy child died');
    const events=(await readFile(logPath,'utf8')).split('\n').filter(l=>l.includes('CT_EVENT ')).map(l=>JSON.parse(l.slice(l.indexOf('CT_EVENT ')+9)));
    const claim=events.find(e=>e.kind==='claim'&&e.effect==='slow');
    assert(claim,'supervised worker did not claim the deadline probe');
    const cell={level,busy:children.length,reads,...row,claimAt:claim.at,observed,delay:observed-row.deadline,clockAdvanced:false};
    await writeFile(join(dir,'deadline.json'),JSON.stringify(cell,null,2));
    results.push(cell);console.log(JSON.stringify(cell));continue;
   }
   // Explicit extension contract: only dev clock advances extend live leases.
   // Run this probe before the real-clock observation window, under this load.
   await post('/m/probes',{args:{},id:'probes-'+level});
   let leaseBefore;
   for(let i=0;i<100;i++){leaseBefore=db.prepare("SELECT id,lease_until FROM _outbox WHERE effect='leaseProbe' AND state='running'").get();if(leaseBefore)break;await sleep(10)}
   assert(leaseBefore,'supervised lease probe did not claim');
   const advance=await post('/dev/clock/advance',{duration:'1s'});
   const leaseAfter=db.prepare('SELECT lease_until FROM _outbox WHERE id=?').get(leaseBefore.id);
   assert.equal(leaseAfter.lease_until-leaseBefore.lease_until,1000,'clock advance must extend the held lease exactly');
   await sleep(3500);
   const hostStart=hostSample([process.pid,server.pid,...children.map(p=>p.pid)]);
   const offset=1000,started=Date.now(),until=started+seconds*1000;
   const startLoad=loadavg();let nextAdd=started,nextAbandon=started,serial=0,reading=true,readError;
   const reader=(async()=>{while(reading){const t=performance.now();try{const r=await post('/q/read',{args:{}});assert('data'in r);raw.push({kind:'read',at:Date.now(),ms:performance.now()-t});}catch(e){readError=e;break}}})();
   let backlogMax=0;
   try {
    // Emit only after the lease-extension probe; the real clock must expire it.
    await post('/m/deadline',{args:{},id:'deadline-'+level});
    while(Date.now()<until){
    if(Date.now()>=nextAdd){
     const r=await post('/m/add',{args:{n:serial},id:'add-'+serial++});
     assert(r.result?.id,JSON.stringify(r));rows.set(r.result.id,{id:r.result.id,expires:r.result.until});
     nextAdd+=250;
    }
    if(Date.now()>=nextAbandon && Date.now()<until-15000){await post('/m/abandon',{args:{},id:'abandon-'+nextAbandon});deliberatelyAbandoned++;nextAbandon+=20000;}
    const at=Date.now()+offset;
    const live=new Set(db.prepare('SELECT id FROM r').all().map(r=>r.id));
    for(const row of rows.values())if(row.reclaimed===undefined&&!live.has(row.id)){row.reclaimed=at;row.delay=at-row.expires}
    const backlog=db.prepare("SELECT count(*) n FROM _outbox WHERE state IN ('queued','running')").get().n;backlogMax=Math.max(backlogMax,backlog);
    raw.push({kind:'backlog',at,n:backlog});
    for(const row of db.prepare("SELECT id,state,effect,attempts,lease_until FROM _outbox").all()){
     const key=row.id+':'+row.attempts;
     if(row.state==='running'){
      if(leases.has(key)&&leases.get(key)!==row.lease_until)raw.push({kind:'leaseChange',at,id:row.id,before:leases.get(key),after:row.lease_until});
      leases.set(key,row.lease_until);
     }
     if(row.effect==='abandoned'){
      if(row.state==='running'&&row.attempts===1&&!abandoned.has(row.id))abandoned.set(row.id,{id:row.id,expires:row.lease_until});
      const a=abandoned.get(row.id);
      if(a&&a.requeued===undefined&&(row.state!=='running'||row.attempts>1)){a.requeued=at;a.delay=at-a.expires;}
     }
    }
    await sleep(50);
   }}finally{reading=false;await reader}if(readError)throw readError;
   // Keep contention alive while the final emitted work and expiry drain.
   await sleep(4000);
   const end=Date.now()+offset,live=new Set(db.prepare('SELECT id FROM r').all().map(r=>r.id));
   for(const row of rows.values())if(row.reclaimed===undefined&&!live.has(row.id)){row.reclaimed=end;row.delay=end-row.expires;row.finalDrain=true}
   const jobs=db.prepare('SELECT name,args,state,created_at,updated_at,error FROM _jobs').all().map(r=>({...r,args:JSON.parse(r.args)}));
   const effects=db.prepare('SELECT id,effect,state,attempts,at,settled_at,deadline,error_code,lease_until FROM _outbox').all();
   const events=(await readFile(logPath,'utf8')).split('\n').filter(l=>l.includes('CT_EVENT ')).map(l=>JSON.parse(l.slice(l.indexOf('CT_EVENT ')+9)));
   const cell={level,busy:children.length,started,finished:Date.now(),offset,startLoad,endLoad:loadavg(),hostStart,hostEnd:hostSample([process.pid,server.pid,...children.map(p=>p.pid)]),backlogMax,extension:{before:leaseBefore.lease_until,after:leaseAfter.lease_until,advancedMs:advance.advancedMs},jobs,effects,leaseRecovery:[...abandoned.values()],expiry:[...rows.values()],events,raw};
   await writeFile(join(dir,'samples.json'),JSON.stringify(cell));
   assert(children.every(p=>p.exitCode===null&&p.signalCode===null),'busy child died');
   assertLeaseObservations({raw,effects,events,abandoned,deliberatelyAbandoned});
   const slow=effects.filter(e=>e.effect==='slow');
   assert.equal(slow.length,1,'missing deadline probe');
   const slowClaim=events.find(e=>e.kind==='claim'&&e.effect==='slow');
   assert(slowClaim && slowClaim.at+offset<slow[0].deadline,'deadline probe was not claimed before its real deadline');
   assert(slow[0].at>=started+offset,'deadline probe preceded the real-clock window');
   const expected=[];for(let b=Math.ceil((started+offset)/60000)*60000;b<=until+offset;b+=60000)expected.push(b);
   const jobSummary=jobs.map(j=>({boundary:j.args.Map.periodEnd.Int,delay:j.created_at-j.args.Map.periodEnd.Int,runtime:j.updated_at-j.created_at,state:j.state}));
   assert(expected.length>0);for(const boundary of expected)assert.equal(jobSummary.filter(j=>j.boundary===boundary).length,1,'lost or duplicate schedule boundary '+boundary);
   assert(jobSummary.every(j=>j.state==='done'),'parked schedule');
   assert(effects.filter(e=>e.effect==='deliver'||e.effect==='leaseProbe'||e.effect==='abandoned').every(e=>e.state==='sent'),'delivery deadline/lease failure');
   assert(effects.filter(e=>e.effect==='slow').every(e=>e.state==='failed'&&e.error_code==='E_EFFECT_DEADLINE'),'deadline probe did not fail as documented');
   for(const a of abandoned.values())a.maintenanceOnly=!events.some(e=>e.kind==='http'&&e.started+offset<a.requeued&&e.at+offset>a.expires);
   assert([...abandoned.values()].every(a=>a.maintenanceOnly),'worker HTTP masked the maintenance-only lease observation');
   assert([...abandoned.values()].every(r=>r.requeued!==undefined&&r.delay>=0),'abandoned lease not requeued');
   assert([...rows.values()].every(r=>r.reclaimed!==undefined&&r.delay>=0),'expiry not physically reclaimed');
   const readMs=raw.filter(r=>r.kind==='read').map(r=>r.ms).sort((a,b)=>a-b);
   const readLatency={p50:readMs[Math.ceil(readMs.length*.5)-1],p95:readMs[Math.ceil(readMs.length*.95)-1]};
   const maintenanceCommits=db.prepare("SELECT kind,program,count(*) n FROM _commits WHERE at BETWEEN ? AND ? AND kind != 'mutation' GROUP BY kind,program").all(started+offset,until+offset);
   const summary={level,busy:children.length,reads:readMs.length,readLatency,maintenanceCommits,deliberatelyAbandoned,observedAbandoned:abandoned.size,backlogMax,jobs:jobSummary,expectedBoundaries:expected,effects:effects.length,retries:effects.reduce((n,e)=>n+Math.max(0,e.attempts-1),0),deadlineOutcomes:effects.filter(e=>e.error_code).map(e=>e.error_code),leaseRecovery:[...abandoned.values()],unexpectedLeaseChanges:raw.filter(r=>r.kind==='leaseChange').length,extensionMs:1000,expiryMaxMs:Math.max(...[...rows.values()].filter(r=>!r.finalDrain).map(r=>r.delay))};
   results.push(summary);console.log(JSON.stringify(summary));
  }finally{db?.close();await stop(server);await Promise.all(children.map(stop))}
 }}finally{await Promise.all([...owned].map(stop));await writeFile(join(out,'summary.json'),JSON.stringify(results,null,2))}
}

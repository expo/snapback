// @ref LLP 3000.030#15 — deterministic coverage of both maintenance exit/wakeup windows.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawn, spawnSync } from 'node:child_process';
import { once } from 'node:events';
import { maintenanceEvidence, observedMaintenance } from './helpers/maintenance-evidence.mjs';

const binary=process.env.SNAPBACK4_EXPORT_TEST_BINARY || new URL('../../../target/debug/snapback4',import.meta.url).pathname;
const read=p=>{try{return JSON.parse(fs.readFileSync(p));}catch{return null;}};
const alive=pid=>{try{if(!pid)return false;process.kill(pid,0);return true;}catch{return false;}};
async function until(check,label,timeout=10000) {
  const start=performance.now();
  while(!check()) {assert.ok(performance.now()-start<timeout,label);await new Promise(r=>setTimeout(r,20));}
}
function fixture() {
  const root=fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(),'sb4-em-wakeup-')));
  const native=path.join(root,'artifacts/native-smoke');fs.mkdirSync(native,{recursive:true});
  const children=[];
  const f={root,native,children,env:{...process.env,SNAPBACK4_DEBUG_RETENTION:'1'}};
  f.file=n=>path.join(native,n);
  f.mark=(n,value='')=>fs.writeFileSync(f.file(n),value);
  f.start=(program,args,points='')=>{
    const child=spawn(program,args,{cwd:root,env:{...f.env,SNAPBACK4_TEST_RETENTION_POINT:points},stdio:['pipe','pipe','pipe']});
    const item={child,exit:once(child,'exit'),stderr:''};child.stderr.on('data',b=>item.stderr+=b);
    child.stdin.on('error',()=>{});children.push(item);return item;
  };
  f.producer=points=>f.start(binary,['witness','export-maintenance',native],points);
  f.barrier=async point=>{
    const file=f.file(`maintenance-test-${point}.json`);
    await until(()=>read(file)?.point===point,`paused at ${point}`);
    return read(file);
  };
  f.resume=point=>f.mark(`maintenance-test-${point}-resume`);
  // Use exactly export-background's queue predicate and 90-second drain guard.
  f.drain=()=>observedMaintenance(f,false,()=>until(()=>
    ['maintenance-request.json','maintenance-claimed.json','maintenance-parked.json'].every(n=>!fs.existsSync(f.file(n))) &&
    ['maintenance-next.json','maintenance-active.json'].every(n=>!alive(read(f.file(n))?.process?.pid)),
    'coalesced maintenance queue drained',90000));
  f.free=()=>spawnSync('python3',['-c','import fcntl,sys; f=open(sys.argv[1],"a"); fcntl.flock(f,fcntl.LOCK_EX|fcntl.LOCK_NB)',f.file('maintenance-next.lock')],{stdio:'ignore',timeout:2000}).status===0;
  f.finish=async()=>{
    for(const name of fs.readdirSync(native))if(name.startsWith('maintenance-test-')&&name.endsWith('.json'))f.mark(name.replace(/\.json$/,'-resume'));
    for(const item of children) {
      item.child.stdin.end();
      if(item.child.exitCode===null && item.child.signalCode===null)item.child.kill('SIGTERM');
      await item.exit;
    }
    // A negative control still recovers through the real next-export backstop.
    if(['maintenance-request.json','maintenance-claimed.json','maintenance-parked.json'].some(n=>fs.existsSync(f.file(n)))) {
      const next=f.producer('');assert.equal((await next.exit)[0],0,next.stderr);
    }
    await f.drain();
    if(process.env.SNAPBACK4_MAINTENANCE_EVIDENCE)await maintenanceEvidence(f,'cleanup');
    fs.rmSync(root,{recursive:true,force:true});
  };
  f.mark('maintenance-request.json','{"state":"pending"}');
  return f;
}
async function coalesce(f) {
  const producer=f.producer('kick-coalesced,unused');
  await f.barrier('kick-coalesced');
  assert.ok(fs.existsSync(f.file('maintenance-request.json')));
  assert.equal(f.free(),false,'the producer coalesces while the exiting holder still owns the lease');
  f.resume('kick-coalesced');assert.equal((await producer.exit)[0],0,producer.stderr);
}

test('maintenance wakeup: empty second check cannot strand a coalesced request',{timeout:120000},async()=>{
  const f=fixture();
  try {
    f.mark('maintenance-parked.json','{}'); // makes a later backstop produce even after the first request is covered
    const holder=f.producer('kick-locked,kick-empty');
    await f.barrier('kick-locked');
    fs.unlinkSync(f.file('maintenance-request.json')); // an earlier scan covered it after the first runnable check
    f.resume('kick-locked');await f.barrier('kick-empty');
    await coalesce(f);
    f.resume('kick-empty');assert.equal((await holder.exit)[0],0,holder.stderr);
    await f.drain();
    assert.ok(read(f.file('maintenance-done.json')),'a successor actually acknowledged the request');
  } finally {await f.finish();}
});

async function pausedGuard(f,stop='expiry',points='observer-guard-failed,unused') {
  const lease=f.start('python3',['-c','import sys,fcntl; f=open(sys.argv[1],"a"); fcntl.flock(f,fcntl.LOCK_EX); print("ready",flush=True); sys.stdin.read()',f.file('retention.lock')]);
  await once(lease.child.stdout,'data');
  const expires=Date.now()+(stop==='expiry'?700:60000);
  const observer=f.start('python3',['-c',"import os,fcntl,sys; f=open(sys.argv[1]+'/maintenance-next.lock','a'); fcntl.flock(f,fcntl.LOCK_EX); os.dup2(f.fileno(),3); os.set_inheritable(3,True); os.execve(sys.argv[2],[sys.argv[2],'witness','export-maintain',sys.argv[1],sys.argv[3]],os.environ)",f.native,binary,String(expires)],points);
  observer.child.stdin.end('s');
  if(stop==='cancellation' || stop==='sleep') {
    await until(()=>{try{return fs.readFileSync(f.file('retention-trace.jsonl'),'utf8').includes('wait-retention');}catch{return false;}},'observer waiting on our retention lease');
    if(stop==='sleep')f.setClock(2000);else observer.child.kill('SIGTERM');
  }
  const record=await f.barrier('observer-guard-failed');
  f.mark('maintenance-next.json',JSON.stringify({process:record.process,expiresAt:expires}));
  return {observer,lease,expires};
}
for(const stop of ['expiry','cancellation'])test(`maintenance wakeup: ${stop} guard cannot strand a coalesced request`,{timeout:120000},async()=>{
  const f=fixture();
  try {
    const {observer,lease,expires}=await pausedGuard(f,stop);
    await coalesce(f);
    const wake=read(f.file('maintenance-wakeup.json'));assert.ok(wake.expiresAt>expires);
    lease.child.stdin.end();await lease.exit;
    f.resume('observer-guard-failed');assert.equal((await observer.exit)[0],1,observer.stderr);
    assert.match(observer.stderr,stop==='expiry'?/60-minute deadline/:/interrupted/);
    await f.drain();
    assert.equal(read(f.file('maintenance-next.json')).expiresAt,wake.expiresAt,'successor inherits the fresh producer deadline without renewing it');
    assert.ok(read(f.file('maintenance-done.json')));
    assert.ok(!fs.existsSync(f.file('maintenance-wakeup.json')),'a successful guard consumes the wakeup');
  } finally {await f.finish();}
});

test('maintenance wakeup: producer retries when the holder exits before notification',{timeout:120000},async()=>{
  const f=fixture();
  try {
    const {observer,lease}=await pausedGuard(f);
    const producer=f.producer('kick-notifying,unused');await f.barrier('kick-notifying');
    f.resume('observer-guard-failed');assert.equal((await observer.exit)[0],1,observer.stderr);
    assert.equal(f.free(),true);assert.ok(!fs.existsSync(f.file('maintenance-wakeup.json')));
    lease.child.stdin.end();await lease.exit;
    f.resume('kick-notifying');assert.equal((await producer.exit)[0],0,producer.stderr);
    await f.drain();assert.ok(read(f.file('maintenance-done.json')));
  } finally {await f.finish();}
});

for(const stop of ['expiry','cancellation'])test(`maintenance wakeup: ${stop} remains a stop without a fresh producer`,{timeout:120000},async()=>{
  const f=fixture();
  try {
    const {observer,lease}=await pausedGuard(f,stop);
    f.resume('observer-guard-failed');assert.equal((await observer.exit)[0],1,observer.stderr);
    assert.equal(f.free(),true);assert.ok(fs.existsSync(f.file('maintenance-request.json')));
    assert.ok(!fs.existsSync(f.file('maintenance-active.json')),'no successor starts without a fresh producer');
    lease.child.stdin.end();await lease.exit;
  } finally {await f.finish();}
});

// Replay Darwin's continuous-minus-uptime samples without suspending the host.
function sleepFixture() {
  const f=fixture(), clock=path.join(f.root,'sleep-clock');
  f.env.SNAPBACK4_TEST_SLEEP_CLOCK=clock;
  f.setClock=sample=>{fs.writeFileSync(clock+'.next',String(sample));fs.renameSync(clock+'.next',clock);};
  f.setClock(0);return f;
}
for(const retry of [false,true])test(`maintenance sleep: notification crosses sleep, producer retry=${retry}`,{timeout:120000},async()=>{
  const f=sleepFixture();
  try {
    const {observer,lease}=await pausedGuard(f);
    const old=read(f.file('maintenance-next.json'));
    const producer=f.producer('kick-notified,unused');await f.barrier('kick-notified');
    const wake=read(f.file('maintenance-wakeup.json'));assert.equal(wake.awake,0);
    f.setClock(2000);
    if(!retry){producer.child.kill('SIGKILL');await producer.exit;}
    f.resume('observer-guard-failed');assert.equal((await observer.exit)[0],1,observer.stderr);
    assert.equal(f.free(),true);
    assert.equal(read(f.file('maintenance-next.json')).process.pid,old.process.pid,'holder rejects stale wakeup');
    lease.child.stdin.end();await lease.exit;
    let status;
    if(retry){f.resume('kick-notified');status=await producer.exit;}
    await maintenanceEvidence(f,`sleep-retry-${retry}`);
    assert.equal(read(f.file('maintenance-next.json')).process.pid,old.process.pid,'an intent spanning sleep must not launch a successor via producer retry');
    assert.ok(fs.existsSync(f.file('maintenance-request.json')),'stopped work stays durable');
    assert.deepEqual(read(f.file('maintenance-wakeup.json')),wake,'stale notification was not consumed');
    if(retry){assert.equal(status[0],1);assert.match(producer.stderr,/host slept/);}
  } finally {await f.finish();}
});

test('maintenance sleep: successor keeps the sample accepted before launch',{timeout:120000},async()=>{
  const f=sleepFixture();
  try {
    const {observer,lease}=await pausedGuard(f,'expiry','observer-guard-failed,kick-locked');
    const old=read(f.file('maintenance-next.json'));
    await coalesce(f);const wake=read(f.file('maintenance-wakeup.json'));assert.equal(wake.awake,0);
    f.resume('observer-guard-failed');await f.barrier('kick-locked');
    // The retiring observer has validated the fresh wakeup and holds the lease,
    // but its successor has not started. It must not sample a new baseline.
    f.setClock(2000);lease.child.stdin.end();await lease.exit;
    f.resume('kick-locked');assert.equal((await observer.exit)[0],1,observer.stderr);
    const next=read(f.file('maintenance-next.json'));
    assert.notEqual(next.process.pid,old.process.pid,'exercise the actual successor start');
    await until(()=>!alive(next.process.pid),'successor exits after checking the inherited intent');
    await maintenanceEvidence(f,'sleep-successor-start');
    assert.ok(!read(f.file('maintenance-done.json')),'a successor must reject the inherited intent after sleep');
    assert.ok(fs.existsSync(f.file('maintenance-request.json')));
    assert.deepEqual(read(f.file('maintenance-wakeup.json')),wake,'no guard consumed the stale notification');
    assert.equal(next.awake,wake.awake);assert.equal(next.expiresAt,wake.expiresAt);
    assert.equal(f.free(),true,'sleep releases queue custody');
  } finally {await f.finish();}
});

test('maintenance sleep: no fresh producer stops, a post-sleep export can recover',{timeout:120000},async()=>{
  const f=sleepFixture();
  try {
    const {observer,lease}=await pausedGuard(f,'sleep');
    f.resume('observer-guard-failed');assert.equal((await observer.exit)[0],1,observer.stderr);
    assert.match(observer.stderr,/host slept/);
    assert.equal(f.free(),true);assert.ok(fs.existsSync(f.file('maintenance-request.json')));
    assert.ok(!fs.existsSync(f.file('maintenance-active.json')),'sleep alone cannot authorize a successor');
    lease.child.stdin.end();await lease.exit;
    const producer=f.producer('');assert.equal((await producer.exit)[0],0,producer.stderr);
    await f.drain();assert.ok(read(f.file('maintenance-done.json')));
    assert.equal(read(f.file('maintenance-next.json')).awake,2000,'only a fresh producer takes the post-sleep sample');
  } finally {await f.finish();}
});

test('maintenance sleep: sampling drift through retry and successor start stays within the existing tolerance',{timeout:120000},async()=>{
  const f=sleepFixture(),baseline=14959559;
  try {
    f.setClock(baseline);
    const {observer,lease}=await pausedGuard(f,'expiry','observer-guard-failed,kick-locked');
    const producer=f.producer('kick-notified,unused');await f.barrier('kick-notified');
    const wake=read(f.file('maintenance-wakeup.json'));assert.equal(wake.awake,baseline);
    f.setClock(baseline+1);f.resume('kick-notified');
    assert.equal((await producer.exit)[0],0,producer.stderr);
    f.setClock(baseline+20);f.resume('observer-guard-failed');await f.barrier('kick-locked');
    f.setClock(baseline+1000);lease.child.stdin.end();await lease.exit;f.resume('kick-locked');
    assert.equal((await observer.exit)[0],1,observer.stderr);assert.match(observer.stderr,/60-minute deadline/);
    await f.drain();assert.ok(read(f.file('maintenance-done.json')));
    const next=read(f.file('maintenance-next.json'));
    assert.equal(next.awake,baseline,'tolerance does not resample the accepted intent');
    assert.equal(next.expiresAt,wake.expiresAt);
  } finally {await f.finish();}
});

const trace=f=>{try{return fs.readFileSync(f.file('retention-trace.jsonl'),'utf8').trim().split('\n').map(JSON.parse);}catch{return [];}};
function leasedObserver(f,expires,points) {
  const observer=f.start('python3',['-c',"import os,fcntl,sys; f=open(sys.argv[1]+'/maintenance-next.lock','a'); fcntl.flock(f,fcntl.LOCK_EX); os.dup2(f.fileno(),3); os.set_inheritable(3,True); os.execve(sys.argv[2],[sys.argv[2],'witness','export-maintain',sys.argv[1],sys.argv[3]],os.environ)",f.native,binary,String(expires)],points);
  observer.child.stdin.end('s');return observer;
}
async function retentionLease(f) {
  const lease=f.start('python3',['-c','import sys,fcntl; f=open(sys.argv[1],"a"); fcntl.flock(f,fcntl.LOCK_EX); print("ready",flush=True); sys.stdin.read()',f.file('retention.lock')]);
  await once(lease.child.stdout,'data');return lease;
}

for(const ordering of ['idle success','live guard'])test(`maintenance deadline: ${ordering} adopts a later coalesced intent`,{timeout:120000},async()=>{
  const f=sleepFixture();
  try {
    const lease=await retentionLease(f), expires=Date.now()+5000;
    const point=ordering==='idle success'?'observer-idle-exit':'observer-wakeup';
    if(ordering==='idle success')fs.unlinkSync(f.file('maintenance-request.json'));
    const observer=leasedObserver(f,expires,`${point},wakeup-consumed,observer-guard-failed`);
    const record=await f.barrier(point);
    f.mark('maintenance-next.json',JSON.stringify({process:record.process,expiresAt:expires,awake:0}));
    f.mark('maintenance-request.json','{"state":"pending"}');
    f.setClock(500); // distinguish the producer's sample without crossing sleep
    await coalesce(f);const wake=read(f.file('maintenance-wakeup.json'));
    assert.ok(wake.expiresAt>expires);assert.equal(wake.awake,500);
    f.resume('observer-guard-failed'); // retain a refusal marker without pausing it
    f.resume(point);await f.barrier('wakeup-consumed');
    assert.ok(Date.now()<expires,'the notification is consumed while the old deadline is still valid');
    f.resume('wakeup-consumed');
    // Keep work blocked until a real guard runs beyond the OLD deadline. The
    // mutant exits; the fix keeps observing under the exact producer intent.
    await until(()=>read(f.file('maintenance-test-observer-guard-failed.json')) ||
      trace(f).some(e=>e.step==='wait-retention' && e.at>expires),
      'observer evaluated a guard past its original expiry',15000);
    lease.child.stdin.end();await lease.exit;
    await f.drain(); // unchanged 90-second predicate: the mutant must fail here
    assert.equal((await observer.exit)[0],0,observer.stderr);
    assert.ok(read(f.file('maintenance-done.json')));
    assert.ok(trace(f).some(e=>e.step==='observer-intent-adopted' && e.detail.expiresAt===wake.expiresAt && e.detail.awake===wake.awake));
    if(ordering==='idle success') {
      const next=read(f.file('maintenance-next.json'));
      assert.equal(next.expiresAt,wake.expiresAt);assert.equal(next.awake,wake.awake);
    }
  } finally {await f.finish();}
});

test('maintenance deadline: consumption preserves a concurrent replacement',{timeout:120000},async()=>{
  const f=sleepFixture();
  try {
    const lease=await retentionLease(f), expires=Date.now()+60000;
    const observer=leasedObserver(f,expires,'observer-wakeup,wakeup-taking,wakeup-consumed');
    const record=await f.barrier('observer-wakeup');
    f.mark('maintenance-next.json',JSON.stringify({process:record.process,expiresAt:expires}));
    await coalesce(f);const first=read(f.file('maintenance-wakeup.json'));
    f.resume('observer-wakeup');await f.barrier('wakeup-taking');
    assert.deepEqual(read(f.file('maintenance-wakeup-reading.json')),first);
    const producer=f.producer('');assert.equal((await producer.exit)[0],0,producer.stderr);
    const replacement=read(f.file('maintenance-wakeup.json'));assert.ok(replacement.expiresAt>first.expiresAt);
    f.resume('wakeup-taking');await f.barrier('wakeup-consumed');
    assert.deepEqual(read(f.file('maintenance-wakeup.json')),replacement,'consuming the receipt cannot unlink a newer notification');
    assert.equal(read(f.file('maintenance-wakeup-reading.json')),null);
    f.resume('wakeup-consumed');lease.child.stdin.end();await lease.exit;
    await f.drain();assert.equal((await observer.exit)[0],0,observer.stderr);
    assert.ok(trace(f).some(e=>e.step==='observer-intent-adopted' && e.detail.expiresAt===replacement.expiresAt));
  } finally {await f.finish();}
});

test('maintenance deadline: a later wakeup that crossed sleep is not adopted',{timeout:120000},async()=>{
  const f=sleepFixture();
  try {
    f.setClock(2000);
    const lease=await retentionLease(f), expires=Date.now()+700;
    const observer=leasedObserver(f,expires,'observer-wakeup,observer-guard-failed');
    const record=await f.barrier('observer-wakeup');
    f.mark('maintenance-next.json',JSON.stringify({process:record.process,expiresAt:expires,awake:2000}));
    f.mark('maintenance-wakeup.json',JSON.stringify({expiresAt:expires+60000,awake:0}));
    f.resume('observer-wakeup');await f.barrier('observer-guard-failed');
    f.resume('observer-guard-failed');assert.equal((await observer.exit)[0],1,observer.stderr);
    assert.match(observer.stderr,/60-minute deadline/);assert.equal(f.free(),true);
    assert.ok(fs.existsSync(f.file('maintenance-request.json')));
    assert.ok(!trace(f).some(e=>e.step==='observer-intent-adopted'));
    lease.child.stdin.end();await lease.exit;
  } finally {await f.finish();}
});

test('maintenance deadline: cancellation while consuming leaves an adoptable receipt',{timeout:120000},async()=>{
  const f=sleepFixture();
  try {
    const lease=await retentionLease(f), expires=Date.now()+60000;
    const observer=leasedObserver(f,expires,'observer-wakeup,wakeup-taking');
    const record=await f.barrier('observer-wakeup');
    f.mark('maintenance-next.json',JSON.stringify({process:record.process,expiresAt:expires}));
    await coalesce(f);const wake=read(f.file('maintenance-wakeup.json'));
    f.resume('observer-wakeup');await f.barrier('wakeup-taking');
    assert.equal(read(f.file('maintenance-wakeup.json')),null);
    assert.deepEqual(read(f.file('maintenance-wakeup-reading.json')),wake);
    observer.child.kill('SIGTERM');f.resume('wakeup-taking');
    assert.equal((await observer.exit)[0],1,observer.stderr);assert.match(observer.stderr,/interrupted/);
    lease.child.stdin.end();await lease.exit;
    await f.drain();
    const next=read(f.file('maintenance-next.json'));
    assert.notEqual(next.process.pid,record.process.pid);
    assert.equal(next.expiresAt,wake.expiresAt);assert.equal(next.awake,wake.awake);
    assert.ok(read(f.file('maintenance-done.json')));
  } finally {await f.finish();}
});

// Astra's round-6 ordering: A validated before sleep, B successfully coalesced
// after sleep, then A resumed at the old publication site. Killing A is the
// control. The unfixed binary must reach the original 90-second drain failure.
for(const [resume,crossedSleep] of [[false,true],[true,true],[true,false]])test(
  `maintenance publication: ${crossedSleep?'stale':'older valid'} producer resumes=${resume}`,{timeout:120000},async()=>{
  const f=sleepFixture();
  try {
    const {observer,lease}=await pausedGuard(f);
    const older=f.producer('kick-notifying,unused');await f.barrier('kick-notifying');
    if(crossedSleep)f.setClock(2000);
    const newer=f.producer('');assert.equal((await newer.exit)[0],0,newer.stderr);
    const fresh=read(f.file('maintenance-wakeup.json'));assert.equal(fresh.awake,crossedSleep?2000:0);
    if(resume) {
      f.resume('kick-notifying');assert.equal((await older.exit)[0],crossedSleep?1:0,older.stderr);
      if(crossedSleep)assert.match(older.stderr,/host slept/);
    } else {older.child.kill('SIGKILL');await older.exit;}
    const remaining=read(f.file('maintenance-wakeup.json'));
    f.mark('maintenance-test-producer-order.json',JSON.stringify({resume,crossedSleep,fresh,remaining,olderStderr:older.stderr}));
    f.resume('observer-guard-failed');assert.equal((await observer.exit)[0],1,observer.stderr);
    lease.child.stdin.end();await lease.exit;
    await f.drain();
    assert.deepEqual(remaining,fresh,'a stale publisher cannot erase the successful post-sleep intent');
    if(process.env.SNAPBACK4_MAINTENANCE_EVIDENCE)await maintenanceEvidence(f,'producer-order');
    assert.ok(read(f.file('maintenance-done.json')));
    const next=read(f.file('maintenance-next.json'));
    assert.equal(next.expiresAt,fresh.expiresAt);assert.equal(next.awake,fresh.awake);
  } finally {await f.finish();}
});

for(const killed of [false,true])test(`maintenance publication: writers serialize, owner killed=${killed}`,{timeout:120000},async()=>{
  const f=sleepFixture();
  try {
    const {observer,lease}=await pausedGuard(f);
    const older=f.producer('wakeup-publishing,unused');await f.barrier('wakeup-publishing');
    // A holds the publication lock after its comparison, before rename. B must
    // wait, then reread; process death must release A's lock automatically too.
    const newer=f.producer('wakeup-publication-busy,kick-notified');await f.barrier('wakeup-publication-busy');
    assert.equal(read(f.file('maintenance-wakeup.json')),null);
    if(killed){older.child.kill('SIGKILL');await older.exit;}
    else {f.resume('wakeup-publishing');assert.equal((await older.exit)[0],0,older.stderr);}
    const first=read(f.file('maintenance-wakeup.json'));
    f.resume('wakeup-publication-busy');await f.barrier('kick-notified');
    const fresh=read(f.file('maintenance-wakeup.json'));assert.equal(fresh.awake,0);
    if(!killed)assert.ok(fresh.expiresAt>first.expiresAt,'the later valid publisher advances the record');
    f.resume('kick-notified');assert.equal((await newer.exit)[0],0,newer.stderr);
    f.resume('observer-guard-failed');assert.equal((await observer.exit)[0],1,observer.stderr);
    lease.child.stdin.end();await lease.exit;
    await f.drain();assert.ok(read(f.file('maintenance-done.json')));
    assert.equal(read(f.file('maintenance-next.json')).expiresAt,fresh.expiresAt);
  } finally {await f.finish();}
});

test('maintenance publication: a stuck writer refuses within its acquisition bound',{timeout:120000},async()=>{
  const f=sleepFixture();
  try {
    const {observer,lease}=await pausedGuard(f);
    const writer=f.start('python3',['-c','import sys,fcntl; f=open(sys.argv[1],"a"); fcntl.flock(f,fcntl.LOCK_EX); print("ready",flush=True); sys.stdin.read()',f.file('maintenance-wakeup.lock')]);
    await once(writer.child.stdout,'data');
    const start=performance.now(),producer=f.producer('');
    assert.equal((await producer.exit)[0],1,producer.stderr);
    assert.match(producer.stderr,/maintenance wakeup publication lock busy/);
    assert.ok(performance.now()-start<10000,'five-second acquisition refuses before the outer guard');
    assert.ok(fs.existsSync(f.file('maintenance-request.json')));
    assert.equal(read(f.file('maintenance-wakeup.json')),null);
    // Custody never waits on the producer lock: the stopped observer can leave
    // while it is still held. The ordinary next-export backstop recovers below.
    f.resume('observer-guard-failed');assert.equal((await observer.exit)[0],1,observer.stderr);
    assert.equal(f.free(),true);
    writer.child.stdin.end();await writer.exit;lease.child.stdin.end();await lease.exit;
  } finally {await f.finish();}
});

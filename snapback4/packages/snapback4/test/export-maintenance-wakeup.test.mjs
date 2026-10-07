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

async function pausedGuard(f,stop='expiry') {
  const lease=f.start('python3',['-c','import sys,fcntl; f=open(sys.argv[1],"a"); fcntl.flock(f,fcntl.LOCK_EX); print("ready",flush=True); sys.stdin.read()',f.file('retention.lock')]);
  await once(lease.child.stdout,'data');
  const expires=Date.now()+(stop==='expiry'?700:60000);
  const observer=f.start('python3',['-c',"import os,fcntl,sys; f=open(sys.argv[1]+'/maintenance-next.lock','a'); fcntl.flock(f,fcntl.LOCK_EX); os.dup2(f.fileno(),3); os.set_inheritable(3,True); os.execve(sys.argv[2],[sys.argv[2],'witness','export-maintain',sys.argv[1],sys.argv[3]],os.environ)",f.native,binary,String(expires)],'observer-guard-failed,unused');
  observer.child.stdin.end('s');
  if(stop==='cancellation') {
    await until(()=>{try{return fs.readFileSync(f.file('retention-trace.jsonl'),'utf8').includes('wait-retention');}catch{return false;}},'observer waiting on our retention lease');
    observer.child.kill('SIGTERM');
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

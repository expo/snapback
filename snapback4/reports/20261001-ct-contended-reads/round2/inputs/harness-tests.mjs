import assert from 'node:assert/strict';
import { test } from 'node:test';
import { execFileSync } from 'node:child_process';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { hostSample, maintenanceSnapshot, waitForMaintenance } from '../../../../scripts/contended-observation.mjs';
import { assertLeaseObservations } from '../../../../scripts/contended-mixed.mjs';

test('host telemetry accepts >1 MiB and records bounded failure without throwing',()=> {
  const large=hostSample([process.pid,process.pid],(_command,_args,options)=>execFileSync(process.execPath,['-e',"process.stdout.write('123 10 process\\n'.repeat(150000))"],options));
  assert.equal(large.busiest.length,8);
  assert.equal(large.samplingErrors.length,0);
  assert(large.processes.length>1024*1024);
  const failed=hostSample([process.pid,process.pid],()=>{throw Object.assign(Error('spawnSync ps ENOBUFS'),{code:'ENOBUFS'})});
  assert.equal(failed.samplingErrors.length,2);
  assert.equal(failed.samplingErrors[0].code,'ENOBUFS');
  assert.equal(failed.busiest,null);
});
test('new-event delivery blocks sampling even though query complete may be true',async()=> {
  const dir=mkdtempSync(join(tmpdir(),'ct-r2-observer-')),path=join(dir,'store.sqlite');
  const db=new DatabaseSync(path);
  try {
    db.exec(`CREATE TABLE _generations(generation, schema); CREATE TABLE _catalog(name,num); CREATE TABLE r(t,id,data); CREATE TABLE _jobs(state); CREATE TABLE _commits(seq,at,program);`);
    db.prepare('INSERT INTO _generations VALUES(1,?)').run(JSON.stringify({timelines:[{name:'following'}],maintains:[]}));
    db.exec("INSERT INTO _catalog VALUES('followingWork',1); INSERT INTO _commits VALUES(1,0,'publish');");
    db.prepare('INSERT INTO r VALUES(1,?,?)').run('event',JSON.stringify({Row:{kind:{String:'delivery'},readerId:'Null',status:{String:'pending'}}}));
    assert.equal(maintenanceSnapshot(path).pending,1);
    const timer=setTimeout(()=>db.prepare('UPDATE r SET data=?').run(JSON.stringify({Row:{status:{String:'done'}}})),300);
    const result=await waitForMaintenance(path,join(dir,'wait.json'),{exitCode:null,signalCode:null},5000);
    clearTimeout(timer);
    assert(result.waitMs>=1000);assert.equal(result.initial.pending,1);assert.equal(result.final.pending,0);
    db.prepare('UPDATE r SET data=?').run(JSON.stringify({Row:{status:{String:'parked'}}}));
    await assert.rejects(waitForMaintenance(path,join(dir,'parked.json'),{exitCode:null,signalCode:null},5000),/parked/);
  } finally {db.close();rmSync(dir,{recursive:true})}
});
test('mixed witness rejects unexpected lease changes and every missed abandonment',()=> {
  const valid={raw:[],effects:[{id:'a',effect:'abandoned'}],events:[{kind:'claim',id:'a',effect:'abandoned',attempt:1,leaseUntil:42}],abandoned:new Map([['a',{expires:42}]]),deliberatelyAbandoned:1};
  assertLeaseObservations(valid);
  assert.throws(()=>assertLeaseObservations({...valid,raw:[{kind:'leaseChange'}]}),/unexpected fixed-lease change/);
  assert.throws(()=>assertLeaseObservations({...valid,abandoned:new Map()}),/poller missed/);
  assert.throws(()=>assertLeaseObservations({...valid,events:[]}),/missing first-attempt/);
  assert.throws(()=>assertLeaseObservations({...valid,effects:[]}),/missing abandoned effect/);
  assert.throws(()=>assertLeaseObservations({...valid,abandoned:new Map([['wrong',{expires:42}]])}),/poller missed abandoned claim a/);
});

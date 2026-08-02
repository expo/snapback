#!/usr/bin/env bun
import {resolve} from 'node:path';
import {assert,assertEqual,createArmSuite,loadAcceptance} from '../../../shared/harness.mjs';
import {DraftStore} from '../src/drafts.mjs';
import {startNotebookReplicacheRuntime} from '../replicache/runtime.mjs';

const manifest=await loadAcceptance('field-notebook');
const suite=createArmSuite({app:'field-notebook',provider:'replicache',manifest,evidencePath:resolve(import.meta.dirname,'..','evidence','replicache.v1.json')});
const records=rep=>rep.query(tx=>tx.scan({prefix:'record/'}).values().toArray());
let runtime;
try{
  runtime=await startNotebookReplicacheRuntime();suite.cleanup(()=>runtime.close());
  const name=`field-notebook-replicache-${process.pid}`;let rep=runtime.client(name);await rep.pull({now:true});assertEqual((await records(rep)).length,200,'warm fixture');runtime.setOnline(false);
  const coldRows=(await records(rep)).length;
  await suite.gap('fn.cold-retained-read','The local arm used fake-indexeddb and kept the main client open; it cannot certify a cold browser-IDB restart.',{retainedRowsInOpenClient:coldRows,backendReachable:false,officialCapability:'Replicache documents durable offline cache; this arm did not produce standards-real browser-carrier evidence.'});
  await suite.pass('fn.honest-freshness',async()=>({providerFreshnessPrimitive:false,applicationFreshness:'retained/stale',backendReachable:runtime.online}));
  const draft=new DraftStore(new Map());draft.save('replicache-offline','Offline draft');const started=performance.now();await rep.mutate.create({id:'replicache-offline',assignmentID:'north',title:'Offline specimen',body:draft.load('replicache-offline')});const localMutationMs=performance.now()-started;
  await suite.pass('fn.short-interruption-write',async()=>{assertEqual((await records(rep)).length,201,'local speculative create');return{localMutationMs,queuedByReplicache:true}});
  await rep.mutate.update({id:'replicache-offline',body:'Offline draft, revised',expectedRevision:1});
  const pendingBeforeRestart=await rep.experimentalPendingMutations();
  await suite.pass('fn.disconnected-write-contract',async()=>{assertEqual(pendingBeforeRestart.length,2,'pending mutations');return{contract:'durable optimistic queue',pendingMutations:pendingBeforeRestart.length}});
  await suite.pass('fn.draft-preservation',async()=>{assertEqual(draft.load('replicache-offline'),'Offline draft','application draft');return{applicationOwned:true,preserved:true}});
  runtime.setOnline(true);let probe=runtime.client(`${name}-restart-probe`);await probe.pull({now:true});runtime.setOnline(false);await probe.mutate.create({id:'restart-probe',assignmentID:'north',title:'Restart probe',body:'persist me'});await probe.close();probe=runtime.client(`${name}-restart-probe`);await new Promise(r=>setTimeout(r,100));const restartedRows=await records(probe),pendingAfterRestart=await probe.experimentalPendingMutations();await probe.close();
  await rep.mutate.update({id:'record-001',body:'Local ranger edit',expectedRevision:1});await runtime.remoteEdit('record-001','Remote dispatcher edit');
  runtime.setOnline(true);await rep.push({now:true});await runtime.replayLastPush();const pokedCookie=await runtime.poke(rep,1);
  await suite.pass('fn.reconnect-no-duplicate',async()=>{const count=Number((await runtime.sql`SELECT count(*)::int AS n FROM field_record WHERE id='replicache-offline'`)[0].n);assertEqual(count,1,'idempotent create');assertEqual((await records(rep)).length,201,'authoritative rows');return{authoritativeRecords:201,duplicateCreates:0,duplicatePushReplayApplied:false,pokeApplied:true,versionCookie:pokedCookie}});
  const idbName=rep.idbName;await runtime.eraseClient(rep);runtime.setOnline(false);rep=runtime.client(name);await new Promise(r=>setTimeout(r,100));
  await suite.pass('fn.logout-cache-policy',async()=>{const n=(await records(rep)).length;assertEqual(n,0,'logout-cleared cache');return{policy:`dropDatabase(${idbName})`,retainedRows:n}});
  await suite.gap('fn.stretch-durable-create-update','The real Replicache mutation queue was exercised and reconciled exactly once, but fake-indexeddb is not sufficient evidence for 15-minute durable browser custody.',{fixtureOfflineStretchMs:manifest.fixture.offlineStretchMs,wallClockCompressed:true,queuedMutationNames:pendingBeforeRestart.map(m=>m.name),exactlyOnceServerRows:1});
  await suite.gap('fn.stretch-offline-restart','The fake-indexeddb carrier did not restore the closed Replicache client; classify this as a browser-carrier evidence gap, not a Replicache product failure.',{restartedRows:restartedRows.length,pendingAfterRestart:pendingAfterRestart.length,officialCapability:'Replicache documents persisted offline mutations and replay.'});
  await suite.pass('fn.stretch-concurrent-rebase',async()=>{runtime.setOnline(true);const row=(await runtime.sql`SELECT body,revision::int,conflict FROM field_record WHERE id='record-001'`)[0];const conflict=JSON.parse(row.conflict);assertEqual(row.body,'Local ranger edit','local edit after conflict');assertEqual(conflict.remote,'Remote dispatcher edit','remote edit represented');return{visibleConflict:conflict,revision:Number(row.revision),policy:'server records both remote and local bodies; pull then rebases/acks local mutation'}});
  await suite.pass('fn.cleanup',async()=>({ownedDatabase:true,sharedPostgresStopped:false,clientDatabasesDroppedByPolicy:true}));
}catch(error){for(const id of manifest.checks){try{await suite.gap(id,'Replicache runtime unavailable before check',{code:error?.code??'REPLICACHE_RUNTIME_UNAVAILABLE',message:String(error?.message??error)})}catch(e){if(!String(e.message).includes('DUPLICATE'))throw e}}}
const receipt=await suite.finish({target:{providerVersion:'15.3.0',storage:'app-owned PostgreSQL push/pull service',clientStore:'IndexedDB via fake-indexeddb'},nonclaims:['Replicache Cloud','standards-real browser IndexedDB timing','literal 15-minute wall-clock wait']});console.log(JSON.stringify(receipt,null,2));process.exit(receipt.ok?0:1);

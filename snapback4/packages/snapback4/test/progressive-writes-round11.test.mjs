import { unpublishedReceipt, unpublishedCount, completed, outstanding, outstandingCount, receiptFacts } from "./helpers/progressive-writes.mjs";
import test from 'node:test';
import assert from 'node:assert/strict';
import { localStatus } from '../dist/app.js';
import { memorySessionStore } from '../dist/auth.js';
import { mintId } from '../dist/client.js';
import { storeKey, storeLock } from '../dist/app-storage.js';
import { ProgressiveWrites, progressiveWriteCustody, prepareProgressiveWrites } from '../dist/progressive-writes.js';
import { ClosingResponse } from '../dist/closing-responses.js';
import { journalChanges } from '../dist/journal-changes.js';
import { WRITE_HISTORY_LIMIT } from '../dist/writes.js';
import { fixture, gate, tick, until, mutation, query } from './helpers/progressive-writes.mjs';
const regression = (name, work) => test(name, { timeout: 20_000 }, work);

regression('E11 persona app close retains an action response after original cleanup through nested recovery', async t => {
  const store=memorySessionStore(),url='http://127.0.0.1:4400',key=storeKey('writes',url,'dev:alice');
  await store.set(key,'damaged opening');
  const entered=gate(),recovery=gate(),originalClosed=gate(),response=gate(),captured=gate(),reports=[];
  let installs=0,progressive,ended=false,answered=false;
  const install=ProgressiveWrites.prototype.install,capture=ClosingResponse.prototype.capture;
  t.mock.method(console,'error',(...args)=>reports.push(args));
  t.mock.method(ClosingResponse.prototype,'capture',function(json,...args){capture.call(this,json,...args);if(json.state==='done')captured.resolve();});
  t.mock.method(ProgressiveWrites.prototype,'install',async function(local,...args){
    progressive=this;
    if(++installs===1){
      const close=local.close;
      local.close=async()=>{await close();originalClosed.resolve();};
    }
    if(installs===2){entered.resolve();await recovery.promise;}
    return install.call(this,local,...args);
  });
  t.after(()=>{response.resolve();recovery.resolve();});
  const f=await fixture(t,{persona:true,store,actionReply:async id=>{await response.promise;return {id,state:'done',result:'retained action'};}});
  await f.app.ready;f.coreGate.resolve();await until(()=>localStatus(f.app.client).getSnapshot().state==='ready');
  const action={kind:'action',name:'perform'},id=mintId();
  const acting=f.app.client.act(action,{}, {id}).then(value=>{answered=true;return value;});await until(()=>f.actions.length===1);
  const recovering=progressive.pending();await entered.promise;reports.length=0;
  const closing=f.app.close().then(()=>{ended=true;});await originalClosed.promise;
  assert.equal(ended,false,'public close still owns held recovery');
  assert.equal((await f.app.client.act(action,{})).denied?.code,'E_CLOSED');assert.equal(f.actions.length,1);
  response.resolve();await captured.promise;await tick();
  assert.equal(answered,false,'the invocation waits for the public cutoff');
  recovery.resolve();await recovering;await closing;
  assert.deepEqual(await acting,{id,state:'done',result:'retained action'});
  assert.deepEqual(reports,[],'retired persona recovery opens no new custody and reports no storage failure');
});

regression('E11 identity-wait admission gains its store before a peer settles the held response', async t => {
  const probe=gate(),sync=gate();let progressive;
  const install=ProgressiveWrites.prototype.install;
  t.mock.method(ProgressiveWrites.prototype,'install',async function(...args){await install.apply(this,args);progressive=this;});
  t.after(()=>{probe.resolve();sync.resolve();});
  const f=await fixture(t,{raw:true,schemaStore:false,probeWait:probe,syncWait:sync,syncHead:20});
  const id=mintId(),writing=f.app.client.mutate(mutation,{}, {id,waitSeconds:0});
  const custody=progressiveWriteCustody(f.app.client);
  await until(()=>!progressive.uncertain&&progressive.current().some(write=>write.id===id));
  const waiting=(await custody.inspect()).pending.find(write=>write.id===id);
  assert.ok(waiting);assert.equal(waiting.storeId,undefined,'this witness must pass through the unseeded identity wait');
  probe.resolve();sync.resolve();await f.posted.promise;await writing;
  await until(()=>localStatus(f.app.client).getSnapshot().state==='ready'&&!progressive.uncertain);
  assert.equal((await custody.inspect()).pending.find(write=>write.id===id).storeId,'A');
  const key=storeKey('writes',f.url,'alice'),events=journalChanges(key,()=>{});t.after(()=>events.close());
  await storeLock(key,async()=>{const journal=await f.journal();journal.pending=[];journal.receipts.push({state:'sent',id,seq:21,replayed:true});await f.store.set(key,JSON.stringify(journal));});events.notify();
  await until(()=>!progressive.uncertain&&!progressive.current().some(write=>write.id===id));
  assert.equal((await f.app.client.query(query,{})).data,'server','peer cut 21 fences the local value at watermark 20');
  assert.deepEqual(f.requests,[id]);f.release.resolve();
});

regression('E11 receipt evidence stays bounded after completed-id history has aged out', () => {
  const options={},store=memorySessionStore();prepareProgressiveWrites(options,{store,report:()=>{}});
  const writes=new ProgressiveWrites(options,'https://progressive-writes.invalid','alice');
  const evidence={store:'A',generation:1,preserved:undefined,authorityCurrent:()=>false};
  // The old fixture supplied orphan evidence with no outcome. The reducer
  // protects unpublished responses; age completed receipts through the same
  // history window to witness the named completed-id eviction behavior.
  for(let id=0;id<WRITE_HISTORY_LIMIT+5;id++) {
    const facts=receiptFacts(String(id),evidence);
    writes.receipt(String(id),facts);
    writes.reduce(String(id),{type:'persisted'},facts); writes.trim();
  }
  assert.equal(writes.states.size,WRITE_HISTORY_LIMIT);
  assert.equal(writes.states.has('0'),false);assert.equal(writes.states.has(String(WRITE_HISTORY_LIMIT+4)),true);
});

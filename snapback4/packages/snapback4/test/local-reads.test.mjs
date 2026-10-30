import { readyRead } from "../dist/read-existence.js";
import test from 'node:test';
import assert from 'node:assert/strict';
import { LocalReads } from '../dist/local-reads.js';
import { ReadObservation } from '../dist/read-observation.js';

test('a local commit unconditionally retires retained answers and in-flight publication', async () => {
  const reads = new LocalReads(), watch = Object.assign(new ReadObservation(), { expiryTimer: null });
  watch.publish(readyRead({ data: ['private'], complete: true, cut: null, fresh: true }));
  let release;
  const fetch = watch.fetch(() => new Promise(resolve => { release = resolve; }), () => {}, { retain: true });
  assert.equal(watch.kept, true);
  reads.serverAnswers.set("read:{}", { read: watch.snapshot, at: 1, nextExpiry: null, tables: new Set(["private"]) }, { seq: 0, ticket: reads.serverAnswers.begin() });
  assert.ok(reads.serverAnswers.get("read:{}"), "the answer was remembered");
  reads.clear([watch]);
  assert.equal(reads.serverAnswers.get("read:{}"), undefined, "a local commit retires remembered answers too");
  assert.equal(reads.revision, 1);
  assert.deepEqual(watch.snapshot, { loading: true });
  release({ read: readyRead({ data: ['private'], complete: true, cut: null, fresh: true }) });
  assert.deepEqual((await fetch).read, { loading: true });
  assert.deepEqual(watch.snapshot, { loading: true });
});

test('clearing starts the order again: a replaced store\'s first answer is remembered at any cut', () => {
  const reads = new LocalReads();
  reads.serverAnswers.delete("read:{}", { seq: 100, ticket: reads.serverAnswers.begin() });
  reads.clear([]);
  reads.serverAnswers.set("read:{}", { read: readyRead({ data: ['new store'], complete: true, cut: null, fresh: true }), at: 1, nextExpiry: null, tables: new Set() }, { seq: 1, ticket: reads.serverAnswers.begin() });
  assert.deepEqual(reads.serverAnswers.get("read:{}")?.read.data, ['new store'], "the old store's cut 100 orders nothing after a clear");
});

test('scoped receipt invalidation and resumed cuts respect remembered field dependencies',()=>{
  const reads=new LocalReads(),tables=new Set(['items']),value=readyRead({data:3,complete:true,cut:null,fresh:true});
  reads.serverAnswers.set('count:{}',{read:value,inputs:{items:['count']},tables,at:1,nextExpiry:null},{seq:20,ticket:reads.serverAnswers.begin()});
  reads.notified(['items'],21,true,{items:['title']},true);
  assert.equal(reads.serverAnswers.get('count:{}')?.read,value);
  const watch={tables,detachedEpoch:reads.revision};reads.resume(watch,{items:['count']});assert.equal(watch.changeCut,undefined);
  reads.notified(['items'],22,true,{items:['count']},true);reads.resume(watch,{items:['count']});
  assert.equal(reads.serverAnswers.get('count:{}'),undefined);assert.equal(watch.changeCut,22);
});

test('reset clears scoped journal cuts and changes for the new store',()=>{
  const reads=new LocalReads();reads.evidence(undefined,['items'],{items:['count']},{items:['count']},true);
  reads.notified(['items'],50,true,{items:['count']},true);reads.clear([]);
  const watch={tables:new Set(['items']),detachedEpoch:0};reads.resume(watch,{items:['count']});
  assert.equal(watch.changeCut,undefined);assert.equal(reads.serverCurrent(undefined,{items:['count']})(1),true);
  assert.equal(reads.inputsCurrent(undefined,{items:['count']})(new Set(['items'])),true);
});

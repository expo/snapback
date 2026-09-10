import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileRangeStore } from '../dist/test.mjs';
import { indexedDbRangeStore } from '../dist/react.mjs';
import { sqliteFactory } from './sqlite-fixture.ts';
import { FakeIndexedDb, FakeLocks } from './fake-indexeddb.ts';
import { test } from 'node:test';
import { OfflineRuntime, PersistentRangeStore, drainOutbox } from '../dist/sqlite-test.mjs';
import { engineId } from './fake-owner.ts';
import { RefusalError } from '../dist/client-observed-test.mjs';

const corpus = (name: string) => JSON.parse(readFileSync(new URL(`../../../corpus/${name}.json`, import.meta.url), 'utf8'));
const inbox = corpus('deliver-receipts-inbox'), ack = corpus('deliver-ack-missing-authority');
const op = inbox.program.name, ackOp = ack.program.name, generation = 'a'.repeat(64);
const operation = (c: any) => ({ kind: c.program.kind.toLowerCase(), ...(c.program.args.c ? { cursor:'c' } : {}), ir: c.program, certificate: c.certificate, planHash: c.certificate.plan_hash });
const program = { generation, schemaHash: inbox.certificate.schema_hash, schema: inbox.schema,
  programs: { [op]: operation(inbox), [ackOp]: operation(ack) } };
const wire = (v: any): any => v === 'Null' ? null : ('Row' in v || 'Map' in v) ? Object.fromEntries(Object.entries(v.Row ?? v.Map).map(([k,v]) => [k,wire(v)]))
  : 'Array' in v ? v.Array.map(wire) : Object.values(v)[0];
const ref = (table: string, id: string) => ({ $row: { table, id } });
function frame() {
  const r = inbox.receipt;
  const rows = r.rows.map((r: any) => ({ table: r.table, id: r.id, row: wire(r.row) }));
  return { protocol: 1, generation, schemaHash: program.schemaHash, planHash: inbox.certificate.plan_hash,
    authority: { principal: 'u1', authEpoch: 1 }, seq: 2, validator: 'b'.repeat(64), state: 'complete', next: null,
    rows, data: { events: rows.filter((r: any) => r.table === 'deliveries').map((r: any) => ref(r.table,r.id)), message: ref('messages','m') },
    receipt: { ranges: r.ranges.map((r: any) => ({ site: r.site, table: r.table, index: r.index, prefix: r.prefix.map((a: any) => ({ Scalar: wire(a.Scalar) })),
      order: r.order, take: r.take, after: null, before: null, gt: null, gte: null, lt: null, lte: null, ruleHash: r.rule_hash, rowIds: r.row_ids, stop: r.stop, absence: r.absence })),
      absences: [], verdicts: [] } };
}
function carrier() {
  let saved: any, fail = false;
  const factory = () => new PersistentRangeStore({ carrier: 'json', open: async () => structuredClone(saved),
    replace: async (state: any) => { if (fail) throw new Error('durable write failed'); saved = JSON.parse(JSON.stringify(state)); }, close() {}, wipe: async () => { saved = undefined; } });
  return { factory, saved: () => saved, fail: (value: boolean) => { fail = value; } };
}
async function open(c: ReturnType<typeof carrier>) {
  const runtime = new OfflineRuntime({ store: c.factory }); await runtime.open('u1',true); await runtime.program(program); return runtime;
}
const grant = (days = 0) => ({ id: engineId(100), from: engineId(100), count: 8192, used: 0,
  mintedAt: Date.now() - days * 86400000, expiresAt: Date.now() + 20 * 86400000 });
const accept = async (r: any, f = frame(), args = { c:null as any }) => r.commit(op,args,await r.accept(op,args,f));

for (const mode of ['missing', 'exhausted'] as const) test(`${mode} acknowledgement grant is visible and retries after resume without losing product writes`, async () => {
  const c = carrier(), r = await open(c);
  const bounds = await r.store.outbox.bounds(); await r.store.commit({ bounds: { ...bounds, 'messages.send': 0 } });
  await r.outbox.adopt(grant());
  const product = await r.outbox.enqueue({op:'messages.send',args:{body:'keep'},issuedSeq:1});
  if (mode === 'missing') await r.store.commit({ grants: { current:null } });
  else await r.store.commit({ grants:{put:[{...await r.outbox.grant(),used:8192}]} });
  await accept(r);
  const status = await r.outbox.status();
  assert.equal(status.reason, mode === 'missing' ? 'grant-missing' : 'ids-exhausted');
  assert.equal(status.remaining,2,'product intent plus unadmitted acknowledgement batch');
  assert.deepEqual((await r.outbox.queued())[0],product);
  // Hold the product write while verifying the empty-intent admission path independently.
  await r.store.commit({outbox:{put:[{...product,state:'committed'}]}});
  const stopped = await drainOutbox({ runtime:r,json:async()=>{throw new Error('no request');},shape:(m:string)=>new Error(m),failure:(e:Error)=>e });
  assert.deepEqual(stopped,{stopped:true,reason:'pending',remaining:1});
  assert(await r.resumeRequest([]),'unadmitted acknowledgements can request a logless resume');
  await r.close(); const resumed = await open(c);
  await resumed.outbox.adopt({...grant(),id:engineId(200),from:engineId(200)});
  resumed.outbox.resumeSucceeded(resumed.outbox.generation);
  await resumed.outbox.admitAcknowledgements();
  assert.equal((await resumed.outbox.queued())[0].op,ackOp);
  assert.equal((await resumed.store.outbox.get(product.intent)).args.body,'keep');
  await resumed.close();
});

for (const terminal of ['expired','rejected'] as const) test(`owner ${terminal} acknowledgement is retried only on accepted redelivery under a fresh grant`, async () => {
  const c=carrier(); let r=await open(c); await r.outbox.adopt(grant()); await accept(r);
  const original=(await r.outbox.queued())[0];
  await r.store.commit({bounds:{...await r.store.outbox.bounds(),'messages.send':0}});
  const product=await r.outbox.enqueue({op:'messages.send',args:{body:'keep queued'},issuedSeq:2});
  await assert.rejects(drainOutbox({runtime:r,json:async(_path:any,init:any)=>{
    if(JSON.parse(init.body).op==='messages.send') throw new Error('hold product write');
    if(terminal==='expired') throw new RefusalError({code:'E_OFFLINE_INTENT_EXPIRED',family:'offline',message:'owner expired grant',rewrite:'resume',guide:'offline'});
    return {state:'rejected',code:'E_RULE',family:'rule',message:'ack authority unavailable',rewrite:'retry',guide:'deliver'};
  },shape:(m:string)=>new Error(m),failure:(e:Error)=>e}),/hold product write/);
  assert.equal((await r.store.outbox.get(original.intent)).state,terminal);
  await r.close();r=await open(c);
  assert.equal(await r.outbox.admitAcknowledgements(),0,'settlement alone does not spin another intent');
  const decoded=await r.accept(op,{c:null},frame());
  assert.equal((await r.outbox.queued()).length,1,'decode is not accepted redelivery');
  await r.commit(op,{c:null},decoded);
  assert.equal((await r.outbox.queued()).length,1,'redelivery waits for a fresh grant');
  assert.equal((await r.outbox.status()).reason,'grant-missing');
  assert(await r.outbox.grantById(original.grant),'queued product writes retain their original grant');
  await r.outbox.adopt({...grant(),id:engineId(200),from:engineId(200)});
  await r.outbox.admitAcknowledgements();
  const entries=await r.outbox.queued();assert.equal(entries[0].intent,product.intent);assert.deepEqual(entries[0].args,product.args);
  const retry=entries[1]; assert(retry,'accepted redelivery clears the terminal binding');
  assert.notEqual(retry.intent,original.intent);assert.notEqual(retry.grant,original.grant);assert.deepEqual(retry.args,original.args);
  await r.close();
});

test('receipt acknowledgement requires durable accepted content; dropped, metadata-only and arbitrary cursor requests acknowledge nothing', async () => {
  const c = carrier(), r = await open(c);
  await r.outbox.adopt(grant());
  // A dropped response never reaches accept/commit; a decoded response is not yet durable.
  const decoded = await r.accept(op,{},frame());
  assert.deepEqual(c.saved().deliveryAcks ?? {}, {});
  c.fail(true); await assert.rejects(r.commit(op,{},decoded), /durable write failed/); c.fail(false);
  assert.deepEqual(c.saved().deliveryAcks ?? {}, {});
  const metadata = frame(); delete (metadata.data as any).message;
  await accept(r, metadata, { c: 'arbitrary-position' });
  assert.deepEqual(await r.outbox.queued(), []);
  await accept(r);
  const queued = await r.outbox.queued(); assert.equal(queued.length,1); assert.equal(queued[0].op,ackOp);
  assert.equal(queued[0].args.events.length,1);
  assert.equal(Object.keys(c.saved().answers).length,2);
  await accept(r); assert.equal((await r.outbox.queued()).length,1,'redelivery never queues twice');
  await r.close();
});

test('a stale page whose body was tombstoned cannot acknowledge receipt', async () => {
  const c = carrier(), r = await open(c); await r.outbox.adopt(grant());
  await r.store.commit({ tombstones:[{table:'messages',id:'m',seq:3}] });
  await accept(r);
  assert.equal((await r.outbox.queued()).length,0);
  assert.deepEqual(c.saved().deliveryAcks,{});
  assert.equal((await r.store.coverage()).rows.some((row:any)=>row.table==='messages'),false);
  await r.close();
});

test('pending acknowledgements and their ordinary intent survive a restart and a dropped acknowledgement response', async () => {
  const c = carrier(); let r = await open(c);
  await accept(r); assert.equal((await r.outbox.queued()).length,0,'no grant yet');
  assert.equal(Object.keys(c.saved().deliveryAcks).length,1);
  await r.close(); r = await open(c); await r.outbox.adopt(grant());
  assert.equal(await r.outbox.admitAcknowledgements(),1);
  const original = (await r.outbox.queued())[0];
  const sent: any[] = [];
  await assert.rejects(drainOutbox({ runtime:r, json: async (_: any, init: any) => { sent.push(JSON.parse(init.body)); throw new Error('dropped response'); }, shape: (m: string) => new Error(m), failure: (e: Error) => e }), /dropped response/);
  assert.equal((await r.outbox.queued())[0].intent,original.intent);
  await r.close(); r = await open(c);
  const result = await drainOutbox({ runtime:r, json: async (_: any, init: any) => { sent.push(JSON.parse(init.body)); return { state:'committed',seq:3,data:null,effects:[],program:{schemaHash:program.schemaHash,planHash:ack.certificate.plan_hash} }; }, shape: (m: string) => new Error(m), failure: (e: Error) => e });
  assert.equal(result.stopped,false); assert.deepEqual(sent[0],sent[1]);
  assert.equal((await r.outbox.queued()).length,0);
  assert.equal(await r.store.outbox.get(original.intent),undefined,'settled success actually compacted');
  await accept(r); assert.equal((await r.outbox.queued()).length,0,'independent acknowledgement mark survives compaction');
  await r.close();
});

test('acknowledgements never renew the fence or erase queued product writes; two clients acknowledge independently', async () => {
  for (let client = 0; client < 2; client++) {
    const c = carrier(), r = await open(c); await r.outbox.adopt(grant(8));
    const bounds = await r.store.outbox.bounds(); await r.store.commit({ bounds: { ...bounds, 'messages.send': 0 } });
    const product = await r.outbox.enqueue({ op:'messages.send',args:{ body:'keep me' },issuedSeq:1 });
    await accept(r); const entries = await r.outbox.queued();
    assert.equal(entries.length,2); assert.deepEqual(entries[0],product); assert.equal(entries[1].op,ackOp);
    assert.equal(await r.outbox.canReplay(entries[1]),false);
    let calls = 0;
    const result = await drainOutbox({ runtime:r,json:async () => { calls++; throw new Error('must not send'); },shape:(m:string)=>new Error(m),failure:(e:Error)=>e });
    assert.equal(result.reason,'fence'); assert.equal(calls,0); assert.equal((await r.outbox.queued()).length,2);
    await r.close();
  }
});

test('own event reconciles with the server identity before settlement; changed and removed events survive cold custody', async () => {
  const c = carrier(), r = await open(c), first = frame();
  const event = first.rows.find((row: any) => row.table === 'deliveries')!;
  const pending = { intent:'send',op:'messages.send',args:{},grant:'g',offset:0,count:1,ids:['m'],issuedSeq:1,state:'queued',predicted:true,createdAt:1,updatedAt:1 };
  await r.store.commit({ outbox:{ put:[pending] },overlay:{ put:{ send:[{ table:'deliveries',id:'own:test',row:{ ...event.row,id:'own:test',seq:1 } }] } } });
  await accept(r); assert.deepEqual((await r.store.outbox.overlay()).send,[],'authoritative event replaces the provisional id despite a lost mutation response');
  assert.equal((await r.outbox.queued())[0].intent,'send');
  const changed = frame(); changed.seq=3; changed.validator='c'.repeat(64);
  const edited = changed.rows.find((row:any)=>row.table==='messages')!; edited.row.body='edited';
  const e = changed.rows.find((row:any)=>row.table==='deliveries')!; e.id='change';e.row={...e.row,id:'change',kind:'changed',seq:3};
  changed.data.events=[ref('deliveries','change')]; changed.receipt.ranges[0].rowIds=['change'];
  changed.receipt.ranges[0].after=[2,event.id] as any;
  await accept(r,changed,{c:'tail1'}); await r.close();
  let cold = await open(c); const coverage = await cold.store.coverage();
  assert.equal(coverage.rows.find((row:any)=>row.table==='messages').row.body,'edited');
  const removed = structuredClone(changed);removed.seq=4;removed.validator='d'.repeat(64);removed.rows=removed.rows.filter((row:any)=>row.table!=='messages');
  removed.rows[0].id='remove';removed.rows[0].row={...removed.rows[0].row,id:'remove',kind:'removed',seq:4};
  removed.data={events:[ref('deliveries','remove')],message:null as any};removed.receipt.ranges[0].rowIds=['remove'];
  removed.receipt.ranges[0].after=[3,'change'] as any;
  await accept(cold,removed,{c:'tail2'});await cold.close();cold=await open(c);
  assert.equal((await cold.store.coverage()).rows.some((row:any)=>row.table==='messages'),false);
  assert((await cold.store.coverage()).rows.some((row:any)=>row.row.kind==='changed'));
  assert((await cold.store.coverage()).rows.some((row:any)=>row.row.kind==='removed'));
  await cold.close();
});

test('51 delivery events at one sequence acknowledge only each accepted page in batches of at most 50', async () => {
  const c = carrier(), r = await open(c); await r.outbox.adopt(grant());
  const make = (start:number,count:number) => {
    const f = frame(), event = f.rows.find((r:any)=>r.table==='deliveries')!, message = f.rows.find((r:any)=>r.table==='messages')!;
    const events = Array.from({length:count},(_,n)=>({ table:'deliveries',id:`e${String(start+n).padStart(2,'0')}`,row:{...event.row,id:`e${String(start+n).padStart(2,'0')}`,row:`m${start+n}`} }));
    const messages = events.map(e=>({table:'messages',id:e.row.row,row:{...message.row,id:e.row.row}}));
    f.rows=[...events,...messages]; f.data={events:events.map(e=>ref(e.table,e.id)),message:messages.map(m=>ref(m.table,m.id)) as any};
    f.receipt.ranges[0].rowIds=events.map(e=>e.id); f.receipt.ranges[0].stop=count===50?'Limit':'Exhausted'; f.state=count===50?'capped':'complete';
    if(start) f.receipt.ranges[0].after=[2,'e49'] as any;
    return f;
  };
  await accept(r,make(0,50));
  assert.deepEqual((await r.outbox.queued()).map(e=>e.args.events.length),[50]);
  const last = await r.accept(op,{c:'tail'},make(50,1)); // response decoded, still not accepted
  assert.equal(Object.keys(c.saved().deliveryAcks).length,50);
  await r.commit(op,{c:'tail'},last);
  assert.deepEqual((await r.outbox.queued()).map(e=>e.args.events.length),[50,1]);
  await r.close();
});

test('accepted acknowledgement marks and replay bytes survive file, SQLite and IndexedDB reopen', async () => {
  const root=await mkdtemp(join(tmpdir(),'custody-acks-'));
  try {
    for (const factory of [fileRangeStore(root),sqliteFactory(join(root,'acks.db')),
      indexedDbRangeStore({indexedDB:new FakeIndexedDb() as any,locks:new FakeLocks() as any})]) {
      const start=async () => { const r=new OfflineRuntime({store:factory}); await r.open('u1',true); await r.program(program); return r; };
      let r=await start(); await accept(r); await r.close();
      r=await start(); assert.equal(Object.keys(await r.store.outbox.deliveryAcks()).length,1);
      await r.outbox.adopt(grant()); await r.outbox.admitAcknowledgements();
      const intent=(await r.outbox.queued())[0]; await r.close();
      r=await start(); assert.deepEqual((await r.outbox.queued())[0],intent);
      await accept(r); assert.equal((await r.outbox.queued()).length,1);
      await r.close();
    }
  } finally { await rm(root,{recursive:true,force:true}); }
});

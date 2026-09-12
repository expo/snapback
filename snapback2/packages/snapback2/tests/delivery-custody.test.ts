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
import { OfflineRuntime, PersistentRangeStore, drainOutbox, applyDeliveryAcknowledgements, DeliveryAcknowledgementIndex, SwapJournal, sqliteState } from '../dist/sqlite-test.mjs';
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
  let saved: any, fail = false, writes = 0;
  const factory = () => new PersistentRangeStore({ carrier: 'json', open: async () => structuredClone(saved),
    replace: async (state: any) => { if (fail) throw new Error('durable write failed'); saved = JSON.parse(JSON.stringify(state)); writes++; }, close() {}, wipe: async () => { saved = undefined; } });
  return { factory, saved: () => saved, writes: () => writes, fail: (value: boolean) => { fail = value; } };
}
async function open(c: ReturnType<typeof carrier>) {
  const runtime = new OfflineRuntime({ store: c.factory }); await runtime.open('u1',true); await runtime.program(program); return runtime;
}
const grant = (days = 0) => ({ id: engineId(100), from: engineId(100), count: 8192, used: 0,
  mintedAt: Date.now() - days * 86400000, expiresAt: Date.now() + 20 * 86400000 });
const accept = async (r: any, f = frame(), args = { c:null as any }) => r.commit(op,args,await r.accept(op,args,f));

test('readiness cannot lose an acknowledgement while pending custody becomes a queued intent', async () => {
  const c = carrier(), runtime = await open(c);
  try {
    await accept(runtime); await runtime.outbox.adopt(grant());
    const read = runtime.store.outbox.queuedInfo.bind(runtime.store.outbox);
    let handoff = true;
    runtime.store.outbox.queuedInfo = async () => {
      const before = await read();
      if (handoff) { handoff = false; await runtime.outbox.admitAcknowledgements(); }
      return before;
    };
    const status = await runtime.outbox.status();
    assert.equal((await runtime.outbox.queued()).length, 1, 'admission completed during the read');
    assert.equal(status.remaining, 1, 'the transferred obligation cannot disappear between projections');
  } finally { await runtime.close(); }
});

for (const transition of ['account', 'logout', 'seal'] as const) test(`ack admission loses custody at ${transition} while its grant read is paused`, {timeout:10000}, async () => {
  const partitions = new Map<string, any>();
  const factory = () => {
    let principal: string;
    return new PersistentRangeStore({carrier:'json',
      open:async (p:string) => { principal=p; return structuredClone(partitions.get(p)); },
      replace:async (state:any) => { partitions.set(principal,structuredClone(state)); },
      wipe:async (p:string) => { partitions.delete(p); }, close() {} });
  };
  const bob = new OfflineRuntime({store:factory});
  await bob.open('bob',true);await bob.program(program);await bob.outbox.adopt({...grant(),id:'bob-grant'});await bob.close();
  const r = new OfflineRuntime({store:factory});await r.open('u1',true);await r.program(program);
  await accept(r);await r.outbox.adopt(grant());
  const before = structuredClone(partitions.get('u1').deliveryAcks);
  const paused=Promise.withResolvers<void>(), release=Promise.withResolvers<void>();
  const read=r.store.outbox.grant.bind(r.store.outbox);let intercept=true;
  r.store.outbox.grant=async()=> { if(intercept) { intercept=false;paused.resolve();await release.promise; } return read(); };
  const admission=r.outbox.admitAcknowledgements();await paused.promise;
  const changing=transition==='account'?r.open('bob',true):transition==='logout'?r.wipe():r.seal();
  await new Promise(resolve=>setTimeout(resolve,25));release.resolve();
  await changing;await admission;
  if(transition==='seal') {
    assert.deepEqual(partitions.get('u1').deliveryAcks,before);
    await r.open('u1',true);
  } else assert.equal(partitions.has('u1'),false,'old marks leave with the old partition');
  const state=partitions.get(transition==='account'?'bob':'u1');
  assert.deepEqual(Object.values(state?.outbox??{}),[],'no foreign event or sealed admission');
  if(state) assert.equal(Object.values<any>(state.grants)[0].used,0,'no grant slice consumed');
  await r.close();
});

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
  const savedProduct = (await r.outbox.queued())[0];
  assert(Number.isSafeInteger(savedProduct.order) && savedProduct.order > 0, 'carrier assigns durable FIFO order');
  assert.deepEqual(savedProduct,{...product,order:savedProduct.order});
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
    assert.equal(entries.length,2); assert.deepEqual(entries[0],{...product,order:entries[0].order}); assert.equal(entries[1].op,ackOp);
    assert(Number.isSafeInteger(entries[0].order) && entries[0].order > 0, 'carrier assigns durable FIFO order');
    assert(entries[0].order < entries[1].order, 'acknowledgement stays behind the admitted product write');
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

function deliveryPage(start:number,count:number) {
    const f = frame(), event = f.rows.find((r:any)=>r.table==='deliveries')!, message = f.rows.find((r:any)=>r.table==='messages')!;
    const events = Array.from({length:count},(_,n)=>({ table:'deliveries',id:`e${String(start+n).padStart(4,'0')}`,row:{...event.row,id:`e${String(start+n).padStart(4,'0')}`,row:`m${start+n}`} }));
    const messages = events.map(e=>({table:'messages',id:e.row.row,row:{...message.row,id:e.row.row}}));
    f.rows=[...events,...messages]; f.data={events:events.map(e=>ref(e.table,e.id)),message:messages.map(m=>ref(m.table,m.id)) as any};
    f.receipt.ranges[0].rowIds=events.map(e=>e.id); f.receipt.ranges[0].stop=count===50?'Limit':'Exhausted'; f.state=count===50?'capped':'complete';
    if(start) f.receipt.ranges[0].after=[2,`e${String(start-1).padStart(4,'0')}`] as any;
    return f;
}

test('51 delivery events at one sequence acknowledge only each accepted page in batches of at most 50', async () => {
  const c = carrier(), r = await open(c); await r.outbox.adopt(grant());

  await accept(r,deliveryPage(0,50));
  assert.deepEqual((await r.outbox.queued()).map(e=>e.args.events.length),[50]);
  const last = await r.accept(op,{c:'tail'},deliveryPage(50,1)); // response decoded, still not accepted
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
      r=await start(); assert.equal((await r.store.outbox.pendingDeliveryAcks()).remaining,1);
      await r.outbox.adopt(grant()); await r.outbox.admitAcknowledgements();
      const intent=(await r.outbox.queued())[0]; await r.close();
      r=await start(); assert.deepEqual((await r.outbox.queued())[0],intent);
      await accept(r); assert.equal((await r.outbox.queued()).length,1);
      await r.close();
    }
  } finally { await rm(root,{recursive:true,force:true}); }
});

test('a long accepted tail retains compacted marks only for held log rows and suppresses their duplicates', async () => {
  const c=carrier(), r=await open(c);await r.outbox.adopt(grant());
  for(let n=0;n<120;n++) {
    const page=frame(), event=page.rows.find(row=>row.table==='deliveries')!;
    page.seq=n+2;page.validator=String(n%10).repeat(64);
    event.id=`event-${n}`;event.row={...event.row,id:event.id,seq:page.seq};
    page.data.events=[ref('deliveries',event.id)];page.receipt.ranges[0].rowIds=[event.id];
    // Replace a held tail with its next accepted window; earlier windows are no longer held.
    await accept(r,page);
    const entry=(await r.outbox.queued())[0];assert(entry,`admitted ${n}`);
    await r.store.commit({outbox:{put:[{...entry,state:'committed',response:{seq:page.seq,effects:[],program:{schemaHash:program.schemaHash,planHash:ack.certificate.plan_hash}}}]}});
    assert.equal(await r.store.outbox.get(entry.intent),undefined,'success compacted');
    const rows=(await r.store.coverage()).rows.filter(row=>row.table==='deliveries');
    assert.equal(rows.length,1);
    assert.equal(Object.keys(c.saved().deliveryAcks).length,1,`settled marks bounded by held log at window ${n}`);
    await accept(r,page);assert.equal((await r.outbox.queued()).length,0,'retained mark prevents duplicate acknowledgement');
  }
  await r.close();const cold=await open(c);
  assert.equal(Object.keys(c.saved().deliveryAcks).length,1,'the bound survives reopen');
  assert.deepEqual(await cold.store.outbox.pendingDeliveryAcks(),{remaining:0},'retained bindings are not pending');
  await cold.close();
});

test('pending acknowledgement reads are detached while admitted and retry bindings remain durable', async () => {
  const c=carrier(), r=await open(c); await accept(r);
  const pending=await r.store.outbox.pendingDeliveryAcks(), expected=structuredClone(pending);
  const key=`deliveries\0${pending.next.args.events[0]}`;
  assert.equal(pending.next.issuedSeq,2);
  pending.next.issuedSeq=999; pending.next.args.events.push('foreign'); pending.remaining=999;
  assert.deepEqual(await r.store.outbox.pendingDeliveryAcks(),expected);
  await r.outbox.adopt(grant()); await r.outbox.admitAcknowledgements();
  const entry=(await r.outbox.queued())[0];
  assert.deepEqual(await r.store.outbox.pendingDeliveryAcks(),{remaining:0});
  assert.equal(c.saved().deliveryAcks[key][1],entry.intent);
  await r.store.commit({outbox:{put:[{...entry,state:'expired'}]}});
  assert.deepEqual(await r.store.outbox.pendingDeliveryAcks(),{remaining:0},'retry waits for accepted redelivery');
  assert.equal(c.saved().deliveryAcks[key][2],true);
  await accept(r);
  assert.deepEqual(await r.store.outbox.pendingDeliveryAcks(),expected);
  await r.close();
  assert.deepEqual(await r.store.outbox.pendingDeliveryAcks(),{remaining:0});
});

// `_delivery` is a legal module stem: an authored `_delivery.send` is an ordinary product write
// and the acknowledgement helper must pass it untouched; only `_delivery.<log>.ack` carries events.
test('an authored _delivery.* product mutation is not an acknowledgement', () => {
  const state: any = { ...sqliteState(), deliveryAcks: { 'deliveries\0e1': [3] } };
  const before = structuredClone(state.deliveryAcks);
  const product = { intent: 'g:1', grant: 'g', offset: 0, count: 1, ids: [], op: '_delivery.send', args: { body: 'hi' }, issuedSeq: 1, state: 'queued', predicted: false, trace: { points: [], verdicts: [] }, createdAt: 1, updatedAt: 1, order: 1 };
  assert.doesNotThrow(() => applyDeliveryAcknowledgements(state, { outbox: { put: [product] } } as any, 'alice'));
  assert.deepEqual(state.deliveryAcks, before, 'a product write binds no mark');
  const ack = { ...product, intent: 'g:2', op: '_delivery.deliveries.ack', args: { events: ['e1'] } };
  state.outbox['g:2'] = ack; // the put lands in the same transaction; a bound, unretried mark whose intent AND event row are both absent retires
  applyDeliveryAcknowledgements(state, { outbox: { put: [ack] } } as any, 'alice');
  assert.equal(state.deliveryAcks['deliveries\0e1'][1], 'g:2', 'the engine-owned acknowledgement binds its mark');
});

test('pending work reads at most one batch even with a blocked large backlog', () => {
  const acks: any = Object.fromEntries(Array.from({length:10008},(_,n)=>[`deliveries\0e${n}`,[n]]));
  acks['other\0event']=[10009];
  const index=new DeliveryAcknowledgementIndex(acks);
  let reads=0, enumerations=0;
  const watched=new Proxy(acks,{get:(target,key)=>{reads++;return target[key];},ownKeys:target=>{enumerations++;return Reflect.ownKeys(target);}});
  for(let n=0;n<20;n++) {
    const pending=index.read(watched);
    assert.equal(pending.remaining,202);assert.equal(pending.next.args.events.length,50);
    assert.equal(pending.next.issuedSeq,49);
  }
  assert.equal(reads,1000);assert.equal(enumerations,0);
  reads=0;let batches=0,total=0;
  for(let next;(next=index.read(watched)).remaining;) {
    const log=next.next.op.split('.')[1],keys=next.next.args.events.map(id=>`${log}\0${id}`);
    for(const key of keys) acks[key]=[acks[key][0],`intent-${batches}`];
    index.update(acks,keys);batches++;total+=keys.length;
  }
  assert.equal(batches,202);assert.equal(total,10009);assert.equal(reads,10009);
  assert.equal(enumerations,0);
});

test('incremental acknowledgement cleanup matches the full oracle across compaction, retry, policy, and rollback', () => {
  const state:any={...sqliteState(),deliveryAcks:{},rows:{},outbox:{}};
  for(let n=0;n<1000;n++) {const key=`deliveries\0e${n}`;state.deliveryAcks[key]=[n,`i${n}`];state.rows[key]={};}
  state.deliveryAcks['deliveries\0retry']=[1,'retry',true];
  const index=new DeliveryAcknowledgementIndex(state.deliveryAcks);
  const apply=(change:(draft:any)=>void,swap:any={},rollback=false)=>{
    const journal=new SwapJournal(state);change(journal.draft);
    const oracle=structuredClone(state);
    applyDeliveryAcknowledgements(oracle,swap,'u1');
    applyDeliveryAcknowledgements(journal.draft,swap,'u1',index,journal.changed);
    assert.deepEqual(state.deliveryAcks,oracle.deliveryAcks);
    if(rollback) journal.rollback();else index.update(state.deliveryAcks,journal.changed.get('deliveryAcks')??[]);
  };
  // Retiring an intent and its event in one transaction still reaches the reverse binding.
  apply(draft=>{delete draft.rows['deliveries\0e10'];delete draft.outbox.i10;});
  assert.equal(state.deliveryAcks['deliveries\0e10'],undefined);
  apply(draft=>{delete draft.rows['deliveries\0e11'];}, {}, true);
  assert(state.deliveryAcks['deliveries\0e11']);
  apply(draft=>{delete draft.rows['deliveries\0e11'];});
  apply(draft=>{draft.deliveryAcks['deliveries\0retry']=[7];});
  assert.deepEqual(index.read(state.deliveryAcks).next.args.events,['retry']);
  const changed=new Map([['outbox',new Set(['i12'])]]);
  assert.deepEqual([...index.candidates(state,{bounds:{[ackOp]:0}},changed)],['deliveries\0e12']);
  apply(()=>{}, {bounds:{other:0}});
  assert.deepEqual(state.deliveryAcks,{});assert.deepEqual(index.read(state.deliveryAcks),{remaining:0});
});

test('failed acknowledgement admission leaves both pending index and grant slice unchanged through reopen', async () => {
  const c=carrier();let r=await open(c);await accept(r);await r.outbox.adopt(grant());
  const pending=await r.store.outbox.pendingDeliveryAcks(),before=await r.outbox.grant();
  c.fail(true);await assert.rejects(r.outbox.admitAcknowledgements(),/durable write failed/);c.fail(false);
  assert.deepEqual(await r.store.outbox.pendingDeliveryAcks(),pending);assert.deepEqual(await r.outbox.grant(),before);
  await r.close();r=await open(c);assert.deepEqual(await r.store.outbox.pendingDeliveryAcks(),pending);
  assert.equal(await r.outbox.admitAcknowledgements(),1);assert.equal((await r.outbox.queued()).length,1);
  assert.deepEqual(await r.store.outbox.pendingDeliveryAcks(),{remaining:0});await r.close();
});

const emptyAckResult=()=>({state:'committed',seq:3,data:null,effects:[],program:{schemaHash:program.schemaHash,planHash:ack.certificate.plan_hash}});
async function queuedAck() {
  const c=carrier(),r=await open(c);await r.outbox.adopt(grant());await accept(r);
  await r.store.commit({watermark:{op,args:{c:null},watermark:null,updatedAt:1}});
  return {c,r,entry:(await r.outbox.queued())[0]};
}
test('an effect-free generated acknowledgement settles durably without the ordinary tail request', async () => {
  const {c,r,entry}=await queuedAck();let requests=0;
  const result=await drainOutbox({runtime:r,json:async(path:any)=>{requests++;assert.equal(path,'/api/mutation');return emptyAckResult();},shape:m=>new Error(m),failure:e=>e});
  assert.equal(result.stopped,false);assert.equal(requests,1);
  assert.equal(c.saved().deliveryAcks[Object.keys(c.saved().deliveryAcks)[0]][1],entry.intent);
  assert.equal((await r.outbox.queued()).length,0);await r.close();
});

for(const condition of ['effects','missing-effects','identity','missing-identity','prediction','overlay','superseded','ordinary'] as const)
test(`${condition} prevents acknowledgement-only settlement and retains the queued envelope when the tail fails`, async () => {
  const {r,entry}=await queuedAck(),response:any=emptyAckResult();
  if(condition==='effects')response.effects=[{table:'deliveriesReceipts',id:'r'}];
  if(condition==='missing-effects')delete response.effects;
  if(condition==='identity')response.program.planHash='f'.repeat(64);
  if(condition==='missing-identity')delete response.program;
  if(condition==='prediction')await r.store.commit({outbox:{put:[{...entry,predicted:true}]}});
  if(condition==='overlay')await r.store.commit({overlay:{put:{[entry.intent]:[]}}});
  if(condition==='superseded')await r.store.commit({superseded:{generation:'f'.repeat(64),schemaHash:program.schemaHash,authEpoch:1}});
  if(condition==='ordinary')await r.store.commit({outbox:{put:[{...entry,op:'_delivery.send'}]}});
  let tails=0;
  await assert.rejects(drainOutbox({runtime:r,json:async(path:any)=>{if(path==='/api/mutation')return response;tails++;throw new Error('tail unavailable');},shape:m=>new Error(m),failure:e=>e}),/tail unavailable/);
  assert.equal(tails,1);assert.equal((await r.store.outbox.get(entry.intent)).state,'queued');await r.close();
});

test('acknowledgement eligibility is rechecked within settlement and a changed proof falls back without resending', async () => {
  const {r,entry}=await queuedAck();const check=r.store.outbox.acknowledgementWithoutTail.bind(r.store.outbox);
  r.store.outbox.acknowledgementWithoutTail=async e=>{const eligible=await check(e);assert(eligible);await r.store.commit({overlay:{put:{[entry.intent]:[]}}});return eligible;};
  let sends=0,tails=0;
  await assert.rejects(drainOutbox({runtime:r,json:async(path:any)=>{if(path==='/api/mutation'){sends++;return emptyAckResult();}tails++;throw new Error('fallback tail unavailable');},shape:m=>new Error(m),failure:e=>e}),/fallback tail unavailable/);
  assert.equal(sends,1);assert.equal(tails,1);assert.equal((await r.store.outbox.get(entry.intent)).state,'queued');await r.close();
});

test('acknowledgement-only swaps cannot change their own program proof and failed durability retains queued custody', async () => {
  const {c,r,entry}=await queuedAck();const settled=r.outbox.settle(entry,'committed',emptyAckResult());
  const changed=structuredClone(program);changed.programs[ackOp].planHash='f'.repeat(64);
  await assert.rejects(r.store.commit({outbox:{put:[settled],acknowledgementOnly:true},programs:{[generation]:changed}}));
  assert.equal((await r.store.outbox.get(entry.intent)).state,'queued');assert.equal((await r.store.outbox.programs())[generation].programs[ackOp].planHash,ack.certificate.plan_hash);
  c.fail(true);await assert.rejects(r.store.commit({outbox:{put:[settled],acknowledgementOnly:true}}),/durable write failed/);c.fail(false);
  assert.equal((await r.store.outbox.get(entry.intent)).state,'queued');await r.close();
});


async function pendingPages(count = 3) {
  const c = carrier(), r = await open(c), pages = [];
  for (let index = 0; index < count; index++) {
    const args = { c: index ? `page-${index}` : null };
    pages.push({ op, args, accepted: await r.accept(op, args, deliveryPage(index * 50, index === count - 1 ? 1 : 50)) });
  }
  await r.commitMany(pages);
  return { c, r };
}

test('bulk acknowledgement admission commits the available FIFO grant prefix once and leaves the rest pending', async () => {
  const { c, r } = await pendingPages();
  await r.outbox.adopt({ ...grant(), count: 2 }); const before = c.writes();
  assert.equal(await r.outbox.admitAcknowledgements(), 100);
  assert.equal(c.writes() - before, 1);
  const entries = await r.outbox.queued();
  assert.deepEqual(entries.map(e => [e.offset, e.count, e.args.events.length]), [[0,1,50],[1,1,50]]);
  assert.equal((await r.outbox.pendingAcknowledgements()).remaining, 1);
  assert.equal((await r.outbox.grant()).used, 2);
  await r.outbox.adopt({ ...grant(), id: 'next-grant' });
  assert.equal(await r.outbox.admitAcknowledgements(), 1);
  assert.deepEqual((await r.outbox.queued()).slice(0,2), entries);
  await r.close();
});

test('a failed bulk admission rolls back every event binding and grant offset through reopen', async () => {
  const { c, r } = await pendingPages(); await r.outbox.adopt(grant());
  const before = structuredClone(c.saved()); c.fail(true);
  await assert.rejects(r.outbox.admitAcknowledgements(), /durable write failed/);
  c.fail(false); assert.deepEqual(c.saved(), before); assert.equal((await r.outbox.queued()).length, 0);
  await r.close(); const cold = await open(c);
  assert.equal((await cold.outbox.pendingAcknowledgements()).remaining, 3);
  assert.equal(await cold.outbox.admitAcknowledgements(), 101);
  assert.deepEqual((await cold.outbox.queued()).map(e => e.offset), [0,1,2]); await cold.close();
});

test('lost batch reply retries identical envelopes and a bounded terminal prefix settles in one transaction', async () => {
  const { c, r } = await pendingPages(); await r.outbox.adopt(grant()); await r.outbox.admitAcknowledgements();
  const entries = await r.outbox.queued(), requests: any[] = [];
  const options = { runtime:r, shape:(m:string)=>new Error(m), failure:(e:any)=>e };
  const stopped = await drainOutbox({ ...options, json:async (_path:any, init:any) => {
    requests.push(JSON.parse(init.body)); throw new RefusalError({ code:'E_TRANSPORT',family:'transport',message:'lost reply' }, true);
  } });
  assert.equal(stopped.reason, 'transport'); assert.equal(requests[0].batch.length, 3);
  assert.deepEqual(await r.outbox.queued(), entries);
  const before = c.writes();
  const done = await drainOutbox({ ...options, json:async (path:any, init:any) => {
    assert.equal(path, '/api/mutation'); const request = JSON.parse(init.body); requests.push(request);
    if (request.batch) return { results:request.batch.slice(0,2).map((e:any) => ({ ...emptyAckResult(), intent:e.replay.intent })), more:true };
    return { ...emptyAckResult(), intent:request.replay.intent };
  } });
  assert.equal(done.stopped, false); assert.equal(c.writes() - before, 2);
  assert.deepEqual(requests[1], requests[0]); assert.equal(requests[2].replay.intent, entries[2].intent);
  assert.equal((await r.outbox.queued()).length, 0); await r.close();
});

test('ordinary FIFO writes divide acknowledgement batches and their refusal holds later acknowledgements', async () => {
  const c = carrier(), r = await open(c); await r.outbox.adopt(grant()); await accept(r,deliveryPage(0,50));
  await r.store.commit({ bounds:{...await r.store.outbox.bounds(),'messages.send':0} });
  const product = await r.outbox.enqueue({ op:'messages.send',args:{body:'barrier'},issuedSeq:2 });
  await accept(r,deliveryPage(50,1),{c:'next'}); const seen:string[] = [];
  await assert.rejects(drainOutbox({ runtime:r, shape:m=>new Error(m), failure:e=>e, json:async (_path:any,init:any) => {
    const request = JSON.parse(init.body); assert.equal(request.batch,undefined); seen.push(request.op);
    if (request.op === 'messages.send') throw new RefusalError({code:'E_INPUT',family:'input',message:'blocked'});
    return emptyAckResult();
  } }), /blocked/);
  assert.deepEqual(seen,[ackOp,'messages.send']);
  assert.deepEqual((await r.outbox.queued()).map(e=>e.op), ['messages.send',ackOp]);
  assert.equal((await r.store.outbox.get(product.intent)).refusal.code, 'E_INPUT'); await r.close();
});

test('partial batch refusal settles only its terminal prefix and marks the exact unspent FIFO head', async () => {
  const { r } = await pendingPages(); await r.outbox.adopt(grant()); await r.outbox.admitAcknowledgements();
  const entries = await r.outbox.queued();
  await assert.rejects(drainOutbox({runtime:r,shape:m=>new Error(m),failure:e=>e,json:async()=>({
    results:[{...emptyAckResult(),intent:entries[0].intent}], more:false,
    error:{code:'E_SCHEMA',family:'schema',message:'successor changed input'},
  })}),/successor changed input/);
  assert.deepEqual((await r.outbox.queued()).map(e=>e.intent),entries.slice(1).map(e=>e.intent));
  assert.equal((await r.store.outbox.get(entries[1].intent)).refusal.code,'E_SCHEMA');
  assert.equal((await r.store.outbox.get(entries[2].intent)).refusal,undefined); await r.close();
});

test('all-entry no-tail validation is atomic when one acknowledgement gains an overlay', async () => {
  const { r } = await pendingPages(2); await r.outbox.adopt(grant()); await r.outbox.admitAcknowledgements();
  const entries = await r.outbox.queued(), terminals = entries.map(e=>r.outbox.settle(e,'committed',emptyAckResult()));
  await r.store.commit({overlay:{put:{[entries[1].intent]:[]}}});
  await assert.rejects(r.store.commit({outbox:{put:terminals,acknowledgementOnly:true}}));
  assert.deepEqual(await r.outbox.queued(),entries); await r.close();
});

test('a batch terminal without its exact intent identity cannot settle any attempted entry', async () => {
  for (const intent of [undefined, 'another-intent']) {
    const { r } = await pendingPages(2); await r.outbox.adopt(grant()); await r.outbox.admitAcknowledgements();
    try {
      const before = await r.outbox.queued();
      await assert.rejects(drainOutbox({ runtime:r, shape:m=>new Error(m), failure:e=>e,
        json:async()=>({ results:[{...emptyAckResult(), intent}], more:true }) }), /FIFO intent/);
      assert.deepEqual(await r.outbox.queued(), before);
    } finally { await r.close(); }
  }
});

test('older unadmitted follower inbox work blocks acknowledgement admission until its FIFO position exists', async () => {
  const { r } = await pendingPages(2); await r.outbox.adopt(grant());
  let waiting = true;
  Object.defineProperty(r.store, 'inboxRows', { value: async () => waiting ? [{kind:'mutation',state:'queued',admitted:undefined}] : [] });
  assert.equal(await r.outbox.admitAcknowledgements(),0); assert.equal((await r.outbox.grant()).used,0);
  await r.store.commit({bounds:{...await r.store.outbox.bounds(),'messages.send':0}});
  const follower = await r.outbox.enqueue({op:'messages.send',args:{body:'older follower'},issuedSeq:2,inbox:1});
  waiting = false; assert.equal(await r.outbox.admitAcknowledgements(),51);
  assert.equal((await r.outbox.queued())[0].intent,follower.intent); await r.close();
});

test('operation removal disables batching while original stored-terminal retries keep their exact envelopes', async () => {
  const { r } = await pendingPages(2); await r.outbox.adopt(grant()); await r.outbox.admitAcknowledgements();
  const entries = await r.outbox.queued(), removed = structuredClone(program); delete removed.programs[ackOp];
  await r.store.commit({programs:{[generation]:removed},bounds:{}});
  const seen:any[] = [];
  const done = await drainOutbox({runtime:r,shape:m=>new Error(m),failure:e=>e,json:async(_path:any,init:any)=>{
    const request=JSON.parse(init.body); assert.equal(request.batch,undefined); seen.push(request);
    return {...emptyAckResult(),intent:request.replay.intent};
  }});
  assert.equal(done.stopped,false); assert.deepEqual(seen.map(e=>e.replay.intent),entries.map(e=>e.intent));
  assert.deepEqual(seen.map(e=>e.args),entries.map(e=>e.args)); await r.close();
});

test('one sufficient later tail settles a batch while actual unseen receipt effects remain in custody', async () => {
  const { r } = await pendingPages(2); await r.outbox.adopt(grant()); await r.outbox.admitAcknowledgements();
  await r.store.commit({watermark:{op,args:{c:null},watermark:null,updatedAt:1}});
  const entries = await r.outbox.queued(); let tails = 0;
  const done = await drainOutbox({runtime:r,shape:m=>new Error(m),failure:e=>e,json:async(path:any,init:any)=>{
    if(path==='/api/mutation') return {results:JSON.parse(init.body).batch.map((e:any,index:number)=>({
      ...emptyAckResult(),seq:3+index,intent:e.replay.intent,effects:[{table:'deliveriesReceipts',id:`unseen-${index}`}],
    })),more:false};
    tails++; const page=deliveryPage(0,50);page.seq=8;return page;
  }});
  assert.equal(done.stopped,false);assert.equal(tails,1);
  for(const entry of entries) {
    const held=await r.store.outbox.get(entry.intent);assert.equal(held.state,'committed');
    assert.equal(held.response.effects.length,1,'terminal custody keeps actual unobserved receipt effects');
  }
  await r.close();
});

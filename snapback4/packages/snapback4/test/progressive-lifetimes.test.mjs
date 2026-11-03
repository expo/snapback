// @ref LLP 3000.001.001#8-progress-and-ui — acquisition lifetimes preserve progress and live fallback on the negotiated walk.
import test from 'node:test';
import assert from 'node:assert/strict';
import { setTimeout as delay } from 'node:timers/promises';
import { fixture, query } from './helpers/progressive-acquisition.mjs';
import { acquisition } from '../dist/acquisition.js';
import { waitFor, hangBudget } from './helpers/wait.mjs';

const countsSource = `use personas alice
table constructor:
  value: int
  public 'progress fixture'
  sync public
query all(c: cursor ?):
  return constructor first 100 after c
`;
const rows = count => Array.from({length:count}, (_,n) => ({table:'constructor',row:{id:`row-${String(n).padStart(5,'0')}`,value:n}}));
test('compiled special-table walk clears partial counts on sign-out', {timeout:hangBudget(10)}, async t => {
  const f = await fixture(t, 'wasm', {source:countsSource,rows:rows(7),limit:2});
  let release, blocked = false;
  const barrier = new Promise(resolve=>{ release=resolve; });
  f.intercept(async () => { if (f.applies.length === 1) { blocked=true; await barrier; } });
  f.allow(true); const prepared = await f.open(true), client = prepared.client;
  let booleanNotifications = 0;
  client.onAcquired(() => booleanNotifications++);
  const starting = prepared.start();
  t.after(async()=>{ release(); await client.close(); await starting; });
  await waitFor(()=>blocked && acquisition(client).read().rows > 0, 'partial walk with request in flight');
  const before = acquisition(client).read();
  assert.equal(before.rows, 2); assert.equal(before.tables.constructor, 2);
  assert.equal(Object.getPrototypeOf(before.tables), null); assert.equal(before.acquired, false);
  const ending = client.signOut(); release(); await ending; await starting;
  const after = acquisition(client).read();
  assert.deepEqual(after, {acquired:false,rows:0,tables:Object.create(null),usable:{tables:0,groups:0}});
  assert.equal(client.viewer(), null); assert.equal(client.acquired, false); assert.equal(booleanNotifications, 0);
  assert.equal((await client.query(query('all'), {c:null})).denied.code, 'E_CLOSED');
});

test('multi-page special-table walk counts every row and reopens complete offline', {timeout:hangBudget(12007)}, async t => {
  const f = await fixture(t, 'wasm', {source:countsSource,rows:rows(12007),limit:10000});
  f.allow(true); const client = await f.open();
  assert.equal(client.acquired, true);
  assert.equal(acquisition(client).read().rows, 12007);
  assert.equal(acquisition(client).read().tables.constructor, 12007);
  assert.equal(f.requests.length, 4, 'two acquisition units, each followed by a drain');
  await client.close(); f.online(false);
  const reopened = await f.open(); const all = []; let c = null;
  do {
    const read = await reopened.query(query('all'), {c});
    assert.equal(read.complete, true); assert.equal(read.fresh, false);
    all.push(...read.data); c = read.next ?? null;
  } while (c);
  assert.equal(reopened.acquired, true); assert.equal(all.length, 12007);
  assert.equal(new Set(all.map(r=>r.id)).size, 12007);
  assert.ok(all.every(r=>r.value === Number(r.id.slice(4))));
});

const watchSource = `use personas alice
table messages:
  body: text <=100
  at: int
  public 'watch fixture'
  insert <- allow
  delete <- allow
  sync last 500 by .at
query history():
  return messages last 20 by .at
mutation send(id: id, body: text <=100, at: int):
  insert messages {id,body,at}
mutation remove(id: messages):
  delete messages[id]
`;
for (const fault of ['none','503','prediction','expiry','unwatch']) test(`blocked progressive publication keeps watch lifetime: ${fault}`, {timeout:hangBudget(30)}, async t => {
  const f = await fixture(t, 'wasm', {source:watchSource,rows:[]});
  let release, entered = 0, failures = 0, failNext = false;
  const barrier = new Promise(resolve=>{ release=resolve; });
  f.intercept(async body => { if (body.acquire && entered++ === 0) await barrier; });
  f.allow(true); const prepared = await f.open(true), client = prepared.client, acquiring = prepared.start();
  t.after(async ()=>{ release(); await client.close(); await acquiring; });
  await waitFor(()=>entered === 1, 'first acquire blocked');
  const watch = client.observe(query('history'), {}), unsubscribe = watch.subscribe(()=>{});
  t.after(()=>{ unsubscribe(); watch.close(); });
  await waitFor(()=>watch.getSnapshot().data?.length === 0, 'initial fallback');
  const send = async n => { assert.equal((await f.post('/m/send',{id:`write-${n}`,args:{id:`m${n}`,body:`m${n}`,at:n}})).state,'sent'); };
  await send(1); await waitFor(()=>watch.getSnapshot().data?.some(r=>r.id==='m1'), 'first send');
  const shown = watch.getSnapshot();
  if (fault === 'unwatch') {
    watch.close(); await delay(350); const before = f.queries.length;
    await send(2); await delay(650); assert.equal(f.queries.length, before);
  } else {
    if (fault === 'prediction') {
      const result = await f.core().call({op:'enqueue',entry:{id:'peer',seq:1,op:'send',viewer:'dev:alice',now:Date.now(),args:{id:'predicted',body:'pending',at:100},new_ids:[],predictable:true,predicted:['messages/predicted']}});
      assert.equal(result.denied, undefined);
      await delay(600); assert.equal(watch.getSnapshot(), shown);
      assert.equal((await f.core().call({op:'dequeue',id:'peer'})).denied, undefined);
    } else if (fault !== 'none') {
      failNext = true;
      f.interceptQuery(async (input,init)=>{
        if (!failNext) return; failNext=false; failures++;
        if (fault==='503') return new Response('unavailable',{status:503});
        return Response.json({...await fetch(input,init).then(r=>r.json()),nextExpiry:Date.now()-1000});
      });
      await waitFor(()=>failures===1,'refresh fault'); await delay(100);
      assert.equal(watch.getSnapshot(), shown);
    }
    assert.equal((await f.post('/m/remove',{id:'remove',args:{id:'m1'}})).state,'sent');
    await send(2); await waitFor(()=>watch.getSnapshot().data?.some(r=>r.id==='m2'), 'send after refresh');
    assert.ok(!watch.getSnapshot().data.some(r=>r.id==='m1'));
  }
  assert.equal(client.acquired, false); assert.equal(f.applies.length, 0);
  assert.equal(entered, 1);
  release(); await acquiring; await client.sync(); assert.equal(client.acquired, true);
  if (fault !== 'unwatch') {
    await waitFor(()=>watch.getSnapshot().data?.some(r=>r.id==='m2'), 'local publication');
    await delay(350); const before = f.queries.length; await delay(650);
    assert.equal(f.queries.length, before, 'acquired local query stops acquisition polling');
  }
});

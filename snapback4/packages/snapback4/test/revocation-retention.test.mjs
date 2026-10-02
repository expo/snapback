import test from 'node:test';
import assert from 'node:assert/strict';
import { pathToFileURL } from 'node:url';
import { resolve } from 'node:path';
import { parked, until, q } from './helpers/answers-stay.mjs';
const sdk = process.env.RV_TEST_SDK ? pathToFileURL(resolve(process.env.RV_TEST_SDK) + '/') : new URL('../dist/', import.meta.url);
const { createClient } = await import(new URL('client.js', sdk));

// This runs the public watch path. Main ignores additive preservation evidence
// and fails the insert cases at the controlled one-second boundary.
for (const keep of [undefined, true]) for (const kind of ['insert', 'delete', 'legacy', 'malformed', 'opaque']) {
  test(`mounted history: ${kind}, keep=${keep}, replacement held beyond one second`, async t => {
    let now = 1000, reads = 0, polled = false;
    t.mock.method(Date, 'now', () => now);
    const change = Promise.withResolvers(), replacement = Promise.withResolvers();
    const client = createClient({ url: 'http://rv.test', persona: 'bob', fetch: async (input, init) => {
      const path = new URL(input).pathname;
      if (path === '/probe') return parked(init.signal);
      if (path === '/changes') {
        if (polled) return parked(init.signal);
        polled = true; await change.promise;
        return Response.json({ seq: 2, tables: ['messages'], ...(kind === 'legacy' ? {} : { preserved: kind === 'delete' ? [] : kind === 'malformed' ? 'messages' : ['messages'] }) });
      }
      assert.equal(path, '/q/history');
      if (++reads > 1) await replacement.promise;
      return Response.json({ data: [{ id: reads === 1 ? 'old' : 'new' }], complete: true, seq: reads === 1 ? 1 : 2, tables: ['messages'], ...(kind === 'opaque' ? {} : { scopes: { messages: [{}] } }) });
    } });
    t.after(async () => { change.resolve(); replacement.resolve(); await client.close(); });
    const watch = client.observe(q('history'), {} , { keep });
    await until(() => watch.getSnapshot().data?.[0].id === 'old');
    const publications = [];
    watch.subscribe(() => publications.push(watch.getSnapshot()));
    change.resolve(); await until(() => reads === 2);
    assert.equal(watch.getSnapshot().revalidating, true);
    now += 1001;
    const held = watch.getSnapshot();
    if (kind === 'insert') {
      assert.equal(held.data?.[0].id, 'old'); assert.equal(held.revalidating, true);
      assert.ok(publications.every(read => !read.loading));
    } else assert.equal(held.loading, true);
    replacement.resolve(); await until(() => watch.getSnapshot().data?.[0].id === 'new');
    assert.equal(watch.getSnapshot().revalidating, undefined);
  });
}

test('safe evidence retains through retry exhaustion; later revoking evidence still bounds it', async t => {
  const { ReadObservation } = await import(new URL('read-observation.js', sdk));
  const { readyRead } = await import(new URL('read-existence.js', sdk));
  let now = 1000; t.mock.method(Date, 'now', () => now);
  const watch = new ReadObservation(); t.after(() => watch.retire());
  watch.publish(readyRead({ data: ['row'], complete: true, fresh: true, cut: null }));
  watch.reload(false);
  await watch.fetch(async () => ({ read: watch.snapshot }), () => {}, { accept: () => false });
  now += 5000; assert.deepEqual(watch.read(null).data, ['row']); assert.equal(watch.snapshot.revalidating, true);
  watch.reload(true); now += 1001; assert.equal(watch.read(null).loading, true);
});

test('facade-held A keeps its dependencies after source B changes tables', { skip: !!process.env.RV_TEST_SDK }, async t => {
  const { ReadObservation } = await import(new URL('read-observation.js', sdk));
  const { ReadApprovals } = await import(new URL('read-approval.js', sdk));
  const { readyRead } = await import(new URL('read-existence.js', sdk));
  const { watchCanRevoke, evidenceTouches } = await import(new URL('change-evidence.js', sdk));
  let now=1000;t.mock.method(Date,'now',()=>now);
  const w=Object.assign(new ReadObservation(),{tables:new Set(['old']),scopes:{old:[{}]}});
  w.dependencies=()=>({tables:w.tables,scopes:w.scopes});
  const approvals=new ReadApprovals();t.after(()=>{approvals.close();w.retire();});
  w.publish(readyRead({data:'A',complete:true,fresh:true,cut:null}));const approved=approvals.approve(w.snapshot);
  w.tables=new Set(['new']);w.scopes={new:[{}]};w.publish(readyRead({data:'B',complete:true,fresh:true,cut:null}));
  assert.equal(evidenceTouches(w,['old']),true);
  w.reload(watchCanRevoke(w,['old','new']));now+=1501;
  assert.equal(approved.read().data,'A');assert.equal(approved.read().revalidating,true);
  w.reload(watchCanRevoke(w,['new']));now+=1001;
  assert.equal(approved.read().loading,true);
});

for(const change of ['insert','delete','generation'])test(`mutation acknowledgement: ${change}`,async t=>{
  let now=1000,reads=0;t.mock.method(Date,'now',()=>now);
  const replacement=Promise.withResolvers();
  const client=createClient({url:'http://rv-ack.test',persona:'bob',fetch:async(input,init)=>{
    const path=new URL(input).pathname;
    if(path==='/changes'||path==='/probe')return parked(init.signal);
    if(path==='/m/send')return Response.json({state:'sent',id:JSON.parse(init.body).id,seq:2,generation:change==='generation'?2:1,preserved:change==='delete'?[]:['messages']});
    assert.equal(path,'/q/history');if(++reads>1)await replacement.promise;
    return Response.json({data:[{id:reads===1?'old':'new'}],complete:true,tables:['messages'],scopes:{messages:[{}]},seq:reads===1?1:2,generation:1});
  }});t.after(async()=>{replacement.resolve();await client.close();});
  const watch=client.observe(q('history'),{});await until(()=>watch.getSnapshot().data);
  await client.mutate({kind:'mutation',name:'send'},{});await until(()=>reads>1);
  if(change==='generation')assert.equal(watch.getSnapshot().loading,true);
  now+=1001;
  if(change==='insert'){assert.equal(watch.getSnapshot().data?.[0].id,'old');assert.equal(watch.getSnapshot().revalidating,true);}
  else assert.equal(watch.getSnapshot().loading,true);
});

test('a failed safe reread preserves the displayed answer dependency plan for the next safe event', async t => {
  let now=1000,reads=0,changes=[];t.mock.method(Date,'now',()=>now);
  const gate=Promise.withResolvers();
  const client=createClient({url:'http://rv-retry.test',persona:'bob',fetch:async(input,init)=>{
    const path=new URL(input).pathname;
    if(path==='/probe')return parked(init.signal);
    if(path==='/changes')return new Promise(resolve=>changes.push(json=>resolve(Response.json(json))));
    if(++reads===2)throw Error('controlled failed reread');
    if(reads>2)await gate.promise;
    return Response.json({data:[{id:'old'}],complete:true,seq:1,tables:['messages'],scopes:{messages:[{}]}});
  }});t.after(async()=>{gate.resolve();for(const done of changes)done({seq:1,tables:[]});await client.close();});
  const watch=client.observe(q('history'),{});await until(()=>watch.getSnapshot().data&&changes.length);
  changes.shift()({seq:2,tables:['messages'],preserved:['messages']});
  await until(()=>reads>=2&&changes.length);assert.equal(watch.getSnapshot().data?.[0].id,'old');
  changes.shift()({seq:3,tables:['messages'],preserved:['messages']});await until(()=>reads>=3);
  now+=2000;assert.equal(watch.getSnapshot().data?.[0].id,'old');assert.equal(watch.getSnapshot().revalidating,true);
});

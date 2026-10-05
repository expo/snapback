// @ref LLP 3000.028#3.2 — bind fallback routing to the evaluation transaction.
import test from 'node:test';
import assert from 'node:assert/strict';
import { join } from 'node:path';
import {fixture,source,opener,q,parked,until,sdk} from './helpers/answers-stay.mjs';
const {createLocalClient} = await import(new URL('local.js', sdk));
const program=source.replace('  sync to members[.room]\ntable profiles:', '  retain delivered-history\n  sync to members[.room] last 1 by byRoom\ntable profiles:').replace("return messages['room'] first 100", "return messages['room'] last 100");
for(const host of ['wasm','process']) for(const owner of ['same','other']) test(`${host} commit between evaluation and capture: ${owner} owner`,{timeout:30000},async t=>{
  const f=await fixture(t,program);
  assert.equal((await f.post('/seed',[{table:'messages',row:{id:'older',room:'room',body:'older',at:0}}])).seeded,1);
  const gate=Promise.withResolvers(),entered=Promise.withResolvers();
  let hold=false,core,initial,captured;
  const inner=opener(host,join(f.dir,'shared'));
  const network=(url,init)=>new URL(url).pathname==='/changes'?parked(init.signal):fetch(url,init);
  const a=await createLocalClient({url:f.url,persona:'bob',fetch:network,device:{open:async(...args)=>{
    core=await inner.open(...args);return {close:()=>core.close(),call:async(r,...rest)=>{
      const reply=await core.call(r,...rest);
      if(hold&&r.op==='query'&&r.name==='history'){hold=false;initial=reply;entered.resolve();await gate.promise;}
      if(r.op==='sync_state')captured=reply.ok;
      return reply;
    }};
  }}});
  t.after(async()=>{gate.resolve();await a.close();});await a.sync();
  // Wasm persistence has exclusive ownership. A second SDK caller shares its
  // actual core; process callers use distinct cores over the same SQLite store.
  const b=await createLocalClient({url:f.url,persona:'bob',fetch:network,device:host==='process'?opener(host,join(f.dir,'shared')):{open:async()=>({call:(...args)=>core.call(...args),close:async()=>{}})}});
  t.after(()=>b.close());await b.sync();
  assert.equal((await a.query(q('history'),{c:null})).data.length,2);
  hold=true;const pending=a.query(q('history'),{c:null});await entered.promise;
  assert.equal(initial.ok.unknown,true);assert.equal(initial.ok.retained??false,false);
  assert.equal((await f.post('/m/remove',{id:'leave',args:{}})).state,'sent');
  await (owner==='same'?a:b).sync();
  const actual=await core.call({op:'state'});
  gate.resolve();const result=await pending;
  const after=await a.query(q('history'),{c:null});
  console.log(JSON.stringify({host,owner,initial:initial.ok,capture:captured,actual:actual.ok,result,after}));
  assert.ok(!(result.data?.length===0&&result.complete&&result.fresh),'committed retained routing must invalidate the earlier current evaluation');
  assert.equal(result.data?.length,1);
  assert.equal(initial.ok.watermark,2,'cut captured inside the evaluation');
  assert.equal(actual.ok.watermark,3);
});

const cursorProgram=source.replace('  sync to members[.room]\ntable profiles:', '  retain delivered-history\n  sync to members[.room] last 2 by byRoom\ntable profiles:')
 .replace("return messages['room'] first 100", "return messages['room'] last 3")+"\nquery head(c: cursor ?):\n  return messages['room'] last 1 by byRoom after c\n";
for(const host of ['wasm','process']) test(`${host}: ordinary cursor stays provisional during held leave`,{timeout:30000},async t=>{
 const f=await fixture(t,cursorProgram);
 const rows=[0,2,3,4,5].map(at=>({table:'messages',row:{id:'r'+at,room:'room',body:'body'+at,at}}));
 assert.equal((await f.post('/seed',rows)).seeded,5);
 const gate=Promise.withResolvers();let hold=false,held=false,client;const inner=opener(host,join(f.dir,host));
 t.after(async()=>{gate.resolve();await client?.close();});
 client=await createLocalClient({url:f.url,persona:'bob',device:{open:async(...args)=>{
  const core=await inner.open(...args);return{close:()=>core.close(),call:async(r,...rest)=>{
   if(hold&&r.op==='apply'&&r.page.events?.some(e=>e.kind==='scope')){held=true;await gate.promise;}
   return core.call(r,...rest);
  }};
 }}});await client.sync();
 const first=await client.query(q('head'),{c:null});assert.ok(first.next);
 const args={c:first.next};assert.equal((await client.query(q('history'),args)).data.length,3);
 hold=true;assert.equal((await f.post('/m/remove',{id:'leave',args:{}})).state,'sent');await until(()=>held,'held apply');
 const one=await client.query(q('history'),args);assert.equal(one.data.length,1);assert.equal(one.complete,false);assert.equal(one.fresh,false);
 const watch=client.observe(q('history'),args);const stop=watch.subscribe(()=>{});t.after(()=>{stop();watch.close();});
 await until(()=>watch.getSnapshot().data,'cursor provisional watch');assert.equal(watch.getSnapshot().data.length,1);assert.equal(watch.getSnapshot().complete,false);assert.equal(watch.getSnapshot().fresh,false);
 console.log(JSON.stringify({host,one,mounted:watch.getSnapshot()}));
 hold=false;gate.resolve();await client.sync();assert.equal((await client.query(q('history'),args)).data.length,1);
});

for (const host of ['wasm', 'process']) for (const rejoin of [true, false]) test(`${host}: shared composition cannot certify an overtaken second evaluation (rejoin: ${rejoin})`, { timeout: 30000 }, async t => {
  const f = await fixture(t, program + `
query pair():
  left = messages['left'] last 100 by byRoom
  current = messages['room'] last 100 by byRoom
  return { left, current }
mutation leaveLeft():
  delete members[room = 'left', principal = 'dev:bob']
mutation rejoinLeft():
  insert members { room: 'left', principal: 'dev:bob' }
`);
  assert.equal((await f.post('/seed', [
    ...['alice', 'bob'].map(p => ({ table: 'members', row: { id: p+'-left', room: 'left', principal: 'dev:'+p } })),
    { table: 'messages', row: { id: 'left-item', room: 'left', body: 'left', at: 1 } },
    { table: 'messages', row: { id: 'older', room: 'room', body: 'older', at: 0 } },
  ])).seeded, 4);
  const entered = [Promise.withResolvers(), Promise.withResolvers()], release = [Promise.withResolvers(), Promise.withResolvers()];
  let core, armed = false, queries = 0;
  const network = (url, init) => new URL(url).pathname === '/changes' ? parked(init.signal) : fetch(url, init);
  const inner = opener(host, join(f.dir, 'shared'));
  const a = await createLocalClient({ url: f.url, persona: 'bob', fetch: network, device: { open: async (...args) => {
    core = await inner.open(...args);
    return { close: () => core.close(), call: async (request, ...rest) => {
      const answer = await core.call(request, ...rest);
      if (armed && request.op === 'query' && request.name === 'pair' && queries < 2) {
        const index = queries++;
        entered[index].resolve(answer.ok); await release[index].promise;
      }
      return answer;
    } };
  } } });
  t.after(async () => { release.forEach(g => g.resolve()); await a.close(); });
  await a.sync();
  const b = await createLocalClient({ url: f.url, persona: 'bob', fetch: network,
    device: host === 'process' ? opener(host, join(f.dir, 'shared')) : { open: async () => ({ call: (...args) => core.call(...args), close: async () => {} }) } });
  t.after(() => b.close()); await b.sync();
  assert.equal((await f.post('/m/leaveLeft', { id: 'left-leaves', args: {} })).state, 'sent');
  await a.sync();
  armed = true;
  const pending = a.query(q('pair'), {});
  const first = await entered[0].promise;
  assert.equal(first.components.left.retained, true);
  assert.equal(first.components.current.unknown, true);
  if (rejoin) {
    assert.equal((await f.post('/m/rejoinLeft', { id: 'left-rejoins', args: {} })).state, 'sent');
    await b.sync();
  }
  assert.equal((await f.post('/m/remove', { id: 'room-leaves', args: {} })).state, 'sent');
  release[0].resolve();
  const second = await entered[1].promise;
  assert.equal(Object.values(second.components).some(c => c.retained),!rejoin);
  assert.equal(second.data.current.length, 1);
  await b.sync();
  release[1].resolve();
  const result = await pending;
  console.log(JSON.stringify({ host, rejoin, firstCut: first.watermark, secondCut: second.watermark, actual: (await core.call({ op: 'state' })).ok.watermark, result }));
  assert.equal(result.data.current.length, 1, 'newly retained component must survive a shared commit after the second evaluation');
  assert.equal(result.complete, false); assert.equal(result.fresh, false);
});

for (const host of ['wasm', 'process']) test(`${host}: watermark-only catch-up after provisional route reruns before delivery`, { timeout: 30000 }, async t => {
  const f = await fixture(t, program.replace("  online only", "  update <- allow\n  online only") + "\nmutation rename():\n  update profiles['bob'] { name: 'Bob 2' }\n");
  await f.post('/seed', [{ table: 'messages', row: { id: 'older', room: 'room', body: 'older', at: 0 } }]);
  const entered = Promise.withResolvers(), release = Promise.withResolvers();
  let armed = false, routed = false, held = false, published = false, queries = 0, apply;
  const inner = opener(host, join(f.dir, 'late-publication'));
  const client = await createLocalClient({ url: f.url, persona: 'bob',
    fetch: (url, init) => new URL(url).pathname === '/changes' ? parked(init.signal) : fetch(url, init),
    device: { open: async (...args) => {
      const core = await inner.open(...args);
      return { close: () => core.close(), call: async (request, ...rest) => {
        const reply = await core.call(request, ...rest);
        if (armed && request.op === 'query' && request.name === 'history') queries++;
        if (armed && request.op === 'state') routed = true;
        if (armed && routed && !held && request.op === 'queued') {
          held = true; entered.resolve(); await release.promise;
        }
        if (armed && request.op === 'apply') { apply = reply.ok; published = true; }
        return reply;
      } };
    } },
  });
  t.after(async () => { release.resolve(); await client.close(); });
  await client.sync();
  assert.equal((await f.post('/m/rename', { id: 'rename', args: {} })).state, 'sent');
  armed = true;
  const watch = client.observe(q('history'), { c: null }), seen = [];
  const stop = watch.subscribe(() => { const r = watch.getSnapshot(); if (published && r.data) seen.push(r); });
  t.after(() => { stop(); watch.close(); });
  await entered.promise;
  await client.sync();
  assert.equal(apply.published, true); assert.deepEqual(apply.touched, []);
  release.resolve();
  await until(() => watch.getSnapshot().data, 'rerouted history');
  assert.equal(watch.getSnapshot().complete, true, 'first post-catch-up publication uses the new route');
  assert.ok(queries >= 2, 'catch-up reevaluates the device route');
  assert.equal(watch.getSnapshot().data.length, 2);
  assert.ok(seen.every(r => r.complete), 'no provisional route chosen before catch-up publishes afterward');
});

for (const host of ['wasm', 'process']) test(`${host}: published empty footprint wakes a local retained watch`, { timeout: 30000 }, async t => {
  const f = await fixture(t, program.replace("  online only", "  update <- allow\n  online only") + "\nmutation rename():\n  update profiles['bob'] { name: 'Bob 2' }\n");
  let queries = 0;
  const inner = opener(host, join(f.dir, 'local-wakeup'));
  const client = await createLocalClient({ url: f.url, persona: 'bob',
    fetch: (url, init) => new URL(url).pathname === '/changes' ? parked(init.signal) : fetch(url, init),
    device: { open: async (...args) => {
      const core = await inner.open(...args);
      return { close: () => core.close(), call: async (r, ...rest) => {
        if (r.op === 'query' && r.name === 'history') queries++;
        return core.call(r, ...rest);
      } };
    } },
  });
  t.after(() => client.close()); await client.sync();
  await f.post('/m/remove', { id: 'leave', args: {} }); await client.sync();
  const watch = client.observe(q('history'), { c: null }), stop = watch.subscribe(() => {});
  t.after(() => { stop(); watch.close(); });
  await until(() => watch.getSnapshot().data?.length === 1, 'local retained history');
  const before = queries;
  await f.post('/m/rename', { id: 'rename', args: {} }); await client.sync();
  await until(() => queries > before, 'empty-footprint retained wakeup');
  assert.equal(watch.getSnapshot().data.length, 1);
});

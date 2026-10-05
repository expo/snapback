// @ref LLP 3000.028#3.3 — search cannot outrun the device retention cut.
import test from 'node:test';
import assert from 'node:assert/strict';
import { join } from 'node:path';
import { fixture, source, opener, q, until } from './helpers/answers-stay.mjs';
import { createLocalClient } from '../dist/local.js';
import { Pages } from '../dist/react-pages.js';
import { inspect } from '../dist/inspection.js';
const program = source.replace('table messages:', 'table messages:\n  immutable room').replace('  by byRoom: room, at, id', '  by byRoom: room, at, id\n  search body')
  .replace('  sync to members[.room]\ntable profiles:', '  retain delivered-history\n  sync to members[.room] last 1 by byRoom\ntable profiles:')
  + '\nquery search(q: text <=200, c: cursor ?):\n  return messages matching q last 50 by .at after c\n';
for (const host of ['wasm', 'process']) for (const cursor of [false, true]) test(`${host}: nonblank search while leave is held (cursor: ${cursor})`, {timeout:30000}, async t => {
  const f=await fixture(t,cursor ? program.replace('last 1 by byRoom','last 2 by byRoom').replace('last 50 by .at','last 1 by .at') : program);
  const schema=await (await fetch(f.url+'/schema',{headers:{'x-snapback-persona':'bob'}})).json();
  assert.ok(schema.schema.operations.search.search,'must exercise ordinarySearch');
  assert.equal((await f.post('/seed',[{table:'messages',row:{id:'older',room:'room',body:'image-0',at:0}}])).seeded,1);
  if(cursor) assert.equal((await f.post('/seed',[{table:'messages',row:{id:'newest',room:'room',body:'image-2',at:2}}])).seeded,1);
  const gate=Promise.withResolvers(); let hold=false,held=false,core,client,zeroSamples;
  const deliveries=[]; const inner=opener(host,join(f.dir,host));
  t.after(async()=>{hold=false;gate.resolve();await client?.close();});
  client=await createLocalClient({url:f.url,persona:'bob',waitSeconds:1,
    device:{open:async(...args)=>{core=await inner.open(...args);return {close:()=>core.close(),call:async(r,...rest)=>{
      if(hold&&r.op==='apply'&&r.page.events?.some(e=>e.kind==='scope')){held=true;await gate.promise;}
      return core.call(r,...rest);
    }}}},
    fetch:async(input,init)=>{
      const response=await fetch(input,init);
      if(hold&&new URL(input).pathname==='/q/search'){
        const reply=await response.clone().json();
        if(reply.data?.length===0&&zeroSamples===undefined){
          const state=(await core.call({op:'state'})).ok;
          assert.ok(reply.seq>state.watermark);
          zeroSamples=inspect(client).latency.samples;
          console.log(JSON.stringify({host,server:reply,deviceWatermark:state.watermark}));
        }
      }
      return response;
    }});
  await client.sync();
  const first = await client.query(q('search'),{q:'image',c:null});
  const args = {q:'image',c:cursor ? first.next : null};
  if(cursor) assert.ok(args.c);
  const watch=client.observe(q('search'),args);
  const stop=watch.subscribe(()=>{const r=watch.getSnapshot();if(r.data)deliveries.push({n:r.data.length,complete:r.complete,fresh:r.fresh});});
  t.after(()=>{stop();watch.close();});
  await until(()=>watch.getSnapshot().data?.length===(cursor ? 1 : 2),'initial search answer');
  inspect(client);hold=true;
  assert.equal((await f.post('/m/remove',{id:'remove',args:{}})).state,'sent');
  await until(()=>held,'leave apply held');
  const whileHeld=await client.query(q('search'),args);
  assert.notEqual(zeroSamples,undefined,'real server zero processed while device leave is held');
  const mounted=client.observe(q('search'),{q:'ima',c:null});
  const stopMounted=mounted.subscribe(()=>{}); t.after(()=>{stopMounted();mounted.close();});
  await until(()=>mounted.getSnapshot().data,'new mount before apply');
  const mountedHeld=mounted.getSnapshot();
  const pages=new Pages(client,q('search'),{q:'imag'});
  const stopPages=pages.subscribe(()=>{});t.after(stopPages);
  await until(()=>pages.getSnapshot().read.data,'new page chain before apply');
  const pageHeld=pages.getSnapshot().read;
  const bad=deliveries.some(r=>r.n===0);
  hold=false;gate.resolve();await client.sync();
  await until(()=>watch.getSnapshot().data?.length===1,'retained search after apply');
  console.log(JSON.stringify({host,cursor,deliveries,whileHeld:{...whileHeld,next:!!whileHeld.next},mountedHeld:{...mountedHeld,next:!!mountedHeld.next},afterRows:watch.getSnapshot().data.length}));
  // An old combined cursor's audience changed: it must withdraw and restart
  // the root, using the existing bounded one-shot refusal while apply is held.
  if(cursor) assert.equal(whileHeld.denied?.code,'E_QUERY_RETRY');
  for(const read of [...(cursor?[]:[whileHeld]),mountedHeld,pageHeld]) {
    assert.ok(read.data?.length>0, 'retained matches remain visible before apply');
    assert.equal(read.complete,false); assert.equal(read.fresh,false); assert.equal(read.next,null);
  }
  assert.ok(!(whileHeld.complete && whileHeld.fresh && whileHeld.data?.length===0), 'one-shot must not certify empty while retained routing is pending');
  assert.ok(!(mountedHeld.complete && mountedHeld.fresh && mountedHeld.data?.length===0), 'new watch must not certify empty before applying leave');
  assert.equal(bad,false,'ahead complete fresh empty search must not replace retained history');
});

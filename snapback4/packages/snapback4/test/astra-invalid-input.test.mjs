import { waitFor as awaitState } from './helpers/wait.mjs';
import test from 'node:test';
import assert from 'node:assert/strict';
import { setup, q, m, ids } from './helpers/astra-search.mjs';

test('every early query refusal carries coherent reader identity', async t => {
 const f=await setup(t), headers={'x-snapback-persona':'bob'};
 const schema=await fetch(`${f.url}/schema`,{headers}).then(r=>r.json());
 const probe=await fetch(`${f.url}/probe`,{headers}).then(r=>r.json());
 for(const [name,body] of [['search','{'],['search',JSON.stringify({args:{q:123}})],['search',JSON.stringify({args:{q:'coffee',extra:1}})],['absent','{}'],['leave','{}'],['search',JSON.stringify({args:{q:'coffee'},searchRetained:'invalid'})]]) {
   const reply=await fetch(`${f.url}/q/${name}`,{method:'POST',headers,body}).then(r=>r.json());
   assert.ok(reply.denied,JSON.stringify(reply)); assert.equal(reply.generation,schema.generation);
   assert.equal(reply.store_id,probe.store_id); assert.equal(reply.head,probe.seq);
 }
});
for(const tier of ['process','wasm']) test(`review invalid search input preserves server refusal ${tier}`,async t=>{
 const f=await setup(t,tier);await f.admin.mutate(m('join'),{room:'left'});await f.client.sync();
 const direct=await f.owner.query(q,{q:123});
 const local=await f.client.query(q,{q:123});
 console.log('INVALID',tier,JSON.stringify({direct,local,wire:f.requests.at(-1)?.json}));
 assert.equal(direct.denied?.code,'E_INPUT');assert.equal(local.denied?.code,'E_INPUT');
});

test('review invalid mounted search does not retry its permanent refusal',async t=>{
 const f=await setup(t);await f.admin.mutate(m('join'),{room:'left'});await f.client.sync();
 const before=f.requests.length,observed=f.client.observe(q,{q:123});const stop=observed.subscribe(()=>{});
 await awaitState(() => observed.getSnapshot().denied, "invalid input refusal");
 await new Promise(r=>setTimeout(r,200)); // Check that the permanent refusal does not retry.
 const read=observed.getSnapshot(),calls=f.requests.length-before;stop();observed.close();
 console.log('INVALID_WATCH',JSON.stringify({calls,read}));
 assert.equal(read.denied?.code,'E_INPUT');assert.equal(calls,1);
});

test('unauthenticated refusals do not disclose a store head or generation', async t=>{
 const f=await setup(t);
 for(const headers of [{},{authorization:'Bearer invalid'}]) {
  const reply=await fetch(`${f.url}/q/search`,{method:'POST',headers,body:'{"args":{"q":123}}'}).then(r=>r.json());
  assert.equal(reply.denied?.code,'E_AUTH');
  for(const key of ['store_id','head','generation']) assert.equal(reply[key],undefined,`unauthenticated ${key}`);
 }
});

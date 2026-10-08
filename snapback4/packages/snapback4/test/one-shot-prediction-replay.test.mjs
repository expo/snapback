// @ref LLP 3000.023#11 — Astra round-3 reproduction, retained at the final publication boundary.
import test from 'node:test';
import assert from 'node:assert/strict';
import { join } from 'node:path';
import { fixture, source, q, m, opener } from './helpers/answers-stay.mjs';
import { parkedChanges } from './helpers/sync-control.mjs';
import { createLocalClient } from '../dist/local.js';
import { guardClient } from '../dist/app-client.js';
const program=source.replace('  name: text\n  read <- allow\n  online only','  name: text <=200\n  update <- allow\n  read <- allow\n  sync')+`
mutation rename(name: text <=200):
  profile = profiles['bob']
  require profile != null else NO_PROFILE
  require profile.name != 'blocked' else BLOCKED
  update profiles['bob'] { name }
mutation blockRename(): server
  update profiles['bob'] { name: 'blocked' }
mutation copyName():
  profile = profiles['bob']
  require profile != null else NO_PROFILE
  update messages['item'] { body: profile.name }
`;
for(const tier of ['wasm','process']) test(`${tier}: failing unrelated write replays a dependent prediction before final facade publication`,{timeout:15000},async t=>{
 const f=await fixture(t,program);
 const post=Promise.withResolvers(), settled=Promise.withResolvers(), releaseSettle=Promise.withResolvers();
 let rawCore, firstId, hold=false, postOutcome, settlement;
 const device=opener(tier,join(f.dir,'device'));
 const client=await createLocalClient({url:f.url,persona:'bob',device:{async open(...args){
  rawCore=await device.open(...args);return {...rawCore,async call(request,committed){
   // Some process adapters return only a result; deliver that commit once before the artificial pause.
   let notified=false; const notify=result=>{if(!notified){notified=true;committed?.(result);}};
   const result=await rawCore.call(request,notify);notify(result);
   if(hold && request.op==='settle' && request.id===firstId){ settlement=result; settled.resolve(); await releaseSettle.promise; }
   return result;
  }};
 }},fetch:async(url,init)=>{
  const path=new URL(url).pathname;
  if(path==='/changes')return parkedChanges(init.signal);
  if(path==='/m/rename') await post.promise;
  if(path==='/m/copyName') await releaseSettle.promise;
  const response=await fetch(url,init);
  if(path==='/m/rename') postOutcome=await response.clone().json();
  return response;
 }});
 t.after(async()=>{post.resolve();releaseSettle.resolve();await client.close();});
 await client.sync();
 firstId=(await client.mutate(m('rename'),{name:'predicted-profile'},{waitSeconds:0})).id;
 const dependent=await client.mutate(m('copyName'),{},{waitSeconds:0});
 assert.equal((await client.query(q('item'),{})).data.body,'predicted-profile');
 let checks=0,atPublication;
 const facade=guardClient(client,async()=>{
  if(++checks===2){hold=true;assert.equal((await f.post('/m/blockRename',{id:'server-block',args:{}})).state,'sent');post.resolve();await settled.promise;
   atPublication=await rawCore.call({op:'query',name:'item',args:{},viewer:'dev:bob',now:Date.now()});
  }
  return true;
 },()=>true,()=>({code:'E_SCOPE',family:'client',message:'ended'})).client;
 const result=await facade.query(q('item'),{});
 console.log(JSON.stringify({tier,firstId,dependent,result,atPublication,postOutcome,checks}));
 assert.equal(postOutcome.state,'failed');assert.equal(postOutcome.why?.code,'BLOCKED');
 assert.equal(atPublication.ok?.data?.body,'Bob');
 assert.equal(settlement.settlement_unchanged,undefined,'the whole transaction changed the surviving prediction');
 assert.equal(result.complete,true);
 assert.equal(result.data?.body,'Bob','must retire the candidate when rollback/replay changes its rows');
 const unchanged = await rawCore.call({ op: 'settle', id: 'no-such-write' });
 assert.equal(unchanged.settlement_unchanged, undefined, 'even unchanged replay rows cannot certify unchanged overlay metadata');

});

for (const tier of ['wasm', 'process']) test(`${tier}: no-overlay settlement evidence belongs only to its successful transaction`, async t => {
 const f = await fixture(t, program); let core;
 const device = opener(tier, join(f.dir, 'device'));
 const client = await createLocalClient({ url: f.url, persona: 'bob',
  device: { async open(...args) { return core = await device.open(...args); } },
  fetch: (url, init) => new URL(url).pathname === '/changes' ? parkedChanges(init.signal) : fetch(url, init) });
 t.after(() => client.close()); await client.sync();
 const unchanged = await core.call({ op: 'settle', id: 'no-such-write' });
 assert.equal(unchanged.settlement_unchanged, true);
 const failed = await core.call({ op: 'settle', id: 'no-such-write', seq: 100 });
 assert.ok(failed.denied); assert.equal(failed.settlement_unchanged, undefined, 'a prior certificate cannot escape on failure');
});

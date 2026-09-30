import { readyRead } from "../dist/read-existence.js";
import test from 'node:test';
import assert from 'node:assert/strict';
import {setTimeout as delay} from 'node:timers/promises';
import {localDelivery} from '../dist/local-delivery.js';
import {publishDelivery} from '../dist/local-publication.js';
import {emptyDelivery} from '../dist/delivery-state.js';
import {webDevice,memoryPersistence} from '../dist/web.js';
import {backend,wasm,snapshot} from './helpers/delivery-fixture.mjs';
const binding=backend.schema.delivery[0];
const result={read:readyRead({data:[{body:'accepted'}],fresh:true,complete:true,cut:null}),delivery:[{...binding,rows:[['c1',43]]}]};
const until=async fn=>{for(let i=0;i<200;i++){if(await fn())return;await delay(5);}assert.fail('collection did not settle');};
function environment(call,collect){return {viewer:'dev:alice',url:'http://x',call,collect,backend:()=>backend,ready:()=>false,current:()=>true,
 credentials:()=>({headers:{},revision:0}),refresh:()=>null,capture:async()=>undefined,witness:async()=>false,restored:()=>false,replaced:()=>{},auth:async()=>{},now:()=>100,fetch:()=>{throw Error('dispatch is disabled');}};}
for(const fence of ['authority','credential','incarnation'])test(`every losing collection CAS rechecks ${fence} without unaccepting the answer`,async t=>{
 let value=JSON.stringify(emptyDelivery()),published=0,writes=0,reads=0;
 const revision={authority:1,credential:1,incarnation:1};
 const q=localDelivery(environment(async request=>{
  if(request.op==='set_meta')return {ok:null};
  if(request.action==='read'){reads++;return {ok:{value}};}
  if(request.action==='write'){if(request.expected!==value)return {ok:false};value=request.value;return {ok:true};}
  throw Error(JSON.stringify(request));
 },async (request,current)=>{
  assert.equal(current(),true,'first write passed the final fence');writes++;
  if(writes===1){revision[fence]++;return {ok:false};}
  if(!current())return {ok:true};value=request.value;return {ok:true};
 }));t.after(()=>q.stop());await q.open();
 const before=reads;
 let collection;const accepted=publishDelivery({accept(...args){return collection=q.accept(...args);}},result,()=>revision[fence]===1,()=>{published++;return true;});
 assert.equal(accepted,true);assert.equal(published,1);
 await collection;assert.ok(reads>=before+2);
 assert.deepEqual(JSON.parse(value).groups,{});assert.equal(writes,1,'stale retry writes nothing');assert.equal(published,1);
});
test('a device Left publication wins the acceptance CAS and the retry never recreates its debt',async t=>{
 const core=await webDevice({wasm,persist:memoryPersistence()}).open('left-cas',backend);t.after(()=>core.close());
 let authority=1,published=0,lost=false;
 const q=localDelivery(environment(request=>core.call(request),async request=>{
  if(!lost){
   const reply=await core.call({op:'apply',first:false,page:{snapshot:false,watermark:2,more:false,events:[{table:'messages',kind:'scope',id:'left',data:['c1']}]}});
   assert.ok(!reply.denied,JSON.stringify(reply));authority++;
   const cas=await core.call(request);assert.equal(cas.ok,false,'the actual device CAS loses to Left');lost=true;return cas;
  }
  return core.call(request);
 }));t.after(()=>q.stop());await q.open();await core.call(snapshot);
 let collection;assert.equal(publishDelivery({accept(...args){return collection=q.accept(...args);}},result,()=>authority===1,()=>{published++;return true;}),true);
 await collection;assert.equal(lost,true);
 const raw=await core.call({op:'delivery',viewer:'dev:alice',action:'read'});
 assert.deepEqual(JSON.parse(raw.ok.value).groups,{});assert.equal(published,1);
});

test('an answer rejected at its final fence neither publishes nor starts collection',()=>{
 let published=0,collected=0;
 assert.equal(publishDelivery({accept(){collected++;return Promise.resolve();}},result,()=>false,()=>{published++;return true;}),false);
 assert.equal(published,0);assert.equal(collected,0);
});

test('a host without conditional commit under-reports an accepted manifest',async t=>{
 let value=JSON.stringify(emptyDelivery()),writes=0,collection;
 const q=localDelivery(environment(async request=>{
  if(request.op==='set_meta')return {ok:null};
  if(request.action==='read')return {ok:{value}};
  if(request.action==='write'){writes++;value=request.value;return {ok:true};}
  throw Error(JSON.stringify(request));
 },undefined));t.after(()=>q.stop());await q.open();const before=writes;
 assert.equal(publishDelivery({accept(...args){return collection=q.accept(...args);}},result,()=>true,()=>true),true);
 await collection;assert.equal(writes,before);assert.deepEqual(JSON.parse(value).groups,{});
});

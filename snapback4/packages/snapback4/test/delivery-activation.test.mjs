import { waitFor as awaitState } from './helpers/wait.mjs';
import test from 'node:test';
import assert from 'node:assert/strict';
import {setTimeout as delay} from 'node:timers/promises';
import {localDelivery} from '../dist/local-delivery.js';
import {acceptManifest,emptyDelivery} from '../dist/delivery-state.js';
const binding={table:'messages',mutation:'delivered',args:['conversation','from','through'],fingerprint:'fixture:messages'};
const manifest=rows=>[{...binding,rows}];
const until=async fn=>{ return awaitState(fn); };
function fixture(t,{enumerate=()=>({more:false}),fetch=async()=>Response.json({state:'sent',head:10,store_id:'S'})}={}){
 const initial=emptyDelivery();acceptManifest(initial,manifest([['persisted',1]]),4096);
 let value=JSON.stringify(initial),ready=false,cursor=0;
 const events=[];
 const q=localDelivery({viewer:'bob',url:'http://x',backend:()=>({schema:{delivery:[binding]}}),
  ready:()=>ready,current:()=>true,credentials:()=>({headers:{},revision:0}),refresh:()=>null,
  capture:async()=>({watermark:10,send_revision:0,store_id:'S'}),witness:async()=>false,restored:()=>false,replaced:()=>{},auth:async()=>{},now:()=>100,
  fetch:async(...args)=>{events.push('send');return fetch(...args);},
  collect:async(r,current)=>{if(!current())return {ok:true};if(r.expected!==value)return {ok:false};value=r.value;return {ok:true};},
  call:async r=>{
   if(r.op==='set_meta')return {ok:null};
   if(r.action==='read')return {ok:{value}};
   if(r.action==='write'){if(r.expected!==value)return {ok:false};value=r.value;return {ok:true};}
   if(r.action==='enumerate'){events.push('enumerate');const reply=enumerate(cursor,JSON.parse(value));cursor++;return {ok:reply};}
   throw Error(JSON.stringify(r));
  }});t.after(()=>q.stop());
 return {q,events,get cursor(){return cursor;},ready(){ready=true;q.available();},state:()=>JSON.parse(value)};
}
test('activation waits for startup witnessing and for persisted debt to finish flushing',async t=>{
 let complete;
 const h=fixture(t,{fetch:()=>new Promise(resolve=>{complete=()=>resolve(Response.json({state:'sent',head:10,store_id:'S'}));})});
 await h.q.open();await delay(30);assert.deepEqual(h.events,[]);
 h.ready();await until(()=>complete);await delay(30);assert.deepEqual(h.events,['send']);
 complete();await until(()=>h.cursor===1);assert.deepEqual(h.events,['send','enumerate']);
});
test('activation retries a failed page from the persisted cursor with bounded backoff until done',async t=>{
 let failed=false;const cursors=[];
 const h=fixture(t,{enumerate:cursor=>{cursors.push(cursor);if(cursor===1&&!failed){failed=true;throw Error('one failed save');}return {more:cursor<2};}});
 await h.q.open();h.ready();await until(()=>h.cursor===3);
 assert.deepEqual(cursors,[0,1,1,2]);await delay(40);assert.equal(cursors.length,4);
});

test('activation completes while a live group is replenished before every report settles',async t=>{
 const responses=[];
 const h=fixture(t,{fetch:()=>new Promise(resolve=>responses.push(()=>resolve(Response.json({state:'sent',head:10,store_id:'S'}))))});
 await h.q.open();h.ready();await until(()=>responses.length===1);
 await h.q.accept(manifest([['live',1]]));responses[0]();
 for(let n=1;n<=12&&h.cursor===0;n++){
  await until(()=>responses.length>n);
  await h.q.accept(manifest([['live',n+1]]));responses[n]();
  await delay(15);
 }
 assert.equal(h.cursor,1,'new traffic must not extend the startup barrier');
 assert.ok(Object.values(h.state().groups).some(g=>g.group==='live'&&g.owed.length));
});

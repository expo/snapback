import test from 'node:test';
import assert from 'node:assert/strict';
import {setTimeout as delay} from 'node:timers/promises';
import {createClient} from '../dist/client.js';
import {onlineDelivery} from '../dist/online-delivery.js';
import {localDelivery} from '../dist/local-delivery.js';
const binding={table:'messages',mutation:'delivered',args:['conversation','from','through']};
const manifest=rows=>[{...binding,rows}];
const blocked=signal=>new Promise((_,reject)=>{if(signal.aborted)reject(Error('closed'));else signal.addEventListener('abort',()=>reject(Error('closed')),{once:true});});
const until=async fn=>{for(let i=0;i<300;i++){if(fn())return;await delay(5);}assert.fail('delivery did not settle');};
test('online home-screen manifest sends exact positions without an application mutate',async t=>{
 const calls=[];const client=createClient({url:'http://delivery.test',persona:'bob',fetch:async(url,init)=>{
  if(url.includes('/changes'))return blocked(init.signal);
  if(url.endsWith('/probe'))return Response.json({ok:true,viewer:'dev:bob',store_id:'S',seq:10});
  if(url.includes('/m/')){calls.push(JSON.parse(init.body));return Response.json({state:'sent',head:10,seq:10,store_id:'S'});}
  return Response.json({data:{lastMessage:{text:'last'}},complete:true,tables:['messages'],seq:10,store_id:'S',delivery:manifest([['c',41]])});
 }});t.after(()=>client.close());
 const writes=[];client.onWrite(w=>writes.push(w));const read=await client.query({kind:'query',name:'inbox'},{});assert.equal(read.data.lastMessage.text,'last');
 await until(()=>calls.length===1);assert.deepEqual(calls[0].args,{conversation:'c',from:41,through:41});assert.equal(calls[0].store_id,'S');assert.deepEqual(writes,[]);
});
test('online calls judge out-of-order heads against their own dispatch floors',async t=>{
 const responses=[];let floor=10,current=true;const observations=[];
 const q=onlineDelivery({url:'http://x',fetch:async()=>new Promise(resolve=>responses.push(resolve)),mint:()=>String(responses.length),ready:()=>current,current:()=>current,headers:()=>({}),revision:()=>0,floor:()=>floor,store:()=> 'S',refresh:()=>null,obsolete:async()=>false,
  observe:(json,at)=>{observations.push(at);if(json.head<at)current=false;floor=Math.max(floor,json.head);}});t.after(()=>q.stop());
 await q.accept(manifest([['a',1],['b',1]]));await q.pump();responses[1](Response.json({state:'sent',head:20,seq:20,store_id:'S'}));await delay(5);responses[0](Response.json({state:'sent',head:10,seq:10,store_id:'S'}));await delay(5);assert.equal(current,true);assert.deepEqual(observations,[10,10]);
});
test('local acceptance persists before dispatch, waits for witness and idle outbox, and fences restore',async t=>{
 let value=JSON.stringify({serial:0,groups:{},retired:{}}),witness=false,busy=true,restored=false;const calls=[];
 const call=async request=>{
  if(request.op==='meta')return {ok:'1'};if(request.op==='set_meta')return {ok:null};
  if(request.action==='clear'){value=JSON.stringify({serial:0,groups:{},retired:{}});return {ok:null};}
  if(request.action==='write'){if(request.expected!==value)return {ok:false};value=request.value;return {ok:true};}
  return {ok:{value,more:false}};
 };
 const q=localDelivery({viewer:'bob',url:'http://x',call,backend:()=>null,ready:()=>witness&&!busy&&!restored,current:()=>!restored,credentials:()=>({headers:{},revision:0}),refresh:()=>null,capture:async()=>({watermark:10,send_revision:0,store_id:'S'}),
  witness:async(_id,head)=>{restored=head<10;return restored;},restored:()=>restored,replaced:()=>{},auth:async()=>{},now:()=>100,
  fetch:async(_url,init)=>{calls.push(JSON.parse(init.body));assert.ok(Object.values(JSON.parse(value).groups)[0].attempt,'attempt persisted before network');return Response.json({state:'sent',seq:1,head:1,store_id:'S'});}});
 t.after(()=>q.stop());await q.accept(manifest([['c',41]]));assert.deepEqual(Object.values(JSON.parse(value).groups)[0].owed,[[41,41]]);await delay(270);assert.equal(calls.length,0);
 witness=true;q.available();await delay(10);assert.equal(calls.length,0);busy=false;q.available();await until(()=>restored);await until(()=>Object.keys(JSON.parse(value).groups).length===0);assert.equal(calls.length,1);
});
test('online sign-out clears the viewer immediately while giving an active report its bounded drain',async t=>{
 let finish,signal;
 const client=createClient({url:'http://delivery.test',persona:'bob',fetch:async(url,init)=>{
  if(url.includes('/changes'))return blocked(init.signal);
  if(url.endsWith('/probe'))return Response.json({ok:true,viewer:'dev:bob',store_id:'S',seq:10});
  if(url.includes('/m/')){signal=init.signal;return new Promise(resolve=>{finish=()=>resolve(Response.json({state:'sent',head:10,seq:10,store_id:'S'}));});}
  return Response.json({data:{text:'last'},complete:true,tables:['messages'],seq:10,store_id:'S',delivery:manifest([['c',41]])});
 }});t.after(()=>client.close());
 await client.query({kind:'query',name:'inbox'},{});await until(()=>signal);
 const ending=client.signOut();assert.equal(client.viewer(),null);assert.equal(client.link(),'signed-out');
 await delay(20);assert.equal(signal.aborted,false,'drain does not abort the report at sign-out');
 finish();await ending;assert.equal(client.viewer(),null);
});

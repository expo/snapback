import test from 'node:test';
import assert from 'node:assert/strict';
import {setTimeout as delay} from 'node:timers/promises';
import {createLocalClient} from '../dist/local.js';
import {webDevice,memoryPersistence} from '../dist/web.js';
import {wasm} from './helpers/delivery-fixture.mjs';
import {server,until} from './helpers/app-server.mjs';
const binding={table:'messages',group:'room',position:'ordinal',mutation:'delivered',args:['conversation','from','through'],fingerprint:'fixture:messages'};
const manifest=n=>[{...binding,rows:[['c',n]]}];
const op={kind:'query',name:'fallback'};
const gate=()=>{let resolve;const promise=new Promise(r=>resolve=r);return {promise,resolve};};
const source=`use personas alice
table messages:
  room: text <=100
  ordinal: int
  text: text <=100
  unique room, ordinal
  read <- allow
  insert <- allow
query fallback():
  return messages first 20 by .id
mutation add():
  insert messages {room: 'c', ordinal: 41, text: 'delivered image'}
`;
async function fixture(t){
 const {url}=await server(t,'',source);
 const memory=memoryPersistence(),saved=[],reports=[];let saveGate,readGate,failSave=false,core,queryCount=0,onQuery=()=>{},client,offlineOnce=false;
 const persist={...memory,async save(name,changes){
  const collected=changes.some(c=>c.s==='m'&&c.k.startsWith('device:delivery:')&&c.v&&Object.values(JSON.parse(c.v).groups).some(g=>g.owed.length));
  if(collected){saved.push(changes);if(saveGate)await saveGate.promise;if(failSave){failSave=false;throw Error('failed delivery save');}}
  return memory.save(name,changes);
 }};
 const underlying=webDevice({wasm,persist});
 client=await createLocalClient({url,persona:'alice',waitSeconds:1,device:{async open(...args){core=await underlying.open(...args);return {...core,async call(request,...rest){
  if(request.op==='delivery'&&request.action==='read'&&readGate)await readGate.promise;
  return core.call(request,...rest);
 }}}},fetch:async(input,init)=>{
  const path=new URL(input).pathname;
  if(path==='/schema'){const b=await fetch(input,init).then(r=>r.json());b.schema.delivery=[binding];return Response.json(b);}
  if(path==='/q/fallback'){const json=await fetch(input,init).then(r=>r.json());json.delivery=manifest(41);queryCount++;onQuery(json,queryCount);return Response.json(json);}
  if(path==='/m/delivered'){reports.push(JSON.parse(init.body));if(offlineOnce){if(reports.length===1)return Response.json({denied:{code:'E_OFFLINE'}});const head=await fetch(`${url}/probe`,{headers:init.headers}).then(r=>r.json());return Response.json({state:'sent',head:head.seq,store_id:head.store_id});}return new Promise((_,reject)=>init.signal.addEventListener('abort',()=>reject(Error('closed')),{once:true}));}
  return fetch(input,init);
 }});t.after(async()=>{saveGate?.resolve();readGate?.resolve();await client.close();});
 await client.sync();
 // Insert after activation, into an online-only table. Only fallback can collect it.
 await fetch(`${url}/m/add`,{method:'POST',headers:{'content-type':'application/json','x-snapback-persona':'alice'},body:JSON.stringify({id:'00000000000000000000000001',args:{}})});
 await client.sync();
 return {client,memory,saved,reports,get queries(){return queryCount;},offlineOnce(){offlineOnce=true;},holdSave(){return saveGate=gate();},holdRead(){return readGate=gate();},fail(){failSave=true;},onQuery(fn){onQuery=fn;},
  debt(){return [...memory.stores.values()].flatMap(store=>[...store.values()]).filter(c=>c.s==='m'&&c.k.startsWith('device:delivery:')&&c.v).flatMap(c=>Object.values(JSON.parse(c.v).groups));}};
}
test('real local fallback persists manifest debt before the query returns',async t=>{
 const h=await fixture(t);const read=await h.client.query(op,{});assert.equal(read.data[0].text,'delivered image');
 assert.deepEqual(h.debt().map(g=>g.owed),[[[41,41]]]);
});
test('a delayed local save is awaited without moving publication after persistence',async t=>{
 const h=await fixture(t),hold=h.holdSave();let settled=false;
 const read=h.client.query(op,{}).then(r=>{settled=true;return r;});await until(()=>h.saved.length);assert.equal(settled,false);
 hold.resolve();assert.equal((await read).data[0].ordinal,41);assert.deepEqual(h.debt().map(g=>g.owed),[[[41,41]]]);
});
test('a failed manifest save leaves the successful local fallback answer intact',async t=>{
 const h=await fixture(t);h.fail();const read=await h.client.query(op,{});assert.equal(read.data[0].ordinal,41);assert.deepEqual(h.debt(),[]);
});
for(const change of ['commit','credential','expiry'])test(`local fallback rejects its manifest when ${change} changes before acceptance`,async t=>{
 const h=await fixture(t);let held;
 h.onQuery((json,n)=>{if(n===1){held=h.holdRead();if(change==='expiry')json.nextExpiry=Date.now()+100;}else json.delivery=[];});
 const read=h.client.query(op,{});await until(()=>held);await delay(20);
 let ending;
 if(change==='commit')await h.client.sync();
 if(change==='credential')ending=h.client.signOut();
 if(change==='expiry')await delay(120);
 held.resolve();const result=await read;await ending;
 if(change==='credential')assert.equal(result.denied.code,'E_CLOSED');else assert.ok('data' in result);
 assert.deepEqual(h.debt(),[]);assert.deepEqual(h.reports,[]);
});
test('a query below its local restore floor creates no delivery debt',async t=>{
 const h=await fixture(t);h.onQuery(json=>{json.seq=0;json.head=0;});
 const read=await h.client.query(op,{});assert.equal(read.denied.code,'E_STORE_RESTORE');assert.deepEqual(h.debt(),[]);assert.deepEqual(h.reports,[]);
});
test('a watch publishes before a delayed save, and expiry cannot resurrect that answer',async t=>{
 const h=await fixture(t),hold=h.holdSave();let first=true;
 h.onQuery(json=>{if(first){first=false;json.nextExpiry=Date.now()+150;}else {json.data=[];json.delivery=[];}});
 const watch=h.client.observe(op,{});t.after(watch.subscribe(()=>{}));await until(()=>h.saved.length);
 assert.equal(watch.getSnapshot().data[0].ordinal,41,'acceptance already published the answer');
 await delay(200);assert.ok(!('data' in watch.getSnapshot())||watch.getSnapshot().data.length===0);
 hold.resolve();await until(()=>('data' in watch.getSnapshot())&&watch.getSnapshot().data.length===0);
});

test('local E_OFFLINE reconnects through the existing link path and retains its attempt id',async t=>{
 const h=await fixture(t);h.offlineOnce();const links=[];h.client.onLink(link=>links.push(link));
 await h.client.query(op,{});await until(()=>h.reports.length===2);
 assert.ok(links.includes('offline'));assert.ok(links.includes('online'));
 assert.equal(h.reports[0].id,h.reports[1].id);
});
test('a credential change during save withdraws an already accepted watch without republishing it',async t=>{
 const h=await fixture(t),hold=h.holdSave();const watch=h.client.observe(op,{});t.after(watch.subscribe(()=>{}));
 await until(()=>h.saved.length);assert.equal(watch.getSnapshot().data[0].ordinal,41);
 const ending=h.client.signOut();assert.ok('denied' in watch.getSnapshot());hold.resolve();await ending;
 assert.ok('denied' in watch.getSnapshot());assert.deepEqual(h.reports,[]);
});

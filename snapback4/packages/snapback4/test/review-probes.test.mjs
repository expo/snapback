// @ref LLP 3000.028#7.2 — real server/device source traversal and delivery races.
import test from 'node:test';
import assert from 'node:assert/strict';
import { join } from 'node:path';
import { readFileSync } from 'node:fs';
import { createClient } from '../dist/client.js';
import { createLocalClient } from '../dist/local.js';
import { processDevice } from '../dist/native.js';
import { webDevice, memoryPersistence } from '../dist/web.js';
import { binary, server, until } from './helpers/app-server.mjs';
import { Pages } from '../dist/react-pages.js';
import { parkedChanges } from './helpers/sync-control.mjs';

const source = `use personas alice, bob
table members:
  room: id
  principal: principal
  unique room, principal
  read <- exists members[.room, viewer]
  insert <- exists members[.room, viewer]
  delete <- true
  sync to members[.room]
table messages:
  room: id
  text: text <=200
  at: time
  tombstone: bool
  expires: time ?
  expire at .expires
  search text
  read <- exists members[.room, viewer]
  insert <- true
  update <- true
  sync to members[.room] last 100 by .at
  retain delivered-history
query search(q: text <=100, c: cursor ?):
  return messages matching q where not .tombstone last 20 by .at after c
query searchChat(room: id, q: text <=100, c: cursor ?):
  return messages[room = room] matching q where not .tombstone last 20 by .at after c
mutation leave(room: id):
  delete members[room, viewer]
mutation join(room: id):
  insert members { room, principal: 'dev:bob' }
mutation edit(id: messages, text: text <=200):
  update messages[id] { text }
`;
const q = { kind: 'query', name: 'search' };
const m = name => ({ kind: 'mutation', name });
const ids = read => { assert.ok(Array.isArray(read.data), JSON.stringify(read)); return read.data.map(r => r.id); };
const gate = () => { let resolve; const promise = new Promise(r => resolve = r); return { promise, resolve }; };
const decode = c => JSON.parse(Buffer.from(c.slice(5), 'base64url'));
async function setup(t, tier = 'process', expires = null) {
  const {url, dir} = await server(t, '', source);
  const backend=await fetch(`${url}/schema`,{headers:{"x-snapback-persona":"bob"}}).then(r=>r.json());
  assert.ok(backend.schema.operations.search.search, JSON.stringify({fact:backend.schema.operations.search,program:backend.programs.find(p=>p.name==='search'),indexes:backend.schema.tables.messages.indexes}));
  const owner = createClient({url, persona: 'bob'}), admin = createClient({url, persona: 'alice'});
  const rows = [{table:'members',id:'ml',room:'live',principal:'dev:bob'}, {table:'members',id:'mr',room:'left',principal:'dev:bob'}];
  rows.push({table:'members',id:'al',room:'live',principal:'dev:alice'}, {table:'members',id:'ar',room:'left',principal:'dev:alice'});
  // Timestamp ties cross the two sources. 20 retained rows strictly dominate
  // page one; the remaining rows alternate in the oracle's full-key order.
  for (let i=0;i<65;i++) rows.push({table:'messages', id:i===43?'\ue00043':i===44?'\u{10000}44':`m${String(i).padStart(3,'0')}`, room:i>=45||i%2?'left':'live', text:'coffee',at:1000+(i===43?44:i),tombstone:false,expires:i===64?expires:null});
  assert.equal((await fetch(`${url}/seed`, {method:'POST',body:JSON.stringify(rows.map(({table,...row})=>({table,row})))}).then(r=>r.json())).seeded, rows.length);
  let offline=false, hold, core;
  const requests=[], scans=[], states=[];
  const persist=memoryPersistence();
  const opener = tier==='wasm' ? webDevice({wasm:readFileSync(new URL('../src/wasm/snapback4_device_bg.wasm',import.meta.url)),persist}) : processDevice({binary,dir:join(dir,'device')});
  const options = {url,persona:'bob',device:{async open(...args){core=await opener.open(...args);return {...core, async call(req,...rest){const result=await core.call(req,...rest); if(req.op==='query') scans.push({request:req,result});if(req.op==='search_state')states.push(result);return result;}}}},fetch:async(input,init)=>{
    if(offline) throw new TypeError('offline');
    const path=new URL(input).pathname;
    if(path==='/changes') return parkedChanges(init.signal);
    if(path.startsWith('/q/')) {
      const response=await fetch(input,init);requests.push({body:JSON.parse(init.body),json:await response.clone().json()});
      if(hold){const current=hold;hold=null;current.arrived.resolve();await current.release.promise;}
      return response;
    }
    return fetch(input,init);
  }};
  let client = await createLocalClient(options);
  t.after(async()=>{hold?.release.resolve();await client.close();await owner.close();await admin.close();});
  await client.sync();
  assert.equal((await owner.mutate(m('leave'),{room:'left'})).state,'sent');
  await client.sync();
  return {url,dir,get client(){return client;},owner,admin,requests,scans,states,rows:rows.filter(r=>r.table==='messages'),core:()=>core,
    async network(on){offline=!on;await client.sync();},
    async reopen(){await client.close();client=await createLocalClient(options);await client.sync();},
    hold(){const value={arrived:gate(),release:gate()};hold=value;return value;}};
}

async function finishTraversal(f,first,second) {
  const all=[...ids(first),...ids(second)];let c=second.next;
  for(let n=0;c&&n<10;n++) {
    const before=f.requests.length,read=await f.client.query(q,{q:'coffee',c});
    assert.equal(f.requests.length-before,1);all.push(...ids(read));c=read.next;
  }
  assert.equal(c,null);assert.deepEqual(all,[...f.rows].reverse().map(r=>r.id));
  assert.equal(new Set(all).size,65);
}

for(const tier of ['process','wasm']) test(`review: unrelated sync preserves continuation ${tier}`,async t=>{
  const f=await setup(t,tier);
  const first=await f.client.query(q,{q:'coffee'});
  assert.equal((await f.admin.mutate(m('edit'),{id:'m000',text:'coffee unchanged-order'})).state,'sent');
  await f.client.sync();
  const before=f.requests.length;
  const second=await f.client.query(q,{q:'coffee',c:first.next});
  assert.equal(f.requests.length-before,1);
  assert.equal(ids(second).some(id=>ids(first).includes(id)),false,'no repeated rows on unrelated sync');
  assert.equal(decode(first.next).epoch,decode(second.next).epoch);
  await finishTraversal(f,first,second);
});

for(const tier of ['process','wasm']) test(`review: new unsynced membership invalidates continuation ${tier}`,async t=>{
  const f=await setup(t,tier);
  await f.admin.mutate(m('join'),{room:'left'});await f.client.sync();
  const first=await f.client.query(q,{q:'coffee'});
  const rows=[{table:'members',row:{id:'newmember',room:'newroom',principal:'dev:bob'}},{table:'messages',row:{id:'newmessage',room:'newroom',text:'coffee',at:2000,tombstone:false,expires:null}}];
  assert.equal((await fetch(`${f.url}/seed`,{method:'POST',body:JSON.stringify(rows)}).then(r=>r.json())).seeded,2);
  const before=f.requests.length;
  const second=await f.client.query(q,{q:'coffee',c:first.next});
  assert.equal(f.requests.length-before,1);
  assert.deepEqual(second,{loading:true},'changed membership withdraws the stale suffix');
  const fresh=await f.client.query(q,{q:'coffee'});
  assert.equal(ids(fresh)[0],'newmessage');
  assert.notEqual(decode(fresh.next).audience,decode(first.next).audience);
});

for(const tier of ['process','wasm']) test(`review: hidden write sync preserves continuation ${tier}`,async t=>{
  const f=await setup(t,tier);
  const first=await f.client.query(q,{q:'coffee'});
  const rows=[{table:'messages',row:{id:'hiddenmessage',room:'never-readable',text:'coffee',at:2000,tombstone:false,expires:null}}];
  assert.equal((await fetch(`${f.url}/seed`,{method:'POST',body:JSON.stringify(rows)}).then(r=>r.json())).seeded,1);
  await f.client.sync();
  const before=f.requests.length;
  const second=await f.client.query(q,{q:'coffee',c:first.next});
  assert.equal(f.requests.length-before,1);
  assert.equal(ids(second).some(id=>ids(first).includes(id)),false,'hidden writes cannot repeat the first page');
  assert.equal(decode(first.next).epoch,decode(second.next).epoch);
  await finishTraversal(f,first,second);
});

for(const tier of ['process','wasm']) test(`review: hidden sync during delivery withdraws the page ${tier}`,async t=>{
  const f=await setup(t,tier),first=await f.client.query(q,{q:'coffee'});
  const epoch=decode(first.next).epoch,g=f.hold(),before=f.requests.length;
  const pending=f.client.query(q,{q:'coffee',c:first.next});await g.arrived.promise;
  await fetch(`${f.url}/seed`,{method:'POST',body:JSON.stringify([{table:'messages',row:{id:'hidden',room:'never-readable',text:'coffee',at:2000,tombstone:false,expires:null}}])});
  await f.client.sync();g.release.resolve();
  assert.deepEqual(await pending,{loading:true});assert.equal(f.requests.length-before,1);
  const after=await f.client.query(q,{q:'coffee',c:first.next});
  assert.equal(decode(after.next).epoch,epoch);
  assert.equal(ids(after).some(id=>ids(first).includes(id)),false);
});

for(const tier of ['process','wasm']) test(`review: unsynced audience change refreshes the live page chain ${tier}`,async t=>{
  const f=await setup(t,tier);
  await f.admin.mutate(m('join'),{room:'left'});await f.client.sync();
  const pages=new Pages(f.client,q,{q:'coffee'}),snapshots=[];
  const stop=pages.subscribe(()=>snapshots.push(pages.getSnapshot()));t.after(stop);
  await until(()=>pages.getSnapshot().items.length===20,'first page');
  const old=pages.getSnapshot().read.next,before=f.requests.length;
  assert.ok(decode(old).audience);
  const rows=[{table:'members',row:{id:'newmember',room:'newroom',principal:'dev:bob'}},{table:'messages',row:{id:'newmessage',room:'newroom',text:'coffee',at:2000,tombstone:false,expires:null}}];
  assert.equal((await fetch(`${f.url}/seed`,{method:'POST',body:JSON.stringify(rows)}).then(r=>r.json())).seeded,2);
  pages.loadMore();
  await until(()=>pages.getSnapshot().items.length===40&&pages.getSnapshot().items[0]?.id==='newmessage','root and suffix restarted without sync');
  const current=pages.getSnapshot();
  assert.equal(new Set(current.items.map(r=>r.id)).size,40);
  assert.equal(f.requests.length-before,3,'one stale suffix, one fresh root and one fresh suffix');
  assert.equal(f.requests.slice(before).filter(r=>r.body.args.c===decode(old).server).length,1,'stale continuation was invoked once');
  assert.ok(snapshots.some(s=>s.read.loading),'the stale chain was withdrawn');
});

for(const tier of ['process','wasm']) test(`review: unsynced audience loss also withdraws the continuation ${tier}`,async t=>{
  const f=await setup(t,tier);
  await f.admin.mutate(m('join'),{room:'left'});await f.client.sync();
  const first=await f.client.query(q,{q:'coffee'});
  assert.equal((await f.owner.mutate(m('leave'),{room:'live'})).state,'sent');
  const before=f.requests.length,second=await f.client.query(q,{q:'coffee',c:first.next});
  assert.equal(f.requests.length-before,1);assert.deepEqual(second,{loading:true});
  const fresh=await f.client.query(q,{q:'coffee'});
  assert.ok(fresh.data.every(row=>row.room==='left'));
  assert.notEqual(decode(first.next).audience,decode(fresh.next).audience);
});

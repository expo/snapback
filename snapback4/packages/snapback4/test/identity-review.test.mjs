// @ref LLP 3000.028#7.2 — real server/device source traversal and delivery races.
import test from 'node:test';
import assert from 'node:assert/strict';
import { join } from 'node:path';
import { readFileSync, writeFileSync } from 'node:fs';
import { createClient } from '../dist/client.js';
import { createLocalClient } from '../dist/local.js';
import { processDevice } from '../dist/native.js';
import { webDevice, memoryPersistence } from '../dist/web.js';
import { binary, server, until } from './helpers/app-server.mjs';
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
  immutable room
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
mutation move(id: messages, text: text <=200, at: time):
  update messages[id] { text, at }
`;
const q = { kind: 'query', name: 'search' };
const m = name => ({ kind: 'mutation', name });
const ids = read => { assert.ok(Array.isArray(read.data), JSON.stringify(read)); return read.data.map(r => r.id); };
const gate = () => { let resolve; const promise = new Promise(r => resolve = r); return { promise, resolve }; };
const decode = c => JSON.parse(Buffer.from(c.slice(5), 'base64url'));
async function setup(t, tier = 'process', expires = null, options = {}) {
  const {url, dir} = await server(t, '', options.whole ? source.replace('sync to members[.room] last 100 by .at', 'sync to members[.room]') : source, {watch:true});
  const backend=await fetch(`${url}/schema`,{headers:{"x-snapback-persona":"bob"}}).then(r=>r.json());
  assert.ok(backend.schema.operations.search.search, JSON.stringify({fact:backend.schema.operations.search,program:backend.programs.find(p=>p.name==='search'),indexes:backend.schema.tables.messages.indexes}));
  const owner = createClient({url, persona: 'bob'}), admin = createClient({url, persona: 'alice'});
  const rows = [{table:'members',id:'ml',room:'live',principal:'dev:bob'}, {table:'members',id:'mr',room:'left',principal:'dev:bob'}];
  rows.push({table:'members',id:'al',room:'live',principal:'dev:alice'}, {table:'members',id:'ar',room:'left',principal:'dev:alice'});
  // Timestamp ties cross the two sources. 20 retained rows strictly dominate
  // page one; the remaining rows alternate in the oracle's full-key order.
  if (options.messages) rows.push(...options.messages.map(row=>({table:'messages',tombstone:false,expires:null,...row})));
  else for (let i=0;i<65;i++) rows.push({table:'messages', id:i===43?'\ue00043':i===44?'\u{10000}44':`m${String(i).padStart(3,'0')}`, room:i>=45||i%2?'left':'live', text:'coffee',at:1000+(i===43?44:i),tombstone:false,expires:i===64?expires:null});
  for (let start=0;start<rows.length;start+=200) {
    const batch=rows.slice(start,start+200).map(({table,...row})=>({table,row}));
    const seeded=await fetch(`${url}/seed`, {method:'POST',body:JSON.stringify(batch)}).then(r=>r.json());
    assert.equal(seeded.seeded,batch.length,JSON.stringify(seeded));
  }
  let offline=false, hold, core, queryUrl;
  const requests=[], scans=[], states=[];
  const persist=memoryPersistence();
  const opener = tier==='wasm' ? webDevice({wasm:readFileSync(new URL('../src/wasm/snapback4_device_bg.wasm',import.meta.url)),persist}) : processDevice({binary,dir:join(dir,'device')});
  const clientOptions = {url,persona:'bob',device:{async open(...args){core=await opener.open(...args);return {...core, async call(req,...rest){const result=await core.call(req,...rest); if(req.op==='query') scans.push({request:req,result});if(req.op==='search_state')states.push(result);return result;}}}},fetch:async(input,init)=>{
    if(offline) throw new TypeError('offline');
    const path=new URL(input).pathname;
    if(path==='/changes') return parkedChanges(init.signal);
    if(path.startsWith('/q/')) {
      const response=await fetch(queryUrl ? `${queryUrl}${path}` : input,init);requests.push({body:JSON.parse(init.body),json:await response.clone().json()});
      if(hold){const current=hold;hold=null;current.arrived.resolve();await current.release.promise;}
      return response;
    }
    return fetch(queryUrl ? String(input).replace(url, queryUrl) : input,init);
  }};
  let client = await createLocalClient(clientOptions);
  t.after(async()=>{hold?.release.resolve();await client.close();await owner.close();await admin.close();});
  await client.sync();
  assert.equal((await owner.mutate(m('leave'),{room:'left'})).state,'sent');
  await client.sync();
  return {url,dir,get client(){return client;},owner,admin,requests,scans,states,rows:rows.filter(r=>r.table==='messages'),core:()=>core,
    replaceQueryServer(url){queryUrl=url;}, async network(on){offline=!on;await client.sync();},
    async reopen(){await client.close();client=await createLocalClient(clientOptions);await client.sync();},
    hold(){const value={arrived:gate(),release:gate()};hold=value;return value;}};
}

for (const tier of ['process','wasm']) test(`review replacement query server invalidates old search continuation ${tier}`,async t=>{
 const f=await setup(t,tier);
 await f.admin.mutate(m('join'),{room:'left'});await f.client.sync();
 const first=await f.client.query(q,{q:'coffee'});
 const replacement=await server(t,'',source);
 const rows=[{table:'members',row:{id:'ml',room:'live',principal:'dev:bob'}},{table:'members',row:{id:'mr',room:'left',principal:'dev:bob'}},
 ...f.rows.map(({table,...row})=>({table:'messages',row})),{table:'messages',row:{id:'newmessage',room:'live',at:3000,text:'coffee new incarnation',tombstone:false,expires:null}}];
 assert.equal((await fetch(`${replacement.url}/seed`,{method:'POST',body:JSON.stringify(rows)}).then(r=>r.json())).seeded,rows.length);
 f.replaceQueryServer(replacement.url);
 const before=f.requests.length,second=await f.client.query(q,{q:'coffee',c:first.next});
 assert.equal(f.requests.length-before,4);
 assert.equal(second.denied?.code,'E_QUERY_RETRY');
 console.log(tier,{oldStore:f.requests[0].json.store_id,newStore:f.requests.at(-1).json.store_id,data:second.data?.map(r=>r.id),complete:second.complete,loading:second.loading});
 assert.equal(second.data,undefined,'must withdraw old source positions across server incarnation change');
 await f.client.sync();
 const fresh=await f.client.query(q,{q:'coffee',c:first.next});
 assert.equal(fresh.data[0].id,'newmessage');
 assert.equal(f.requests.at(-1).body.args.c,null,'the old store position is never reused after sync');
});

for (const tier of ['process','wasm']) test(`review changed generation invalidates old search continuation ${tier}`,async t=>{
  const f=await setup(t,tier),first=await f.client.query(q,{q:'coffee'});
  const previous=await fetch(`${f.url}/schema`,{headers:{"x-snapback-persona":"bob"}}).then(r=>r.json());
  writeFileSync(join(f.dir,'snapback/schema.q'),source+'\nquery added():\n  return true\n');
  await until(async()=>{const next=await fetch(`${f.url}/schema`,{headers:{"x-snapback-persona":"bob"}}).then(r=>r.json());return next.generation>previous.generation;},'new generation');
  const before=f.requests.length,read=await f.client.query(q,{q:'coffee',c:first.next});
  assert.equal(f.requests.length-before,4);assert.equal(read.denied?.code,'E_QUERY_RETRY');
  await f.client.sync();
  const fresh=await f.client.query(q,{q:'coffee',c:first.next});
  assert.ok(Array.isArray(fresh.data),JSON.stringify(fresh));
  assert.equal(f.requests.at(-1).body.args.c,null);
});

for(const tier of ['process','wasm']) test(`oracle seed 160: offline cursor cannot cross into a replacement store ${tier}`,async t=>{
 const f=await setup(t,tier);await f.admin.mutate(m('join'),{room:'left'});await f.client.sync();
 const first=await f.client.query(q,{q:'coffee'});await f.network(false);
 const offline=await f.client.query(q,{q:'coffee',c:first.next});
 assert.ok(offline.next&&!offline.next.startsWith('sb4s:'));
 const replacement=await server(t,'',source);
 const rows=[{table:'members',row:{id:'ml',room:'live',principal:'dev:bob'}},
 ...f.rows.filter(r=>r.room==='live').map(({table,...row})=>({table:'messages',row})),
 {table:'messages',row:{id:'newmessage',room:'live',at:3000,text:'coffee new incarnation',tombstone:false,expires:null}}];
 assert.equal((await fetch(`${replacement.url}/seed`,{method:'POST',body:JSON.stringify(rows)}).then(r=>r.json())).seeded,rows.length);
 f.replaceQueryServer(replacement.url);await f.network(true);
 const before=f.requests.length,fresh=await f.client.query(q,{q:'coffee',c:offline.next});
 assert.equal(f.requests.length-before,1);assert.equal(fresh.data[0].id,'newmessage');
 assert.equal(f.requests.at(-1).body.args.c,null);
});

for (const tier of ['process','wasm']) test(`oracle seed 52: reacquiring the same membership after reset starts fresh ${tier}`,async t=>{
  const f=await setup(t,tier);await f.admin.mutate(m('join'),{room:'left'});await f.client.sync();
  const first=await f.client.query(q,{q:'coffee'});
  await f.core().call({op:'clear_rows'});await f.reopen();
  const before=f.requests.length, fresh=await f.client.query(q,{q:'coffee',c:first.next});
  assert.equal(f.requests.length-before,1);
  assert.deepEqual(ids(fresh),ids(first));
  assert.equal(f.requests.at(-1).body.args.c,null);
});

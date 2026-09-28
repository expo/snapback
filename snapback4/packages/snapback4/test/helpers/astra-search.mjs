// @ref LLP 3000.028#7.2 — real server/device source traversal and delivery races.
import assert from 'node:assert/strict';
import { join } from 'node:path';
import { readFileSync } from 'node:fs';
import { createClient } from '../../dist/client.js';
import { createLocalClient } from '../../dist/local.js';
import { processDevice } from '../../dist/native.js';
import { webDevice, memoryPersistence } from '../../dist/web.js';
import { binary, server } from './app-server.mjs';
import { parkedChanges } from './sync-control.mjs';

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
  delete <- true
  sync to members[.room] last 100 by .at
  retain delivered-history
mutation rebirth(id: messages, room: id, text: text <=200, at: time):
  delete messages[id]
  insert messages { id, room, text, at, tombstone: false, expires: null }
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
  let program = options.whole ? source.replace('sync to members[.room] last 100 by .at', 'sync to members[.room]') : source;
  if(options.ascending)program=program.replaceAll('last 20 by .at','first 20 by .at');
  const {url, dir} = await server(t, '', program);
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
  let offline=false, hold, core;
  const requests=[], scans=[], states=[];
  const persist=memoryPersistence();
  const opener = tier==='wasm' ? webDevice({wasm:readFileSync(new URL('../../src/wasm/snapback4_device_bg.wasm',import.meta.url)),persist}) : processDevice({binary,dir:join(dir,'device')});
  const clientOptions = {url,persona:'bob',device:{async open(...args){core=await opener.open(...args);return {...core, async call(req,...rest){const result=await core.call(req,...rest); if(req.op==='query') scans.push({request:req,result});if(req.op==='search_state')states.push(result);return result;}}}},fetch:async(input,init)=>{
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
  let client = await createLocalClient(clientOptions);
  t.after(async()=>{hold?.release.resolve();await client.close();await owner.close();await admin.close();});
  await client.sync();
  assert.equal((await owner.mutate(m('leave'),{room:'left'})).state,'sent');
  await client.sync();
  return {url,dir,get client(){return client;},owner,admin,requests,scans,states,rows:rows.filter(r=>r.table==='messages'),core:()=>core,
    async network(on){offline=!on;await client.sync();},
    async reopen(){await client.close();client=await createLocalClient(clientOptions);await client.sync();},
    hold(){const value={arrived:gate(),release:gate()};hold=value;return value;}};
}

export { setup, q, m, ids };

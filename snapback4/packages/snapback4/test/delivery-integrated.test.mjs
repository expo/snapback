import { hangBudget } from './helpers/wait.mjs';
import test from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { createClient } from '../dist/client.js';
import { createLocalClient } from '../dist/local.js';
import { webDevice, memoryPersistence } from '../dist/web.js';
import { server, until } from './helpers/app-server.mjs';

const wasm = readFileSync(new URL('../dist/wasm/snapback4_device_bg.wasm', import.meta.url));
const fixture = readFileSync(new URL('../../../crates/snapback4-lang/tests/delivery/schema.q', import.meta.url), 'utf8');
const expectedFingerprint = '2f5d2629caf0cd61eacb5eb5bd772dd8684be9e7872af1112bd679c5719f3443';
// @ref LLP 3000.022#5 — independently pin the shared digest, then exercise its real producer and consumers.
function fingerprint(binding) {
  const hash = createHash('sha256').update('snapback4.delivery.v1\0');
  for (const field of [binding.table, binding.group, binding.position, binding.mutation, ...binding.args]) {
    const bytes = Buffer.from(field), length = Buffer.alloc(8);
    length.writeBigUInt64BE(BigInt(bytes.length)); hash.update(length).update(bytes);
  }
  return hash.digest('hex');
}
for (const mode of ['online', 'local-fallback', 'local-publication']) {
  test(`integrated delivery binding, manifest, report and no-op replay: ${mode}`, { timeout: hangBudget(21) }, async t => {
    let source = `use personas alice\n${fixture}`
      .replace('  public\n', '  public\n  insert <- allow\n')
      .replace('  require low <= high else NOT_A_RUN\n  return null',
        "  require low <= high else NOT_A_RUN\n  insert reports {chat: group, low, high, owner: viewer} if absent\n  return null");
    if (mode === 'local-publication') source = source.replace('  online only', '  sync to .owner');
    source += `
table reports:
  chat: chats
  low: int
  high: int
  owner: principal
  unique chat, owner, low, high
  read <- .owner = viewer
  insert <- .owner = viewer
  online only
mutation seed():
  chat = insert chats {name: 'chat'}
  insert messages {chat: chat.id, ordinal: 41, text: 'first', owner: viewer}
  insert messages {chat: chat.id, ordinal: 43, text: 'last', owner: viewer}
  return chat.id
query fetched(chat: chats):
  return messages where .chat = chat first 20 by .ordinal {text}
query positions(chat: chats):
  return messages where .chat = chat first 20 by .ordinal {ordinal}
query coverage():
  return reports first 20 by .id
`;
    const { url } = await server(t, '', source);
    const headers = { 'content-type': 'application/json', 'x-snapback-persona': 'alice' };
    const post = (path, body) => fetch(`${url}${path}`, { method: 'POST', headers, body: JSON.stringify(body) }).then(r => r.json());
    const backend = await fetch(`${url}/schema`, { headers }).then(r => r.json());
    const binding = backend.schema.delivery[0];
    assert.equal(binding.fingerprint, expectedFingerprint);
    assert.equal(fingerprint(binding), expectedFingerprint);
    const seeded = await post('/m/seed', { id: 'seed', args: {} });
    assert.equal(seeded.state, 'sent', JSON.stringify(seeded));
    const chat = seeded.result, requests = [], responses = [], manifests = [], refused = [], persist = memoryPersistence();
    let core;
    const device = webDevice({ wasm, persist });
    const options = { url, persona: 'alice', waitSeconds: 1, onDeliveryRefused: event => refused.push(event), fetch: async (input, init) => {
      const path = new URL(input).pathname;
      if (path === '/m/delivered') requests.push(JSON.parse(init.body));
      const response = await fetch(input, init);
      if (path === '/m/delivered') responses.push(await response.clone().json());
      if (path === '/q/fetched') manifests.push((await response.clone().json()).delivery);
      return response;
    } };
    const client = mode === 'online' ? createClient(options) : await createLocalClient({ ...options,
      device: { async open(...args) { core = await device.open(...args); return core; } },
    });
    t.after(() => client.close());
    if (mode !== 'online') await client.sync();
    if (mode !== 'local-publication') {
      const onlyPositions = await client.query({ kind: 'query', name: 'positions' }, { chat });
      assert.ok('data' in onlyPositions);
      assert.deepEqual(requests, [], 'position-only images do not create delivery debt');
    }
    const read = await client.query({ kind: 'query', name: 'fetched' }, { chat });
    assert.deepEqual(read.data.map(row => row.text), ['first', 'last']);
    await until(() => responses.length === 2, 'two real delivery receipts');
    assert.deepEqual(refused, []);
    assert.ok(responses.every(r => r.state === 'sent'), JSON.stringify(responses));
    assert.deepEqual(requests.map(r => r.args), [{ group: chat, low: 41, high: 41 }, { group: chat, low: 43, high: 43 }]);
    assert.ok(requests.every(r => r.delivery.fingerprint === expectedFingerprint && typeof r.store_id === 'string'));
    if (mode !== 'local-publication') {
      assert.deepEqual(manifests[0], [{ table: binding.table, mutation: binding.mutation, args: binding.args,
        fingerprint: expectedFingerprint, rows: [[chat, 41], [chat, 43]] }]);
    }
    if (core) {
      await until(async () => {
        const state = JSON.parse((await core.call({ op: 'delivery', viewer: 'dev:alice', action: 'read' })).ok.value);
        return Object.values(state.groups).some(g => g.reported.length === 2);
      }, 'device stores acknowledged debt');
      const state = JSON.parse((await core.call({ op: 'delivery', viewer: 'dev:alice', action: 'read' })).ok.value);
      assert.equal(Object.values(state.bindings)[0].fingerprint, expectedFingerprint);
      assert.ok([...persist.stores.values()].some(store => [...store.values()].some(c => c.s === 'm' && c.k.startsWith('device:delivery:'))));
    }
    const coverage = await post('/q/coverage', { args: {} });
    assert.deepEqual(coverage.data.map(r => [r.low, r.high]).sort((a, b) => a[0] - b[0]), [[41, 41], [43, 43]]);
    const before = await fetch(`${url}/probe`, { headers }).then(r => r.json());
    const replay = await post('/m/delivered', requests[0]);
    assert.equal(replay.state, 'sent');
    const noop = await post('/m/delivered', { ...requests[0], id: 'covered-again' });
    assert.equal(noop.state, 'sent');
    assert.equal(noop.seq, before.seq, 'a newly identified covered report advances no sequence');
    const after = await fetch(`${url}/probe`, { headers }).then(r => r.json());
    assert.equal(after.seq, before.seq);
    const stale = await post('/m/delivered', { ...requests[0], id: 'wrong-binding', delivery: { fingerprint: 'wrong' } });
    assert.equal((stale.denied ?? stale.why).code, 'E_DELIVERY_BINDING');
    assert.notEqual((stale.denied ?? stale.why).retryable, true);
  });
}

// @ref LLP 3000.022#14 — a real manifest must carry maintenance custody all
// the way through the online reporter and the server fingerprint check.
test('declarative full runs compact a long deleted hole through the real SDK', {timeout:hangBudget(15)}, async t=>{
 const source=`use personas alice, bob
table conversations:
  creator: principal
  lastOrdinal: int
  read <- exists members[.id, viewer]
  insert <- .creator = viewer
  sync to members[.id]
table members:
  conversation: conversations
  principal: principal
  joinedOrdinal: int
  unique conversation, principal
  cap 50 by conversation
  immutable conversation, principal, joinedOrdinal
  read <- exists members[.conversation, viewer]
  insert <- created conversations[.conversation]
  update <- .principal = viewer
  sync to members[.conversation]
table messages:
  receipts chat by .conversation, .ordinal from .sender to members:
    counter .lastOrdinal
    floor .joinedOrdinal
    count .recipients
  conversation: conversations
  ordinal: int
  sender: principal
  recipients: int
  unique conversation, ordinal
  immutable conversation, ordinal, sender, recipients
  read <- exists members[.conversation, viewer]
  insert <- .sender = viewer and exists members[.conversation, viewer]
  delete <- .sender = viewer
  sync to members[.conversation]
mutation erase(conversation: conversations):
  delete messages[conversation, 1]
  delete messages[conversation, 2000]
  delete messages[conversation, 2001]
mutation eraseGaps(conversation: conversations):
  for i in range(1,64):
    delete messages[conversation, 2001 + i * 2]
  delete messages[conversation, 2130]
query fetched(conversation: conversations):
  return messages[conversation, 2131]
`;
 const {url}=await server(t,'',source);
 const post=(persona,path,body)=>fetch(`${url}${path}`,{method:'POST',headers:{'content-type':'application/json','x-snapback-persona':persona},body:JSON.stringify(body)}).then(r=>r.json());
 // Restore the same sparse historical layout through administrative seed;
 // application mutations cannot write v3 accounting fields.
 const chat='c', rows=[
   {table:'conversations',row:{id:chat,creator:'dev:alice',lastOrdinal:2131}},
   ...['alice','bob'].map(principal=>({table:'members',row:{id:principal,conversation:chat,principal:`dev:${principal}`,joinedOrdinal:0}})),
   ...[1,2000,...Array.from({length:128},(_,i)=>2001+i),2130,2131].map(ordinal=>({table:'messages',row:{id:`m${ordinal}`,conversation:chat,ordinal,sender:'dev:alice',recipients:1}})),
 ];
 const restored=await post('alice','/seed',rows);assert.equal(restored.seeded,rows.length,JSON.stringify(restored));
 for(let i=0;i<64;i++) {
   const r=await post('bob','/m/chatDelivered',{id:`run${i}`,args:{conversation:chat,from:2002+i*2,through:2002+i*2}});assert.equal(r.state,'sent',JSON.stringify(r));
 }
 // Live blockers keep all 64 intervals distinct even with gap-aware compaction.
 const saturated=await post('bob','/q/chatProgress',{args:{conversation:chat,c:null}});
 assert.equal(saturated.data.runs.length,64);
 assert.equal((await post('alice','/m/erase',{id:'erase',args:{conversation:chat}})).state,'sent');
 const calls=[];
 const client=createClient({url,persona:'bob',fetch:async(input,init)=>{
   const path=new URL(input).pathname;const response=await fetch(input,init);
   if(path.startsWith('/m/'))calls.push({path,body:JSON.parse(init.body),reply:await response.clone().json()});return response;
 }});t.after(()=>client.close());
 const answer=await client.query({kind:'query',name:'fetched'},{conversation:chat});assert.ok('data' in answer,JSON.stringify(answer));
 await until(()=>calls.some(c=>c.path==='/m/chatCompact'),'bound compaction');
 await until(()=>calls.some(c=>c.path==='/m/chatDelivered'&&c.reply.state==='sent'),'full coverage after compaction');
 assert.equal(calls[0].reply.why.code,'RUNS_FULL');
 const compact=calls.find(c=>c.path==='/m/chatCompact');assert.equal(compact.reply.result,true);
 const successful=calls.find(c=>c.path==='/m/chatDelivered'&&c.reply.state==='sent');
 assert.notEqual(successful.body.id,calls[0].body.id);
 assert.equal(successful.body.delivery.fingerprint,compact.body.delivery.fingerprint);
 const progress=await post('bob','/q/chatProgress',{args:{conversation:chat,c:null}});
 assert.ok(progress.data.member.chatDeliveredOrdinal>=2131 || progress.data.runs.some(r=>r.fromOrdinal<=2131&&r.throughOrdinal>=2131),'success covers the whole input even when compaction remains chunked');
 assert.equal((await post('alice','/m/eraseGaps',{id:'erase-gaps',args:{conversation:chat}})).state,'sent');
 const finish=await post('bob','/m/chatCompact',{id:'finish-compaction',delivery:successful.body.delivery,args:{conversation:chat}});assert.equal(finish.state,'sent');
 const final=await post('bob','/q/chatProgress',{args:{conversation:chat,c:null}});
 assert.equal(final.data.member.chatDeliveredOrdinal,2131);assert.deepEqual(final.data.runs,[]);
 const stale=await post('bob','/m/chatCompact',{id:'stale',delivery:{fingerprint:'old'},args:{conversation:chat}});
 assert.equal((stale.why??stale.denied).code,'E_DELIVERY_BINDING');
});

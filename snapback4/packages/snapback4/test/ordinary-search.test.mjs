// @ref LLP 3000.028#7.2 — real server/device source traversal and delivery races.
import test from 'node:test';
import assert from 'node:assert/strict';
import { join } from 'node:path';
import { readFileSync } from 'node:fs';
import { createClient } from '../dist/client.js';
import { createLocalClient } from '../dist/local.js';
import { processDevice } from '../dist/native.js';
import { webDevice, memoryPersistence } from '../dist/web.js';
import { binary, server } from './helpers/app-server.mjs';
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
  const opener = tier==='wasm' ? webDevice({wasm:readFileSync(new URL('../src/wasm/snapback4_device_bg.wasm',import.meta.url)),persist}) : processDevice({binary,dir:join(dir,'device')});
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
for(const tier of ['process','wasm']) test(`ordinary mixed search ${tier}: retained first page, consumed prefixes and every ID exactly once`,async t=>{
  const f=await setup(t,tier), actual=[];
  let c;
  for(let n=0;n<10;n++){
    const start=f.requests.length;
    const read=await f.client.query(q,{q:'coffee',c});
    assert.equal(f.requests.length-start,1);
    actual.push(...ids(read));
    if(n===0){assert.deepEqual(ids(read),f.rows.slice(45).reverse().map(r=>r.id)); assert.equal(f.requests.at(-1).json.data.length,20);assert.equal(decode(read.next).server,null);}
    if(n===1) assert.equal(f.requests.at(-1).body.args.c,decode(c).after,'seek the combined boundary, preserving every unconsumed server hit');
    c=read.next;if(!c)break;
  }
  assert.deepEqual(actual,f.rows.reverse().map(r=>r.id));
  assert.equal(new Set(actual).size,65);
  assert.ok(f.scans.some(s=>s.request.search&&s.request.spent.heap_bytes>0&&s.result.ok.metered.heap_bytes>s.request.spent.heap_bytes));
  const budget=f.states.find(s=>s.ok.ceilings).ok.ceilings;
  const spent=Object.fromEntries(Object.keys(budget).map(k=>[k,0]));spent.heap_bytes=budget.heap_bytes-1;
  const exhausted=await f.core().call({op:'query',name:'search',viewer:'dev:bob',args:{q:'coffee'},now:Date.now(),search:true,spent});
  assert.ok(exhausted.ok.loading||exhausted.ok.denied?.code==='E_BOUND',JSON.stringify(exhausted));
  assert.equal(exhausted.ok.data,undefined,'the device cannot reset prepaid coordinator work');
  spent.heap_bytes=0;spent.output_bytes=budget.output_bytes;
  const stateBound=await f.core().call({op:'search_state',name:'search',spent});
  assert.equal(stateBound.denied.code,'E_BOUND','the state fence also shares the output allowance');
});
for (const tier of ['process', 'wasm']) test(`ordinary mixed search ${tier}: complete empty server cannot replace departed hits`, async t => {
  const f = await setup(t, tier);
  assert.equal((await f.owner.mutate(m('leave'), {room:'live'})).state, 'sent');
  await f.client.sync();
  const before = f.requests.length;
  const read = await f.client.query(q, {q:'coffee'});
  assert.equal(f.requests.length - before, 1);
  assert.deepEqual(f.requests.at(-1).json.data, []);
  assert.equal(f.requests.at(-1).json.complete, true);
  assert.deepEqual(ids(read), f.rows.slice(45).reverse().map(r => r.id));
  assert.equal(read.complete, false);
  assert.ok(read.next);
});
for (const tier of ['process','wasm']) for (const cut of ['words','meter'])
test(`ordinary mixed search ${tier}: device ${cut} cut keeps the server page and its consumed continuation`, {timeout:180000}, async t=>{
  const count=cut==='words'?40:8192;
  const current=Array.from({length:count},(_,i)=>({id:`current${String(i).padStart(5,'0')}`,room:'live',at:i+10,text:cut==='words'?`coffee${String(i).padStart(2,'0')}`:'coffee'}));
  const departed=cut==='words'?[{id:'keptHead',room:'left',at:5000,text:'coffee00'}, {id:'undiscoveredHead',room:'left',at:6000,text:'coffee99'}]:[{id:'olderDeparted',room:'left',at:1,text:'coffee'}];
  const f=await setup(t,tier,null,{messages:[...current,...departed],whole:true});
  const term=cut==='words'?'cof':'coffee';
  const raw=await f.core().call({op:'query',name:'search',viewer:'dev:bob',args:{q:term},now:Date.now(),search:true});
  assert.equal(raw.ok.cut,cut,JSON.stringify(raw));assert.equal(raw.ok.next,null);
  assert.equal(raw.ok.complete,false);
  if(cut==='meter') {assert.equal(raw.ok.metered.examined,8193,'receipt includes the rejected charge');assert.deepEqual(raw.ok.data,[]);}
  else {assert.ok(raw.ok.data.some(r=>r.id==='keptHead'));assert.ok(!raw.ok.data.some(r=>r.id==='undiscoveredHead'));}
  const actual=[];let c;
  // The word case exhausts the server; the 8,192-row case proves two distinct
  // consumed prefixes without replaying hundreds of unaffected server pages.
  for(let page=0;page<2;page++){
    const calls=f.requests.length,read=await f.client.query(q,{q:term,c});
    assert.equal(f.requests.length-calls,1);
    const remote=f.requests.at(-1).json;
    assert.deepEqual(ids(read),remote.data.map(r=>r.id));
    assert.deepEqual(ids(read),current.slice().reverse().slice(page*20,page*20+20).map(r=>r.id));
    assert.equal(read.cut,cut);assert.equal(read.complete,false);assert.equal(read.fresh,true);
    assert.equal(read.since,undefined);actual.push(...ids(read));
    if(page===0){assert.ok(read.next);assert.equal(decode(read.next).local,null);assert.equal(decode(read.next).localCut,cut);}
    c=read.next;
  }
  assert.equal(new Set(actual).size,40);
  assert.equal(f.scans.filter(s=>s.request.search).length,1,'the cut source is suspended for this continuation');
  if(cut==='words')assert.equal(c,null,'terminal server page keeps device incompleteness');
});
for (const tier of ['process','wasm']) test(`ordinary mixed search ${tier}: newer current rows never enter the retained device scan`,async t=>{
  const f=await setup(t,tier,null,{messages:[
    {id:'currentHead',room:'live',at:3000,text:'coffee'},
    {id:'retainedHead',room:'left',at:2000,text:'coffee'},
  ]});
  const raw=await f.core().call({op:'query',name:'search',viewer:'dev:bob',args:{q:'coffee'},now:Date.now(),search:true});
  assert.deepEqual(raw.ok.data.map(r=>r.id),['retainedHead']);
  const mixed=await f.client.query(q,{q:'coffee'});
  assert.deepEqual(ids(mixed),['currentHead','retainedHead']);assert.equal(mixed.fresh,false);
});
for (const tier of ['process','wasm']) test(`ordinary mixed search ${tier}: an at-changing current edit cannot reappear as a stale later device body`,async t=>{
  const f=await setup(t,tier);
  // Keep the old current image on the device, while the server moves that
  // same id ahead of every retained row. A broad delivered-history filter
  // would later emit m000 again at its old at/body behind page one's server hit.
  assert.equal((await f.admin.mutate(m('move'),{id:'m000',at:3000,text:'coffee edited'})).state,'sent');
  const all=[];let c;
  for(let page=0;page<10;page++){
    const calls=f.requests.length,read=await f.client.query(q,{q:'coffee',c});
    assert.equal(f.requests.length-calls,1);ids(read);all.push(...read.data);
    if(page===0){assert.equal(read.data[0].id,'m000');assert.equal(read.data[0].text,'coffee edited');}
    c=read.next;if(!c)break;
  }
  assert.equal(all.filter(r=>r.id==='m000').length,1,'the stale device image must not be a later-page hit');
  assert.equal(all.length,65);assert.equal(new Set(all.map(r=>r.id)).size,65);
  const oracle=f.rows.map(r=>r.id==='m000'?{...r,at:3000}:r).sort((a,b)=>b.at-a.at||Buffer.compare(Buffer.from(b.id),Buffer.from(a.id)));
  assert.deepEqual(all.map(r=>r.id),oracle.map(r=>r.id));
});
for (const tier of ['process','wasm']) for (const whole of [false,true])
test(`ordinary mixed search ${tier}: current-only pages are fresh; ${whole?'horizon-free absence is complete':'windowed retained coverage stays unknown'}`,async t=>{
  const messages=Array.from({length:25},(_,i)=>({id:`c${i}`,room:'live',at:100+i,text:'coffee'}));
  messages.push({id:'old',room:'left',at:1,text:'coffee'});
  const f=await setup(t,tier,null,{messages,whole});
  const first=await f.client.query(q,{q:'coffee'});
  assert.equal(first.fresh,true);assert.equal(first.since,undefined);
  const mixed=await f.client.query(q,{q:'coffee',c:first.next});
  assert.equal(mixed.fresh,false);assert.ok(mixed.since);assert.equal(ids(mixed).at(-1),'old');
  const absent=await f.client.query(q,{q:'absent'});
  assert.deepEqual(ids(absent),[]);assert.equal(absent.next,null);assert.equal(absent.complete,whole);
  assert.equal(f.requests.at(-1).json.complete,true);
  assert.equal(f.scans.findLast(s=>s.request.search).result.ok.unknown,!whole,'only horizon-free coverage proves this unscoped absence');
});
for (const tier of ['process', 'wasm']) test(`ordinary mixed search ${tier}: server cursor seeks the exact offline suffix`, async t => {
  const f = await setup(t, tier);
  const serverPage = await f.owner.query(q, {q:'coffee'});
  assert.ok(serverPage.next);
  const last = serverPage.data.at(-1);
  const compare = (a, b) => a.at - b.at || Buffer.compare(Buffer.from(a.id), Buffer.from(b.id));
  const expected = f.rows.filter(r => compare(r, last) < 0).sort((a, b) => compare(b, a)).slice(0, 20).map(r => r.id);
  assert.ok(expected.length > 0);
  await f.network(false);
  const before = f.requests.length;
  const read = await f.client.query(q, {q:'coffee', c:serverPage.next});
  assert.deepEqual(ids(read), expected);
  assert.equal(read.complete, false);
  assert.equal(f.requests.length, before);
});
test('ordinary mixed search: link change and state reset restart, rejoin excludes stale retained lane',async t=>{
  const f=await setup(t);
  const first=await f.client.query(q,{q:'coffee'});
  await f.network(false);
  const offline=await f.client.query(q,{q:'coffee',c:first.next});
  assert.deepEqual(ids(offline),ids(first));assert.equal(offline.fresh,false);
  await f.network(true);
  assert.equal((await f.admin.mutate(m('join'),{room:'left'})).state,'sent');await f.client.sync();
  const joined=await f.client.query(q,{q:'coffee',c:first.next});
  assert.deepEqual(ids(joined),ids(first));assert.equal(joined.fresh,true);
});
test('ordinary mixed search: departure during delivery withdraws response without a second invocation',async t=>{
  const f=await setup(t), g=f.hold(), before=f.requests.length;
  const pending=f.client.query(q,{q:'coffee'});await g.arrived.promise;
  assert.equal((await f.owner.mutate(m('leave'),{room:'live'})).state,'sent');await f.client.sync();
  g.release.resolve();const read=await pending;
  assert.equal(f.requests.length-before,1);assert.deepEqual(read,{loading:true});
  const after=await f.client.query(q,{q:'coffee'});assert.equal(ids(after).length,20);
});

test('ordinary mixed search: a real server drain cut is never automatically drained', {timeout:120000}, async t=>{
  const f=await setup(t);
  // The compact plan's default 8,192 examined allowance opens 4,077 live
  // dense scopes but cuts during drain. They need not be acquired locally.
  for(let first=0;first<4076;first+=100){
    const rows=[];
    for(let n=first;n<Math.min(first+100,4076);n++) {
      rows.push({table:'members',row:{id:`extraMember${n}`,room:`extra${n}`,principal:'dev:bob'}});
      rows.push({table:'messages',row:{id:`extraMessage${n}`,room:`extra${n}`,text:'coffee',at:1,tombstone:false,expires:null}});
    }
    const reply=await fetch(`${f.url}/seed`,{method:'POST',body:JSON.stringify(rows)}).then(r=>r.json());
    assert.equal(reply.seeded,rows.length,JSON.stringify(reply));
  }
  const start=f.requests.length;
  const first=await f.client.query(q,{q:'coffee'});
  assert.equal(f.requests.length-start,1);
  const remote=f.requests.at(-1).json;
  assert.equal(remote.denied,undefined,JSON.stringify(remote));
  assert.equal(remote.complete,false,JSON.stringify(remote));assert.equal(remote.cut,'meter');
  assert.ok(remote.data.length>0 && remote.data.length<20);assert.ok(remote.next);
  assert.equal(ids(first).length,20);assert.equal(first.cut,'meter');assert.equal(first.complete,false);
  assert.equal(decode(first.next).server,null);
  const next=await f.client.query(q,{q:'coffee',c:first.next});
  assert.equal(f.requests.length-start,2);assert.equal(f.requests.at(-1).body.args.c,decode(first.next).after);
  // Seeking 4,077 heads with a cursor exceeds the ordinary server's heap
  // envelope. That refusal remains authoritative; it must not trigger a drain.
  const direct=await f.owner.query(q,{q:'coffee',c:decode(first.next).after});
  assert.equal(direct.denied?.code,'E_SEARCH_OPEN');
  assert.deepEqual(next.denied,direct.denied);
});

test('ordinary mixed search: retained edits stay at the delivered image; expiry crossing delivery withdraws it', {timeout:10000}, async t=>{
  const expires=Date.now()+2000;
  const f=await setup(t,'process',expires);
  assert.equal((await f.admin.mutate(m('edit'),{id:'m064',text:'changed after departure'})).state,'sent');
  // Unrelated server edits may advance its head without changing membership.
  const retained=await f.client.query(q,{q:'coffee'});
  assert.equal(retained.data[0].text,'coffee');
  const g=f.hold(),before=f.requests.length,pending=f.client.query(q,{q:'coffee'});await g.arrived.promise;
  await new Promise(resolve=>setTimeout(resolve,Math.max(0,expires-Date.now()+30)));
  g.release.resolve();const expired=await pending;
  assert.equal(f.requests.length-before,1);assert.deepEqual(expired,{loading:true});
  const after=await f.client.query(q,{q:'coffee'});assert.ok(!ids(after).includes('m064'));
});

test('ordinary mixed search: an unsynced rejoin cannot union a stale retained image with current data',async t=>{
  const f=await setup(t);
  assert.equal((await f.admin.mutate(m('join'),{room:'left'})).state,'sent');
  assert.equal((await f.admin.mutate(m('edit'),{id:'m064',text:'tea'})).state,'sent');
  const before=f.requests.length,unknown=await f.client.query(q,{q:'coffee'});
  assert.equal(f.requests.length-before,1);assert.deepEqual(unknown,{loading:true});
  await f.client.sync();const joined=await f.client.query(q,{q:'coffee'});
  assert.ok(!ids(joined).includes('m064'));
});

for(const tier of ['process','wasm'])test(`ordinary mixed search ${tier}: reopen recomputes unconsumed server hits without a buffer`,async t=>{
  const f=await setup(t,tier),first=await f.client.query(q,{q:'coffee'});
  assert.equal(decode(first.next).server,null);await f.reopen();
  const actual=[...ids(first)];let c=first.next;
  for(let page=0;page<10;page++){
    const before=f.requests.length,r=await f.client.query(q,{q:'coffee',c});
    assert.equal(f.requests.length-before,1);actual.push(...ids(r));c=r.next;if(!c)break;
  }
  assert.deepEqual(actual,f.rows.reverse().map(r=>r.id));assert.equal(new Set(actual).size,65);
});

// Reuse the repository's Vite/Chromium harness with a real wasm local client.
test('mounted React ordinary search follows departure, offline and rejoin without switching queries', {timeout:60000}, async t=>{
  const f=await setup(t);
  assert.equal((await f.admin.mutate(m('join'),{room:'left'})).state,'sent');
  const {createRequire}=await import('node:module');
  const {pathToFileURL}=await import('node:url');
  const {mkdirSync,writeFileSync}=await import('node:fs');
  const {resolve}=await import('node:path');
  const {chromiumExecutable}=await import('../../../witness/lib.mjs');
  const root=resolve(import.meta.dirname,'../../..'), require=createRequire(join(root,'packages/snapback4/package.json'));
  const {chromium}=createRequire(join(root,'package.json'))('playwright-core');
  const {createServer}=await import(pathToFileURL(createRequire(join(root,'apps/chat/package.json')).resolve('vite')).href);
  const temp=join(f.dir,'mounted');mkdirSync(temp);
  writeFileSync(join(temp,'index.html'),'<div id="root"></div><script type="module" src="/harness.jsx"></script>');
  writeFileSync(join(temp,'harness.jsx'),`
import React from 'react';
import {createRoot} from 'react-dom/client';
import {SnapbackProvider,useQuery} from 'snapback4/react';
import {createLocalClient} from 'snapback4/local';
import {webDevice,memoryPersistence} from 'snapback4/web';
import {parkedChanges} from 'sync-control';
let offline=false; window.queryCalls=0;
const wasm=await fetch('/@fs/${root}/packages/snapback4/src/wasm/snapback4_device_bg.wasm').then(r=>r.arrayBuffer());
const client=await createLocalClient({url:${JSON.stringify(f.url)},persona:'bob',device:webDevice({wasm,persist:memoryPersistence()}),fetch:(input,init)=>{
 if(offline)throw new TypeError('offline');
 if(new URL(input).pathname==='/changes')return Promise.resolve(parkedChanges(init.signal));
 if(new URL(input).pathname.startsWith('/q/'))window.queryCalls++;
 return fetch(input,init);
}});
await client.sync();
window.network=async on=>{offline=!on;await client.sync();};
window.sync=()=>client.sync();
const op={kind:'query',name:'search'};
function Search(){const [q,setQ]=React.useState('coffee');window.setNeedle=setQ;const read=useQuery(op,{q});window.read=read;
 return <div><span id="coverage">{read.loading?'Loading':read.data?(read.complete?'Complete':'Results may be incomplete'):'Refused'}</span><span id="ids">{read.data?.map(r=>r.id).join(',')}</span></div>;}
const root=createRoot(document.getElementById('root'));root.render(<SnapbackProvider client={client}><Search/></SnapbackProvider>);
window.finish=async()=>{root.unmount();await client.close();};
`);
  let vite,browser;
  t.after(async()=>{await browser?.close();await vite?.close();});
  vite=await createServer({root:temp,configFile:false,logLevel:'error',server:{host:'127.0.0.1',port:0,fs:{allow:[root,temp]}},resolve:{alias:[
    {find:/^react$/,replacement:require.resolve('react')},{find:/^react-dom\/client$/,replacement:require.resolve('react-dom/client')},
    ...['jsx-runtime','jsx-dev-runtime'].map(name=>({find:'react/'+name,replacement:require.resolve('react/'+name)})),
    ...['react','local','web'].map(name=>({find:'snapback4/'+name,replacement:join(root,'packages/snapback4/src/'+name+(name==='react'?'.tsx':'.ts'))})),
    {find:'sync-control',replacement:join(root,'packages/snapback4/test/helpers/sync-control.mjs')}
  ]}});await vite.listen();
  browser=await chromium.launch({executablePath:chromiumExecutable(),headless:true,args:['--no-sandbox']});
  const page=await browser.newPage(),errors=[];page.on('pageerror',e=>errors.push(String(e)));
  await page.goto(vite.resolvedUrls.local[0]);
  try {
    await page.waitForFunction(()=>window.read?.data?.length===20&&window.read.fresh===true);
    assert.equal(await page.locator('#coverage').textContent(),'Complete');
    const first=await page.locator('#ids').textContent();
    assert.equal((await f.owner.mutate(m('leave'),{room:'left'})).state,'sent');await page.evaluate(()=>window.sync());
    await page.waitForFunction(()=>window.read?.data?.length===20&&window.read.fresh===false);
    assert.equal(await page.locator('#ids').textContent(),first);
    assert.equal(await page.locator('#coverage').textContent(),'Results may be incomplete');
    await page.evaluate(()=>window.network(false));
    await page.waitForFunction(()=>window.read?.data?.length===20&&window.read.fresh===false);
    assert.equal(await page.locator('#ids').textContent(),first);
    assert.equal((await f.admin.mutate(m('edit'),{id:'m064',text:'tea'})).state,'sent');
    assert.equal((await f.admin.mutate(m('join'),{room:'left'})).state,'sent');await page.evaluate(()=>window.network(true));
    await page.waitForFunction(()=>window.read?.fresh===true&&window.read.data?.[0]?.id==='m063');
    assert.equal(await page.locator('#coverage').textContent(),'Complete');
    const count=await page.evaluate(()=>window.queryCalls);
    await page.evaluate(()=>window.setNeedle(123));
    await page.waitForFunction(()=>window.read?.denied?.code==='E_INPUT');
    await new Promise(resolve=>setTimeout(resolve,200));
    assert.equal(await page.evaluate(()=>window.queryCalls)-count,1,'mounted refusal makes one request, without retry');
    assert.equal(await page.locator('#coverage').textContent(),'Refused');
    assert.deepEqual(errors,[]);await page.evaluate(()=>window.finish());
  } catch(error){assert.fail(JSON.stringify({error:String(error),errors,read:await page.evaluate(()=>window.read)}));}
});

for(const tier of ['process','wasm']) test(`ordinary mixed search ${tier}: a real device reset withdraws delivery and restarts its cursor`,async t=>{
  const f=await setup(t,tier),first=await f.client.query(q,{q:'coffee'});
  const g=f.hold(),before=f.requests.length,pending=f.client.query(q,{q:'coffee',c:first.next});
  await g.arrived.promise;
  assert.equal((await f.core().call({op:'clear_rows'})).denied,undefined);
  g.release.resolve();assert.deepEqual(await pending,{loading:true});assert.equal(f.requests.length-before,1);
  await f.client.sync();
  const after=await f.client.query(q,{q:'coffee',c:first.next});
  assert.deepEqual(ids(after),f.rows.filter(r=>r.room==='live').reverse().slice(0,20).map(r=>r.id));
  assert.equal(after.fresh,true);assert.equal(f.requests.at(-1).body.args.c,null);
});

for (const tier of ['process','wasm']) test(`ordinary ascending Unicode ties cross retained/current sources ${tier}`,async t=>{
  const f=await setup(t,tier,null,{ascending:true,whole:true}),all=[];let c;
  for(let page=0;page<10;page++){
    const before=f.requests.length,read=await f.client.query(q,{q:'coffee',c});
    assert.equal(f.requests.length-before,1);all.push(...read.data);c=read.next;if(!c)break;
  }
  assert.equal(c,null);
  const expected=[...f.rows].sort((a,b)=>a.at-b.at||Buffer.compare(Buffer.from(a.id),Buffer.from(b.id)));
  assert.deepEqual(all.map(r=>r.id),expected.map(r=>r.id));
  assert.equal(new Set(all.map(r=>r.id)).size,65);
});

for (const tier of ['process', 'wasm']) for (const ascending of [false, true])
test(`ordinary mixed search ${tier}: combined keyset boundary excludes new heads ${ascending ? 'first' : 'last'}`, async t => {
  const sign = ascending ? -1 : 1;
  const rows = Array.from({ length: 45 }, (_, i) => ({ id: `r${String(i).padStart(2, '0')}`, room: i < 20 ? 'left' : 'live', at: sign * (100 - i), text: 'coffee' }));
  const f = await setup(t, tier, null, { messages: rows, whole: true, ascending });
  const first = await f.client.query(q, { q: 'coffee' });
  assert.deepEqual(ids(first), rows.slice(0, 20).map(r => r.id));
  // The server lane has emitted nothing. New/edited matches ahead of the
  // combined consumed key must not be inserted into a later page.
  await fetch(`${f.url}/seed`, { method: 'POST', body: JSON.stringify([{ table: 'messages', row: { id: 'newHead', room: 'live', at: sign * 200, text: 'coffee', tombstone: false, expires: null } }]) });
  assert.equal((await f.admin.mutate(m('move'), { id: 'r44', at: sign * 180, text: 'coffee moved ahead' })).state, 'sent');
  const before = f.requests.length, second = await f.client.query(q, { q: 'coffee', c: first.next });
  assert.equal(f.requests.length - before, 1);
  assert.deepEqual(ids(second), rows.slice(20, 40).map(r => r.id));
  const third = await f.client.query(q, { q: 'coffee', c: second.next });
  assert.deepEqual(ids(third), rows.slice(40, 44).map(r => r.id));
  assert.equal(third.next, null);
  assert.equal(third.complete, true);
});

test('ordinary mixed search: real word-dense drain pages follow the combined keyset once', {timeout:120000}, async t=>{
  const f=await setup(t);
  // Overlap points share the 8,192 examined allowance with opening and drain.
  // 246 full 32-word extra scopes plus one 25-word scope leave a short drain.
  for(let first=0;first<247;first+=100){
    const rows=[];
    for(let n=first;n<Math.min(first+100,247);n++) {
      rows.push({table:'members',row:{id:`extraMember${n}`,room:`extra${n}`,principal:'dev:bob'}});
      for(let w=0;w<(n===246?25:32);w++) rows.push({table:'messages',row:{id:`extraMessage${n}-${w}`,room:`extra${n}`,text:`coffee${String(w).padStart(2,'0')}`,at:1,tombstone:false,expires:null}});
    }
    const reply=await fetch(`${f.url}/seed`,{method:'POST',body:JSON.stringify(rows)}).then(r=>r.json());
    assert.equal(reply.seeded,rows.length,JSON.stringify(reply));
  }
  const start=f.requests.length;
  const first=await f.client.query(q,{q:'coffee'});
  assert.equal(f.requests.length-start,1);
  const remote=f.requests.at(-1).json;
  assert.equal(remote.denied,undefined,JSON.stringify(remote));
  assert.equal(remote.complete,false,JSON.stringify(remote));assert.equal(remote.cut,'meter');
  assert.ok(remote.data.length>0 && remote.data.length<20);assert.ok(remote.next);
  assert.equal(ids(first).length,20);assert.equal(first.cut,'meter');assert.equal(first.complete,false);
  assert.equal(decode(first.next).server,null);
  const next=await f.client.query(q,{q:'coffee',c:first.next});
  assert.equal(f.requests.length-start,2);assert.equal(f.requests.at(-1).body.args.c,decode(first.next).after);
  assert.ok(ids(next).length>0);assert.deepEqual(ids(next),f.rows.filter(r=>r.at<1045).reverse().slice(0,ids(next).length).map(r=>r.id));assert.equal(next.complete,false);assert.equal(next.cut,'meter');
  const fetched=f.requests.at(-1).json;
  const consumed=fetched.data.filter(row=>ids(next).includes(row.id));
  assert.ok(consumed.length,'a short drain consumed a server prefix');
  const key=JSON.parse(Buffer.from(decode(next.next).server,'base64url'))[5];
  assert.deepEqual(key,[{Int:consumed.at(-1).at},{Id:consumed.at(-1).id}]);
  const third=await f.client.query(q,{q:'coffee',c:next.next});
  assert.equal(f.requests.length-start,3);
  assert.ok(fetched.data.filter(row=>!ids(next).includes(row.id)).every(row=>ids(third).includes(row.id)),'unconsumed server hits survive');
});

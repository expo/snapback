import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import {createHash} from 'node:crypto';
import { createLocalClient } from '../dist/local.js';
import { webDevice, memoryPersistence } from '../dist/web.js';
import { processDevice } from '../dist/native.js';
import { server, until } from './helpers/app-server.mjs';
import { hangBudget } from './helpers/wait.mjs';
export const source = `use personas alice, bob
 table docs:
  owner: principal
  doc: file <=100000 ('application/pdf', 'audio/wav', 'audio/mpeg', 'audio/flac') ?
  read <- .owner = viewer
  insert <- .owner = viewer
  sync to .owner
mutation attach(doc: file <=100000):
  return insert docs { owner: viewer, doc }
query mine():
  docs where .owner = viewer first 100 by .id
`.replace(' table docs:', 'table docs:');
const pdf = new Uint8Array(Buffer.from('%PDF-1.7\n'));
const op = { kind: 'mutation', name: 'attach' };
const wasm = readFileSync(new URL('../dist/wasm/snapback4_device_bg.wasm', import.meta.url));
for (const tier of ['memory', 'sqlite']) test(`${tier}: captured bytes survive reopen; lost upload reply and failed readiness dedup before one placement`, { timeout: hangBudget(120) }, async t => {
  const { url } = await server(t, undefined, source);
  const dir = mkdtempSync(join(tmpdir(), 'sb4-upload-')); t.after(() => rmSync(dir, { recursive: true, force: true }));
  const persist = memoryPersistence(); let offline = false, lost = true, failReady = true, uploads = 0, placements = 0;
  const assetIds = new Set(); const clients = [];
  t.after(async () => { for (const c of clients) await c.close(); });
  const native = processDevice({ dir });
  const fetcher = async (input, init) => {
    const path = new URL(input).pathname;
    if (offline) throw Error('offline');
    if (path === '/assets') {
      uploads++;
      const response = await fetch(input, init); const json = await response.clone().json(); if (json.asset) assetIds.add(json.asset.id);
      if (lost) { lost = false; throw Error('lost accepted upload reply'); }
      return response;
    }
    if (path.startsWith('/m/')) { placements++; assert.equal(failReady, false, 'mutation cannot overtake an uncommitted upload dependency'); }
    return fetch(input, init);
  };
  const open = async () => {
    const opener = tier === 'sqlite' ? native : webDevice({ wasm, persist });
    const client = await createLocalClient({ url, persona: 'alice', fetch: fetcher,
      device: { async open(...args) { const core = await opener.open(...args); return { ...core, async call(request, committed) {
        if (request.op === 'upload_ready' && failReady) throw Error('readiness disk failed before commit');
        return core.call(request, committed);
      } }; } } });
    clients.push(client); return client;
  };
  let c = await open(); offline = true;
  const selected = new Uint8Array(pdf);
  const captured = await c.uploadAndPlace(op, {}, selected, { argument: 'doc', id: 'capture1', file: { type: 'application/pdf', name: 'a.pdf' } });
  assert.equal(captured.state, 'queued'); selected.fill(0);
  assert.equal(placements, 0); await c.close(); c = await open();
  assert.equal((await c.uploads())[0].id, 'capture1');
  offline = false; await c.sync();
  await until(() => uploads >= 2, 'lost-reply upload replay');
  assert.equal(placements, 0); assert.equal(assetIds.size, 1);
  await c.close(); failReady = false; c = await open();
  await until(async () => (await c.uploadIntent('capture1'))?.state === 'sent', 'one placing mutation');
  assert.equal(placements, 1); assert.equal(assetIds.size, 1);
  const read = await c.query({ kind: 'query', name: 'mine' }, {});
  assert.equal(read.data.length, 1); assert.equal(read.data[0].doc.id, [...assetIds][0]);
});

test('wire upload id dedup compares bytes and metadata, isolates owners, survives cancel and sniffs audio', { timeout: hangBudget(120) }, async t => {
  const { url } = await server(t, undefined, source);
  const post = (query, body = pdf, persona = 'alice') => fetch(url + '/assets' + query, { method: 'POST', headers: { 'x-snapback-persona': persona, 'content-type': 'application/pdf' }, body }).then(r => r.json());
  const store = (await fetch(url + '/probe', { headers: { 'x-snapback-persona': 'alice' } }).then(r => r.json())).store_id;
  const declaration={digest:createHash('sha256').update(pdf).digest('hex'),file:{type:'application/pdf',name:'a.pdf'},placement:{op:'attach',args:{},argument:'doc'}};
  for(const persona of ['alice','bob'])assert.equal((await fetch(`${url}/assets/intent/wire1/declare?store_id=${store}`,{method:'POST',headers:{'x-snapback-persona':persona,'content-type':'application/json'},body:JSON.stringify(declaration)}).then(r=>r.json())).ok,true);
  const query = `?as=file&name=a.pdf&intent=wire1&store_id=${store}`;
  const [a,b] = await Promise.all([post(query), post(query)]);
  assert.ok(a.asset, JSON.stringify(a)); assert.equal(a.asset.id, b.asset.id);
  assert.equal((await post(query, new Uint8Array(Buffer.from('%PDF-1.4\n')))).denied.code, 'E_ASSET_INTENT_REUSE');
  assert.equal((await post(query.replace('name=a.pdf', 'name=b.pdf'))).denied.code, 'E_ASSET_INTENT_REUSE');
  assert.notEqual((await post(query, pdf, 'bob')).asset.id, a.asset.id);
  assert.equal((await post(query.replace(store, 'different'))).denied.code, 'E_STORE_REPLACED');
  const inventory=await fetch(`${url}/assets/intents?store_id=${store}`,{headers:{'x-snapback-persona':'alice'}}).then(r=>r.json());assert.equal(inventory.intents[0].id,'wire1');
  const noBinding=await post(query.replace(`&store_id=${store}`,''));assert.equal(noBinding.denied.code,'E_INPUT');
  const cancelled = await fetch(`${url}/assets/intent/wire1/cancel?store_id=${store}`, { method:'POST', headers:{'x-snapback-persona':'alice'} }).then(r=>r.json());
  assert.equal(cancelled.ok, true); assert.equal((await post(query)).denied.code, 'E_UPLOAD_CANCELLED');
  const wav = Buffer.alloc(46); wav.write('RIFF'); wav.writeUInt32LE(38,4); wav.write('WAVEfmt ',8); wav.writeUInt32LE(16,16); wav.writeUInt16LE(1,20); wav.writeUInt16LE(1,22); wav.writeUInt32LE(8000,24); wav.writeUInt32LE(16000,28); wav.writeUInt16LE(2,32); wav.writeUInt16LE(16,34); wav.write('data',36); wav.writeUInt32LE(2,40);
  const flac = Buffer.alloc(42); flac.write('fLaC'); flac[4] = 128; flac[7] = 34;
  const mp3 = Buffer.alloc(417); mp3.set([255,251,144,0]);
  for (const [body,type] of [[wav,'audio/wav'],[flac,'audio/flac'],[mp3,'audio/mpeg']]) {
    const send = async bytes => (await fetch(`${url}/assets?as=file&name=audio`, { method:'POST', headers:{'x-snapback-persona':'alice','content-type':type}, body:bytes })).json();
    assert.equal((await send(body)).asset.type, type);
    assert.equal((await send(pdf)).denied.code, 'E_ASSET_TYPE');
    assert.equal((await send(body.subarray(0,8))).denied.code, 'E_ASSET_TYPE');
  }
});

test('public guarded capability rejects ordinary terminal id reuse and scopes subscriptions',{timeout:hangBudget(120)},async t=>{
  const {guardClient}=await import('../dist/app-client.js');
  const {mintId}=await import('../dist/client.js');
  const {url}=await server(t,undefined,source);const persist=memoryPersistence();
  const raw=await createLocalClient({url,persona:'alice',device:webDevice({wasm,persist})});t.after(()=>raw.close());
  let valid=true;const why=()=>({code:'E_AUTH',family:'auth',message:'retired'});
  const scope=guardClient(raw,async()=>valid,()=>valid,why);assert.equal(typeof scope.client.uploadAndPlace,'function');
  const id=mintId();
  const capture=await scope.client.uploadAndPlace(op,{},pdf,{id,argument:'doc',file:{type:'application/pdf',name:'a.pdf'}});
  assert.notEqual(capture.state,'failed');await until(async()=>(await raw.uploadIntent(id))?.state==='sent','terminal upload identity');
  const repeated=await scope.client.uploadAndPlace(op,{},pdf,{id,argument:'doc',file:{type:'application/pdf',name:'a.pdf'}});assert.equal(repeated.state,'sent');
  const changed=await scope.client.uploadAndPlace(op,{},new Uint8Array([1]),{id,argument:'doc',file:{type:'application/pdf',name:'a.pdf'}});assert.equal(changed.why.code,'E_WRITE_ID_REUSE');
  let notices=0;const stop=scope.client.onUploads(()=>notices++);const before=notices;valid=false;scope.fence()();assert.ok(notices>=before);
  const refused=await scope.client.uploadAndPlace(op,{},pdf,{argument:'doc',file:{type:'application/pdf'}});assert.equal(refused.state,'failed');assert.equal(refused.why.code,'E_AUTH');
  assert.deepEqual(await scope.client.uploads(),[]);stop();
});

test('close stops waiting for a hung upload and fences its late response without losing custody',{timeout:hangBudget(120)},async t=>{
  const {url}=await server(t,undefined,source);const persist=memoryPersistence();let release;let started=false;
  const fetcher=async(input,init)=>{if(new URL(input).pathname==='/assets'){started=true;return new Promise(r=>release=r);}return fetch(input,init);};
  const c=await createLocalClient({url,persona:'alice',fetch:fetcher,device:webDevice({wasm,persist})});
  await c.uploadAndPlace(op,{},pdf,{id:'close-upload',argument:'doc',file:{type:'application/pdf',name:'a.pdf'}});await until(()=>started,'held upload');await c.close();
  release(Response.json({asset:{id:'late',type:'application/pdf',bytes:pdf.length,width:null,height:null,duration:null,name:'a.pdf'}}));
  const restored=await createLocalClient({url,persona:'alice',fetch:async()=>{throw Error('offline');},device:webDevice({wasm,persist})});t.after(()=>restored.close());
  assert.equal((await restored.uploads())[0].id,'close-upload');
  const saved=[...persist.stores.values()].flatMap(store=>[...store.values()]).filter(c=>c.s==='o'&&c.v).map(c=>JSON.parse(c.v));
  assert.equal(saved.find(e=>e.id==='close-upload').upload.bytes,Buffer.from(pdf).toString('hex'));
});

test('file capture normalizes bounded metadata before custody; a shared ordinary receipt survives a full local history',async t=>{
  const {captureFile}=await import('../dist/files.js');
  assert.deepEqual(captureFile(new Uint8Array([1]),{name:'../../secret/é.pdf',type:'Application/PDF; charset=binary'}),{name:'é.pdf',type:'application/pdf'});
  assert.ok(Buffer.byteLength(captureFile(pdf,{name:'é'.repeat(300)}).name)<=255);
  assert.throws(()=>captureFile(pdf,{type:'x'.repeat(1000000)}),e=>e.code==='E_UPLOAD_ARGUMENT');
  const {url}=await server(t,undefined,source);const persist=memoryPersistence();let core,name;
  const opener=webDevice({wasm,persist});
  const client=await createLocalClient({url,persona:'alice',device:{async open(...a){name=a[0];return core=await opener.open(...a);}}});t.after(()=>client.close());
  const history=Array.from({length:256},(_,i)=>({id:'local'+i,state:'failed',why:{code:'E_RULE',family:'rule',message:'local'}}));
  await core.call({op:'set_meta',key:'write-history',value:JSON.stringify(history)});
  await persist.save(name+':receipts',[{s:'m',k:'client:write-history',v:JSON.stringify([{id:'ordinary-shared',state:'sent',seq:1,replayed:true}])}]);
  const result=await client.uploadAndPlace(op,{},pdf,{id:'ordinary-shared',argument:'doc',file:{name:'a.pdf',type:'application/pdf'}});
  assert.equal(result.state,'failed');assert.equal(result.why.code,'E_WRITE_ID_REUSE');
  assert.equal((await client.uploads()).length,0);
});

test('default orphan adoption preserves conflicting bytes and the entire source suffix',async t=>{
  const backend=JSON.parse(readFileSync(new URL('./chat-schema.json',import.meta.url),'utf8'));
  backend.programs.find(p=>p.name==='send').args.photo={Optional:{Image:{max:100000}}};
  const persist=memoryPersistence(),opener=webDevice({wasm,persist});
  const first=await opener.open('orphan-conflict',backend),second=await opener.open('orphan-conflict',backend);
  for(const core of [first,second])assert.ok(!(await core.call({op:'apply',first:true,page:{snapshot:true,store_id:'A',generation:1,events:[],watermark:0,more:false}})).denied);
  const entry=bytes=>({id:'collision',seq:1,op:'send',args:{body:'captured',conversationId:'c1'},viewer:'dev:alice',now:1,upload:{bytes,argument:'photo',store_id:'A'},new_ids:[],predicted:[],predictable:false});
  assert.ok(!(await first.call({op:'admit_upload',entry:entry('ff')})).denied);
  assert.ok(!(await second.call({op:'admit_upload',entry:entry('ee')})).denied);
  assert.ok(!(await second.call({op:'enqueue',entry:{id:'tail-source',seq:2,op:'send',args:{body:'later',conversationId:'c1'},viewer:'dev:alice',now:1,new_ids:[],predicted:[],predictable:false}})).denied);
  await first.close();await second.close();
  const destination=await opener.open('orphan-conflict',null);t.after(()=>destination.close());
  const queue=(await destination.call({op:'queued'})).ok;
  assert.equal(queue.find(e=>e.id==='collision').upload.bytes,'ff');assert.equal(queue.some(e=>e.id==='tail-source'),false);
  const source=[...persist.stores.values()].map(store=>[...store.values()].filter(c=>c.s==='o'&&c.v).map(c=>JSON.parse(c.v))).find(entries=>entries.some(e=>e.upload?.bytes==='ee'));
  assert.ok(source,'conflicting source store retains its selected bytes');assert.ok(source.some(e=>e.id==='tail-source'),'source suffix cannot overtake its held capture');
});

test('opening recovery cannot evict applicable shared ownership before upload preflight',async t=>{
  const backend=JSON.parse(readFileSync(new URL('./chat-schema.json',import.meta.url),'utf8'));backend.programs.find(p=>p.name==='send').args.photo={Optional:{Image:{max:100000}}};
  const persist=memoryPersistence(),opener=webDevice({wasm,persist}),name='preflight-history';
  const first=await opener.open(name,backend),second=await opener.open(name,backend);
  for(const [i,core]of [first,second].entries()){
    await core.call({op:'apply',first:true,page:{snapshot:true,store_id:'A',generation:1,events:[],watermark:0,more:false}});
    await core.call({op:'set_meta',key:'write-history',value:JSON.stringify(Array.from({length:256},(_,n)=>({id:`window${i}-${n}`,state:'sent',seq:1,replayed:true})))});
  }
  await first.close();await second.close();
  await persist.save(name+':receipts',[{s:'m',k:'client:write-history',v:JSON.stringify([{id:'protected',state:'sent',seq:1,replayed:true}])}]);
  const destination=await opener.open(name,null);t.after(()=>destination.close());
  const response=await destination.call({op:'admit_upload',entry:{id:'protected',seq:1,op:'send',args:{body:'new',conversationId:'c1'},viewer:'dev:alice',now:1,upload:{bytes:'ff',argument:'photo',store_id:'A'}}});
  assert.equal(response.denied.code,'E_WRITE_ID_REUSE');
  assert.equal((await destination.call({op:'queued'})).ok.some(e=>e.id==='protected'),false);
});

test('acknowledged remote cancellation survives original-owner retirement',async()=>{
  const {DeviceUploads}=await import('../dist/uploads.js');let current=true,revision=1;
  const uploads=new DeviceUploads({base:'http://media.invalid',viewer:'alice',current:()=>current,unavailable:()=>null,
    storeId:()=> 'A',capture:async()=>({store_id:'A'}),credentials:()=>({headers:{authorization:'Bearer original'},revision}),
    fetch:async()=>({ok:true,json:async()=>{current=false;revision++;return {ok:true};}})});
  assert.deepEqual(await uploads.cancelServerUpload('same'),{ok:true});
});

test('transfer protects shared ownership from source-history trimming',async t=>{
  const backend=JSON.parse(readFileSync(new URL('./chat-schema.json',import.meta.url),'utf8'));backend.programs.find(p=>p.name==='send').args.photo={Optional:{Image:{max:100000}}};
  const persist=memoryPersistence(),opener=webDevice({wasm,persist}),name='transfer-history';
  const first=await opener.open(name,backend),second=await opener.open(name,backend);
  for(const [i,core]of [first,second].entries()){
    await core.call({op:'apply',first:true,page:{snapshot:true,store_id:'A',generation:1,events:[],watermark:0,more:false}});
    await core.call({op:'set_meta',key:'write-history',value:JSON.stringify(Array.from({length:256},(_,n)=>({id:`h${i}-${n}`,state:'sent',seq:1,replayed:true})))});
  }
  await second.call({op:'admit_upload',entry:{id:'protected',seq:1,op:'send',args:{body:'orphan',conversationId:'c1'},viewer:'dev:alice',now:1,upload:{bytes:'ff',argument:'photo',store_id:'A'}}});
  await first.close();await second.close();
  await persist.save(name+':receipts',[{s:'m',k:'client:write-history',v:JSON.stringify([{id:'protected',state:'sent',seq:1,replayed:true}])}]);
  const destination=await opener.open(name,null);t.after(()=>destination.close());
  assert.equal((await destination.call({op:'queued'})).ok.some(e=>e.id==='protected'),false);
  const copies=[...persist.stores.values()].flatMap(s=>[...s.values()]).filter(c=>c.s==='o'&&c.v).map(c=>JSON.parse(c.v));
  assert.equal(copies.find(e=>e.id==='protected').upload.bytes,'ff');
});

test('remote cancellation owns response body through lifetime abort',async()=>{
  const {DeviceUploads}=await import('../dist/uploads.js');const lifetime=new AbortController();let finish,entered=false,current=true;
  const uploads=new DeviceUploads({base:'http://media.invalid',viewer:'alice',signal:lifetime.signal,current:()=>current,unavailable:()=>null,storeId:()=> 'A',
    capture:async()=>({store_id:'A'}),credentials:()=>({headers:{},revision:1}),
    fetch:async(_input,init)=>{assert.equal(init.signal,undefined);return {ok:true,json:()=>{entered=true;return new Promise(r=>finish=r);}};}});
  const outcome=uploads.cancelServerUpload('same');await until(()=>entered,'response parser');current=false;lifetime.abort();finish({ok:true});assert.deepEqual(await outcome,{ok:true});
});


test('matching shared receipt cannot erase conflicting live orphan custody',async t=>{
  const backend=JSON.parse(readFileSync(new URL('./chat-schema.json',import.meta.url),'utf8'));backend.programs.find(p=>p.name==='send').args.photo={Optional:{Image:{max:100000}}};
  const persist=memoryPersistence(),opener=webDevice({wasm,persist}),name='shared-live-conflict';
  const first=await opener.open(name,backend),second=await opener.open(name,backend);
  for(const core of [first,second])await core.call({op:'apply',first:true,page:{snapshot:true,store_id:'A',generation:1,events:[],watermark:0,more:false}});
  const entry=bytes=>({id:'collision',seq:1,op:'send',args:{body:'capture',conversationId:'c1'},viewer:'dev:alice',now:1,upload:{bytes,argument:'photo',store_id:'A'}});
  await first.call({op:'admit_upload',entry:entry('ee')});await second.call({op:'admit_upload',entry:entry('ff')});
  const original=(await second.call({op:'queued'})).ok[0];
  await second.call({op:'enqueue',entry:{id:'held-tail',seq:2,op:'send',args:{body:'later',conversationId:'c1'},viewer:'dev:alice',now:1}});
  await first.close();await second.close();
  await persist.save(name+':receipts',[{s:'m',k:'client:write-history',v:JSON.stringify([{id:'collision',state:'sent',seq:1,replayed:true,upload_identity:{fingerprint:original.upload.fingerprint,op:original.op,viewer:original.viewer,store_id:'A'}}])}]);
  const dest=await opener.open(name,null);t.after(()=>dest.close());const queued=(await dest.call({op:'queued'})).ok;
  assert.equal(queued.find(e=>e.id==='collision').upload.bytes,'ee');assert.equal(queued.some(e=>e.id==='held-tail'),false);
  const copies=[...persist.stores.values()].map(s=>[...s.values()].filter(c=>c.s==='o'&&c.v).map(c=>JSON.parse(c.v)));
  assert.ok(copies.some(items=>items.some(e=>e.upload?.bytes==='ff')&&items.some(e=>e.id==='held-tail')));
});

test('entering shared ownership survives histories of earlier orphans in the same pass',async t=>{
  const backend=JSON.parse(readFileSync(new URL('./chat-schema.json',import.meta.url),'utf8'));backend.programs.find(p=>p.name==='send').args.photo={Optional:{Image:{max:100000}}};
  const persist=memoryPersistence(),opener=webDevice({wasm,persist}),name='multiple-orphan-history';
  const devices=await Promise.all([opener.open(name,backend),opener.open(name,backend),opener.open(name,backend)]);
  for(const [i,core]of devices.entries()){
    await core.call({op:'apply',first:true,page:{snapshot:true,store_id:'A',generation:1,events:[],watermark:0,more:false}});
    if(i===1)await core.call({op:'set_meta',key:'write-history',value:JSON.stringify(Array.from({length:256},(_,n)=>({id:'evict'+n,state:'sent',seq:1,replayed:true})))});
  }
  await devices[2].call({op:'admit_upload',entry:{id:'protected',seq:1,op:'send',args:{body:'capture',conversationId:'c1'},viewer:'dev:alice',now:1,upload:{bytes:'ff',argument:'photo',store_id:'A'}}});
  for(const core of devices)await core.close();
  await persist.save(name+':receipts',[{s:'m',k:'client:write-history',v:JSON.stringify([{id:'protected',state:'sent',seq:1,replayed:true}])}]);
  const dest=await opener.open(name,null);t.after(()=>dest.close());assert.equal((await dest.call({op:'queued'})).ok.some(e=>e.id==='protected'),false);
  assert.ok([...persist.stores.values()].some(s=>[...s.values()].some(c=>c.s==='o'&&c.v&&JSON.parse(c.v).id==='protected')));
});


test('readiness schema refusal persists blocked reason and stops automatic uploads',async t=>{
  const {DeviceUploads}=await import('../dist/uploads.js');
  const backend=JSON.parse(readFileSync(new URL('./chat-schema.json',import.meta.url),'utf8'));backend.programs.find(p=>p.name==='send').args.photo={Optional:{Image:{max:100000}}};
  const persist=memoryPersistence(),core=await webDevice({wasm,persist}).open('readiness-schema',backend);t.after(()=>core.close());
  await core.call({op:'apply',first:true,page:{snapshot:true,store_id:'A',generation:1,events:[],watermark:0,more:false}});
  let attempts=0;const env={base:'http://media.invalid',viewer:'dev:alice',current:()=>true,unavailable:()=>null,storeId:()=> 'A',capture:async()=>({store_id:'A'}),credentials:()=>({headers:{},revision:1}),
    entry:(id,op,args)=>({id,seq:1,op,args,viewer:'dev:alice',now:1}),call:r=>core.call(r),queued:async()=>(await core.call({op:'queued'})).ok,notify(){},flush(){},
    fetch:async input=>{if(new URL(input).pathname.endsWith('/declare'))return Response.json({ok:true});attempts++;return Response.json({asset:{id:'asset1',type:'image/png',bytes:4,width:1,height:1,duration:null}});}};
  const uploads=new DeviceUploads(env);await uploads.uploadAndPlace({kind:'mutation',name:'send'},{conversationId:'c1',body:'capture'},new Uint8Array([137,80,78,71]),{id:'schema-change',argument:'photo'});
  const changed=structuredClone(backend);delete changed.programs.find(p=>p.name==='send').args.photo;
  const revision=(await core.call({op:'sync_state',capture:false})).ok.send_revision;assert.ok(!(await core.call({op:'adopt',backend:changed,store_id:'A',send_revision:revision})).denied);
  await uploads.prepare((await env.queued())[0]);const held=(await env.queued())[0];assert.equal(held.upload.state,'blocked');assert.equal(held.upload.why.code,'E_UPLOAD_ARGUMENT');assert.equal(held.upload.bytes,'89504e47');
  await uploads.prepare(held);assert.equal(attempts,1,'permanent readiness refusal waits for explicit retry/discard');
});

test('HTTP media placement cannot execute after durable-to-ephemeral adoption', {timeout:hangBudget(120)},async t=>{
  const {url,dir}=await server(t,undefined,source,{watch:true});const headers={'x-snapback-persona':'alice','content-type':'application/json'};
  const store=(await fetch(url+'/probe',{headers}).then(r=>r.json())).store_id;
  const post=(path,value)=>fetch(url+path,{method:'POST',headers,body:JSON.stringify(value)}).then(r=>r.json());
  assert.equal((await post(`/assets/intent/converted/declare?store_id=${store}`,{digest:createHash('sha256').update(pdf).digest('hex'),file:{type:'application/pdf',name:'a.pdf'},placement:{op:'attach',args:{},argument:'doc'}})).ok,true);
  const uploaded=await fetch(`${url}/assets?as=file&name=a.pdf&intent=converted&store_id=${store}`,{method:'POST',headers:{...headers,'content-type':'application/pdf'},body:pdf}).then(r=>r.json());assert.ok(uploaded.asset);
  const replacement=source.replace('return insert docs { owner: viewer, doc }','return insert live { owner: viewer }')+'\ntable live:\n  owner: principal\n  read <- .owner = viewer\n  insert <- .owner = viewer\n  ephemeral 1m\nquery active():\n  live first 100 by .id\n';
  writeFileSync(join(dir,'snapback/schema.q'),replacement);
  await until(async()=>{const backend=await fetch(url+'/schema',{headers}).then(r=>r.json());return backend.schema?.operations?.attach?.ephemeral;},'ephemeral adoption');
  const payload={id:'converted',store_id:store,args:{doc:uploaded.asset}};
  for(let i=0;i<2;i++)assert.equal((await post('/m/attach',payload)).why.code,'E_UPLOAD_INTENT');
  const active=await post('/q/active',{args:{}});assert.deepEqual(active.data,[]);
  const finalized=await post(`/assets/intent/converted/finish?store_id=${store}`,{op:'attach',args:payload.args,why:{code:'E_UPLOAD_INTENT',family:'asset',message:'operation became ephemeral'}});assert.equal(finalized.state,'failed');
  assert.equal((await post('/m/attach',payload)).replayed,true);
  assert.deepEqual((await fetch(`${url}/assets/intents?store_id=${store}`,{headers}).then(r=>r.json())).intents,[]);
});

test('HTTP declaration and refusal finalization enforce persisted metadata bounds',async t=>{
  const {url}=await server(t,undefined,source);const headers={'x-snapback-persona':'alice','content-type':'application/json'};
  const store=(await fetch(url+'/probe',{headers}).then(r=>r.json())).store_id;
  const post=(path,value)=>fetch(url+path,{method:'POST',headers,body:JSON.stringify(value)}).then(r=>r.json());
  const declaration={digest:createHash('sha256').update(pdf).digest('hex'),file:{name:'a.pdf',type:'application/pdf'},placement:{op:'attach',args:{},argument:'doc'}};
  const large=structuredClone(declaration);large.placement.args.body='x'.repeat(64<<10);
  assert.equal((await post(`/assets/intent/too-large/declare?store_id=${store}`,large)).denied.code,'E_UPLOAD_ARGUMENT');
  const envelope=structuredClone(declaration);envelope.padding='x'.repeat(96<<10);
  assert.equal((await post(`/assets/intent/envelope/declare?store_id=${store}`,envelope)).denied.code,'E_UPLOAD_ARGUMENT');
  assert.equal((await post(`/assets/intent/bounded/declare?store_id=${store}`,declaration)).ok,true);
  const uploaded=await fetch(`${url}/assets?as=file&name=a.pdf&intent=bounded&store_id=${store}`,{method:'POST',headers:{...headers,'content-type':'application/pdf'},body:pdf}).then(r=>r.json());
  const body={op:'attach',args:{doc:uploaded.asset},why:{code:'E_INPUT',family:'input',message:'x'.repeat(4097)}};
  assert.equal((await post(`/assets/intent/bounded/finish?store_id=${store}`,body)).denied.code,'E_UPLOAD_ARGUMENT');
  for(const field of ['code','family','guide']){body.why={code:'E_INPUT',family:'input',message:'bounded',[field]:'x'.repeat(129)};assert.equal((await post(`/assets/intent/bounded/finish?store_id=${store}`,body)).denied.code,'E_UPLOAD_ARGUMENT');}
  assert.equal((await fetch(`${url}/assets/intents?store_id=${store}`,{headers}).then(r=>r.json())).intents[0].id,'bounded','rejected finalization keeps recoverable pin');
  body.why={code:'E_INPUT',family:'input',message:'bounded'};assert.equal((await post(`/assets/intent/bounded/finish?store_id=${store}`,body)).state,'failed');
});

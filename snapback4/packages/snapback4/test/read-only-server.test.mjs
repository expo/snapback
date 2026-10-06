// @ref LLP 3000.033#3 — the receipts oracle, ephemeral live adoption, and a real published downgrade.
import test from 'node:test';
import assert from 'node:assert/strict';
import { spawn, spawnSync } from 'node:child_process';
import { readFileSync, mkdtempSync, mkdirSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { createClient } from 'snapback4/client';
import { createApp } from 'snapback4/app';
import { storeKey } from '../dist/app-storage.js';
import { signup, login, narrowSession, sessionKey } from 'snapback4/auth';
import { server, binary, until } from './helpers/app-server.mjs';
import { hangBudget } from './helpers/wait.mjs';
const password = 'read-only-acceptance-password';
const receiptCard = readFileSync(resolve(import.meta.dirname, '../../../crates/snapback4-lang/src/guide/receipts.rs'), 'utf8');
const schema = 'use identity\n' + receiptCard.match(/```quarry\n([\s\S]*?)```/)[1] + `
mutation create():
  c = insert conversations {creatorId: viewer}
  insert members {conversation: c.id, principal: viewer}
  return c.id
query apiHistory(conversation: conversations, c: cursor ?):
  return messages where .conversation = conversation last 2 by .ordinal after c {id, text, ordinal, receiptState: receipt(.)}
table typing:
  owner: principal
  ephemeral 4s
  read <- allow
  insert <- .owner = viewer
query typingNow():
  return typing first 10
`;
function runOracle(input, api) {
  return new Promise((resolve, reject) => {
    const child = spawn(process.execPath, [join(import.meta.dirname, 'helpers/native-oracle-read-only.mjs')], {
      env: { ...process.env, CLIQUE_BOB_EMAIL: 'bob@read.test', CLIQUE_BOB_PASSWORD: password, CLIQUE_GENERATED_API: api }, stdio: ['pipe', 'pipe', 'pipe'],
    });
    let out = '', err = ''; child.stdout.on('data', b => { out += b; }); child.stderr.on('data', b => { err += b; });
    child.on('error', reject); child.on('exit', code => code === 0 ? resolve(JSON.parse(out)) : reject(Error(err)));
    child.stdin.end(JSON.stringify(input));
  });
}
test('Phase-2 oracle: fresh read-only Bob login and generated pagination leave delivery unchanged; live ephemeral adoption converges', { timeout: hangBudget(20) }, async t => {
  const { url, dir } = await server(t, undefined, schema);
  const apiPath = join(dir, 'snapback/generated/api.ts'), { api } = await import(apiPath);
  const alice = await signup(url, 'alice@read.test', password), bob = await signup(url, 'bob@read.test', password);
  assert.ok(alice.ok && bob.ok);
  const writer = createClient({ url, session: alice.session }); t.after(() => writer.close());
  const chat = await writer.mutate(api.create, {}); assert.equal(chat.state, 'sent'); const conversation = chat.result;
  assert.equal((await writer.mutate(api.add, { conversation, principal: bob.session.principal })).state, 'sent');
  for (let i=0;i<7;i++) assert.equal((await writer.mutate(api.send, { conversation, text: `message ${i}` })).state, 'sent');
  const db = new DatabaseSync(join(dir, '.snapback4/store.sqlite'), { readOnly: true }); t.after(() => db.close());
  // Query the generated receipt member through raw HTTP so the witness itself cannot report delivery.
  const raw = async (op, args, session=bob.session) => (await fetch(`${url}/q/${op}`, {method:'POST',headers:{authorization:`Bearer ${session.token}`},body:JSON.stringify({args})})).json();
  const before = await raw('receiptMember', { conversation });
  const opsBefore = db.prepare('SELECT COUNT(*) AS n FROM _ops').get().n;
  const oracle = await runOracle({ protocol:'clique-native/1', origin:url, conversationId:conversation }, apiPath);
  assert.equal(oracle.principal, bob.session.principal); assert.equal(oracle.complete, true); assert.equal(oracle.rows.length, 7);
  assert.deepEqual(oracle.rows.map(r=>r.body), Array.from({length:7},(_,i)=>`message ${i}`));
  assert.deepEqual((await raw('receiptMember', {conversation})).data, before.data);
  assert.equal(db.prepare('SELECT COUNT(*) AS n FROM _ops').get().n, opsBefore);
  const read = await login(url, 'bob@read.test', password, {scope:'read'}); assert.ok(read.ok);
  const requests=[], observer=createClient({url,session:read.session,readOnly:true,waitSeconds:1,fetch:async (input,init)=>{requests.push(new URL(input).pathname);return fetch(input,init);}});
  t.after(()=>observer.close());
  const watch=observer.observe(api.apiHistory,{conversation,c:null}), stop=watch.subscribe(()=>{});t.after(stop);
  await until(()=>watch.getSnapshot().data?.length===2,'initial read page');
  assert.equal((await writer.mutate(api.send,{conversation,text:'live update'})).state,'sent');
  await until(()=>watch.getSnapshot().data?.some(m=>m.text==='live update'),'read-only live convergence');
  assert.ok(requests.includes('/schema')); assert.ok(requests.includes('/changes'));
  assert.equal(requests.some(p=>p.startsWith('/m/')),false);
  assert.deepEqual((await raw('receiptMember',{conversation})).data,before.data);
  // A full reader on the same reused server still constructs and reports delivery.
  const full=createClient({url,session:bob.session});t.after(()=>full.close());
  let c=null;do{const page=await full.query(api.apiHistory,{conversation,c});c=page.next??null;}while(c);
  await until(async()=>JSON.stringify((await raw('receiptMember',{conversation})).data)!==JSON.stringify(before.data),'full delivery reporting');
  const stored=new Map([[sessionKey(url),JSON.stringify(bob.session)],[sessionKey(url,true),JSON.stringify(read.session)],
    [storeKey('writes',url,bob.session.principal),'pending interactive journal']]);
  const original=new Map(stored);
  const app=createApp({url,readOnly:true,sessionStore:{async get(k){return stored.get(k)??null;},async set(k,v){assert.match(k,/^[A-Za-z0-9._-]+$/);stored.set(k,v);},async delete(k){stored.delete(k);}}});
  assert.ok((await app.ready).ok);assert.ok((await app.client.refreshSession()).ok);await app.close();
  assert.equal(stored.get(sessionKey(url)),original.get(sessionKey(url)));
  assert.equal(stored.get(storeKey('writes',url,bob.session.principal)),'pending interactive journal');
  assert.equal((await full.mutate(api.send,{conversation,text:'interactive still live'})).state,'sent');
});

test('previous published binary refuses migrated read credentials and logoutAll survives re-upgrade', {timeout:hangBudget(20), skip:!process.env.SNAPBACK4_PREVIOUS_PUBLISHED_BIN && 'set SNAPBACK4_PREVIOUS_PUBLISHED_BIN to the verified npm 0.4.13 binary'}, async t=>{
  const dir=mkdtempSync(join(tmpdir(),'sb4-ro-downgrade-'));mkdirSync(join(dir,'snapback'));
  writeFileSync(join(dir,'snapback/schema.q'),'use identity\nquery who():\n  return viewer\n');
  let child;
  const stop=async()=>{if(child&&child.exitCode===null){const done=new Promise(r=>child.once('exit',r));child.kill('SIGTERM');await done;}child=undefined;};
  t.after(async()=>{await stop();rmSync(dir,{recursive:true,force:true});});
  async function start(bin){let output='';child=spawn(bin,['dev','--port','0','--no-watch'],{cwd:dir,stdio:['ignore','pipe','pipe']});child.stdout.on('data',b=>{output+=b;});child.stderr.on('data',b=>{output+=b;});return until(()=>{assert.equal(child.exitCode,null,output);return output.match(/http:\/\/127\.0\.0\.1:\d+(?=\r?\n)/)?.[0];},'server generation');}
  let url=await start(binary);const full=await signup(url,'downgrade@read.test',password);assert.ok(full.ok);
  const read=await narrowSession(url,full.session);assert.ok(read.ok);
  await stop();url=await start(process.env.SNAPBACK4_PREVIOUS_PUBLISHED_BIN);
  const query=async token=>(await fetch(`${url}/q/who`,{method:'POST',headers:{authorization:`Bearer ${token}`},body:'{"args":{}}'})).json();
  assert.equal((await query(read.session.token)).denied.code,'E_AUTH');
  const logout=await (await fetch(`${url}/auth/logout-all`,{method:'POST',headers:{authorization:`Bearer ${full.session.token}`},body:'{}'})).json();assert.equal(logout.ok,true);
  await stop();url=await start(binary);
  assert.equal((await query(read.session.token)).denied.code,'E_AUTH');
  const db=new DatabaseSync(join(dir,'.snapback4/store.sqlite'),{readOnly:true});
  try {const row=db.prepare('SELECT principal_generation FROM _read_sessions').get();assert.ok(row);assert.ok(db.prepare('SELECT generation FROM _principal_generations WHERE principal=?').get(full.session.principal).generation>row.principal_generation);}finally{db.close();}
});

test('forbidden reads leave no transient row, ephemeral write, provider call or poisoned id; full sibling executes fresh', {timeout:hangBudget(15)}, async t=>{
  const {runWorker}=await import('../dist/worker.js');const {createServer}=await import('node:http');
  let calls=0;const provider=createServer((_req,res)=>{calls++;res.end('{}');});
  await new Promise(r=>provider.listen(0,'127.0.0.1',r));t.after(()=>new Promise(r=>provider.close(r)));
  const {url,dir}=await server(t,undefined,`use identity
use server
effect notify
action external()
route declared: post "/declared" wait 1s
table transient:
  owner: principal
  until: time
  read <- allow
  insert <- .owner = viewer
  expire at .until
mutation write():
  insert transient {owner:viewer, until:now + 10000}
  emit notify {n:1}
table typing:
  owner: principal
  ephemeral 4s
  read <- allow
  insert <- .owner = viewer
mutation typeNow():
  insert typing {owner:viewer}
query typingNow():
  return typing first 10
`);
  const full=await signup(url,'barrier@read.test',password);assert.ok(full.ok);
  const read=await narrowSession(url,full.session);assert.ok(read.ok);
  let release;const held=new Promise(r=>{release=r;}),startup=[];
  const mistaken=createClient({url,session:{...full.session,scope:'read',expiresAt:Date.now()+3600000},readOnly:true,fetch:async(input,init)=>{
    startup.push(new URL(input).pathname);await held;return fetch(input,init);
  }});
  const reading=mistaken.query({kind:'query',name:'typingNow'},{}),asset=mistaken.asset('once'),refresh=mistaken.refreshSession();
  const stopWatch=mistaken.observe({kind:'query',name:'typingNow'},{}).subscribe(()=>{});
  await until(()=>startup.length===1,'held probe');assert.deepEqual(startup,['/probe']);assert.deepEqual(mistaken.assetSource('once'),{uri:'',headers:{}});
  release();assert.equal((await reading).denied.code,'E_READ_ONLY_CREDENTIAL');assert.equal((await asset).denied.code,'E_READ_ONLY_CREDENTIAL');assert.equal((await refresh).why.code,'E_READ_ONLY_CREDENTIAL');stopWatch();await mistaken.close();
  assert.deepEqual(startup,['/probe']);
  const seat=spawnSync(binary,['token','--service','provider','--days','1'],{cwd:dir,encoding:'utf8'});assert.equal(seat.status,0,seat.stderr);
  const stop=new AbortController();let claimCycles=0;
  const worker=runWorker({url,token:seat.stdout.trim(),wait:0,signal:stop.signal,fetch:async(input,init)=>{
    const r=await fetch(input,init);if(new URL(input).pathname==='/effects/claim')claimCycles++;return r;
  },effects:{notify:async()=>{await fetch(`http://127.0.0.1:${provider.address().port}`);return null;}},actions:{external:async()=>{await fetch(`http://127.0.0.1:${provider.address().port}`);return null;}}});
  t.after(async()=>{stop.abort();await worker.done;});
  const db=new DatabaseSync(join(dir,'.snapback4/store.sqlite'),{readOnly:true});t.after(()=>db.close());
  const snapshot=()=>JSON.stringify(['r','_ops','_outbox','_requests','_effect_presence'].map(table=>[table,db.prepare(`SELECT * FROM ${table}`).all()]));
  const post=async(session,path,payload)=>(await fetch(url+path,{method:'POST',headers:{authorization:`Bearer ${session.token}`},body:JSON.stringify(payload)})).json();
  for(const path of ['/m/write','/m/typeNow','/a/external','/assets','/declared','/effects/claim','/actions/claim-set','/auth/session','/auth/narrow','/auth/revoke','/auth/logout-all']){
    const before=snapshot(),eph=await post(full.session,'/q/typingNow',{args:{}}),cycle=claimCycles;
    const refusal=await post(read.session,path,{id:'same-id',args:{}});
    assert.equal(refusal.denied.code,'E_READ_ONLY');assert.equal('head' in refusal,false);assert.equal('store_id' in refusal,false);
    assert.equal(snapshot(),before);assert.deepEqual((await post(full.session,'/q/typingNow',{args:{}})).data,eph.data);
    await until(()=>claimCycles>cycle,'worker observed the refusal barrier');assert.equal(calls,0);
  }
  const fresh=await post(full.session,'/m/write',{id:'same-id',args:{}});assert.equal(fresh.state,'sent');assert.notEqual(fresh.replayed,true);
  await until(()=>calls===1,'full sibling provider call');
  assert.equal((await post(read.session,'/m/write',{id:'same-id',args:{}})).denied.code,'E_READ_ONLY');
  assert.equal((await post(full.session,'/m/write',{id:'same-id',args:{}})).replayed,true);assert.equal(calls,1);
});

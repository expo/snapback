// @ref LLP 3000.023#11 — Astra round-3 reproduction, retained at the final publication boundary.
import test from 'node:test';
import assert from 'node:assert/strict';
import {setTimeout as delay} from 'node:timers/promises';
import { server } from './helpers/app-server.mjs';
import { parkedChanges } from './helpers/sync-control.mjs';
import { createClient } from '../dist/client.js';
import { guardClient } from '../dist/app-client.js';
import { guest, logout } from '../dist/auth.js';
const source=`use identity
table notes:
  body: text <=100
  public 'review fixture'
  online only
query list():
  return notes first 10 by .id
`;
for (const facade of [false, true]) for (const overlapping of [false, true]) test(`obsolete discovery E_AUTH cannot end the rotated session; facade=${facade}, overlapping=${overlapping}`, async t => {
 const f = await server(t, undefined, source), issued = await guest(f.url);
 assert.equal(issued.ok, true);
 const reached = Promise.withResolvers(), release = Promise.withResolvers(), rotated = Promise.withResolvers(), installed = Promise.withResolvers();
 let schemas = 0, queries = 0, obsolete;
 const raw = createClient({ url: f.url, session: issued.session, fetch: async (url, init) => {
  const path = new URL(url).pathname;
  if (path === '/changes') return parkedChanges(init.signal);
  if (path === '/q/list') queries++;
  if (path === '/auth/refresh') {
   const response = await fetch(url, init); rotated.resolve();
   if (overlapping) await release.promise;
   return response;
  }
  if (path === '/schema' && ++schemas === 1) {
   reached.resolve(); await rotated.promise;
   if (!overlapping) await installed.promise;
   const response = await fetch(url, init);
   obsolete = (await response.clone().json()).denied;
   assert.equal(response.status, 401); assert.equal(obsolete.code, 'E_AUTH');
   // Let discovery's obsolete-refusal handler encounter an in-flight rotation.
   if (overlapping) setTimeout(() => release.resolve(), 20);
   return response;
  }
  return fetch(url, init);
 } });
 t.after(async () => { rotated.resolve(); installed.resolve(); release.resolve(); await raw.close(); });
 const client = facade ? guardClient(raw, async () => true, () => true, () => ({ code: 'E_SCOPE', family: 'client', message: 'ended' })).client : raw;
 const reading = client.query({ kind: 'query', name: 'list' }, {});
 await reached.promise;
 const refreshed = await raw.refreshSession(); installed.resolve();
 assert.equal(refreshed.ok, true);
 const read = await reading;
 assert.deepEqual(read.data, []); assert.equal(read.complete, true);
 assert.equal(client.link(), 'online'); assert.notEqual(raw.session().token, issued.session.token);
 assert.ok(queries >= 2, 'the pre-rotation query candidate is reevaluated');
 assert.ok(schemas >= 2, 'discovery retries under the replacement credential');
 assert.deepEqual((await client.query({ kind: 'query', name: 'list' }, {})).data, []);
});

for(const facade of [false,true]) test(`current-credential E_AUTH from settlement discovery wins publication; facade=${facade}`,async t=>{
 const f=await server(t,undefined,source), issued=await guest(f.url);assert.equal(issued.ok,true);
 let refusal;
 const raw=createClient({url:f.url,session:issued.session,fetch:async(url,init)=>{
  const path=new URL(url).pathname;
  if(path==='/changes')return parkedChanges(init.signal);
  if(path==='/schema'){
   await logout(f.url,issued.session.token);
   const response=await fetch(url,init);refusal=(await response.clone().json()).denied;
   assert.equal(response.status,401);assert.equal(refusal.code,'E_AUTH');
   return response;
  }
  return fetch(url,init);
 }});
 t.after(()=>raw.close());
 const client=facade?guardClient(raw,async()=>true,()=>true,()=>({code:'E_SCOPE',family:'client',message:'ended'})).client:raw;
 const read=await client.query({kind:'query',name:'list'},{});
 console.log(JSON.stringify({facade,refusal,read,link:client.link()}));
 assert.deepEqual(read.denied,refusal,'a terminal schema refusal under this credential must retire the earlier query');
 assert.equal(client.link(),'signed-out');
 assert.deepEqual((await client.query({kind:'query',name:'list'},{})).denied,refusal,'DK reason remains retained');
});

for(const facade of [false,true]) test(`DK cause wakes an already parked dependent-write wait; facade=${facade}`,async t=>{
 const f=await server(t,undefined,source+"\nmutation touch(): server\n  insert notes {body:'new'}\n"),issued=await guest(f.url);assert.equal(issued.ok,true);
 const gate=Promise.withResolvers();let sent=false;
 const raw=createClient({url:f.url,session:issued.session,fetch:async(url,init)=>{
  const path=new URL(url).pathname;
  if(path==='/changes')return parkedChanges(init.signal);
  if(path==='/m/touch'){sent=true;await gate.promise;}
  return fetch(url,init);
 }});
 t.after(async()=>{gate.resolve();await raw.close();});
 const client=facade?guardClient(raw,async()=>true,()=>true,()=>({code:'E_SCOPE',family:'client',message:'ended'})).client:raw;
 const op={kind:'query',name:'list'};
 assert.ok('data' in await client.query(op,{}));
 assert.equal((await raw.mutate({kind:'mutation',name:'touch'},{},{waitSeconds:0})).state,'pending');
 let done=false;const reading=client.query(op,{}).then(r=>{done=true;return r;});
 await delay(80);assert.equal(sent,true);assert.equal(done,false);
 await logout(f.url,issued.session.token);
 const trigger=await raw.query(op,{}),read=await reading;
 console.log(JSON.stringify({facade,trigger,read}));
 assert.equal(trigger.denied?.code,'E_AUTH');assert.deepEqual(read.denied,trigger.denied);
 assert.equal(client.link(),'signed-out');
});

// A failed dependent write can leave the candidate's store cut unchanged. The
// facade must still repeat its asynchronous session-store approval after waiting.
test('facade authority is checked again after custody wakes without changing rows', async t => {
 const f = await server(t, undefined, source.replace("  public 'review fixture'", "  public 'review fixture'\n  insert <- false") + "\nmutation touch(): server\n  insert notes {body:'refused'}\n");
 const issued = await guest(f.url); assert.equal(issued.ok, true);
 const gate = Promise.withResolvers(), approved = Promise.withResolvers();
 let allowed = true, checking = false, approvals = 0, queries = 0;
 const raw = createClient({url:f.url, session:issued.session, fetch:async(url,init)=>{
  const path = new URL(url).pathname;
  if(path === '/changes') return parkedChanges(init.signal);
  if(path === '/m/touch') await gate.promise;
  if(path === '/q/list') queries++;
  return fetch(url,init);
 }});
 t.after(async()=>{gate.resolve();await raw.close();});
 const why = {code:'E_SCOPE',family:'client',message:'shared session authority ended'};
 const guarded = guardClient(raw, async()=>{
  if(checking && ++approvals === 2) approved.resolve();
  return allowed;
 },()=>true,()=>why).client;
 const op = {kind:'query',name:'list'};
 assert.deepEqual((await guarded.query(op,{})).data, []);
 const write = await raw.mutate({kind:'mutation',name:'touch'},{},{waitSeconds:0});
 assert.equal(write.state,'pending');
 checking = true; queries = 0;
 let done = false;
 const reading = guarded.query(op,{}).then(read=>{done=true;return read;});
 await approved.promise; await delay(20); assert.equal(done,false);
 allowed = false; gate.resolve();
 assert.deepEqual((await reading).denied, why);
 assert.ok(approvals >= 3, 'wait completion repeats asynchronous authority approval');
 assert.equal(queries,1,'no new evaluation was needed to observe the facade refusal');
 assert.equal(raw.link(),'online','only the facade authority ended');
 assert.equal((await raw.write(write.id)).state,'failed');
});

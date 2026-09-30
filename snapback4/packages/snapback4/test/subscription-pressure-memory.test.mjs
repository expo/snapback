import test from 'node:test';
import assert from 'node:assert/strict';
import {setTimeout as delay} from 'node:timers/promises';
import {join} from 'node:path';
import {fixture,source,open,opener,q,until,parked,sdk} from './helpers/answers-stay.mjs';
const {guardClient}=await import(new URL('app-client.js',sdk));
const {RememberedAnswers}=await import(new URL('local-reads.js',sdk));
for(const tier of ['wasm','process']) test(`${tier}: no-owner revocation must retire remembered content`,async t=>{
const program=source.replace("table profiles:\n  name: text\n  read <- allow", "table profiles:\n  name: text\n  read <- .name = 'Bob'\n  update <- allow")+`
query hasProfile():
  return {present: exists profiles['bob'], secret: profiles['bob']}
mutation eraseProfile():
  update profiles['bob'] {name: 'revoked'}
`;
const f=await fixture(t,program), feed=Promise.withResolvers(); let sent=false,offline=false, memory;
const oldSet=RememberedAnswers.prototype.set;
t.mock.method(RememberedAnswers.prototype,'set',function(...args){memory=this;return oldSet.apply(this,args)});
const client=await open(t,f,tier,{fetch:async(input,init)=>{
 const path=new URL(input).pathname;
 if(path==='/changes'){if(sent)return parked(init.signal);sent=true;return Response.json(await Promise.race([feed.promise,parked(init.signal)]))}
 if(offline)throw Error('offline');return fetch(input,init);
}});
const w=client.observe(q('hasProfile'),{});w.subscribe(()=>{});t.after(()=>w.close());
await until(()=>w.getSnapshot().data?.secret?.name==='Bob');
const facade=guardClient(client,async()=>true,()=>true,()=>({code:'E_AUTH',family:'auth',message:'ended'}));
const view=facade.client.observe(q('hasProfile'),{});view.subscribe(()=>{});
t.after(()=>{view.close();facade.fence()()});
await until(()=>view.getSnapshot().data?.secret?.name==='Bob');view.close();w.close();
const removal=await f.post('/m/eraseProfile',{id:'remove',args:{}}); assert.equal(removal.state,'sent');
feed.resolve({seq:removal.seq,tables:['profiles']});
await client.sync();await delay(100);
const authoritative=await f.post('/q/hasProfile',{args:{}},'bob');assert.deepEqual(authoritative.data,{present:false,secret:null});
const before=w.getSnapshot(), remembered=memory.get('hasProfile:{}');offline=true;
const events=[];w.subscribe(()=>events.push(w.getSnapshot()));await delay(1250);
const after=w.getSnapshot(), direct=await client.query(q('hasProfile'),{});
t.diagnostic(JSON.stringify({removal,authoritative,before,remembered,rememberedTables:[...remembered?.tables??[]],after,direct}));
assert.notEqual(after.data?.secret?.name,'Bob','observed revoked profile must not return from memory after its notification');
assert.notEqual(direct.data?.secret?.name,'Bob','direct read must not recover invalidated memory');
assert.equal(remembered,undefined,'accepted notification clears memory without an owner');
assert.ok(!('data' in before),'closed getter discards its answer at the epoch');
assert.ok(events.every(read=>read.data?.secret?.name!=='Bob'),'recovery never publishes revoked memory');
assert.ok(!('data' in view.getSnapshot()),'closed facade cannot retain its approved old answer');
assert.notEqual((await facade.client.query(q('hasProfile'),{})).data?.secret?.name,'Bob');
});

for(const tier of ['wasm','process'])test(`${tier}: notification fences an unremembered in-flight direct answer`,async t=>{
 const program=source.replace("table profiles:\n  name: text\n  read <- allow", "table profiles:\n  name: text\n  read <- .name = 'Bob'\n  update <- allow")+`
mutation revokeProfile():
  update profiles['bob'] {name: 'revoked'}
`;
 const f=await fixture(t,program),feed=Promise.withResolvers(),reply=Promise.withResolvers(),sync=Promise.withResolvers();
 let sent=false,held=false,syncHeld=false,holdSync=false,once=true;
 t.after(()=>{reply.resolve();sync.resolve();feed.resolve({seq:0,tables:[]})});
 const client=await open(t,f,tier,{fetch:async(input,init)=>{
  const path=new URL(input).pathname;
  if(path==='/changes'){if(sent)return parked(init.signal);sent=true;return Response.json(await Promise.race([feed.promise,parked(init.signal)]))}
  if(path==='/sync'&&holdSync){syncHeld=true;await sync.promise}
  const response=await fetch(input,init);
  if(path==='/q/profile'&&once){once=false;held=true;await reply.promise}return response;
 }});
 const pending=client.query(q('profile'),{});await until(()=>held);
 const removed=await f.post('/m/revokeProfile',{id:'revoke',args:{}});holdSync=true;
 feed.resolve({seq:removed.seq,tables:['profiles']});await until(()=>syncHeld);
 reply.resolve();const result=await pending;
 assert.notEqual(result.data?.name,'Bob','a notification retires even a first reply with no memory/owner');
 assert.equal(result.data,null,'retry gets the authoritative hidden row');
 sync.resolve();await client.sync();
});

for(const tier of ['wasm','process'])for(const boundary of ['recovery','approval'])test(`${tier}: notification fences a saved candidate at ${boundary}`,async t=>{
 const program=source.replace("table profiles:\n  name: text\n  read <- allow", "table profiles:\n  name: text\n  read <- .name = 'Bob'\n  update <- allow")+`
mutation revokeProfile():
  update profiles['bob'] {name: 'revoked'}
`;
 const f=await fixture(t,program),base=opener(tier,join(f.dir,'candidate')),feed=Promise.withResolvers(),gate=Promise.withResolvers(),sync=Promise.withResolvers();
 let sent=false,offline=false,holdSync=false,syncHeld=false,candidate=false,held=false,checks=0;
 t.after(()=>{gate.resolve();sync.resolve();feed.resolve({seq:0,tables:[]})});
 const get=RememberedAnswers.prototype.get;
 t.mock.method(RememberedAnswers.prototype,'get',function(...args){const answer=get.apply(this,args);if(offline&&answer)candidate=true;return answer});
 const client=await open(t,f,tier,{fetch:async(input,init)=>{
  const path=new URL(input).pathname;
  if(path==='/changes'){if(sent)return parked(init.signal);sent=true;return Response.json(await Promise.race([feed.promise,parked(init.signal)]))}
  if(path==='/sync'&&holdSync){syncHeld=true;await sync.promise}
  if(offline)throw Error('offline');return fetch(input,init);
 },device:{async open(...args){const core=await base.open(...args);return {...core,async call(request,commit){
  const result=await core.call(request,commit);
  if(candidate&&!held&&request.op==='queued'){held=true;await gate.promise}return result;
 }}}}});
 const facade=guardClient(client,async()=>{if(boundary==='approval'&&++checks===2){held=true;await gate.promise}return true},()=>true,()=>({code:'E_AUTH',family:'auth',message:'ended'}));
 t.after(()=>facade.fence()());
 if(boundary==='recovery'){assert.equal((await client.query(q('profile'),{})).data?.name,'Bob');offline=true}
 const pending=(boundary==='recovery'?client:facade.client).query(q('profile'),{});
 await until(()=>held,`hold the ${boundary} candidate`);
 const removed=await f.post('/m/revokeProfile',{id:'revoke',args:{}});holdSync=true;
 feed.resolve({seq:removed.seq,tables:['profiles']});await until(()=>syncHeld);
 gate.resolve();const result=await pending;
 assert.notEqual(result.data?.name,'Bob',`${boundary} cannot publish an answer across accepted evidence`);
 sync.resolve();
});

for(const tier of ['wasm','process'])for(const boundary of ['partition refusal','credentials'])test(`${tier}: ${boundary} retires no-owner memory`,async t=>{
 const program=source.replace('use personas alice, bob',boundary==='credentials'?'use identity':'use personas alice, bob')
  .replace("table profiles:\n  name: text\n  read <- allow", "table profiles:\n  name: text\n  read <- .name = 'Bob'\n  update <- allow")+`
mutation revokeProfile():
  update profiles['bob'] {name: 'revoked'}
`;
 const f=await fixture(t,program);let offline=false,refuse=false,memory;
 const set=RememberedAnswers.prototype.set;
 t.mock.method(RememberedAnswers.prototype,'set',function(...args){memory=this;return set.apply(this,args)});
 let session;
 if(boundary==='credentials'){
  const {signup}=await import(new URL('auth.js',sdk));const signed=await signup(f.url,'bob@example.test','long-test-password');
  assert.equal(signed.ok,true);session=signed.session;
 }
 const client=await open(t,f,tier,{...(session?{session,persona:undefined}:{}),fetch:async(input,init)=>{
  const path=new URL(input).pathname;if(path==='/changes')return parked(init.signal);
  if(path==='/sync'&&refuse)return Response.json({denied:{code:'E_TEST_PARTITION',family:'rule',message:'refused'}});
  if(offline)throw Error('offline');return fetch(input,init);
 }});
 const watch=client.observe(q('profile'),{});watch.subscribe(()=>{});t.after(()=>watch.close());
 await until(()=>watch.getSnapshot().data?.name==='Bob');watch.close();
 assert.equal(memory.get('profile:{}').read.data.name,'Bob');
 const mutation=session?await fetch(f.url+'/m/revokeProfile',{method:'POST',headers:{Authorization:`Bearer ${session.token}`},body:JSON.stringify({id:'revoke',args:{}})}).then(r=>r.json()):await f.post('/m/revokeProfile',{id:'revoke',args:{}});
 assert.equal(mutation.state,'sent');
 if(boundary==='credentials')assert.equal((await client.refreshSession()).ok,true);
 else{refuse=true;await client.sync();refuse=false;await client.sync()}
 offline=true;const result=await client.query(q('profile'),{});
 assert.notEqual(result.data?.name,'Bob',`${boundary} cannot leave an online-only answer recoverable`);
 assert.equal(memory.get('profile:{}'),undefined);
});

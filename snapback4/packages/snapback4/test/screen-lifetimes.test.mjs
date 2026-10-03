// @ref LLP 3000.023#13 — execute the published owner and both real device hosts.
import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync,mkdtempSync,rmSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {createLocalClient} from '../dist/local.js';
import ts from 'typescript';
import {Pages} from '../dist/react-pages.js';
import {inspect} from '../dist/inspection.js';
import {open, opener, q, parked, until} from './helpers/answers-stay.mjs';
import {hangBudget} from './helpers/wait.mjs';
const file=new URL('../../../crates/snapback4/src/verbs/init/social/PageLifetime.ts',import.meta.url);
const code=ts.transpileModule(readFileSync(file,'utf8'),{compilerOptions:{module:ts.ModuleKind.ESNext,target:ts.ScriptTarget.ES2022}}).outputText;
const {PageLifetime}=await import('data:text/javascript;base64,'+Buffer.from(code).toString('base64'));
const source=`use personas alice, bob
table messages:
  owner: principal
  room: text <=40
  at: int
  body: text
  until: time
  by byRoom: room, at, id
  read <- .owner = viewer
  insert <- allow
  update <- allow
  delete <- allow
  sync to .owner
  expire at .until
query history(room: text <=40, c: cursor?):
  return messages[room] first 2 by byRoom after c
query point(id: messages):
  return messages[id]
table online:
  public
  online only
query guarded(id: messages, allow: bool):
  extra = online first 1
  require allow else NO_BODY
  return messages[id]
mutation edit(id: messages, at: int):
  update messages[id] {at}
mutation revoke(id: messages):
  update messages[id] {owner: 'dev:alice'}
`;
// Use the common server without the common fixture's unrelated seed schema.
import {server} from './helpers/app-server.mjs';
for(const host of ['process','wasm']) test(`bounded screen ${host}: sharing, cursor replacement, expiry, denial and late replies`,{timeout:hangBudget(15)},async t=>{
 const f=await server(t,undefined,source);
 const post=async(path,body)=>(await fetch(f.url+path,{method:'POST',headers:{'x-snapback-persona':'alice'},body:JSON.stringify(body)})).json();
 const seeded=await post('/seed',Array.from({length:6},(_,n)=>({table:'messages',row:{id:'m'+n,owner:'dev:bob',room:'r',at:n,body:'body-'+n,until:Date.now()+600000}})));
 assert.equal(seeded.seeded,6,JSON.stringify(seeded));
 let hold=false,release,entered=false,guardedReplies=0;
 t.after(()=>release?.());
 const client=await open(t,f,host,{fetch:async(input,init)=>{
   if(new URL(input).pathname==='/changes')return parked(init.signal);
   const reply=await fetch(input,init);
   if(hold&&new URL(input).pathname==='/q/guarded'){hold=false;entered=true;await new Promise(r=>release=r);}
   if(new URL(input).pathname==='/q/guarded')guardedReplies++;
   return reply;
 }});
 const op={...q('history'),rowKey:'id'},args={room:'r',c:null};
 const lifetime=new PageLifetime(client,op,args);
 let stop=lifetime.subscribe(()=>{});
 await until(()=>lifetime.getSnapshot().ready,'root ready');console.log(host,'root ready');
 const firstEpoch=lifetime.getSnapshot().epoch;
 const pages=new Pages(client,op,{room:'r'}),off=pages.subscribe(()=>{});
 await until(()=>pages.getSnapshot().items.length===2,'first page');
 assert.equal(inspect(client).queries.find(x=>x.name==='history').observations,1,'marker and page share the root watch');
 const peer=client.observe(q('point'),{id:'m0'}),peerOff=peer.subscribe(()=>{});
 const row=client.observe(q('point'),{id:'m0'}),rowOff=row.subscribe(()=>{});
 await until(()=>row.getSnapshot().data?.body==='body-0','point live');
 rowOff();row.close();assert.equal(peer.getSnapshot().data.body,'body-0','active sibling retains its ownership');
 pages.loadMore();await until(()=>pages.getSnapshot().items.length===4,'second requested page');
 const changed=await post('/m/edit',{id:'move',args:{id:'m1',at:10}});assert.equal(changed.state,'sent');await client.sync();
 await until(()=>pages.getSnapshot().items.map(r=>r.id).join(',')==='m0,m2,m3,m4','page boundary replaced without missing row');
 assert.equal(new Set(pages.getSnapshot().items.map(r=>r.id)).size,4);console.log(host,'boundary passed');
 const denied=client.observe(q('guarded'),{id:'m0',allow:false}),deniedOff=denied.subscribe(()=>{});
 await until(()=>denied.getSnapshot().denied?.code==='NO_BODY','explicit denial');
 assert.equal('data'in denied.getSnapshot(),false);console.log(host,'denial passed');
 deniedOff();denied.close();
 // Expiry is exercised with a real row lifetime, independent of HTTP arrival.
 const expires=Date.now()+3000;
 assert.equal((await post('/seed',[{table:'messages',row:{id:'expires',owner:'dev:bob',room:'expiry',at:0,body:'temporary',until:expires}}])).seeded,1);
 await client.sync();
 const exp=client.observe(q('point'),{id:'expires'}),expOff=exp.subscribe(()=>{});
 await until(()=>exp.getSnapshot().data?.body==='temporary','expiring body');
 await until(()=>client.now()>=expires,'expiry clock');
 assert.notEqual(exp.getSnapshot().data?.body,'temporary');expOff();exp.close();console.log(host,'expiry passed');
 // Capture an authorized server response, then release its route owner.
 hold=true;
 const late=client.observe(q('guarded'),{id:'m5',allow:true});let lateNotices=0;
 const lateOff=late.subscribe(()=>lateNotices++);
 await until(()=>entered,'held server response');console.log(host,'held response');lateOff();late.close();const detachedNotices=lateNotices;
 assert.equal((await post('/m/revoke',{id:'revoke',args:{id:'m5'}})).state,'sent');await client.sync();
 release();console.log(host,'released response');await until(()=>inspect(client).totals.inFlight===0,'late work drained');
 console.log(host,'late drained');
 assert.equal(lateNotices,detachedNotices,'detached route receives no late response');
 const repliesBeforeRemount=guardedReplies;
 const current=client.observe(q('guarded'),{id:'m5',allow:true}),currentOff=current.subscribe(()=>{});
 await until(()=>guardedReplies>repliesBeforeRemount&&inspect(client).totals.inFlight===0&&inspect(client).totals.queued===0,'reactivated evaluation settles');
 assert.notEqual(current.getSnapshot().data?.body,'body-5','reactivation cannot recover revoked content');currentOff();current.close();console.log(host,'reactivated');

 off();peerOff();peer.close();stop();
 assert.equal(lifetime.getSnapshot().ready,false);
 assert.ok(lifetime.getSnapshot().epoch>firstEpoch,'closing releases its lifetime');
 stop=lifetime.subscribe(()=>{});await until(()=>lifetime.getSnapshot().ready,'Strict subscription remount');stop();
 assert.equal(inspect(client).totals.observations,0,'all route observations released');
 console.log('screen device',host,JSON.stringify({epoch:lifetime.getSnapshot().epoch,pressure:inspect(client).totals}));
});

test('owner marker catches coalesced generation withdrawal and never stores bodies or cursors',()=>{
 let read={data:[{id:'private'}]},notify,closes=0;
 const client={observe(){return {getSnapshot:()=>read,subscribe(fn){notify=fn;return()=>notify=undefined;},close(){closes++;}}}};
 const owner=new PageLifetime(client,{},{}),stop=owner.subscribe(()=>{});
 const before=owner.getSnapshot();assert.equal(before.ready,true);
 read={loading:true};notify();read={data:[{id:'same-id-new-generation'}]};notify();
 assert.equal(owner.getSnapshot().epoch,before.epoch+1);
 assert.deepEqual(Object.keys(owner.getSnapshot()).sort(),['epoch','ready']);
 stop();stop();assert.equal(closes,1);
});

for(const host of ['process','wasm']) test(`screen owner ${host}: committed generation adoption resets even with a late old read`,{timeout:hangBudget(8)},async t=>{
 const original=JSON.parse(readFileSync(new URL('./chat-schema.json',import.meta.url),'utf8'));
 const dir=mkdtempSync(join(tmpdir(),'sb4-screen-generation-')),device=opener(host,dir);
 let generation=original.generation,marker='old',hold=false,entered=false;
 const gate=Promise.withResolvers(),commits=[];
 const backend=()=>({...original,generation,programs:[...original.programs,...['marker','slowMarker'].map(name=>({name,kind:'Query',args:{},body:[{Return:{Literal:{String:marker}}}]}))]});
 const client=await createLocalClient({url:'http://screen-generation.test',persona:'alice',device:{async open(...args){
   const core=await device.open(...args);return {...core,async call(request,committed){const reply=await core.call(request);committed?.(reply);if(request.op==='adopt')commits.push(generation);if(hold&&request.op==='query'){entered=true;await gate.promise;}return reply;}};
 }},fetch:async(input,init)=>{
   const path=new URL(input).pathname;
   if(path==='/schema')return Response.json(backend());
   if(path==='/sync'){const request=JSON.parse(init.body);return Response.json({snapshot:request.from===0&&!request.stream,events:[],watermark:10,more:false,generation,store_id:'screen'});}
   if(path==='/changes')return parked(init.signal);
   if(path==='/q/marker'||path==='/q/slowMarker')return Response.json({data:marker,complete:true,tables:[],seq:10});
   throw Error(path);
 }});
 t.after(async()=>{hold=false;gate.resolve();await client.close();rmSync(dir,{recursive:true,force:true});});
 await client.sync();
 const owner=new PageLifetime(client,q('marker'),{}),stop=owner.subscribe(()=>{});t.after(stop);
 await until(()=>owner.getSnapshot().ready,'old generation');const epoch=owner.getSnapshot().epoch;
 hold=true;const slow=client.observe(q('slowMarker'),{}),notices=[];const slowStop=slow.subscribe(()=>notices.push(slow.getSnapshot()));
 await until(()=>entered,'old generation evaluation held');
 generation++;marker='new';const changing=client.sync();
 await until(()=>!owner.getSnapshot().ready,'hard generation withdrawal');
 const retiredEpoch=owner.getSnapshot().epoch;assert.ok(retiredEpoch>epoch);
 await until(()=>entered,'new generation evaluation held');await changing;
 assert.ok(commits.includes(generation),'real device committed adoption');
 hold=false;gate.resolve();await until(()=>owner.getSnapshot().ready,'new generation released');
 assert.ok(owner.getSnapshot().epoch>=retiredEpoch,'replacement cannot recover old owner key');
 await until(()=>slow.getSnapshot().data==='new','old held evaluation replaced under new generation');assert.ok(notices.every(read=>read.data!=='old'));slowStop();slow.close();stop();
 console.log('generation owner',host,JSON.stringify({before:epoch,after:owner.getSnapshot().epoch,adoptions:commits.length}));
});

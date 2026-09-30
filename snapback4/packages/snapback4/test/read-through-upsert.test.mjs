// @ref LLP 3000.007#20.5 — the actual wasm and process devices share the absence proof.
import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {join} from 'node:path';
import {server,root} from './helpers/read-through-server.mjs';
const starter=readFileSync(join(root,'crates/snapback4/src/verbs/init/social/schema.q'),'utf8').replace('use identity','').replace('use personas alice, bob, carol','');
const reactions=`
table reactions:
  message: messages
  principal: principal
  emoji: text <=32
  immutable message, principal
  unique message, principal
  cap 50 by message
  read through .message
  insert <- .principal = viewer
  update <- .principal = viewer
  sync
query reactionsFor(message: messages):
  return reactions where .message = message by .principal
mutation setReaction(message: messages, emoji: text <=32):
  return upsert reactions[message, viewer] { emoji }
`;
for(const tier of ['wasm','process']) for(const coverage of ['whole','horizon','missing']) test(`${tier}: read-through upsert ${coverage==='whole'?'predicts both arms and server refusal rolls back':coverage+' child coverage queues'}`,{timeout:60000},async t=>{
 const host=await server(t,tier,starter+(coverage==='horizon'?reactions.replace('  sync\nquery','  sync last 1 by .id\nquery'):reactions.replace('  sync\nquery','  retain delivered-history\n  sync\nquery')));
 assert.equal((await host.post('/seed',[
  {table:'conversations',row:{id:'c',creatorId:'dev:bob',title:'Room'}},
  {table:'members',row:{id:'member',conversation:'c',principal:'dev:bob',joinedOrdinal:0}},
  {table:'messages',row:{id:'m',conversation:'c',sender:'dev:bob',ordinal:1,recipients:0,text:'Hello',at:1}},
 ])).seeded,3);
 await host.open();host.pauseSync();
 const call=async request=>{const reply=await host.core.call(request);assert.equal(reply.denied,undefined,JSON.stringify(reply));return reply.ok;};
 const read=()=>call({op:'query',name:'reactionsFor',args:{message:'m'},viewer:'dev:bob',now:Date.now()});
 const admit=async(id,emoji,message='m')=>call({op:'admit',entry:{id,seq:0,op:'setReaction',args:{message,emoji},viewer:'dev:bob',now:Date.now(),predictable:true}});
 assert.deepEqual((await read()).data,[]);
 if(coverage==='missing') {
  const state=await call({op:'state'});
  const page={snapshot:false,watermark:state.watermark,generation:state.generation,more:false};
  // A child-only departure and unfinished rejoin leave the held parent intact.
  await call({op:'apply',page:{...page,events:[{table:'reactions',kind:'scope',id:'left',data:['c']}]}});
  await call({op:'apply',page:{...page,events:[],joined:{reactions:[['c']]}}});
 }
 const first=await admit('qx-first','like');
 if(coverage!=='whole'){assert.equal(first.predictable,false);assert.deepEqual(first.predicted,[]);assert.deepEqual((await read()).data,[]);return;}
 assert.equal(first.predictable,true,JSON.stringify(first));assert.equal(first.predicted.length,1);
 assert.equal((await read()).data[0].emoji,'like');assert.equal((await read()).data[0].pending,true);
 const second=await admit('qx-second','love');assert.equal(second.predictable,true);assert.deepEqual(second.predicted,first.predicted);assert.equal((await read()).data[0].emoji,'love');
 await call({op:'settle',id:'qx-second'});assert.equal((await read()).data[0].emoji,'like');
 // Revoke on the authority while withholding its sync. The device had valid
 // acquired facts at submission; the server still decides against the insert.
 const leave=await host.post('/m/leave',{id:'qx-leave',args:{conversation:'c'}});assert.equal(leave.state,'sent',JSON.stringify(leave));
 const refused=await host.post('/m/setReaction',{id:'qx-first',args:{message:'m',emoji:'like'}});assert.equal(refused.state,'failed',JSON.stringify(refused));
 await call({op:'settle',id:'qx-first'});assert.deepEqual((await read()).data,[]);
 const missing=await admit('qx-missing','like','unheld');assert.equal(missing.predictable,false);assert.deepEqual(missing.predicted,[]);
});

for (const tier of ['wasm','process']) for (const constraint of ['unique byEmoji: emoji','cap 1 by emoji']) test(`${tier}: held upsert queues before entering uncovered ${constraint}`,{timeout:60000},async t=>{
 const host=await server(t,tier,starter+reactions.replace('  cap 50 by message',`  ${constraint}\n  cap 50 by message`));
 const seed=[];
 for (const [c,m,r,emoji] of [['c','m','held','old'],['hidden-c','hidden-m','hidden-r','taken']]) {
  seed.push({table:'conversations',row:{id:c,creatorId:'dev:bob',title:c}},
   {table:'messages',row:{id:m,conversation:c,sender:'dev:bob',ordinal:1,recipients:0,text:'Hello',at:1}},
   {table:'reactions',row:{id:r,message:m,principal:'dev:bob',emoji}});
 }
 seed.push({table:'members',row:{id:'member',conversation:'c',principal:'dev:bob',joinedOrdinal:0}});
 assert.equal((await host.post('/seed',seed)).seeded,seed.length);
 await host.open();host.pauseSync();
 const call=async request=>{const reply=await host.core.call(request);assert.equal(reply.denied,undefined,JSON.stringify(reply));return reply.ok;};
 const read=()=>call({op:'query',name:'reactionsFor',args:{message:'m'},viewer:'dev:bob',now:Date.now()});
 const before=await read();assert.equal(before.data[0].emoji,'old');assert.equal(before.data.length,1);
 const queued=await call({op:'admit',entry:{id:'qx-constraint',seq:0,op:'setReaction',args:{message:'m',emoji:'taken'},viewer:'dev:bob',now:Date.now(),predictable:true}});
 const after=await read();
 const refused=await host.post('/m/setReaction',{id:'qx-constraint',args:{message:'m',emoji:'taken'}});
 assert.equal(refused.state,'failed',JSON.stringify(refused));
 assert.equal(refused.why.code,constraint.startsWith('unique')?'E_RULE':'E_CONSTRAINT',JSON.stringify(refused));
 await call({op:'settle',id:'qx-constraint'});
 assert.deepEqual((await read()).data,before.data);
 assert.equal(queued.predictable,false,JSON.stringify({queued,after,refused}));
 assert.deepEqual(queued.predicted,[]);assert.deepEqual(after.data,before.data);
});

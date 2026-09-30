import test from 'node:test';import assert from 'node:assert/strict';
import {fixture,source,open,q,parked,sdk} from './helpers/answers-stay.mjs';
const names=['constructor','__proto__','toString','hasOwnProperty'];
for(const name of names) {
const program=source+`
table ${name}:
  room: text <=40
  body: text <=200
  at: int
  by byRoom: room, at, id
  read <- exists members[.room, viewer]
  retain delivered-history
  sync to members[.room]
query combined():
  profile = profiles['bob']
  rows = messages['room'] first 100 by byRoom
  past = ${name}['past'] first 100 by byRoom
  return {profile,rows,past}
mutation leavePast():
  delete members[room = 'past', principal = 'dev:bob']
`;
for(const tier of ['wasm','process'])test(`${tier}: composed scope metadata accepts a table named ${name}`,async t=>{
 const f=await fixture(t,program);await f.post('/seed',[
  ...['alice','bob'].map(p=>({table:'members',row:{id:p+'past',room:'past',principal:'dev:'+p}})),
  {table:name,row:{id:'archive',room:'past',body:'delivered',at:1}}
 ]);
 const client=await open(t,f,tier,{fetch:(input,init)=>new URL(input).pathname==='/changes'?parked(init.signal):fetch(input,init)});
 await f.post('/m/leavePast',{id:'leave',args:{}});await client.sync();
 const answer=await client.query(q('combined'),{});t.diagnostic(JSON.stringify(answer));
 assert.equal(answer.data.past[0].id,'archive');
});
}

const {mergeReadScopes,LocalReads}=await import(new URL('local-reads.js',sdk));
for(const name of names)test(`scope matching treats missing ${name} as missing`,()=>{
 const reads=new LocalReads();
 reads.withdrawScopes([],{watermark:2,events:[{kind:'scope',table:name,data:['room']}]},false)();
 assert.equal(reads.blocked({read:{data:[]},tables:new Set([name]),scopes:{}}),undefined);
 const scopes=mergeReadScopes(JSON.parse(JSON.stringify({[name]:[{'0':'room'}]})),{[name]:[{'0':'room2'},{'0':'room'}]});
 assert.equal(scopes[name].length,2);
 assert.equal(reads.blocked({read:{data:[]},tables:new Set([name]),scopes}),2);
 assert.equal(Object.getPrototypeOf(scopes),null);
});

const {createMockClient}=await import(new URL('mock.js',sdk));
for(const name of names)test(`mock ephemeral writes preserve the table ${name}`,async t=>{
 const client=createMockClient({viewer:'alice',tables:{[name]:new Map()},ephemeral:{[name]:1000},
  ops:{mutations:{},queries:{rows:tables=>[...tables[name].values()]},signals:{put(tables){tables[name].set('row',{id:'row'});return null}}}});
 t.after(()=>client.close());
 const write=await client.mutate({kind:'mutation',name:'put',ephemeral:true,renews:true,renewMs:250},{});
 assert.equal(write.state,'sent');
 assert.deepEqual((await client.query(q('rows'),{})).data,[{id:'row'}]);
});

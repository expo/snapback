import test from 'node:test';
import assert from 'node:assert/strict';
import {server} from './helpers/app-server.mjs';
import {opener,open} from './helpers/answers-stay.mjs';
import {join} from 'node:path';
const source=`use personas bob\ntable docs:\n  photos: [image <=10000 once] <=1000 ?\n  body: text <=20\n  public\n  sync public\nquery page():\n  return docs[] first 100 by byId\n`;
for(const host of ['process','wasm']) test(`${host}: masked size must not change device result`,async t=>{
 const f=await server(t,undefined,source), results=[];
 for(const filled of [false,true]){
   const photos=filled?Array.from({length:1000},(_,i)=>({id:'unavailable'+String(i).padStart(15,'0')})):null;
   const seeded=await fetch(f.url+'/seed',{method:'POST',body:JSON.stringify(Array.from({length:30},(_,i)=>({table:'docs',row:{id:'row'+String(i).padStart(2,'0'),body:'same visible text',photos}})))}).then(r=>r.json());
   assert.equal(seeded.seeded,30,JSON.stringify(seeded));
   let core;const device=opener(host,join(f.dir,host+'-'+filled));
   const c=await open(t,f,host,{device:{async open(...args){core=await device.open(...args);return core;}}});
   const r=await core.call({op:'query',name:'page',viewer:'dev:bob',args:{},now:Date.now()});

   results.push(r.ok);await c.close();
 }
 assert.deepEqual(results[0],results[1]);
});

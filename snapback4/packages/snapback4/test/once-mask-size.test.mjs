import test from 'node:test';
import assert from 'node:assert/strict';
import {server} from './helpers/app-server.mjs';
const source=`use personas bob\ntable docs:\n  photos: [image <=10000 once] <=1000 ?\n  body: text <=20\n  public\n  sync public\nquery page():\n  return docs[] first 100 by byId\nquery point():\n  return docs['row00']\n`;
test('unavailable once list size cannot change visible answer',async t=>{
 const f=await server(t,undefined,source);
 const post=async(path,body)=>fetch(f.url+path,{method:'POST',headers:{'x-snapback-persona':'bob'},body:JSON.stringify(body)}).then(r=>r.json());
 const readings=[];
 for(const filled of [false,true]){
   const photos=filled?Array.from({length:1000},(_,i)=>({id:'unavailable'+String(i).padStart(15,'0')})):null;
   const seeded=await post('/seed',Array.from({length:30},(_,i)=>({table:'docs',row:{id:'row'+String(i).padStart(2,'0'),body:'same visible text',photos}})));
   assert.equal(seeded.seeded,30,JSON.stringify(seeded));
   const read=await post('/q/page',{args:{}});

   const {meter,seq,...publicRead}=read;
   readings.push(publicRead);
 }
 assert.deepEqual(readings[0],readings[1]);
});

import test from 'node:test';
import assert from 'node:assert/strict';
import { setup, q, m, ids } from './helpers/astra-search.mjs';
for (const tier of ['process', 'wasm']) test(`review rebirth preserves immutable scope disjointness ${tier}`, async t => {
 const f=await setup(t,tier);
 const write=await f.admin.mutate(m('rebirth'),{id:'m001',room:'live',at:3000,text:'coffee reborn'});
 assert.equal(write.state,'sent',JSON.stringify(write));
 const all=[];let c;
 for(let page=0;page<10;page++){const r=await f.client.query(q,{q:'coffee',c});all.push(...r.data);c=r.next;if(!c)break;}
 console.log('REBIRTH',tier,all.filter(r=>r.id==='m001'));
 assert.equal(all.filter(r=>r.id==='m001').length,1,'a fixed corpus repeats one id across pages despite immutable room');
});

for (const tier of ['process','wasm']) test(`overlap consumes an all-suppressed retained prefix once ${tier}`, async t=>{
 const f=await setup(t,tier,null,{whole:true});
 for(const row of f.rows.filter(r=>r.room==='left'))
   assert.equal((await f.admin.mutate(m('rebirth'),{id:row.id,room:'live',at:3000+row.at,text:'tea replacement'})).state,'sent');
 const first=await f.client.query(q,{q:'coffee'});
 assert.deepEqual(first.data,[]);assert.ok(first.next,'suppressed prefix can advance without refilling');
 const all=[];let c=first.next;
 for(let page=0;page<10;page++){
   const before=f.requests.length,read=await f.client.query(q,{q:'coffee',c});
   assert.equal(f.requests.length-before,1);all.push(...read.data);c=read.next;if(!c)break;
 }
 assert.equal(c,null);assert.deepEqual(all.map(r=>r.id),f.rows.filter(r=>r.room==='live').reverse().map(r=>r.id));
 for(const request of f.requests) {
   assert.ok(request.body.searchRetained.length<=20);
   assert.ok(request.json.searchCurrent.every(id=>request.body.searchRetained.includes(id)));
 }
});

for(const tier of ['process','wasm']) for(const room of ['live','hidden'])
test(`overlap ${tier}: older current image in ${room}`,async t=>{
 const f=await setup(t,tier,null,{whole:true});
 assert.equal((await f.admin.mutate(m('rebirth'),{id:'m001',room,at:500,text:'coffee replacement'})).state,'sent');
 const all=[];let c;
 for(let page=0;page<10;page++){const read=await f.client.query(q,{q:'coffee',c});all.push(...read.data);c=read.next;if(!c)break;}
 const row=all.filter(r=>r.id==='m001');assert.equal(row.length,1);
 assert.equal(row[0].text,room==='live'?'coffee replacement':'coffee');
 assert.equal(row[0].at,room==='live'?500:1001);
});

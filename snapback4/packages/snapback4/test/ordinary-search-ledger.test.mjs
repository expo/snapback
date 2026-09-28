// @ref LLP 3000.028#7.2 — constituent cuts and the shared allowance at the SDK seam.
import test from 'node:test';
import assert from 'node:assert/strict';
import { ordinarySearch, SearchLedger, SearchBound } from '../dist/local-search.js';
const plan={table:'messages',index:'wordsAt',column:'at',kind:'Time',order:'Desc',limit:20,needle:'q',cursor:'c',variant:null};
const ceilings={examined:8192,index_entries:16384,rule_probes:8192,steps:1000000,heap_bytes:16<<20,output_bytes:1<<20,rows_written:1024};
const counts=()=>Object.fromEntries(Object.keys(ceilings).map(k=>[k,0]));
const rows=(start,count)=>Array.from({length:count},(_,i)=>({id:`m${start-i}`,at:start-i,text:'coffee'}));
const sourceCursor = c=>c?JSON.parse(Buffer.from(c,'base64url'))[5][0].Int:Infinity;
const position = c=>JSON.parse(Buffer.from(c.slice(5),'base64url'));
function fixture({retained=rows(200,20),live=rows(100,30),cut=false,exhaust=false,race}={}) {
  let calls=0,epoch='a',now=0,scanUsed;
  const env={backend:{generation:1},principal:'u0500',link:'online',lastSyncAt:1,credentialRevision:0,
    deviceNow:()=>now,serverNow:()=>now,
    async call(r){
      if(r.op==='search_state')return {ok:{epoch,left:['["left"]'],retained:true,ceilings,metered:r.spent??counts()}};
      assert.equal(r.search,true);assert.ok(r.spent.heap_bytes>0);
      scanUsed={...r.spent,heap_bytes:exhaust?ceilings.heap_bytes-1:r.spent.heap_bytes+1000,steps:r.spent.steps+100};
      const found=retained.filter(x=>x.at<sourceCursor(r.args.c));
      return {ok:{data:found.slice(0,20),complete:false,cut:null,next:found.length>20?'next':null,metered:scanUsed,nextExpiry:race==='expiry'?5:null}};
    },
    async searchPost(path,body,decode){calls++;
      const found=live.filter(x=>x.at<sourceCursor(body.args.c));
      const data=found.slice(0,cut?3:20);
      const stopped=cut&&found.length>data.length;
      const json={searchScopes:['["live"]'],data,complete:!stopped,cut:stopped?'meter':null,next:found.length>data.length?'unconsumed-response-next':null};
      const parsed=await decode(new Response(JSON.stringify(json)));
      if(race==='membership'||race==='reset'||race==='edit'||race==='rejoin')epoch='b';
      if(race==='expiry')now=5;
      return {ok:true,json:parsed,obsoleteAuth:false};
    }};
  return {env,run:c=>ordinarySearch(env,'search',{q:'coffee',c},plan,()=>{},async()=>false),calls:()=>calls,scanUsed:()=>scanUsed};
}
test('mixed drain: retained fills page, one invocation, cut retained and server prefix unconsumed',async()=>{
  const f=fixture({cut:true});let c,all=[];
  for(let n=0;n<20;n++){
    const before=f.calls(),result=await f.run(c),read=result.read;
    assert.equal(f.calls()-before,1);assert.equal(read.complete,false);assert.equal(read.cut,read.next?'meter':null);
    all.push(...read.data.map(r=>r.id));
    if(n===0){assert.equal(read.data.length,20);assert.equal(position(read.next).server,null);}
    c=read.next;if(!c)break;
  }
  assert.deepEqual(all,[...rows(200,20),...rows(100,30)].map(r=>r.id));
});
test('mixed drain stops at its established head even when more retained rows could fill the page',async()=>{
  const f=fixture({retained:rows(90,20),cut:true});const result=await f.run();
  assert.equal(f.calls(),1);assert.equal(result.read.data.length,3);assert.equal(result.read.cut,'meter');
  assert.equal(position(result.read.next).local,null);
});
test('decoder and coordinator cannot reset a nearly exhausted device scan ledger',async()=>{
  const f=fixture({exhaust:true});const result=await f.run();
  assert.equal(f.calls(),1);assert.equal(result.read.denied.code,'E_BOUND');
  assert.equal(f.scanUsed().heap_bytes,ceilings.heap_bytes-1);
  const alone=new SearchLedger(ceilings);await alone.decode(new Response(JSON.stringify({data:rows(100,20)})));
  assert.ok(alone.used.heap_bytes<ceilings.heap_bytes-1,'decode fits alone; the joined allowance is exhausted');
  assert.throws(()=>alone.resume(counts()),SearchBound,'receipts cannot lower prior work');
});
for(const race of ['membership','reset','edit','rejoin','expiry'])test(`mixed delivery withdraws ${race} race without refetch`,async()=>{
  const f=fixture({race});const result=await f.run();assert.equal(f.calls(),1);assert.deepEqual(result.read,{loading:true});
});
test('state loss needs no server buffer: a fresh coordinator resumes every unconsumed hit',async()=>{
  const original=fixture();const first=await original.run();
  const reopened=fixture();const second=await reopened.run(first.read.next);
  assert.deepEqual(second.read.data.map(r=>r.id),rows(100,20).map(r=>r.id));assert.equal(reopened.calls(),1);
});

test('an older device refuses composition explicitly instead of running a partial plan',async()=>{
  const f=fixture();f.env.call=async()=>({denied:{code:'E_INPUT',family:'input',message:'unknown op search_state'}});
  const result=await f.run();assert.equal(result.read.denied.code,'E_INPUT');assert.equal(f.calls(),0);
});

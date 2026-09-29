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
function fixture({retained=rows(200,20),live=rows(100,30),cut=false,localCut=null,localComplete=false,exhaust=false,race,remainingSteps,limit=20,overlap=false}={}) {
  let calls=0,epoch='a',now=0,scanUsed;
  const env={backend:{generation:1},principal:'u0500',link:'online',lastSyncAt:1,credentialRevision:0,
    deviceNow:()=>now,serverNow:()=>now,
    async call(r){
      if(r.op==='search_state')return {ok:{epoch,delivery:epoch,left:['["left"]'],retained:true,ceilings,metered:r.spent&&remainingSteps!==undefined?{...r.spent,steps:ceilings.steps-remainingSteps}:r.spent??counts()}};
      assert.equal(r.search,true);assert.ok(r.spent.heap_bytes>0);
      scanUsed={...r.spent,heap_bytes:exhaust?ceilings.heap_bytes-1:r.spent.heap_bytes+1000,steps:r.spent.steps+100};
      if(localCut==='meter')scanUsed.examined=ceilings.examined+1;
      const found=retained.filter(x=>x.at<sourceCursor(r.args.c));
      return {ok:{data:found.slice(0,limit),complete:localComplete,cut:localCut,next:!localCut&&found.length>limit?'next':null,metered:scanUsed,nextExpiry:race==='expiry'?5:null}};
    },
    async searchPost(path,body,decode){calls++;
      const found=live.filter(x=>x.at<sourceCursor(body.args.c));
      const data=found.slice(0,cut?3:limit);
      const stopped=cut&&found.length>data.length;
      const json={searchCurrent:overlap?body.searchRetained:[],searchScopes:['["live"]'],data,complete:!stopped,cut:stopped?'meter':null,next:found.length>data.length?'unconsumed-response-next':null};
      const parsed=await decode(new Response(JSON.stringify(json)));
      if(race==='membership'||race==='reset'||race==='edit'||race==='rejoin')epoch='b';
      if(race==='expiry')now=5;
      return {ok:true,json:parsed,obsoleteAuth:false,searchIdentity:"store:1"};
    }};
  return {env,run:c=>ordinarySearch(env,'search',{q:'coffee',c},{...plan,limit},()=>{},async()=>false),calls:()=>calls,scanUsed:()=>scanUsed};
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
  assert.equal(f.calls(),0,'candidate request reservation exhausts before HTTP');assert.equal(result.read.denied.code,'E_BOUND');
  assert.equal(f.scanUsed().heap_bytes,ceilings.heap_bytes-1);
  const alone=new SearchLedger(ceilings);await alone.decode(new Response(JSON.stringify({data:rows(100,20)})));
  assert.ok(alone.used.heap_bytes<ceilings.heap_bytes-1,'decode fits alone; the joined allowance is exhausted');
  assert.throws(()=>alone.resume(counts()),SearchBound,'receipts cannot lower prior work');
});
for (const tie of [false,true]) test(`mixed comparisons exhaust the shared step allowance (${tie?'equal-time Unicode IDs':'time order'})`,async()=>{
  // The final state receipt leaves just enough for both mixed rows. One fewer
  // step must refuse. These fixed allowances include all merge/output work;
  // deleting either comparison charge makes the corresponding tight run pass.
  const steps=tie?1679:1667;
  const inputs={retained:[{id:'\u{10000}left',at:100,text:'coffee'}],live:[{id:'\ue000live',at:tie?100:101,text:'coffee'}]};
  const enough=fixture({...inputs,remainingSteps:steps}),tight=fixture({...inputs,remainingSteps:steps-1});
  const full=await enough.run(),cut=await tight.run();
  assert.deepEqual(full.read.data.map(r=>r.id),tie?['\u{10000}left','\ue000live']:['\ue000live','\u{10000}left']);
  assert.equal(cut.read.denied?.code,'E_BOUND');
  assert.match(cut.read.denied.message,/steps/);assert.equal(cut.read.data,undefined);
  assert.equal(enough.calls(),1);assert.equal(tight.calls(),1);
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

test('a current-only page still requires the authorized server audience proof',async()=>{
  const f=fixture(),call=f.env.call,post=f.env.searchPost;
  f.env.call=async request=>{const reply=await call(request);if(request.op==='search_state')reply.ok.left=[];return reply;};
  f.env.searchPost=async(...args)=>{const reply=await post(...args);delete reply.json.searchScopes;return reply;};
  const result=await f.run();assert.equal(f.calls(),1);assert.deepEqual(result.read,{loading:true});
});

for(const localCut of ['words','meter']) for(const retained of [[],rows(200,20)])
test(`a device ${localCut} cut with ${retained.length} candidates preserves the proven server stream`,async()=>{
  const f=fixture({localCut,retained});
  const first=await f.run();
  assert.deepEqual(first.read.data,rows(100,20));
  assert.equal(first.read.complete,false);assert.equal(first.read.cut,localCut);
  assert.equal(first.read.fresh,true);assert.equal(first.read.since,undefined);
  assert.ok(first.read.next);assert.equal(position(first.read.next).local,null);
  assert.equal(position(first.read.next).localCut,localCut);
  // A fresh coordinator cannot rediscover a newer retained candidate behind
  // the already emitted server rows. The incomplete source stays suspended.
  const reopened=fixture({retained:rows(300,20)}),second=await reopened.run(first.read.next);
  assert.deepEqual(second.read.data,rows(80,10));
  assert.equal(second.read.complete,false);assert.equal(second.read.cut,localCut);
  assert.equal(second.read.next,null);assert.equal(reopened.scanUsed(),undefined);
  assert.equal(f.calls(),1);assert.equal(reopened.calls(),1);
});
test('an unresumable device cut with no server hits refuses instead of publishing an empty dead end',async()=>{
  const f=fixture({localCut:'words',retained:[],live:[]}),result=await f.run();
  assert.equal(f.calls(),1);assert.equal(result.read.denied?.code,'E_BOUND');
  assert.match(result.read.denied.message,/retained.*words/);assert.equal(result.read.data,undefined);
});
test('device word cut and server drain retain both constituent limits across continuation',async()=>{
  const f=fixture({localCut:'words',cut:true});let c;const all=[];
  for(let page=0;page<10;page++){
    const before=f.calls(),{read}=await f.run(c);
    assert.equal(f.calls()-before,1);assert.equal(read.complete,false);
    assert.equal(read.cut,read.next?'meter':'words');
    all.push(...read.data.map(r=>r.id));
    if(read.next)assert.equal(position(read.next).localCut,'words');
    c=read.next;if(!c)break;
  }
  assert.equal(c,null);assert.deepEqual(all,rows(100,30).map(r=>r.id));
});
test('freshness follows emitted rows and two proven exhausted lanes can be complete',async()=>{
  const current=fixture({retained:rows(1,1)}),first=await current.run();
  assert.equal(first.read.fresh,true);assert.equal(first.read.since,undefined);
  const mixed=await current.run(first.read.next);
  assert.equal(mixed.read.fresh,false);assert.equal(mixed.read.since,1);
  const empty=fixture({retained:[],live:[],localComplete:true}),absent=await empty.run();
  assert.deepEqual(absent.read.data,[]);assert.equal(absent.read.complete,true);
  assert.equal(absent.read.fresh,true);assert.equal(absent.read.next,null);
});
test('a read cut retains rejected charges while every coordinator dimension stays bounded',()=>{
  for(const kind of ['examined','index_entries','rule_probes']){
    const ledger=new SearchLedger(ceilings),spent={...counts(),[kind]:ceilings[kind]+1};
    assert.throws(()=>ledger.resume(spent),SearchBound,'an unexplained overrun is refused');
    ledger.resume(spent,true);assert.deepEqual(ledger.used,spent);
    ledger.text(1);assert.equal(ledger.used[kind],spent[kind]);
    ledger.resume({...ledger.used});
    assert.throws(()=>ledger.charge(kind,1),SearchBound,'no new read allowance');
    assert.throws(()=>ledger.resume({...ledger.used,[kind]:ceilings[kind]}),SearchBound,'the cap cannot reset');
    assert.throws(()=>ledger.resume({...ledger.used,[kind]:spent[kind]+1}),SearchBound,'a state observation cannot add over-budget read work');
  }
  for(const kind of ['steps','heap_bytes','output_bytes','rows_written']){
    assert.throws(()=>new SearchLedger(ceilings).resume({...counts(),[kind]:ceilings[kind]+1},true),SearchBound,kind);
  }
});

for (const code of ['E_INPUT','E_OP','E_SEARCH_OPEN','E_BOUND']) for (const retryable of [false,true])
test(`composition propagates ${code} retryable=${retryable} without identity refresh`, async()=>{
  const f=fixture({retained:[]});let refresh=0;
  f.env.refreshSearch=()=>refresh++;
  f.env.searchPost=async()=>({ok:true,json:{denied:{code,family:'input',message:'permanent refused input',retryable}}});
  assert.equal((await f.run()).read.denied.code,code);assert.equal(refresh,0);
});

test('missing overlap support refuses permanently without publishing retained candidates', async()=>{
  const f=fixture(),post=f.env.searchPost;let refresh=0;
  f.env.refreshSearch=()=>refresh++;
  f.env.searchPost=async(...args)=>{const r=await post(...args);delete r.json.searchCurrent;return r;};
  assert.equal((await f.run()).read.denied?.code,'E_INPUT');assert.equal(refresh,0);
});

test('complete certifies a bounded page even when the combined next has more rows',async()=>{
  const f=fixture({retained:rows(200,20),live:rows(100,1),localComplete:true});
  const first=await f.run();assert.equal(first.read.complete,true);assert.ok(first.read.next);
  assert.deepEqual(first.read.data,rows(200,20));
  const second=await f.run(first.read.next);assert.equal(second.read.complete,true);
  assert.equal(second.read.next,null);assert.deepEqual(second.read.data,rows(100,1));
});

for (const limit of [86, 100]) test(`full last ${limit} overlap fits the shared step allowance`, async()=>{
  const retained=rows(1000,limit+1), live=retained.map(row=>({...row,at:row.at-2000,text:'coffee reborn'}));
  const f=fixture({retained,live,limit,overlap:true,localComplete:true});
  const first=await f.run();
  assert.equal(first.read.denied,undefined);assert.deepEqual(first.read.data,[]);
  assert.ok(first.read.next,'all-suppressed full prefix advances');
  const all=[];let c=first.read.next;
  for(let page=0;page<10;page++) {
    const before=f.calls(), {read}=await f.run(c);
    assert.equal(f.calls()-before,1);assert.equal(read.denied,undefined);
    all.push(...read.data);c=read.next;if(!c)break;
  }
  assert.equal(c,null);assert.deepEqual(all,live);
});

test('oversized overlap proof is rejected before subset work can exhaust steps',async()=>{
  const f=fixture({retained:rows(1000,100),limit:100}),post=f.env.searchPost;
  f.env.searchPost=async(...args)=>{const r=await post(...args);r.json.searchCurrent=Array(101).fill('m1000');return r;};
  assert.equal((await f.run()).read.denied?.code,'E_INPUT');assert.equal(f.calls(),1);
});

test('merge seen set is defense in depth for a same-page pair unmarked by overlap',async()=>{
  // A valid server proof would mark this ID. Exercise the independent merge
  // guard with an inconsistent transport fixture; it is not an overlap proof.
  const row={id:'pair',at:100,text:'coffee'}, f=fixture({retained:[row],live:[row],localComplete:true});
  const {read}=await f.run();
  assert.deepEqual(read.data,[row]);assert.equal(read.next,null);assert.equal(f.calls(),1);
});

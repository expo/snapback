import test from 'node:test';
import assert from 'node:assert/strict';
import {spawn} from 'node:child_process';
import {once} from 'node:events';
import {mkdtemp, mkdir, writeFile, rm} from 'node:fs/promises';
import {readFileSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join, resolve} from 'node:path';
import {fileURLToPath} from 'node:url';
import {createClient} from '../dist/client.js';
import {createLocalClient} from '../dist/local.js';
import {webDevice, memoryPersistence} from '../dist/web.js';
import {processDevice} from '../dist/native.js';
import {Following} from '../dist/following.js';
import {DatabaseSync} from 'node:sqlite';
import {createApp} from '../dist/app.js';
import {matchRead} from '../dist/contract.js';
import {guest, logout, narrowSession, sessionKey} from '../dist/auth.js';
import {captureStdout} from './helpers/server-output.mjs';
import {waitFor, hangBudget} from './helpers/wait.mjs';

const root=fileURLToPath(new URL('../../../',import.meta.url));
const binary=resolve(process.env.SNAPBACK4_BIN ?? join(root,'target/debug/snapback4'));
const op={kind:'query',name:'cards',following:{declaration:'feed',pageSize:20,cursor:'c'}};
const post=(id,actor,at)=>({table:'posts',row:{id,authorId:`dev:${actor}`,parentId:null,at,removed:false}});
const edge=actor=>({table:'follows',row:{id:`f-${actor}`,followerId:'dev:reader',followedId:`dev:${actor}`}});
async function fixture(t,rows=[],bounded=true,transform=s=>s) {
  const dir=await mkdtemp(join(tmpdir(),'sb4-fh2-'));
  await mkdir(join(dir,'snapback'));
  const path=join(dir,'snapback/schema.q');
  const source=transform('use identity\n\n'+readFileSync(join(root,'crates/snapback4-lang/tests/fixtures/following-view.q'),'utf8').replace('sync public',bounded?'sync public last 3 by .at':'sync public'));
  const clients=[],stops=[]; let child,exited,url,log='';
  const start=async text=>{
    await writeFile(path,text);
    child=spawn(binary,['dev','--port','0','--no-watch'],{cwd:dir,stdio:['ignore','pipe','pipe']});
    exited=once(child,'exit');url=undefined;const output=captureStdout(child);
    for(const stream of [child.stdout,child.stderr]) stream.on('data',b=>{log+=b;url??=output().match(/http:\/\/127\.0\.0\.1:\d+(?=\r?\n)/)?.[0]});
    await waitFor(()=>{assert.equal(child.exitCode,null,log);return url},'Following server startup');
  };
  const stop=async()=>{if(child?.exitCode===null&&child.signalCode===null)child.kill('SIGTERM');await exited};
  t.after(async()=>{stops.forEach(s=>s());await Promise.allSettled(clients.map(c=>c.close()));await stop();await rm(dir,{recursive:true,force:true})});
  const send=async(path,body={},persona='reader')=>{
    const response=await fetch(url+path,{method:'POST',headers:{'x-snapback-persona':persona,'content-type':'application/json'},body:JSON.stringify(body)});
    const json=await response.json();assert.equal(response.status,200,JSON.stringify(json));assert.equal(json.denied,undefined,JSON.stringify(json));return json;
  };
  if(rows.length){
    await start(source.replace('view feed: activity where .actor = viewer or exists follows[viewer, .actor]\n','').replaceAll('return feed last','return activity last'));
    for(let i=0;i<rows.length;i+=256){const chunk=rows.slice(i,i+256);const r=await send('/seed',chunk);assert.equal(r.seeded,chunk.length,JSON.stringify(r))}
    await stop();
  }
  await start(source);
  const generated=await fetch(url+'/api.ts',{headers:{'x-snapback-persona':'reader'}}).then(r=>r.text());
  assert.match(generated,/cards: FollowingQuery/);assert.match(generated,/following: \{"declaration":"feed","pageSize":20,"cursor":"c"\}/);
  const mutate=async(name,args,persona='reader')=>{const r=await send('/m/'+name,{args},persona);assert.equal(r.state,'sent',JSON.stringify(r));return r};
  const open=async(tier='online',configure=()=>{},args={c:null})=>{
    const control={offline:false,followingCalls:0,requests:[],dropUnit:false,holdUnit:undefined};
    configure(control);
    const doFetch=async(input,init)=>{
      if(control.offline)throw new TypeError('offline Following witness');
      if(new URL(input).pathname==='/following/cards')control.followingCalls++;
      const response=await fetch(input,init);
      if(new URL(input).pathname==='/following/cards'){
        const request=JSON.parse(init.body),responseText=await response.clone().text();control.requests.push({request,response:JSON.parse(responseText),bytes:responseText});
        if(request.action==='unit'&&control.dropUnit){control.dropUnit=false;throw new TypeError('lost committed unit response')}
        if(request.action==='unit'&&control.holdUnit)await control.holdUnit;
      }
      return response;
    };
    let client;
    if(tier==='online')client=createClient({url,persona:'reader',fetch:doFetch});
    else client=await createLocalClient({url,persona:'reader',fetch:doFetch,device:tier==='wasm'?webDevice({wasm:readFileSync(join(root,'packages/snapback4/src/wasm/snapback4_device_bg.wasm')),persist:memoryPersistence()}):processDevice({binary,dir:join(dir,`device-${clients.length}`)})});
    clients.push(client);
    const history=new Following(client,op,args);
    stops.push(history.subscribe(()=>{}));
    return {client,history,control,get:history.getSnapshot};
  };
  return{send,mutate,open,url,dir};
}
async function page(h,n=1){await waitFor(()=>{const s=h.get();assert.notEqual(s.phase,'refused',JSON.stringify(s));return s.phase==='page'&&s.items.length>=n},'exact Following page',{diagnostics:()=>JSON.stringify({state:h.get(),recent:h.control.requests.slice(-3)})});return h.get()}

test('Following sparse online history crosses the 1,000-copy window and every page is an oracle prefix',{timeout:hangBudget(75)},async t=>{
  const rows=[edge('quiet'),...Array.from({length:1101},(_,n)=>post(`quiet-${String(n).padStart(4,'0')}`,'quiet',n)),...Array.from({length:9000},(_,n)=>post(`noise-${n}`,`noise-${n%997}`,2000+n))];
  const f=await fixture(t,rows),h=await f.open();
  const expected=rows.filter(r=>r.table==='posts'&&r.row.authorId==='dev:quiet').sort((a,b)=>b.row.at-a.row.at||b.row.id.localeCompare(a.row.id)).map(r=>r.row.id);
  for(let n=20;n<expected.length;n+=20){const s=await page(h,n);assert.deepEqual(s.items.map(i=>i.id),expected.slice(0,s.items.length));assert.equal(s.hasMore,true);h.history.loadMore()}
  const s=await page(h,expected.length);assert.deepEqual(s.items.map(i=>i.id),expected);assert.equal(s.hasMore,false);
  assert.ok(h.control.requests.every(r=>!('metered'in r.response)&&!('examined'in r.response)&&!('bound'in r.response)));
});

test('Following a roster larger than one request prepares without publishing an unordered prefix',{timeout:hangBudget(30)},async t=>{
  const f=await fixture(t,Array.from({length:8200},(_,n)=>edge(`a${String(n).padStart(5,'0')}`)).concat([post('last-author','a08199',100)])),h=await f.open();
  const s=await page(h);assert.deepEqual(s.items.map(i=>i.id),['last-author']);assert.equal(s.hasMore,false);
  assert.ok(h.control.requests.some(r=>r.response.phase==='preparing'));
  for(const r of h.control.requests.filter(r=>r.response.phase==='preparing'))assert.equal(r.response.items,undefined);
});

for(const tier of ['wasm','native'])test(`Following ${tier}: offline inbox, live prepend, own-edge withdrawal, replay, expiry and two tabs`,{timeout:hangBudget(40)},async t=>{
  const f=await fixture(t,[edge('alice'),...Array.from({length:25},(_,n)=>post(`p${String(n).padStart(2,'0')}`,'alice',n))],false);
  const h=await f.open(tier);await page(h,20);
  const second=await f.open();await page(second,20);
  const openings=[h,second].map(x=>x.control.requests.find(r=>r.response.opening).response.opening);assert.notEqual(...openings);
  // Replay cannot consume the sibling tab or substitute another card image.
  const unit=h.control.requests.find(r=>r.request.action==='unit'&&r.response.phase==='page');
  assert.equal(JSON.stringify(await f.send('/following/cards',unit.request)),unit.bytes);
  h.history.loadMore();await page(h,25);assert.equal(second.get().items.length,20);
  h.control.offline=true;await h.client.sync();await waitFor(()=>h.get().phase==='offline','offline phase');
  const inbox=await h.client.query(op,{c:null});await waitFor(()=>JSON.stringify(h.get().items)===JSON.stringify(inbox.data),'offline inbox settles');assert.deepEqual(h.get().items,inbox.data);assert.equal(h.get().fact,'older posts are not on this device');
  const calls=h.control.followingCalls;await new Promise(r=>setTimeout(r,50));assert.equal(h.control.followingCalls,calls);
  h.control.offline=false;await h.client.sync();await page(h,25);
  await f.mutate('post',{postId:'new-live',parentId:null},'alice');await h.client.sync();await waitFor(async()=>{assert.notEqual(h.get().phase,'refused',JSON.stringify(h.get()));return h.get().items[0]?.id==='new-live'},'live prepend',{diagnostics:()=>JSON.stringify({state:h.get(),requests:h.control.requests.slice(-3)})});
  assert.equal(h.control.requests.filter(r=>r.response.opening).length,1,'a later birth does not restart history');
  const own=h.client.mutate({kind:'mutation',name:'post'},{postId:'my-post',parentId:null},{waitSeconds:0});
  assert.equal(h.get().items.length,0,'own-post admission fences mounted server pages in the call turn');
  assert.notEqual((await own).state,'failed');await h.client.sync();
  await waitFor(()=>h.get().items.some(i=>i.id==='my-post'),'own post after observation');
  const write=await h.client.mutate({kind:'mutation',name:'unfollow'},{actor:'dev:alice'},{waitSeconds:0});assert.notEqual(write.state,'failed');
  assert.equal(h.get().items.length,0,'own-edge intent withdraws synchronously: '+JSON.stringify(h.get()));
  await h.client.sync();await waitFor(()=>h.get().phase==='page'&&h.get().items.length===1&&h.get().items[0].id==='my-post','unfollow withdrawal');
  const replay=await f.send('/following/cards',unit.request);assert.equal(replay.phase,'restart');
  await f.send('/dev/clock/advance',{duration:'6m'});
  await waitFor(()=>h.control.requests.filter(r=>r.response.opening).length>1,'idle expiry restarts explicitly');
  assert.ok(h.control.requests.some(r=>r.response.phase==='restart'));
});

test('Following retries a lost committed response with the same token and keeps new-follow deliveries in the live layer',{timeout:hangBudget(20)},async t=>{
  const f=await fixture(t,[edge('alice'),...Array.from({length:25},(_,n)=>post(`p${n}`,'alice',n)),post('bob-old','bob',100)]);
  const h=await f.open('online',c=>{c.dropUnit=true});await page(h,20);
  const units=h.control.requests.filter(r=>r.request.action==='unit');
  assert.ok(units.length>=2);assert.deepEqual(units[1].request,units[0].request);assert.equal(units[1].bytes,units[0].bytes);
  assert.equal(new Set(h.get().items.map(i=>i.id)).size,20);
  await f.mutate('follow',{actor:'dev:bob'});await waitFor(()=>h.get().items[0]?.id==='bob-old','new-follow live delivery');
  assert.equal(h.control.requests.filter(r=>r.response.opening).length,1);
  h.history.loadMore();await page(h,26);assert.equal(h.get().hasMore,false);
  const historyIds=h.control.requests.filter(r=>r.request.action==='unit'&&r.response.phase==='page').flatMap(r=>r.response.items.map(i=>i.id));
  assert.ok(!historyIds.includes('bob-old'),'post-B edge is outside the frozen historical domain');
});

test('Following serve binds authenticated viewers, refuses unsupported input and rejects a revoked bearer',{timeout:hangBudget(10)},async t=>{
  const f=await fixture(t);const signed=await guest(f.url);assert.equal(signed.ok,true,JSON.stringify(signed));
  const request=async(body,token=signed.session.token)=>{const r=await fetch(f.url+'/following/cards',{method:'POST',headers:{authorization:`Bearer ${token}`,'content-type':'application/json'},body:JSON.stringify(body)});return {status:r.status,json:await r.json()}};
  const opened=await request({action:'open',args:{c:null}});assert.equal(opened.status,200);assert.equal(typeof opened.json.opening,'string');
  const unit={action:'unit',opening:opened.json.opening,args:{c:null}};
  assert.equal((await request(unit)).json.phase,'page');
  const other=await guest(f.url);assert.equal(other.ok,true);assert.equal((await request(unit,other.session.token)).json.phase,'restart');
  assert.equal((await request({action:'no-such-action',opening:opened.json.opening,args:{c:null}})).json.code,'E_FOLLOWING_INPUT');
  await logout(f.url,signed.session.token);const revoked=await request(unit);assert.equal(revoked.status,401);assert.equal(revoked.json.denied.code,'E_AUTH');
});

test('a delayed unit cannot publish an author withdrawn before mounted authorization',{timeout:hangBudget(10)},async t=>{
  const f=await fixture(t,[edge('alice'),post('old','alice',1)]);
  let release;const hold=new Promise(r=>release=r);
  const h=await f.open('online',c=>{c.holdUnit=hold});
  await waitFor(()=>h.control.requests.some(r=>r.request.action==='unit'),'committed held unit');
  assert.equal(h.get().phase,'preparing');assert.deepEqual(h.get().items,[]);
  await f.mutate('unfollow',{actor:'dev:alice'});
  const shown=[];const stop=h.history.subscribe(()=>shown.push(...h.get().items.map(i=>i.id)));t.after(stop);
  release();await waitFor(()=>h.get().phase==='page'&&h.get().items.length===0,'withdrawn empty domain');assert.deepEqual(shown,[]);
});

test('Following shaped HTTP and SDK measurements', {skip: !process.env.SNAPBACK4_FH_MEASURE, timeout:hangBudget(120)}, async t=>{
  for(const [label,rows] of [
    ['sparse-50000',[edge('quiet'),...Array.from({length:50000},(_,n)=>post(`p${String(n).padStart(5,'0')}`,n<1100?'quiet':`u${n%998}`,n))]],
    ['follows-8200',Array.from({length:8200},(_,n)=>[edge(`a${String(n).padStart(5,'0')}`),post(`p${String(n).padStart(5,'0')}`,`a${String(n).padStart(5,'0')}`,n)]).flat()],
  ]){
    const f=await fixture(t,rows);const begin=performance.now();const h=await f.open();await page(h,20);const first=performance.now()-begin;
    const later=[];for(let n=40;n<=120;n+=20){const at=performance.now();h.history.loadMore();await page(h,n);later.push(performance.now()-at)}
    console.log('FH_HTTP',JSON.stringify({label,first_page_ms:first,later_page_ms:later,preparation_requests:h.control.requests.filter(r=>r.request.action==='unit'&&r.response.phase==='preparing').length,opening_requests:h.control.requests.filter(r=>r.request.action==='open').length,unit_bytes:h.control.requests.filter(r=>r.request.action==='unit').map(r=>Buffer.byteLength(r.bytes))}));
    await h.client.close();
  }
});

for(const tier of ['wasm','native'])test(`Following ${tier} routes history past source floors online and keeps pending own posts ahead of it`,{timeout:hangBudget(15)},async t=>{
  const f=await fixture(t,[edge('alice'),...Array.from({length:25},(_,n)=>post(`floor-${n}`,'alice',n))]);
  const h=await f.open(tier);await page(h,20);
  assert.ok(h.control.requests.some(r=>r.request.action==='unit'&&r.response.phase==='page'));
  h.control.offline=true;await h.client.sync();
  await waitFor(()=>h.get().phase==='offline'&&h.get().inbox&&!('data' in h.get().inbox),'floored card query is withheld offline');
  assert.equal(h.get().fact,'older posts are not on this device');
  assert.deepEqual(h.get().items,[]);
  const calls=h.control.followingCalls;
  const write=await h.client.mutate({kind:'mutation',name:'post'},{postId:'pending-own',parentId:null},{waitSeconds:0});assert.notEqual(write.state,'failed');
  assert.equal(h.control.followingCalls,calls,'offline admission never asks for server history');
  h.control.offline=false;await h.client.sync();
  await waitFor(()=>h.get().phase==='page'&&h.get().items[0]?.id==='pending-own','observed own post prepends after reconnect');
});


test('Following refuses read sessions before custody, while an ordinary inbox remains a matchRead read', {timeout:hangBudget(20)}, async t=>{
  const f=await fixture(t),full=await guest(f.url);assert.ok(full.ok);
  const raw=async(session,body)=>fetch(f.url+'/following/cards',{method:'POST',headers:{authorization:`Bearer ${session.token}`},body:JSON.stringify({args:{c:null},...body})});
  const read=await narrowSession(f.url,full.session);assert.ok(read.ok);
  const opened=await raw(full.session,{action:'open'}).then(r=>r.json());assert.equal(typeof opened.opening,'string');
  const db=new DatabaseSync(join(f.dir,'.snapback4/store.sqlite'),{readOnly:true});t.after(()=>db.close());
  const snapshot=()=>JSON.stringify(['r','_ops','_outbox','_requests','_effect_presence','_sessions','_read_sessions'].map(table=>[table,db.prepare(`SELECT * FROM ${table}`).all()]));
  const before=snapshot();
  for(const action of ['open','unit','refresh','cancel']){
    const response=await raw(read.session,{action,opening:opened.opening,mounted:[]});
    assert.equal(response.status,403);const body=await response.json();assert.equal(body.denied.code,'E_READ_ONLY');assert.equal('head' in body,false);assert.equal('store_id' in body,false);
  }
  assert.equal(snapshot(),before);
  const requests=[];
  const doFetch=async(input,init)=>{requests.push(new URL(input).pathname);return fetch(input,init)};
  const ro=createClient({url:f.url,session:read.session,readOnly:true,fetch:doFetch});t.after(()=>ro.close());
  const stored=new Map([[sessionKey(f.url,true),JSON.stringify(read.session)]]);
  const app=createApp({url:f.url,readOnly:true,fetch:doFetch,sessionStore:{async get(k){return stored.get(k)??null},async set(k,v){stored.set(k,v)},async delete(k){stored.delete(k)}}});t.after(()=>app.close());assert.ok((await app.ready).ok);
  for(const client of [ro,app.client]){
    const history=new Following(client,op,{c:null}),stop=history.subscribe(()=>{});t.after(stop);
    assert.equal(history.getSnapshot().phase,'refused');assert.equal(history.getSnapshot().code,'E_READ_ONLY');
    history.retry();history.loadMore();assert.equal(history.getSnapshot().phase,'refused');
  }
  const inbox=await ro.query(op,{c:null});assert.ok('data' in inbox);
  assert.equal(matchRead(inbox,{present:()=> 'inbox',absent:()=> 'inbox',partial:()=> 'partial',denied:()=> 'denied',loading:()=> 'loading'}),'inbox');
  assert.equal(app.online.readOnly,true);
  assert.ok('data' in await app.online.query(op,{c:null}),'read-only online arm keeps ordinary inbox access');
  assert.equal(requests.some(p=>p.startsWith('/following/')),false);
  assert.equal(snapshot(),before);
  // A raw read credential cannot bypass the server allow-list, even without
  // opting into the SDK's read-only constructor. The refusal is terminal.
  const unmarked=createClient({url:f.url,session:read.session,fetch:doFetch});t.after(()=>unmarked.close());
  const history=new Following(unmarked,op,{c:null}),stop=history.subscribe(()=>{});t.after(stop);
  await waitFor(()=>history.getSnapshot().phase==='refused','raw read token refusal');assert.equal(history.getSnapshot().code,'E_READ_ONLY');
  assert.equal(snapshot(),before);
  const calls=requests.filter(p=>p.startsWith('/following/')).length;
  await unmarked.query(op,{c:null});await new Promise(resolve=>setTimeout(resolve,1100));
  assert.equal(requests.filter(p=>p.startsWith('/following/')).length,calls,'a refused observer must not restart preparation polling');
  // The refused cancel cannot consume or evict the full session's unit.
  assert.equal((await raw(full.session,{action:'unit',opening:opened.opening}).then(r=>r.json())).phase,'page');
});


test('wide cards continue authorization and live shaping within request allowances',{timeout:hangBudget(35)},async t=>{
  const fields=Array.from({length:120},(_,n)=>`  extra${String(n).padStart(3,'0')}: int default 0`).join('\n');
  const f=await fixture(t,Array.from({length:100},(_,n)=>post(`wide-${String(n).padStart(3,'0')}`,'reader',n)),true,s=>s.replace('table posts:','table posts:\n'+fields)),h=await f.open();
  let count=0;
  while(true){const s=await page(h,count+1);count=s.items.length;if(!s.hasMore)break;h.history.loadMore()}
  assert.equal(count,100);assert.equal(h.get().omissions.length,0);
  assert.deepEqual(h.get().items.map(x=>x.id),Array.from({length:100},(_,n)=>`wide-${String(99-n).padStart(3,'0')}`));
  const sliced=h.control.requests.filter(r=>r.request.action==='refresh'&&r.response.phase==='preparing');
  assert.ok(sliced.some(r=>r.request.mounted.length>=32&&r.response.checked));
  assert.ok(h.control.requests.every(r=>Buffer.byteLength(JSON.stringify(r.request))<=64*1024));
  for(let n=0;n<20;n++)await f.mutate('post',{postId:`live-${n}`,parentId:null});
  await page(h,120);
  assert.equal(new Set(h.get().items.map(x=>x.id)).size,120);
  assert.ok(h.control.requests.some(r=>r.request.action==='refresh'&&r.response.phase==='preparing'&&r.response.live.length));
  assert.equal(h.get().omissions.length,0);
});

test('live cards remain authorized and mounted after the inbox window rolls',{timeout:hangBudget(30)},async t=>{
  const f=await fixture(t,[edge('alice'),post('old','alice',1)]),h=await f.open();await page(h);
  await f.mutate('post',{postId:'live-00',parentId:null},'alice');await page(h,2);
  for(let n=1;n<=20;n++)await f.mutate('post',{postId:`live-${String(n).padStart(2,'0')}`,parentId:null},'alice');
  await page(h,22);
  assert.ok(h.get().items.some(x=>x.id==='live-00'));
  assert.equal(new Set(h.get().items.map(x=>x.id)).size,22);
  const at=h.get().items.map(x=>x.at);assert.deepEqual(at,[...at].sort((a,b)=>b-a));
  assert.equal(h.get().hasMore,false);
  await f.mutate('remove',{postId:'live-00'},'alice');
  await waitFor(()=>h.get().phase==='page'&&!h.get().items.some(x=>x.id==='live-00'),'retained live tombstone');
  await f.mutate('unfollow',{actor:'dev:alice'});
  await waitFor(()=>h.get().phase==='page'&&h.get().items.length===0,'retained live edge withdrawal');
});

test('explicit refresh includes backdated post-bound births in the next exact session',{timeout:hangBudget(20)},async t=>{
  const rows=Array.from({length:25},(_,n)=>post(`future-${n}`,'reader',Date.now()+100000+n));
  const f=await fixture(t,rows),h=await f.open();await page(h,20);
  await f.mutate('post',{postId:'backdated',parentId:null});
  h.history.loadMore();await page(h,25);assert.equal(h.get().hasMore,false);
  assert.equal(h.get().items.some(x=>x.id==='backdated'),false,'the current frozen domain does not expand');
  h.history.refresh();await page(h,20);h.history.loadMore();await page(h,26);
  assert.equal(h.get().items.at(-1).id,'backdated');assert.equal(h.get().hasMore,false);
  assert.equal(new Set(h.get().items.map(x=>x.id)).size,26);
  assert.equal(h.control.requests.filter(r=>r.response.opening).length,2);
});

test('cross-operation cancellation cannot evict an opening or its pinned page',{timeout:hangBudget(15)},async t=>{
  const f=await fixture(t,[post('old','reader',1)]);
  const opened=await f.send('/following/cards',{action:'open',args:{c:null}});
  const unit={action:'unit',opening:opened.opening,args:{c:null}};
  const wrong={action:'cancel',opening:opened.opening,args:{c:null}};
  await f.send('/following/home',wrong);
  const before=await f.send('/following/cards',unit);assert.equal(before.phase,'page');
  await f.send('/following/home',wrong);assert.deepEqual(await f.send('/following/cards',unit),before);
  await f.send('/following/cards',wrong);assert.equal((await f.send('/following/cards',unit)).phase,'restart');
});


test('one card can reauthorize more fields than a single witness permits',{timeout:hangBudget(20)},async t=>{
  const fields=Array.from({length:200},(_,n)=>`  extra${String(n).padStart(3,'0')}: int default 0`).join('\n');
  const f=await fixture(t,Array.from({length:40},(_,n)=>post(`wide-${String(n).padStart(3,'0')}`,'reader',n)),true,s=>s.replace('table posts:','table posts:\n'+fields)),h=await f.open();
  let count=0;
  while(true){const s=await page(h,count+1);count=s.items.length;if(!s.hasMore)break;h.history.loadMore()}
  assert.equal(count,40);assert.equal(h.get().omissions.length,0);
  const units=h.control.requests.filter(r=>r.request.action==='unit'&&r.response.phase==='page');
  assert.ok(units.some(r=>r.response.items.some(i=>i.authority.some(w=>w.fields.length>128))));
  for(const r of h.control.requests.filter(r=>r.request.action==='refresh')){
    for(const m of r.request.mounted)for(const w of m.authority)assert.ok(w.fields.length<=128);
    assert.ok(Buffer.byteLength(JSON.stringify(r.request))<=64*1024);
  }
  assert.equal(new Set(h.get().items.map(x=>x.id)).size,40);
});

test('witness fragments include query arguments at and beyond the 64 KiB envelope boundary',{timeout:hangBudget(20)},async t=>{
  const fields=Array.from({length:120},(_,n)=>`  extra${String(n).padStart(3,'0')}: int default 0`).join('\n');
  const f=await fixture(t,[post('one','reader',1)],true,s=>s.replace('table posts:','table posts:\n'+fields)
    .replace('query cards(c: cursor ?):','query cards(c: cursor ?, padding: text <=65000):')
    .replace('return feed last 20 by .at after c { *, post: posts[.post] }','return feed last 20 by .at after c { *, post: posts[.post], label: padding }'));
  const prefix='é"\\',probeArgs={c:null,padding:prefix};
  const opened=await f.send('/following/cards',{action:'open',args:probeArgs});
  const unit=await f.send('/following/cards',{action:'unit',opening:opened.opening,args:probeArgs});
  assert.equal(unit.items[0].kind,'shaped');assert.equal(unit.items[0].authority.length,1);
  const mounted=[{id:'one',live:false,authority:unit.items[0].authority}];
  const envelope=args=>({action:'refresh',opening:opened.opening,mounted,args});
  const room=65536-Buffer.byteLength(JSON.stringify(envelope(probeArgs)));
  await f.send('/following/cards',{action:'cancel',opening:opened.opening,args:probeArgs});
  for(const extra of [0,1,64400-prefix.length-room]){
    const args={c:null,padding:prefix+'x'.repeat(room+extra)};
    const unsplit=Buffer.byteLength(JSON.stringify(envelope(args)));
    assert.equal(unsplit,65536+extra);
    const h=await f.open('online',()=>{},args);await page(h);
    assert.equal(h.get().items[0].label,args.padding);assert.equal(h.get().items.length,1);
    const refreshes=h.control.requests.filter(r=>r.request.action==='refresh'&&r.request.mounted.length);
    assert.equal(refreshes.length,extra===0?1:2,'only an envelope that crosses the allowance needs another fragment');
    assert.ok(h.control.requests.every(r=>Buffer.byteLength(JSON.stringify(r.request))<=65536));
    assert.ok(refreshes.every(r=>r.response.visible.includes('one')));
    if(extra===0)assert.equal(Buffer.byteLength(JSON.stringify(refreshes[0].request)),65536);
    await h.client.close();
  }
});

for(const tier of ['online','wasm'])test(`Following and the ${tier} app online arm preserve independent fences through rotation`,{timeout:hangBudget(25)},async t=>{
  const f=await fixture(t),requests=[];
  const app=createApp({url:f.url,...(tier==='wasm'?{device:webDevice({wasm:readFileSync(join(root,'packages/snapback4/src/wasm/snapback4_device_bg.wasm')),persist:memoryPersistence()})}:{}),
    fetch:async(input,init)=>{if(new URL(input).pathname.startsWith('/following/'))requests.push(JSON.parse(init.body));return fetch(input,init)}});
  t.after(()=>app.close());await app.ready;assert.ok((await app.auth.guest()).ok);
  assert.notEqual((await app.mutate({kind:'mutation',name:'post'},{postId:'owned',parentId:null})).state,'failed');
  const history=new Following(app.client,op,{c:null});t.after(history.subscribe(()=>{}));
  await waitFor(()=>{assert.notEqual(history.getSnapshot().phase,'refused',JSON.stringify(history.getSnapshot()));return history.getSnapshot().items[0]?.id==='owned'},'Following through the app facade');
  const arm=app.online;assert.equal((await arm.query(op,{c:null})).data[0].id,'owned');
  const opens=requests.filter(r=>r.action==='open').length;
  assert.ok((await app.client.refreshSession()).ok);assert.notEqual(app.online,arm);
  assert.equal((await arm.query(op,{c:null})).denied.code,'E_AUTH');
  await waitFor(()=>requests.filter(r=>r.action==='open').length>opens&&history.getSnapshot().items[0]?.id==='owned','Following restarts its own revision after rotation');
  assert.equal((await app.online.query(op,{c:null})).data[0].id,'owned');
  const own=app.mutate({kind:'mutation',name:'post'},{postId:'pending',parentId:null},{waitSeconds:0});
  assert.equal(history.getSnapshot().items.length,0,'own-write fence remains ahead of history even with an online arm');
  assert.notEqual((await own).state,'failed');
  await waitFor(()=>history.getSnapshot().items.length===2,'own post observed through its original facade');
  await app.auth.logout();assert.equal(history.getSnapshot().items.length,0);
  assert.equal((await app.online.query(op,{c:null})).denied.code,'E_AUTH');
});

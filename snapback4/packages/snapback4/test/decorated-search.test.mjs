// @ref LLP 3000.028#3.3.1 — generated same-state page differential, with
// independent point-read oracles on the actual authority host.
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { spawn } from 'node:child_process';
import { createClient } from '../dist/client.js';
import { createLocalClient } from '../dist/local.js';
import { processDevice } from '../dist/native.js';
import { webDevice, memoryPersistence } from '../dist/web.js';
import { setTimeout as delay } from 'node:timers/promises';
import { ServerClock } from '../dist/clock.js';
import { binary, server, until } from './helpers/app-server.mjs';
import { parkedChanges } from './helpers/sync-control.mjs';
import { schema, random } from './helpers/search-oracle.mjs';
const op = name => ({ kind: 'query', name });
const mutation = name => ({ kind: 'mutation', name });
const shape = '{ *, title: rooms[.room].title, sender: profiles[principal = .author].name, ownerName: profiles[principal = rooms[.room].owner].name, privateName: cards[principal = .author].name }';
function source(direction, limit) {
  let s = schema({ direction, limit, mutable: true }).replace('  text: text <=200\n', '  author: principal\n  text: text <=200\n').replace('insert messages { id, room, text', "insert messages { id, room, author: 'dev:alice', text");
  const page = `messages matching q where not .tombstone ${direction} ${limit} by .at after c`;
  return s + `
table rooms:
  expires: time ?
  expire at .expires
  title: text <=200
  owner: principal
  read <- exists members[.id, viewer]
  update <- true
  delete <- true
  retain delivered-history
  sync to members[.id]
table profiles:
  principal: principal
  expires: time ?
  expire at .expires
  name: text <=80
  unique principal
  public
  update <- true
  delete <- true
  sync public
table cards:
  principal: principal
  reader: principal
  expires: time ?
  expire at .expires
  name: text <=80
  unique principal
  read <- .reader = viewer
  update <- true
  sync to .reader
query decorated(q: text <=100, c: cursor ?):
  return ${page} ${shape}
query projected(q: text <=100, c: cursor ?):
  return ${page} { text, title: rooms[.room].title }
query chat(room: id, q: text <=100, c: cursor ?):
  return messages[room = room] matching q where not .tombstone ${direction} ${limit} by .at after c
query chatDecorated(room: id, q: text <=100, c: cursor ?):
  return messages[room = room] matching q where not .tombstone ${direction} ${limit} by .at after c ${shape}
query point(id: id):
  return messages[id]
query roomPoint(id: id):
  return rooms[id]
query profilePoint(who: principal):
  return profiles[principal = who]
query cardPoint(who: principal):
  return cards[principal = who]
mutation rename(room: id, name: text <=80):
  update rooms[room] { title: name }
  update profiles[principal = 'dev:alice'] { name }
mutation renameRoom(room: id, name: text <=80):
  if rooms[room] != null:
    update rooms[room] { title: name }
mutation hide():
  update cards[principal = 'dev:alice'] { reader: 'dev:alice' }
mutation dropProfile():
  if profiles[principal = 'dev:alice'] != null:
    delete profiles[principal = 'dev:alice']
mutation dropRoom(room: id):
  if rooms[room] != null:
    delete rooms[room]
`;
}
function normalized(cursor) {
  if (!cursor?.startsWith('sb4s:')) return cursor ?? null;
  const value = JSON.parse(Buffer.from(cursor.slice(5),'base64url'));
  const binding = JSON.parse(value.binding); binding[0] = '<operation>'; value.binding = binding;
  return value;
}
for (const tier of ['process','wasm']) test(`decorated generated search oracle on ${tier}`, { timeout: 270000 }, async t => {
  const counts = { pages: 0, online: 0, offline: 0, short: 0, currentNull: 0, retainedNull: 0, expiryPages: 0, expiryNulls: 0, browsePages: 0, browseExpiryPages: 0 };
  for (let seed = 1; seed <= Number(process.env.SJ_SEARCH_SEEDS ?? 12); seed++) {
    await t.test(`seed ${seed}`, async t => {
      const needle = seed <= 8 ? 'coffee' : ['', '   ', '!?', '☕️'][((seed - 9) % 4)];
      const rng = random(seed * 9989), direction = seed % 2 ? 'last' : 'first', limit = 3 + rng(4);
      const { url, dir } = await server(t,'',seed<=8?source(direction,limit):source(direction,limit).replace('sync to members[.room]\n  retain delivered-history','sync to members[.room] last 10 by .at\n  retain delivered-history'));
      const remote = createClient({url,persona:'bob'}), admin = createClient({url,persona:'alice'});
      const initial = [], expiryRng=random(seed*7919), epoch=Date.now(), expires=()=>epoch+(4+expiryRng(3))*60000;
      const profileExpiry=expires();
      const memberships = new Set(['live','left', ...(rng(2) ? ['extra'] : [])]);
      for (const room of ['live','left','extra']) {
        for (const who of ['bob','alice'].filter(who => who === 'alice' || memberships.has(room))) initial.push({table:'members',row:{id:`${room}-${who}`,room,principal:`dev:${who}`}});
        initial.push({table:'rooms',row:{id:room,title:room,owner:'dev:alice',expires:expires()}});
      }
      initial.push({table:'profiles',row:{id:'p',principal:'dev:alice',name:'Alice',expires:profileExpiry}}, {table:'cards',row:{id:'c',principal:'dev:alice',reader:'dev:bob',name:'Private Alice',expires:expires()}});
      for (let i=0;i<25;i++) initial.push({table:'messages',row:{id:`m${String(i).padStart(2,'0')}`,room:i>15?'left':rng(2)?'live':'extra',author:'dev:alice',text:'coffee',at:1000+i,tombstone:false,expires:null}});
      const seeded=await fetch(`${url}/seed`,{method:'POST',body:JSON.stringify(initial)}).then(r=>r.json()); assert.equal(seeded.seeded,initial.length,JSON.stringify(seeded));
      let offline=false, core, requests=0;
      const deadlines=new Map();
      const paths=[];
      const opener=tier==='process'?processDevice({binary,dir:join(dir,'device'),spawn:(cmd,args)=>{const p=spawn(cmd,args);p.stderr.pipe(process.stderr);return p;}}):webDevice({persist:memoryPersistence(),wasm:readFileSync(new URL('../src/wasm/snapback4_device_bg.wasm',import.meta.url))});
      const client=await createLocalClient({url,persona:'bob',device:{async open(...args){core=await opener.open(...args);return {close:()=>core.close(),call:async request=>{
          const reply=await core.call(request); if(request.op==='query') deadlines.set(request.name,reply.ok?.nextExpiry??null); return reply;
        }};}},fetch:async(input,init)=>{
        if(offline)throw new TypeError('offline');
        const path=new URL(input).pathname;paths.push(path);if(path==='/changes')return parkedChanges(init.signal);
        if(['/q/search','/q/decorated','/q/projected'].includes(path))requests++;
        const response=await fetch(input,init);
        if(path.startsWith('/q/')) deadlines.set(path.slice(3),(await response.clone().json()).nextExpiry??null);
        return response;
      }});
      t.after(async()=>{await client.close();await remote.close();await admin.close();}); await client.sync();
      const call=async(name,args={},as=admin)=>{const r=await as.mutate(mutation(name),args);assert.equal(r.state,'sent',JSON.stringify(r));};
      const heldPoint=async(name,args)=>{const r=await core.call({op:'query',name,viewer:'dev:bob',args,now:client.now()});assert.ok(!r.denied,JSON.stringify(r));return r.ok?.data??null;};
      async function check(step, chat) {
        const names=chat?['chat','chatDecorated']:['search','decorated'];
        let aCursor=null,bCursor=null;
        for(let n=0;n<3;n++) {
          const pathStart=paths.length;
          const args={q:needle,...(chat?{room:chat}:{})};const start=requests;
          const a=await client.query(op(names[0]),{...args,c:aCursor});
          const b=await client.query(op(names[1]),{...args,c:bCursor});
          const label=`seed=${seed} step=${step} room=${chat} page=${n}`;
          assert.ok(Array.isArray(a.data)&&Array.isArray(b.data),`${label} ${JSON.stringify({a,b})}`);
          assert.deepEqual(b.data.map(r=>r.id),a.data.map(r=>r.id),label);
          assert.equal(deadlines.get(names[1])??null,deadlines.get(names[0])??null,`${label} nextExpiry`);
          for(const key of ['complete','cut','fresh','since'])assert.equal(b[key],a[key],`${label} ${key}`);
          assert.deepEqual(normalized(b.next),normalized(a.next),`${label} next`);
          if(!chat&&!offline)assert.equal(requests-start,2,`${label} exactly one server call per form`);
          counts.pages++;if(seed>8){counts.browsePages++;if(client.now()>=profileExpiry)counts.browseExpiryPages++;}if(client.now()>=profileExpiry)counts.expiryPages++;counts[offline?'offline':'online']++;if(b.data.length<limit&&b.next)counts.short++;
          const points=new Map();
          for(const hit of b.data) {
            const current=offline || chat && !paths.slice(pathStart).includes(`/q/${names[1]}`)?null:(await remote.query(op('point'),{id:hit.id})).data;
            const point=async(name,args)=>{
              const key=JSON.stringify([!!current,name,args]);
              if(!points.has(key))points.set(key,current?(await remote.query(op(name),args)).data:await heldPoint(name,args));
              return points.get(key);
            };
            const room=await point('roomPoint',{id:hit.room}),profile=await point('profilePoint',{who:hit.author}),card=await point('cardPoint',{who:hit.author});
            const owner=room?await point('profilePoint',{who:room.owner}):null;
            assert.deepEqual([hit.title,hit.sender,hit.ownerName,hit.privateName],[room?.title??null,profile?.name??null,owner?.name??null,card?.name??null],label);
            if(!profile)counts[current?'currentNull':'retainedNull']++;
            if(client.now()>=profileExpiry && step<7){assert.equal(hit.sender,null,`${label} seeded expiry`);counts.expiryNulls++;}
          }
          aCursor=a.next;bCursor=b.next;if(!aCursor)break;
        }
      }
      for(let step=0;step<24;step++) {
        if(offline){offline=false;await client.sync();}
        if(step) {const advanced=await fetch(`${url}/dev/clock/advance`,{method:'POST',body:JSON.stringify({duration:'1m'})});assert.equal(advanced.status,200);}
        switch(step) {
          case 1:await call('leave',{room:'left'},remote);memberships.delete('left');break;
          case 2:await call('rename',{room:'left',name:`After leave ${seed}`});break;
          case 3:await call('hide');break;
          case 4:await call('relocate',{id:'m24',room:'live',text:'not matching',at:2000});break;
          case 5:await call('rebirth',{id:'m23',room:'extra',text:'not matching',at:2001});break;
          case 6:await call('dropRoom',{room:'left'});break;
          case 7:await call('dropProfile');break;
          case 8:await call('join',{room:'left'});memberships.add('left');break;
          case 9:if(memberships.has('extra'))await call('leave',{room:'extra'},remote);memberships.delete('extra');break;
          default:if(step>9) {
            const room=rng(2)?'live':'extra',id=`m${String(rng(25)).padStart(2,'0')}`;
            switch(rng(6)) {
              case 0:await call(memberships.has(room)?'leave':'join',{room},memberships.has(room)?remote:admin);if(memberships.has(room))memberships.delete(room);else memberships.add(room);break;
              case 1:await call('relocate',{id,room,text:rng(2)?'coffee':'other',at:900+rng(200)});break;
              case 2:await call('rebirth',{id,room,text:rng(2)?'coffee':'other',at:900+rng(200)});break;
              case 3:await call('renameRoom',{room,name:`Random ${seed}/${step}`});break;
              default:await call('edit',{id,text:rng(2)?'coffee edited':'other',at:900+rng(200),expires:null});
            }
          }
        }
        if(step!==4 && step!==5) await client.sync();
        if(step!==4 && step!==5 && (step===2||step===6||step===10||rng(6)===0)){offline=true;await client.sync();}
        await check(step); await check(step,'left');
        // A projection can omit its source identity/order; merge still owns both.
        const a=await client.query(op('search'),{q:'coffee'}),p=await client.query(op('projected'),{q:'coffee'});
        assert.deepEqual(p.data?.map(r=>r.text),a.data?.map(r=>r.text),`projection seed=${seed} step=${step}`);
      }
    });
  }
  assert.ok(counts.online&&counts.offline&&counts.short&&counts.currentNull&&counts.retainedNull&&counts.expiryPages&&counts.expiryNulls,JSON.stringify(counts));
  if(Number(process.env.SJ_SEARCH_SEEDS??12)>8)assert.ok(counts.browsePages&&counts.browseExpiryPages,JSON.stringify(counts));
  console.log(`SJ ${tier} oracle ${JSON.stringify(counts)}`);
});

const gate=()=>{let release;const promise=new Promise(r=>release=r);return {promise,release};};
for(const tier of ['process','wasm']) for(const mode of ['watch','one-shot']) test(`decoration expiry preserves current and retained rows ${tier} ${mode}`,{timeout:60000},async t=>{
  const {url,dir}=await server(t,'',source('last',4));
  const remote=createClient({url,persona:'bob'});t.after(()=>remote.close());
  const deadline=Date.now()+3600000;
  const rows=['live','left'].flatMap(room=>[
    {table:'members',row:{id:room,room,principal:'dev:bob'}},
    {table:'rooms',row:{id:room,title:room,owner:'dev:alice',expires:deadline}},
    {table:'messages',row:{id:room,room,author:'dev:alice',text:'coffee',at:room==='live'?2:1,tombstone:false,expires:null}},
  ]);
  rows.push({table:'profiles',row:{id:'p',principal:'dev:alice',name:'Alice',expires:deadline}},
    {table:'cards',row:{id:'c',principal:'dev:alice',reader:'dev:bob',name:'Private Alice',expires:deadline}});
  const post=async(path,body)=>fetch(url+path,{method:'POST',headers:{'x-snapback-persona':'bob'},body:JSON.stringify(body)}).then(r=>r.json());
  assert.equal((await post('/seed',rows)).seeded,rows.length);
  let wall,childClock,core,freeze=false,expired=false,cross=false;
  const clock=new ServerClock(()=>wall??Date.now()),fork=clock.fork.bind(clock);clock.fork=()=>childClock=fork();
  const blocked=gate(),reached=gate(),raw=[];
  const opener=tier==='process'?processDevice({binary,dir:join(dir,'device'),spawn:(cmd,args)=>spawn(cmd,args,{stdio:['pipe','pipe','inherit']})}):webDevice({persist:memoryPersistence(),wasm:readFileSync(new URL('../src/wasm/snapback4_device_bg.wasm',import.meta.url))});
  async function advance(){
    await post('/dev/clock/advance',{duration:'2h'});
    wall=deadline+3600000;expired=true;clock.sample(wall,wall,wall);childClock.sample(wall,wall,wall);
  }
  const client=await createLocalClient({url,persona:'bob',device:{async open(...args){core=await opener.open(...args);return core;}},fetch:clock.wrap(async(input,init)=>{
    const path=new URL(input).pathname;
    if(path==='/changes'||freeze&&path==='/sync')return parkedChanges(init.signal);
    if(mode==='watch'&&expired&&path==='/q/decorated'){reached.release();await blocked.promise;}
    const response=await fetch(input,init);
    if(path.startsWith('/q/'))raw.push({name:path.slice(3),request:JSON.parse(init.body),...(await response.clone().json())});
    if(cross&&path==='/q/decorated'){cross=false;await advance();}
    return response;
  })});
  t.after(async()=>{blocked.release();await client.close();});await client.sync();
  assert.equal((await remote.mutate(mutation('leave'),{room:'left'})).state,'sent');await client.sync();freeze=true;
  const args={q:'coffee'},bare=await client.query(op('search'),args);
  assert.deepEqual(bare.data.map(r=>r.id),['live','left']);
  const before=await client.query(op('decorated'),args);
  assert.deepEqual(before.data.map(r=>r.sender),['Alice','Alice']);
  for(const name of ['search','decorated'])assert.equal(raw.findLast(r=>r.name===name).nextExpiry,null);
  assert.equal(raw.findLast(r=>r.name==='decorated').decorationExpiry,deadline);
  for(const name of ['search','decorated']){
    const reply=await core.call({op:'query',name,args,viewer:'dev:bob',now:deadline-1});
    assert.equal(reply.ok.nextExpiry,null);
    assert.equal(reply.ok.searchRows,undefined,'ordinary device replies do not serialize unused source keys');
    if(name==='decorated')assert.equal(reply.ok.decorationExpiry,deadline);
  }
  let after;
  if(mode==='watch'){
    const live=client.observe(op('decorated'),args),publications=[];
    const stop=live.subscribe(()=>publications.push(live.getSnapshot()));t.after(()=>{stop();live.close();});
    await until(()=>live.getSnapshot().data?.length===2,'initial decorated publication');
    const first=live.getSnapshot();publications.length=0;
    await advance();live.getSnapshot();await reached.promise;
    assert.deepEqual(live.getSnapshot().data.map(r=>r.id),first.data.map(r=>r.id),'value refresh in flight keeps both sources');
    assert.ok(live.getSnapshot().data.every(r=>[r.title,r.sender,r.ownerName,r.privateName].every(v=>v===null)),'in-flight expired fields are already null');
    for(const key of ['fresh','since','complete','cut','next'])assert.equal(live.getSnapshot()[key],first[key],key);
    blocked.release();await until(()=>raw.findLast(r=>r.name==='decorated').decorationExpiry==null && live.getSnapshot().data?.every(r=>r.sender===null),'expired decorations refreshed');
    after=live.getSnapshot();assert.ok(publications.every(r=>r.data?.length===2),'no loading/empty publication');
  }else{
    cross=true;const calls=raw.length;after=await client.query(op('decorated'),args);
    assert.equal(raw.slice(calls).filter(r=>r.name==='decorated').length,1,'one-shot returns the bare page with nulled decorations in one attempt');
  }
  assert.deepEqual(after.data.map(r=>r.id),bare.data.map(r=>r.id));
  for(const key of ['fresh','since','complete','cut'])assert.equal(after[key],bare[key],key);
  assert.deepEqual(normalized(after.next),normalized(bare.next));
  for(const row of after.data)assert.deepEqual([row.title,row.sender,row.ownerName,row.privateName],[null,null,null,null]);
  const last=raw.findLast(r=>r.name==='decorated');assert.equal(last.nextExpiry,null);if(mode==='watch')assert.equal(last.decorationExpiry??null,null);
  const device=await core.call({op:'query',name:'decorated',args,viewer:'dev:bob',now:wall});
  assert.equal(device.ok.nextExpiry,null);assert.equal(device.ok.decorationExpiry,null);
  assert.ok(device.ok.data.every(r=>r.sender===null));
});

// Each authority's value deadline is independent of the later bare deadline.
for(const clockKind of ['valueDevice','valueServer']) test(`decoration ${clockKind} refresh preserves bare expiry`,async()=>{
  const {correctReadExpiries,armReadExpiry}=await import('../dist/read-expiry.js');
  let now=100,refreshed=0,withdrawn=0;
  const row={id:'hit'},watch={deadlines:{device:200,server:300,localWakeup:false,valueDevice:150,valueServer:150,[clockKind]:100},expiryTimer:null,snapshot:{data:[row],fresh:true}};
  const clock={issuedDeviceNow:()=>now,estimatedServerNow:()=>now,deviceDelay:d=>Math.max(0,d-now),serverDelay:d=>Math.max(0,d-now)};
  const sweep=()=>correctReadExpiries([watch],clock,()=>{withdrawn++;return()=>{};},(w,d)=>armReadExpiry(w,d,clock,()=>true,()=>{},undefined,false),()=>{refreshed++;});
  sweep();assert.equal(withdrawn,0);assert.equal(refreshed,1);assert.equal(watch.snapshot.data[0],row);assert.equal(watch.snapshot.fresh,true);
  assert.equal(watch.deadlines.device,200);assert.equal(watch.deadlines.server,300);
  sweep();assert.equal(refreshed,1,'consumed value wakeup does not spin');
  now=150;sweep();assert.equal(refreshed,2,'the other authority keeps its future value wakeup');assert.equal(withdrawn,0);
  now=200;sweep();assert.equal(withdrawn,1,'bare page deadline still withdraws');
  clearTimeout(watch.expiryTimer);
});


const rememberedSource=`use identity
table messages:
  text: text <=200
  at: time
  immutable at
  expires: time ?
  expire at .expires
  search text
  public
table profiles:
  name: text <=80
  expires: time ?
  expire at .expires
  public
query bare(q: text <=100, c: cursor ?):
  return messages matching q last 10 by .at after c
query decorated(q: text <=100, c: cursor ?):
  return messages matching q last 10 by .at after c { *, label: profiles['p'].name, stable: 'source-independent', bundle: { label: profiles['p'].name, stable: 'always', deep: { label: profiles['p'].name, stable: .text } }, whole: profiles['p'], selectedStable: { unused: profiles['p'].name, stable: 'selected' }.stable, selectedBundle: { inner: { label: profiles['p'].name, stable: 'selected-inner' } }.inner }
`;
const pageFacts=read=>({ids:read.data?.map(r=>r.id),complete:read.complete,cut:read.cut,next:read.next??null,fresh:read.fresh,since:read.since});
for(const tier of ['process','wasm']) test(`remembered unsynced decorated answer expires offline: ${tier} query and watch`,{timeout:60000},async t=>{
  const {url,dir}=await server(t,'',rememberedSource),deadline=Date.now()+3600000;
  assert.equal((await fetch(url+'/seed',{method:'POST',body:JSON.stringify([
    {table:'messages',row:{id:'m',text:'coffee',at:1,expires:null}},
    {table:'profiles',row:{id:'p',name:'Label',expires:deadline}},
  ])}).then(r=>r.json())).seeded,2);
  const backend=await fetch(url+'/schema',{headers:{'x-snapback-persona':'bob'}}).then(r=>r.json());
  assert.equal(backend.schema.operations.decorated.search_decoration,true);
  let offline=false,child;const clock=new ServerClock(),fork=clock.fork.bind(clock);clock.fork=()=>child=fork();
  const opener=tier==='process'?processDevice({binary,dir:join(dir,'device'),spawn:(cmd,args)=>spawn(cmd,args,{stdio:['pipe','pipe','inherit']})}):webDevice({persist:memoryPersistence(),wasm:readFileSync(new URL('../src/wasm/snapback4_device_bg.wasm',import.meta.url))});
  const client=await createLocalClient({url,persona:'bob',device:opener,fetch:clock.wrap(async(input,init)=>{
    if(offline)throw new TypeError('offline');
    if(new URL(input).pathname==='/changes')return parkedChanges(init.signal);
    return fetch(input,init);
  })});t.after(()=>client.close());await client.sync();
  assert.equal((await client.query(op('bare'),{q:'coffee'})).data[0].id,'m');
  assert.equal((await client.query(op('decorated'),{q:'coffee'})).data[0].label,'Label');
  const bare=client.observe(op('bare'),{q:'coffee'}),watch=client.observe(op('decorated'),{q:'coffee'});
  const publications=[],stop=watch.subscribe(()=>publications.push(watch.getSnapshot()));
  t.after(()=>{stop();watch.close();bare.close();});
  await until(()=>watch.getSnapshot().data?.[0]?.label==='Label'&&bare.getSnapshot().data?.length===1);
  offline=true;await client.sync();
  await until(()=>watch.getSnapshot().fresh===false&&bare.getSnapshot().fresh===false);
  publications.length=0;
  child.sample(deadline+1,Date.now(),Date.now(),'offline:1');
  const now=watch.getSnapshot();assert.equal(now.data?.[0]?.label,null,'access masks before any async recovery');
  assert.equal(now.data[0].stable,'source-independent');assert.deepEqual(now.data[0].bundle,{label:null,stable:'always',deep:{label:null,stable:'coffee'}});assert.equal(now.data[0].whole,null);
  const a=await client.query(op('bare'),{q:'coffee'}),b=await client.query(op('decorated'),{q:'coffee'});
  const expected=pageFacts(a),actual=pageFacts(b);delete expected.since;delete actual.since;
  assert.deepEqual(actual,expected);assert.equal(b.data[0].label,null);assert.equal(b.data[0].stable,'source-independent');
  assert.ok(a.since<=Date.now()&&b.since<=Date.now(),'both retain their remembered confirmation ages');
  await delay(200);assert.ok(publications.every(r=>r.data?.[0]?.id==='m'&&r.data[0].label===null),JSON.stringify(publications));
  assert.equal(watch.getSnapshot().data[0].label,null);
});

for(const episode of [false,true]) test(`createClient accepts skewed decoration replies and keeps refreshing${episode?' during revocation':''}`,{timeout:60000},async t=>{
  const {url}=await server(t,'',rememberedSource),deadline=Date.now()+3600000;
  await fetch(url+'/seed',{method:'POST',body:JSON.stringify([
    {table:'messages',row:{id:'m',text:'coffee',at:1,expires:null}},
    {table:'profiles',row:{id:'p',name:'Label',expires:deadline}},
  ])});
  const clock=new ServerClock();let skew=false,unknown=false,hold=false;const requests=[],gateReply=gate();
  const client=createClient({url,persona:'bob',fetch:clock.wrap(async(input,init)=>{
    const path=new URL(input).pathname;if(path==='/changes')return parkedChanges(init.signal);
    if(path==='/q/decorated'){requests.push(performance.now());if(hold)await gateReply.promise;}
    const response=await fetch(input,init);
    if(!skew)return response;
    const headers=new Headers(response.headers);headers.delete('x-snapback-time');
    const body=await response.json();if(unknown)delete body.decorationExpiry;
    return Response.json(body,{status:response.status,headers});
  })});t.after(async()=>{gateReply.release();await client.close();});
  const watch=client.observe(op('decorated'),{q:'coffee'}),publications=[];
  const stop=watch.subscribe(()=>publications.push(watch.getSnapshot()));t.after(()=>{stop();watch.close();});
  await until(()=>watch.getSnapshot().data?.[0]?.label==='Label');
  const before=watch.getSnapshot();publications.length=0;
  if(episode){const {answerObservation}=await import('../dist/read-observation.js');answerObservation(before).reload(true);}
  skew=true;hold=true;clock.sample(deadline+3600000,Date.now(),Date.now(),'skew:1');
  const masked=watch.getSnapshot();assert.equal(masked.data?.[0]?.label,null);assert.deepEqual(pageFacts(masked),pageFacts(before));
  gateReply.release();hold=false;
  const at=requests.length,one=await client.query(op('decorated'),{q:'coffee'});
  assert.equal(one.data?.[0]?.label,null,'one-shot returns the page under skew');assert.deepEqual(pageFacts(one),pageFacts(before));
  assert.equal(one.data[0].stable,'source-independent');
  await until(()=>requests.length>=at+6,'unbounded value retries past four attempts');
  assert.ok(requests.at(-1)-requests[at]>175,'skew outlasts the old retry window');
  assert.ok(requests.length<20,'value retries are paced');
  assert.ok(publications.every(r=>r.data?.[0]?.id==='m'&&r.data[0].label===null),JSON.stringify(publications));
  unknown=true;assert.equal((await client.query(op('decorated'),{q:'coffee'})).data?.[0]?.label,null,'unknown value deadline cannot block or expose old values');unknown=false;
  const attempts=requests.length;
  await fetch(url+'/dev/clock/advance',{method:'POST',body:JSON.stringify({duration:'2h'})});
  await until(()=>requests.length>attempts,'server expiry refresh');await delay(1200);
  const settled=requests.length;await delay(1200);assert.equal(requests.length,settled,'authoritative null expiry ends value retries despite the skewed estimate');
  assert.equal(watch.getSnapshot().data?.[0]?.label,null);
});

test('createClient source-page deadline still withdraws a decorated page',async t=>{
  const clock=new ServerClock();let serverNow=1000,queryCalls=0;const stopReply=gate();
  const client=createClient({url:'http://expiry.invalid',persona:'bob',fetch:clock.wrap(async(input,init)=>{
    if(new URL(input).pathname==='/changes')return parkedChanges(init.signal);
    if(++queryCalls>1)await stopReply.promise;
    return Response.json({data:[{id:'m',label:'Label'}],tables:['messages'],seq:1,complete:true,nextExpiry:3000,decorationExpiry:2000,decorationPaths:[['label']]},
      {headers:{'x-snapback-time':String(serverNow),'x-snapback-clock':`clock:${serverNow}`}});
  })});t.after(async()=>{stopReply.release();await client.close();});
  const watch=client.observe(op('decorated'),{});t.after(()=>watch.close());
  await until(()=>watch.getSnapshot().data?.length===1);
  serverNow=2000;clock.sample(serverNow,Date.now(),Date.now(),'clock:2000');
  assert.equal(watch.getSnapshot().data?.[0]?.label,null);
  serverNow=3000;clock.sample(serverNow,Date.now(),Date.now(),'clock:3000');
  assert.deepEqual(watch.getSnapshot(),{loading:true});
});

test('an approved older page nulls its own decorations while a newer raw page waits for approval',async()=>{
  const {ReadObservation}=await import('../dist/read-observation.js');
  const {ReadApprovals}=await import('../dist/read-approval.js');
  const {withDecorations}=await import('../dist/read-decoration.js');
  const {armReadExpiry,correctReadExpiries}=await import('../dist/read-expiry.js');
  const {readyRead}=await import('../dist/read-existence.js');
  let now=100;const clock={issuedDeviceNow:()=>now,estimatedServerNow:()=>now,deviceDelay:d=>Math.max(0,d-now),serverDelay:d=>Math.max(0,d-now)};
  const owner=new ReadObservation(),approvals=new ReadApprovals();
  const sweep=()=>correctReadExpiries([owner],clock,w=>w.expire(),arm,()=>{});
  const arm=(w,d)=>armReadExpiry(w,d,clock,()=>true,sweep,undefined,false);
  const answer=(label,expiry)=>withDecorations(readyRead({data:[{id:'m',label}],complete:true,cut:null,fresh:true}),[['label']],null,expiry,()=>now,()=>now);
  owner.publish(answer('A',150));arm(owner,{device:null,server:300,localWakeup:false,valueServer:150});
  const approved=approvals.approve(owner.snapshot);
  owner.publish(answer('B',250));arm(owner,{device:null,server:400,localWakeup:false,valueServer:250});
  assert.equal(approved.read().data[0].label,'A');
  now=150;sweep();
  assert.equal(approved.read().data[0].label,null);assert.equal(approved.read().data[0].id,'m');
  assert.equal(owner.read(null).data[0].label,'B');
  now=300;sweep();assert.deepEqual(approved.read(),{loading:true});
  approvals.close();clearTimeout(owner.expiryTimer);
});

for(const tier of ['process','wasm','online']) test(`nested decoration placeholders preserve generated object shapes and recover: ${tier}`,{timeout:60000},async t=>{
  const source=rememberedSource.replace('table profiles:\n','table profiles:\n  update <- true\n')+`
mutation renew(expires: time):
  update profiles['p'] { name: 'Restored', expires }
`;
  const {url,dir}=await server(t,'',source),deadline=Date.now()+3600000;
  const generated=readFileSync(join(dir,'snapback/generated/api.ts'),'utf8');
  assert.match(generated,/bundle: \{[^\n]*deep: \{ label: string \| null; stable: string \}; label: string \| null; stable: string \}/,'only dependent leaves are nullable; object shells and stable fields are required');
  assert.match(generated,/whole: [^\n]+ \| null/,'a whole point-read value is nullable');
  await fetch(url+'/seed',{method:'POST',body:JSON.stringify([
    {table:'messages',row:{id:'m',text:'coffee',at:1,expires:null}},
    {table:'profiles',row:{id:'p',name:'Label',expires:deadline}},
  ])});
  let child,hold=false;const clock=new ServerClock(),fork=clock.fork.bind(clock);clock.fork=()=>child=fork();
  const held=gate(),reached=gate(),wire=[];
  const transport=clock.wrap(async(input,init)=>{
    const path=new URL(input).pathname;if(path==='/changes')return parkedChanges(init.signal);
    if(path==='/q/decorated'&&hold){reached.release();await held.promise;}
    const response=await fetch(input,init);
    if(path==='/q/decorated')wire.push(await response.clone().json());
    return response;
  });
  const client=tier==='online'?createClient({url,persona:'bob',fetch:transport}):await createLocalClient({url,persona:'bob',fetch:transport,
    device:tier==='process'?processDevice({binary,dir:join(dir,'device'),spawn:(cmd,args)=>spawn(cmd,args,{stdio:['pipe','pipe','inherit']})}):webDevice({persist:memoryPersistence(),wasm:readFileSync(new URL('../src/wasm/snapback4_device_bg.wasm',import.meta.url))})});
  t.after(async()=>{held.release();await client.close();});if(tier!=='online')await client.sync();
  const watch=client.observe(op('decorated'),{q:'coffee'},{keep:false});t.after(()=>watch.close());
  await until(()=>watch.getSnapshot().data?.[0]?.bundle.label==='Label');
  const before=watch.getSnapshot();assert.equal(before.fresh,true);
  assert.deepEqual(wire.at(-1).decorationPaths,[['bundle','deep','label'],['bundle','label'],['label'],['selectedBundle','label'],['whole']]);
  hold=true;(child??clock).sample(deadline+1,Date.now(),Date.now(),'nested:1');
  const masked=watch.getSnapshot();await reached.promise;
  assert.deepEqual(pageFacts(masked),pageFacts(before));
  assert.deepEqual(masked.data[0].bundle,{label:null,stable:'always',deep:{label:null,stable:'coffee'}});
  assert.equal(masked.data[0].whole,null);assert.equal(masked.data[0].stable,'source-independent');
  assert.equal(masked.data[0].selectedStable,'selected');assert.deepEqual(masked.data[0].selectedBundle,{label:null,stable:'selected-inner'});
  assert.equal(before.data[0].bundle.label,'Label','masking does not mutate earlier reads');
  const later=deadline+7200000;
  const response=await fetch(url+'/m/renew',{method:'POST',headers:{'x-snapback-persona':'bob'},body:JSON.stringify({args:{expires:later},id:`renew-${tier}`})});
  assert.equal(response.status,200,await response.clone().text());
  hold=false;held.release();
  await until(()=>watch.getSnapshot().data?.[0]?.bundle.deep.label==='Restored','a later proven deadline restores nested values');
  const restored=watch.getSnapshot();assert.deepEqual(pageFacts(restored),pageFacts(before));
  assert.equal(restored.data[0].bundle.stable,'always');assert.equal(restored.data[0].whole.name,'Restored');
  assert.equal(wire.at(-1).decorationExpiry,later);
  const one=await client.query(op('decorated'),{q:'coffee'});assert.equal(one.data[0].bundle.deep.label,'Restored');
});

const browseSource=`use identity
 table parents:
  owner: principal
  immutable owner
  read <- .owner = viewer
  sync last 1 by .id
 table messages:
  parent: parents
  text: text <=200
  at: time
  immutable parent, at
  read through .parent
  insert <- true
  delete <- true
  retain delivered-history
  search text
  sync
 table profiles:
  name: text <=80
  expires: time ?
  expire at .expires
  public
  sync public
 query bare(q: text <=100, c: cursor ?):
  return messages[parent = 'a'] matching q last 10 by .at after c
 query decorated(q: text <=100, c: cursor ?):
  return messages[parent = 'a'] matching q last 10 by .at after c { *, bundle: { label: profiles['p'].name, stable: 'always', deep: { label: profiles['p'].name, stable: .text } } }
 mutation replace():
  delete messages['old']
  insert messages { id: 'new', parent: 'a', text: 'coffee', at: 2 }
`.replace(/^ /gm,'');
for(const tier of ['process','wasm']) for(const needle of ['','   ','!?','☕️']) for(const mode of ['watch','one-shot'])
test(`retained browse keeps value deadlines ${tier} ${mode} needle=${JSON.stringify(needle)}`,{timeout:60000},async t=>{
  const {url,dir}=await server(t,'',browseSource),deadline=Date.now()+3600000;
  const post=(path,body)=>fetch(url+path,{method:'POST',headers:{'x-snapback-persona':'bob'},body:JSON.stringify(body)}).then(r=>r.json());
  assert.equal((await post('/seed',[
    ...['a','z'].map(id=>({table:'parents',row:{id,owner:'dev:bob'}})),
    {table:'messages',row:{id:'old',parent:'a',text:'coffee',at:1}},
    {table:'profiles',row:{id:'p',name:'Label',expires:deadline}},
  ])).seeded,4);
  let core,child,freeze=false,hold=false,cross=false;const requests=[],blocked=gate(),reached=gate();
  const clock=new ServerClock(),fork=clock.fork.bind(clock);clock.fork=()=>child=fork();
  const advance=async()=>{await post('/dev/clock/advance',{duration:'2h'});child.sample(deadline+3600000,Date.now(),Date.now(),'browse:1');};
  const opener=tier==='process'?processDevice({binary,dir:join(dir,'device'),spawn:(cmd,args)=>spawn(cmd,args,{stdio:['pipe','pipe','inherit']})}):webDevice({persist:memoryPersistence(),wasm:readFileSync(new URL('../src/wasm/snapback4_device_bg.wasm',import.meta.url))});
  const client=await createLocalClient({url,persona:'bob',device:{async open(...args){core=await opener.open(...args);return core;}},fetch:clock.wrap(async(input,init)=>{
    const path=new URL(input).pathname;if(path==='/changes'||freeze&&path==='/sync')return parkedChanges(init.signal);
    if(path==='/q/decorated'){requests.push(JSON.parse(init.body));if(hold){reached.release();await blocked.promise;}}
    const response=await fetch(input,init);if(cross&&path==='/q/decorated'){cross=false;await advance();}return response;
  })});t.after(async()=>{blocked.release();await client.close();});await client.sync();freeze=true;
  // The real read-through device protocol: departure plus partial rejoin before
  // the unacquired parent arrives. The server later has a different current row.
  const state=(await core.call({op:'state'})).ok;
  for(const page of [
    {events:[{table:'messages',kind:'scope',id:'left',data:['dev:bob']}]},
    {events:[],joined:{messages:[['dev:bob']]}},
  ])assert.equal((await core.call({op:'apply',page:{snapshot:false,watermark:state.watermark,generation:state.generation,more:false,...page}})).denied,undefined);
  assert.equal((await post('/m/replace',{id:'replace',args:{}})).state,'sent');
  const args={q:needle},local=(await core.call({op:'query',name:'decorated',args,viewer:'dev:bob',now:client.now()})).ok;
  assert.equal(local.unknown,true);assert.equal(local.retainedRows[0].retained,true);assert.equal(local.decorationExpiry,deadline);
  const bare=await client.query(op('bare'),args),before=await client.query(op('decorated'),args);
  assert.deepEqual(before.data.map(r=>r.id),['new','old']);assert.deepEqual(pageFacts(before),pageFacts(bare));
  assert.ok(before.data.every(r=>r.bundle.label==='Label'));assert.equal(requests.at(-1).provenance,true,'routeLocal retained-row composition');
  let after;
  if(mode==='watch'){
    const watch=client.observe(op('decorated'),args,{keep:false}),publications=[];
    const stop=watch.subscribe(()=>publications.push(watch.getSnapshot()));t.after(()=>{stop();watch.close();});
    await until(()=>watch.getSnapshot().data?.length===2);const first=watch.getSnapshot();publications.length=0;
    hold=true;await advance();after=watch.getSnapshot();
    assert.deepEqual(pageFacts(after),pageFacts(first));
    for(const row of after.data)assert.deepEqual(row.bundle,{label:null,stable:'always',deep:{label:null,stable:'coffee'}});
    await reached.promise;hold=false;blocked.release();await until(()=>watch.getSnapshot().data?.every(r=>r.bundle.label===null));
    assert.ok(publications.every(r=>r.data?.length===2));
  }else{
    const at=requests.length;cross=true;after=await client.query(op('decorated'),args);assert.equal(requests.length-at,1,'no decoration-caused publication retry');
  }
  assert.deepEqual(pageFacts(after),pageFacts(before));
  for(const row of after.data)assert.deepEqual(row.bundle,{label:null,stable:'always',deep:{label:null,stable:'coffee'}});
});

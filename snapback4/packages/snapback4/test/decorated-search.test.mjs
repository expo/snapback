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
  update rooms[room] { title: name }
mutation hide():
  update cards[principal = 'dev:alice'] { reader: 'dev:alice' }
mutation dropProfile():
  delete profiles[principal = 'dev:alice']
mutation dropRoom(room: id):
  delete rooms[room]
`;
}
function normalized(cursor) {
  if (!cursor?.startsWith('sb4s:')) return cursor ?? null;
  const value = JSON.parse(Buffer.from(cursor.slice(5),'base64url'));
  const binding = JSON.parse(value.binding); binding[0] = '<operation>'; value.binding = binding;
  return value;
}
for (const tier of ['process','wasm']) test(`decorated generated search oracle on ${tier}`, { timeout: 180000 }, async t => {
  const counts = { pages: 0, online: 0, offline: 0, short: 0, currentNull: 0, retainedNull: 0 };
  for (let seed = 1; seed <= Number(process.env.SJ_SEARCH_SEEDS ?? 8); seed++) {
    await t.test(`seed ${seed}`, async t => {
      const rng = random(seed * 9989), direction = seed % 2 ? 'last' : 'first', limit = 3 + rng(4);
      const { url, dir } = await server(t,'',source(direction,limit));
      const remote = createClient({url,persona:'bob'}), admin = createClient({url,persona:'alice'});
      const initial = [];
      const memberships = new Set(['live','left', ...(rng(2) ? ['extra'] : [])]);
      for (const room of ['live','left','extra']) {
        for (const who of ['bob','alice'].filter(who => who === 'alice' || memberships.has(room))) initial.push({table:'members',row:{id:`${room}-${who}`,room,principal:`dev:${who}`}});
        initial.push({table:'rooms',row:{id:room,title:room,owner:'dev:alice'}});
      }
      initial.push({table:'profiles',row:{id:'p',principal:'dev:alice',name:'Alice'}}, {table:'cards',row:{id:'c',principal:'dev:alice',reader:'dev:bob',name:'Private Alice'}});
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
      const heldPoint=async(name,args)=>{const r=await core.call({op:'query',name,viewer:'dev:bob',args,now:Date.now()});assert.ok(!r.denied,JSON.stringify(r));return r.ok?.data??null;};
      async function check(step, chat) {
        const names=chat?['chat','chatDecorated']:['search','decorated'];
        let aCursor=null,bCursor=null;
        for(let n=0;n<3;n++) {
          const pathStart=paths.length;
          const args={q:'coffee',...(chat?{room:chat}:{})};const start=requests;
          const a=await client.query(op(names[0]),{...args,c:aCursor});
          const b=await client.query(op(names[1]),{...args,c:bCursor});
          const label=`seed=${seed} step=${step} room=${chat} page=${n}`;
          assert.ok(Array.isArray(a.data)&&Array.isArray(b.data),`${label} ${JSON.stringify({a,b})}`);
          assert.deepEqual(b.data.map(r=>r.id),a.data.map(r=>r.id),label);
          assert.equal(deadlines.get(names[1])??null,deadlines.get(names[0])??null,`${label} nextExpiry`);
          for(const key of ['complete','cut','fresh','since'])assert.equal(b[key],a[key],`${label} ${key}`);
          assert.deepEqual(normalized(b.next),normalized(a.next),`${label} next`);
          if(!chat&&!offline)assert.equal(requests-start,2,`${label} exactly one server call per form`);
          counts.pages++;counts[offline?'offline':'online']++;if(b.data.length<limit&&b.next)counts.short++;
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
          }
          aCursor=a.next;bCursor=b.next;if(!aCursor)break;
        }
      }
      for(let step=0;step<24;step++) {
        if(offline){offline=false;await client.sync();}
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
  assert.ok(counts.online&&counts.offline&&counts.short&&counts.currentNull&&counts.retainedNull,JSON.stringify(counts));
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
    if(path.startsWith('/q/'))raw.push({name:path.slice(3),...(await response.clone().json())});
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
    assert.deepEqual(live.getSnapshot().data,first.data,'value refresh in flight keeps both sources');
    for(const key of ['fresh','since','complete','cut','next'])assert.equal(live.getSnapshot()[key],first[key],key);
    blocked.release();await until(()=>live.getSnapshot().data?.every(r=>r.sender===null),'expired decorations refreshed');
    after=live.getSnapshot();assert.ok(publications.every(r=>r.data?.length===2),'no loading/empty publication');
  }else{
    cross=true;const calls=raw.length;after=await client.query(op('decorated'),args);
    assert.equal(raw.slice(calls).filter(r=>r.name==='decorated').length,2,'one-shot retries a crossed value deadline');
  }
  assert.deepEqual(after.data.map(r=>r.id),bare.data.map(r=>r.id));
  for(const key of ['fresh','since','complete','cut'])assert.equal(after[key],bare[key],key);
  assert.deepEqual(normalized(after.next),normalized(bare.next));
  for(const row of after.data)assert.deepEqual([row.title,row.sender,row.ownerName,row.privateName],[null,null,null,null]);
  const last=raw.findLast(r=>r.name==='decorated');assert.equal(last.nextExpiry,null);assert.equal(last.decorationExpiry??null,null);
  const device=await core.call({op:'query',name:'decorated',args,viewer:'dev:bob',now:wall});
  assert.equal(device.ok.nextExpiry,null);assert.equal(device.ok.decorationExpiry,null);
  assert.ok(device.ok.data.every(r=>r.sender===null));
});

// Each authority's value deadline is independent of the later bare deadline.
for(const clockKind of ['valueDevice','valueServer']) test(`decoration ${clockKind} refresh preserves bare expiry`,async()=>{
  const {correctReadExpiries}=await import('../dist/read-expiry.js');
  let now=100,refreshed=0,withdrawn=0;
  const row={id:'hit'},watch={deadlines:{device:200,server:300,localWakeup:false,valueDevice:150,valueServer:150,[clockKind]:100},expiryTimer:null,snapshot:{data:[row],fresh:true}};
  const clock={issuedDeviceNow:()=>now,estimatedServerNow:()=>now};
  const sweep=()=>correctReadExpiries([watch],clock,()=>{withdrawn++;return()=>{};},(w,d)=>{w.deadlines=d;},()=>{refreshed++;});
  sweep();assert.equal(withdrawn,0);assert.equal(refreshed,1);assert.equal(watch.snapshot.data[0],row);assert.equal(watch.snapshot.fresh,true);
  assert.equal(watch.deadlines.device,200);assert.equal(watch.deadlines.server,300);
  sweep();assert.equal(refreshed,1,'consumed value wakeup does not spin');
  now=150;sweep();assert.equal(refreshed,2,'the other authority keeps its future value wakeup');assert.equal(withdrawn,0);
  now=200;sweep();assert.equal(withdrawn,1,'bare page deadline still withdraws');
});

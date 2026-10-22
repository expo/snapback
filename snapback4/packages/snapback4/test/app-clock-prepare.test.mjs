// @ref LLP 3000.000.000.001#11-wave-22-loop-repairs-dx6 — provisional App clocks cannot outlive their staged credential image.
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { pathToFileURL } from 'node:url';

const selectedDist=process.env.SNAPBACK4_CLIENT_DIST??process.env.KIT2_BASELINE_DIST;
const dist=selectedDist?pathToFileURL(resolve(selectedDist)+'/'):new URL('../dist/',import.meta.url);
const [{createApp},{sessionKey},{webDevice,memoryPersistence}]=await Promise.all(['app.js','auth.js','web.js'].map(file=>import(new URL(file,dist).href)));
const modelBackend={generation:1,schema:{tables:{}},programs:[{name:'viewer',kind:'Query',args:{},body:[{Return:{Literal:{String:'alice'}}}]}]};
const modelPage=(seq,request)=>({generation:1,snapshot:!request.stream,events:[],watermark:seq,images_at:seq,committed_above:{},more:false,store_id:'session-model-store'});

const url='https://app-clock.invalid',day=86400000;
const wasm=readFileSync(new URL('wasm/snapback4_device_bg.wasm',dist));
const deferred=()=>{let resolve;const promise=new Promise(r=>resolve=r);return {promise,resolve};};
const store=values=>({async get(key){return values.get(key)??null;},async set(key,value){values.set(key,value);},async delete(key){values.delete(key);}});
function clonePersistence(source){const copy=memoryPersistence();for(const [name,rows] of structuredClone([...source.stores]))copy.stores.set(name,rows);return copy;}
const clockImages=persist=>[...persist.stores.values()].flatMap(rows=>[...rows.values()].filter(c=>c.s==='m'&&c.k==='client:server-clock').map(c=>JSON.parse(c.v)));

function fixture(t,{held=false,reject=false,clockFailure=false}={}){
  const at=Date.now(),original={principal:'alice',kind:'user',token:'full-token',expiresAt:at+3*day};
  const key=sessionKey(url),values=new Map([[key,JSON.stringify(original)]]),persist=memoryPersistence();
  const entered=deferred(),release=deferred(),backing=store(values),apps=[];
  let failClock=clockFailure,failedClock=false;
  const sessions={...backing,async set(k,value){
    if(k===key&&JSON.parse(value).expiresAt>original.expiresAt){entered.resolve();if(held)await release.promise;if(reject)throw Error('credential commit unavailable');}
    await backing.set(k,value);
  }};
  const raw=webDevice({wasm,persist}),device={async open(...args){
    const core=await raw.open(...args);
    return {...core,async call(request,...rest){
      if(failClock&&request.op==='set_meta'&&request.key==='server-clock'&&JSON.parse(request.value).offset>day){
        failedClock=true;
        assert.equal(JSON.parse(values.get(key)).expiresAt,original.expiresAt+4*day,'credential commit precedes every advanced clock save');
        throw Error('clock disk unavailable');
      }
      return core.call(request,...rest);
    }};
  }};
  const fetcher=async(input,init)=>{
    const path=new URL(input).pathname;
    if(path==='/changes')return new Promise((_,no)=>{if(init.signal.aborted)no(init.signal.reason);else init.signal.addEventListener('abort',()=>no(init.signal.reason),{once:true});});
    const body=path==='/schema'?modelBackend:path==='/sync'?modelPage(0,JSON.parse(init.body)):path==='/probe'?{ok:true,viewer:'alice',scope:'full',seq:0,store_id:'session-model-store'}:path.startsWith('/auth/')?{ok:true}:{data:{id:'viewer'},complete:true,tables:[],seq:0,store_id:'session-model-store'};
    return Response.json(body,{headers:{'x-snapback-time':String(Date.now()+4*day),'x-snapback-clock':'host:1','x-snapback-session-timing':'staging','x-snapback-session-expires':String(original.expiresAt+4*day)}});
  };
  const app=createApp({url,sessionStore:sessions,device,fetch:fetcher});apps.push(app);
  t.after(async()=>{release.resolve();await Promise.allSettled(apps.map(app=>app.close()));});
  return {app,apps,at,original,key,values,persist,entered:entered.promise,release:release.resolve,
    recoverClock(){failClock=false;},clockFailed:()=>failedClock};
}

async function reopenCheckpoint(t,f,values,persist){
  const app=createApp({url,sessionStore:store(values),device:webDevice({wasm,persist}),fetch:async()=>{throw Error('offline crash checkpoint');}});
  f.apps.push(app);
  assert.equal((await app.ready).ok,true,'the independent crash checkpoint opens offline');
  assert.equal(app.auth.state,'signed-in');assert.equal(app.client.session().token,f.original.token);
  assert.ok(values.has(f.key),'offline reopening keeps the live credential');
  return app;
}

test('App startup crash while credential commit is held cannot retain an advanced device clock',async t=>{
  const f=fixture(t,{held:true});await f.entered;
  assert.equal(f.app.auth.state,'restoring');
  const credentials=new Map(f.values),device=clonePersistence(f.persist);
  assert.equal(JSON.parse(credentials.get(f.key)).expiresAt,f.original.expiresAt);
  assert.ok(clockImages(device).every(image=>image.offset<day),'only previously committed clock images belong to the crash checkpoint');
  // Complete/release the original runtime only after capturing the crash.
  // Reopening uses independent storage copies and no original in-memory clock.
  f.release();assert.equal((await f.app.ready).ok,true);await f.app.close();
  const restored=await reopenCheckpoint(t,f,credentials,device);
  assert.ok(restored.client.now()<f.original.expiresAt);
});

test('failed App credential commit discards the provisional clock, including close',async t=>{
  const f=fixture(t,{reject:true});assert.equal((await f.app.ready).ok,false);await f.app.close();
  assert.equal(JSON.parse(f.values.get(f.key)).expiresAt,f.original.expiresAt);
  assert.ok(clockImages(f.persist).every(image=>image.offset<day));
  await reopenCheckpoint(t,f,new Map(f.values),clonePersistence(f.persist));
});

test('cancelled App opening never activates its prepared clock persistence',async t=>{
  const f=fixture(t,{held:true});await f.entered;
  const closed=f.app.close();f.release();await Promise.all([closed,f.app.ready]);
  assert.equal(f.app.auth.state,'signed-out');
  assert.ok(clockImages(f.persist).every(image=>image.offset<day));
  await reopenCheckpoint(t,f,new Map(f.values),clonePersistence(f.persist));
});

test('clock-save failure after App credential commit warns without rolling identity back',async t=>{
  const f=fixture(t,{clockFailure:true});assert.equal((await f.app.ready).ok,true);
  assert.ok(f.clockFailed());assert.equal(f.app.auth.state,'signed-in');assert.match(f.app.auth.why.message,/clock disk unavailable/);
  assert.equal(JSON.parse(f.values.get(f.key)).expiresAt,f.original.expiresAt+4*day);
  f.recoverClock();await f.app.client.query({kind:'query',name:'viewer'},{});await f.app.close();
  assert.ok(clockImages(f.persist).some(image=>image.offset>day),'ordinary device work retries the failed clock save');
});

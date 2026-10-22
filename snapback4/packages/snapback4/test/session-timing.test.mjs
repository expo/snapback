// @ref LLP 3000.000.000.001#11-wave-22-loop-repairs-dx6 — live staging expiry reconciliation precedes business-clock observers.
import test from 'node:test';
import assert from 'node:assert/strict';
import { createClient } from '../dist/client.js';
import { createApp } from '../dist/app.js';
import { sessionKey, memorySessionStore } from '../dist/auth.js';
import { ServerClock, sampleChanges } from '../dist/clock.js';
import { reconciledTiming } from '../dist/session-timing.js';
import { createLocalClient } from '../dist/local.js';
import { webDevice, memoryPersistence } from '../dist/web.js';
import { readFileSync } from 'node:fs';
import { modelBackend, modelPage } from './helpers/app-model-device.mjs';
const url='https://staging.invalid', query={kind:'query',name:'history'};
const session=(at,token='ro.reader')=>({principal:'alice',kind:'member',token,scope:'read',expiresAt:at+1000,capExpiresAt:at+1000});
const headers=(now,expiry,revision='host:1')=>({'x-snapback-time':String(now),'x-snapback-clock':revision,'x-snapback-session-timing':'staging',...(expiry?{'x-snapback-session-expires':String(expiry),'x-snapback-session-cap':String(expiry)}:{})});
function fixture(){
  const at=Date.now();let wall=at,shift=0,preserve=true,staging=true;
  const requests=[];
  const clock=new ServerClock(()=>wall);
  const fetcher=clock.wrap(async(input,init)=>{
    const path=new URL(input).pathname;requests.push(path);
    const now=wall+shift,expiry=at+1000+(preserve?shift:0);
    const hs=staging?headers(now,now<expiry?expiry:undefined,`host:${shift}`):{'x-snapback-time':String(now),'x-snapback-clock':`host:${shift}`};
    if(now>=expiry)return Response.json({denied:{code:'E_AUTH',family:'auth',message:'expired'}},{status:401,headers:hs});
    return Response.json(path==='/probe'?{ok:true,viewer:'alice',scope:'read',store_id:'store',seq:0}:{data:[],complete:true,next:null,seq:0,store_id:'store',tables:[]},{headers:hs});
  });
  return {at,clock,fetcher,requests,advance(delta,keep=true){shift+=delta;preserve=keep;},elapsed(delta){wall+=delta;},production(){staging=false;}};
}
test('staging timing is monotonic and ignores malformed, absent and foreign-scope metadata',()=>{
  const original=session(1000);
  const advanced=reconciledTiming(original,new Response('',{headers:headers(3000,4000)}));
  assert.equal(advanced.expiresAt,4000);assert.equal(advanced.capExpiresAt,4000);
  assert.equal(reconciledTiming(advanced,new Response('',{headers:headers(1000,2000)})),advanced);
  for(const hs of [{},{...headers(3000,4000),'x-snapback-session-cap':'bad'},{...headers(3000,4000),'x-snapback-session-timing':'production'}])assert.equal(reconciledTiming(original,new Response('',{headers:hs})),original);
});
test('retained read client reconciles before an advanced clock can end credentials; real elapsed still expires',async t=>{
  const f=fixture();const client=createClient({url,readOnly:true,session:session(f.at),fetch:f.fetcher});t.after(()=>client.close());
  assert.ok('data' in await client.query(query,{}));f.advance(2000);
  assert.ok('data' in await client.query(query,{}));assert.equal(client.session().expiresAt,f.at+3000);
  assert.equal(client.session().capExpiresAt,f.at+3000);assert.equal(client.session().token,'ro.reader');
  assert.ok(!f.requests.includes('/auth/refresh'));
  f.elapsed(1500);const expired=await client.query(query,{});assert.equal(expired.denied.code,'E_AUTH');assert.equal(client.session(),null);
});
for(const production of [false,true])test(`${production?'production':'explicit-expire staging'} supplies no extension`,async t=>{
  const f=fixture();if(production)f.production();const client=createClient({url,readOnly:true,session:session(f.at),fetch:f.fetcher});t.after(()=>client.close());
  assert.ok('data' in await client.query(query,{}));f.advance(2000,false);
  const expired=await client.query(query,{});assert.equal(expired.denied.code,'E_AUTH');assert.equal(client.session(),null);
});
test('one bearer clock cannot expire another client sharing the parent transport',async t=>{
  const f=fixture();const a=createClient({url,readOnly:true,session:session(f.at,'ro.a'),fetch:f.fetcher}),b=createClient({url,readOnly:true,session:session(f.at,'ro.b'),fetch:f.fetcher});t.after(()=>Promise.all([a.close(),b.close()]));
  await Promise.all([a.query(query,{}),b.query(query,{})]);f.advance(2000);
  assert.ok('data' in await a.query(query,{}));assert.equal(b.session().token,'ro.b');
  assert.ok('data' in await b.query(query,{}));assert.equal(b.session().expiresAt,f.at+3000);
});
test('expired restored read metadata needs live staging evidence and persists the reconciled cap',async t=>{
  const f=fixture(),store=memorySessionStore(),original=session(f.at);await store.set(sessionKey(url,true),JSON.stringify(original));f.advance(2000);
  await f.fetcher(url+'/probe?scope=1',{headers:{authorization:'Bearer ro.reader'}});
  const app=createApp({url,readOnly:true,sessionStore:store,fetch:f.fetcher});t.after(()=>app.close());
  assert.equal((await app.ready).ok,true);assert.ok('data' in await app.client.query(query,{}));await app.close();
  const kept=JSON.parse(await store.get(sessionKey(url,true)));assert.equal(kept.expiresAt,f.at+3000);assert.equal(kept.capExpiresAt,f.at+3000);assert.equal(kept.token,original.token);
});
test('unavailable staging timing suppresses header and stream-final clock changes',async()=>{
  let wall=1000;const clock=new ServerClock(()=>wall);const transport=clock.wrap(async()=>new Response('',{headers:{...headers(10000,12000),'x-snapback-session-timing':'unavailable'}}));
  const response=await transport(url);await sampleChanges(response,{serverNow:10000,clockRevision:'host:1'});assert.equal(clock.issuedDeviceNow(),1000);
});

test('heartbeat final timing reconciles the immutable bearer before clock listeners',async()=>{
  const clock=new ServerClock(()=>1000);let selected=session(1000),fail=false;
  clock.beforeSample(async(response,request)=>{
    assert.equal(request.authorization,'Bearer ro.reader');
    const next=reconciledTiming(selected,response);
    if(fail)throw Error('custody unavailable');
    selected=next;
  });
  const response=await clock.wrap(async()=>new Response('\n'))(url+'/changes',{headers:{authorization:'Bearer ro.reader'}});
  const final={serverNow:10000,clockRevision:'host:1',sessionTiming:'staging',sessionExpiresAt:11000,sessionCapExpiresAt:11000};
  fail=true;await assert.rejects(sampleChanges(response,final),/custody unavailable/);assert.equal(clock.issuedDeviceNow(),1000);
  fail=false;let observed;
  clock.subscribe(()=>{observed=selected.expiresAt;});
  await sampleChanges(response,final);assert.equal(observed,11000);assert.equal(clock.issuedDeviceNow(),10000);
  await sampleChanges(response,{...final,serverNow:20000,sessionTiming:'unavailable'});assert.equal(clock.issuedDeviceNow(),10000);
});

test('a late staging response cannot publish an old bearer clock after rotation',async t=>{
  const at=Date.now(),day=86400000,original={principal:'alice',kind:'user',token:'old',expiresAt:at+30*day};let entered,release;
  const started=new Promise(resolve=>entered=resolve),gate=new Promise(resolve=>release=resolve);
  const client=createClient({url,session:original,fetch:async(input,init)=>{
    const path=new URL(input).pathname,token=new Headers(init?.headers).get('authorization');
    if(path==='/auth/refresh')return Response.json({ok:true,session:{...original,token:'new'}});
    if(path.startsWith('/q/')&&token==='Bearer old'){entered();await gate;return Response.json({data:[],complete:true,tables:[],seq:0,store_id:'store'},{headers:{'x-snapback-time':String(at+40*day),'x-snapback-clock':'host:1','x-snapback-session-timing':'staging','x-snapback-session-expires':String(at+70*day)}});}
    return Response.json(path==='/probe'?{ok:true,viewer:'alice',seq:0,store_id:'store'}:{data:[],complete:true,tables:[],seq:0,store_id:'store'});
  }});
  t.after(()=>{release();return client.close();});
  const answer=client.query(query,{});await started;assert.equal((await client.refreshSession()).ok,true);release();await answer;
  assert.equal(client.session().token,'new');assert.ok(client.now()<original.expiresAt,'stale preservation metadata cannot expire the replacement bearer');
});

for(const mode of ['offline','retry','held','close'])test(`local timing persistence: ${mode}`,async t=>{
  const at=Date.now(),day=86400000,original={principal:'alice',kind:'user',token:'full-token',expiresAt:at+3*day};
  const values=new Map(),key=sessionKey(url),persist=memoryPersistence();let shift=0,fail=false,offline=false,core,hold=false,entered,release;
  const saving=new Promise(resolve=>entered=resolve),gate=new Promise(resolve=>release=resolve);t.after(()=>release());
  const sessions={async get(k){return values.get(k)??null;},async set(k,value){if(JSON.parse(value).expiresAt>original.expiresAt){if(hold){entered();await gate;}if(fail)throw Error('session disk unavailable');}values.set(k,value);},async delete(k){values.delete(k);}};
  await sessions.set(key,JSON.stringify(original));
  const raw=webDevice({wasm:readFileSync(new URL('../dist/wasm/snapback4_device_bg.wasm',import.meta.url)),persist});
  const device={async open(...args){core=await raw.open(...args);return core;}};
  const fetcher=async(input,init)=>{
    if(offline)throw Error('offline');const path=new URL(input).pathname;
    if(path==='/changes')return new Promise((_,reject)=>{if(init.signal.aborted)reject(init.signal.reason);else init.signal.addEventListener('abort',()=>reject(init.signal.reason),{once:true});});
    let body;
    if(path==='/schema')body=modelBackend;
    else if(path==='/probe')body={ok:true,viewer:'alice',scope:'full',seq:0,store_id:'session-model-store'};
    else if(path==='/sync')body=modelPage(0,JSON.parse(init.body));
    else if(path.startsWith('/q/'))body={data:{id:'viewer'},complete:true,tables:[],seq:0,store_id:'session-model-store'};
    else throw Error('unexpected '+path);
    if(mode==='close'&&shift>0){entered();await gate;}
    return Response.json(body,{headers:{'x-snapback-time':String(Date.now()+shift),'x-snapback-clock':`host:${shift}`,'x-snapback-session-timing':'staging','x-snapback-session-expires':String(original.expiresAt+shift)}});
  };
  let client=await createLocalClient({url,sessionStore:sessions,device,fetch:fetcher});t.after(()=>client?.close());
  const savedBefore=(await core.call({op:'meta',key:'server-clock'})).ok;
  shift=4*day;hold=mode==='held';fail=mode==='offline'||mode==='retry';
  const syncing=client.sync();if(hold||mode==='close')await saving;else await syncing;
  assert.ok(client.now()<original.expiresAt,'failed custody cannot publish the advanced live clock');
  assert.equal((await core.call({op:'meta',key:'server-clock'})).ok,savedBefore,'device clock saves would succeed but must not receive the advanced image');
  assert.equal(JSON.parse(values.get(key)).expiresAt,original.expiresAt);
  if(mode==='close'){
    const closing=client.close();release();await Promise.all([syncing,closing]);client=undefined;
  }else if(mode!=='offline'){
    fail=false;if(hold){release();await syncing;}else await client.sync();
    assert.ok(client.now()>original.expiresAt);assert.equal(JSON.parse(values.get(key)).expiresAt,original.expiresAt+shift,'dirty timing retries even when the next reply repeats the same expiry');
  }
  await client?.close();client=undefined;offline=true;fail=false;
  client=await createLocalClient({url,sessionStore:sessions,device,fetch:fetcher});
  assert.equal(client.session().token,original.token);assert.ok(values.has(key),'offline restoration must retain saved custody');
  if(mode==='close')assert.ok(client.now()<original.expiresAt,'close cannot persist a late unreconciled clock after removing the timing listener');
});

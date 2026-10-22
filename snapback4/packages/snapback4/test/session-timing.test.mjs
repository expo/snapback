// @ref LLP 3000.000.000.001#11-wave-22-loop-repairs-dx6 — live staging expiry reconciliation precedes business-clock observers.
import test from 'node:test';
import assert from 'node:assert/strict';
import { createClient } from '../dist/client.js';
import { createApp } from '../dist/app.js';
import { sessionKey, memorySessionStore } from '../dist/auth.js';
import { ServerClock, sampleChanges } from '../dist/clock.js';
import { reconciledTiming } from '../dist/session-timing.js';
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
  const response=await transport(url);sampleChanges(response,{serverNow:10000,clockRevision:'host:1'});assert.equal(clock.issuedDeviceNow(),1000);
});

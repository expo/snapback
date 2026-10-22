import test from "node:test";
import assert from "node:assert/strict";
import {setTimeout as sleep} from "node:timers/promises";
import {guest, login, signup} from "../dist/auth.js";
import {seedAccounts} from "../dist/proof.js";
const limited=(retryAfterMs=40)=>({denied:{code:"E_RATE_LIMIT",family:"auth",message:"wait",retryable:true,retryAfterMs}});
const session=()=>({session:{principal:"user:one",kind:"user",token:"bearer",expiresAt:Date.now()+86400000}});
const response=(json,status=200,headers={})=>Response.json(json,{status,headers});

for(const kind of ["guest","signup","login"])test(`${kind} waits for the server delay and preserves scope without sending retry options`,async()=>{
 const bodies=[],times=[];const fetcher=async(_,init)=>{bodies.push(JSON.parse(init.body));times.push(performance.now());return times.length===1?response(limited(),429,{"retry-after":"0.001"}):response(session());};
 const options={scope:"read",timeoutMs:1000,signal:new AbortController().signal};
 const answer=kind==="guest"?await guest("http://example",options,fetcher):await ({signup,login}[kind])("http://example","a@example.test","password",options,fetcher);
 assert.equal(answer.ok,true);assert.equal(times.length,2);assert.ok(times[1]-times[0]>=35);assert.deepEqual(bodies[0],bodies[1]);
 assert.equal(bodies[0].scope,"read");assert.ok(!("timeoutMs" in bodies[0]));assert.ok(!("signal" in bodies[0]));
});
test("header-only identity refusals retry; legacy fetch argument still works",async()=>{
 let calls=0;const fetcher=async()=>++calls===1?response({denied:{code:"E_RATE_LIMIT",family:"auth",message:"wait",retryable:true}},429,{"retry-after":"0.04"}):response(session());
 // Explicit header permits 40 ms rather than a fallback polling interval.
 const start=performance.now();assert.equal((await guest("http://example",{timeoutMs:2000},fetcher)).ok,true);assert.ok(performance.now()-start>=35);
 assert.equal((await guest("http://example",async()=>response(session()))).ok,true);
});
test("identity refusals have bounded attempts and wait budget",async()=>{
 let calls=0;const answer=await login("http://example","a","b",{timeoutMs:1000},async()=>{calls++;return response(limited(0),429);});
 assert.equal(calls,4);assert.equal(answer.why.code,"E_RATE_LIMIT");
 calls=0;const long=await signup("http://example","a","b",{timeoutMs:10},async()=>{calls++;return response(limited(60000),429);});
 assert.equal(calls,1);assert.equal(long.why.retryAfterMs,60000);
});
test("abort cancels an identity wait without a late signup",async()=>{
 let calls=0;const abort=new AbortController();const result=signup("http://example","a","b",{signal:abort.signal,timeoutMs:1000},async()=>{calls++;return response(limited(300),429);});
 abort.abort(new Error("caller cancelled"));assert.equal((await result).why.code,"E_OFFLINE");await sleep(30);assert.equal(calls,1);
});
test("identity does not replay ambiguous, malformed, non-rate or permanent refusals",async()=>{
 for(const send of [async()=>{throw Error("socket reset after send")},async()=>response({session:{token:"incomplete"}}),async()=>response({denied:{code:"E_AUTH",family:"auth",message:"bad credentials"}},401),async()=>response(limited(0),503),async()=>response({...limited(0),denied:{...limited(0).denied,retryable:false}},429),async()=>response(limited(-1),429),async()=>new Response("not JSON",{status:429})]){
  let calls=0;const result=await signup("http://example","a","b",{timeoutMs:100},async()=>{calls++;return send()});assert.equal(result.ok,false);assert.equal(calls,1);
 }
});
test("proof seedAccounts shares identity delay and retries the same account only",async t=>{
 let signups=0,provisions=0;const times=[],bodies=[];
 t.mock.method(globalThis,"fetch",async(url,init)=>{
  if(url.endsWith("/auth/config"))return response({environment:"staging",development:false,password:true});
  if(url.endsWith("/auth/signup")){times.push(performance.now());bodies.push(init.body);return ++signups===1?response(limited(40),429):response(session());}
  provisions++;return response({state:"sent"});
 });
 const accounts=await seedAccounts({url:"http://example",operatorToken:async()=>"operator"},{roles:{member:1},provision:{name:"provision"},timeoutMs:1000});
 assert.equal(accounts.member.length,1);assert.equal(signups,2);assert.equal(provisions,1);assert.equal(bodies[0],bodies[1]);assert.ok(times[1]-times[0]>=35);
});
test("proof seeding respects the remaining setup budget and never retries lost signup replies",async t=>{
 for(const failure of ["delay","network"]){let signups=0,provisions=0;
  const mock=t.mock.method(globalThis,"fetch",async(url)=>{
   if(url.endsWith("/auth/config"))return response({environment:"staging",development:false,password:true});
   if(url.endsWith("/auth/signup")){signups++;if(failure==="network")throw Error("lost signup reply");return response(limited(60000),429);}
   provisions++;return response({state:"sent"});
  });
  await assert.rejects(seedAccounts({url:"http://example",operatorToken:async()=>"operator"},{roles:{member:1},provision:{name:"provision"},timeoutMs:30}),failure==="delay"?/E_STAGING_TIMEOUT/:/lost signup reply/);
  assert.equal(signups,1);assert.equal(provisions,0);mock.mock.restore();
 }
});

test("zero and elapsed date Retry-After headers fit a short identity deadline",async()=>{
 for(const header of ["0","Thu, 01 Jan 1970 00:00:00 GMT"]){let calls=0;
  const signed=await guest("http://example",{timeoutMs:300},async()=>++calls===1?response({denied:{code:"E_RATE_LIMIT",family:"auth",message:"wait"}},429,{"retry-after":header}):response(session()));
  assert.equal(signed.ok,true);assert.equal(calls,2);
 }
});
test("an active signup deadline names partial staging setup and never replays",async t=>{
 let calls=0;t.mock.method(globalThis,"fetch",async(url,init)=>{
  if(url.endsWith("/auth/config"))return response({environment:"staging",development:false,password:true});calls++;
  return new Promise((_,reject)=>{const abort=()=>reject(init.signal.reason);init.signal.addEventListener("abort",abort,{once:true});if(init.signal.aborted)abort();});
 });
 for(let n=0;n<20;n++) await assert.rejects(seedAccounts({url:"http://example",operatorToken:async()=>"operator"},{roles:{member:1},provision:{name:"provision"},timeoutMs:10}),/E_STAGING_TIMEOUT.*partial accounts/);assert.equal(calls,20);
});

test("early timer delivery preserves staging timeout classification with budget remaining",async t=>{
 const original=setTimeout;let early=0,calls=0;
 t.mock.method(globalThis,"setTimeout",(callback,ms,...args)=>{if(ms>=900&&ms<=1000){early++;return original(callback,0,...args);}return original(callback,ms,...args);});
 t.mock.method(globalThis,"fetch",async(url,init)=>{
  if(url.endsWith("/auth/config"))return response({environment:"staging",development:false,password:true});calls++;
  return new Promise((_,reject)=>init.signal.addEventListener("abort",()=>reject(init.signal.reason),{once:true}));
 });
 await assert.rejects(seedAccounts({url:"http://example",operatorToken:async()=>"operator"},{roles:{member:1},provision:{name:"provision"},timeoutMs:1000}),/E_STAGING_TIMEOUT.*partial accounts/);
 assert.equal(early,1);assert.equal(calls,1);
});

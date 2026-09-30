import test from 'node:test';
import assert from 'node:assert/strict';
import {join} from 'node:path';
import {fixture,source,open,opener,q,until,parked,sdk} from './helpers/answers-stay.mjs';
const {guardClient}=await import(new URL('app-client.js',sdk));
for(const tier of ['wasm','process'])for(const boundary of ['response','approval'])test(`${tier}: terminal partition refusal retires in-flight first answer at ${boundary}`,async t=>{
 const program=source.replace("table profiles:\n  name: text\n  read <- allow", "table profiles:\n  name: text\n  read <- .name = 'Bob'\n  update <- allow")+`\nmutation revokeProfile():\n  update profiles['bob'] {name: 'revoked'}\n`;
 const f=await fixture(t,program),base=opener(tier,join(f.dir,'device'));
 const responseGate=Promise.withResolvers(),applyGate=Promise.withResolvers();let once=true,held=false,refuse=false,holdApply=false,applyHeld=false;
 t.after(()=>{responseGate.resolve();applyGate.resolve()});
 const client=await open(t,f,tier,{fetch:async(input,init)=>{
  const path=new URL(input).pathname;if(path==='/changes')return parked(init.signal);
  if(path==='/sync'&&refuse)return Response.json({denied:{code:'E_TEST_PARTITION',family:'rule',message:'refused'}});
  const response=await fetch(input,init);if(boundary==='response'&&path==='/q/profile'&&once){once=false;held=true;await responseGate.promise}return response;
 },device:{async open(...args){const core=await base.open(...args);return {...core,async call(req,commit){
   if(req.op==='apply'&&holdApply){holdApply=false;applyHeld=true;await applyGate.promise}
   return core.call(req,commit);
 }}}}});
 let checks=0; const facade=guardClient(client,async()=>{if(boundary==='approval'&&++checks===2){held=true;await responseGate.promise}return true},()=>true,()=>({code:'E_AUTH',family:'auth',message:'ended'}));t.after(()=>facade.fence()());
 const result=(boundary==='approval'?facade.client:client).query(q('profile'),{});await until(()=>held);
 const revoke=await f.post('/m/revokeProfile',{id:'revoke',args:{}});assert.equal(revoke.state,'sent');
 refuse=true;await client.sync();assert.equal((await client.query(q('profile'),{})).denied?.code,'E_TEST_PARTITION');
 refuse=false;holdApply=true;const syncing=client.sync();await until(()=>applyHeld);
 responseGate.resolve();const stale=await result;
 t.diagnostic(JSON.stringify({stale,authoritative:await f.post('/q/profile',{args:{}},'bob')}));
 applyGate.resolve();await syncing;
 assert.notEqual(stale.data?.name,'Bob','terminal refusal must permanently fence earlier responses even after the refusal is cleared');
});

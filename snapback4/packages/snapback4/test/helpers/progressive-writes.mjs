import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createApp } from '../../dist/app.js';
import { memorySessionStore, sessionKey } from '../../dist/auth.js';
import { webDevice, memoryPersistence } from '../../dist/web.js';
import { storeKey } from '../../dist/app-storage.js';
import { createLocalClient } from '../../dist/local.js';
import { prepareClient } from '../../dist/client-start.js';
import { progressiveWriteCustody, prepareProgressiveWrites } from '../../dist/progressive-writes.js';
const wasm = new WebAssembly.Module(readFileSync(new URL('../../src/wasm/snapback4_device_bg.wasm', import.meta.url)));
const gate = () => Promise.withResolvers();
const tick = () => new Promise(resolve => setTimeout(resolve, 5));
async function until(fn) { for (let n=0;n<1000;n++) { if(await fn()) return; await tick(); } assert.fail('condition did not arrive'); }
const mutation = {kind:'mutation',name:'write'}, query = {kind:'query',name:'read'};
const schema = {generation:1,store_id:'A',schema:{tables:{}},programs:[
  {name:'read',kind:'Query',args:{},body:[{Return:{Literal:{String:'local'}}}],settlement:{reads:{items:null},writes:{}}},
  {name:'write',kind:'Mutation',args:{},body:[{Return:{Literal:{String:'written'}}}],settlement:{reads:{},writes:{items:null}}},
  {name:'other',kind:'Query',args:{},body:[{Return:{Literal:{String:'other'}}}],settlement:{reads:{other:null},writes:{}}},
  {name:'constant',kind:'Query',args:{},body:[{Return:{Literal:{String:'constant'}}}],settlement:{reads:{},writes:{}}},
]};
async function fixture(t, {hold=true, drop=false, custody='none', store=memorySessionStore(), persist=memoryPersistence(), raw=false,
  backend=schema, mutationRefusal, failure, badEngine=false, wrapCore=core=>core, queryReply, receiptReply, refreshReply, syncHead, syncGeneration, syncWait, authority, report=console.error, onStoreChange, basePath='', startup='progressive', persona=false, journal=false}={}) {
  const url=(persona?'http://127.0.0.1:4400':'https://progressive-writes.invalid')+basePath, release=gate(), posted=gate(), coreGate=gate();
  let head=20, requests=[], actions=[], executions=new Map(), reads=0, failStore, coreOpens=0, offline=false, revokes=0, failSync, storeId='A',changes=[];
  await store.set(sessionKey(url),JSON.stringify({token:'token',principal:'alice',kind:'user',expiresAt:Date.now()+7*86400000}));
  if(raw)coreGate.resolve();
  const inner=webDevice({wasm,persist});
  const device={custody:async()=>custody,async open(...args){coreOpens++;await coreGate.promise;if(failure)throw failure;const core=await inner.open(...args);
    return wrapCore({...core,call:(request,...rest)=>badEngine&&request.op==='engine_info'?Promise.resolve({ok:{format:0}}):core.call(request,...rest)});}};
  const fetch=async(input,init)=>{
    const path=new URL(input).pathname.slice(basePath.length);
    if(offline)throw new TypeError('offline witness');
    if(path==='/schema')return Response.json({...backend,store_id:storeId});
    if(path==='/probe')return Response.json({ok:true,viewer:'alice',scope:'full',store_id:storeId,seq:head,generation:backend.generation});
    if(path==='/sync'){await syncWait?.promise;if(failSync)return Response.json({denied:failSync},{status:409});return Response.json({generation:syncGeneration??backend.generation,store_id:storeId,snapshot:!JSON.parse(init.body).stream,watermark:syncHead??head,images_at:syncHead??head,events:[],committed_above:{},more:false});}
    if(path==='/changes')return new Promise((resolve,reject)=>{changes.push(body=>resolve(Response.json(body)));if(init.signal.aborted)reject(init.signal.reason);else init.signal.addEventListener('abort',()=>reject(init.signal.reason),{once:true});});
    if(path==='/auth/login')return Response.json({ok:true,session:{token:'bob-token',principal:'bob',kind:'user',expiresAt:Date.now()+7*86400000}});
    if(path==='/auth/refresh'&&refreshReply)return refreshReply();
    if(path.startsWith('/auth/')){revokes++;return Response.json({ok:true,revoked:1});}
    if(path.startsWith('/a/')){const {id}=JSON.parse(init.body);actions.push(id);return Response.json({id,state:'done',result:'acted'});}
    if(path.startsWith('/m/')){
      const body=JSON.parse(init.body);requests.push(body.id);
      if(body.store_id&&body.store_id!==storeId)return Response.json({state:'failed',id:body.id,why:{code:'E_STORE_REPLACED',family:'store',message:'request belongs to another store'},store_id:storeId,generation:backend.generation},{status:409});
      if(failStore)return Response.json({denied:failStore},{status:409});
      if(mutationRefusal){posted.resolve();if(hold)await release.promise;return Response.json({state:'failed',id:body.id,why:mutationRefusal,store_id:storeId,generation:backend.generation},{status:400});}
      const replayed=executions.has(body.id);
      if(!replayed)executions.set(body.id,++head);
      posted.resolve(); if(drop){drop=false;throw Error('response lost after commit');}
      if(hold)await release.promise;
      const receipt={state:'sent',seq:executions.get(body.id),head,store_id:storeId,generation:1,replayed};
      return Response.json(await receiptReply?.(receipt)??receipt);
    }
    reads++;return Response.json(await queryReply?.(path,head)??{data:'server',complete:true,tables:path.endsWith('/constant')?[]:path.endsWith('/other')?['other']:['items'],seq:head,store_id:storeId,generation:1});
  };
  let local;
  const options={url,sessionStore:store,onStoreChange,...(startup?{startup}:{}),...(persona?{persona:"alice"}:{}),device:{...device,async open(...args){const core=await device.open(...args);return {...core,onClient(client){local=client;}};}},fetch};
  let app;
  if(raw){if(startup!=='awaited'||journal)prepareProgressiveWrites(options,{store,report,authority});const prepared=await prepareClient(options,()=>createLocalClient(options));local=prepared.client;app={client:local,mutate:(...args)=>local.mutate(...args),close:()=>local.close(),ready:Promise.resolve({ok:true})};progressiveWriteCustody(local)?.start();await prepared.start();}
  else app=createApp(options);
  t.after(async()=>{release.resolve();coreGate.resolve();syncWait?.resolve();await app.close();});
  return {app,store,url,requests,actions,executions,posted,release,coreGate,reads:()=>reads,coreOpens:()=>coreOpens,local:()=>local,
    device:options.device, reopen:async(overrides)=>{await app.close();app=createApp({...options,...overrides});return app;},
    journal:async()=>JSON.parse(await store.get(storeKey('writes',url,persona?'dev:alice':'alice'))??'null'), change:body=>{const next=changes.shift();next?.(body);return !!next;}, fail:why=>{failStore=why;}, failSync:why=>{failSync=why;}, replace:id=>{storeId=id;head=0;}, head:value=>{head=value;}, offline:value=>{offline=value;}, revokes:()=>revokes};
}

export { fixture, wasm, gate, tick, until, mutation, query, schema };

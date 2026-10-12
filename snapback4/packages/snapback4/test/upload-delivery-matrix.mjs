// Fault every new await against the real device, including nested upload transport.
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';
import { fixture, original, until } from './delivery-fault-fixture.mjs';
import { memoryPersistence } from '../dist/web.js';
const wasm = readFileSync(new URL('../dist/wasm/snapback4_device_bg.wasm',import.meta.url));
const backend = structuredClone(original);
backend.programs.find(p=>p.name==='send').args.photo = {Optional:{Image:{max:100000}}};
const op={kind:'mutation',name:'send'},args={conversationId:'c1',body:'media'};
const bytes=new Blob([new Uint8Array([137,80,78,71])]);
const asset={id:'asset1',type:'image/png',bytes:4,width:1,height:1,duration:null};
const options={id:'media1',argument:'photo'};
export async function mediaFaultCase({t,site,mode,directory,createLocalClient,webDevice,arm,release,fault,injected}) {
  if(site.file==='local.ts') {
    const f=await fixture(t,1,{createLocalClient,webDevice,fetch(path) {
      if(path==='/schema') return Response.json(backend);
      if(path==='/assets') return Response.json({asset});
      if(path.endsWith('/declare'))return Response.json({ok:true});
      if(path.endsWith('/finish')) return Response.json({state:'failed',why:{code:'E_INPUT',family:'input',message:'early failure'}});
      if(path.startsWith('/assets/intent/')) return Response.json({ok:true});
      if(site.expression.includes('uploads.finish') && path.startsWith('/m/')) return Response.json({state:'failed',why:{code:'E_INPUT',family:'input',message:'early failure'}});
    }});
    const api=globalThis.__rgClient;
    f.offline(true);
    assert.equal((await f.client.uploadAndPlace(op,args,bytes,options)).state,'queued');
    await api.flush();
    if(site.expression.includes('settleReceipt')) await f.client.discardUpload('media1');
    f.offline(false);
    arm(); await api.flushOnce(false); release();
    assert.equal(f.sends.length,0,'upload dependency or cancellation persistence failure cannot dispatch placement');
    const held = (await f.core.call({op:'queued'})).ok.some(e=>e.id==='media1');
    assert.ok(held || (mode==='transient' && (await f.client.write('media1'))?.state==='failed'), 'fault keeps custody or a later acknowledged cancellation receipt');
    await api.flushOnce(false);
    const write=await f.client.write('media1');
    assert.equal(write.state,site.expression.includes('settleReceipt') || site.expression.includes('uploads.finish')?'failed':'sent');
    assert.equal(f.sends.length,site.expression.includes('settleReceipt') || site.expression.includes('uploads.finish')?0:1);
    return;
  }
  const {DeviceUploads}=await import(pathToFileURL(join(directory,'dist/uploads.js')));
  const persist=memoryPersistence();
  let core=await webDevice({wasm,persist}).open('media-matrix',backend);
  t.after(()=>core.close());
  await persist.save('media-matrix:receipts',[{s:'m',k:'client:write-history',v:JSON.stringify([{id:site.file==='web-upload-admission.ts'&&site.expression.includes('invoke(')?'media1':'other',state:'failed',why:{code:'E_RULE',family:'rule',message:'other'},upload_identity:{fingerprint:'other',op:'send',viewer:'dev:alice',store_id:'A'}}])}]);
  const ownership=Symbol.for('snapback4.admissionOwnership');
  // The exported capability uses a global Symbol; obtain the exact module symbol for hosts that use a local one.
  const {admissionOwnership}=await import(pathToFileURL(join(directory,'dist/admission-authority.js')));
  if(!(site.owner==='preflightUpload'&&site.expression==='check()'))core[admissionOwnership]?.({capture:()=>({kind:'persona',key:'matrix-authority',epoch:'0',principal:'dev:alice',source:'persona:matrix'}),read:undefined,recheck(){}});
  const reply=await core.call({op:'apply',first:true,page:{snapshot:true,store_id:'A',generation:1,events:[],watermark:0,more:false}});
  assert.ok(!reply.denied,JSON.stringify(reply));
  const queue=async()=> (await core.call({op:'queued'})).ok;
  let attempts=0,accepted=0,mismatch=false;
  const env={base:'http://media.invalid',viewer:'dev:alice',current:()=>true,unavailable:()=>null,
    storeId:()=> 'A',capture:async()=> mismatch ? {store_id:'B'} : (await core.call({op:'sync_state',capture:false})).ok,
    credentials:()=>({headers:{},revision:1}),
    entry:(id,name,args)=>({id,seq:1,op:name,args,viewer:'dev:alice',now:1,predictable:false,new_ids:[],predicted:[]}),
    call:r=>core.call(r),queued:queue,write:async id=> (await queue()).some(e=>e.id===id)?{state:'pending',id}:undefined,
    notify(){},flush(){},subscribe(){return ()=>{};},
    fetch:async(input)=> {
      if(new URL(input).pathname.endsWith("/declare"))return Response.json({ok:true});
      attempts++;
      if(site.expression.includes('new Promise')) { if(attempts===1) return Response.json({denied:{code:'E_RATE_LIMIT',family:'limit',message:'busy',retryable:true}},{status:503}); fault(); }
      if(site.expression.includes('why: result.why')) return Response.json({denied:{code:'E_ASSET_TYPE',family:'asset',message:'wrong bytes'}});
      if(site.expression.includes('why:error')){
        const changed=structuredClone(backend);delete changed.programs.find(p=>p.name==='send').args.photo;
        const revision=(await core.call({op:'sync_state',capture:false})).ok.send_revision;
        assert.ok(!(await core.call({op:'adopt',backend:changed,store_id:'A',send_revision:revision})).denied);
      }
      if(accepted===0) accepted++;
      return Response.json({asset});
    }};
  let uploads=new DeviceUploads(env);
  const admissionSite=site.owner==='uploadAndPlace'||site.owner==='change'||site.file==='web-upload-admission.ts';
  if(!admissionSite) {
    assert.equal((await uploads.uploadAndPlace(op,args,bytes,options)).state,'queued');
    if(site.owner === 'request' || (site.owner === 'prepare' && site.expression.includes('this.request(') && site.expression.includes('/cancel?'))) {
      await core.call({op:'upload_state',id:'media1',viewer:'dev:alice',state:'cancelling'});
      env.fetch=async()=>Response.json({ok:true});
    }
  }
  if(site.expression.includes('E_STORE_REPLACED')) mismatch=true;
  if(site.expression.includes('state:"cancelling",why:')){await core.call({op:'upload_state',id:'media1',viewer:'dev:alice',state:'cancelling'});env.fetch=async()=>Response.json({denied:{code:'E_OFFLINE',family:'transport',message:'offline',retryable:true}},{status:503});}
  if(site.expression.includes('declaration.json.denied'))env.fetch=async()=>Response.json({denied:{code:'E_ASSET_INTENT_REUSE',family:'asset',message:'declaration changed'}});
  if(site.owner==='finish') { await uploads.prepare((await queue())[0]); env.fetch=async()=>Response.json({state:'failed',why:{code:'E_INPUT',family:'input',message:'early failure'}}); }
  let subject=uploads;
  if(site.file==='app-uploads.ts') {
    const {guardUploads}=await import(pathToFileURL(join(directory,'dist/app-uploads.js')));
    subject={};guardUploads(subject,uploads,async()=>undefined,()=>true,()=>({code:'E_SESSION',family:'auth',message:'retired'}),()=>()=>{});
  }
  if(site.owner==='serverUploads')env.fetch=async()=>Response.json({intents:[],next:null,store_id:'A'});
  if(site.owner==='cancelServerUpload')env.fetch=async()=>Response.json({ok:true});
  const perform=()=> {
    switch(site.owner) {
      case 'check':case 'preflightUpload':case 'authorizeUpload':case 'recoverUploadHistory':case 'uploadAndPlace':case 'change':return subject.uploadAndPlace(op,args,bytes,options);
      case 'uploads':return subject.uploads();
      case 'uploadIntent':return subject.uploadIntent('media1');
      case 'retryUpload':return subject.retryUpload('media1');
      case 'discardUpload':return subject.discardUpload('media1');
      case 'serverUploads':return subject.serverUploads();
      case 'cancelServerUpload':return subject.cancelServerUpload('media1');
      case 'request':if(site.expression==='work')return subject.cancelServerUpload('media1');return queue().then(entries=>uploads.prepare(entries[0]));
      case 'finish':return queue().then(entries=>uploads.finish(entries[0],{code:'E_INPUT',family:'input',message:'early failure'}));
      default:return queue().then(entries=>uploads.prepare(entries[0]));
    }
  };
  arm();try { await perform(); } catch { /* required boundary refuses; custody assertions follow */ } release();
  assert.ok(injected()>0,'fault occurred before claiming recovery');
  const saved=await queue();
  if(admissionSite) {
    assert.equal(saved.length,0,'failed precommit admission retains no executable intent');
    assert.equal(attempts,0,'admission failure never uploads');
    await persist.save('media-matrix:receipts',[{s:'m',k:'client:write-history',v:'[]'}]);
    assert.equal((await uploads.uploadAndPlace(op,args,bytes,options)).state,'queued');
  } else {
    assert.equal(saved.length,1,'failed delivery/state observation retains executable custody');
    assert.equal(saved[0].upload.bytes,site.owner==='finish'?null:'89504e47','byte custody survives until readiness commits');
  }
  mismatch=false;
  // Reload the real persistence image; caller Blob and instance are no longer owners.
  await core.close();core=await webDevice({wasm,persist}).open('media-matrix',null);core[admissionOwnership]?.({capture:()=>({kind:'persona',key:'matrix-authority',epoch:'0',principal:'dev:alice',source:'persona:matrix'}),read:undefined,recheck(){}});uploads=new DeviceUploads(env);
  const recovered=(await queue())[0]; assert.equal(recovered.id,'media1');
  if(recovered.upload.state==='cancelling') {
    env.fetch=async()=>Response.json({ok:true});
    assert.equal((await uploads.prepare(recovered)).cancelled,true);
  } else {
    env.fetch=async input=>{if(new URL(input).pathname.endsWith('/declare'))return Response.json({ok:true});if(!accepted)accepted++;return Response.json({asset});};
    if(site.expression.includes('why:error')){
      const revision=(await core.call({op:'sync_state',capture:false})).ok.send_revision;
      await core.call({op:'adopt',backend,store_id:'A',send_revision:revision});
    }
    await uploads.retryUpload('media1');
    const ready=await uploads.prepare((await queue())[0]);
    assert.equal(ready.entry.args.photo.id,'asset1');
    assert.equal(ready.entry.upload.bytes,null);
    assert.ok(!(await core.call({op:'begin_send',id:'media1'})).denied);
  }
  assert.ok(accepted<=1,'lost attempts never create a second asset identity');
}

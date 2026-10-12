// Real IndexedDB and Web Locks: reload, orphan adoption, exit and cancellation.
import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { launch, root } from '../../../witness/lib.mjs';
import { until } from './helpers/app-server.mjs';
import { hangBudget } from './helpers/wait.mjs';
const source = `use personas alice, bob
 table docs:
  owner: principal
  doc: file <=100000 ('application/pdf') ?
  read <- .owner = viewer
  insert <- .owner = viewer
  sync to .owner
mutation attach(doc: file <=100000):
  return insert docs { owner: viewer, doc }
query mine():
  docs where .owner = viewer first 100 by .id
`.replace(' table docs:', 'table docs:');

for(const worker of [false,true])test(`Chromium (worker=${worker}): offline byte custody transfers to a new tab after reload and places once; IDB abort and pagehide stay fenced`, { timeout: hangBudget(180) }, async t => {
  const project = mkdtempSync(join(tmpdir(), 'sb4-media-browser-')); t.after(() => rmSync(project,{recursive:true,force:true}));
  const sourceDir = join(project,'snapback'); mkdirSync(sourceDir); writeFileSync(join(sourceDir,'schema.q'),source);
  const runtime=join(root,'packages/snapback4/src/web-worker-runtime.ts');
  const workerFault=`
const put=IDBObjectStore.prototype.put;IDBObjectStore.prototype.put=function(value,key){if(JSON.stringify(value).includes('idb-abort'))this.transaction.abort();return put.call(this,value,key);};
`;
  const witness = await launch({sourceDir,seed:[],sourceOverrides:worker?{[runtime]:readFileSync(runtime,'utf8')+workerFault}:{},entrySource:`
window.bootMedia = async (url, offline = false) => {
  window.offlineMedia = offline; window.uploadCalls = []; window.placementCalls = [];
  window.media = await window.createLocalClient({url, persona:'alice', device:window.webDevice({worker:${worker}}), fetch:async(input,init)=>{
    const path = new URL(input).pathname;
    if(window.offlineMedia) throw Error('offline');
    if(path === '/assets') window.uploadCalls.push(String(input));
    if(path.startsWith('/m/')) window.placementCalls.push(JSON.parse(init.body));
    return fetch(input,init);
  }});
  return media.uploads();
};
window.captureMedia = async id => media.uploadAndPlace({kind:'mutation',name:'attach'},{},new File(['%PDF-1.7\\n'],'a.pdf',{type:'application/pdf'}),{id,argument:'doc',file:{}});
window.refuseMediaPersistence = () => {
  const original = IDBDatabase.prototype.transaction;
  IDBDatabase.prototype.transaction = function(...args) { const tx = original.apply(this,args); if(args[1] === 'readwrite') queueMicrotask(()=>{ try {tx.abort();} catch {} }); return tx; };
  return () => { IDBDatabase.prototype.transaction = original; };
};
`}); t.after(()=>witness.close());
  const {page,api:url}=witness;
  const errors=[];page.on('pageerror',e=>errors.push(e.message));
  await page.evaluate(url=>bootMedia(url),url);
  await page.evaluate(()=>{offlineMedia=true;});
  const captured=await page.evaluate(()=>captureMedia('browser-upload1'));assert.equal(captured.state,'queued');
  await page.evaluate(()=>window.dispatchEvent(new Event('pagehide')));
  assert.equal(await page.evaluate(()=>placementCalls.length),0,'exit cannot send an unresolved upload');
  await witness.reload();
  const recovered=await page.evaluate(url=>bootMedia(url,true),url);
  assert.equal(recovered[0].id,'browser-upload1');assert.ok(['queued','blocked','uploading'].includes(recovered[0].state));
  await page.evaluate(async()=>{offlineMedia=false;await media.sync();});
  await until(()=>page.evaluate(async()=>(await media.uploadIntent('browser-upload1'))?.state==='sent'),'browser placement');
  assert.equal(await page.evaluate(()=>placementCalls.length),1);assert.equal(await page.evaluate(()=>uploadCalls.length),1);
  const docs=await page.evaluate(()=>media.query({kind:'query',name:'mine'},{}));assert.equal(docs.data.length,1);
  await page.evaluate(async()=>{await media.close();});await witness.reload();
  await page.evaluate(url=>bootMedia(url),url);await page.evaluate(()=>{offlineMedia=true;});
  const failed=await page.evaluate(async()=>{const allow=refuseMediaPersistence();try{return await captureMedia('idb-abort');}finally{allow();}});
  assert.equal(failed.state,'failed');await page.evaluate(()=>media.close());await witness.reload();
  const intact=await page.evaluate(url=>bootMedia(url,true),url);assert.equal(intact.some(s=>s.id==='idb-abort'),false,'failed IDB commit admits no byte intent');
  const cancellable=await page.evaluate(()=>captureMedia('cancel-upload'));assert.equal(cancellable.state,'queued');
  assert.equal((await page.evaluate(()=>media.discardUpload('cancel-upload'))).state,'cancelling');
  await witness.reload();const cancelledQueue=await page.evaluate(url=>bootMedia(url,true),url);assert.equal(cancelledQueue[0].state,'cancelling');
  await page.evaluate(async()=>{offlineMedia=false;await media.sync();});
  await until(()=>page.evaluate(async()=>(await media.uploadIntent('cancel-upload'))?.state==='failed'),'acknowledged cancellation');
  assert.equal(await page.evaluate(()=>placementCalls.length),0);assert.equal(await page.evaluate(()=>uploadCalls.length),0);
  assert.deepEqual(errors,[]);
});

for(const worker of [false,true])test(`Chromium (worker=${worker}): shared receipts cannot bypass live input or lose entering ownership across orphan histories`,{timeout:hangBudget(180)},async t=>{
  const project=mkdtempSync(join(tmpdir(),'sb4-media-adoption-'));t.after(()=>rmSync(project,{recursive:true,force:true}));
  const sourceDir=join(project,'snapback');mkdirSync(sourceDir);writeFileSync(join(sourceDir,'schema.q'),source);
  const witness=await launch({sourceDir,seed:[],entrySource:`
window.proveMediaRecovery=async backend=>{
 const persist=indexedDbPersistence(),opener=${worker}?webDevice({worker:true}):webDevice({persist});
 const make=bytes=>({id:'collision',seq:1,op:'attach',args:{},viewer:'dev:alice',now:1,upload:{bytes,argument:'doc',file:{name:'a.pdf',type:'application/pdf'},store_id:'A'}});
 const bind=core=>core.call({op:'apply',first:true,page:{snapshot:true,store_id:'A',generation:1,events:[],watermark:0,more:false}});
 const name='shared-live-browser';const first=await opener.open(name,backend),second=await opener.open(name,backend);
 await bind(first);await bind(second);await first.call({op:'admit_upload',entry:make('ee')});await second.call({op:'admit_upload',entry:make('ff')});
 const original=(await second.call({op:'queued'})).ok[0];
 await second.call({op:'enqueue',entry:{id:'held-tail',seq:2,op:'attach',args:{},viewer:'dev:alice',now:1}});
 await first.close();await second.close();
 await persist.save(name+':receipts',[{s:'m',k:'client:write-history',v:JSON.stringify([{id:'collision',state:'sent',seq:1,replayed:true,upload_identity:{fingerprint:original.upload.fingerprint,op:'attach',viewer:'dev:alice',store_id:'A'}}])}]);
 const dest=await opener.open(name,null);const queue=(await dest.call({op:'queued'})).ok;await dest.close();
 const stores=await persist.others(name+':tab-');const copies=[];for(const store of stores)copies.push((await persist.load(store)).filter(c=>c.s==='o'&&c.v).map(c=>JSON.parse(c.v)));
 const name2='entering-browser';const devices=[];for(let i=0;i<3;i++){const d=await opener.open(name2,backend);await bind(d);devices.push(d);}
 await devices[1].call({op:'set_meta',key:'write-history',value:JSON.stringify(Array.from({length:256},(_,n)=>({id:'evict'+n,state:'sent',seq:1,replayed:true})))});
 const protectedEntry=make('ff');protectedEntry.id='protected';await devices[2].call({op:'admit_upload',entry:protectedEntry});
 for(const d of devices)await d.close();
 await persist.save(name2+':receipts',[{s:'m',k:'client:write-history',v:JSON.stringify([{id:'protected',state:'sent',seq:1,replayed:true}])}]);
 const dest2=await opener.open(name2,null);const next=(await dest2.call({op:'queued'})).ok;await dest2.close();
 const retained=[];for(const store of await persist.others(name2+':tab-'))retained.push(...(await persist.load(store)).filter(c=>c.s==='o'&&c.v).map(c=>JSON.parse(c.v)));
 return {queue,copies,next,retained};
};
`});t.after(()=>witness.close());
  const backend=await fetch(witness.api+'/schema',{headers:{'x-snapback-persona':'alice'}}).then(r=>r.json());
  const result=await witness.page.evaluate(backend=>proveMediaRecovery(backend),backend);
  assert.equal(result.queue.find(e=>e.id==='collision').upload.bytes,'ee');assert.equal(result.queue.some(e=>e.id==='held-tail'),false);
  assert.ok(result.copies.some(items=>items.some(e=>e.upload?.bytes==='ff')&&items.some(e=>e.id==='held-tail')));
  assert.equal(result.next.some(e=>e.id==='protected'),false);assert.equal(result.retained.find(e=>e.id==='protected').upload.bytes,'ff');
});

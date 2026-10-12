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

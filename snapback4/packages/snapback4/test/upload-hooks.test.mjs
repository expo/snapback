import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtempSync,mkdirSync,writeFileSync,rmSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {createRequire} from 'node:module';
import {launch,root} from '../../../witness/lib.mjs';
import {until} from './helpers/app-server.mjs';
import {hangBudget} from './helpers/wait.mjs';
test('AppProvider useUpload captures offline, resumes a kept id, and fences the retired public facade',{timeout:hangBudget(120)},async t=>{
  const project=mkdtempSync(join(tmpdir(),'sb4-upload-hook-'));t.after(()=>rmSync(project,{recursive:true,force:true}));mkdirSync(join(project,'snapback'));
  writeFileSync(join(project,'snapback/schema.q'),`use personas alice
 table docs:
  owner: principal
  doc: file <=100000 ?
  read <- .owner = viewer
  insert <- .owner = viewer
  sync to .owner
mutation attach(doc: file <=100000):
  return insert docs {owner: viewer,doc}
`.replace(' table docs:','table docs:'));
  const req=createRequire(join(root,'packages/snapback4/package.json'));
  const witness=await launch({sourceDir:join(project,'snapback'),seed:[],entrySource:`
import {createElement as h,StrictMode} from '${req.resolve('react')}';
import {createRoot} from '${req.resolve('react-dom/client')}';
import {AppProvider,SnapbackProvider,useUpload} from '${join(root,'packages/snapback4/src/react.tsx')}';
window.bootHook=async(url,offline=false,id=undefined)=>{
 window.offlineMode=offline;
 window.app=window.createApp({url,persona:'alice',device:window.webDevice(),fetch:(input,init)=>window.offlineMode?Promise.reject(Error('offline')):fetch(input,init)});
 await app.ready; window.oldClient=app.client;
 function Capture(){window.uploadHook=useUpload({kind:'mutation',name:'attach'},'doc',id);return h('span',null,uploadHook.state?.state??'empty');}
 const main=document.createElement('main');document.body.append(main);window.reactRoot=createRoot(main);
 reactRoot.render(h(StrictMode,null,h(AppProvider,{app},h(Capture))));
};
window.unsupportedHook=()=>{
 function Capture(){window.uploadHook=useUpload({kind:'mutation',name:'attach'},'doc');return h('span',null,String(uploadHook.available));}
 reactRoot.render(h(SnapbackProvider,{client:{onUploads:()=>()=>{}}},h(Capture)));
};
`});t.after(()=>witness.close());const {page,api}=witness;
  await page.evaluate(api=>bootHook(api),api);await until(()=>page.evaluate(()=>uploadHook?.available),'upload capability');
  await page.evaluate(()=>{offlineMode=true;});
  const capture=await page.evaluate(()=>uploadHook.uploadAndPlace({},new File(['%PDF-1.7\n'],'a.pdf',{type:'application/pdf'}),{file:{},id:'hook1'}));assert.equal(capture.id,'hook1');
  await until(()=>page.evaluate(()=>uploadHook?.id==='hook1'),'captured card');
  await page.evaluate(()=>reactRoot.unmount());await witness.reload();
  await page.evaluate(api=>bootHook(api,true,'hook1'),api);await until(()=>page.evaluate(()=>!!uploadHook?.state),'resumed upload');
  assert.equal(await page.evaluate(()=>uploadHook.state.id),'hook1');
  await page.evaluate(async()=>{offlineMode=false;await app.client.sync();});
  await until(()=>page.evaluate(()=>uploadHook?.state?.state==='sent'),'placed card');
  await page.evaluate(async()=>{reactRoot.unmount();await app.close();});
  const stale=await page.evaluate(()=>oldClient.uploadAndPlace({kind:'mutation',name:'attach'},{},new Uint8Array([1]),{argument:'doc',id:'retired'}));assert.equal(stale.state,'failed');
  assert.equal(await page.evaluate(()=>oldClient.uploads().then(v=>v.length)),0);
});

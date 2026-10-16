// @ref LLP 3000.013#6.10 — exercise the published role/release screen and account boundary in Chromium.
import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtempSync, readFileSync, writeFileSync, rmSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join, resolve} from 'node:path';
import {createRequire} from 'node:module';
import {createBrowserServer, loadBrowserPage} from './helpers/browser-server.mjs';
import {chromiumExecutable} from '../../../witness/lib.mjs';
const root=resolve(import.meta.dirname,'../../..');
const require=createRequire(join(root,'package.json'));
const doc=readFileSync(join(root,'crates/snapback4-lang/src/guide/client.md'),'utf8');
const workspace=[...doc.matchAll(/```tsx\n([\s\S]*?)\n```/g)].map(m=>m[1]).find(s=>s.includes('export function StaffWorkspace'));
test('published role/release form preserves drafts and selection; revocation gates reads and writes; accounts reset state', {timeout:120000}, async t=>{
 const dir=mkdtempSync(join(tmpdir(),'kit2-client-'));let server,browser;
 t.after(async()=>{try{await browser?.close();}finally{try{await server?.close();}finally{rmSync(dir,{recursive:true,force:true});}}});
 writeFileSync(join(dir,'index.html'),'<div id="root"></div><script type="module" src="/harness.tsx"></script>');
 writeFileSync(join(dir,'workspace.tsx'),workspace.replace('import { api } from "../snapback/generated/api";','import {api} from "./api";'));
 writeFileSync(join(dir,'api.ts'),`import {operationAvailable} from 'snapback4/contract';
const op=(kind,name)=>({kind,name,available:release=>operationAvailable(release,name,kind,{})});
export const api={myRole:op('query','myRole'),staffNotes:op('query','staffNotes'),addStaffNote:op('mutation','addStaffNote')};`);
 writeFileSync(join(dir,'harness.tsx'),`
import React,{act,useState} from 'react';import {createRoot} from 'react-dom/client';
import {AppProvider,useAppReady} from 'snapback4/react';import {StaffWorkspace} from './workspace';
window.IS_REACT_ACT_ENVIRONMENT=true;
let auth={state:'signed-in',viewer:'dev:alice'},role={data:{role:'staff'},existence:'present',fresh:true,complete:true,cut:null};
let release={loading:true},openReady;const ready=new Promise(r=>openReady=r),authListeners=new Set(),releaseListeners=new Set(),records=new Set();
const notes={data:[{id:'one',title:'Protected note'}],existence:'present',fresh:true,complete:true,cut:null};
let writes=0;
const client={release:{getSnapshot:()=>release,subscribe(fn){releaseListeners.add(fn);return()=>releaseListeners.delete(fn)}},
 onWrite:()=>()=>{},viewer:()=>auth.viewer,now:()=>Date.now(),
 mutate:async()=>{writes++;return{state:'sent',id:'write',result:{id:'new'},seq:1}},
 observe(op){if(op.name==='staffNotes'&&!op.available(release))throw Error('unavailable query opened');
 const record={name:op.name,getSnapshot:()=>op.name==='myRole'?role:notes,subs:new Set(),subscribe(fn){record.subs.add(fn);return()=>record.subs.delete(fn)},close(){records.delete(record)}};records.add(record);return record;}}
const makeApp=()=>({client,ready,auth:{onChange(fn){authListeners.add(fn);return()=>authListeners.delete(fn)},getSnapshot:()=>auth}});
let app=makeApp();const root=createRoot(document.querySelector('#root'));
function Login(){const ready=useAppReady(),[email,setEmail]=useState('');return <><output aria-label='Admission'>{ready?'ready':'opening'}</output>{auth.state==='signed-in'?<StaffWorkspace team='t'/>:<label>Email<input value={email} onChange={e=>setEmail(e.target.value)}/></label>}</>}
const render=()=>root.render(<React.StrictMode><AppProvider app={app}><Login/></AppProvider></React.StrictMode>);
window.start=async()=>{await act(async()=>render())};
window.publish=async patch=>{await act(async()=>{if(patch.role)role=patch.role;if(patch.release)release=patch.release;if(patch.auth)auth=patch.auth;if(patch.ready)openReady({ok:true});if(patch.app)app=makeApp();if(patch.failedApp)app={...makeApp(),ready:Promise.resolve({ok:false})};if(patch.newClient)app.client={...client};for(const fn of authListeners)fn();for(const fn of releaseListeners)fn();for(const r of records)for(const fn of r.subs)fn();render();})};
window.inspect=()=>({writes,notes:[...records].filter(r=>r.name==='staffNotes').length});
window.finish=()=>act(async()=>root.unmount());
`);
 server=await createBrowserServer({root:dir,configFile:false,logLevel:'error',server:{host:'127.0.0.1',port:0,fs:{allow:[root,dir]}},resolve:{alias:[
 {find:'snapback4/react',replacement:join(root,'packages/snapback4/dist/react.js')},{find:'snapback4/contract',replacement:join(root,'packages/snapback4/dist/contract.js')}]}});
 await server.listen();const {chromium}=require('playwright-core');browser=await chromium.launch({executablePath:chromiumExecutable(),headless:true,args:['--no-sandbox']});
 const page=await browser.newPage();const errors=[];page.on('pageerror',e=>errors.push(e.message));
 await loadBrowserPage(t,page,server.resolvedUrls.local[0]);await page.waitForFunction(()=>window.start);await page.evaluate(()=>window.start());
 const publish=patch=>page.evaluate(p=>window.publish(p),patch);
 const catalog=generation=>({generation,operations:{myRole:{kind:'query',args:{}},staffNotes:{kind:'query',args:{}},addStaffNote:{kind:'mutation',args:{}}},tables:{}});
 const input=page.getByRole('textbox',{name:'Note',exact:true}),select=page.getByLabel('Category',{exact:true}),save=page.getByRole('button',{name:'Save note',exact:true});
 await input.fill('Unsent draft');await select.selectOption('general');await page.evaluate(()=>window.originalInput=document.querySelector('input'));
 assert.equal(await save.isDisabled(),true,'initial custody is not ready');
 await publish({release:catalog(2)});assert.equal(await save.isDisabled(),true,'capabilities do not imply readiness');
 await publish({ready:true});assert.equal(await save.isDisabled(),false);
 assert.equal(await page.getByText('Protected note — normal',{exact:true}).count(),1,'since-release fallback');
 const kept=async()=>{assert.equal(await input.inputValue(),'Unsent draft');assert.equal(await select.inputValue(),'general');assert.equal(await page.evaluate(()=>window.originalInput===document.querySelector('input')),true)};
 await publish({role:{loading:true},release:{loading:true}});await kept();assert.equal(await save.isDisabled(),true);
 assert.equal((await page.evaluate(()=>window.inspect())).notes,0,'protected reads withdraw');
 assert.equal(await page.getByText('Staff workspace',{exact:true}).count(),1,'sticky shell survives loading');
 await publish({role:{data:{role:'staff'},existence:'present',fresh:true,complete:true,cut:null},release:catalog(3)});await kept();assert.equal(await save.isDisabled(),false);
 await publish({role:{denied:{code:'NO',family:'rule',message:'Revoked'}}});await kept();assert.equal(await save.isDisabled(),true);assert.equal((await page.evaluate(()=>window.inspect())).notes,0);
 assert.equal(await page.getByText('Staff access required',{exact:true}).count(),1);
 await publish({role:{loading:true}});assert.equal(await page.getByText('Staff access required',{exact:true}).count(),1,'revoked role is not made sticky again');
 await publish({auth:{state:'restoring',viewer:null}});
 const email=page.getByRole('textbox',{name:'Email',exact:true});await email.fill('kept@example.com');await page.evaluate(()=>window.originalEmail=document.querySelector('input'));
 await publish({auth:{state:'signed-out',viewer:null}});
 assert.equal(await email.inputValue(),'kept@example.com');assert.equal(await page.evaluate(()=>window.originalEmail===document.querySelector('input')),true,'null-viewer restoration does not remount');
 await publish({app:true});assert.equal(await email.inputValue(),'','new app/backend resets same-viewer state');
 await publish({auth:{state:'signed-in',viewer:'dev:bob'}});assert.equal(await input.inputValue(),'','different account resets drafts');
 await publish({failedApp:true,auth:{state:'signed-in',viewer:'dev:bob',why:{code:'E_ADMISSION',family:'client',message:'opening refused'}}});
 assert.equal(await page.getByLabel('Admission').textContent(),'opening','failed opener does not admit its own client');
 await publish({newClient:true,auth:{state:'signed-in',viewer:'dev:bob'}});
 assert.equal(await page.getByLabel('Admission').textContent(),'ready','successful replacement client recovers after failed initial restoration');
 await page.evaluate(()=>window.finish());assert.deepEqual(errors,[]);
});

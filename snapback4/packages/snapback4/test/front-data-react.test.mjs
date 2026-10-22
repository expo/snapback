// @ref LLP 3000.013.002#2 — one snapshot, no extra authority or hidden loading refusals.
import test from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, readFileSync, writeFileSync, rmSync, mkdirSync, symlinkSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { createRequire } from "node:module";
import { spawnSync } from "node:child_process";
import { createBrowserServer, loadBrowserPage } from "./helpers/browser-server.mjs";
import { chromiumExecutable } from "../../../witness/lib.mjs";
import { hangBudget } from "./helpers/wait.mjs";
const root = resolve(import.meta.dirname, "../../..");
const dist = process.env.SNAPBACK4_CLIENT_DIST ?? join(root, "packages/snapback4/dist");
const guide = () => readFileSync(process.env.SNAPBACK4_CLIENT_DIST ? join(dist, "../CLIENT-AND-OPERATIONS.md") : join(root, "packages/snapback4/CLIENT-AND-OPERATIONS.md"), "utf8");
const recipe = () => [...guide().matchAll(/```tsx\n([\s\S]*?)\n```/g)].map(m => m[1]).find(s => s.includes("function ShortScreen"));

test("short query types preserve generated arguments, null and typed refusal", () => {
  const dir = mkdtempSync(join(tmpdir(), "sb4-front-types-"));
  try {
    writeFileSync(join(dir,"types.tsx"), `import {useQueryData,useQueryResult} from '${dist}/react.js';
import type {Query,Refusal} from '${dist}/contract.js';
const q:Query<{id:string},{title:string}|null>={kind:'query',name:'q'};
function Screen(){
const value:{title:string}|null|undefined=useQueryData(q,{id:'x'});
const result=useQueryResult(q,{id:'x'},{skip:true});
const why:Refusal|null=result.why;
// @ts-expect-error generated args remain required
useQueryData(q,{});
// @ts-expect-error generated arg type is not widened
useQueryResult(q,{id:12});
// @ts-expect-error null and loading cannot be treated as a present row
const present:{title:string}=value;
return why?.message ?? value?.title ?? 'loading';}
`);
    const require=createRequire(join(root,'packages/snapback4/package.json'));
    const r=spawnSync(process.execPath,[require.resolve('typescript/bin/tsc'),'--strict','--skipLibCheck','--noEmit','--target','ES2022','--module','ESNext','--moduleResolution','Bundler',join(dir,'types.tsx')],{encoding:'utf8',timeout:60000});
    assert.equal(r.status,0,r.stdout+r.stderr);
  } finally {rmSync(dir,{recursive:true,force:true});}
});

test("packed short-screen recipe: data/refusal, skip, keys, SignedIn three states and StrictMode cleanup", {timeout:hangBudget(5)}, async t => {
  let executablePath;
  try {executablePath=chromiumExecutable();} catch(error){t.skip(`Chromium unavailable: ${error.message}`);return;}
  const dir=mkdtempSync(join(tmpdir(),'sb4-front-react-')); let browser,server;
  t.after(async()=>{await browser?.close();await server?.close();rmSync(dir,{recursive:true,force:true});});
  assert.ok(recipe(),"guide carries runnable short screen");
  writeFileSync(join(dir,'recipe.tsx'),recipe());
  writeFileSync(join(dir,'api.js'),"export const api={staffNotes:{kind:'query',name:'staffNotes'}};");
  writeFileSync(join(dir,'index.html'),'<div id="root"></div><script type="module" src="/harness.tsx"></script>');
  writeFileSync(join(dir,'harness.tsx'),`
import React,{act,StrictMode,Component} from 'react';import{createRoot}from'react-dom/client';
import{AppProvider,SignedIn,useQueryData,useQueryResult,QueryRefusal}from'snapback4/react';
import{ShortScreen,QuickNotes}from'./recipe';
window.IS_REACT_ACT_ENVIRONMENT=true;
let read={loading:true},auth={state:'restoring',viewer:null},skip=false,key='a',mode='recipe';
const records=new Set(),listeners=new Set();let opens=0,closes=0;
const client={observe(op,args){opens++;const r={getSnapshot:()=>read,subscribe(fn){r.fn=fn;return()=>{r.fn=null}},close(){closes++;records.delete(r)}};records.add(r);return r;}};
const app={client,auth:{getSnapshot:()=>auth,onChange(fn){listeners.add(fn);return()=>listeners.delete(fn)}}};
class Boundary extends Component{state={why:null};static getDerivedStateFromError(e){if(!(e instanceof QueryRefusal))throw e;window.boundaryWhy=e.why;return{why:e.why};}render(){return this.state.why?<p role='alert'>{this.state.why.code}</p>:this.props.children;}}
const valueQuery={kind:'query',name:'value'};
function Value(){const data=useQueryData(valueQuery,{id:key},{skip});return <output>{JSON.stringify(data)??'undefined'}</output>;}
function Inline(){const r=useQueryResult(valueQuery,{id:key},{skip});window.inlineWhy=r.why;return <output>{r.why?.code??JSON.stringify(r.data)??'undefined'}</output>;}
const root=createRoot(document.querySelector('#root'));
const render=()=>root.render(<StrictMode><AppProvider app={app}>{mode==='recipe'?<ShortScreen/>:mode==='quick'?<Boundary key={key}><QuickNotes team='t'/></Boundary>:mode==='value'?<Boundary key={key}><Value/></Boundary>:<Inline/>}</AppProvider></StrictMode>);
window.publish=async patch=>{await act(async()=>{if('read'in patch)read=patch.read;if(patch.auth){auth=patch.auth;for(const fn of listeners)fn();}if('skip'in patch)skip=patch.skip;if(patch.key)key=patch.key;if(patch.mode)mode=patch.mode;for(const r of records)r.fn?.();render();});return{active:records.size,opens,closes};};
window.refusalIsOriginal=()=>window.boundaryWhy===read.denied;window.inlineIsOriginal=()=>window.inlineWhy===read.denied;window.start=()=>act(async()=>render());window.finish=async()=>{await act(async()=>root.unmount());return{active:records.size,listeners:listeners.size,opens,closes};};
`);
  server=await createBrowserServer({root:dir,configFile:false,logLevel:'error',server:{host:'127.0.0.1',port:0,fs:{allow:[root,dir,dist]}},resolve:{alias:[{find:'snapback4/react',replacement:join(dist,'react.js')},{find:'../snapback/generated/api',replacement:join(dir,'api.js')}]}});
  await server.listen();const require=createRequire(join(root,'package.json'));const {chromium}=require('playwright-core');
  browser=await chromium.launch({executablePath,headless:true,args:['--no-sandbox']});const page=await browser.newPage();page.setDefaultTimeout(hangBudget());
  await loadBrowserPage(t,page,server.resolvedUrls.local[0]);await page.waitForFunction(()=>window.start);await page.evaluate(()=>window.start());
  const publish=patch=>page.evaluate(p=>window.publish(p),patch);const text=()=>page.locator('#root').innerText();
  const ready=(data,existence='present',extra={})=>({data,existence,complete:true,cut:null,fresh:true,...extra});
  assert.equal(await text(),'Restoring…');assert.equal((await publish({auth:{state:'signed-out',viewer:null}})).active,0);assert.equal(await text(),'Sign in');
  await publish({auth:{state:'signed-in',viewer:'alice'}});assert.equal(await text(),'Loading…');
  await publish({read:ready([],'absent')});assert.equal(await page.locator('ul').count(),1);assert.equal(await page.locator('li').count(),0);
  await publish({read:ready([{id:'one',title:'Partial note'}],'partial',{complete:false,fresh:false})});assert.equal(await text(),'Partial note');
  const why={code:'NO_ACCESS',family:'rule',message:'No access'};
  await publish({read:{denied:why}});assert.equal(await text(),'No access');
  await publish({mode:'quick'});assert.equal(await text(),'NO_ACCESS','default data hook throws the original refusal into boundary');assert.equal(await page.evaluate(()=>window.refusalIsOriginal()),true);
  await publish({mode:'value',key:'value',read:{loading:true}});assert.equal(await text(),'undefined');
  for(const data of [null,false,0,[],[{title:'value'}]]){await publish({read:ready(data,data===null||Array.isArray(data)&&!data.length?'absent':'present')});assert.equal(await text(),JSON.stringify(data));}
  await publish({skip:true});assert.equal(await text(),'undefined');assert.equal((await publish({skip:true})).active,0);
  await publish({skip:false,read:{loading:true},key:'new'});assert.equal(await text(),'undefined','new args never display the previous value');
  await publish({mode:'inline',read:{denied:why}});assert.equal(await text(),'NO_ACCESS');assert.equal(await page.evaluate(()=>window.inlineIsOriginal()),true);
  await publish({mode:'recipe',auth:{state:'signed-out',viewer:null}});assert.equal(await text(),'Sign in');
  const final=await page.evaluate(()=>window.finish());assert.equal(final.active,0);assert.equal(final.listeners,0);assert.equal(final.opens,final.closes);
});

test("packed status/form recipe runs verbatim with generated API and real hooks", {timeout:hangBudget(5)}, async t => {
  const dir=mkdtempSync(join(tmpdir(),'sb4-status-recipe-'));let browser,server;
  t.after(async()=>{await browser?.close();await server?.close();rmSync(dir,{recursive:true,force:true});});
  const source=[...guide().matchAll(/```tsx\n([\s\S]*?)\n```/g)].map(m=>m[1]).find(s=>s.includes('export function ReadNotice'));
  assert.ok(source,'packed guide carries the shared status and form recipe');
  mkdirSync(join(dir,'src'));mkdirSync(join(dir,'snapback'));
  writeFileSync(join(dir,'src/recipe.tsx'),source);
  writeFileSync(join(dir,'snapback/schema.q'),`use identity guests
table posts:
  conversationId: text <=80
  body: text <=2000
  read <- allow
  insert <- allow
  online only
query thread(conversationId: text <=80, c: cursor ?):
  return posts where .conversationId = conversationId after c first 20 by .id
mutation send(conversationId: text <=80, body: text <=2000):
  return insert posts {conversationId, body}
mutation setLike(postId: posts, set: bool):
  return null
`);
  const env={...process.env};delete env.SNAPBACK4_BIN;
  const checked=spawnSync(process.execPath,[join(dist,'../bin/snapback4.js'),'check'],{cwd:dir,env,encoding:'utf8',timeout:60000});
  assert.equal(checked.status,0,checked.stdout+checked.stderr);
  // Resolve the literal bare imports against the packed SDK and the installed
  // React/TypeScript toolchain; the extracted source itself remains unchanged.
  mkdirSync(join(dir,'node_modules/@types'),{recursive:true});
  const require=createRequire(join(root,'packages/snapback4/package.json'));
  for(const [name,target] of [['snapback4',resolve(dist,'..')],['react',resolve(require.resolve('react/package.json'),'..')],['@types/react',resolve(require.resolve('@types/react/package.json'),'..')]]) symlinkSync(target,join(dir,'node_modules',name),'dir');
  const typed=spawnSync(process.execPath,[require.resolve('typescript/bin/tsc'),'--strict','--skipLibCheck','--noEmit','--target','ES2022','--module','ESNext','--moduleResolution','Bundler','--jsx','react-jsx',join(dir,'src/recipe.tsx')],{cwd:dir,encoding:'utf8',timeout:60000});
  assert.equal(typed.status,0,typed.stdout+typed.stderr);
  writeFileSync(join(dir,'index.html'),'<div id="root"></div><script type="module" src="/harness.tsx"></script>');
  writeFileSync(join(dir,'harness.tsx'),`
import React,{act,StrictMode}from'react';import{createRoot}from'react-dom/client';
import{SnapbackProvider}from'snapback4/react';import{ReadNotice,WriteNote,Messages}from'./src/recipe';
window.IS_REACT_ACT_ENVIRONMENT=true;
let read={loading:true},conversationId='thread-one',failed=false,last;const records=new Set(),writes=new Set(),calls=[];
const client={observe(op,args){const r={getSnapshot:()=>read,subscribe(fn){r.fn=fn;return()=>{r.fn=null}},close(){records.delete(r)}};records.add(r);return r;},onWrite(fn){writes.add(fn);return()=>writes.delete(fn)},async mutate(op,args,options){calls.push({name:op.name,args});return failed?{state:'failed',id:options.id,why:{code:'NO_WRITE',family:'rule',message:'Cannot send'}}:{state:'sent',id:options.id,seq:1,result:null};}};
const root=createRoot(document.querySelector('#root'));const render=()=>root.render(<StrictMode><section aria-label="Notice"><ReadNotice read={read}/><WriteNote last={last}/></section><section aria-label="Messages"><SnapbackProvider client={client}><Messages conversationId={conversationId}/></SnapbackProvider></section></StrictMode>);
window.publish=async patch=>{await act(async()=>{if('read'in patch)read=patch.read;if('conversationId'in patch)conversationId=patch.conversationId;if('failed'in patch)failed=patch.failed;if('last'in patch)last=patch.last;for(const r of records)r.fn?.();render();});return records.size;};window.calls=()=>calls;window.finish=async()=>{await act(async()=>root.unmount());return{observations:records.size,writes:writes.size};};
`);
  server=await createBrowserServer({root:dir,configFile:false,logLevel:'error',server:{host:'127.0.0.1',port:0,fs:{allow:[root,dir,dist]}},resolve:{alias:[{find:'snapback4/react',replacement:join(dist,'react.js')}],dedupe:['react','react-dom']}});
  await server.listen();const{chromium}=require('playwright-core');
  browser=await chromium.launch({executablePath:chromiumExecutable(),headless:true,args:['--no-sandbox']});const page=await browser.newPage();page.setDefaultTimeout(hangBudget());
  await loadBrowserPage(t,page,server.resolvedUrls.local[0]);await page.waitForFunction(()=>window.publish);
  const publish=patch=>page.evaluate(p=>window.publish(p),patch),notice=page.getByRole('region',{name:'Notice',exact:true}),messages=page.getByRole('region',{name:'Messages',exact:true});
  const ready=(data,existence='present',extra={})=>({data,existence,complete:true,cut:null,fresh:true,...extra});
  await publish({});assert.equal(await notice.innerText(),'Loading…');assert.equal(await messages.getByRole('status').innerText(),'Loading…');
  await publish({read:{denied:{code:'NO_ACCESS',family:'rule',message:'No access'}}});assert.equal(await notice.getByRole('alert').innerText(),'No access');assert.equal(await messages.getByRole('alert').innerText(),'No access');
  await publish({read:ready([],'absent')});assert.equal(await notice.innerText(),'Nothing yet');assert.equal(await messages.locator('li').count(),0);assert.match(await messages.innerText(),/Nothing yet/);
  await publish({read:ready([],'partial',{complete:false})});assert.equal(await notice.innerText(),'More may exist');assert.equal(await messages.getByRole('status').innerText(),'More may exist');
  await publish({read:ready([{id:'post-one',body:'Known row'}],'present',{complete:false})});assert.equal(await notice.innerText(),'More may exist');assert.match(await messages.locator('li').innerText(),/Known row/);
  await publish({read:ready([{id:'post-one',body:'Known row'}])});assert.equal(await notice.innerText(),'');assert.equal(await messages.getByRole('status').count(),0);
  await messages.getByRole('textbox').fill('A new message');await messages.getByRole('button',{name:'Send',exact:true}).click();await page.waitForFunction(()=>document.querySelector('input').value==='');
  await messages.getByRole('button',{name:'Like',exact:true}).click();await page.waitForFunction(()=>window.calls().length===2);
  assert.deepEqual(await page.evaluate(()=>window.calls()),[{name:'send',args:{conversationId:'thread-one',body:'A new message'}},{name:'setLike',args:{postId:'post-one',set:true}}]);
  await publish({failed:true});await messages.getByRole('textbox').fill('Keep my draft');await messages.getByRole('button',{name:'Send',exact:true}).click();assert.equal(await messages.getByRole('alert').innerText(),'Cannot send');assert.equal(await messages.getByRole('textbox').inputValue(),'Keep my draft');
  assert.equal(await publish({conversationId:null}),0,'skipped arguments close the observation');assert.equal(await messages.getByRole('button',{name:'Send',exact:true}).isDisabled(),true);
  assert.deepEqual(await page.evaluate(()=>window.finish()),{observations:0,writes:0});
});

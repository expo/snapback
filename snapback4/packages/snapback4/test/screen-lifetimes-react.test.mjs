// @ref LLP 3000.023#13 — real React executes the installed recipe and frozen L1/L2.
import test from 'node:test';
import assert from 'node:assert/strict';
import {createRequire} from 'node:module';
import {mkdtempSync, readFileSync, writeFileSync, rmSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join, resolve} from 'node:path';
import {pathToFileURL} from 'node:url';
import ts from 'typescript';
import {chromiumExecutable} from '../../../witness/lib.mjs';
import {hangBudget} from './helpers/wait.mjs';
const root=resolve(import.meta.dirname,'../../..');
const pkg=createRequire(join(root,'packages/snapback4/package.json'));
const starter=join(root,'crates/snapback4/src/verbs/init/social');
const pilot=join(root,'reports/20261003-l-screen-lifetimes/pilot');
test('screen recipe and L1–L3: Strict Mode, bounded owners, all scope resets, withdrawal, sibling and visibility cleanup',{timeout:hangBudget(20)},async t=>{
 const {chromium}=createRequire(join(root,'package.json'))('playwright-core');
 const {createServer}=await import(pathToFileURL(createRequire(join(root,'apps/chat/package.json')).resolve('vite')));
 const dir=mkdtempSync(join(tmpdir(),'sb4-screen-lifetime-'));
 let browser,vite;t.after(async()=>{await browser?.close();await vite?.close();rmSync(dir,{recursive:true,force:true});});
 const emit=(name,source)=>writeFileSync(join(dir,name),ts.transpileModule(source,{compilerOptions:{target:ts.ScriptTarget.ES2022,module:ts.ModuleKind.ESNext,jsx:ts.JsxEmit.ReactJSX}}).outputText);
 emit('recipe.jsx',readFileSync(join(starter,'BoundedConversation.tsx'),'utf8'));
 emit('PageLifetime.js',readFileSync(join(starter,'PageLifetime.ts'),'utf8'));
 emit('useForeground.js',readFileSync(join(pilot,'after/useForeground.ts'),'utf8'));
 const before=readFileSync(join(pilot,'before/chat.tsx'),'utf8').split('\n');
 const after=readFileSync(join(pilot,'after/chat.tsx'),'utf8').split('\n');
 emit('specimens.jsx',`import React,{useRef,useState} from 'react';import {Text} from 'react-native';import {useQuery,usePage} from 'snapback4/react';import {api} from '../snapback/generated/api';
export function Before(){const page=usePage(api.history,{conversation:'r'});
${before.find(l=>l.includes(' const historyKeys='))}
return <>{historyKeys.current.map(key=><StableMessage key={key.id} id={key.id}>{m=><Text>{m.text}</Text>}</StableMessage>)}</>}
${before.find(l=>l.startsWith('function StableMessage'))}
export function After(){const page=usePage(api.history,{conversation:'r'});
${after.find(l=>l.startsWith(' const [start,Start]'))}
return <>{historyKeys.map(key=><AfterMessage key={key.id} id={key.id}>{m=><Text>{m.text}</Text>}</AfterMessage>)}</>}
${after.find(l=>l.startsWith('function StableMessage')).replace('function StableMessage','function AfterMessage')}
`);
 writeFileSync(join(dir,'native.jsx'),`import {act,createElement as h} from 'react';
export const View=({children})=>h('div',null,children),Text=({children})=>h('span',null,children);
export const TextInput=({value,onChangeText})=>h('input',{value,onChange:e=>act(()=>onChangeText(e.target.value))});
export const Button=({title,disabled,onPress})=>h('button',{disabled,onClick:()=>act(()=>onPress())},title);
const listeners=new Set();export const AppState={currentState:'active',addEventListener(_,fn){listeners.add(fn);return {remove:()=>listeners.delete(fn)}}};
const webListeners=new Set(),add=document.addEventListener.bind(document),remove=document.removeEventListener.bind(document);document.addEventListener=(type,fn,...rest)=>{if(type==='visibilitychange')webListeners.add(fn);return add(type,fn,...rest)};document.removeEventListener=(type,fn,...rest)=>{if(type==='visibilitychange')webListeners.delete(fn);return remove(type,fn,...rest)};window.webVisibilityListeners=()=>webListeners.size;window.webVisibility=async(state)=>act(async()=>{Object.defineProperty(document,'visibilityState',{configurable:true,value:state});document.dispatchEvent(new Event('visibilitychange'))});
export const Platform={OS:'web'};window.nativeVisibility=async(state)=>act(async()=>{AppState.currentState=state;for(const f of listeners)f(state)});window.visibilityListeners=()=>listeners.size;
`);
 writeFileSync(join(dir,'Conversation.jsx'),`import React from 'react';export function OnceViewer(){return <span>Selected media owner</span>}`);
 writeFileSync(join(dir,'api.js'),`export const api=Object.fromEntries(['history','messagePhoto','quotedMessage','receiptMember','send'].map(name=>[name,{kind:name==='send'?'mutation':'query',name,...(name==='history'?{rowKey:'id'}:{})}]));`);
 writeFileSync(join(dir,'index.html'),'<div id="root"></div><script type="module" src="/harness.jsx"></script>');
 writeFileSync(join(dir,'harness.jsx'),`import React,{StrictMode,act} from 'react';import {createRoot} from 'react-dom/client';
import {SnapbackProvider,useQuery} from 'snapback4/react';import {BoundedConversation} from './recipe.jsx';import {Before,After} from './specimens.jsx';import {useForeground} from './useForeground.js';import {api} from './api.js';
globalThis.IS_REACT_ACT_ENVIRONMENT=true;
const ready=(data,next=null)=>({data,next,complete:true,cut:null,fresh:true,existence:data===null||Array.isArray(data)&&!data.length?'absent':'present'});
const rows=n=>Array.from({length:batchSize},(_,i)=>({id:'m'+(n+i),ordinal:n+i,text:'protected-'+(n+i),photo:{id:'asset-'+(n+i)}}));
let viewer='alice',backend='one',conversation='r',active=true,mode='recipe',sibling=false,cycle=0,batchSize=20,pointRead,rootRead,client;
const viewers=new Set(),records=[],metrics={opens:0,closes:0};const watches=new Map();
const source=(op,args)=>op.name==='history'?(args.c?ready(rows(20*Number(args.c.slice(1))),'c'+(Number(args.c.slice(1))+1)):rootRead??ready(rows(cycle),'c1')):op.name==='receiptMember'?ready({id:'member'}):pointRead??ready({id:args.id,text:'protected-'+args.id.slice(1),photo:{id:'asset'}});
function makeClient(){return {viewer:()=>viewer,onViewer(fn){viewers.add(fn);return()=>viewers.delete(fn)},onWrite(){return()=>{}},write:async()=>undefined,mutate:async()=>({state:'sent',id:'w'}),
observe(op,args,options){const key=JSON.stringify([op.name,args,options?.keep]);let w=watches.get(key);if(!w){w={op,args,read:source(op,args),refs:0,listeners:new Set()};watches.set(key,w)}w.refs++;metrics.opens++;let closed=false;
const record={w,closed:false};records.push(record);
return {getSnapshot:()=>w.read,subscribe(fn){w.listeners.add(fn);return()=>w.listeners.delete(fn)},close(){if(closed)throw Error('double close');closed=record.closed=true;metrics.closes++;if(!--w.refs)watches.delete(key)}}}}}
client=makeClient();const root=createRoot(document.getElementById('root'));
function Peer(){const r=useQuery(api.messagePhoto,{id:'m0'},{keep:false});return <aside>{'data'in r?r.data?.text:'peer unavailable'}</aside>}
function Visibility(){const foreground=useForeground();return <span>{foreground?'foreground':'background'}</span>}
const render=()=>root.render(<StrictMode><SnapbackProvider client={client}>{mode==='before'?<Before/>:mode==='after'?<After/>:mode==='visibility'?<Visibility/>:<BoundedConversation backend={backend} conversation={conversation} active={active}/>} {sibling&&<Peer/>}</SnapbackProvider></StrictMode>);
const publish=()=>{for(const w of watches.values()){w.read=source(w.op,w.args);for(const fn of [...w.listeners])fn()}};
window.start=async()=>act(async()=>render());
window.change=async values=>act(async()=>{if('active'in values)active=values.active;if('viewer'in values){viewer=values.viewer;for(const fn of viewers)fn(viewer)}if(values.backend)backend=values.backend;if(values.conversation)conversation=values.conversation;if('sibling'in values)sibling=values.sibling;if(values.mode)mode=values.mode;if(values.replaceClient)client=makeClient();render()});
window.publish=async values=>act(async()=>{if('cycle'in values)cycle=values.cycle;if('size'in values)batchSize=values.size;if('point'in values)pointRead=values.point;if('root'in values)rootRead=values.root;publish()});
window.coalesced=async()=>act(async()=>{rootRead={loading:true};publish();rootRead=ready(rows(0),'c1');publish()});
window.counts=()=>({observations:watches.size,owners:[...watches.values()].reduce((n,w)=>n+w.refs,0),points:[...watches.values()].filter(w=>w.op.name==='quotedMessage'||w.op.name==='messagePhoto').length,history:[...watches.values()].filter(w=>w.op.name==='history').length,...metrics});
window.finish=async()=>{await act(async()=>root.unmount());return {observations:watches.size,opens:metrics.opens,closes:metrics.closes,viewers:viewers.size}};
`);
 vite=await createServer({root:dir,configFile:false,logLevel:'error',server:{hmr:false,host:'127.0.0.1',port:0,fs:{allow:[root,dir]}},resolve:{alias:[
 ...['react','react/jsx-runtime','react/jsx-dev-runtime','react-dom/client'].map(name=>({find:new RegExp('^'+name+'$'),replacement:pkg.resolve(name)})),
 {find:'react-native',replacement:join(dir,'native.jsx')},{find:'../snapback/generated/api',replacement:join(dir,'api.js')},
 {find:'snapback4/react',replacement:join(root,'packages/snapback4/dist/react.js')},{find:'snapback4/contract',replacement:join(root,'packages/snapback4/dist/contract.js')}
 ]}});await vite.listen();
 browser=await chromium.launch({executablePath:chromiumExecutable(),headless:true,args:['--no-sandbox'],timeout:hangBudget()});
 const page=await browser.newPage();page.setDefaultTimeout(hangBudget());
 const errors=[];page.on('pageerror',e=>errors.push(e.message));
 await page.goto(vite.resolvedUrls.local[0]);await page.waitForFunction(()=>window.start);await page.evaluate(()=>window.start());
 const counts=()=>page.evaluate(()=>window.counts()),text=()=>page.locator('body').innerText();
 const measured={recipe:await counts()};assert.equal(measured.recipe.observations,22);assert.equal(measured.recipe.points,20);
 const input=page.locator('input');await input.fill('preserve me');await input.focus();
 await page.evaluate(()=>window.input=document.querySelector('input'));
 await page.evaluate(()=>window.publish({point:{loading:true}}));assert.doesNotMatch(await text(),/protected-/);assert.match(await text(),/Message unavailable/);
 assert.equal(await page.getByRole('button',{name:'Select photo',exact:true}).count(),0,'identity placeholders expose no media action');
 await page.evaluate(()=>window.publish({point:{denied:{code:'NO_BODY',message:'Denied',family:'rule'}}}));assert.doesNotMatch(await text(),/protected-/);
 await page.evaluate(()=>window.publish({point:null}));assert.match(await text(),/protected-/);
 await page.getByRole('button',{name:'Older page',exact:true}).click();assert.equal((await counts()).history,2);
 await page.getByRole('button',{name:'Older page',exact:true}).click();assert.equal((await counts()).history,3);assert.equal(await page.getByRole('button',{name:'Older page',exact:true}).isDisabled(),true);
 await page.getByRole('button',{name:'Next rows',exact:true}).click();assert.equal((await counts()).points,20);assert.doesNotMatch(await text(),/protected-0\b/,'window movement releases old body');
 await page.evaluate(()=>window.coalesced());assert.equal((await counts()).history,1,'generation withdrawal resets requested page owner even when React batches it');
 assert.equal(await input.inputValue(),'preserve me');assert.equal(await page.evaluate(()=>window.input===document.querySelector('input')),true);
 await page.evaluate(()=>window.publish({root:{loading:true}}));assert.equal((await counts()).points,0,'root withdrawal releases every identity owner');
 assert.equal(await input.inputValue(),'preserve me');
 await page.evaluate(()=>window.publish({root:null}));
 await page.evaluate(()=>window.change({active:false}));measured.hidden=await counts();assert.equal(measured.hidden.observations,0);
 await page.evaluate(()=>window.publish({cycle:200}));assert.doesNotMatch(await text(),/protected-/,'hidden late replacement cannot render');
 await page.evaluate(()=>window.change({viewer:'bob'}));assert.equal(await input.inputValue(),'','account change while inactive clears draft');
 await page.evaluate(()=>window.change({active:true}));assert.match(await text(),/protected-200/);assert.doesNotMatch(await text(),/protected-0\b/);
 for(const change of [{backend:'two'},{conversation:'other'},{replaceClient:true}]){await input.fill('reset');await page.evaluate(v=>window.change(v),change);assert.equal(await input.inputValue(),'');}
 await page.evaluate(()=>window.publish({cycle:0}));await page.evaluate(()=>window.change({sibling:true}));assert.equal((await counts()).points,20,'same-key active sibling shares point');
 await page.evaluate(()=>window.change({active:false}));assert.equal((await counts()).observations,1);assert.match(await text(),/protected-0/);
 await page.evaluate(()=>window.change({sibling:false,mode:'before'}));
 for(let n=0;n<200;n+=20)await page.evaluate(cycle=>window.publish({cycle}),n);
 measured.before=await counts();assert.equal(measured.before.points,200,'actual L1 accumulates displaced identities');
 await page.evaluate(()=>window.change({mode:'after'}));
 for(let n=0;n<200;n+=20)await page.evaluate(cycle=>window.publish({cycle}),n);
 measured.after=await counts();assert.equal(measured.after.points,20,'rewritten L1/L2 follow only requested current identities');
 await page.evaluate(()=>window.publish({size:80}));measured.afterWide=await counts();assert.equal(measured.afterWide.points,40,'Cal29 window stays bounded even within a wide requested answer');
 await page.evaluate(()=>window.change({mode:'visibility'}));assert.equal(await page.evaluate(()=>window.visibilityListeners()),1,'Strict Mode leaves one native visibility listener');
 await page.evaluate(()=>window.nativeVisibility('background'));await page.waitForFunction(()=>document.body.textContent.includes('background'));
 await page.evaluate(()=>window.webVisibility('visible'));assert.match(await text(),/background/,'web visibility cannot override native background');
 await page.evaluate(()=>window.nativeVisibility('active'));await page.waitForFunction(()=>document.body.textContent.includes('foreground'));
 await page.evaluate(()=>window.webVisibility('hidden'));assert.match(await text(),/background/);assert.equal(await page.evaluate(()=>window.webVisibilityListeners()),1);
 const end=await page.evaluate(()=>window.finish());assert.equal(end.observations,0);assert.equal(end.opens,end.closes);assert.equal(end.viewers,0);assert.equal(await page.evaluate(()=>window.visibilityListeners()),0);assert.equal(await page.evaluate(()=>window.webVisibilityListeners()),0);
 assert.deepEqual(errors,[]);console.log('L1-L3 mounted measurements',JSON.stringify(measured));
});

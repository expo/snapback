import { createBrowserServer, loadBrowserPage } from './browser-server.mjs';
// @ref LLP 3000.023#13 — complete recipe and Cal29 composition, with controlled client/UI boundaries.
import {createRequire} from 'node:module';
import {mkdtempSync, readFileSync, writeFileSync, rmSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join, resolve} from 'node:path';
import ts from 'typescript';
import {chromiumExecutable} from '../../../../witness/lib.mjs';
import {hangBudget} from './wait.mjs';
const root=resolve(import.meta.dirname,'../../../..');
const pkg=createRequire(join(root,'packages/snapback4/package.json'));
const starter=join(root,'crates/snapback4/src/verbs/init/social');
const pilot=join(root,'reports/20261003-l-screen-lifetimes/pilot');
export async function screen(t) {
 const {chromium}=createRequire(join(root,'package.json'))('playwright-core');

 const dir=mkdtempSync(join(tmpdir(),'sb4-screen-lifetime-'));
 let browser,vite;t.after(async()=>{await browser?.close();await vite?.close();rmSync(dir,{recursive:true,force:true});});
 const emit=(name,source)=>writeFileSync(join(dir,name),ts.transpileModule(source,{compilerOptions:{target:ts.ScriptTarget.ES2022,module:ts.ModuleKind.ESNext,jsx:ts.JsxEmit.ReactJSX}}).outputText);
 emit('recipe.jsx',readFileSync(join(starter,'BoundedConversation.tsx'),'utf8'));
 emit('useForeground.js',readFileSync(join(pilot,'after/useForeground.ts'),'utf8'));
 for(const name of ['before','after']) emit(name+'.jsx',readFileSync(join(pilot,name,'chat.tsx'),'utf8'));
 for(const name of ['Conversation.tsx','useOnceMedia.ts','PageLifetime.ts','intents.ts','useTyping.ts']) emit(name.replace(/\.tsx?$/,'.js'),readFileSync(join(starter,name),'utf8'));
 writeFileSync(join(dir,'intent-store.js'),'export const intentStorage={};');
 writeFileSync(join(dir,'ui.jsx'),`export const PhotoPicker=()=>null;`);
 writeFileSync(join(dir,'native.jsx'),`import React,{act,createElement as h,useEffect,useLayoutEffect,useRef,useImperativeHandle,forwardRef} from 'react';
export function View({children,onLayout,testID,nativeID}){const ref=useRef();useLayoutEffect(()=>{const id=ref.current?.querySelector('[id^="message-"]')?.id;onLayout?.({nativeEvent:{layout:{y:10*Number(id?.replace('message-m','')??0)}}})});return <div ref={ref} data-testid={testID} id={nativeID}>{children}</div>}
export const Text=({children,testID})=>h('span',{'data-testid':testID},children);
export const TextInput=({value,onChangeText,accessibilityLabel})=>h('input',{value,'aria-label':accessibilityLabel??'Message draft',onChange:e=>act(()=>onChangeText(e.target.value))});
export const Button=({title,disabled,onPress,testID})=>h('button',{'data-testid':testID,disabled,onClick:()=>{act(()=>{void onPress()})}},title);
export const ScrollView=forwardRef(function ScrollView({children,onContentSizeChange},ref){const element=useRef(),change=useRef();change.current=onContentSizeChange;useImperativeHandle(ref,()=>({scrollTo:value=>window.scrolls.push(value),scrollToEnd:()=>window.ends++}));useLayoutEffect(()=>onContentSizeChange?.());useEffect(()=>{const observer=new MutationObserver(()=>act(()=>change.current?.()));observer.observe(element.current,{childList:true,subtree:true});return()=>observer.disconnect()},[]);return <div ref={element}>{children}</div>});
export const FlatList=()=>null,ImageBackground=View,Linking={openURL(){}},Image=({source,accessibilityLabel})=><img alt={accessibilityLabel??'Once photo'} src={source?.uri}/>;
const listeners=new Set();export const AppState={currentState:'active',addEventListener(_,fn){listeners.add(fn);return {remove:()=>listeners.delete(fn)}}};
const webListeners=new Set(),add=document.addEventListener.bind(document),remove=document.removeEventListener.bind(document);document.addEventListener=(type,fn,...rest)=>{if(type==='visibilitychange')webListeners.add(fn);return add(type,fn,...rest)};document.removeEventListener=(type,fn,...rest)=>{if(type==='visibilitychange')webListeners.delete(fn);return remove(type,fn,...rest)};window.webVisibilityListeners=()=>webListeners.size;window.webVisibility=async(state)=>act(async()=>{Object.defineProperty(document,'visibilityState',{configurable:true,value:state});document.dispatchEvent(new Event('visibilitychange'))});
export const Platform={OS:'web'};window.nativeVisibility=async(state)=>act(async()=>{AppState.currentState=state;for(const f of listeners)f(state)});window.visibilityListeners=()=>listeners.size;
`);
 writeFileSync(join(dir,'pilot-ui.jsx'),`import React from 'react';import {Button,TextInput} from './native.jsx';
export const Nav=()=>null,Btn=Button,Video=()=>null,ReactionPicker=()=>null,ChatListRow=()=>null,ChatSettingsForm=()=>null,TypingIndicator=()=>null,posterUri='poster';
export function Composer({value,onChangeText,onSend,sending,onPressAttach,attachments,onRemoveAttachment}){return <section data-testid="composer"><TextInput value={value} onChangeText={onChangeText}/><Button title="Send" disabled={sending} onPress={onSend}/><Button title="Attach" onPress={onPressAttach}/><output>Attachments: {attachments.length}</output><Button title="Remove attachment" onPress={onRemoveAttachment}/></section>}
export function MessageBubble({text,onPressQuote,onPressMedia,viewOnce}){return <article>{text}<Button title="Jump to quote" onPress={onPressQuote}/>{viewOnce&&<Button title="Open once" onPress={onPressMedia}/>}</article>}
export const router={push(){},replace(){}};export const useIsFocused=()=>true;
export const launchImageLibraryAsync=async()=>({canceled:false,assets:[{type:'image',uri:'data:image/png;base64,AA=='}]});
`);
 writeFileSync(join(dir,'api.js'),`const queries=['history','messagePhoto','quotedMessage','receiptMember','conversationScreen','messageReceipts','typingIn','messageAuthor','messageReactions'];export const api=Object.fromEntries([...queries,'send','sendMedia','editMessage','setTyping','stopTyping','seen','react'].map(name=>[name,{kind:queries.includes(name)?'query':'mutation',name,...(['history','messageReceipts'].includes(name)?{rowKey:'id'}:{})}]));`);
 writeFileSync(join(dir,'index.html'),'<div id="root"></div><script type="module" src="/harness.jsx"></script>');
 writeFileSync(join(dir,'harness.jsx'),`import React,{StrictMode,Profiler,act} from 'react';import {createRoot} from 'react-dom/client';
import {createLocalClient} from 'snapback4/local';import {webDevice,memoryPersistence} from 'snapback4/web';
import {SnapbackProvider,useQuery} from 'snapback4/react';import {BoundedConversation} from './recipe.jsx';import {Conversation as Before} from './before.jsx';import {Conversation as After} from './after.jsx';import {useForeground} from './useForeground.js';import {api} from './api.js';
globalThis.IS_REACT_ACT_ENVIRONMENT=true;
const ready=(data,next=null)=>({data,next,complete:true,cut:null,fresh:true,existence:data===null||Array.isArray(data)&&!data.length?'absent':'present'});
const message=n=>({id:'m'+n,ordinal:n+1,text:'protected-'+n,sender:'alice',at:1,quote:n===0?'m65':null,oncePhoto:{id:'asset'},photo:null});const rows=n=>Array.from({length:batchSize},(_,i)=>message(n+i));
let viewer='alice',backend='one',conversation='r',active=true,mode='recipe',sibling=false,cycle=0,batchSize=20,pointRead,rootRead,client;
window.scrolls=[];window.ends=0;window.calls=[];window.assets=[];window.revokes=0;window.commits=[];let hold=false,resolveSend;
const viewers=new Set(),metrics={opens:0,closes:0};const watches=new Map();
const source=(op,args)=>{
 if(op.name==='history'||op.name==='messageReceipts'){const n=args.c?20*Number(args.c.slice(1)):cycle;return op.name==='history'&&!args.c&&rootRead?rootRead:ready(rows(n),n<60?'c'+(n/20+1):null)}
 if(op.name==='receiptMember')return ready({id:'member',seenOrdinal:99999});
 if(op.name==='conversationScreen')return ready({title:'Conversation'});
 if(op.name==='messageReactions'||op.name==='typingIn')return ready([]);
 if(op.name==='messageAuthor')return ready(null);
 return pointRead??ready(op.name==='messagePhoto'?{id:args.id,text:'protected-'+args.id.slice(1),photo:{id:'asset'}}:message(Number(args.id.slice(1))||0));
};
function makeClient(){return {link:()=> 'online',onLink(){return()=>{}},viewer:()=>viewer,onViewer(fn){viewers.add(fn);return()=>viewers.delete(fn)},onWrite(){return()=>{}},write:async()=>undefined,pendingWrites:async()=>[],onPendingWrites(){return()=>{}},now:()=>Date.now(),onReset(){return()=>{}},asset:async id=>{window.assets.push(id);return {url:'data:image/gif;base64,R0lGODlhAQABAAAAACw=',revoke(){window.revokes++}}},
mutate:async(op,args)=>{window.calls.push({name:op.name,args});if(hold&&['send','editMessage','sendMedia'].includes(op.name))return await new Promise(r=>resolveSend=r);return {state:'sent',id:'w'}},
observe(op,args,options){const key=JSON.stringify([op.name,args,options?.keep]);let w=watches.get(key);if(!w){w={op,args,read:source(op,args),refs:0,listeners:new Set()};watches.set(key,w)}w.refs++;metrics.opens++;let closed=false;
return {getSnapshot:()=>w.read,subscribe(fn){w.listeners.add(fn);return()=>w.listeners.delete(fn)},close(){if(closed)throw Error('double close');closed=true;metrics.closes++;if(!--w.refs)watches.delete(key)}}}}}
client=makeClient();const root=createRoot(document.getElementById('root'));
function Peer(){const r=useQuery(api.messagePhoto,{id:'m0'},{keep:false});return <aside>{'data'in r?r.data?.text:'peer unavailable'}</aside>}
function Visibility(){const foreground=useForeground();return <span>{foreground?'foreground':'background'}</span>}
const render=()=>root.render(<StrictMode><Profiler id="screen" onRender={()=>window.commits.push({image:!!document.querySelector('img'),draft:document.querySelector('input')?.value})}><SnapbackProvider client={client}>{mode==='before'?<Before id={conversation}/>:mode==='after'?<After id={conversation}/>:mode==='visibility'?<Visibility/>:<BoundedConversation backend={backend} conversation={conversation} active={active}/>} {sibling&&<Peer/>}</SnapbackProvider></Profiler></StrictMode>);
const publish=()=>{for(const w of watches.values()){w.read=source(w.op,w.args);for(const fn of [...w.listeners])fn()}};
window.holdSend=()=>{hold=true};window.refuse=async()=>act(async()=>{hold=false;resolveSend({state:'failed',id:'refused',why:{code:'E_ADMISSION_STORE',message:'Admission refused',family:'client'}})});
window.start=async()=>act(async()=>render());
window.change=async values=>act(async()=>{if('active'in values)active=values.active;if('viewer'in values){viewer=values.viewer;for(const fn of viewers)fn(viewer)}if(values.backend)backend=values.backend;if(values.conversation)conversation=values.conversation;if('sibling'in values)sibling=values.sibling;if(values.mode)mode=values.mode;if(values.replaceClient)client=makeClient();render()});
window.publish=async values=>act(async()=>{if('cycle'in values)cycle=values.cycle;if('size'in values)batchSize=values.size;if('point'in values)pointRead=values.point;if('root'in values)rootRead=values.root;publish()});
window.coalesced=async()=>act(async()=>{rootRead={loading:true};publish();rootRead=ready(rows(0),'c1');publish()});
window.recheckOwners=(name='quotedMessage')=>watches.get(JSON.stringify([name,{id:'m0'},false]))?.refs??0;
window.counts=()=>({observations:watches.size,owners:[...watches.values()].reduce((n,w)=>n+w.refs,0),points:[...watches.values()].filter(w=>w.op.name==='quotedMessage'||w.op.name==='messagePhoto').length,rows:document.querySelectorAll('[id^="message-"]').length,history:[...watches.values()].filter(w=>w.op.name==='history').length,...metrics});
// Literal fixture programs keep the same photo ID through real device adoption.
// Only asset bytes and network replies are controlled; query owners/hooks/device are real.
const original=${readFileSync(join(root,'packages/snapback4/test/chat-schema.json'),'utf8')};
let generation=original.generation,realClient;
window.adoptions=[];
window.useDevice=async()=>act(async()=>{
 const literal=value=>value===null?{Literal:'Null'}:Array.isArray(value)?{Array:value.map(literal)}:typeof value==='object'?{Object:Object.fromEntries(Object.entries(value).map(([k,v])=>[k,literal(v)]))}:{Literal:typeof value==='string'?{String:value}:typeof value==='boolean'?{Bool:value}:{Int:value}};
 const programs=Object.values(api).filter(op=>op.kind==='query').map(op=>({name:op.name,kind:'Query',args:Object.fromEntries((op.name==='history'||op.name==='messageReceipts'?['conversation','c']:['receiptMember','conversationScreen','typingIn'].includes(op.name)?['conversation']:op.name==='messageAuthor'?['sender']:op.name==='messageReactions'?['message']:['id']).map(name=>[name,name==='c'?{Optional:'Cursor'}:{Ref:{table:'messages'}}])),body:[{Return:literal(op.name==='history'||op.name==='messageReceipts'?[message(0)]:source(op,{id:'m0'}).data)}]}));
 const device=webDevice({persist:memoryPersistence(),wasm:new Uint8Array(await(await fetch('/@fs${root}/packages/snapback4/src/wasm/snapback4_device_bg.wasm')).arrayBuffer())});
 realClient=await createLocalClient({url:'http://generation.test',persona:'alice',device:{async open(...args){const core=await device.open(...args);return {...core,async call(request,committed){const reply=await core.call(request);committed?.(reply);if(request.op==='adopt')window.adoptions.push(generation);return reply}}}},fetch:async(input,init)=>{
  const path=new URL(input).pathname;
  if(path==='/schema')return Response.json({...original,generation,programs:[...original.programs.filter(p=>!programs.some(q=>q.name===p.name)),...programs]});
  if(path==='/sync'){const request=JSON.parse(init.body);return Response.json({snapshot:request.from===0&&!request.stream,events:[],watermark:10,more:false,generation,store_id:'screen'})}
  if(path==='/changes')return new Promise((resolve,reject)=>init.signal.addEventListener('abort',()=>reject(new DOMException('aborted','AbortError')),{once:true}));
  if(path.startsWith('/q/')){const name=path.slice(3);return Response.json({...source({name},{id:'m0'}),next:null,seq:10,tables:[]})}
  throw Error(path);
 }});
 realClient.asset=client.asset;await realClient.sync();window.deviceReads=await Promise.all([realClient.query(api.history,{conversation:'r',c:null}),realClient.query(api.quotedMessage,{id:'m0'})]);client=realClient;mode='after';render();
});
window.adopt=async()=>{await act(async()=>{generation++;await realClient.sync()});};
window.finish=async()=>{await act(async()=>root.unmount());await realClient?.close();return {observations:watches.size,opens:metrics.opens,closes:metrics.closes,viewers:viewers.size}};
`);
 vite=await createBrowserServer({root:dir,configFile:false,logLevel:'error',server:{hmr:false,host:'127.0.0.1',port:0,fs:{allow:[root,dir]}},resolve:{alias:[
 ...['react','react/jsx-runtime','react/jsx-dev-runtime','react-dom/client'].map(name=>({find:new RegExp('^'+name+'$'),replacement:pkg.resolve(name)})),
 {find:'react-native',replacement:join(dir,'native.jsx')},{find:'../snapback/generated/api',replacement:join(dir,'api.js')},
 ...['./screens','./social','./Video','../ui/src/ReactionPicker','../ui/src/ChatListRow','../ui/src/MessageBubble','../ui/src/Composer','../ui/src/TypingIndicator','../ui/src/ChatSettingsForm','expo-router','expo-image-picker','@react-navigation/native'].map(find=>({find,replacement:join(dir,'pilot-ui.jsx')})),
 ...['local','web'].map(name=>({find:'snapback4/'+name,replacement:join(root,'packages/snapback4/dist/'+name+'.js')})),
 {find:'snapback4/client',replacement:join(root,'packages/snapback4/dist/client.js')},
 {find:'snapback4/react',replacement:join(root,'packages/snapback4/dist/react.js')},{find:'snapback4/contract',replacement:join(root,'packages/snapback4/dist/contract.js')}
 ]}});await vite.listen();
 browser=await chromium.launch({executablePath:chromiumExecutable(),headless:true,args:['--no-sandbox'],timeout:hangBudget()});
 const page=await browser.newPage();page.setDefaultTimeout(hangBudget());
 const errors=[];page.on('pageerror',e=>errors.push(e.message));
 await loadBrowserPage(t, page, vite.resolvedUrls.local[0]);await page.waitForFunction(()=>window.start);await page.evaluate(()=>window.start());
 return {page,errors,counts:()=>page.evaluate(()=>window.counts()),text:()=>page.locator('body').innerText()};
}

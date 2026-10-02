import React, {useLayoutEffect, useEffect, useRef} from 'react';
import {createRoot} from 'react-dom/client';
import {createApp} from 'snapback4/app';
import {localStorageSessionStore, keepSession} from 'snapback4/auth';
import {webDevice} from 'snapback4/web';
import {SnapbackProvider, useQuery, usePage} from 'snapback4/react';
import {WebDevice} from '/bg-wasm.js';
const q=name=>({kind:'query',name}), m=name=>({kind:'mutation',name});
const now=()=>performance.timeOrigin+performance.now();
let client, expected, trial={}, querySeq=0;
window.events=[];
window.allEvents=[];
const mark=(stage,detail={})=>{const event={stage,at:now(),...detail};window.events.push(event);window.allEvents.push(event);};
const wasmCall=WebDevice.prototype.call;
WebDevice.prototype.call=function(input){
  const request=JSON.parse(input),id=crypto.randomUUID();
  mark('wasm-start',{id,op:request.op,name:request.name});
  try{return wasmCall.call(this,input);}finally{mark('wasm-end',{id,op:request.op,name:request.name});}
};
const idbTransaction=IDBDatabase.prototype.transaction;
IDBDatabase.prototype.transaction=function(...args){
  const tx=idbTransaction.apply(this,args),id=crypto.randomUUID();
  const kind=this.name.includes('session')?'authority':'device';
  mark('idb-start',{id,kind,mode:tx.mode});
  tx.addEventListener('complete',()=>mark('idb-end',{id,kind,mode:tx.mode}));
  tx.addEventListener('abort',()=>mark('idb-abort',{id,kind,mode:tx.mode}));
  return tx;
};
const lockRequest=navigator.locks?.request.bind(navigator.locks);
if(lockRequest) navigator.locks.request=(name,options,callback)=>{
  const id=crypto.randomUUID(), body=typeof options==='function'?options:callback;
  mark('lock-request',{id});
  const acquired=lock=>{mark('lock-acquired',{id});return Promise.resolve(body(lock)).finally(()=>mark('lock-released',{id}));};
  return typeof options==='function'?lockRequest(name,acquired):lockRequest(name,options,acquired);
};
const fetchTrace=async(input,init)=>{
  const path=new URL(input).pathname,id=crypto.randomUUID();
  mark('request',{path,id});
  const response=await fetch(input,init);
  mark('headers',{path,id,status:response.status,timing:response.headers.get('server-timing')});
  if (!response.body || !['/changes','/sync','/q/','/m/'].some(p=>path.startsWith(p))) return response;
  let body='',bytes=0; const decoder=new TextDecoder();
  return new Response(response.body.pipeThrough(new TransformStream({
    transform(chunk,controller){bytes+=chunk.length;body+=decoder.decode(chunk,{stream:true});controller.enqueue(chunk);},
    flush(){let json;try{json=JSON.parse(body+decoder.decode());}catch{} mark('response',{path,id,bytes,seq:json?.seq,watermark:json?.watermark,tables:json?.tables,meter:json?.meter,denied:json?.denied});}
  })),{status:response.status,statusText:response.statusText,headers:response.headers});
};
function publish(read,stage){
  if (!read?.revalidating && read?.data?.some(x=>x.id===expected) && !trial[stage]) {trial[stage]=now();mark(stage);}
}
window.__bgTrace=(stage,detail)=>{
  if(stage==='raw-read'){if(detail.name==='history')publish(detail.read,'raw-published');}
  else mark(stage,detail);
};
const history=q('history'),decorations=q('decorations'),screen=q('conversationScreen'),member=q('receiptMember'),typing=q('typingIn');
function Screen(){
  const page=usePage(history,{conversation:'room'}),decs=usePage(decorations,{conversation:'room'});
  const chat=useQuery(screen,{conversation:'room'}),me=useQuery(member,{conversation:'room'}),t=useQuery(typing,{conversation:'room'});
  const reported=useRef(0), newest=Math.max(0,...page.items.map(x=>x.ordinal));
  useLayoutEffect(()=>publish(page.read,'reactCommit'));
  useEffect(()=>{
    if (!me.data || !newest || newest<=me.data.seenOrdinal || reported.current===newest) return;
    reported.current=newest; void client.mutate(m('seen'),{conversation:'room',through:newest});
  },[newest,me.data?.seenOrdinal]);
  return <main><h1>{chat.data?.title}</h1>{page.items.map(row=><div key={row.id} data-message={row.id}>{row.text}<small>{JSON.stringify(decs.items.find(x=>x.id===row.id))}</small></div>)}<span>{JSON.stringify(t.data)}</span></main>;
}
window.openClient=async({url,session,index})=>{
  const underlying=webDevice();
  const device={async open(...args){
    const core=await underlying.open(...args),call=core.call.bind(core);
    core.call=async(request,committed)=>{
      const {op,name}=request,id=++querySeq;
      mark('device-start',{op,name,id});
      // Non-search operations do not enter retained-search mode; request its existing meter envelope only.
      const result=await call(op==='query' ? {...request,search:true} : request,value=>{mark('device-commit',{op,name,id,touched:value.ok?.touched});committed?.(value);});
      mark('device-end',{op,name,id,touched:result.ok?.touched,watermark:request.page?.watermark,metered:result.ok?.metered,complete:result.ok?.complete,unknown:result.ok?.unknown,rows:Array.isArray(result.ok?.data)?result.ok.data.length:undefined});
      return result;
    };return core;
  }};
  const store=localStorageSessionStore();await keepSession(url,session,store);
  const app=createApp({url,sessionStore:store,device,fetch:fetchTrace,assets:{keep:'viewed',maxBytes:67108864}});
  await app.ready; console.log('BG app ready'); client=app.client; window.client=client;
  console.log('BG sync start'); await client.sync(); console.log('BG sync end');
  const watch=client.observe(history,{conversation:'room',c:null});
  watch.subscribe(()=>publish(watch.getSnapshot(),'published'));
  createRoot(document.getElementById('root')).render(<SnapbackProvider client={client}><Screen/></SnapbackProvider>);
};
window.prepare=value=>{expected=value;trial={};window.events=[];};
window.trial=()=>trial;
window.perform=async(value)=>{
  mark('sender-call');
  const write=await client.mutate(m('send'),{id:value,conversation:'room',text:value,quote:null});
  mark('sender-return',{state:write.state});
  if(write.state!=='sent')throw Error(JSON.stringify(write));
  return write;
};

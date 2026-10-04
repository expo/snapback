import React, {useLayoutEffect} from 'react';
import {createRoot} from 'react-dom/client';
import {createLocalClient} from 'snapback4/local';
import {webDevice} from 'snapback4/web';
import {SnapbackProvider, usePage} from 'snapback4/react';
import {inspect} from 'snapback4/inspection';
import {WebDevice} from 'snapback4/wasm/snapback4_device';
const q = name => ({kind:'query',name});
const home=q('home'),history=q('history'),reactions=q('reactionRows');
const now=()=>performance.timeOrigin+performance.now();
let client, expected, trial, sequence=0;
window.events=[];
const mark=(stage,detail={})=>window.events.push({stage,at:now(),...detail});
const rawCall=WebDevice.prototype.call;
WebDevice.prototype.call=function(input){
  const id=++sequence,{op,name}=JSON.parse(input);mark('wasm-start',{id,op,name});
  try{return rawCall.call(this,input);}finally{mark('wasm-end',{id,op,name});}
};
const transaction=IDBDatabase.prototype.transaction;
IDBDatabase.prototype.transaction=function(...args){
  const tx=transaction.apply(this,args),id=++sequence;mark('idb-start',{id,mode:tx.mode});
  tx.addEventListener('complete',()=>mark('idb-end',{id,mode:tx.mode}));
  tx.addEventListener('abort',()=>mark('idb-abort',{id}));return tx;
};
function matches(name, data) {
  if(!expected || name!==expected.query || !Array.isArray(data)) return false;
  return data.some(row=>name==='home' ? row.repost && row.post===expected.value : name==='history' ? row.id===expected.value : row.emoji===expected.value);
}
function Screen(){
  const h=usePage(home,{}),m=usePage(history,{room:'room'}),r=usePage(reactions,{message:'anchor'});
  useLayoutEffect(()=>{
    for(const [name,page] of [['home',h],['history',m],['reactionRows',r]]) {
      if(matches(name,page.items) && !trial.render) {trial.render=now();mark('render',{name});}
    }
    window.ready=true;
  });
  return <main><section id="home">{h.items.map(x=><p key={x.post+':'+x.repost+':'+x.actor}>{x.post}:{String(x.repost)}</p>)}</section><section id="history">{m.items.map(x=><p key={x.id}>{x.text}</p>)}</section><section id="reactions">{r.items.map(x=><p key={x.id}>{x.emoji}</p>)}</section></main>;
}
window.openClient=async({url,persona})=>{
  const underlying=webDevice();
  const device={async open(...args){
    const core=await underlying.open(...args),call=core.call.bind(core);
    core.call=async(request,committed)=>{
      const id=++sequence,{op,name}=request;
      mark('device-start',{id,op,name});
      const result=await call(request,value=>{mark('device-commit',{id,op,name});committed?.(value);});
      const match=matches(name,result.ok?.data);
      mark('device-end',{id,op,name,watermark:request.page?.watermark,match});
      if(match && !trial.evaluated) trial.evaluated=now();
      return result;
    };return core;
  }};
  client=await createLocalClient({url,persona,device,fetch:async(input,init)=>{
    const id=++sequence,path=new URL(input).pathname.replace(/^\/backend/,'');mark('request',{id,path});
    const response=await fetch(input,init);mark('headers',{id,path,status:response.status});
    if(!response.body || !['/changes','/sync','/q/','/m/'].some(p=>path.replace(/^\/backend/,'').startsWith(p))) return response;
    let body='';const decoder=new TextDecoder();
    return new Response(response.body.pipeThrough(new TransformStream({
      transform(chunk,controller){body+=decoder.decode(chunk,{stream:true});controller.enqueue(chunk);},
      flush(){let json;try{json=JSON.parse(body+decoder.decode());}catch{}if(path.startsWith('/q/')&&matches(path.slice(3),json?.data)&&!trial.evaluated){trial.evaluated=now();mark('server-evaluated',{name:path.slice(3)});}mark('response',{id,path,request:response.headers.get('x-lu-request'),seq:json?.seq,watermark:json?.watermark,tables:json?.tables,denied:json?.denied});}
    })),{status:response.status,statusText:response.statusText,headers:response.headers});
  }});
  window.client=client;await client.sync();
  for(const [op,args] of [[home,{c:null}],[history,{room:'room',c:null}],[reactions,{message:'anchor',c:null}]]) {
    const watch=client.observe(op,args);watch.subscribe(()=>{
      const read=watch.getSnapshot();
      if(matches(op.name,read.data) && !trial.published) {trial.published=now();mark('published',{name:op.name});}
    });
  }
  createRoot(document.getElementById('root')).render(<SnapbackProvider client={client}><Screen/></SnapbackProvider>);
};
window.prepare=value=>{expected=value;trial={};window.events=[];inspect(client);};
window.result=()=>({trial,events:window.events,inspection:inspect(client)});
window.perform=async({name,args})=>{
  mark('sender-call',{name});
  const result=await client.mutate({kind:'mutation',name},args);
  mark('sender-return',{state:result.state,seq:result.seq});
  if(result.state!=='sent') throw Error(JSON.stringify(result));
  return result;
};

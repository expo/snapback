// Uses LL's React publication and process-device bridge measurement pattern.
import React, { useLayoutEffect } from 'react';
import { createRoot } from 'react-dom/client';
import { createLocalClient } from 'snapback4/local';
import { webDevice } from 'snapback4/web';
import { SnapbackProvider, useQuery } from 'snapback4/react';
const query = {kind:'query',name:'reactionRows'}, args = {message:'anchor'};
let client, trial, expected;
const now = () => performance.now();
window.events = [];
function mark(stage, detail={}) { window.events.push({stage,at:now(),...detail}); }
function publication(read, stage) {
  mark(stage, {read});
  if (expected && read.data?.some(r=>r.emoji === expected)) trial[stage] ??= now();
}
function Screen() {
  const read=useQuery(query,args);
  useLayoutEffect(()=>publication(read,'render'));
  return <main>{JSON.stringify(read)}</main>;
}
function ProcessScreen({read}) {
  useLayoutEffect(()=>publication(read,'render'));
  return <main>{JSON.stringify(read)}</main>;
}
window.openClient=async ({url,session,tier})=>{
  if(tier==='process') {
    const root=createRoot(document.getElementById('root'));
    window.processRead=read=>{publication(read,'published');root.render(<ProcessScreen read={read}/>);};
    client={mutate:(op,args)=>window.processBridge({method:'mutate',op,args}),sync:()=>window.processBridge({method:'sync'})};
    await window.processBridge({method:'open',url,session});return;
  }
  const device=tier==='wasm'?webDevice():{async open(name,backend){
    await window.deviceBridge({method:'open',name,backend});
    return {call:request=>window.deviceBridge({method:'call',request}),close:()=>window.deviceBridge({method:'close'})};
  }};
  client=await createLocalClient({url,session,device,fetch:async(input,init)=>{
    const path=new URL(input).pathname; mark('request',{path});
    if(path.startsWith('/m/') && window.gate) await window.gate;
    const response=await fetch(input,init); mark('headers',{path,status:response.status}); return response;
  }});
  await client.sync();
  const watch=client.observe(query,args); watch.subscribe(()=>publication(watch.getSnapshot(),'published'));
  createRoot(document.getElementById('root')).render(<SnapbackProvider client={client}><Screen/></SnapbackProvider>);
};
window.perform=async ({value,allowed=true})=>{
  expected=value;trial={call:now()};window.events=[];
  const write=await client.mutate({kind:'mutation',name:'setReaction'},{...args,emoji:value,allowed});
  trial.returned=now();trial.state=write.state;mark('settled',{write});return write;
};
window.trial=()=>({...trial,events:window.events});
window.clear=async()=>{expected=null;const write=await client.mutate({kind:'mutation',name:'clearReaction'},args);await client.sync();return write;};
window.hold=()=>{window.gate=new Promise(r=>window.release=()=>{window.gate=null;r();});};

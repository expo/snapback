import React from 'react';
import { createRoot } from 'react-dom/client';
import { flushSync } from 'react-dom';
import { webDevice, memoryPersistence } from 'rv-sdk/web';
import { createLocalClient } from 'rv-sdk/local';
import { answerObservation } from 'rv-sdk/read-observation';
import { inspect } from 'rv-sdk/observation-work';
import { guardClient } from 'rv-sdk/app-client';
import { SnapbackProvider, useQuery, usePage } from 'rv-sdk/react';
const sleep = ms=>new Promise(r=>setTimeout(r,ms));
async function until(fn) { const end=Date.now()+20000;while(!fn()){if(Date.now()>end)throw Error('browser condition timed out');await sleep(5);} }
const op={kind:'query',name:'history'};
window.qualify=async url=>{
  let blocking=false,blocked=0,releases=[],phase='',loading=0,hookLatest={},commitAt=0;
  const evidence=[];
  const device=webDevice({persist:memoryPersistence()});
  const raw=await createLocalClient({url,persona:'bob',waitSeconds:25,device:{async open(...args){
    const core=await device.open(...args);
    return {...core,async call(request,committed){
      const reply=await core.call(request,committed);
      if(request.op==='apply'&&phase){commitAt=Date.now();evidence.push({op:'apply',preserved:reply.preserved});}
      if(request.op==='query'&&blocking){blocked++;await new Promise(resolve=>releases.push(resolve));}
      return reply;
    }};},},fetch:async (...args)=>{
      const response=await fetch(...args);
      if(String(args[0]).includes('/changes')&&phase)void response.clone().json().then(json=>evidence.push({op:'changes',preserved:json.preserved})).catch(()=>{});
      return response;
    }});
  const guarded=guardClient(raw,async()=>true,()=>true,()=>({code:'E_AUTH',family:'auth',message:'closed'}));
  const client=guarded.client;
  const watch=client.observe(op,{c:null,n:0});
  const rawWatch=raw.observe(op,{c:null,n:0});
  const competitors=Array.from({length:24},(_,n)=>client.observe(op,{c:null,n:n+1}));
  const note=(name,read)=>{hookLatest[name]=read;if(phase==='safe'&&read.loading)loading++;};
  watch.subscribe(()=>note('facade',watch.getSnapshot()));rawWatch.subscribe(()=>note('raw',rawWatch.getSnapshot()));
  function Screen(){
    const query=useQuery(op,{c:null,n:0});const page=usePage(op,{n:0});
    note('useQuery',query);note('usePage',page.read);
    return React.createElement('div',null,JSON.stringify({query,page:page.read}));
  }
  const root=createRoot(document.getElementById('root'));
  const render=()=>flushSync(()=>root.render(React.createElement(SnapbackProvider,{client},React.createElement(Screen))));
  const release=()=>{blocking=false;for(const done of releases.splice(0))done();};
  // Each phase starts with drained work; previous held competitors must not
  // occupy the local queue, whose existing budget intentionally excludes waiting.
  const drained=()=>{const p=inspect(raw).totals;return p.queued===0&&p.inFlight===0;};
  let serial=0;
  const post=async (path,body)=>(await fetch(url+path,{method:'POST',headers:{'x-snapback-persona':'alice'},body:JSON.stringify(body)})).json();
  const mutate=async name=>{const result=await post('/m/'+name,{id:'rv-'+serial++,args:name==='send'?{body:'busy-'+serial}:{}});if(result.state!=='sent')throw Error(JSON.stringify(result));return result;};
  const seed=()=>post('/seed',[{table:'members',row:{id:'bob',room:'room',principal:'dev:bob'}},{table:'messages',row:{id:'item',room:'room',body:'image-1',at:1}}]);
  try{
    await raw.sync();render();await until(()=>watch.getSnapshot().data?.length===1&&!watch.getSnapshot().revalidating&&hookLatest.usePage?.data);
    await until(()=>competitors.every(w=>w.getSnapshot().data&&!w.getSnapshot().revalidating)&&drained());
    const owned=answerObservation(rawWatch.getSnapshot());const dependency={tables:[...owned.tables],scopes:owned.scopes};
    phase='safe';blocking=true;const start=Date.now();
    await mutate('send');await until(()=>blocked>0&&watch.getSnapshot().revalidating);
    for(let n=0;n<8;n++){await mutate('receipt');await mutate('react');await mutate('send');}
    await sleep(Math.max(0,1500-(Date.now()-start)));render();
    const held=watch.getSnapshot();const safe={loading,revalidating:held.revalidating===true,heldMs:Date.now()-start,blockedReads:blocked,competitors:24,converged:false,
      hooks:Object.fromEntries(Object.entries(hookLatest).map(([k,r])=>[k,{loading:!!r.loading,revalidating:!!r.revalidating}]))};
    if(!held.data)throw Error('safe history withdrew: '+JSON.stringify({safe,dependency,evidence:evidence.slice(0,8)}));
    release();await until(()=>watch.getSnapshot().data?.length===10&&!watch.getSnapshot().revalidating);render();safe.converged=true;safe.loading=loading;
    const revocations=[];phase='';
    for(const name of ['erase','unsend','move','remove']){
      await seed();await raw.sync();await until(()=>watch.getSnapshot().data?.some(r=>r.id==='item')&&!watch.getSnapshot().revalidating&&drained());
      phase=name;blocking=true;const before=blocked;commitAt=0;
      const began=Date.now();await mutate(name);
      try { await until(()=>watch.getSnapshot().loading); }
      catch(error) { throw Error(JSON.stringify({phase,watch:watch.getSnapshot(),raw:rawWatch.getSnapshot(),blocked,commitAt,pressure:inspect(raw),evidence:evidence.slice(-12)})); }
      const elapsed=Date.now()-began;revocations.push({name,withdrawn:true,elapsed,afterDeviceCommit:commitAt?Date.now()-commitAt:null,startedReads:blocked-before});
      release();await raw.sync();await until(()=>!watch.getSnapshot().loading);phase='';
    }
    return {safe,revocations,evidence:evidence.slice(0,32)};
  }finally{release();flushSync(()=>root.unmount());watch.close();rawWatch.close();for(const w of competitors)w.close();guarded.fence()();await raw.close();}
};

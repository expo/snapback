import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtempSync,mkdirSync,readFileSync,writeFileSync,rmSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {createRequire} from 'node:module';
import {launch,root} from '../../../witness/lib.mjs';
import {hangBudget} from './helpers/wait.mjs';

// Mount the public hook under StrictMode; its controller journeys are exercised
// separately against online, wasm and native clients in following-history.
test('generated Following hook mounts independent consumers, preparing is not empty, and unmount releases only its consumer',{timeout:hangBudget(30)},async t=>{
  const dir=mkdtempSync(join(tmpdir(),'sb4-fh-react-'));mkdirSync(join(dir,'snapback'));
  writeFileSync(join(dir,'snapback/schema.q'),readFileSync(join(root,'crates/snapback4-lang/tests/fixtures/following-view.q'),'utf8'));
  t.after(()=>rmSync(dir,{recursive:true,force:true}));
  const req=createRequire(join(root,'packages/snapback4/package.json'));
  const fixture=await launch({sourceDir:join(dir,'snapback'),seed:[],entrySource:`
import {createElement as h,StrictMode,useState} from '${req.resolve('react')}';
import {createRoot} from '${req.resolve('react-dom/client')}';
import {SnapbackProvider,useFollowing} from '${join(root,'packages/snapback4/src/react.tsx')}';
import {createClient} from '${join(root,'packages/snapback4/src/client.ts')}';
window.boot=async(url)=>{
 const client=createClient({url,persona:'reader'}); window.client=client;
 const op={kind:'query',name:'cards',following:{declaration:'feed',pageSize:20,cursor:'c'}};
 window.phases=[];window.states={};
 function Feed({name}){const value=useFollowing(op,{c:null});window.states[name]=value;window.phases.push(value.phase);return h('div',{'data-feed':name},value.phase==='preparing'?'Preparing':value.items.map(i=>i.id).join(','));}
 function App(){const [first,setFirst]=useState(true);window.removeFirst=()=>setFirst(false);return h(SnapbackProvider,{client},first&&h(Feed,{name:'first'}),h(Feed,{name:'second'}));}
 const host=document.createElement('main');document.body.append(host);const root=createRoot(host);root.render(h(StrictMode,null,h(App)));window.finish=async()=>{root.unmount();await client.close();};
};`});t.after(()=>fixture.close());
  const mutate=async(name,args)=>{const r=await fetch(fixture.api+'/m/'+name,{method:'POST',headers:{'x-snapback-persona':'reader','content-type':'application/json'},body:JSON.stringify({args})}).then(r=>r.json());assert.equal(r.state,'sent',JSON.stringify(r))};
  for(let n=0;n<25;n++)await mutate('post',{postId:`own-${n}`,parentId:null});
  const errors=[];fixture.page.on('pageerror',e=>errors.push(String(e)));
  await fixture.page.evaluate(url=>window.boot(url),fixture.api);
  await fixture.page.waitForFunction(()=>Object.values(window.states).length===2&&Object.values(window.states).every(s=>s.phase==='page'&&s.items.length===20));
  assert.ok(await fixture.page.evaluate(()=>window.phases.includes('preparing')));
  await fixture.page.evaluate(()=>window.states.first.loadMore());
  await fixture.page.waitForFunction(()=>window.states.first.items.length===25);
  assert.equal(await fixture.page.evaluate(()=>window.states.second.items.length),20);
  await fixture.page.evaluate(()=>window.removeFirst());
  await fixture.page.waitForFunction(()=>document.querySelector('[data-feed=first]')===null);
  await fixture.page.evaluate(()=>window.states.second.loadMore());
  await fixture.page.waitForFunction(()=>window.states.second.items.length===25);
  await fixture.page.evaluate(()=>window.finish());assert.deepEqual(errors,[]);
});

// Drive the real controller with a transport that drops units while the client
// remains online (the same outcome as a pending fence discarding a reply).
test('dropped loadMore units use bounded jittered backoff, including observation wakeups',async t=>{
  const {Following}=await import('../dist/following.js');
  const {bindFollowing,notifyFollowing}=await import('../dist/following-transport.js');
  t.mock.timers.enable({apis:['setTimeout','Date']});
  t.mock.method(Math,'random',()=>0.5);
  const noop=()=>()=>{};
  const client={link:()=> 'online',observe:()=>({getSnapshot:()=>({data:[]}),subscribe:noop,close(){}}),onLink:noop,onPendingWrites:noop,onWrite:noop,onViewer:noop,onSession:noop};
  let fail=false, deny=false;
  const calls=[];
  bindFollowing(client,async(_op,_args,body)=>{
    if(body.action==='open')return{opening:'opening'};
    if(body.action==='cancel')return{phase:'restart'};
    if(body.action==='refresh')return{phase:'page',visible:body.mounted.filter(x=>!deny||x.authority[0]?.table!=='a').map(x=>x.id),
      live:body.mounted.length?[]:[{kind:'shaped',id:'first',at:'2',value:{id:'first'},authority:[{table:'a',id:'a',fields:['id']},{table:'b',id:'b',fields:['id']}]}]};
    calls.push({at:Date.now(),token:body.token});
    if(fail)return;
    const id=body.token?'second':'first';
    return{phase:'page',items:[{kind:'shaped',id,at:body.token?1:2,value:{id},authority:body.token?[]:[{table:'a',id:'a',fields:['id']},{table:'b',id:'b',fields:['id']}]}],next:body.token?null:'next'};
  });
  const history=new Following(client,{kind:'query',name:'cards',following:{declaration:'feed',pageSize:1}},{});
  const stop=history.subscribe(()=>{});t.after(stop);
  const tick=async ms=>{t.mock.timers.tick(ms);for(let n=0;n<30;n++)await Promise.resolve()};
  await tick(0);assert.equal(history.getSnapshot().items.length,1);
  fail=true;history.loadMore();await tick(0);
  for(let n=0;n<400;n++){notifyFollowing(client);await tick(50)}
  const failed=calls.slice(1);
  assert.ok(failed.length>=6&&failed.length<=12,`bounded retries: ${JSON.stringify(failed)}`);
  for(let n=1;n<failed.length;n++){
    const gap=failed[n].at-failed[n-1].at;
    assert.ok(gap>=50&&gap<=5050,`backoff gap ${gap}`);
    assert.equal(failed[n].token,'next');
  }
  fail=false;await tick(5000);
  assert.deepEqual(history.getSnapshot().items.map(x=>x.id),['first','second']);
  deny=true;await tick(1000);
  assert.deepEqual(history.getSnapshot().items.map(x=>x.id),['second'],'a denied fragment cannot be resurrected by the same-cycle live preview');
});

for(const padding of ['', 'x'.repeat(65000)])test(`changing live windows obey the ${padding?'encoded argument':'100 identity'} preview bound`,async t=>{
  const {Following}=await import('../dist/following.js');
  const {bindFollowing}=await import('../dist/following-transport.js');
  t.mock.timers.enable({apis:['setTimeout','Date']});
  const noop=()=>()=>{};
  const client={link:()=> 'online',observe:()=>({getSnapshot:()=>({data:[]}),subscribe:noop,close(){}}),onLink:noop,onPendingWrites:noop,onWrite:noop,onViewer:noop,onSession:noop};
  let slices=0;
  bindFollowing(client,async(_op,args,body)=>{
    assert.ok(Buffer.byteLength(JSON.stringify({...body,args}))<=65536,'every dispatched refresh fits the complete envelope');
    if(body.action==='open')return{opening:'opening'};
    if(body.action==='unit')return{phase:'page',items:[],next:null};
    if(body.action==='cancel')return{phase:'restart'};
    const start=40*slices++;
    return{phase:'preparing',visible:[],live:Array.from({length:40},(_,n)=>{
      const id=String(start+n).padStart(100,'0');return{kind:'shaped',id,at:String(start+n),value:{id},authority:[]};
    })};
  });
  const history=new Following(client,{kind:'query',name:'cards',following:{declaration:'feed',pageSize:40}},{padding});
  t.after(history.subscribe(()=>{}));
  t.mock.timers.tick(0);for(let n=0;n<50;n++)await Promise.resolve();
  const state=history.getSnapshot();assert.equal(state.phase,'page');
  assert.equal(slices,padding?1:3);assert.equal(state.items.length,padding?40:100);
  assert.equal(new Set(state.items.map(x=>x.id)).size,state.items.length);
});

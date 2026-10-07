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

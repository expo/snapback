import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtempSync,mkdirSync,writeFileSync,readFileSync,rmSync,statSync} from 'node:fs';
import {join,resolve} from 'node:path';
import {tmpdir} from 'node:os';
import {pathToFileURL} from 'node:url';
import {deploy,startServe,serveCheck,snapshotAll,cli,withBrowser,waitForFresh,exhaustPages,provisionAccounts} from '../dist/proof.js';
import {signup,login} from '../dist/auth.js';
import {createClient} from '../dist/client.js';
import {matchRead} from '../dist/contract.js';
import {chromiumExecutable} from '../../../witness/lib.mjs';
const root=resolve(import.meta.dirname,'../../..'), env={SNAPBACK4_BIN:join(root,'target/debug/snapback4')};
const schema=readFileSync(join(root,'crates/snapback4-lang/src/guide/staging.md'),'utf8').match(/```quarry\n([\s\S]*?)```/)[1];
function scratch(t){const dir=mkdtempSync(join(tmpdir(),'dx15-'));t.after(()=>rmSync(dir,{recursive:true,force:true}));return dir;}
async function project(t,source=schema){const cwd=scratch(t);mkdirSync(join(cwd,'snapback'));writeFileSync(join(cwd,'snapback/schema.q'),source);await deploy('production','snapback',{cwd,env});return cwd;}
const module=pathToFileURL(join(root,'packages/snapback4/dist/proof.js')).href;
for(const then of ['command','callback'])test(`wave31 048 Codex + 006 Muse: quick ${then} still observes upMs`,{skip:process.platform==='win32'},async t=>{
 const cwd=await project(t);
 writeFileSync(join(cwd,'package.json'),JSON.stringify({type:'module',scripts:{'prod:serve':'node serve.mjs'}}));
 writeFileSync(join(cwd,'serve.mjs'),`import {startServe,serveUntilSignal} from ${JSON.stringify(module)};const host=await startServe('production');console.log(JSON.stringify({backendUrl:host.url}));await serveUntilSignal([host]);`);
 const report=await serveCheck({cwd,env,deployment:'production',upMs:500,then:then==='command'?'true':async()=>{},timeoutMs:10000});
 assert.equal(report.ok,true,JSON.stringify(report));assert.ok(report.upMs>=500,JSON.stringify(report));assert.equal(report.lockReleased,true);
 // The same short business proof must detect a script that exits inside upMs.
 writeFileSync(join(cwd,'serve.mjs'),`console.log('{}');setTimeout(()=>process.exit(0),100);`);
 const early=await serveCheck({cwd,env,deployment:'production',upMs:700,then:then==='command'?'true':async()=>{}});
 assert.equal(early.ok,false);assert.ok(early.failures.some(f=>f.code==='E_SERVE_EARLY_EXIT'),JSON.stringify(early));
});
test('wave31 042: changed roster names supplied/pinned plans and performs no auth requests',async t=>{
 const cwd=await project(t),plan={roles:{admin:1,member:1},provision:{name:'provision'}};
 let first;
 for(let n=0;n<2;n++){
  const host=await startServe('production',{cwd,env,provisionUsers:plan});
  try{const ids=Object.values(host.sessions).flat().map(a=>a.principal);if(first)assert.deepEqual(ids,first);else first=ids;
   let requests=0;const original=globalThis.fetch;t.mock.method(globalThis,'fetch',(...args)=>{requests++;return original(...args);});
   await assert.rejects(host.provisionAccounts({...plan,roles:{admin:2}}),error=>{assert.match(error.message,/supplied plan.*admin.*2.*pinned plan.*admin.*1.*member/);assert.ok(!error.message.includes('password'));return true;});
   assert.equal(requests,0);t.mock.restoreAll();
  }finally{await host.stop();}
 }
 const rows=await snapshotAll('roles',{cwd,env,release:'production'});assert.equal(rows.length,2);
 assert.equal(statSync(join(cwd,'production/proof-accounts/default.json')).mode&0o777,0o600);
});
test('wave31 042 admin: >50 rows, --all/snapshotAll and generated client.query.next',async t=>{
 const source=`use identity guests\ntable things:\n  title: text 1..80\n  cap 200\n  public 'guest rows'\n  insert <- true\n  online only\nmutation add(title: text 1..80):\n  return insert things {title}\nquery list(c: cursor ?):\n  return things first 20 by .id after c\n`;
 const cwd=await project(t,source);assert.equal((await cli(["check"],{cwd,env})).code,0);const host=await startServe('production',{cwd,env});
 try{
  const session=(await (await fetch(host.url+'/auth/guest',{method:'POST',headers:{'content-type':'application/json'},body:'{}'})).json()).session;
  const api=await import(pathToFileURL(join(cwd,'snapback/generated/api.ts')).href);
  const client=createClient({url:host.url,session});
  try{
   for(let n=0;n<63;n++)assert.equal((await client.mutate(api.api.add,{title:`row ${n}`})).state,'sent');
   const read=await client.query(api.api.list,{c:null});assert.equal(typeof read.next,'string');assert.equal(read.data.length,20);
   const all=await exhaustPages(c=>client.query(api.api.list,{c}));assert.equal(all.length,63);assert.equal(new Set(all.map(r=>r.id)).size,63);
  }finally{await client.close();}
  const limited=await cli(['data','things','--release','production','--json'],{cwd,env});assert.equal(JSON.parse(limited.stdout).rows.length,50);assert.match(limited.stderr,/data things --all/);
  const all=await snapshotAll('things',{cwd,env,release:'production'});assert.equal(all.length,63);
  const conflict=await cli(['data','things','--all','--limit','2','--release','production'],{cwd,env});assert.notEqual(conflict.code,0);
  await assert.rejects(snapshotAll('unknown',{cwd,env,release:'production'}),/E_PROOF_SNAPSHOT/);
 }finally{await host.stop();}
});
test('wave31 023: observe stable button before trigger, retain transient visible text',async()=>{
 await withBrowser({executablePath:chromiumExecutable()},async context=>{
  const page=await context.newPage();await page.setContent('<button data-testid="save">Save</button>');
  const button=page.getByTestId('save');
  const value=await waitForFresh(button,'Save',{timeoutMs:3000,trigger:async()=>{
   await button.evaluate(e=>{e.textContent='Saving…';setTimeout(()=>{e.textContent='Save';},10);});
   await page.waitForTimeout(80);
  }});
  assert.equal(value,'Saving…');assert.equal(await button.textContent(),'Save');
  await page.setContent('<div data-testid="status">Save<span hidden>HIDDEN</span></div>');
  await assert.rejects(waitForFresh(page.getByTestId('status'),'Save',{timeoutMs:150,trigger:()=>page.locator('span').evaluate(e=>{e.textContent='OTHER HIDDEN';})}),/no fresh signal/);
  await assert.rejects(waitForFresh(page.getByTestId('status'),'Save',{trigger:()=>{throw Error('trigger failed');}}),/trigger failed/);
  await page.setContent('<div id="host"></div>');
  await page.locator('#host').evaluate(host=>{host.attachShadow({mode:'open'}).innerHTML='<button data-testid="shadow">Save</button>';});
  const shadow=page.getByTestId('shadow');
  assert.equal(await waitForFresh(shadow,'Save',{trigger:()=>shadow.evaluate(e=>{e.textContent='Saved';}),timeoutMs:1000}),'Saved');
  // Observe a stable host whose existing shadow tree gains a nested component.
  await page.setContent('<div data-testid="outer"></div>');
  const outer=page.getByTestId('outer');
  await outer.evaluate(e=>{e.attachShadow({mode:'open'}).innerHTML='<span>Save</span>';});
  assert.equal(await waitForFresh(outer,'Save',{timeoutMs:1000,trigger:async()=>{
   await outer.evaluate(e=>{const nested=document.createElement('div');nested.attachShadow({mode:'open'}).innerHTML='<span>Save</span>';e.shadowRoot.replaceChildren(nested);});
   await new Promise(resolve=>setTimeout(resolve,50));
   await outer.evaluate(e=>{e.shadowRoot.firstChild.shadowRoot.firstChild.textContent='Saved';});
  }}),'Saved');
  await page.setContent('<b>same</b><b>same</b>');await assert.rejects(waitForFresh(page.locator('b'),'same',{trigger:()=>{}}),/strict mode violation/);
 });
});
test('wave31 006 RATE: duplicate signup preserves delivered refusal and login recovers',async t=>{
 const cwd=await project(t),host=await startServe('production',{cwd,env});
 try{
  const email='same@example.test',password='long-enough-password';
  const first=await signup(host.url,email,password);assert.equal(first.ok,true,JSON.stringify(first));
  const second=await signup(host.url,email,password);assert.equal(second.ok,false);assert.equal(second.why.code,'E_AUTH');assert.equal(second.why.message,'that email already has an account; sign in instead');
  const again=await login(host.url,email,password);assert.equal(again.ok,true);assert.equal(again.session.principal,first.session.principal);
 }finally{await host.stop();}
});
test('wave31 047: guide reads empty-list recipe renders absent and keeps partial empty separate',()=>{
 const card=readFileSync(join(root,'crates/snapback4-lang/src/guide/reads.rs'),'utf8');assert.match(card,/absent: \(\) => "No rows"/);
 const handlers={loading:()=> 'Loading…',denied:why=>why.message,absent:()=> 'No rows',partial:()=> 'Results may be incomplete',present:rows=>rows.map(row=>row.title).join(', ')};
 assert.equal(matchRead({data:[],existence:'absent',complete:true,cut:null,fresh:true},handlers),'No rows');
 assert.equal(matchRead({data:[],existence:'partial',complete:false,cut:null,fresh:true},handlers),'Results may be incomplete');
});

test('wave31 006 RATE: 429 then a lost applied signup returns a stable why and never resubmits',async()=>{
 let calls=0,created=false;
 const fetcher=async(url)=>{
  if(url.endsWith('/auth/login'))return Response.json({session:{principal:'user:created',kind:'user',token:'private',expiresAt:Date.now()+60000}});
  calls++;
  if(calls===1)return Response.json({denied:{code:'E_RATE_LIMIT',family:'auth',message:'wait',retryAfterMs:1,retryable:true}},{status:429});
  created=true;throw Error('reply lost after account creation');
 };
 const result=await signup('http://example','same@example.test','password',{timeoutMs:1000},fetcher);
 assert.equal(created,true);assert.equal(calls,2);assert.equal(result.ok,false);
 assert.equal(result.why.code,'E_OFFLINE');assert.match(result.why.message,/signup outcome is unknown.*login/);assert.equal(result.why.rewrite,'await login(url, email, password)');
 assert.equal((await login('http://example','same@example.test','password',{},fetcher)).ok,true);assert.equal(calls,2);
 const malformed=await signup('http://example','a','b',{},async()=>Response.json({ok:false}));
 assert.equal(malformed.ok,false);assert.equal(malformed.why.code,'E_HTTP_RESPONSE');assert.match(malformed.why.message,/login/);
});

test('DX15 review: users-only plans never echo unvalidated provision fields',async t=>{
 const cwd=scratch(t);mkdirSync(join(cwd,'proof-accounts'));
 writeFileSync(join(cwd,'proof-accounts/default.json'),JSON.stringify({version:1,plan:JSON.stringify({users:1,roles:[],provision:{secret:'PRIVATE-PINNED-SENTINEL'},service:'operator'}),entries:[]}),{mode:0o600});
 const host={url:'http://example',deploymentDir:cwd,operatorToken:async()=>''};
 await assert.rejects(provisionAccounts(host,{users:2}),error=>{assert.match(error.message,/E_PRODUCTION_ROSTER/);assert.ok(!error.message.includes('PRIVATE-PINNED-SENTINEL'));return true;});
 await assert.rejects(provisionAccounts(host,{users:2,provision:{name:{secret:'PRIVATE-SUPPLIED-SENTINEL'}}}),error=>{assert.match(error.message,/E_STAGING_INPUT/);assert.ok(!error.message.includes('PRIVATE-SUPPLIED-SENTINEL'));return true;});
});

test('DX15 review: fresh-text cleanup is bounded when the page event loop blocks',async()=>{
 await withBrowser({executablePath:chromiumExecutable()},async context=>{
  const page=await context.newPage();await page.setContent('<button>Save</button>');
  const start=performance.now();
  await assert.rejects(waitForFresh(page.locator('button'),'Save',{timeoutMs:100,trigger:async()=>{
   void page.evaluate(()=>{const end=performance.now()+4000;while(performance.now()<end){};}).catch(()=>{});
   await new Promise(resolve=>setTimeout(resolve,30));await new Promise(()=>{});
  }}),/fresh-text trigger/);
  assert.ok(performance.now()-start<3000,'blocked page must not turn a trigger deadline into an unbounded cleanup');
 });
});

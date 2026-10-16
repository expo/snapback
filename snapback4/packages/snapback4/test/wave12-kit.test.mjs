import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, readFileSync, readdirSync, writeFileSync, symlinkSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawnSync } from 'node:child_process';
import { chromium } from 'playwright-core';
import { listenerSnapshot } from '../../../scripts/proof-listener-audit.mjs';
const root = fileURLToPath(new URL('../../../', import.meta.url));
const baseline = process.env.KIT_BASELINE;
const bin = baseline ? '/tmp/kit-baseline/snapback4' : join(root, 'target/debug/snapback4');
const kit = await import(baseline ? '/tmp/kit-baseline/proof.mjs' : '../dist/proof.js');
const source = `use identity guests\ntable notes:\n  title: text <=80\n  public 'proof notes'\n  insert <- allow\n  online only\nquery mine():\n  return notes first 20 by .id\nmutation add(title: text <=80):\n  return insert notes { title }\n`;
const fixture = t => { const dir = mkdtempSync(join(root, 'target/kit12-')); t.after(()=>rmSync(dir,{recursive:true,force:true})); return dir; };
const invoke = (cwd, args, env={}) => spawnSync(bin,args,{cwd,encoding:'utf8',timeout:120000,env:{...process.env,PORT_LO:undefined,PORT_HI:undefined,SNAPBACK4_BIN:bin,...env}});
const okay = r => assert.equal(r.status,0,r.stdout+r.stderr);
const windowReceipt = page => kit.bounded(page.evaluate(()=>window.__snapback4Witness.formResult()),1000,"fresh receipt");
const snapshot = dir => Object.fromEntries(readdirSync(dir,{recursive:true,withFileTypes:true}).filter(e=>e.isFile()).map(e=>{const path=join(e.parentPath,e.name);return[path,readFileSync(path).toString('base64')]}));

test('H8 custom-schema generated proof refuses success without a write', {timeout:120000}, async t=>{
  const cwd=fixture(t);mkdirSync(join(cwd,'snapback'));writeFileSync(join(cwd,'snapback/schema.q'),source);
  okay(invoke(cwd,['init','--web']));symlinkSync(join(root,'node_modules'),join(cwd,'node_modules'));
  okay(invoke(cwd,['check']));
  okay(spawnSync(join(root,'node_modules/.bin/vite'),['build'],{cwd,encoding:'utf8',timeout:120000}));
  const result=spawnSync(process.execPath,['scripts/frontend-proof.mjs'],{cwd,encoding:'utf8',timeout:60000,env:{...process.env,SNAPBACK4_BIN:bin}});
  assert.notEqual(result.status,0,'a read-only Home cannot pass a write proof');
  assert.match(result.stderr,/no write scenario: replace the Home assertions/);
});

test('H8 withBrowser honors caller Playwright', {timeout:30000}, async t=>{
  const saved=[process.env.PORT_LO,process.env.PORT_HI];
  process.env.PORT_LO='29130';process.env.PORT_HI='29139';
  t.after(()=>{for(const [i,key] of ['PORT_LO','PORT_HI'].entries()){if(saved[i]===undefined)delete process.env[key];else process.env[key]=saved[i]}});
  let calls=0;
  const caller={launch: (...args)=>{calls++;return chromium.launch(...args)}};
  await kit.withBrowser({chromium:caller,executablePath:process.env.CHROME,args:["--no-sandbox"]},async context=>{
    const page=await context.newPage();await page.setContent('<p>proof</p>');
    assert.equal(await page.textContent('p'),'proof');
  });
  assert.equal(calls,1,'caller owns Playwright objects');
});

test('H8 withBrowser opens no TCP listener', {
  skip: process.platform !== 'linux' && 'Listener snapshot requires Linux /proc; caller Playwright still runs on this host',
  timeout: 30000,
}, async () => {
  await kit.withBrowser({chromium,executablePath:process.env.CHROME,args:['--no-sandbox']},async context=>{
    const page=await context.newPage();await page.setContent('<p>proof</p>');
    assert.deepEqual(listenerSnapshot(),[], 'browser proof must have no TCP listener');
  });
});

test('H8 witness claims the trusted button form submit, preserving canonical null arguments', {timeout:30000}, async t=>{
  const cwd=fixture(t);mkdirSync(join(cwd,'dist'));
  const bridge=baseline ? '/tmp/kit-baseline/witness-web.mjs' : join(root,'packages/snapback4/dist/witness-web.js');
  writeFileSync(join(cwd,'dist/bridge.js'),readFileSync(bridge));
  writeFileSync(join(cwd,'dist/index.html'),`<form><button type="submit">Save</button></form><script type="module">
import {registerWebWitness} from './bridge.js';
const op={kind:'mutation',name:'save'},client={viewer:()=> 'dev:alice',onWrite:()=>()=>{},mutate:async()=>({state:'sent',id:'submitted',seq:1})};
const app={client,ready:Promise.resolve(),mutate:async(...a)=>{await Promise.resolve();return client.mutate(...a)}};
registerWebWitness(app,{save:op});document.querySelector('form').onsubmit=e=>{e.preventDefault();void app.mutate(op,{optional:null,title:'new'})};</script>`);
  const web=await kit.startStatic('dist',{cwd});
  try { await kit.withBrowser({executablePath:process.env.CHROME},async context=>{
    const page=await context.newPage();await page.goto(web.url+'/?witness=web');
    const button=page.getByRole('button',{name:'Save'});
    await button.evaluate(e=>window.__snapback4Witness.beginForm('save',{title:'new',optional:null},e));
    await button.click();
    const result=await kit.bounded(page.evaluate(()=>window.__snapback4Witness.formResult()),1000,'onSubmit receipt');
    assert.equal(result.state,'sent'); assert.equal(result.id,'submitted');
    // Same-document routers may drop the query; the registered app keeps its arm.
    await page.evaluate(()=>history.pushState({},'', '/profile'));
    await button.evaluate(e=>window.__snapback4Witness.beginForm('save',null,e));
    await button.click();
    assert.equal((await kit.bounded(page.evaluate(()=>window.__snapback4Witness.formResult()),1000,'routed receipt')).state,'sent');
    // Proof-owned contexts automatically arm each document.
    await page.goto(web.url);await button.waitFor();
    await button.evaluate(e=>window.__snapback4Witness.beginForm('save',null,e));
    await button.click();
    assert.equal((await windowReceipt(page)).state,'sent');
  });
    // Bare Playwright still requires an explicit flag; production pages are not armed.
    const browser=await chromium.launch({executablePath:process.env.CHROME,args:['--no-sandbox']});
    try {
      const page=await browser.newPage();await page.goto(web.url);
      const button=page.getByRole('button',{name:'Save'});await button.waitFor();
      await assert.rejects(button.evaluate(e=>window.__snapback4Witness.beginForm('save',null,e)),/E_WITNESS_DISABLED/);
    } finally {await browser.close();}
  } finally { await web.stop(); }
});

if (!baseline) {
 test('init preserves package identity, reports current range, and adapt is read-only by default', t=>{
  for(const platform of ['--web','--expo']){
   const cwd=fixture(t);writeFileSync(join(cwd,'package.json'),'{"name":"my-product","version":"7.2.1"}');
   const result=invoke(cwd,['init',platform],{PORT_LO:'29120',PORT_HI:'29129'});okay(result);
   const pkg=JSON.parse(readFileSync(join(cwd,'package.json')));
   assert.equal(pkg.name,'my-product');assert.equal(pkg.version,'7.2.1');
   assert.match(result.stdout,/http:\/\/127.0.0.1:29120/);assert.match(result.stdout,/localhost:29121/);
   assert.equal(result.stdout.trim().split('\n').at(-1),'\x1b[1mnpm install\x1b[0m');
   assert.equal(pkg.scripts['day2:proof'],'node scripts/day2-proof.mjs versions/v1.q versions/v2.q');
   assert.equal(readFileSync(join(cwd,'versions/v1.q'),'utf8'),readFileSync(join(cwd,'snapback/schema.q'),'utf8'));
   writeFileSync(join(cwd,'snapback/schema.q'),source);
   const before=snapshot(cwd),preview=invoke(cwd,['init','--adapt']);okay(preview);
   assert.deepEqual(snapshot(cwd),before);assert.equal(preview.stdout.trim().split('\n').at(-1),'snapback4 init --adapt --apply');
   assert.match(preview.stdout,/no write scenario: replace the Home assertions/);
   okay(invoke(cwd,['init','--adapt','--apply']));
  }
 });
 test('proof.cli runs JS wrapper verbs',async t=>{
  const cwd=fixture(t);mkdirSync(join(cwd,'dist'));writeFileSync(join(cwd,'dist/index.html'),'<html><body>shell</body></html>');
  const result=await kit.cli(['web-shell','dist'],{cwd});assert.equal(result.code,0,result.stderr);assert.ok(readdirSync(join(cwd,'dist')).length>1);
 });
 test('rendered evidence excludes textareas and scopes freshness; frontPage activates',async()=>{
  await kit.withBrowser({executablePath:process.env.CHROME},async context=>{
   const page=await context.newPage();await page.setContent('<textarea>new</textarea><div id="rows"><p>old</p></div><p>new</p>');
   assert.equal(await kit.renderedText(page,'new',{within:page.locator('#rows')}).count(),0);
   assert.equal(await kit.renderedText(page,'new').count(),1);
   const fresh=kit.waitForFresh(page.locator('p'),'old',{within:page.locator('#rows'),timeoutMs:1000});
   await page.locator('#rows p').evaluate(e=>e.textContent='changed');assert.equal(await fresh,'changed');
   assert.equal(await kit.frontPage(page),page);
  });
  assert.equal(kit.logsDir({cwd:'/example/app'}),'/example/app/logs');
 });
}

if (!baseline) test('unclaimable events, operations and arguments settle with reasons; pending is never terminal', async t=>{
 const {registerWebWitness}=await import('../dist/witness-web.js');
 const oldWindow=Object.getOwnPropertyDescriptor(globalThis,'window'),oldDoc=Object.getOwnPropertyDescriptor(globalThis,'document');
 const events=new Map(), button={};
 const window={location:{search:'?witness=web'}};
 Object.defineProperty(globalThis,'window',{configurable:true,value:window});
 Object.defineProperty(globalThis,'document',{configurable:true,value:{addEventListener:(type,fn)=>events.set(type,fn),removeEventListener:type=>events.delete(type)}});
 t.after(()=>{if(oldWindow)Object.defineProperty(globalThis,'window',oldWindow);else delete globalThis.window;if(oldDoc)Object.defineProperty(globalThis,'document',oldDoc);else delete globalThis.document});
 const op={kind:'mutation',name:'save'}, other={kind:'mutation',name:'other'};
 let calls=0;
 const listeners=new Set();
 const client={viewer:()=> 'dev:a',onWrite:fn=>{listeners.add(fn);return()=>listeners.delete(fn)},mutate:async()=>{calls++;return{state:'sent',id:'write',seq:1}}};
 const app={client,ready:Promise.resolve(),mutate:(...args)=>client.mutate(...args)};
 registerWebWitness(app,{save:op,other});
 for(const reason of ['event','operation','arguments']){
  window.__snapback4Witness.beginForm('save',{x:null},button);
  const click={isTrusted:true,composedPath:()=>[button]};window.event=click;
  if(reason!=='event')events.get('click')(click);
  await app.mutate(reason==='operation'?other:op,reason==='arguments'?{}:{x:null});
  const result=await window.__snapback4Witness.formResult();assert.equal(result.why.code,'E_WITNESS_UNCLAIMED');assert.match(result.why.message,new RegExp(reason));
 }
 assert.equal(calls,3,'failed proof instrumentation preserves real application writes');
 client.mutate=async()=>{for(const fn of listeners)fn({state:'pending',id:'later'});return{state:'pending',id:'later'}};
 window.__snapback4Witness.beginForm('save',null,button);
 const click={isTrusted:true,composedPath:()=>[button]};window.event=click;events.get('click')(click);
 await app.mutate(op,{});let settled=false;window.__snapback4Witness.formResult().then(()=>settled=true);await Promise.resolve();assert.equal(settled,false);
 for(const fn of listeners)fn({state:'pending',id:'later'});await Promise.resolve();assert.equal(settled,false,'late custody notification is not terminal');
 for(const fn of listeners)fn({state:'sent',id:'later',seq:2});assert.equal((await window.__snapback4Witness.formResult()).state,'sent');assert.equal(listeners.size,0);
});

if (!baseline) test('day2 caller source arguments override npm defaults and malformed argument lists refuse', t=>{
 const cwd=fixture(t);okay(invoke(cwd,['init','--web']));symlinkSync(join(root,'node_modules'),join(cwd,'node_modules'));
 for(const args of [['versions/v1.q','versions/v2.q','versions/v1.q','missing.q'],['versions/v1.q','versions/v2.q','extra.q']]){
  const result=spawnSync(process.execPath,['scripts/day2-proof.mjs',...args],{cwd,encoding:'utf8',timeout:5000});
  assert.notEqual(result.status,0);assert.match(result.stderr,/missing.q|usage: npm run day2:proof/);
 }
});

if (!baseline) test('adapt migrates recognized legacy literal scripts/config and preserves explicit defaults',t=>{
 const cwd=fixture(t);okay(invoke(cwd,['init','--web','--port','4517','--web-port','4600']));
 const pkg=JSON.parse(readFileSync(join(cwd,'package.json')));
 pkg.scripts.backend='snapback4 dev --port 4517';pkg.scripts.dev='vite --port 4600 --strictPort';pkg.scripts.preview='vite preview --port 4600 --strictPort';
 writeFileSync(join(cwd,'package.json'),JSON.stringify(pkg));rmSync(join(cwd,'scripts/launch.mjs'));
 // Exact Vite bytes from the pre-runtime template, with its supported explicit ports.
 const old=readFileSync(join(root,'crates/snapback4/src/verbs/init/starter/web/vite.config.mts'),'utf8').replaceAll('5173','4600').replaceAll('4173','4600');
 writeFileSync(join(cwd,'vite.config.mts'),old);
 const before=snapshot(cwd);okay(invoke(cwd,['init','--adapt']));assert.deepEqual(snapshot(cwd),before);
 okay(invoke(cwd,['init','--adapt','--apply']));
 const next=JSON.parse(readFileSync(join(cwd,'package.json')));assert.equal(next.scripts.dev,'node scripts/launch.mjs vite');assert.equal(next.scripts.backend,'node scripts/launch.mjs backend');
 const launch=readFileSync(join(cwd,'scripts/launch.mjs'),'utf8');assert.match(launch,/null \? 4517 : low/);assert.match(launch,/null \? 4600 : low/);
 assert.match(readFileSync(join(cwd,'vite.config.mts'),'utf8'),/const proofRange/);
});

if (!baseline) test('single-port ranges remain valid for schema-only init; UI init refuses before writes',t=>{
 const schemaOnly=fixture(t);okay(invoke(schemaOnly,['init'],{PORT_LO:'65535',PORT_HI:'65535'}));
 const ui=fixture(t);const result=invoke(ui,['init','--web'],{PORT_LO:'65535',PORT_HI:'65535'});assert.equal(result.status,2);assert.match(result.stderr,/at least two runtime ports/);assert.deepEqual(readdirSync(ui),[]);
});

if (!baseline) test('native window aliases without a browser location do not install a web witness',async t=>{
 const {registerWebWitness}=await import('../dist/witness-web.js');
 const saved=Object.getOwnPropertyDescriptor(globalThis,'window');
 const nativeWindow={};Object.defineProperty(globalThis,'window',{configurable:true,value:nativeWindow});
 t.after(()=>{if(saved)Object.defineProperty(globalThis,'window',saved);else delete globalThis.window});
 assert.doesNotThrow(()=>registerWebWitness({},{}));assert.equal(nativeWindow.__snapback4Witness,undefined);
});

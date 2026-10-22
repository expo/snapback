// H9 controls can load the unchanged 0.4.29 proof/witness modules via KIT2_BASELINE_DIST.
import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync, readFileSync, writeFileSync, mkdirSync, readdirSync, statSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { execFileSync } from 'node:child_process';
import { pathToFileURL } from 'node:url';
import { chromiumExecutable } from '../../../witness/lib.mjs';
const dist = process.env.KIT2_BASELINE_DIST ?? resolve(import.meta.dirname, '../dist');
const kit = await import(pathToFileURL(join(dist, 'proof.js')));
const witnessSource = readFileSync(join(dist, 'witness-web.js'), 'utf8');
async function browser(t, run) {
  const cwd = mkdtempSync(join(tmpdir(), 'kit2-contract-'));
  t.after(() => rmSync(cwd, {recursive:true,force:true}));
  await kit.withBrowser({cwd, executablePath:process.env.CHROME ?? chromiumExecutable()}, async context => run(await context.newPage(), cwd));
}
test('H9 renderedText opts into substring matching for a row with more than the needle', {timeout:30000}, async t => browser(t, async page => {
  await page.setContent('<section aria-label="Rows"><p>Proof needle — more row text</p><input value="Proof needle"></section>');
  const within = page.getByRole('region', {name:'Rows'});
  assert.equal(await kit.renderedText(page, 'Proof needle', {within}).count(), 0, 'exact by default');
  await assert.rejects(kit.waitForFresh(kit.renderedText(page, 'Proof needle', {within}), null, 50), /a substring match exists; pass a RegExp or `exact: false`/);
  const row = kit.renderedText(page, 'Proof needle', {within, exact:false});
  assert.equal(await row.count(), 1, 'explicit substring matches the whole rendered row');
  assert.equal(await kit.waitForFresh(row, null, {timeoutMs:500}), 'Proof needle — more row text');
  assert.equal(await kit.waitForFresh(kit.renderedText(page, /Proof needle/, {within}), null, 500), 'Proof needle — more row text');
  await assert.rejects(kit.waitForFresh(row, 'Proof needle — more row text', {timeoutMs:1000}), /locator.*last count=1.*Proof needle.*present but unchanged/);
  await assert.rejects(kit.waitForFresh(kit.renderedText(page,'missing'), null, {timeoutMs:1000}), /last count=0.*text=null.*absent/);
}));
test('DX6 composed RN text and wrapping labels preserve scope, exactness and ambiguity', {timeout:30000}, async t => browser(t, async page => {
  await page.setContent(`<section aria-label="Rows"><div><span>Order </span><span>42</span><span> saved</span></div>
    <label><span>Due </span><strong>tomorrow</strong><input value="secret value"></label>
    <p hidden>Order 42 saved</p><p>Order 42 saved later</p></section>`);
  const within = page.getByRole('region', {name:'Rows'});
  for (const text of ['Order 42 saved', /^Order 42 saved$/]) {
    const found = kit.renderedText(page, text, {within});
    assert.equal(await found.count(), 1, 'composed text selects the smallest rendered container');
    assert.equal(await kit.waitForFresh(found, null, 500), 'Order 42 saved');
  }
  assert.equal(await kit.renderedText(page, 'Due tomorrow', {within}).count(), 1, 'wrapping input label composes descendants without its value');
  assert.equal(await kit.renderedText(page,'Due tomorrow',{within:page.locator('label')}).count(),1,'a wrapping label can itself be the scope, as with Playwright getByText');
  assert.equal(await kit.statusText(page, 'Due tomorrow').count(), 1);
  assert.equal(await kit.renderedText(page, 'secret value', {within}).count(), 0);
  await page.getByRole('region',{name:'Rows'}).evaluate(el=>el.insertAdjacentHTML('beforeend', `<style>.invisible{display:none}</style><div><span hidden>Approved</span><button>Save</button></div><div><span class="invisible">Accepted</span><button>Submit</button></div><div><span style="visibility:hidden">Confirmed</span><button>Go</button></div><div><span style="opacity:0">Done</span><button>Finish</button></div><div contenteditable="true">Editable</div><div><span>Visible </span><span hidden>secret </span><strong>composed</strong></div>`));
  for(const text of ['Approved','Accepted','Confirmed','Done','Editable']) for(const needle of [text,new RegExp(text)]) assert.equal(await kit.renderedText(page,needle,{within}).count(),0,`${text}: hidden or editable text is not evidence`);
  assert.equal(await kit.renderedText(page,'Visible composed',{within}).count(),1,'hidden adornment does not prevent composed visible evidence');
  const visible=kit.renderedText(page,'Visible composed',{within});
  assert.equal(await kit.waitForFresh(visible,null,500),'Visible composed');
  await visible.evaluate(el=>el.querySelector('[hidden]').textContent='changed invisible text');
  await assert.rejects(kit.waitForFresh(visible,'Visible composed',50),/present but unchanged/);
  await assert.rejects(kit.waitForFresh(visible.filter({visible:true}),'Visible composed',50),/present but unchanged/);


  assert.equal(await kit.renderedText(page, 'order 42 saved', {within}).count(), 0, 'exact remains case sensitive');
  assert.equal(await kit.renderedText(page, 'Order 42 saved', {within, exact:false}).count(), 2);
  await page.getByRole('region', {name:'Rows'}).evaluate(el => el.insertAdjacentHTML('beforeend', '<p>Order 42 saved</p>'));
  await assert.rejects(kit.waitForFresh(kit.renderedText(page, 'Order 42 saved', {within}), null, 500), /strict mode violation/);
}));
test('DX6 rendered locators work on caller-owned Chromium outside withBrowser', {timeout:30000}, async t => {
  const {chromium}=await import('playwright-core');
  const browser=await chromium.launch({headless:true,executablePath:process.env.CHROME??chromiumExecutable(),args:['--no-sandbox']});
  t.after(()=>kit.bounded(browser.close(),5000,'caller browser close'));
  const page=await browser.newPage();
  await page.setContent('<p><span>Caller </span><strong>visible</strong><span hidden> hidden</span></p>');
  assert.equal(await kit.waitForFresh(kit.renderedText(page,'Caller visible'),null,1000),'Caller visible');
});
test('DX6 proof driver installs the SDK bridge without application witness imports', {timeout:30000}, async t => browser(t, async (page, cwd) => {
  mkdirSync(join(cwd, 'dist'));
  writeFileSync(join(cwd,'dist/index.html'), `<button>Save</button><script>
    const op={kind:'mutation',name:'save'}, listeners=new Set();
    const client={mutate:async()=>({state:'sent',id:'write',seq:1}),onWrite:fn=>{listeners.add(fn);return()=>listeners.delete(fn)}};
    const app={client,mutate:client.mutate,ready:Promise.resolve({ok:true})};
    window[Symbol.for('snapback4.proof.app')](app);
    window.selectedApp=app;
    window[Symbol.for('snapback4.proof.app')]({ready:Promise.resolve({ok:true}),client:{}});
    document.querySelector('button').onclick=()=>app.mutate(op,{title:'composed'});
  </script>`);
  const host = await kit.startStatic('dist', {cwd}); t.after(() => host.stop());
  await page.goto(host.url, {waitUntil:'domcontentloaded'});
  const tamper = await page.evaluate(() => {
    const key=Symbol.for('snapback4.proof.app'), observer=window[key], bridge=window.__snapback4Witness;
    const results=[Reflect.set(window,key,()=>{}),Reflect.deleteProperty(window,key),Reflect.set(window,'__snapback4Witness',{}),Reflect.deleteProperty(window,'__snapback4Witness'),Reflect.set(bridge,'formResult',()=>({state:'sent'}))];
    return {results,observerUnchanged:window[key]===observer,bridgeUnchanged:window.__snapback4Witness===bridge};
  });
  assert.deepEqual(tamper,{results:[false,false,false,false,false],observerUnchanged:true,bridgeUnchanged:true});
  await assert.rejects(page.evaluate(()=>window.__snapback4Witness.registerApi({},{})),/E_WITNESS_APP_SELECTION/);
  const button = page.getByRole('button', {name:'Save'});
  await button.evaluate(el => window.__snapback4Witness.beginForm('save',{title:'composed'},el));
  await button.click();
  const result=await kit.bounded(page.evaluate(()=>window.__snapback4Witness.formResult()),1000,'injected receipt');
  assert.equal(result.state,'sent'); assert.equal(result.mutation,'save');
  await assert.rejects(page.evaluate(()=>window.__snapback4Witness.mutate('save',{},'direct')), /no matching durable mutation/);
  await page.evaluate(()=>window.__snapback4Witness.registerApi(window.selectedApp,{save:{kind:'mutation',name:'save'}}));
  assert.equal((await page.evaluate(()=>window.__snapback4Witness.mutate('save',{},'direct'))).state,'sent','same-App explicit registration enriches the selected bridge');
}));
test('KIT4 substring advice stays inside explicit scope and timeout names the visible screen', {timeout:30000}, async t => browser(t, async page => {
  await page.setContent('<h1>Open status link</h1><p>Explains Cleared status</p><section aria-label="Status"><p>Waiting</p></section>');
  const within=page.getByRole('region',{name:'Status'});
  for (const options of [{}, {within}]) {
    await assert.rejects(kit.waitForFresh(kit.renderedText(page,'Cleared',options),null,50), error => {
      assert.match(error.message,/visible heading="Open status link"/);
      assert.doesNotMatch(error.message,/substring match exists/); return true;
    });
  }
  await page.getByRole('region',{name:'Status'}).evaluate(el=>el.innerHTML='<p>Cleared by officer</p>');
  await assert.rejects(kit.waitForFresh(kit.renderedText(page,'Cleared',{within}),null,50),/substring match exists/);
  await assert.rejects(kit.waitForFresh(kit.renderedText(page,'Cleared'),null,{within,timeoutMs:50}),/substring match exists/);
}));
test('H9 P12 a trusted click that writes nothing settles E_WITNESS_NO_WRITE and rearming settles the old promise', {timeout:30000}, async t => browser(t, async page => {
  const cwd=mkdtempSync(join(tmpdir(),'kit2-no-write-'));
  t.after(()=>rmSync(cwd,{recursive:true,force:true}));
  mkdirSync(join(cwd,'dist'));
  writeFileSync(join(cwd,'dist/bridge.js'),witnessSource);
  writeFileSync(join(cwd,'dist/index.html'),`<button>Add</button><script type="module">
import {registerWebWitness} from './bridge.js';
const client={mutate:async()=>{throw Error('no write expected')},onWrite:()=>()=>{}};
const app={client,mutate:client.mutate,ready:Promise.resolve({ok:true})};
window.testApp=app;registerWebWitness(app,{add:{kind:'mutation',name:'add'}});
</script>`);
  const host=await kit.startStatic('dist',{cwd});
  t.after(()=>host.stop());
  await page.goto(host.url+'/?witness=web',{waitUntil:'domcontentloaded'});
  await page.waitForFunction(()=>window.__snapback4Witness);
  await page.evaluate(()=>{
    window.__snapback4Witness.beginForm('add',{},document.querySelector('button'));
    window.oldResult=window.__snapback4Witness.formResult();
  });
  await page.getByRole('button',{name:'Add'}).click();
  const result = await kit.bounded(page.evaluate(() => window.oldResult), 2500, 'no-write result');
  assert.equal(result.state,'failed'); assert.equal(result.why.code,'E_WITNESS_NO_WRITE'); assert.equal(result.why.reason,'returned-early');
  assert.match(result.why.message,/armed click produced no durable mutation/);
  const old = await page.evaluate(async () => {
    window.__snapback4Witness.beginForm('add',{},document.querySelector('button'));
    const previous=window.__snapback4Witness.formResult();
    window.__snapback4Witness.beginForm('add',{},document.querySelector('button'));
    const result=await previous;
    // Settle the final arm too so no timer escapes the test.
    await window.testApp.client.mutate({kind:'mutation',name:'add'},{}).catch(()=>{});
    return result;
  });
  assert.equal(old.why.code,'E_WITNESS_NO_WRITE');
}));

test('KIT3 explicit form claim survives slow uploads and never grants an unrelated callback', {timeout:30000}, async t => browser(t, async (page, browserCwd) => {
  const cwd=mkdtempSync(join(tmpdir(),'kit3-upload-'));
  t.after(()=>rmSync(cwd,{recursive:true,force:true})); mkdirSync(join(cwd,'dist'));
  writeFileSync(join(cwd,'dist/bridge.js'),witnessSource);
  writeFileSync(join(cwd,'dist/index.html'),`<button>Add</button><script type="module">
import {registerWebWitness,witnessForm} from './bridge.js';
const op={kind:'mutation',name:'add'};
window.writes=0;window.delay=1100;
const client={mutate:async(op,args)=>{window.writes++;return {state:'sent',id:'write',result:args}},onWrite:()=>()=>{},upload:async()=>{await new Promise(r=>setTimeout(r,window.delay));return {ok:true,asset:{id:'asset'}}}};
const app={client,mutate:(...args)=>client.mutate(...args),ready:new URLSearchParams(location.search).has('unready')?new Promise(()=>{}):Promise.resolve({ok:true})};
window.app=app;window.mode='claim';registerWebWitness(app,{add:op});
document.querySelector('button').onclick=event=>{
  if(window.mode==='stale') return window.staleClaim(op,{});
  if(window.mode==='wrong') return app.mutate(op,{secret:'must not enter proof logs'});
  if(window.mode==='nothing') return;
  return witnessForm(app,event,async mutate=>{
    window.lastClaim=mutate;
    const uploaded=await client.upload();
    if(window.mode==='competing') await app.mutate(op,{});
    return mutate(op,{});
  });
};
</script>`);
  const host=await kit.startStatic('dist',{cwd});t.after(()=>host.stop());
  await page.goto(host.url+'/?witness=web'); await page.waitForFunction(()=>window.__snapback4Witness);
  const arm=()=>page.evaluate(()=>window.__snapback4Witness.beginForm('add',{},document.querySelector('button')));
  await arm(); await page.getByRole('button').click();
  assert.equal((await page.evaluate(()=>window.__snapback4Witness.formResult())).state,'sent');
  await page.evaluate(()=>{window.staleClaim=window.lastClaim;window.delay=2200;});await arm();await page.getByRole('button').click();
  await page.waitForTimeout(100);await page.getByRole('button').click();
  assert.equal((await page.evaluate(()=>window.__snapback4Witness.formResult())).state,'sent','second click does not reinstall a no-write timer');
  await page.waitForFunction(()=>window.writes===3);await page.evaluate(()=>window.delay=1100);
  await page.evaluate(()=>window.mode='competing'); await arm(); await page.getByRole('button').click();
  const competing=await page.evaluate(()=>window.__snapback4Witness.formResult());
  assert.equal(competing.why.code,'E_WITNESS_UNCLAIMED'); assert.equal(competing.why.reason,'event');
  await page.evaluate(()=>window.mode='wrong'); await arm(); await page.getByRole('button').click();
  const wrong=await page.evaluate(()=>window.__snapback4Witness.formResult());
  assert.equal(wrong.why.reason,'arguments'); assert.match(wrong.why.message,/mismatched keys: secret/); assert.ok(!JSON.stringify(wrong).includes('must not enter proof logs'));
  const privateFile = readdirSync(join(browserCwd, 'logs')).find(name => name.endsWith('.witness.private.jsonl'));
  const privatePath = join(browserCwd, 'logs', privateFile);
  assert.equal(statSync(privatePath).mode & 0o777, 0o600);
  const diff = readFileSync(privatePath, 'utf8').trim().split('\n').map(JSON.parse).find(row => row.code === 'E_WITNESS_UNCLAIMED');
  assert.deepEqual(diff.armed, {}); assert.deepEqual(diff.actual, {secret:'must not enter proof logs'});
  for (const fault of ['stall','throw']) {
    const before=await page.evaluate(()=>window.writes);
    await page.evaluate(fault=>{window.__snapback4ProofDiagnostic=()=>{if(fault==='throw')throw Error('diagnostic failed');return new Promise(()=>{});};},fault);
    await arm();await page.getByRole('button').click();
    await kit.waitForServer(()=>page.evaluate(()=>window.writes),writes=>writes===before+1,{timeoutMs:1000,label:'application write independent of diagnostic'});
    assert.equal((await page.evaluate(()=>window.__snapback4Witness.formResult())).why.reason,'arguments');
  }
  await page.evaluate(()=>window.mode='rearm'); await arm(); await page.getByRole('button').click();
  await page.evaluate(()=>{window.old=window.__snapback4Witness.formResult();window.__snapback4Witness.beginForm('add',{},document.querySelector('button'));});
  assert.equal((await page.evaluate(()=>window.old)).why.code,'E_WITNESS_NO_WRITE');
  assert.equal((await page.evaluate(()=>window.__snapback4Witness.formResult())).why.reason,'event');
  await page.evaluate(()=>window.mode='stale');await arm();await page.getByRole('button').click();
  assert.equal((await page.evaluate(()=>window.__snapback4Witness.formResult())).why.reason,'event','an old closure cannot borrow a new trusted click');
  await page.goto(host.url+'/?witness=web&unready=1');await page.waitForFunction(()=>window.__snapback4Witness);
  await page.evaluate(()=>window.mode='nothing');await arm();await page.getByRole('button').click();
  assert.equal((await page.evaluate(()=>window.__snapback4Witness.formResult())).why.reason,'not-ready');
}));
test('KIT3 starter SVG box click and scoped text recipe run literally', {timeout:30000}, async t => browser(t, async page => {
  const source=readFileSync(new URL('../../../crates/snapback4/src/verbs/init/frontend-proof.mjs',import.meta.url),'utf8');
  const body=source.match(/async function clickSvg\(page, control\) \{([\s\S]*?)\n\}/)[1];
  const clickSvg=new Function('assert',`return async function(page,control){${body}}`)(assert);
  await page.setContent(`<svg width="160" height="80"><foreignObject width="160" height="80"><button style="width:160px;height:80px" onclick="document.querySelector('section p').textContent='fresh saved'">Save</button></foreignObject></svg><section aria-label="Rows"><p>old</p></section><p>fresh saved</p><label for="choice">Choice</label><select id="choice"><option value="a">Alpha</option><option value="b">Beta</option></select>`);
  const within=page.getByRole('region',{name:'Rows'});
  await clickSvg(page,page.locator('svg'));
  assert.equal(await kit.waitForFresh(kit.renderedText(page,/fresh saved/,{within}),null,1000),'fresh saved');
  const select=page.getByLabel('Choice',{exact:true});await kit.selectByValue(select,'b');assert.equal(await select.inputValue(),'b');
}));

test('KIT3 dev.now reads the current served clock across advance and reset', {timeout:30000}, async t => {
  const cwd=mkdtempSync(join(tmpdir(),'kit3-now-'));t.after(()=>rmSync(cwd,{recursive:true,force:true}));
  mkdirSync(join(cwd,'snapback'));writeFileSync(join(cwd,'snapback/schema.q'),'use personas alice\nquery time():\n  return now\n');
  const dev=await kit.startDev({cwd});t.after(()=>dev.stop());
  const before=await dev.now();
  const post=async(path,body)=>(await fetch(dev.url+path,{method:'POST',body:JSON.stringify(body)})).json();
  const advanced=await post('/dev/clock/advance',{duration:'2h'});
  assert.ok(advanced.now>=before+7_200_000);assert.ok(Math.abs(advanced.skewMs-7_200_000)<1000);
  assert.ok(await dev.now()>=advanced.now);
  const reset=await post('/dev/reset',{});assert.ok(reset.now>=advanced.now);assert.ok(reset.skewMs>=7_199_000);
  const wall=await post('/dev/reset',{clock:'reset'});assert.ok(Math.abs(wall.skewMs)<1000);assert.ok(Math.abs(await dev.now()-Date.now())<1000);
});

test('KIT4 stale online client names dev reset and a newly opened client works', {timeout:30000}, async t => {
  const {createClient}=await import('../dist/client.js');
  const cwd=mkdtempSync(join(tmpdir(),'kit4-reset-'));t.after(()=>rmSync(cwd,{recursive:true,force:true}));
  mkdirSync(join(cwd,'snapback'));writeFileSync(join(cwd,'snapback/schema.q'),'use personas alice\nquery time():\n  return now\n');
  const dev=await kit.startDev({cwd});t.after(()=>dev.stop());
  const before=createClient({url:dev.url,persona:'alice'});t.after(()=>before.close());
  assert.equal((await before.query({kind:'query',name:'time'},{})).complete,true);
  const reset=await fetch(dev.url+'/dev/reset',{method:'POST',body:'{}'});assert.equal(reset.status,200);
  const reply=await before.query({kind:'query',name:'time'},{});
  assert.equal(reply.denied.code,'E_DEV_RESET');assert.match(reply.denied.message,/reopen the client/);
  const after=createClient({url:dev.url,persona:'alice'});t.after(()=>after.close());
  assert.equal((await after.query({kind:'query',name:'time'},{})).complete,true);
});
test('KIT4 waitForClock observes the page client instead of the proof driver clock', {timeout:30000}, async t => browser(t, async page => {
  await page.setContent('<h1>Clock</h1>');
  await page.evaluate(()=>{window.sample=1;window.__snapback4Witness={clock:()=>window.sample};setTimeout(()=>window.sample=3600001,100);});
  assert.equal(await kit.waitForClock(page,3600001,{timeoutMs:2000}),3600001);
  await assert.rejects(kit.waitForClock(page,7200001,{timeoutMs:50}),/page client clock.*last=3600001/);
  await assert.rejects(kit.waitForClock(page,NaN),/E_PROOF_USAGE/);
}));

test('KIT4 generated proof API table agrees with every source export', {timeout:60000},()=>{
  execFileSync(process.execPath,[new URL('../../../scripts/generate-proof-api.mjs',import.meta.url).pathname,'--check'],{timeout:50000});
});

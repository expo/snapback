// H9 controls can load the unchanged 0.4.29 proof/witness modules via KIT2_BASELINE_DIST.
import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync, readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { chromiumExecutable } from '../../../witness/lib.mjs';
const dist = process.env.KIT2_BASELINE_DIST ?? resolve(import.meta.dirname, '../dist');
const kit = await import(pathToFileURL(join(dist, 'proof.js')));
const witnessSource = readFileSync(join(dist, 'witness-web.js'), 'utf8');
async function browser(t, run) {
  const cwd = mkdtempSync(join(tmpdir(), 'kit2-contract-'));
  t.after(() => rmSync(cwd, {recursive:true,force:true}));
  await kit.withBrowser({cwd, executablePath:chromiumExecutable()}, async context => run(await context.newPage()));
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
  await assert.rejects(kit.waitForFresh(row, 'Proof needle — more row text', {timeoutMs:1000}), /getByText.*last count=1.*Proof needle.*present but unchanged/);
  await assert.rejects(kit.waitForFresh(kit.renderedText(page,'missing'), null, {timeoutMs:1000}), /last count=0.*text=null.*absent/);
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

test('KIT3 explicit form claim survives slow uploads and never grants an unrelated callback', {timeout:30000}, async t => browser(t, async page => {
  const cwd=mkdtempSync(join(tmpdir(),'kit3-upload-'));
  t.after(()=>rmSync(cwd,{recursive:true,force:true})); mkdirSync(join(cwd,'dist'));
  writeFileSync(join(cwd,'dist/bridge.js'),witnessSource);
  writeFileSync(join(cwd,'dist/index.html'),`<button>Add</button><script type="module">
import {registerWebWitness,witnessForm} from './bridge.js';
const op={kind:'mutation',name:'add'};
const client={mutate:async(op,args)=>({state:'sent',id:'write',result:args}),onWrite:()=>()=>{},upload:async()=>{await new Promise(r=>setTimeout(r,1100));return {ok:true,asset:{id:'asset'}}}};
const app={client,mutate:(...args)=>client.mutate(...args),ready:Promise.resolve({ok:true})};
window.app=app;window.mode='claim';registerWebWitness(app,{add:op});
document.querySelector('button').onclick=event=>{
  if(window.mode==='wrong') return app.mutate(op,{secret:'must not enter proof logs'});
  if(window.mode==='nothing') return;
  return witnessForm(app,event,async mutate=>{
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
  await page.evaluate(()=>window.mode='competing'); await arm(); await page.getByRole('button').click();
  const competing=await page.evaluate(()=>window.__snapback4Witness.formResult());
  assert.equal(competing.why.code,'E_WITNESS_UNCLAIMED'); assert.equal(competing.why.reason,'event');
  await page.evaluate(()=>window.mode='wrong'); await arm(); await page.getByRole('button').click();
  const wrong=await page.evaluate(()=>window.__snapback4Witness.formResult());
  assert.equal(wrong.why.reason,'arguments'); assert.ok(!JSON.stringify(wrong).includes('must not enter proof logs'));
  await page.evaluate(()=>window.mode='rearm'); await arm(); await page.getByRole('button').click();
  await page.evaluate(()=>{window.old=window.__snapback4Witness.formResult();window.__snapback4Witness.beginForm('add',{},document.querySelector('button'));});
  assert.equal((await page.evaluate(()=>window.old)).why.code,'E_WITNESS_NO_WRITE');
  assert.equal((await page.evaluate(()=>window.__snapback4Witness.formResult())).why.reason,'event');
}));
test('KIT3 starter SVG box click and scoped text recipe run literally', {timeout:30000}, async t => browser(t, async page => {
  const source=readFileSync(new URL('../../../crates/snapback4/src/verbs/init/frontend-proof.mjs',import.meta.url),'utf8');
  const body=source.match(/async function clickSvg\(page, control\) \{([\s\S]*?)\n\}/)[1];
  const clickSvg=new Function('assert',`return async function(page,control){${body}}`)(assert);
  await page.setContent(`<svg width="160" height="80"><foreignObject width="160" height="80"><button style="width:160px;height:80px" onclick="document.querySelector('section p').textContent='fresh saved'">Save</button></foreignObject></svg><section aria-label="Rows"><p>old</p></section><p>fresh saved</p>`);
  const within=page.getByRole('region',{name:'Rows'});
  await clickSvg(page,page.locator('svg'));
  assert.equal(await kit.waitForFresh(kit.renderedText(page,/fresh saved/,{within}),null,1000),'fresh saved');
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

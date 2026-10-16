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
  assert.equal(result.state,'failed'); assert.equal(result.why.code,'E_WITNESS_NO_WRITE');
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

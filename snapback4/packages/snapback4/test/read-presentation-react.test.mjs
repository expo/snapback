import { createBrowserServer, loadBrowserPage } from './helpers/browser-server.mjs';
// @ref LLP 3000.031#7 — execute the published screen; shell state survives, protected data does not.
import test from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { spawnSync } from 'node:child_process';
import { readyRead } from '../dist/read-existence.js';
import { mkdtempSync, readFileSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import ts from 'typescript';
import { chromiumExecutable } from '../../../witness/lib.mjs';
import { hangBudget } from './helpers/wait.mjs';

const root = resolve(import.meta.dirname, '../../..');
const pkg = createRequire(join(root, 'packages/snapback4/package.json'));

test('published Expo recipe: Strict Mode, withdrawal, denied membership, and account/resource/backend keys', { timeout: hangBudget(10) }, async t => {
  let executablePath;
  try { executablePath = chromiumExecutable(); }
  catch (error) { t.skip(`Chromium unavailable: ${error.message}`); return; }
  const { chromium } = createRequire(join(root, 'package.json'))('playwright-core');

  const dir = mkdtempSync(join(tmpdir(), 'sb4-read-presentation-'));
  let browser, vite;
  t.after(async () => { await browser?.close(); await vite?.close(); rmSync(dir, { recursive: true, force: true }); });
  const docs = readFileSync(join(root, 'packages/snapback4/CLIENT-AND-OPERATIONS.md'), 'utf8');
  const recipe = docs.split('### A stable conversation screen')[1].match(/```tsx\n([\s\S]*?)\n```/)[1];
  writeFileSync(join(dir, 'recipe.jsx'), ts.transpileModule(recipe, { compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.ESNext, jsx: ts.JsxEmit.ReactJSX } }).outputText);
  const guide = spawnSync(process.env.SNAPBACK4_BIN ?? join(root, 'target/debug/snapback4'), ['guide', 'social'], {encoding:'utf8'});
  assert.equal(guide.status, 0, guide.stderr);
  const quote = guide.stdout.match(/```tsx\n\/\/ src\/QuotedMessage.tsx\n([\s\S]*?)```/)[1];
  writeFileSync(join(dir, 'quote.jsx'), ts.transpileModule(quote, { compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.ESNext, jsx: ts.JsxEmit.ReactJSX } }).outputText);
  writeFileSync(join(dir, 'index.html'), '<div id="root"></div><script type="module" src="/harness.jsx"></script>');
  writeFileSync(join(dir, 'native.jsx'), `import {act, createElement as h} from 'react';
export const View = ({children,style}) => h('div', {style}, children), ScrollView = View;
export const Text = ({children}) => h('span', null, children);
export const TextInput = ({value, onChangeText}) => h('input', {value, onChange: e => act(()=>onChangeText(e.target.value))});
export const Button = ({title, disabled, onPress}) => h('button', {disabled, onClick: ()=>act(()=>onPress())}, title);
export const Pressable = ({children, disabled, onPress}) => h('button', {disabled, onClick: ()=>act(()=>onPress())}, children);
`);
  writeFileSync(join(dir, 'api.js'), `export const api = {messagePhoto:{kind:'query',name:'messagePhoto'},thread:{kind:'query',name:'thread'},myMembership:{kind:'query',name:'myMembership'},send:{kind:'mutation',name:'send'}};`);
  writeFileSync(join(dir, 'harness.jsx'), `import React, {StrictMode, act} from 'react';
import {createRoot} from 'react-dom/client';
import {AppProvider} from 'snapback4/react';
import {ConversationScreen} from './recipe.jsx';
import {QuotedMessage} from './quote.jsx';
globalThis.IS_REACT_ACT_ENVIRONMENT = true;
const records = new Set(), authListeners = new Set(), writeListeners = new Set(), submissions = [];
let auth = {state:'signed-in',viewer:'alice'}, backend='a', conversationId='one';
let reads = {messagePhoto:{loading:true},thread:{loading:true},myMembership:{loading:true}};
const client = {
  observe(op) {
    const listeners = new Set();
    const record = {op, listeners, getSnapshot:()=>reads[op.name], subscribe(fn){listeners.add(fn);return()=>listeners.delete(fn);},close(){records.delete(record);}};
    records.add(record); return record;
  },
  mutate: (_op, args, options) => new Promise(resolve => submissions.push({args, id:options.id, resolve})),
  onWrite(fn) {writeListeners.add(fn);return()=>writeListeners.delete(fn);}, write: async () => undefined,
};
const app = {client, auth:{getSnapshot:()=>auth,onChange(fn){authListeners.add(fn);return()=>authListeners.delete(fn);}}};
const root = createRoot(document.getElementById('root'));
window.quoteJumps=0;
const render = () => root.render(<StrictMode><AppProvider app={app}><ConversationScreen backend={backend} conversationId={conversationId}/><section id="quote"><QuotedMessage id="older-than-loaded-history" onJump={()=>window.quoteJumps++}/></section></AppProvider></StrictMode>);
window.start = async () => {await act(async()=>render());};
window.publish = async changes => {await act(async()=>{reads={...reads,...changes};for(const r of records)for(const fn of r.listeners)fn();});};
window.changeKey = async (kind,value) => {await act(async()=>{if(kind==='account'){auth={...auth,viewer:value};for(const fn of authListeners)fn();}else if(kind==='backend')backend=value;else conversationId=value;render();});};
const outcome = state => ({state,id:submissions.at(-1).id,seq:1,result:null,why:{code:'NO',family:'test',message:'Send refused'}});
window.submissions = () => submissions.map(({args,id})=>({args,id}));
window.releaseAdmission = async state => {await act(async()=>submissions.at(-1).resolve(outcome(state)));};
window.settle = async state => {await act(async()=>{for(const fn of writeListeners)fn(outcome(state));});};
window.finish = async()=>{await act(async()=>root.unmount());return {records:records.size,authListeners:authListeners.size,writeListeners:writeListeners.size};};
`);
  vite = await createBrowserServer({ root: dir, configFile: false, logLevel: 'error',
    server: { hmr: false, host: '127.0.0.1', port: 0, fs: { allow: [root, dir] } },
    resolve: { alias: [
      ...['react', 'react/jsx-runtime', 'react/jsx-dev-runtime', 'react-dom/client'].map(name => ({ find: new RegExp('^' + name + '$'), replacement: pkg.resolve(name) })),
      { find: 'react-native', replacement: join(dir, 'native.jsx') },
      { find: '../snapback/generated/api', replacement: join(dir, 'api.js') },
      { find: 'snapback4/react', replacement: join(root, 'packages/snapback4/dist/react.js') },
      { find: 'snapback4/client', replacement: join(root, 'packages/snapback4/dist/client.js') },
      { find: 'snapback4/contract', replacement: join(root, 'packages/snapback4/dist/contract.js') },
    ] },
  });
  await vite.listen();
  browser = await chromium.launch({ timeout: hangBudget(), executablePath, headless: true, args: ['--no-sandbox'] });
  const page = await browser.newPage(); page.setDefaultTimeout(hangBudget());
  const errors = []; page.on('pageerror', error => errors.push(error.message));
  await loadBrowserPage(t, page, vite.resolvedUrls.local[0]); await page.waitForFunction(() => window.start);
  await page.evaluate(() => window.start());
  const input = page.locator('input');
  await input.fill('unsent draft'); await input.focus();
  await page.evaluate(() => { window.originalInput = document.querySelector('input'); });
  const ready = (data, flags = {}) => ({data, existence: Array.isArray(data) && !data.length ? 'absent' : 'present', complete:true, cut:null, fresh:true, ...flags});
  const body = () => page.locator('body').innerText();
  const preserved = async () => {
    assert.equal(await input.inputValue(), 'unsent draft');
    assert.equal(await page.evaluate(() => document.querySelector('input') === window.originalInput && document.activeElement === window.originalInput), true);
  };
  await preserved(); assert.match(await body(), /Loading/);
  await t.test('published quote waits for point evidence, handles uncertainty, and withdraws protected text', async () => {
    const quote = page.locator('#quote'), box = quote.locator('div');
    await page.evaluate(() => {window.quoteBox=document.querySelector('#quote > div');});
    const stable = async () => {
      assert.equal(await box.evaluate(el => el === window.quoteBox), true);
      assert.equal(await box.evaluate(el => getComputedStyle(el).minHeight), '40px');
    };
    // Hold the point read at loading while the rest of the screen is usable.
    // No timing sleep or immediate-after-bubble assertion can race this barrier.
    assert.equal(await quote.innerText(), 'Loading quoted message…'); await stable();
    const publish = async read => { await page.evaluate(read => window.publish({messagePhoto:read}), read); await stable(); };
    const readyQuote = (data, metadata = {}, pending = false) => readyRead({data, complete:true, fresh:true, cut:null, ...metadata}, pending);
    for (const metadata of [{complete:false}, {cut:'meter'}, {next:'older'}]) {
      await publish(readyQuote(null, metadata));
      assert.equal(await quote.innerText(), 'Quoted message not yet known');
      assert.equal(await quote.getByRole('button').count(), 0);
    }
    await publish(readyQuote(null, {}, true));
    assert.equal(await quote.innerText(), 'Quoted message not yet known');
    await publish(readyQuote({text:'',photo:{id:'once-photo'}}));
    assert.equal(await quote.getByRole('button').innerText(), 'Photo message');
    await publish(readyQuote({text:'Coffee after work?'}));
    assert.equal(await quote.innerText(), 'Coffee after work?');
    await quote.getByRole('button').evaluate(node=>node.click());
    assert.equal(await page.evaluate(()=>window.quoteJumps), 1);
    await publish(readyQuote({text:'Coffee after work?'}, {fresh:false,revalidating:true}));
    assert.equal(await quote.innerText(), 'Coffee after work?');
    assert.equal(await quote.getByRole('button').isDisabled(), true);
    await publish({loading:true});
    assert.equal(await quote.innerText(), 'Loading quoted message…');
    await publish(readyQuote({text:'Coffee after work?'}));
    await publish({denied:{code:'E_AUTH',family:'auth',message:'Denied'}});
    assert.equal(await quote.innerText(), 'Quoted message hidden');
    assert.equal(await quote.getByRole('button').count(), 0);
    await publish(readyQuote(null));
    assert.equal(await quote.innerText(), 'Quoted message unavailable');
    assert.equal(await quote.getByRole('button').count(), 0);
    await publish({loading:true});
    assert.equal(await quote.innerText(), 'Loading quoted message…');
    await preserved();
  });

  await page.evaluate(read => window.publish({thread:read}), ready([{id:'row',body:'protected message'}],{complete:false}));
  await preserved(); assert.match(await body(), /protected message/); assert.match(await body(), /Results may be incomplete/);
  await page.evaluate(read => window.publish({thread:read}), ready([], {existence:'partial',next:'cursor'}));
  await preserved(); assert.match(await body(), /Results may be incomplete/); assert.doesNotMatch(await body(), /No messages/);
  await page.evaluate(read => window.publish({thread:read}), ready([], {fresh:false,since:0,revalidating:true}));
  await preserved(); assert.match(await body(), /1970-01-01/); assert.match(await body(), /Updating/);
  assert.match(await body(), /No messages in the available snapshot/);
  const why = {code:'NO',family:'test',message:'Read refused'};
  for (const [arm, withdrawn] of [['loading', {loading:true}], ['denied', {denied:why}]]) {
    await t.test(`nonempty ready → ${arm} removes protected content and preserves draft/focus`, async () => {
      await page.evaluate(read => window.publish({thread:read}), ready([{id:'row',body:'protected message'}], {fresh:false,since:0,revalidating:true}));
      await preserved(); assert.match(await body(), /protected message/);
      await page.evaluate(read => window.publish({thread:read}), withdrawn);
      // Read the committed DOM directly, with no retry that could mask retained content.
      assert.doesNotMatch(await body(), /protected message|1970-01-01|Updating/);
      await preserved(); assert.match(await body(), arm === 'loading' ? /Loading/ : /Read refused/);
    });
  }
  await page.evaluate(denied => window.publish({thread:{denied},myMembership:{denied}}), why);
  await preserved(); assert.match(await body(), /Read refused/); assert.equal(await page.getByRole('button', {name:'Send',exact:true}).isDisabled(), true);
  for (const member of [{loading:true}, ready(null,{existence:'partial'}), ready(null,{existence:'absent',fresh:false}), ready(null,{existence:'absent',revalidating:true})]) {
    await page.evaluate(read => window.publish({myMembership:read}), member);
    assert.equal(await page.getByRole('button', {name:'Send',exact:true}).isDisabled(), false);
  }
  await page.evaluate(read => window.publish({myMembership:read}), ready(null,{existence:'absent'}));
  assert.equal(await page.getByRole('button', {name:'Send',exact:true}).isDisabled(), true);
  await page.evaluate(read => window.publish({myMembership:read}), ready({id:'member'}));
  await t.test('delayed admission cannot clear a deleted and retyped identical draft', async () => {
    await input.fill('same text');
    await page.getByRole('button', {name:'Send',exact:true}).click();
    assert.equal(await input.inputValue(), '', 'submission clears before admission');
    assert.equal(await page.getByRole('button', {name:'Send',exact:true}).isDisabled(), true);
    await input.fill('same text'); await input.fill(''); await input.fill('same text'); await input.focus();
    const submitted = await page.evaluate(() => window.submissions());
    assert.equal(submitted.length, 1); assert.equal(submitted[0].args.body, 'same text');
    assert.ok(submitted[0].id, 'text is retained under a submission ID');
    await page.evaluate(() => window.releaseAdmission('sent'));
    assert.equal(await input.inputValue(), 'same text');
    assert.equal(await input.evaluate(el => document.activeElement === el), true);
  });
  for (const phase of ['admission', 'settlement']) {
    await t.test(`${phase} refusal keeps submitted text available to edit without erasing the new draft`, async () => {
      await input.fill('refused text');
      await page.getByRole('button', {name:'Send',exact:true}).click();
      assert.equal(await input.inputValue(), '');
      assert.equal(await page.getByRole('button', {name:'Edit',exact:true}).count(), 0, 'old refusal does not belong to the new submission');
      await input.fill('new draft'); await input.focus();
      await page.evaluate(state => window.releaseAdmission(state), phase === 'admission' ? 'failed' : 'pending');
      if (phase === 'settlement') await page.evaluate(() => window.settle('failed'));
      assert.match(await body(), /Send refused: refused text/);
      assert.equal(await input.inputValue(), 'new draft');
      assert.equal(await input.evaluate(el => document.activeElement === el), true);
      await page.getByRole('button', {name:'Edit',exact:true}).click();
      assert.equal(await input.inputValue(), 'new draft refused text');
      assert.equal(await page.getByRole('button', {name:'Edit',exact:true}).count(), 0);
    });
  }
  const submissions = await page.evaluate(() => window.submissions());
  assert.equal(new Set(submissions.map(s => s.id)).size, submissions.length, 'identical text has distinct submission identities');
  for (const kind of ['resource','account','backend']) {
    await page.evaluate(kind => window.changeKey(kind,'two'), kind);
    assert.equal(await input.inputValue(), '', kind + ' resets draft');
    await input.fill('unsent draft');
  }
  assert.deepEqual(await page.evaluate(() => window.finish()), {records:0,authListeners:0,writeListeners:0});
  assert.deepEqual(errors, []);
});

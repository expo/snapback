// @ref LLP 3000.031#7 — execute the published screen; shell state survives, protected data does not.
import test from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { mkdtempSync, readFileSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
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
  const { createServer } = await import(pathToFileURL(createRequire(join(root, 'apps/chat/package.json')).resolve('vite')));
  const dir = mkdtempSync(join(tmpdir(), 'sb4-read-presentation-'));
  let browser, vite;
  t.after(async () => { await browser?.close(); await vite?.close(); rmSync(dir, { recursive: true, force: true }); });
  const docs = readFileSync(join(root, 'packages/snapback4/CLIENT-AND-OPERATIONS.md'), 'utf8');
  const recipe = docs.split('### A stable conversation screen')[1].match(/```tsx\n([\s\S]*?)\n```/)[1];
  writeFileSync(join(dir, 'recipe.jsx'), ts.transpileModule(recipe, { compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.ESNext, jsx: ts.JsxEmit.ReactJSX } }).outputText);
  writeFileSync(join(dir, 'index.html'), '<div id="root"></div><script type="module" src="/harness.jsx"></script>');
  writeFileSync(join(dir, 'native.jsx'), `import {createElement as h} from 'react';
export const View = ({children}) => h('div', null, children), ScrollView = View;
export const Text = ({children}) => h('span', null, children);
export const TextInput = ({value, onChangeText}) => h('input', {value, onChange: e => onChangeText(e.target.value)});
export const Button = ({title, disabled, onPress}) => h('button', {disabled, onClick: onPress}, title);
`);
  writeFileSync(join(dir, 'api.js'), `export const api = {thread:{kind:'query',name:'thread'},myMembership:{kind:'query',name:'myMembership'},send:{kind:'mutation',name:'send'}};`);
  writeFileSync(join(dir, 'harness.jsx'), `import React, {StrictMode, act} from 'react';
import {createRoot} from 'react-dom/client';
import {AppProvider} from 'snapback4/react';
import {ConversationScreen} from './recipe.jsx';
globalThis.IS_REACT_ACT_ENVIRONMENT = true;
const records = new Set(), authListeners = new Set();
let auth = {state:'signed-in',viewer:'alice'}, backend='a', conversationId='one';
let reads = {thread:{loading:true},myMembership:{loading:true}};
const client = {
  observe(op) {
    const listeners = new Set();
    const record = {op, listeners, getSnapshot:()=>reads[op.name], subscribe(fn){listeners.add(fn);return()=>listeners.delete(fn);},close(){records.delete(record);}};
    records.add(record); return record;
  },
  mutate: async () => ({state:'sent',id:'write',seq:1,result:null}),
  onWrite: () => () => {}, write: async () => undefined,
};
const app = {client, auth:{getSnapshot:()=>auth,onChange(fn){authListeners.add(fn);return()=>authListeners.delete(fn);}}};
const root = createRoot(document.getElementById('root'));
const render = () => root.render(<StrictMode><AppProvider app={app}><ConversationScreen backend={backend} conversationId={conversationId}/></AppProvider></StrictMode>);
window.start = async () => {await act(async()=>render());};
window.publish = async changes => {await act(async()=>{reads={...reads,...changes};for(const r of records)for(const fn of r.listeners)fn();});};
window.changeKey = async (kind,value) => {await act(async()=>{if(kind==='account'){auth={...auth,viewer:value};for(const fn of authListeners)fn();}else if(kind==='backend')backend=value;else conversationId=value;render();});};
window.finish = async()=>{await act(async()=>root.unmount());return {records:records.size,authListeners:authListeners.size};};
`);
  vite = await createServer({ root: dir, configFile: false, logLevel: 'error',
    server: { hmr: false, host: '127.0.0.1', port: 0, fs: { allow: [root, dir] } },
    resolve: { alias: [
      ...['react', 'react/jsx-runtime', 'react/jsx-dev-runtime', 'react-dom/client'].map(name => ({ find: new RegExp('^' + name + '$'), replacement: pkg.resolve(name) })),
      { find: 'react-native', replacement: join(dir, 'native.jsx') },
      { find: '../snapback/generated/api', replacement: join(dir, 'api.js') },
      { find: 'snapback4/react', replacement: join(root, 'packages/snapback4/dist/react.js') },
      { find: 'snapback4/contract', replacement: join(root, 'packages/snapback4/dist/contract.js') },
    ] },
  });
  await vite.listen();
  browser = await chromium.launch({ timeout: hangBudget(), executablePath, headless: true, args: ['--no-sandbox'] });
  const page = await browser.newPage(); page.setDefaultTimeout(hangBudget());
  const errors = []; page.on('pageerror', error => errors.push(error.message));
  await page.goto(vite.resolvedUrls.local[0]); await page.waitForFunction(() => window.start);
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
  await page.evaluate(read => window.publish({thread:read}), ready([{id:'row',body:'protected message'}],{complete:false}));
  await preserved(); assert.match(await body(), /protected message/); assert.match(await body(), /Results may be incomplete/);
  await page.evaluate(read => window.publish({thread:read}), ready([], {existence:'partial',next:'cursor'}));
  await preserved(); assert.match(await body(), /Results may be incomplete/); assert.doesNotMatch(await body(), /No messages/);
  await page.evaluate(read => window.publish({thread:read}), ready([], {fresh:false,since:0,revalidating:true}));
  await preserved(); assert.match(await body(), /1970-01-01/); assert.match(await body(), /Updating/);
  await page.evaluate(() => window.publish({thread:{loading:true}}));
  await preserved(); assert.doesNotMatch(await body(), /protected message|1970-01-01|Updating/);
  const why = {code:'NO',family:'test',message:'Read refused'};
  await page.evaluate(denied => window.publish({thread:{denied},myMembership:{denied}}), why);
  await preserved(); assert.match(await body(), /Read refused/); assert.equal(await page.getByRole('button', {name:'Send',exact:true}).isDisabled(), true);
  for (const member of [{loading:true}, ready(null,{existence:'partial'}), ready(null,{existence:'absent',fresh:false}), ready(null,{existence:'absent',revalidating:true})]) {
    await page.evaluate(read => window.publish({myMembership:read}), member);
    assert.equal(await page.getByRole('button', {name:'Send',exact:true}).isDisabled(), false);
  }
  await page.evaluate(read => window.publish({myMembership:read}), ready(null,{existence:'absent'}));
  assert.equal(await page.getByRole('button', {name:'Send',exact:true}).isDisabled(), true);
  for (const kind of ['resource','account','backend']) {
    await page.evaluate(kind => window.changeKey(kind,'two'), kind);
    assert.equal(await input.inputValue(), '', kind + ' resets draft');
    await input.fill('unsent draft');
  }
  assert.deepEqual(await page.evaluate(() => window.finish()), {records:0,authListeners:0});
  assert.deepEqual(errors, []);
});

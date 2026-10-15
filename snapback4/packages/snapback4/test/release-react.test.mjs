// @ref LLP 3000.000.000.000#2-served-capabilities — release withdrawal closes feature owners while the shell keeps its draft.
import test from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { mkdtempSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { createBrowserServer, loadBrowserPage } from './helpers/browser-server.mjs';
import { hangBudget } from './helpers/wait.mjs';
import { chromiumExecutable } from '../../../witness/lib.mjs';

const root = resolve(import.meta.dirname, '../../..');

test('useRelease withdraws unavailable features across rollback and recovery while retaining the shell draft', { timeout: hangBudget(6) }, async t => {
  let executablePath;
  try { executablePath = chromiumExecutable(); }
  catch (error) { t.skip(`Chromium unavailable: ${error.message}`); return; }
  const { chromium } = createRequire(join(root, 'package.json'))('playwright-core');
  const dir = mkdtempSync(join(tmpdir(), 'sb4-release-react-'));
  let browser, server;
  t.after(async () => {
    try { await browser?.close(); }
    finally { try { await server?.close(); } finally { rmSync(dir, { recursive: true, force: true }); } }
  });
  writeFileSync(join(dir, 'index.html'), '<div id="root"></div><script type="module" src="/harness.jsx"></script>');
  writeFileSync(join(dir, 'harness.jsx'), `
import React, { StrictMode, act, useState } from 'react';
import { createRoot } from 'react-dom/client';
import { SnapbackProvider, useQuery, useRelease } from 'snapback4/react';
import { operationAvailable } from 'snapback4/contract';
globalThis.IS_REACT_ACT_ENVIRONMENT = true;
let release = {loading:true};
const listeners = new Set(), active = new Set();
let opens = 0;
const source = {getSnapshot:()=>release, subscribe(fn){listeners.add(fn);return()=>listeners.delete(fn);}};
// This is the generated available() shape. Codegen and authenticated catalog
// decoding are covered independently; this fixture drives rendered hook ownership.
const priority = {kind:'query',name:'priority',available:release=>operationAvailable(release,'priority','query',{})};
const answer = {data:{label:'Priority ready'},complete:true,fresh:true,cut:null,existence:'present'};
const client = {release:source, observe(op){
  if (!priority.available(release)) throw new Error('opened unavailable operation '+op.name);
  opens++;
  const record = {getSnapshot:()=>answer,subscribe:()=>()=>{},close(){active.delete(record);}};
  active.add(record);return record;
}};
function Feature() {
  const read = useQuery(priority, {});
  if (!('data' in read)) return <p>Feature loading</p>;
  return <section aria-label="Priority feature"><p>{read.data.label}</p><button>Set priority</button></section>;
}
function Shell() {
  const release = useRelease();
  const [draft,setDraft] = useState('');
  const state = 'generation' in release ? 'Generation '+release.generation : 'denied' in release ? 'Release denied' : 'Release loading';
  return <main><h1>Core record</h1><label>Draft<input value={draft} onChange={event=>act(()=>setDraft(event.target.value))}/></label>
    <p role="status">{state}</p>
    {priority.available(release) ? <Feature/> : <p>Priority unavailable</p>}
  </main>;
}
const root = createRoot(document.getElementById('root'));
window.start = async()=>{await act(async()=>root.render(<StrictMode><SnapbackProvider client={client}><Shell/></SnapbackProvider></StrictMode>));};
window.publish = async value=>{await act(async()=>{release=value;for(const fn of listeners)fn();});};
window.resources = ()=>({opens,active:active.size,listeners:listeners.size});
window.finish = async()=>{await act(async()=>root.unmount());return window.resources();};
`);
  server = await createBrowserServer({ root: dir, configFile: false, logLevel: 'error',
    server: { host: '127.0.0.1', port: 0, fs: { allow: [root, dir] } },
    resolve: { alias: [
      { find: 'snapback4/react', replacement: join(root, 'packages/snapback4/dist/react.js') },
      { find: 'snapback4/contract', replacement: join(root, 'packages/snapback4/dist/contract.js') },
    ] },
  });
  await server.listen();
  browser = await chromium.launch({ timeout: hangBudget(), executablePath, headless: true, args: ['--no-sandbox'] });
  const page = await browser.newPage(); page.setDefaultTimeout(hangBudget());
  const errors = []; page.on('pageerror', error => errors.push(error.message));
  await loadBrowserPage(t, page, server.resolvedUrls.local[0]);
  await page.waitForFunction(() => window.start);
  await page.evaluate(() => window.start());
  const input = page.getByRole('textbox', { name: 'Draft', exact: true });
  await input.fill('Keep this unsent draft'); await input.focus();
  await page.evaluate(() => { window.originalInput = document.querySelector('input'); });
  const preserved = async () => {
    assert.equal(await input.inputValue(), 'Keep this unsent draft');
    assert.equal(await page.evaluate(() => document.querySelector('input') === window.originalInput && document.activeElement === window.originalInput), true);
    assert.equal(await page.getByRole('heading', { name: 'Core record', exact: true }).count(), 1);
  };
  const absent = async status => {
    await preserved();
    assert.equal(await page.getByRole('status').innerText(), status);
    assert.equal(await page.getByText('Priority unavailable', { exact: true }).count(), 1);
    assert.equal(await page.getByText('Priority ready', { exact: true }).count(), 0);
    assert.equal(await page.getByRole('button', { name: 'Set priority', exact: true }).count(), 0);
    assert.equal((await page.evaluate(() => window.resources())).active, 0);
  };
  const catalog = (generation, enabled) => ({ generation, operations: enabled ? { priority: { kind: 'query', args: {} } } : {}, tables: {} });
  const publish = value => page.evaluate(value => window.publish(value), value);
  await absent('Release loading');
  assert.equal((await page.evaluate(() => window.resources())).opens, 0);
  await publish(catalog(2, true));
  const feature = page.getByRole('region', { name: 'Priority feature', exact: true });
  assert.equal(await feature.getByText('Priority ready', { exact: true }).count(), 1);
  assert.equal(await feature.getByRole('button', { name: 'Set priority', exact: true }).count(), 1);
  assert.equal((await page.evaluate(() => window.resources())).active, 1);
  await preserved();
  const opened = (await page.evaluate(() => window.resources())).opens;
  await publish({ loading: true });
  await absent('Release loading');
  // Rolling back to release 1 activates generation 3: release and generation
  // numbers are distinct, and the missing operation remains gated.
  await publish(catalog(3, false));
  await absent('Generation 3');
  assert.equal((await page.evaluate(() => window.resources())).opens, opened);
  await publish({ loading: true });
  await absent('Release loading');
  await publish(catalog(4, true));
  assert.equal(await page.getByText('Priority ready', { exact: true }).count(), 1);
  assert.equal((await page.evaluate(() => window.resources())).active, 1);
  assert.ok((await page.evaluate(() => window.resources())).opens > opened);
  await preserved();
  await publish({ denied: { code: 'E_AUTH', family: 'auth', message: 'Sign in again' } });
  await absent('Release denied');
  const final = await page.evaluate(() => window.finish());
  assert.equal(final.active, 0); assert.equal(final.listeners, 0);
  assert.deepEqual(errors, []);
});

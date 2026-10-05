// @ref LLP 3000.028#7.1 — actual React snapshots with delayed route/decoration reads.
import test from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { chromiumExecutable } from '../../../witness/lib.mjs';
import { mintId } from '../../../packages/snapback4/dist/client.js';
import { host, root, sent } from './harness.mjs';
import { createBrowserServer, loadBrowserPage, reloadBrowserPage } from '../../../packages/snapback4/test/helpers/browser-server.mjs';
const require = createRequire(join(root, 'package.json'));
const { chromium } = require('playwright-core');

test('React/IndexedDB: original receipt hook keeps one ordinary history through delayed decorations, leave, remount, reopen and rejoin', { timeout: 90000 }, async t => {
  const h = await host(t), owner = h.online({ persona: 'eqowner' }), reader = h.online({ persona: 'eqreader' });
  for (const [client, name] of [[owner, 'eqowner'], [reader, 'eqreader']]) await sent(client, 'saveProfile', { displayName: name, handle: name, bio: '', location: '', link: null });
  const conversation = mintId(), before = mintId(), later = mintId();
  await sent(owner, 'createGroup', { id: conversation, other: 'dev:eqreader', title: 'Stable EQ route', description: '' });
  await sent(owner, 'send', { id: before, conversation, text: 'retained browser message', quote: null });
  const app = join(h.dir, 'browser'); mkdirSync(app);
  writeFileSync(join(app, 'index.html'), '<div id="root"></div><script type="module" src="/main.jsx"></script>');
  writeFileSync(join(app, 'receipts.ts'), readFileSync(join(import.meta.dirname, 'receipts.ts'), 'utf8').replace('../snapback/generated/api', 'fixture-api'));
  writeFileSync(join(app, 'main.jsx'), browserSource.replace('SERVER_CONFIG', JSON.stringify({ url: h.url, conversation })));
  const vite = await createBrowserServer({ root: app, configFile: false, logLevel: 'error', server: { host: '127.0.0.1', port: 0, fs: { allow: [root] } }, resolve: { alias: [
    { find: 'fixture-api', replacement: join(h.dir, 'snapback/generated/api.ts') },
    { find: /^react$/, replacement: require.resolve('react') },
    { find: /^react-dom\/client$/, replacement: require.resolve('react-dom/client') },
    ...['client', 'local', 'web', 'react'].map(name => ({ find: `snapback4/${name}`, replacement: join(root, `packages/snapback4/src/${name}.${name === 'react' ? 'tsx' : 'ts'}`) })),
  ] } });
  await vite.listen(); const browser = await chromium.launch({ executablePath: chromiumExecutable(), headless: true, args: ['--no-sandbox'] });
  t.after(async () => { await browser.close(); await vite.close(); });
  const page = await browser.newPage(), errors = []; page.on('pageerror', error => errors.push(String(error)));
  await loadBrowserPage(t, page, vite.resolvedUrls.local[0]);
  const ready = async expected => {
    try { await page.waitForFunction(expected => window.latest?.ids?.join() === expected.join(), expected); }
    catch (error) { h.record('browser-failure', { errors, snapshots: await page.evaluate(() => window.snapshots), error: String(error) }); throw error; }
  };
  await ready([before]); await page.locator('#draft').fill('draft survives'); await page.locator('#draft').focus();
  await page.evaluate(() => { window.input = document.querySelector('#draft'); window.delayReads = true; });
  await sent(owner, 'removeMember', { conversation, principal: 'dev:eqreader' });
  await page.evaluate(() => window.client.sync());
  await page.waitForFunction(() => window.delayed.length >= 2);
  await ready([before]);
  assert.equal(await page.evaluate(() => document.querySelector('#draft') === window.input && document.activeElement === window.input), true);
  assert.equal(await page.locator('#draft').inputValue(), 'draft survives');
  await page.evaluate(() => window.release());
  await page.waitForFunction(() => window.latest.archived === true); await ready([before]);
  await sent(owner, 'send', { id: later, conversation, text: 'post departure', quote: null });
  await page.evaluate(() => window.client.sync()); await ready([before]);
  await page.evaluate(() => window.remount()); await ready([before]);
  const observations = await page.evaluate(() => ({ snapshots: window.snapshots, requests: window.requests, delayed: window.delayCount }));
  h.record('browser-before-reload', observations); assert.ok(observations.delayed >= 2);
  for (const snapshot of observations.snapshots.filter(s => s.ids.length)) assert.deepEqual(snapshot.ids, [before]);
  assert.ok(!observations.requests.includes('/q/history'), 'retained history never falls back');
  await page.evaluate(() => { localStorage.setItem('eq-offline', '1'); window.offline = true; });
  await reloadBrowserPage(page); await ready([before]);
  assert.equal(await page.evaluate(() => window.latest.read.fresh), false);
  await sent(owner, 'addMember', { conversation, principal: 'dev:eqreader' });
  await page.evaluate(async () => { localStorage.removeItem('eq-offline'); window.offline = false; await window.client.sync(); });
  await ready([later, before]);
  assert.deepEqual(errors, []); h.record('browser-after-reopen-rejoin', await page.evaluate(() => ({ snapshots: window.snapshots, requests: window.requests })));
  await page.evaluate(() => window.client.close());
});

const browserSource = `
import React, { useState } from 'react';
import { createRoot } from 'react-dom/client';
import { createLocalClient } from 'snapback4/local';
import { webDevice } from 'snapback4/web';
import { SnapbackProvider, useQuery } from 'snapback4/react';
import { useReceipts } from './receipts';
const { url, conversation } = SERVER_CONFIG;
window.offline = localStorage.getItem('eq-offline') === '1';
window.snapshots = []; window.requests = []; window.delayed = []; window.delayCount = 0;
window.release = () => { window.delayReads = false; for (const resolve of window.delayed.splice(0)) resolve(); };
const opener = webDevice();
window.client = await createLocalClient({ url, persona: 'eqreader', waitSeconds: 0,
  device: { async open(...args) { const core = await opener.open(...args); return { close: () => core.close(), async call(request, ...rest) {
    const answer = await core.call(request, ...rest);
    if (window.delayReads && request.op === 'query' && ['progress', 'conversationScreen'].includes(request.name)) {
      window.delayCount++; await new Promise(resolve => window.delayed.push(resolve));
    }
    return answer;
  } }; } },
  fetch: async (input, init) => {
    if (window.offline) throw new TypeError('EQ offline');
    const path = new URL(input).pathname; window.requests.push(path);
    if (path === '/changes') return new Response(new ReadableStream({ start(controller) {
      const timer = setInterval(() => controller.enqueue(new Uint8Array([32, 10])), 500);
      init.signal.addEventListener('abort', () => { clearInterval(timer); controller.error(Error('closed')); }, { once: true });
    } }));
    return fetch(input, init);
  }
});
await window.client.sync();
function History() {
  const page = useReceipts(conversation, false);
  window.latest = { ids: page.items.map(row => row.id), read: page.read, archived: page.archived };
  window.snapshots.push(window.latest);
  return <section>{page.items.map(row => <article key={row.id} data-message={row.id}>{row.text}</article>)}</section>;
}
function Screen() {
  const route = useQuery({ kind: 'query', name: 'conversationScreen' }, { conversation }, { keep: true });
  const [draft, setDraft] = useState(''); const [mount, setMount] = useState(0);
  window.remount = () => setMount(n => n + 1);
  return <main data-route={conversation}><h1>{route.data?.title ?? 'Loading route'}</h1><History key={mount} /><input id="draft" value={draft} onChange={e => setDraft(e.target.value)} /></main>;
}
createRoot(document.querySelector('#root')).render(<SnapbackProvider client={window.client}><Screen /></SnapbackProvider>);
`;

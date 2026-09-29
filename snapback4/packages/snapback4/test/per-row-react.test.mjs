// @ref LLP 3000.023#7 — key-order-only React renders preserve the observation and page chain.
import test from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { mkdtempSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { chromiumExecutable } from '../../../witness/lib.mjs';
const root = resolve(import.meta.dirname, '../../..');

async function browserFixture(t, harness) {
  const require = createRequire(join(root, 'packages/snapback4/package.json'));
  const { chromium } = createRequire(join(root, 'package.json'))('playwright-core');
  const { createServer } = await import(pathToFileURL(createRequire(join(root, 'apps/chat/package.json')).resolve('vite')).href);
  const temporary = mkdtempSync(join(tmpdir(), 'sb4-row-keys-'));
  let server, browser;
  t.after(async () => { await browser?.close(); await server?.close(); rmSync(temporary, { recursive: true, force: true }); });
  writeFileSync(join(temporary, 'index.html'), '<div id="root"></div><script type="module" src="/harness.jsx"></script>');
  writeFileSync(join(temporary, 'harness.jsx'), harness);
  server = await createServer({ root: temporary, configFile: false, logLevel: 'error',
    server: { host: '127.0.0.1', port: 0, fs: { allow: [root, temporary] } },
    resolve: { alias: [
      { find: /^react$/, replacement: require.resolve('react') },
      { find: /^react\/jsx-runtime$/, replacement: require.resolve('react/jsx-runtime') },
      { find: /^react\/jsx-dev-runtime$/, replacement: require.resolve('react/jsx-dev-runtime') },
      { find: /^react-dom\/client$/, replacement: require.resolve('react-dom/client') },
      ...['client', 'react'].map(name => ({ find: `snapback4/${name}`, replacement: join(root, `packages/snapback4/src/${name}.${name === 'react' ? 'tsx' : 'ts'}`) })),
    ] } });
  await server.listen();
  browser = await chromium.launch({ executablePath: chromiumExecutable(), headless: true, args: ['--no-sandbox'] });
  const page = await browser.newPage();
  await page.goto(server.resolvedUrls.local[0]);
  return page;
}

test('useQuery and usePage keep canonical arguments across renders, preserving loaded pages', async t => {
  const page = await browserFixture(t, harness);
  await page.waitForFunction(() => window.latest?.query.data && window.latest.page.items.length === 1);
  await page.evaluate(() => window.latest.page.loadMore());
  await page.waitForFunction(() => window.latest.page.items.length === 2);
  const before = await page.evaluate(() => window.calls);
  assert.equal(before, 3);
  await page.evaluate(() => { window.loading = 0; window.change(1); });
  await page.waitForFunction(() => window.latest?.mode === 1);
  await page.evaluate(() => new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve))));
  assert.deepEqual(await page.evaluate(() => ({ calls: window.calls, loading: window.loading, rows: window.latest.page.items.length })),
    { calls: before, loading: 0, rows: 2 });
  await page.evaluate(() => window.change(2)); // A different retention policy owns different watches.
  await page.waitForFunction(n => window.calls >= n + 2 && window.latest.query.data && window.latest.page.items.length === 1, before);
  const afterPolicy = await page.evaluate(() => window.calls);
  await page.evaluate(() => window.change(3)); // Array order is significant.
  await page.waitForFunction(n => window.calls >= n + 2 && window.latest.query.data, afterPolicy);
  await page.evaluate(() => window.finish());
});

const harness = `
import React, { useState } from 'react';
import { createRoot } from 'react-dom/client';
import { createClient } from 'snapback4/client';
import { SnapbackProvider, useQuery, usePage } from 'snapback4/react';
window.calls = 0; window.loading = 0;
const client = createClient({ url: 'http://row-keys.test', persona: 'alice', fetch: async (input, init) => {
  const path = new URL(input).pathname;
  if (path === '/schema') return Response.json({ schema: { tables: {} }, programs: [], generation: 1 });
  if (path === '/changes') return new Promise((_, reject) => {
    if (init.signal.aborted) reject(Error('closed'));
    else init.signal.addEventListener('abort', () => reject(Error('closed')), { once: true });
  });
  if (path.startsWith('/q/')) {
    window.calls++;
    const args = JSON.parse(init.body).args;
    return Response.json({ data: [args.c ? 2 : 1], complete: true, next: args.c ? null : 'next', seq: 1, tables: ['cards'] });
  }
  throw Error(path);
} });
const q = {kind:'query',name:'one'}, p = {kind:'query',name:'page'};
await client.query(q, {}); window.calls = 0;
function Screen() {
  const [mode, change] = useState(0); window.change = change;
  const ids = mode === 3 ? [2,1] : [1,2];
  const args = mode === 0 ? {id:'a', filter:{x:1,y:2}, ids} : {ids, filter:{y:2,x:1}, id:'a'};
  const options = mode >= 2 ? {keep:true} : undefined;
  const query = useQuery(q, args, options), page = usePage(p, args, options);
  if (query.loading || page.read.loading) window.loading++;
  window.latest = {mode,query,page};
  return <span>{page.items.length}</span>;
}
const root = createRoot(document.getElementById('root'));
root.render(<SnapbackProvider client={client}><Screen /></SnapbackProvider>);
window.finish = async () => { root.unmount(); await client.close(); };
`;


test('1,000 per-row useQuery hooks: a relevant write renders revalidating answers with zero loading renders', async t => {
  const page = await browserFixture(t, rowsHarness);
  await page.waitForFunction(() => window.ready === 1000);
  await page.evaluate(() => { window.loading = 0; window.revalidating = 0; window.edit(); });
  await page.waitForFunction(() => window.changed === 1000);
  assert.deepEqual(await page.evaluate(() => ({ loading: window.loading, calls: window.calls, rows: window.changed })),
    { loading: 0, calls: 2000, rows: 1000 });
  assert.ok(await page.evaluate(() => window.revalidating > 0), 'queued rows keep an explicitly revalidating answer');
  await page.evaluate(() => window.finish());
});
const rowsHarness = `
import React from 'react';
import { createRoot } from 'react-dom/client';
import { createClient } from 'snapback4/client';
import { SnapbackProvider, useQuery } from 'snapback4/react';
window.calls = 0; window.loading = 0; window.ready = 0; window.changed = 0; window.revalidating = 0;
// Keep the separate LLP 3000.023 retention clock fixed: this test pins queue
// transitions, and does not select RL's concurrent retention policy.
const wall = Date.now(); Date.now = () => wall;
let seq = 1, change;
const client = createClient({ url: 'http://row-render.test', persona: 'alice', fetch: async (input, init) => {
  const path = new URL(input).pathname;
  if (path === '/schema') return Response.json({ schema: { tables: {} }, programs: [], generation: 1 });
  if (path === '/changes') return new Promise((resolve, reject) => {
    change = () => resolve(Response.json({seq, generation: 1, tables: ['cards']}));
    init.signal.addEventListener('abort', () => reject(Error('closed')), {once: true});
  });
  if (path.startsWith('/q/')) { window.calls++; return Response.json({data: seq, seq, tables: ['cards']}); }
  throw Error(path);
} });
const op = {kind:'query', name:'row'}, ready = new Set(), changed = new Set();
await client.query(op, {}); window.calls = 0;
function Row({id}) {
  const read = useQuery(op, {id});
  if (read.loading) window.loading++;
  if (read.revalidating) window.revalidating++;
  if (read.data === 1) ready.add(id);
  if (read.data === 2 && !read.revalidating) changed.add(id);
  window.ready = ready.size; window.changed = changed.size;
  return <span>{read.data}</span>;
}
const root = createRoot(document.getElementById('root'));
root.render(<SnapbackProvider client={client}>{Array.from({length:1000}, (_,id) => <Row key={id} id={id}/>)}</SnapbackProvider>);
window.edit = () => { seq++; change(); };
window.finish = async () => { root.unmount(); await client.close(); };
`;

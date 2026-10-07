import { createBrowserServer, loadBrowserPage } from './helpers/browser-server.mjs';
import { hangBudget } from './helpers/wait.mjs';
// @ref LLP 3000.008.002.000#6 — opaque transports must allow healthy bodies to finish without replaying a view.
import test from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { mkdtempSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { chromiumExecutable } from '../../../witness/lib.mjs';

const root = resolve(import.meta.dirname, '../../..');
const png = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAusB9Wl6V9sAAAAASUVORK5CYII=', 'base64');

test('healthy HTTP chunks every 500 ms for six seconds paint without wait diagnostics, ordinary and once', { timeout: hangBudget(12) }, async t => {
  const require = createRequire(join(root, 'packages/snapback4/package.json'));
  const { chromium } = createRequire(join(root, 'package.json'))('playwright-core');

  const dir = mkdtempSync(join(tmpdir(), 'sb4-buffered-'));
  const requests = [], completed = [];
  let server, browser;
  t.after(async () => { await browser?.close(); await server?.close(); rmSync(dir, { recursive: true, force: true }); });
  writeFileSync(join(dir, 'index.html'), '<div id="root"></div><script type="module" src="/test.jsx"></script>');
  writeFileSync(join(dir, 'test.jsx'), `
    import React from 'react';
    import { createRoot } from 'react-dom/client';
    import { createClient } from 'snapback4/client';
    import { SnapbackProvider, useAsset } from 'snapback4/react';
    const client = createClient({ url: location.origin, persona: 'alice', fetch: async (url, init) => {
      const response = await fetch(url, init);
      if (!response.ok || url.includes('/stream-')) return response;
      // One host exposes headers then a streamless Blob; another exposes only
      // completion. Both consume actual HTTP bytes, with no simulated clock.
      const blob = url.includes('/completion-') ? await response.blob() : null;
      return { ok: response.ok, status: response.status, headers: response.headers,
        body: null, blob: () => blob ? Promise.resolve(blob) : response.blob() };
    } });
    window.states = {}; window.waits = [];
    function Photo({ id }) {
      const read = useAsset(id); window.states[id] = { status: read.status, why: read.why };
      if (read.waiting) window.waits.push({ id, ...read.waiting });
      return read.status === 'ready' ? <img data-id={id} src={read.url} /> : null;
    }
    const ids = ['completion-ordinary', 'completion-once', 'blob-ordinary', 'blob-once', 'stream-ordinary', 'stream-once'];
    const root = createRoot(document.getElementById('root'));
    root.render(<SnapbackProvider client={client}>{ids.map(id => <Photo key={id} id={id} />)}</SnapbackProvider>);
    window.finish = async () => { root.unmount(); await client.close(); };
  `);
  server = await createBrowserServer({ root: dir, configFile: false, logLevel: 'error',
    server: { host: '127.0.0.1', port: 0, fs: { allow: [root, dir] } },
    resolve: { alias: [
      ...['react', 'react/jsx-runtime', 'react/jsx-dev-runtime', 'react-dom/client'].map(name => ({ find: new RegExp('^' + name + '$'), replacement: require.resolve(name) })),
      ...['client', 'react'].map(name => ({ find: 'snapback4/' + name, replacement: join(root, 'packages/snapback4/dist', name + '.js') })),
      { find: '#fetch', replacement: join(root, 'packages/snapback4/dist/default-fetch.js') },
    ] }, plugins: [{ name: 'slow-real-assets', configureServer(vite) {
      vite.middlewares.use((request, response, next) => {
        if (!request.url.startsWith('/assets/')) return next();
        const id = request.url.slice('/assets/'.length), range = request.headers.range;
        requests.push({ id, range });
        if (id.endsWith('-once') && range) {
          response.writeHead(416, { 'content-type': 'application/json' });
          return response.end(JSON.stringify({ denied: { code: 'E_ASSET_RANGE', family: 'asset', message: 'once refuses range' } }));
        }
        // Fail any replay promptly, so the old five-second implementation has
        // a finite red result instead of making four identical slow requests.
        if (requests.filter(r => r.id === id && r.range === range).length > 1) {
          response.writeHead(404, { 'content-type': 'application/json' });
          return response.end(JSON.stringify({ denied: { code: 'E_ASSET_UNKNOWN', family: 'asset', message: 'unexpected replay' } }));
        }
        const started = Date.now();
        response.writeHead(200, { 'content-type': 'image/png', 'content-length': String(png.length), 'accept-ranges': id.endsWith('-once') ? 'none' : 'bytes' });
        response.flushHeaders();
        let part = 0, offset = 0;
        const timer = setInterval(() => {
          const end = Math.floor(png.length * ++part / 12);
          response.write(png.subarray(offset, end)); offset = end;
          if (part === 12) { clearInterval(timer); completed.push({ id, ms: Date.now() - started }); response.end(); }
        }, 500);
        response.on('close', () => clearInterval(timer));
      });
    } }] });
  await server.listen();
  browser = await chromium.launch({ timeout: hangBudget(), executablePath: chromiumExecutable(), headless: true, args: ['--no-sandbox'] });
  const page = await browser.newPage();
  page.setDefaultTimeout(hangBudget()); page.setDefaultNavigationTimeout(hangBudget());
  await loadBrowserPage(t, page, server.resolvedUrls.local[0]);
  await page.waitForFunction(() => Object.keys(window.states ?? {}).length === 6 && Object.values(window.states).every(s => s.status !== 'loading'));
  const states = await page.evaluate(() => window.states);
  assert.ok(Object.values(states).every(s => s.status === 'ready'), JSON.stringify(states));
  await page.waitForFunction(() => document.querySelectorAll('img').length === 6 && [...document.querySelectorAll('img')].every(img => img.complete && img.naturalWidth > 0));
  const waits = await page.evaluate(() => window.waits);
  assert.deepEqual(waits.filter(wait => wait.why), [], 'healthy streaming and opaque transfers never claim a stall');
  for (const id of ['stream-ordinary', 'stream-once']) {
    const progress = waits.filter(wait => wait.id === id && wait.stage === 'body');
    assert.ok(progress.some(wait => wait.received > 0 && wait.received < png.length), 'received bytes are visible before readiness');
    assert.ok(progress.every(wait => wait.total === png.length));
    assert.ok(progress.at(-1).diagnosticAt > progress[0].diagnosticAt + 5000, 'byte progress extends the five-second deadline');
  }
  assert.equal(completed.length, 6);
  assert.ok(completed.every(r => r.ms > 5000), JSON.stringify(completed));
  assert.equal(requests.length, 9, 'one ordinary request or one probe plus one once transfer');
  t.diagnostic(JSON.stringify({ completed, requests, states }));
  await page.evaluate(() => window.finish());
});

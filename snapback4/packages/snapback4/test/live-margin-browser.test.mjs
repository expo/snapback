// @ref LLP 3000.023#12 — same-schema set/delete and offline settlement on React/IndexedDB.
import test from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { mkdtempSync, readFileSync, writeFileSync, rmSync } from 'node:fs';
import { request } from 'node:http';
import { join } from 'node:path';
import { tmpdir, loadavg } from 'node:os';
import { fixture } from './helpers/answers-stay.mjs';
import { marginSource } from './helpers/live-margin.mjs';
import { hangBudget } from './helpers/wait.mjs';
import { chromiumExecutable, root } from '../../../witness/lib.mjs';

test('React/IndexedDB live margin and two-device offline settlement', { timeout: hangBudget(800) }, async t => {
  const cleanup = [], local = { after: fn => cleanup.push(fn) };
  t.after(async () => { for (const fn of cleanup.reverse()) await fn(); });
  const dir = mkdtempSync(join(tmpdir(), 'sb4-lm-'));
  cleanup.push(() => rmSync(dir, { recursive: true, force: true }));
  const trace = join(dir, 'server.jsonl');
  const previous = process.env.SNAPBACK4_READ_TRACE;
  process.env.SNAPBACK4_READ_TRACE = trace;
  let f;
  try { f = await fixture(local, marginSource); }
  finally { if (previous === undefined) delete process.env.SNAPBACK4_READ_TRACE; else process.env.SNAPBACK4_READ_TRACE = previous; }
  const require = createRequire(join(root, 'package.json'));
  const { chromium } = require('playwright-core');
  const { createServer } = await import(createRequire(join(root, 'apps/chat/package.json')).resolve('vite'));
  const pkg = createRequire(join(root, 'packages/snapback4/package.json'));
  const requests = [], active = new Set(); let nextRequest = 0;
  const browserSource = new URL('./helpers/live-margin-browser.mjs', import.meta.url).pathname;
  writeFileSync(join(dir, 'index.html'), `<div id="root"></div><script type="module" src="/@fs/${browserSource}"></script>`);
  const vite = await createServer({ root: dir, configFile: false, logLevel: 'error', server: { hmr: false, host: '127.0.0.1', port: 0, fs: { allow: [root, dir] } },
    resolve: { alias: [
      ...['react', 'react-dom', 'react-dom/client'].map(name => ({ find: new RegExp('^' + name + '$'), replacement: pkg.resolve(name) })),
      { find: /^lm-sdk\/(.*)$/, replacement: join(root, 'packages/snapback4/dist/$1.js') },
    ] }, plugins: [{ name: 'lm-test-proxy', configureServer(server) {
      server.middlewares.use((req, res, next) => {
        if (!req.url.startsWith('/backend/')) return next();
        const id = ++nextRequest, path = req.url.slice('/backend'.length);
        const row = { id, path, persona: req.headers['x-snapback-persona'], start: Number(process.hrtime.bigint()) / 1e6 };
        requests.push(row);
        const up = request(f.url + path, { method: req.method, headers: { ...req.headers, host: new URL(f.url).host, 'x-snapback-ct': String(id) } }, response => {
          res.writeHead(response.statusCode, { ...response.headers, 'x-lm-request': String(id) });
          response.pipe(res); response.on('end', () => { row.end = Number(process.hrtime.bigint()) / 1e6; active.delete(up); });
        });
        active.add(up); up.on('error', e => { active.delete(up); if (!res.destroyed) res.destroy(e); });
        res.on('close', () => { up.destroy(); active.delete(up); }); req.pipe(up);
      });
    } }] });
  await vite.listen(); cleanup.push(async () => { for (const req of active) req.destroy(); await vite.close(); });
  const browser = await chromium.launch({ executablePath: chromiumExecutable(), headless: true, args: ['--no-sandbox'], timeout: hangBudget() });
  cleanup.push(() => browser.close());
  const page = await browser.newPage(); const errors = [];
  page.on('pageerror', e => errors.push(e.message));
  page.setDefaultTimeout(hangBudget()); page.setDefaultNavigationTimeout(hangBudget());
  await page.goto(vite.resolvedUrls.local[0]); await page.waitForFunction(() => window.lmOpen);
  const calibration = [];
  for (let i = 0; i < 9; i++) {
    const before = Number(process.hrtime.bigint()) / 1e6;
    const client = await page.evaluate(() => window.lmClock());
    const after = Number(process.hrtime.bigint()) / 1e6;
    calibration.push({ offset: (before + after) / 2 - client, uncertainty: (after - before) / 2 });
  }
  calibration.sort((a, b) => a.uncertainty - b.uncertainty);
  const n = Number(process.env.LM_N ?? 1), pressure = Number(process.env.LM_PRESSURE ?? 120), loads = [{ at: Date.now(), load: loadavg() }];
  const sampler = setInterval(() => loads.push({ at: Date.now(), load: loadavg() }), 1000);
  cleanup.push(() => clearInterval(sampler));
  const opened = await page.evaluate(n => window.lmOpen(n), pressure);
  const live = await page.evaluate(n => window.lmRun(n), n);
  const offline = await page.evaluate(n => window.lmOffline(n), n);
  await page.evaluate(() => window.lmClose());
  const result = { label: process.env.LM_LABEL ?? 'smoke', n, pressure, opened, loads, calibration, requests, events: offline.events,
    decorationCommits: offline.decorationCommits, inspections: offline.inspections, server: readFileSync(trace, 'utf8').trim().split('\n').filter(Boolean).map(x => JSON.parse(x)), errors };
  if (process.env.LM_OUT) writeFileSync(process.env.LM_OUT, JSON.stringify(result));
  assert.deepEqual(errors, []);
  const trials = result.events.filter(e => e.kind === 'trial-start');
  assert.equal(trials.length, 6 * n);
  assert.equal(result.events.filter(e => e.kind === 'trial-end').length, trials.length);
  // Record every unavailable/partial publication, rather than hiding it in a
  // "best of" trial. Removal may withdraw under the existing one-second rule.
  const settling = result.events.filter(e => e.phase === 'settling' && e.kind === 'render');
  t.diagnostic(JSON.stringify({ n, pressure, trials: trials.length, decorationCommits: offline.decorationCommits, emptyDuringSettlement: settling.filter(e => e.items.length === 0).length,
    loadingDuringSettlement: settling.filter(e => e.history.loading).length, partialDuringSettlement: settling.filter(e => e.history.complete === false).length,
    clockUncertaintyMs: calibration[0].uncertainty, liveInspections: live.inspections }));
});

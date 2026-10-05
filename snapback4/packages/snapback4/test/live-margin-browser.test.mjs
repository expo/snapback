import { createBrowserServer } from './helpers/browser-server.mjs';
// @ref LLP 3000.023#12 — same-schema set/delete and offline settlement on React/IndexedDB.
import test from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { mkdtempSync, readFileSync, writeFileSync, rmSync } from 'node:fs';
import { request } from 'node:http';
import { join } from 'node:path';
import { tmpdir, loadavg } from 'node:os';
import { fixture, until } from './helpers/answers-stay.mjs';
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

  const pkg = createRequire(join(root, 'packages/snapback4/package.json'));
  const requests = [], active = new Set(); let nextRequest = 0;
  const browserSource = new URL('./helpers/live-margin-browser.mjs', import.meta.url).pathname;
  writeFileSync(join(dir, 'index.html'), `<div id="root"></div><script type="module" src="/@fs/${browserSource}"></script>`);
  const vite = await createBrowserServer({ root: dir, configFile: false, logLevel: 'error', server: { hmr: false, host: '127.0.0.1', port: 0, fs: { allow: [root, dir] } },
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
  const trials = offline.events.filter(e => e.kind === 'trial-start');
  const liveTrials = trials.filter(e => e.phase !== 'offline');
  const receipts = liveTrials.map(start => {
    const events = offline.events.filter(e => e.trial === start.trial);
    const receipt = events.find(e => e.kind === 'http-end' && e.persona === 'alice' && e.path.startsWith('/m/'));
    const mutation = events.find(e => e.kind === 'mutation-return');
    assert.ok(receipt && mutation?.id, `trial ${start.trial} has a live mutation receipt`);
    return { trial: start.trial, receipt, mutation };
  });
  const replays = [];
  for (const { trial, receipt, mutation } of receipts) {
    const id = ++nextRequest;
    const response = await fetch(f.url + receipt.path, { method: 'POST',
      headers: { 'x-snapback-persona': 'alice', 'x-snapback-ct': String(id) },
      body: JSON.stringify({ id: mutation.id, args: mutation.args }) });
    const reply = await response.json();
    assert.equal(reply.state, 'sent'); assert.equal(reply.replayed, true);
    assert.equal(reply.id, mutation.id);
    replays.push({ trial, request: id, reply });
  }
  // The trace is appended after the response. Wait for those specific records,
  // ignoring an incomplete trailing line while the host finishes its write.
  const readTrace = () => readFileSync(trace, 'utf8').split('\n').slice(0, -1).filter(Boolean).map(x => JSON.parse(x));
  const tracedIds = [...receipts.map(x => Number(x.receipt.request)), ...replays.map(x => x.request)];
  await until(() => { const ids = new Set(readTrace().map(x => x.id)); return tracedIds.every(id => ids.has(id)); }, 'live and replay traces written');
  const result = { label: process.env.LM_LABEL ?? 'smoke', n, pressure, opened, loads, calibration, requests, events: offline.events,
    decorationCommits: offline.decorationCommits, inspections: offline.inspections, server: readTrace(), replays, errors };
  if (process.env.LM_OUT) writeFileSync(process.env.LM_OUT, JSON.stringify(result));
  assert.deepEqual(errors, []);
  assert.equal(trials.length, 6 * n);
  assert.equal(result.events.filter(e => e.kind === 'trial-end').length, trials.length);
  assert.equal(receipts.length, 5 * n);
  // @ref LLP 3000.019#3.7 — only a new user mutation receives the post-commit, pre-wake stamp.
  for (const { trial, receipt } of receipts) {
    const stamp = result.server.find(s => String(s.id) === receipt.request);
    assert.ok(stamp.started < stamp.mutation_commit && stamp.mutation_commit < stamp.encode_start,
      `trial ${trial}: mutation_commit must be strictly after started and before encode_start: ${JSON.stringify(stamp)}`);
  }
  for (const replay of replays) assert.equal(result.server.find(s => s.id === replay.request).mutation_commit, 0,
    `trial ${replay.trial}: posting the same mutation id again must not stamp a commit`);
  assert.equal(result.events.filter(e => e.kind === 'settled-lists').length, 2 * n);
  // Record every unavailable/partial publication, rather than hiding it in a
  // "best of" trial. Removal may withdraw under the existing one-second rule.
  const settling = result.events.filter(e => e.phase === 'settling' && e.kind === 'render');
  t.diagnostic(JSON.stringify({ n, pressure, trials: trials.length, decorationCommits: offline.decorationCommits, emptyDuringSettlement: settling.filter(e => e.items.length === 0).length,
    loadingDuringSettlement: settling.filter(e => e.history.loading).length, partialDuringSettlement: settling.filter(e => e.history.complete === false).length,
    clockUncertaintyMs: calibration[0].uncertainty, liveInspections: live.inspections }));
});

import { hangBudget } from './helpers/wait.mjs';
// @ref LLP 3000.023#10 — two independent offline writers converge without queue-only history gaps.
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, writeFileSync, mkdtempSync, rmSync } from 'node:fs';
import { createRequire } from 'node:module';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';
import { tmpdir } from 'node:os';
import { server, binary, until } from './helpers/app-server.mjs';
import { chromiumExecutable } from '../../../witness/lib.mjs';
import { createLocalClient } from '../dist/local.js';
import { processDevice } from '../dist/native.js';
import { pressureDriver, pressureDevice } from './helpers/subscription-pressure-driver.mjs';
const root = new URL('../../../', import.meta.url).pathname;
const source = readFileSync(new URL('./helpers/subscription-pressure.q', import.meta.url), 'utf8');
const require = createRequire(join(root, 'package.json'));

for (const tier of ['wasm', 'process']) test(`${tier}: two offline devices, 124 mounted observations each, exactly-once history`, { timeout: hangBudget(2 * 124) }, async t => {
  const drivers = [], pages = [], renders = [Promise.resolve(), Promise.resolve()];
  t.after(async () => { for (const driver of drivers) await driver.close(); await Promise.all(renders); });
  const { url, dir } = await server(t, '', source);
  const rows = [{ table: 'rooms', row: { id: 'room', title: 'Chat' } }, ...['alice', 'bob'].map(name => ({ table: 'members', row: { id: name, room: 'room', principal: 'dev:' + name } })),
    ...Array.from({ length: 40 }, (_, i) => ({ table: 'messages', row: { id: 'm' + i, room: 'room', sender: 'dev:alice', ordinal: i, text: 'History ' + i } })),
    ...Array.from({ length: 40 }, (_, i) => ({ table: 'profiles', row: { id: 'p' + i, principal: 'dev:p' + i, name: 'Person ' + i } })),
    ...Array.from({ length: 40 }, (_, i) => ({ table: 'reactions', row: { id: 'r' + i, message: 'm' + i, principal: 'dev:alice', emoji: 'ok' } })),
    ...Array.from({ length: 40 }, (_, i) => ({ table: 'receipts', row: { id: 'seen' + i, message: 'm' + i, principal: 'dev:bob' } })),
    ...['alice','bob'].map((name, i) => ({ table: 'posts', row: { id: name, author: 'dev:' + name, text: 'Post', at: i } }))];
  const seeded = await fetch(url + '/seed', { method: 'POST', body: JSON.stringify(rows) }).then(r => r.json());
  assert.equal(seeded.seeded, rows.length, JSON.stringify(seeded));
  const pageDir = mkdtempSync(join(tmpdir(), 'sb4-pr-browser-'));
  t.after(() => rmSync(pageDir, { recursive: true, force: true }));
  writeFileSync(join(pageDir, 'index.html'), '<div id="root"></div><script type="module" src="/page.jsx"></script>');
  writeFileSync(join(pageDir, 'page.jsx'), `
import React from 'react'; import { createRoot } from 'react-dom/client'; import { flushSync } from 'react-dom';
import { createLocalClient } from '${root}packages/snapback4/dist/local.js';
import { webDevice } from '${root}packages/snapback4/dist/web.js';
import { pressureDriver, pressureDevice } from '${root}packages/snapback4/test/helpers/subscription-pressure-driver.mjs';
const root = createRoot(document.getElementById('root')); window.rendered = [];
window.renderRead = read => { flushSync(() => root.render(<main>{'data' in read ? read.data.map(row => <p key={row.id} data-id={row.id}>{row.text}</p>) : 'Withdrawn'}</main>)); window.rendered.push({ at: performance.now(), ids: [...document.querySelectorAll('[data-id]')].map(e => e.dataset.id) }); };
window.openPressure = async ({url,persona,holdMs}) => { const state = { holdMs, phase: 'mounted' }; const client = await createLocalClient({ url, persona, device: pressureDevice(webDevice(), state), fetch: (input, init) => { if (state.offline) return Promise.reject(Error('offline device')); return fetch(input, init); } }); await client.sync(); window.driver = await pressureDriver(client, state, window.renderRead); };
`);
  const { createServer } = await import(pathToFileURL(createRequire(join(root, 'apps/chat/package.json')).resolve('vite')));
  const pkg = createRequire(join(root, 'packages/snapback4/package.json'));
  const vite = await createServer({ root: pageDir, configFile: false, logLevel: 'error', server: { hmr: false, host: '127.0.0.1', port: 0, fs: { allow: [root, pageDir] } }, resolve: { alias: ['react','react-dom','react-dom/client','react/jsx-runtime','react/jsx-dev-runtime'].map(name => ({ find: new RegExp('^' + name + '$'), replacement: pkg.resolve(name) })) } });
  await vite.listen(); t.after(() => vite.close());
  const { chromium } = require('playwright-core');
  const browser = await chromium.launch({ timeout: hangBudget(), executablePath: chromiumExecutable(), headless: true, args: ['--no-sandbox', '--disable-background-timer-throttling'] });
  t.after(() => browser.close());
  for (const [i, persona] of ['alice','bob'].entries()) {
    const context = await browser.newContext(), page = await context.newPage();
  page.setDefaultTimeout(hangBudget()); page.setDefaultNavigationTimeout(hangBudget()); pages.push(page);
    page.on('pageerror', error => t.diagnostic(error.stack));
    await page.goto(vite.resolvedUrls.local[0]); await page.waitForFunction(() => window.openPressure);
    if (tier === 'wasm') {
      await page.evaluate(options => window.openPressure(options), { url, persona, holdMs: Number(process.env.PR_HOLD_MS ?? 0) });
      drivers.push(Object.fromEntries(['offline','send','reconnect','sync','releaseHistory','settle','result','close'].map(method => [method, (...args) => page.evaluate(({method,args}) => window.driver[method](...args), {method,args})])));
    } else {
      const state = { phase: 'mounted', holdMs: Number(process.env.PR_HOLD_MS ?? 0) };
      const client = await createLocalClient({ url, persona, device: pressureDevice(processDevice({ binary, dir: join(dir, persona) }), state), fetch: (input, init) => state.offline ? Promise.reject(Error('offline device')) : fetch(input, init) });
      await client.sync();
      drivers.push(await pressureDriver(client, state, read => { const copy = structuredClone(read); renders[i] = renders[i].then(() => page.evaluate(read => window.renderRead(read), copy)); }));
    }
  }
  await Promise.all(drivers.map(d => d.offline()));
  const writes = await Promise.all(drivers.map((d, i) => d.send('offline-' + i, 100 + i)));
  assert.ok(writes.every(w => w.state === 'pending'), JSON.stringify(writes));
  await Promise.all(drivers.map(d => d.reconnect()));
  await until(async () => (await Promise.all(drivers.map(d => d.result()))).every(r => r.historyHeld), 'both history attempts held');
  // A concurrent peer edit arrives while both histories are evaluating the
  // reconnect cut. Retire those real evaluations before releasing their slots.
  const edit = await fetch(url + '/m/edit', { method:'POST', headers:{'x-snapback-persona':'alice'}, body:JSON.stringify({id:'peer-edit',args:{id:'m0',text:'Edited on reconnect'}}) }).then(r=>r.json());
  assert.equal(edit.state,'sent'); await Promise.all(drivers.map(d => d.sync()));
  await Promise.all(drivers.map(d => d.releaseHistory()));
  await until(async () => (await Promise.all(drivers.map(d => d.result()))).every(r => r.history.data?.length === 42 && !r.history.revalidating && !r.history.data.some(row => row.pending)), 'both devices converge');
  await Promise.all(drivers.map(d => d.settle()));
  const results = await Promise.all(drivers.map(d => d.result())); await Promise.all(renders);
  for (let i = 0; i < 2; i++) {
    results[i].renders = await pages[i].evaluate(() => window.rendered);
    for (const id of ['offline-0','offline-1']) assert.equal(results[i].history.data.filter(row => row.id === id).length, 1);
    for (const event of results[i].historyEvents) if (event.read.data) assert.equal(new Set(event.read.data.map(r => r.id)).size, event.read.data.length, 'no duplicate in any publication');
    for (const event of results[i].renders) assert.equal(new Set(event.ids).size, event.ids.length, 'no duplicate in any rendered history');
    assert.deepEqual([...results[i].renders.at(-1).ids].sort(), results[i].history.data.map(row => row.id).sort(), 'all converged rows actually render');
    assert.ok(results[i].pressure.every(p => p.inFlight <= 8));
    if (results[i].inspection.supported) {
      assert.equal(results[i].inspection.totals.observations,124);
      assert.ok(results[i].inspection.totals.inFlight<=8);
    }
  }
  if (process.env.PR_EVIDENCE) writeFileSync(join(process.env.PR_EVIDENCE, `convergence-${process.env.PR_LABEL ?? 'current'}-${tier}.json`), JSON.stringify({ tier, results }, null, 2));
  const gaps = results.map(r => r.historyEvents.filter(e => !e.read.data?.length));
  t.diagnostic(JSON.stringify({ tier, withdrawals: results.map(r => r.withdrawals), gaps: gaps.map(x => x.length), peaks: results.map(r => Math.max(...r.pressure.map(p => p.queued))) }));
  // This real-time harness can hold an active evaluation beyond its legitimate
  // one-second bound on a loaded host. Capacity wait must never cause withdrawal.
  // The frozen-schedule and held-slot device regressions also require zero gaps.
  for (const result of results) {
    const timedOut = result.withdrawals.filter(w => w.query === 'history');
    for (const withdrawal of timedOut) {
      const exhaustedBeforeQueue = typeof withdrawal.queueEntry?.remainingMs === 'number' && withdrawal.queueEntry.remainingMs <= 0;
      assert.equal(withdrawal.inFlight, true, 'a legitimate harness timeout requires an active attempt: ' + JSON.stringify(withdrawal));
      assert.ok(!withdrawal.queued || exhaustedBeforeQueue, 'capacity queue wait must never withdraw a mounted history: ' + JSON.stringify(withdrawal));
    }
    let lastData = -1;
    for (const [index, event] of result.historyEvents.entries()) {
      if (event.read.data?.length) lastData = index;
      else assert.ok(timedOut.some(w => w.historyEventIndex <= index && w.historyEventIndex > lastData),
        'every gap must follow a recorded legitimate active-budget withdrawal');
    }
  }
});

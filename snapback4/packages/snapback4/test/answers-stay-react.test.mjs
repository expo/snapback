import { hangBudget } from './helpers/wait.mjs';
// @ref LLP 3000.023#10 — render every real host notification, without batching away loading.
import test from 'node:test';
import assert from 'node:assert/strict';
import { setTimeout as delay } from 'node:timers/promises';
import { createRequire } from 'node:module';
import { mkdtempSync, writeFileSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { pathToFileURL } from 'node:url';
import { chromiumExecutable } from '../../../witness/lib.mjs';

import { fixture, open, q, m, parked, until, sdk } from './helpers/answers-stay.mjs';
const { answerObservation } = await import(new URL('read-observation.js', sdk));
const root = new URL('../../../', import.meta.url).pathname;
const require = createRequire(join(root, 'package.json'));
async function renderer(t) {
  const { chromium } = require('playwright-core');
  const { createServer } = await import(pathToFileURL(createRequire(join(root, 'apps/chat/package.json')).resolve('vite')));
  const dir = mkdtempSync(join(tmpdir(), 'sb4-rl-react-'));
  writeFileSync(join(dir, 'index.html'), '<div id="root"></div><script type="module" src="/harness.jsx"></script>');
  writeFileSync(join(dir, 'harness.jsx'), `
import React, { useState, useEffect } from 'react';
import { createRoot } from 'react-dom/client';
import { flushSync } from 'react-dom';
import { SnapbackProvider, useQuery, usePage } from 'snapback4/react';
import { registerObservationPeek } from 'test-peek';
const profileOp = { kind: 'query', name: 'profile' }, historyOp = { kind: 'query', name: 'history' };
let snapshot, kind, mounts, unmounts, loading, renders, root;
const listeners = new Set();
const client = { observe() { return { getSnapshot: () => snapshot, subscribe(fn) { listeners.add(fn); return () => listeners.delete(fn); }, close() {} }; } };
registerObservationPeek(client, () => snapshot);
function Slot() { const [route] = useState(() => { mounts++; return '/conversation/bob'; }); useEffect(() => () => unmounts++, []); return <span>{route}</span>; }
function Gate({ read }) { renders++; if (read.loading) loading++; return 'data' in read ? <Slot /> : null; }
function Profile() { return <Gate read={useQuery(profileOp, {})} />; }
function History() { const page = usePage(historyOp, {}); return <Gate read={page.read} />; }
window.replay = (input) => {
  if (root) flushSync(() => root.unmount());
  snapshot = input.reads[0]; kind = input.kind; mounts = 0; unmounts = 0; loading = 0; renders = 0;
  root = createRoot(document.getElementById('root'));
  flushSync(() => root.render(<SnapbackProvider client={client}>{kind === 'profile' ? <Profile /> : <History />}</SnapbackProvider>));
  for (const read of input.reads.slice(1)) flushSync(() => { snapshot = read; for (const fn of listeners) fn(); });
  return { mounts, unmounts, loading, renders, route: document.body.textContent };
};`);
  const pkg = createRequire(join(root, 'packages/snapback4/package.json'));
  // Replay against a stable page: cold dependency optimization must not reload
  // it and erase window.replay after the readiness check. No files change here.
  const vite = await createServer({ root: dir, configFile: false, logLevel: 'error', server: { hmr: false, host: '127.0.0.1', port: 0, fs: { allow: [root, dir] } }, resolve: { alias: [
    ...['react', 'react/jsx-runtime', 'react/jsx-dev-runtime', 'react-dom', 'react-dom/client'].map(name => ({ find: new RegExp('^' + name + '$'), replacement: pkg.resolve(name) })),
    { find: 'test-peek', replacement: new URL('observe-watch.js', sdk).pathname },
    { find: 'snapback4/react', replacement: new URL('react.js', sdk).pathname },
  ] } });
  await vite.listen();
  const browser = await chromium.launch({ timeout: hangBudget(), executablePath: chromiumExecutable(), headless: true, args: ['--no-sandbox'] });
  t.after(async () => { await browser.close(); await vite.close(); rmSync(dir, { recursive: true, force: true }); });
  const page = await browser.newPage();
  page.setDefaultTimeout(hangBudget()); page.setDefaultNavigationTimeout(hangBudget());
  await page.goto(vite.resolvedUrls.local[0]); await page.waitForFunction(() => window.replay);
  return async (kind, reads, scopeWithdrawal = false) => {
    const result = await page.evaluate(input => window.replay(input), { kind, reads });
    if (scopeWithdrawal) {
      assert.ok(result.loading > 0, 'scope removal withdraws immediately');
      assert.ok(result.unmounts > 0, 'protected history leaves the screen');
    } else {
      assert.equal(result.loading, 0, JSON.stringify({ result, reads }));
      assert.equal(result.mounts, 1); assert.equal(result.unmounts, 0);
    }
    assert.ok(result.route.includes('/conversation/bob'));
    assert.ok(result.renders > 0);
  };
}
for (const host of ['process', 'wasm', 'online']) for (const keep of [undefined, true]) {
  test(`${host} keep=${keep}: profile route gate`, { timeout: hangBudget(23) }, async t => {
    const f = await fixture(t), render = await renderer(t);
    let failing = false, slowGate;
    const client = await open(t, f, host, { fetch: async (input, init) => {
      if (new URL(input).pathname === '/changes') return parked(init.signal);
      if (failing) throw Error('controlled offline');
      if (new URL(input).pathname === '/q/profile' && slowGate) await slowGate.promise;
      return fetch(input, init);
    } });
    const watch = client.observe(q('profile'), {}, { keep }); t.after(() => watch.close());
    await until(() => watch.getSnapshot().data?.name === 'Bob');
    const owner = answerObservation(watch.getSnapshot()), notify = () => { for (const fn of owner.subscribers) fn(); };
    const ready = watch.getSnapshot();
    for (const scenario of ['slow refetch', 'offline transport', 'retry exhaustion', 'reconnect']) await t.test(scenario, async () => {
      failing = false; if (client.sync) await client.sync(); await client.query(q('profile'), {});
      // A known-offline one-shot now refuses immediately; let its reconnect
      // probe finish before isolating the observation's retry exhaustion.
      await until(() => client.link() === 'online');
      await until(() => !owner.running && !owner.inFlight); owner.publish(ready); notify();
      const reads = [watch.getSnapshot()], stop = watch.subscribe(() => reads.push(watch.getSnapshot()));
      try {
        if (scenario === 'slow refetch') {
          slowGate = Promise.withResolvers();
          const work = owner.fetch(async () => ({ read: await client.query(q('profile'), {}) }), notify);
          await delay(3000); slowGate.resolve(); slowGate = undefined; await work;
        }
        if (scenario === 'offline transport') { failing = true; await client.query(q('profile'), {}); await until(() => client.link() === 'offline'); }
        if (scenario === 'retry exhaustion') await owner.fetch(async () => ({ read: ready }), notify, { accept: () => false });
        if (scenario === 'reconnect') {
          failing = true; await client.query(q('profile'), {}); await until(() => client.link() === 'offline');
          failing = false; if (client.sync) await client.sync(); await client.query(q('profile'), {}); if (client.sync) await client.sync(); await until(() => client.link() === 'online');
        }
        reads.push(watch.getSnapshot());
        await render('profile', reads);
        if (scenario === 'offline transport' || scenario === 'retry exhaustion') assert.equal(watch.getSnapshot().revalidating, true);
      } finally { stop(); }
    });
  });
  test(`${host} keep=${keep}: chat history and membership removal`, { timeout: hangBudget(13) }, async t => {
    const f = await fixture(t), render = await renderer(t), client = await open(t, f, host);
    const watch = client.observe(q('history'), { c: null }, { keep }); t.after(() => watch.close());
    await until(() => watch.getSnapshot().data?.length === 1);
    for (const scenario of ['peer sync', 'own send and settlement', 'edit', 'delete', 'membership removal']) await t.test(scenario, async () => {
      const reads = [watch.getSnapshot()], stop = watch.subscribe(() => reads.push(watch.getSnapshot()));
      try {
        const id = scenario.replaceAll(' ', '-');
        if (scenario === 'peer sync') assert.equal((await f.post('/m/send', { id, args: { body: 'peer' } })).state, 'sent');
        if (scenario === 'own send and settlement') assert.equal((await client.mutate(m('send'), { body: 'mine' })).state, 'sent');
        if (scenario === 'edit') await f.post('/m/edit', { id, args: { body: 'edited' } });
        if (scenario === 'delete') await f.post('/m/erase', { id, args: {} });
        if (scenario === 'membership removal') await f.post('/m/remove', { id, args: {} });
        if (client.sync) await client.sync();
        await until(() => {
          const r = watch.getSnapshot(); if (r.revalidating || !r.data) return false;
          return scenario === 'peer sync' ? r.data.length === 2 : scenario === 'own send and settlement' ? r.data.length === 3 && !r.data.some(x => x.pending)
            : scenario === 'edit' ? r.data.some(x => x.body === 'edited') : scenario === 'delete' ? r.data.length === 2 : r.data.length === 0;
        });
        reads.push(watch.getSnapshot()); await render('history', reads, scenario === 'membership removal' && host !== 'online');
        if (scenario === 'membership removal') assert.deepEqual(watch.getSnapshot().data, []);
      } finally { stop(); }
    });
  });
}

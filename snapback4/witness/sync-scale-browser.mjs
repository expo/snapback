// Real Chromium/IndexedDB companion; the Node witnesses keep their own costs.
// node witness/sync-scale-browser.mjs URL OUTPUT
import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { resolve, join, extname } from 'node:path';
import { createRequire } from 'node:module';
import { chromium } from 'playwright-core';
import { login } from '../packages/snapback4/dist/auth.js';
import { createClient } from '../packages/snapback4/dist/client.js';
let writer;
import { chromiumExecutable, root } from './lib.mjs';
const [api, output] = process.argv.slice(2);
assert.ok(api && output, 'URL and OUTPUT are required; serve only a private fixture copy');
const harness = resolve(root, 'target/lane-ss-browser');
mkdirSync(harness, { recursive: true });
const sdk = resolve(root, 'packages/snapback4/src');
writeFileSync(join(harness, 'index.html'), '<!doctype html><title>Sync scale</title><script type="module" src="/entry.js"></script>');
writeFileSync(join(harness, 'entry.js'), `
import { login } from '${sdk}/auth.ts';
import { createClient, mintId } from '${sdk}/client.ts';
import { createLocalClient } from '${sdk}/local.ts';
import { prepareClient } from '${sdk}/client-start.ts';
import { webDevice, indexedDbPersistence } from '${sdk}/web.ts';
import { WebDevice } from '${sdk}/wasm/snapback4_device.js';
window.sdk = { login, createClient, mintId, createLocalClient, prepareClient, webDevice, indexedDbPersistence, WebDevice };
`);
const require = createRequire(join(root, 'apps/chat/package.json'));
const { build } = await import(require.resolve('vite'));
await build({ root: harness, logLevel: 'silent', build: { target: 'es2022', minify: false, assetsInlineLimit: 0 } });
const server = createServer((req, res) => {
  const path = new URL(req.url, 'http://localhost').pathname;
  try {
    const file = join(harness, 'dist', path === '/' ? 'index.html' : path);
    res.setHeader('Content-Type', { '.js': 'text/javascript', '.wasm': 'application/wasm', '.html': 'text/html' }[extname(file)] ?? 'application/octet-stream');
    res.end(readFileSync(file));
  } catch { res.writeHead(404).end(); }
});
await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
const browser = await chromium.launch({ executablePath: process.env.SS_CHROMIUM ?? chromiumExecutable(), headless: true,
  args: ['--enable-precise-memory-info'] });
const errors = [];
let result;
try {
  const context = await browser.newContext(); // no cache or IndexedDB from another acquisition
  const page = await context.newPage();
  page.on('pageerror', error => errors.push(error.message));
  await page.exposeFunction('openPeer', async handle => {
    const answer = await login(api, `${handle}@example.com`, 'CliqueScale!20260808');
    assert.ok(answer.ok); await writer?.close(); writer = createClient({ url: api, session: answer.session });
  });
  await page.exposeFunction('sendPeer', args => writer.mutate({ kind: 'mutation', name: 'messaging.send' }, args));
  await page.goto(`http://127.0.0.1:${server.address().port}`);
  await page.waitForFunction(() => window.sdk);
  const runInPage = async ({ api, interrupt, profile, worker }) => {
    const { login, createClient, mintId, createLocalClient, prepareClient, webDevice, indexedDbPersistence } = window.sdk;
    const now = () => performance.now(), sleep = ms => new Promise(r => setTimeout(r, ms));
    const q = name => ({ kind: 'query', name });
    const signIn = async handle => {
      const answer = await login(api, `${handle}@example.com`, 'CliqueScale!20260808');
      if (!answer.ok) throw new Error(JSON.stringify(answer));
      return answer.session;
    };
    const session = await signIn('u0500'), reader = createClient({ url: api, session });
    const group = await reader.query(q('messaging.groupByTitle'), { title: 'Busy Group 0001' });
    const conversation = group.data.id;
    const roster = await reader.query(q('messaging.roster'), { conversation });
    const peer = roster.data.find(row => row.principal !== session.principal && row.profile?.handle?.startsWith('u'));
    await window.openPeer(peer.profile.handle);
    await reader.close();
    const out = { pages: [], calls: [], opens: [], workerRpc: [], saves: [], live: [], peakHeap: 0, heapAfterAcquisition: 0 };
    // Diagnostic only: wall time inside synchronous wasm/JSON/IDB request
    // issuance, separate from the asynchronous strict transaction lifetime.
    const diagnostic = { wasm: [], json: {}, idb: {}, longTasks: [] }, undo = [];
    let phase = 'host';
    const wrap = (object, method, run) => {
      const original = object[method]; object[method] = function (...args) { return run.call(this, original, args); };
      undo.push(() => { object[method] = original; });
    };
    if (profile && worker) {
      wrap(Worker.prototype, 'postMessage', function(original, args) {
        const request = args[0], at = now();
        if (typeof request?.id === 'number') {
          const listener = event => {
            if (event.data?.id !== request.id) return;
            this.removeEventListener('message', listener);
            out.workerRpc.push({ action: request.action, op: request.request?.op, ms: now() - at });
          };
          this.addEventListener('message', listener);
        }
        return original.apply(this, args);
      });
    }
    if (profile) {
      for (const method of ['parse', 'stringify']) wrap(JSON, method, function (original, args) {
        const at = now();
        try { return original.apply(this, args); }
        finally { const m = diagnostic.json[`${phase}.${method}`] ??= { count: 0, ms: 0 }; m.count++; m.ms += now() - at; }
      });
      for (const method of ['call', 'drain']) wrap(window.sdk.WebDevice.prototype, method, function (original, args) {
        const request = method === 'call' ? JSON.parse(args[0]) : {}, at = now();
        try { return original.apply(this, args); }
        finally { diagnostic.wasm.push({ op: request.op ?? method, at, ms: now() - at, rows: request.page?.events?.length }); }
      });
      for (const method of ['put', 'get', 'delete']) wrap(IDBObjectStore.prototype, method, function (original, args) {
        const at = now();
        try { return original.apply(this, args); }
        finally { const m = diagnostic.idb[method] ??= { count: 0, ms: 0 }; m.count++; m.ms += now() - at; }
      });
    }
    const observer = new PerformanceObserver(list => {
      for (const task of list.getEntries()) diagnostic.longTasks.push({ at: task.startTime, ms: task.duration });
    });
    observer.observe({ type: 'longtask', buffered: false });
    const sample = () => { out.peakHeap = Math.max(out.peakHeap, performance.memory.usedJSHeapSize); };
    const sampler = setInterval(sample, 20);
    const persistence = indexedDbPersistence();
    const device = worker ? webDevice({ worker: true }) : webDevice({ persist: { ...persistence, async save(name, changes) {
      const at = now(); phase = 'persistence';
      try { await persistence.save(name, changes); } finally { phase = 'host'; }
      out.saves.push({ ms: now() - at, changes: changes.length }); sample();
    } } });
    let syncRequests = 0;
    window.scalePersistence = persistence;
    const options = { url: api, session, device: { async open(...args) {
      window.scaleStore = args[0];
      const at = now(); let core;
      try { core = await device.open(...args); }
      finally { out.opens.push({ ms: now() - at, initial: !!args[1] }); }
      return { ...core, async call(request, committed) {
        const at = now(), saved = out.saves.length;
        try { return await core.call(request, committed); }
        finally { out.calls.push({ op: request.op, ms: now() - at,
          persistenceMs: out.saves.slice(saved).reduce((n, s) => n + s.ms, 0) }); sample(); }
      } };
    } }, async fetch(input, init) {
      if (interrupt && new URL(input).pathname === '/sync' && ++syncRequests === 2) {
        window.crashReady = true; await new Promise(() => {});
      }
      const at = now(), response = await fetch(input, init);
      if (new URL(input).pathname !== '/sync') return response;
      const body = await response.text(), page = JSON.parse(body);
      out.pages.push({ ms: now() - at, rows: page.events?.length ?? 0, bytes: new TextEncoder().encode(body).length });
      return new Response(body, { status: response.status, headers: response.headers });
    } };
    const at = now();
    const prepared = await prepareClient(options, () => createLocalClient(options));
    const client = prepared.client; window.scaleClient = client;
    let acquired = false;
    const done = prepared.start().then(() => {
      acquired = client.acquired; out.acquisitionMs = now() - at;
      out.acquisitionStartedAt = at; out.acquisitionEndedAt = now();
      out.worker = !!worker;
      out.acquisitionPages = out.pages.length; out.acquisitionCalls = out.calls.length;
      out.acquisitionSaves = out.saves.length;
      out.heapAfterAcquisition = performance.memory.usedJSHeapSize; sample(); out.peakAcquisitionHeap = out.peakHeap;
    });
    const watch = client.observe(q('messaging.history'), { conversation }), seen = new Map();
    const stop = watch.subscribe(() => {
      for (const row of watch.getSnapshot().data ?? []) if (!seen.has(row.id)) seen.set(row.id, now());
    });
    const send = async phase => {
      const id = mintId(), at = now();
      const write = await window.sendPeer({ id, conversation, text: `SS browser ${id}` });
      if (write.state !== 'sent') throw new Error(JSON.stringify(write));
      while (!seen.has(id) && now() - at < 31000) await sleep(5);
      out.live.push({ phase, ms: seen.has(id) ? seen.get(id) - at : null });
    };
    try {
      for (let n = 0; n < 200 && !acquired; n++) await send('during');
      await done;
      for (let n = 0; n < 23; n++) await send(n < 3 ? 'warmup' : 'after');
      out.ok = acquired && out.live.every(s => s.ms !== null);
      out.residency = await client.residency();
      out.diagnostic = diagnostic;
      return out;
    } finally { clearInterval(sampler); sample(); stop(); await client.close(); observer.disconnect(); for (const restore of undo.reverse()) restore(); }
  };
  let crash;
  if (process.env.SS_CRASH === '1') {
    const interrupted = page.evaluate(runInPage, { api, interrupt: true, worker: process.env.SS_WORKER === '1' }).catch(error => error.message);
    await page.waitForFunction(() => window.crashReady, undefined, { timeout: 120000 });
    crash = await page.evaluate(async () => {
      const saved = await scalePersistence.load(scaleStore);
      return { acquired: scaleClient.acquired, publishedRows: saved.filter(c => c.s === 'r').length,
        stagedRows: saved.filter(c => c.s === 's').length };
    });
    assert.equal(crash.acquired, false); assert.equal(crash.publishedRows, 0); assert.ok(crash.stagedRows > 0);
    // Navigation destroys the owner and releases its Web Lock with acquisition in flight.
    await page.reload(); await interrupted;
    await page.waitForFunction(() => window.sdk);
  }
  const cdp = process.env.SS_PROFILE ? await context.newCDPSession(page) : null;
  if (cdp) { await cdp.send('Profiler.enable'); await cdp.send('Profiler.start'); }
  result = await page.evaluate(runInPage, { api, interrupt: false, profile: !!process.env.SS_PROFILE, worker: process.env.SS_WORKER === '1' });
  if (cdp) { const { profile } = await cdp.send('Profiler.stop'); writeFileSync(`${output}.cpuprofile`, JSON.stringify(profile)); }
  if (crash) result.crashRecovery = crash;
  result.acquisitionLongTasks = result.diagnostic.longTasks.filter(task =>
    task.at < result.acquisitionEndedAt && task.at + task.ms > result.acquisitionStartedAt);
  result.acquisitionLongestTask = Math.max(0, ...result.acquisitionLongTasks.map(task => task.ms));
  result.chromium = browser.version();
  result.errors = errors;
  for (const phase of ['during', 'after']) {
    const times = result.live.filter(s => s.phase === phase).map(s => s.ms ?? Infinity).sort((a, b) => a - b);
    result[`${phase}Timeouts`] = times.filter(ms => !Number.isFinite(ms)).length;
    result[`${phase}P95`] = times[Math.ceil(times.length * .95) - 1] ?? null;
  }
  writeFileSync(output, JSON.stringify(result, null, 2));
  console.log(JSON.stringify({ output, acquisitionMs: result.acquisitionMs, duringP95: result.duringP95,
    afterP95: result.afterP95, peakHeap: result.peakHeap, ok: result.ok, errors }));
  assert.ok(result.ok && !errors.length);
} finally { await writer?.close(); await browser.close(); await new Promise(resolve => server.close(resolve)); }

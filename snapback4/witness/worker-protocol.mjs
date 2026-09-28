// Browser-only execution foundation; NOT the public webDevice opener.
// node witness/worker-protocol.mjs [OUTPUT]
import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { createRequire } from 'node:module';
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join, extname, resolve } from 'node:path';
import { chromium } from 'playwright-core';
import { chromiumExecutable, root } from './lib.mjs';
import { webShell } from '../packages/snapback4/bin/web-shell.js';

const out = resolve(process.argv[2] ?? join(root, 'target/lane-ss-round4/worker-protocol.json'));
const dir = join(root, 'target/lane-ss-round4/worker-protocol');
mkdirSync(dir, { recursive: true });
const sdk = join(root, 'packages/snapback4/dist');
const schema = JSON.parse(readFileSync(join(root, 'packages/snapback4/test/chat-schema.json'), 'utf8'));
writeFileSync(join(dir, 'index.html'), '<!doctype html><script type="module" src="/entry.js"></script>');
writeFileSync(join(dir, 'fault-worker.js'), `
import { WorkerRuntime, serveWorker } from '${sdk}/web-worker-runtime.js';
let armed, lastOp;
const hit = async point => {
  if (armed?.point !== point) return;
  const fault = armed; armed = undefined;
  postMessage({ test: 'hit', point });
  if (fault.crash) setTimeout(() => { throw new Error('controlled Worker crash: ' + point); });
  await new Promise(() => {});
};
addEventListener('message', e => {
  if (e.data?.test === 'arm') { armed = e.data; e.stopImmediatePropagation(); }
  if (e.data?.test === 'crash') { e.stopImmediatePropagation(); setTimeout(() => { throw new Error('controlled idle crash'); }); }
});
const execute = WorkerRuntime.prototype.execute;
WorkerRuntime.prototype.execute = async function(message) {
  if (message.action === 'invoke') { lastOp = message.request?.op; await hit('before-invoke'); }
  if (message.action === 'commit') await hit('before-commit');
  const value = await execute.call(this, message);
  if (message.action === 'invoke') await hit('after-invoke');
  if (message.action === 'commit') await hit('after-commit');
  return value;
};
const put = IDBObjectStore.prototype.put;
IDBObjectStore.prototype.put = function(...args) {
  const request = put.apply(this, args);
  if (armed?.point === 'during-commit' && this.transaction.mode === 'readwrite') {
    const store = this, fault = armed; armed = undefined;
    const keep = () => { const r = store.get(['m', 'device:store_id']); r.onsuccess = keep; };
    keep();
    postMessage({ test: 'hit', point: 'during-commit', strict: this.transaction.durability });
    if (fault.crash) setTimeout(() => { throw new Error('controlled Worker crash: during-commit'); });
  }
  return request;
};
serveWorker(globalThis);
`);
writeFileSync(join(dir, 'entry.js'), `
import { WebWorkerHost } from '${sdk}/web-worker-host.js';
import { WebWorkerSuspend } from '${sdk}/web-worker-suspend.js';
import { openWorkerDevice } from '${sdk}/web-worker-device.js';
import { deliveryCommit } from '${sdk}/local-device.js';
import { AdmissionJournal } from '${sdk}/web-journal.js';
import { indexedDbPersistence } from '${sdk}/web.js';
const backend = ${JSON.stringify(schema)};
const persist = indexedDbPersistence();
const cores = new Map();
const ok = reply => { if (reply.denied) throw new Error(JSON.stringify(reply)); return reply.ok; };
const records = () => Object.keys(localStorage).filter(k => k.startsWith('snapback4-admission:'));
let host, journal, suspension, worker, hit, signal, workerStarts = 0;
const events = [
  { table: 'conversations', id: 'c1', title: 'General', creatorId: 'dev:alice' },
  { table: 'memberships', id: 'm1', conversationId: 'c1', principal: 'dev:alice', role: 'admin', joinedAt: 1 },
  { table: 'messages', id: 'confirmed', conversationId: 'c1', authorId: 'dev:alice', body: 'confirmed', at: 1, editedAt: null, photo: null },
].map(({ table, ...data }) => ({ table, id: data.id, kind: 'put', data }));
const first = { op: 'apply', first: true, page: { store_id: 'worker-store', snapshot: true, stage_snapshot: true, generation: 1, watermark: 5, more: true, next: 'second', events: events.slice(0, 2) } };
const second = { op: 'apply', page: { store_id: 'worker-store', snapshot: true, stage_snapshot: true, generation: 1, watermark: 5, more: false, after: 'second', events: events.slice(2) } };
const terminal = { op: 'apply', page: { store_id: 'worker-store', snapshot: false, snapshot_catchup: true, generation: 1, watermark: 5, more: false, events: [] } };
async function open(name, fault = true, kept = false) {
  const claim = await persist.claim(name, true);
  host = fault ? new WebWorkerHost(claim, () => {
    workerStarts++;
    worker = new Worker(new URL('./fault-worker.js', import.meta.url), { type: 'module' });
    worker.addEventListener('message', e => { if (e.data?.test === 'hit') signal?.(e.data); });
    return worker;
  }) : new WebWorkerHost(claim);
  const saved = await host.open(kept ? null : backend);
  journal = new AdmissionJournal(claim.name, true, id => host.control.capture(id)); journal.load(saved);
  suspension = new WebWorkerSuspend(host, journal);
  window.nameOfStore = claim.name;
  if (!kept) await call({ op: 'observe_store', page: { snapshot: false, generation: 1, events: [], watermark: 0, more: false, store_id: 'worker-store', requested_watermark: 0 } });
  return claim.name;
}
async function call(request, extra = []) {
  return host.transaction(async tx => {
    journal.load([...tx.journal]);
    const reply = await tx.invoke(request);
    journal.remember(await tx.commit(extra));
    return ok(reply);
  });
}
async function recover() {
  return host.transaction(async tx => {
    journal.load([...tx.journal]);
    await journal.recoverWith(tx.invoke, async (extra = []) => journal.remember(await tx.commit(extra)));
    journal.remember(await tx.commit());
  });
}
function capture(id, seq = 1) {
  return journal.capture({ op: 'admit', entry: { id, seq, op: 'send', args: { conversationId: 'c1', body: id }, viewer: 'dev:alice', now: 20, new_ids: [id], predictable: true, predicted: [] } });
}
async function admit(record) {
  return host.transaction(async tx => {
    journal.load([...tx.journal]);
    return journal.authorize(record, async () => {
      const reply = await journal.admitWith(tx.invoke, record.entry, record.storeId);
      if (reply.denied) throw new Error(JSON.stringify(reply));
      journal.remember(await tx.commit([journal.transfer(record, false)]));
      return reply.ok;
    }, async () => { throw new Error('authority refused'); });
  });
}
const counts = async () => {
  const saved = await persist.load(window.nameOfStore);
  return { rows: saved.filter(c => c.s === 'r').length, staged: saved.filter(c => c.s === 's').length,
    queued: saved.filter(c => c.s === 'o').map(c => JSON.parse(c.v).id), markers: saved.filter(c => c.s === 'j').map(c => c.k) };
};
window.w = { open, call, recover, capture, admit, counts, records, first, second, terminal,
  async coreOpen(id, name, kept = false) { cores.set(id, await openWorkerDevice(name, kept ? null : backend)); },
  coreCall: (id, request) => cores.get(id).call(request),
  coreClose: id => cores.get(id).close(),
  async coreAcquire(id) { for (const request of [first, second, terminal]) ok(await cores.get(id).call(request)); },
  coreAdmit: (id, key) => cores.get(id).call({ op: 'admit', entry: { id: key, seq: 1, op: 'send', args: { conversationId: 'c1', body: key }, viewer: 'dev:alice', now: 20, new_ids: [key], predictable: true, predicted: [] } }),
  coreCollect: (id, request, current) => cores.get(id)[deliveryCommit](request, current),
  storeNames: prefix => persist.others(prefix),
  prepareExit: () => suspension.prepare(),
  dispatchExit() {
    let sent = false, captured = false;
    suspension.dispatch((entries, begin) => {
      if (!begin()) return;
      captured = records().some(key => key.endsWith('exit:' + entries[0].id));
      sent = true;
      void fetch('/keepalive-proof', { method: 'POST', body: entries[0].id, keepalive: true });
    });
    return { sent, captured };
  },
  pagehideExit() {
    let sent = false, captured = false;
    const stop = suspension.onSuspend((entries, begin) => {
      if (!begin()) return;
      captured = records().some(key => key.endsWith('exit:' + entries[0].id)); sent = true;
      void fetch('/keepalive-proof', { method: 'POST', body: entries[0].id, keepalive: true });
    });
    dispatchEvent(new PageTransitionEvent('pagehide')); stop(); return { sent, captured };
  },
  control: () => host.control.read(), pending: id => host.control.capture(id), admitted: id => host.control.admitted(id),
  async acquire() { await call(first); await call(second); await call(terminal); },
  arm(point, crash = false) { hit = new Promise(r => signal = r); worker.postMessage({ test: 'arm', point, crash }); },
  hit: () => hit,
  terminate: () => host.terminate(), close: () => host.close(),
  workerStarts: () => workerStarts,
  available: name => navigator.locks.request(name, { ifAvailable: true }, lock => !!lock),
  async cleanup() { const queued = new Map((await call({ op: 'queued' })).map(e => [e.id, e])); return call({ op: 'state' }, journal.cleanup(queued)); },
  bindAuthority(context) { journal.authority = context; },
  exit(id) { return journal.captureExit(id); },
  async exits() { return host.transaction(async tx => { journal.load([...tx.journal]); await journal.recoverExitsWith(tx.invoke); journal.remember(await tx.commit(journal.cleanup(new Map()))); }); },
  uncommitted() { return host.transaction(tx => tx.invoke({ op: 'set_meta', key: 'private', value: 'never' })); },
  async crashBetweenCalls() {
    let reached, resume;
    const ready = new Promise(r => reached = r), held = new Promise(r => resume = r);
    const result = host.transaction(async tx => {
      await tx.invoke({ op: 'set_meta', key: 'private', value: 'never' });
      reached(); await held; await tx.commit();
    }).then(() => 'resolved', e => String(e));
    await ready;
    const errored = new Promise(r => worker.addEventListener('error', r, { once: true }));
    worker.postMessage({ test: 'crash' }); await errored; resume();
    return result;
  },
};
`);
const require = createRequire(join(root, 'apps/chat/package.json'));
const { build } = await import(require.resolve('vite'));
await build({ root: dir, logLevel: 'silent', build: { target: 'es2022', minify: false, assetsInlineLimit: 0 } });
await webShell(join(dir, 'dist'));
let denyWasm = false, wasmRequests = 0;
const server = createServer((req, res) => {
  const pathname = new URL(req.url, 'http://localhost').pathname;
  if (pathname.endsWith('.wasm')) { wasmRequests++; if (denyWasm) { res.writeHead(503).end(); return; } }
  try {
    const file = join(dir, 'dist', pathname === '/' ? 'index.html' : pathname);
    res.setHeader('Content-Type', { '.js': 'text/javascript', '.wasm': 'application/wasm', '.html': 'text/html' }[extname(file)] ?? 'application/octet-stream');
    res.end(readFileSync(file));
  } catch { res.writeHead(404).end(); }
});
await new Promise(r => server.listen(0, '127.0.0.1', r));
const url = `http://127.0.0.1:${server.address().port}`;
const browser = await chromium.launch({ executablePath: chromiumExecutable(), headless: true });
const results = [], pageErrors = [];
const run = async (name, body) => {
  const at = performance.now(), context = await browser.newContext();
  const page = await context.newPage();
  page.on('pageerror', e => pageErrors.push({ name, error: e.message }));
  let deadline;
  try {
    await page.goto(url); await page.waitForFunction(() => window.w);
    const detail = await Promise.race([body(page, context), new Promise((_, reject) => {
      deadline = setTimeout(() => reject(new Error('protocol witness exceeded 30 s')), 30_000);
    })]);
    results.push({ name, ok: true, ms: performance.now() - at, detail });
  } catch (e) { results.push({ name, ok: false, error: e.stack }); }
  finally { clearTimeout(deadline); await context.close(); }
  console.log(`${results.at(-1).ok ? 'PASS' : 'FAIL'} ${name}`);
};
try {
  await run('packaged entry and wasm URL; full offline shell and VM reopen', async (page, context) => {
    await page.evaluate(async () => { await w.open('offline', false); await w.acquire(); await w.close(); });
    await page.evaluate(() => navigator.serviceWorker.ready.then(() => true));
    const fetched = wasmRequests;
    denyWasm = true;
    try {
      await context.setOffline(true);
      await page.reload(); await page.waitForFunction(() => window.w);
      const state = await page.evaluate(async () => { await w.open('offline', false, true); return w.call({ op: 'sync_state', capture: false }); });
      assert.equal(state.acquired, true); assert.equal(state.store_id, 'worker-store');
      assert.equal(wasmRequests, fetched, 'reopen uses the durable wasm cache');
      return { acquired: state.acquired, offlineShell: true, wasmFetchesOnReopen: wasmRequests - fetched };
    } finally { denyWasm = false; }
  });
  await run('durable control snapshot stays conservative during a blocked publication', async page => {
    const result = await page.evaluate(async () => {
      await w.open('control'); await w.acquire(); await w.call({ op: 'clear_rows' }); await w.call(w.first); await w.call(w.second);
      const before = w.control();
      w.arm('before-commit'); const publication = w.call(w.terminal).catch(e => String(e)); await w.hit();
      const during = w.control(); w.pending('newer');
      const pending = w.control();
      await w.terminate(); await publication;
      const discarded = w.control(); await w.call({ op: 'state' });
      const restored = w.control(); w.admitted('older'); const stillPending = w.control();
      return { before, during, pending, discarded: discarded ?? null, restored, stillPending };
    });
    assert.equal(result.before.acquired, false); assert.equal(result.during.acquired, false);
    assert.equal(result.during.generation, 1); assert.equal(result.during.transfer_store_id, 'worker-store');
    assert.equal(result.pending.predictions, null); assert.equal(result.discarded, null);
    assert.equal(result.restored.predictions, null); assert.equal(result.stillPending.predictions, null);
    assert.ok(result.pending.queuedRevision > result.before.queuedRevision);
    return result;
  });
  await run('an uncommitted call cannot return or hitchhike on a later commit', async page => {
    const result = await page.evaluate(async () => {
      await w.open('no-commit');
      const outcome = await w.uncommitted().then(() => 'resolved', e => String(e));
      return { outcome, value: await w.call({ op: 'meta', key: 'private' }) };
    });
    assert.match(result.outcome, /must commit/); assert.equal(result.value, null);
    return result;
  });
  await run('a Worker crash between RPCs invalidates the whole private call', async page => {
    const result = await page.evaluate(async () => {
      await w.open('idle-crash');
      const outcome = await w.crashBetweenCalls();
      return { outcome, value: await w.call({ op: 'meta', key: 'private' }) };
    });
    assert.notEqual(result.outcome, 'resolved'); assert.equal(result.value, null);
    return result;
  });
  for (const crash of [false, true]) for (const point of ['before-invoke', 'after-invoke', 'before-commit', 'during-commit', 'after-commit']) {
    await run(`${crash ? 'crash' : 'termination'}: admission ${point}`, async page => {
      await page.evaluate(async () => { await w.open('fault'); await w.acquire(); });
      const status = await page.evaluate(async ({ point, crash }) => {
        await w.call({ op: 'set_meta', key: 'server-clock-floor', value: '100' });
        const record = w.capture('original', 17);
        w.arm(point, crash);
        window.failed = w.admit(record).then(() => 'resolved', error => String(error));
        const hit = await w.hit();
        const claimed = !await w.available(nameOfStore);
        if (!crash) await w.terminate();
        const outcome = await failed;
        const interrupted = await w.counts();
        // Capture a second write before replaying the interrupted call. Its
        // original ordering and id must survive the restore and journal replay.
        w.capture('second', 18);
        await w.recover();
        const queued = await w.call({ op: 'queued' });
        const saved = await w.counts();
        return { claimed, outcome, hit, interrupted, queued: queued.map(e => ({ id: e.id, seq: e.seq, now: e.now, new_ids: e.new_ids })), saved };
      }, { point, crash });
      assert.equal(status.claimed, true);
      assert.notEqual(status.outcome, 'resolved', 'lost/failed transaction never publishes success');
      assert.equal(status.interrupted.queued.includes('original'), status.interrupted.markers.includes('original'), 'outbox and transfer marker are atomic before any recovery can repair them');
      assert.deepEqual(status.queued.map(e => e.id), ['original', 'second']);
      assert.ok(status.queued[0].seq < status.queued[1].seq);
      assert.deepEqual(status.queued.map(e => e.new_ids), [['original'], ['second']]);
      assert.deepEqual(status.queued.map(e => e.now), [100, 100], 'durable issued-time floor survives failure/recovery');
      assert.ok(status.saved.markers.includes('original'));
      if (point === 'during-commit') assert.equal(status.hit.strict, 'strict');
      return status;
    });
  }
  for (const phase of ['staging', 'terminal']) for (const point of ['during-commit', 'after-commit']) {
    await run(`termination: ${phase} ${point}, atomic rows and reopen`, async page => {
      const status = await page.evaluate(async ({ phase, point }) => {
        await w.open('publication');
        if (phase === 'terminal') { await w.call(w.first); await w.call(w.second); }
        w.arm(point);
        const result = w.call(phase === 'terminal' ? w.terminal : w.first).then(() => 'resolved', e => String(e));
        await w.hit(); await w.terminate();
        const outcome = await result;
        const saved = await w.counts();
        const state = await w.call({ op: 'sync_state', capture: false });
        await w.acquire();
        return { outcome, saved, state, final: await w.counts() };
      }, { phase, point });
      assert.notEqual(status.outcome, 'resolved');
      assert.ok(status.saved.rows === 0 || status.saved.rows === 3, 'never a partial live partition');
      assert.equal(status.state.acquired, status.saved.rows === 3);
      if (phase === 'staging') assert.equal(status.saved.rows, 0);
      if (phase === 'terminal' && point === 'after-commit') assert.equal(status.saved.rows, 3);
      assert.equal(status.final.rows, 3); assert.equal(status.final.staged, 0);
      return status;
    });
  }
  await run('navigation during staged save; journal capture survives before transfer', async page => {
    await page.evaluate(async () => { await w.open('navigation'); await w.acquire(); await w.call({ op: 'clear_rows' }); await w.call(w.first); w.capture('navigation-intent', 9); w.arm('during-commit'); void w.call(w.second).catch(() => {}); await w.hit(); });
    await page.reload(); await page.waitForFunction(() => window.w);
    const status = await page.evaluate(async () => {
      await w.open('navigation', true, true);
      await w.recover();
      const saved = await w.counts(), queued = await w.call({ op: 'queued' });
      await w.acquire();
      return { saved, queued: queued.map(e => e.id), final: await w.counts() };
    });
    assert.equal(status.saved.rows, 0); assert.ok(status.saved.staged > 0);
    assert.deepEqual(status.queued, ['navigation-intent']);
    assert.ok(status.final.rows >= 3);
    return status;
  });
  await run('cross-tab claim stays held through termination and durable recovery', async (page, context) => {
    await page.evaluate(async () => { await w.open('shared'); await w.acquire(); w.arm('during-commit'); window.operation = w.call({ op: 'set_meta', key: 'proof', value: 'atomic' }).catch(e => String(e)); await w.hit(); });
    const peer = await context.newPage(); await peer.goto(url); await peer.waitForFunction(() => window.w);
    assert.equal(await peer.evaluate(() => w.available('shared')), false);
    const alternate = await peer.evaluate(() => w.open('shared'));
    assert.match(alternate, /^shared:tab-/);
    await page.evaluate(async () => { await w.terminate(); await operation; await w.call({ op: 'state' }); });
    assert.equal(await peer.evaluate(() => w.available('shared')), false, 'termination/recovery retained the page claim');
    await page.evaluate(() => w.close());
    assert.equal(await peer.evaluate(() => w.available('shared')), true);
    return { alternate, releasedOnlyAfterClose: true };
  });
  await run('fallible cleanup cannot replay a retired admission', async page => {
    const result = await page.evaluate(async () => {
      await w.open('cleanup'); await w.acquire();
      const record = w.capture('cleanup-intent'); await w.admit(record);
      const remove = Storage.prototype.removeItem;
      Storage.prototype.removeItem = function(key) { if (key === record.key) throw new Error('controlled cleanup failure'); return remove.call(this, key); };
      try {
        await w.cleanup(); await w.call({ op: 'dequeue', id: record.entry.id });
        await w.terminate(); await w.recover();
        const queued = await w.call({ op: 'queued' });
        return { queued: queued.length, kept: localStorage.getItem(record.key) !== null, saved: await w.counts() };
      } finally { Storage.prototype.removeItem = remove; }
    });
    assert.equal(result.queued, 0); assert.equal(result.kept, true);
    assert.ok(result.saved.markers.includes('cleanup-intent'));
    return result;
  });
  await run('a failed termination barrier cannot release the page claim later', async page => {
    const result = await page.evaluate(async () => {
      await w.open('failed-barrier'); await w.acquire();
      const transaction = IDBDatabase.prototype.transaction;
      IDBDatabase.prototype.transaction = function(...args) {
        if (args[1] === 'readonly') throw new Error('controlled termination barrier failure');
        return transaction.apply(this, args);
      };
      let stopped;
      try { stopped = await w.terminate().then(() => 'resolved', e => String(e)); }
      finally { IDBDatabase.prototype.transaction = transaction; }
      const closed = await w.close().then(() => 'resolved', e => String(e));
      return { stopped, closed, stillClaimed: !await w.available('failed-barrier') };
    });
    assert.match(result.stopped, /controlled termination barrier failure/);
    assert.match(result.closed, /controlled termination barrier failure/);
    assert.equal(result.stillClaimed, true);
    return result;
  });
  await run('close after termination restores durable state before releasing custody', async page => {
    const result = await page.evaluate(async () => {
      await w.open('restore-before-close'); await w.call(w.first);
      await w.terminate();
      const before = w.workerStarts(), held = !await w.available('restore-before-close');
      await w.close();
      return { held, restored: w.workerStarts() === before + 1,
        released: await w.available('restore-before-close'), saved: await w.counts() };
    });
    assert.equal(result.held, true); assert.equal(result.restored, true);
    assert.equal(result.released, true); assert.equal(result.saved.rows, 0);
    assert.ok(result.saved.staged > 0);
    return result;
  });
  await run('admission captures synchronously while terminal publication is outstanding', async page => {
    const result = await page.evaluate(async () => {
      await w.open('busy'); await w.acquire(); await w.call({ op: 'clear_rows' }); await w.call(w.first); await w.call(w.second);
      w.arm('before-commit');
      const publication = w.call(w.terminal).catch(e => String(e));
      await w.hit();
      const record = w.capture('busy-intent', 29);
      const captured = JSON.parse(localStorage.getItem(record.key));
      const saved = await w.counts();
      const admission = w.admit(record);
      await w.terminate(); await publication; await admission;
      return { captured: captured.entry, saved, queued: (await w.call({ op: 'queued' })).map(e => e.id) };
    });
    assert.equal(result.captured.id, 'busy-intent'); assert.equal(result.captured.seq, 29);
    assert.equal(result.saved.rows, 0, 'terminal private image did not reach the page or persistence');
    assert.deepEqual(result.queued, ['busy-intent']);
    return result;
  });
  await run('first cold acquisition cannot journal without a published store identity', async page => {
    const result = await page.evaluate(async () => {
      await w.open('unidentified'); await w.call(w.first);
      try { w.capture('not-admitted'); return { refused: false }; }
      catch (error) { return { refused: error.why?.code === 'E_ADMISSION', records: w.records().length }; }
    });
    assert.equal(result.refused, true); assert.equal(result.records, 0);
    return result;
  });
  await run('captured authority survives transfer; logout prevents recovery admission', async page => {
    const result = await page.evaluate(async () => {
      await w.open('authority'); await w.acquire();
      const stamp = { key: 'session', epoch: '7', principal: 'dev:alice', source: 'original-authority' };
      localStorage.setItem('session', JSON.stringify({ principal: 'dev:alice' })); localStorage.setItem('session.epoch', '7');
      w.bindAuthority({ capture: () => stamp, read: async key => localStorage.getItem(key), recheck() {} });
      const record = w.capture('old-login');
      const captured = JSON.parse(localStorage.getItem(record.key));
      localStorage.removeItem('session');
      await w.terminate(); await w.recover();
      return { authority: captured.authority, queued: (await w.call({ op: 'queued' })).map(e => e.id), saved: await w.counts() };
    });
    assert.equal(result.authority.epoch, '7'); assert.equal(result.authority.source, 'original-authority');
    assert.deepEqual(result.queued, []);
    return result;
  });
  await run('Worker adapter adopts only closed orphan outboxes and shares terminal receipts', async page => {
    const result = await page.evaluate(async () => {
      await w.coreOpen('a', 'adapter'); await w.coreAcquire('a');
      await w.coreOpen('b', 'adapter'); await w.coreAcquire('b');
      const admitted = await w.coreAdmit('b', 'orphan-write');
      await w.coreCall('b', { op: 'keep_write', value: JSON.stringify({ state: 'sent', id: 'orphan-receipt', seq: 3 }) });
      const live = await w.coreCall('a', { op: 'queued' });
      await w.coreClose('b'); await w.coreClose('a');
      await w.coreOpen('c', 'adapter', true);
      const queued = await w.coreCall('c', { op: 'queued' });
      const receipts = await w.coreCall('c', { op: 'meta', key: 'write-history', lookup: true });
      const stores = await w.storeNames('adapter:tab-'); await w.coreClose('c');
      return { admitted, live, queued, receipts, stores };
    });
    assert.equal(result.admitted.denied, undefined); assert.deepEqual(result.live.ok, []);
    assert.deepEqual(result.queued.ok.map(e => e.id), ['orphan-write']);
    assert.ok(JSON.parse(result.receipts.ok).some(e => e.id === 'orphan-receipt' && e.state === 'sent'));
    assert.deepEqual(result.stores, []); return result;
  });
  await run('Worker conditional collection tests page authority at the actual IDB commit', async page => {
    const result = await page.evaluate(async () => {
      await w.coreOpen('a', 'conditional'); await w.coreAcquire('a');
      const read = () => w.coreCall('a', { op: 'delivery', action: 'read', viewer: 'dev:alice' });
      const before = await read(); let checks = 0;
      const stale = await w.coreCollect('a', { op: 'delivery', action: 'write', viewer: 'dev:alice',
        expected: before.ok.value, value: JSON.stringify({ ...JSON.parse(before.ok.value), serial: 123 }) }, () => ++checks === 1);
      const after = await read();
      const kept = await w.coreCollect('a', { op: 'delivery', action: 'write', viewer: 'dev:alice',
        expected: after.ok.value, value: JSON.stringify({ ...JSON.parse(after.ok.value), serial: 456 }) }, () => true);
      await w.coreClose('a'); await w.coreOpen('a', 'conditional', true); const reopened = await read();
      await w.coreClose('a'); return { before, stale, after, kept, reopened, checks };
    });
    assert.ok(result.checks >= 2); assert.equal(result.after.ok.value, result.before.ok.value);
    assert.equal(result.stale.ok, true); assert.equal(result.kept.ok, true);
    assert.equal(JSON.parse(result.reopened.ok.value).serial, 456); return result;
  });
  await run('prepared pagehide keeps synchronous exit custody and the durable begin-send fence', async page => {
    const result = await page.evaluate(async () => {
      await w.open('prepared'); await w.acquire(); await w.admit(w.capture('prepared-head'));
      const capture = await w.call({ op: 'sync_state' }); await w.prepareExit();
      const prepared = w.control(); const sent = w.pagehideExit();
      const duplicate = w.dispatchExit();
      const stale = await w.call({ op: 'observe_store', page: { snapshot: false, generation: 1,
        store_id: 'worker-store', watermark: 6, requested_watermark: 5, events: [], more: false, send_revision: capture.send_revision } }).then(() => 'accepted', error => String(error));
      return { capture, prepared, sent, duplicate, stale };
    });
    assert.ok(result.prepared.send_revision > result.capture.send_revision);
    assert.deepEqual(result.sent, { sent: true, captured: true });
    assert.equal(result.duplicate.sent, false);
    assert.match(result.stale, /mutation send overlapped/);
    return result;
  });
  await run('a later queued call synchronously cancels prepared suspension permission', async page => {
    const result = await page.evaluate(async () => {
      await w.open('prepared-stale'); await w.acquire(); await w.admit(w.capture('head'));
      await w.prepareExit(); w.arm('before-invoke');
      const capture = w.call({ op: 'sync_state' }).catch(e => String(e));
      const immediate = w.dispatchExit(); await w.hit(); const busy = w.dispatchExit();
      await w.terminate(); await capture;
      return { immediate, busy, crashed: w.dispatchExit() };
    });
    assert.equal(result.immediate.sent, false); assert.equal(result.busy.sent, false); assert.equal(result.crashed.sent, false);
    return result;
  });
  await run('failed synchronous exit capture prevents a prepared keepalive', async page => {
    const result = await page.evaluate(async () => {
      await w.open('prepared-storage'); await w.acquire(); await w.admit(w.capture('head'));
      await w.prepareExit(); const set = Storage.prototype.setItem;
      Storage.prototype.setItem = function(key, value) { if (key.includes('exit:')) throw Error('exit quota'); return set.call(this, key, value); };
      try { return w.dispatchExit(); } finally { Storage.prototype.setItem = set; }
    });
    assert.equal(result.sent, false); return result;
  });
  await run('exit journal replay increments the send fence after interruption', async page => {
    const result = await page.evaluate(async () => {
      await w.open('exit'); await w.acquire(); await w.admit(w.capture('exit-intent'));
      const before = await w.call({ op: 'sync_state', capture: false });
      if (!w.exit('exit-intent')) throw new Error('exit capture failed');
      await w.terminate(); await w.exits();
      const after = await w.call({ op: 'sync_state', capture: false });
      await w.exits(); const again = await w.call({ op: 'sync_state', capture: false });
      return { before: before.send_revision, after: after.send_revision, again: again.send_revision };
    });
    assert.ok(result.after > result.before); assert.equal(result.again, result.after);
    return result;
  });
} finally {
  await browser.close(); await new Promise(r => server.close(r));
  writeFileSync(out, JSON.stringify({ browser: 'Chromium', results, pageErrors, failures: results.filter(r => !r.ok).length }, null, 2) + '\n');
}
assert.equal(results.filter(r => !r.ok).length, 0, `see ${out}`);
assert.equal(pageErrors.length, 0, `unexpected page errors; see ${out}`);

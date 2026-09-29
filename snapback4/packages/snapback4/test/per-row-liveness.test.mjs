// @ref LLP 3000.023#10 — retired attempts release capacity and cannot publish late.
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { createClient } from '../dist/client.js';
import { createLocalClient } from '../dist/local.js';
import { webDevice, memoryPersistence } from '../dist/web.js';
import { processDevice } from '../dist/native.js';
import { READ_WORK_LIFETIME } from '../dist/read-work.js';
import { server, binary, until } from './helpers/app-server.mjs';

const point = { kind: 'query', name: 'point' };
const drain = async () => { for (let i = 0; i < 40; i++) await Promise.resolve(); };
// Mocking setTimeout also holds undici's zero-delay timers on some hosts (macOS).
// Advance only zero-delay timers while real I/O completes; no deadline or probe moves.
async function turns(t, work, label) {
  let done = false;
  const result = Promise.resolve().then(work).finally(() => { done = true; });
  const end = performance.now() + 10_000;
  while (!done && performance.now() < end) { t.mock.timers.tick(0); await new Promise(resolve => setImmediate(resolve)); }
  assert.ok(done, label);
  return result;
}
async function settle(t, predicate, label) {
  const end = performance.now() + 10_000;
  while (!predicate() && performance.now() < end) { t.mock.timers.tick(0); await new Promise(resolve => setImmediate(resolve)); }
  assert.ok(predicate(), label);
}
const parked = signal => new Promise((_, reject) => {
  if (signal.aborted) reject(Error('closed'));
  else signal.addEventListener('abort', () => reject(Error('closed')), { once: true });
});
async function deviceFixture(t, tier, wrap) {
  const { url, dir } = await server(t, '', readFileSync(new URL('../../../witness/per-row.q', import.meta.url), 'utf8'));
  const rows = Array.from({ length: 10 }, (_, slot) => ({ table: 'cards', row: { id: 'c' + slot, slot, owner: 'dev:alice', label: 'original' } }));
  assert.equal((await fetch(url + '/seed', { method: 'POST', body: JSON.stringify(rows) }).then(r => r.json())).seeded, 10);
  const underlying = tier === 'process' ? processDevice({ binary, dir: join(dir, 'device') }) : webDevice({
    wasm: readFileSync(new URL('../src/wasm/snapback4_device_bg.wasm', import.meta.url)), persist: memoryPersistence(),
  });
  const client = await createLocalClient({ url, persona: 'alice', device: { async open(...args) {
    return wrap(await underlying.open(...args));
  } }, fetch: (input, init) => new URL(input).pathname === '/changes' ? parked(init.signal) : fetch(input, init) });
  t.after(() => client.close());
  await client.sync();
  const edit = async () => {
    assert.equal((await fetch(url + '/m/edit', { method: 'POST', headers: { 'x-snapback-persona': 'alice' },
      body: JSON.stringify({ id: crypto.randomUUID(), args: { id: 'c0', label: 'changed' } }) }).then(r => r.json())).state, 'sent');
  };
  return { client, edit };
}

for (const tier of ['online', 'wasm', 'process']) for (const [end, keep] of [['close', undefined], ['close', false], ['close', true], ['expire', undefined]]) {
  test(`${tier} keep=${keep}: eight ${end === 'close' ? 'closed' : 'expired'} active reads cannot starve later observations or publish late`, { timeout: 15000 }, async t => {
    const held = [], order = [], signals = [], watches = [];
    let client, allow = false;
    t.after(() => { allow = true; held.splice(0).forEach(release => release()); watches.forEach(w => w.close()); });
    const shouldHold = id => !allow && /^c[0-7]$/.test(id);
    if (tier === 'online') {
      client = createClient({ url: 'http://read-liveness.test', persona: 'alice', fetch: async (input, init) => {
        const path = new URL(input).pathname;
        if (path === '/schema') return Response.json({ generation: 1, schema: { tables: {} }, programs: [] });
        if (path === '/changes') return parked(init.signal);
        if (path.startsWith('/q/')) {
          const { id } = JSON.parse(init.body).args;
          order.push(id);
          if (shouldHold(id)) {
            signals.push(init.signal);
            return new Promise(resolve => held.push(() => resolve(Response.json({ data: { id, label: 'late' }, seq: 999, tables: ['cards'] }))));
          }
          return Response.json({ data: { id, label: 'current' }, seq: 1, tables: ['cards'] });
        }
        throw Error(path);
      } });
      t.after(() => client.close());
      await client.query(point, { id: 'warm' }); order.length = 0;
    } else {
      ({ client } = await deviceFixture(t, tier, core => ({ ...core, async call(request, committed) {
        const result = await core.call(request, committed);
        if (request.op !== 'query') return result;
        const { id } = request.args;
        order.push(id);
        if (shouldHold(id)) return new Promise(resolve => held.push(() => resolve({ ...result, ok: { ...result.ok, data: { ...result.ok.data, label: 'late' } } })));
        return result;
      } })));
    }
    // Enable just before dispatch: advance the real production lifetime without sleeping.
    if (end === 'expire') t.mock.timers.enable({ apis: ['setTimeout'] });
    const mount = id => { const w = client.observe(point, { id }, { keep }); watches.push(w); w.subscribe(() => {}); return w; };
    const initial = Array.from({ length: 8 }, (_, i) => mount('c' + i));
    const pump = async predicate => {
      for (let i = 0; i < 2000 && !predicate(); i++) {
        if (end === 'expire') t.mock.timers.tick(1);
        await new Promise(resolve => setImmediate(resolve));
      }
      assert.ok(predicate(), 'controlled work made progress');
    };
    await pump(() => held.length === 8);
    const shared = mount('c0');
    initial[0].close();
    if (tier === 'online') assert.equal(signals[0].aborted, false, 'another owner still needs the shared attempt');
    const later = mount('c8');
    await drain(); assert.equal(order.length, 8, 'later owner is queued behind held work');
    allow = true;
    if (end === 'close') { initial.forEach(w => w.close()); shared.close(); }
    else t.mock.timers.tick(READ_WORK_LIFETIME);
    await pump(() => !!later.getSnapshot().data);
    assert.equal(order[8], 'c8', 'already queued owner precedes expired retries');
    if (tier === 'online') assert.ok(signals.every(signal => signal.aborted), 'transport receives cancellation');
    const replacements = end === 'close' ? initial.map((_, i) => mount('c' + i)) : initial;
    await pump(() => replacements.every(w => !!w.getSnapshot().data && !w.getSnapshot().revalidating));
    const snapshots = replacements.map(w => w.getSnapshot());
    const notifications = [];
    replacements.forEach(w => w.subscribe(() => notifications.push(w.getSnapshot())));
    held.splice(0).forEach(release => release());
    for (let i = 0; i < 10; i++) { await new Promise(resolve => setImmediate(resolve)); await drain(); }
    assert.deepEqual(replacements.map(w => w.getSnapshot()), snapshots, 'late retired replies never replace current answers');
    assert.equal(notifications.length, 0, 'late replies also cannot withdraw matching/overlapping owners');
    assert.notEqual(later.getSnapshot().data?.label, 'late');
  });
}

for (const tier of ['wasm', 'process']) test(`${tier}: acquired unknown apply footprint revalidates and refreshes every owner`, async t => {
  let queries = 0, omit = false;
  const { client, edit } = await deviceFixture(t, tier, core => ({ ...core, async call(request, committed) {
    if (request.op === 'query') queries++;
    const strip = result => {
      if (request.op !== 'apply' || !omit || !result.ok) return result;
      const { touched, ...ok } = result.ok;
      return { ...result, ok };
    };
    return strip(await core.call(request, result => committed?.(strip(result))));
  } }));
  const watches = [undefined, false, true].map(keep => client.observe(point, { id: 'c0' }, { keep }));
  watches.forEach(w => w.subscribe(() => {}));
  t.after(() => watches.forEach(w => w.close()));
  await until(() => watches.every(w => w.getSnapshot().data?.label === 'original' && !w.getSnapshot().revalidating), 'initial acquired observations');
  let withdrawals = 0;
  watches.forEach(w => w.subscribe(() => { if (w.getSnapshot().loading) withdrawals++; }));
  assert.equal(client.acquired, true);
  t.mock.timers.enable({ apis: ['setTimeout'] }); // A later background probe must not hide a lost apply refresh.
  omit = true; queries = 0;
  await turns(t, async () => { await edit(); await client.sync(); await drain(); }, 'edit and sync');
  assert.ok(queries > 0, 'the apply itself queues replacement evaluations');
  await settle(t, () => watches.every(w => w.getSnapshot().data?.label === 'changed' && !w.getSnapshot().revalidating), 'unknown-footprint refresh');
  assert.ok(withdrawals > 0, 'keep=false still withdraws during revalidation');
  assert.ok(queries > 0, 'replacement comes from new evaluations');
});

for (const tier of ['online', 'wasm', 'process']) test(`${tier}: cancelled transport preserves the earlier failure diagnostic`, async t => {
  const { url, dir } = await server(t, '', `use personas alice
table rows:
  value: int
  read <- allow
  online only
query remote(id: rows):
  return rows[id]
`);
  let held = false, cancelled = false, failed = false;
  const options = { url, persona: 'alice', fetch: async (input, init) => {
    const path = new URL(input).pathname;
    if (path === '/changes' || (failed && !path.startsWith('/q/'))) return parked(init.signal);
    if (path.startsWith('/q/')) {
      const { id } = JSON.parse(init.body).args;
      if (id === 'held') {
        held = true;
        return new Promise((_, reject) => init.signal.addEventListener('abort', event => {
          // This adapter consumes the event and reports cancellation by rejecting.
          // Local postForCaller otherwise wins the race with its own abort waiter,
          // never reaching sendPost's catch (which is the regression under test).
          event.stopImmediatePropagation();
          cancelled = true;
          reject(Object.assign(Error('observation cancelled'), { code: 'ABORT_ERR' }));
        }, { once: true }));
      }
      if (id === 'failure') {
        failed = true;
        throw Object.assign(Error('connection refused'), { code: 'ECONNREFUSED' });
      }
    }
    return fetch(input, init);
  } };
  const client = tier === 'online' ? createClient(options) : await createLocalClient({ ...options,
    device: tier === 'process' ? processDevice({ binary, dir: join(dir, 'device') }) : webDevice({
      wasm: readFileSync(new URL('../src/wasm/snapback4_device_bg.wasm', import.meta.url)), persist: memoryPersistence(),
    }),
  });
  t.after(() => client.close());
  if (client.sync) await client.sync(); else await client.query({ kind: 'query', name: 'remote' }, { id: 'warm' });
  const watch = client.observe({ kind: 'query', name: 'remote' }, { id: 'held' }); watch.subscribe(() => {});
  t.after(() => watch.close()); await until(() => held, 'cancellable request dispatched');
  await client.query({ kind: 'query', name: 'remote' }, { id: 'failure' });
  const diagnostic = () => client.act({ kind: 'action', name: 'offlineDiagnostic' }, {});
  const before = await diagnostic();
  assert.equal(before.denied?.code, 'E_OFFLINE');
  assert.match(before.denied.message, /ECONNREFUSED/);
  watch.close(); await until(() => cancelled, 'adapter rejected on cancellation');
  for (let i = 0; i < 20; i++) await new Promise(resolve => setImmediate(resolve));
  const after = await diagnostic();
  assert.deepEqual(after.denied, before.denied, 'cancellation cannot replace the recorded transport failure');
});

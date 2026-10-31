// @ref LLP 3000.002.000.000#2.4 — admission rechecks the machine in the transaction.
import test from 'node:test';
import assert from 'node:assert/strict';
import { registerHooks } from 'node:module';
registerHooks({ load(url, context, nextLoad) {
  const result = nextLoad(url, context);
  if (process.env.S3B_GATE_CONTROL && url === new URL('../dist/app-online.js', import.meta.url).href) {
    const source = String(result.source), needle = 'if (storeRefusal || ended && !captured)';
    assert.ok(source.includes(needle));
    result.source = source.replace(needle, 'if (false)');
  }
  return result;
} });
const { memorySessionStore } = await import('../dist/auth.js');
const { mintId } = await import('../dist/client.js');
const { storeKey, storeLock } = await import('../dist/app-storage.js');
const { ProgressiveWrites, progressiveWriteCustody } = await import('../dist/progressive-writes.js');
const { fixture, gate, tick, until, mutation } = await import('./helpers/progressive-writes.mjs');
const url = 'https://progressive-writes.invalid', key = storeKey('writes', url, 'alice');

for (const method of ['pause', 'close', 'signOut']) test(`S3b gate: ${method} while journal read is held refuses an unowned admission inside that transaction`, { timeout: 20_000 }, async t => {
  const memory = memorySessionStore(), entered = gate(), release = gate();
  let hold = false;
  const store = { ...memory, async get(k) {
    if (hold && k === key) { hold = false; entered.resolve(); await release.promise; }
    return memory.get(k);
  } };
  t.after(() => release.resolve());
  const f = await fixture(t, { raw: true, store, hold: false, report() {} });
  const handle = progressiveWriteCustody(f.app.client), id = mintId();
  hold = true;
  const writing = f.app.client.mutate(mutation, {}, { id, waitSeconds: 0 }); await entered.promise;
  let ending;
  if (method === 'pause') { handle.pause(); ending = f.app.client.close(); }
  else ending = f.app.client[method]();
  let ended = false; ending.then(() => { ended = true; });
  await tick(); assert.equal(ended, false, 'close owns this admission even before its commit');
  release.resolve(); const write = await writing; await ending;
  assert.deepEqual(JSON.parse(await memory.get(key) ?? 'null')?.pending ?? [], [], 'retirement leaves no newly admitted intent');
  assert.equal(write.state, 'failed');
  assert.equal(write.why.code, method === 'signOut' ? 'E_AUTH' : 'E_CLOSED', 'the transaction returns the machine retirement refusal');
  handle.start(); await tick(); assert.deepEqual(f.requests, []);
});

test('S3b gate: an opening waiter releases the transaction lock and retries behind every restored admission', { timeout: 20_000 }, async t => {
  const memory = memorySessionStore(), read = gate(), prefix = [mintId(), mintId()], id = mintId();
  await memory.set(key, JSON.stringify({ owner: 'alice', backend: url, pending: prefix.map(id => ({ owner: 'alice', id, op: 'write', args: {}, storeId: 'A' })), receipts: [] }));
  let progressive, armed = false;
  const store = { ...memory, async get(k) { const value = await memory.get(k); if (armed && k === key) { armed = false; read.resolve(); } return value; } };
  const install = ProgressiveWrites.prototype.install;
  t.mock.method(ProgressiveWrites.prototype, 'install', async function(local, ...args) {
    progressive = this; await install.call(this, local, ...args);
    const handle = progressiveWriteCustody(local), start = handle.start; let first = true;
    handle.start = () => { if (first) { first = false; return; } start(); };
  });
  const f = await fixture(t, { raw: true, store, hold: false, report() {} });
  assert.equal(progressive.lifetime, 'opening');
  armed = true;
  const writing = f.app.client.mutate(mutation, {}, { id, waitSeconds: 0 }); await read.promise;
  const before = await storeLock(key, () => memory.get(key));
  assert.deepEqual(JSON.parse(before).pending.map(write => write.id), prefix, 'the waiting transaction releases its lock without admitting');
  assert.deepEqual(f.requests, []);
  progressiveWriteCustody(f.app.client).start(); await writing;
  await until(() => f.requests.length === 3);
  assert.deepEqual(f.requests, [...prefix, id]);
  assert.equal(progressive.lifetime, 'installed');
});

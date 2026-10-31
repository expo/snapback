import test from 'node:test';
import assert from 'node:assert/strict';
import { registerHooks } from 'node:module';

// Hold the real prepared transport before prepareClient returns. Only this
// test process loads the hook; no scheduling seam enters the shipped client.
registerHooks({ load(url, context, nextLoad) {
  const result = nextLoad(url, context);
  if (url === new URL('../dist/client-start.js', import.meta.url).href) {
    const source = String(result.source), needle = 'const client = await create();';
    assert.ok(source.includes(needle));
    return { ...result, source: source.replace(needle, `${needle}\n        await globalThis.__e13Prepared?.(options, client);`) };
  }
  if (url === new URL('../dist/app-online.js', import.meta.url).href) {
    const source = String(result.source), needle = 'const viewer = raw.viewer();';
    assert.ok(source.includes(needle));
    return { ...result, source: source.replace(needle, `globalThis.__e13Opening?.(raw);\n    ${needle}`) };
  }
  return result;
} });
const { memorySessionStore, sessionKey } = await import('../dist/auth.js');
const { storeKey } = await import('../dist/app-storage.js');
const { mintId } = await import('../dist/client.js');
const { ProgressiveWrites, progressiveWriteCustody } = await import('../dist/progressive-writes.js');
const { fixture, gate, tick, mutation } = await import('./helpers/progressive-writes.mjs');
const regression = (name, work) => test(name, { timeout: 20_000 }, work);
const url = 'https://progressive-writes.invalid', key = storeKey('writes', url, 'alice');

for (const phase of ['prepare', 'journal', 'journal failure']) for (const method of ['close', 'signOut']) {
  regression(`E13 ${method} during nested ${phase} preserves refusal and retires new resources`, async t => {
    const memory = memorySessionStore(), entered = gate(), release = gate(), reports = [];
    await memory.set(key, 'damaged opening');
    let nested = false, failPreservation = false, failedSaves = 0, installs = 0, reads = 0, progressive, transport, transportCloses = 0, openings = 0, subscriptions = 0;
    const store = { ...memory, async get(k) {
      if (k === key) {
        reads++;
        if (nested && phase !== 'prepare') {
          nested = false; entered.resolve(); await release.promise;
          if (phase === 'journal failure') { failPreservation = true; return 'damaged retired opening'; }
        }
      }
      return memory.get(k);
    }, async set(k, value) {
      if (failPreservation && k.startsWith(`${key}.damaged.`)) { failedSaves++; throw Error('retired preservation failed'); }
      return memory.set(k, value);
    } };
    const install = ProgressiveWrites.prototype.install;
    t.mock.method(ProgressiveWrites.prototype, 'install', function(...args) {
      progressive = this; if (++installs === 2) nested = true;
      return install.apply(this, args);
    });
    globalThis.__e13Prepared = async (options, client) => {
      if (!nested || options.device) return;
      transport = client;
      const close = client.close;
      t.mock.method(client, 'close', async () => { transportCloses++; await close(); });
      if (phase === 'prepare') { entered.resolve(); await release.promise; }
    };
    globalThis.__e13Opening = raw => {
      openings++;
      for (const name of ['onViewer', 'onWrite', 'onPendingWrites']) {
        const subscribe = raw[name];
        t.mock.method(raw, name, listener => {
          subscriptions++; const stop = subscribe(listener); let stopped = false;
          return () => { if (!stopped) { stopped = true; subscriptions--; } stop(); };
        });
      }
    };
    t.after(() => { release.resolve(); delete globalThis.__e13Prepared; delete globalThis.__e13Opening; });
    const f = await fixture(t, { raw: true, store, hold: false, report: error => reports.push(error) });
    const local = f.app.client, refusal = local.mutate, closing = local.close, signingOut = local.signOut;
    const handle = progressiveWriteCustody(local);
    const recovering = progressive.pending(); await entered.promise;
    assert.ok(transport, 'transport exists at the held asynchronous boundary');
    reports.length = 0;
    const readsBefore = reads;
    let ended = false;
    const ending = local[method]().then(() => { ended = true; }); await tick();
    assert.equal(ended, false, 'public cleanup still waits for nested installation');
    release.resolve(); await recovering; await ending;
    assert.equal(local.mutate, refusal, 'retirement must preserve the refusal wrapper');
    assert.equal(local.close, closing); assert.equal(local.signOut, signingOut);
    assert.equal((await local.mutate(mutation, {}, { waitSeconds: 0 })).why?.code, method === 'signOut' ? 'E_AUTH' : 'E_CLOSED');
    assert.equal(progressive.custody, undefined, 'new custody is never published into the retired lifetime');
    assert.equal(progressiveWriteCustody(local), handle); assert.equal(handle.client, local);
    assert.ok(transportCloses > 0, 'new transport is closed');
    assert.equal((await transport.mutate(mutation, {})).why?.code, 'E_CLOSED');
    assert.equal(openings, phase === 'prepare' ? 0 : 1, 'retired preparation never enters custody opening');
    assert.equal(subscriptions, 0, 'new custody releases its original-client subscriptions');
    assert.deepEqual(reports, [], 'retired opening reports no storage error');
    assert.equal(failedSaves, phase === 'journal failure' ? 1 : 0, 'the failure witness reaches preservation reporting');
    if (phase === 'prepare') assert.equal(reads, readsBefore, 'retirement during preparation opens no journal');
    const retiredReads = reads;
    await progressive.pending(); await tick();
    assert.equal(installs, 2, 'retired failure cannot reinstall or re-arm recovery');
    assert.equal(reads, retiredReads, 'later reads cannot retry retired recovery');
    assert.deepEqual(f.requests, []);
    assert.deepEqual(JSON.parse(await memory.get(key)).pending, []);
  });
}

regression('E13 repaired dispatcher captures a click while its first inspection is held', async t => {
  const entries = new Map(), storage = { get length() { return entries.size; }, key: i => [...entries.keys()][i] ?? null,
    getItem: k => entries.get(k) ?? null, setItem: (k, value) => entries.set(k, String(value)), removeItem: k => entries.delete(k) };
  for (const [name, value] of Object.entries({ window: Object.assign(new EventTarget(), { location: { href: 'https://app.invalid' } }), localStorage: storage })) {
    const before = Object.getOwnPropertyDescriptor(globalThis, name); Object.defineProperty(globalThis, name, { configurable: true, value });
    t.after(() => before ? Object.defineProperty(globalThis, name, before) : delete globalThis[name]);
  }
  const session = sessionKey(url), authority = { capture: () => ({ key: session, epoch: '1', principal: 'alice', source: 'browser' }),
    read: async requested => requested === session ? JSON.stringify({ principal: 'alice', snapback4Epoch: '1' }) : '1', recheck() {} };
  const memory = memorySessionStore(), entered = gate(), release = gate();
  await memory.set(key, 'damaged opening');
  let installs = 0, nestedReads = 0, progressive;
  const store = { ...memory, async get(k) {
    if (k === key && installs === 2 && ++nestedReads === 2) { entered.resolve(); await release.promise; }
    return memory.get(k);
  } };
  const install = ProgressiveWrites.prototype.install;
  t.mock.method(ProgressiveWrites.prototype, 'install', function(...args) { progressive = this; installs++; return install.apply(this, args); });
  t.after(() => release.resolve());
  const f = await fixture(t, { raw: true, store, authority, hold: false, report: () => {} });
  let recovered = false;
  const recovering = progressive.pending().then(() => { recovered = true; }); await entered.promise;
  assert.equal(nestedReads, 2, 'online custody opened; first inspection owns the held read');
  const id = mintId(), writing = f.app.client.mutate(mutation, {}, { id, waitSeconds: 0 });
  assert.ok(progressiveWriteCustody(f.app.client).captures().some(write => write.id === id), 'the click is captured synchronously before inspection finishes');
  assert.ok([...entries.values()].some(value => JSON.parse(value).id === id), 'the capture is durable in browser storage');
  assert.equal(recovered, false); assert.deepEqual(f.requests, []);
  release.resolve(); await recovering;
  assert.notEqual((await writing).why?.code, 'E_ADMISSION');
  await f.posted.promise;
  assert.deepEqual(f.requests, [id]); assert.equal(f.executions.size, 1);
});

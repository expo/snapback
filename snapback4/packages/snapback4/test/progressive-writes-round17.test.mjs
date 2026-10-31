import test from 'node:test';
import assert from 'node:assert/strict';
import { registerHooks } from 'node:module';
registerHooks({ load(url, context, nextLoad) {
  const result = nextLoad(url, context);
  if (url === new URL('../dist/app-online.js', import.meta.url).href) {
    const source = String(result.source), needle = 'const refusedCapture = async () => {';
    assert.ok(source.includes(needle), needle);
    result.source = source.replace(needle, 'globalThis.__e17Gate?.(id); ' + needle);
  }
  if (url === new URL('../dist/client-start.js', import.meta.url).href) {
    const source = String(result.source), needle = 'const client = await create();';
    assert.ok(source.includes(needle), needle);
    result.source = source.replace(needle, needle + ' globalThis.__e17Prepared?.(options, client);');
  }
  return result;
} });
const { memorySessionStore } = await import('../dist/auth.js');
const { storeKey } = await import('../dist/app-storage.js');
const { createClient, mintId } = await import('../dist/client.js');
const { identifyDispatch } = await import('../dist/online-dispatch.js');
const { onlineCustody } = await import('../dist/app-online.js');
const { memoryPersistence } = await import('../dist/web.js');
const { ProgressiveWrites, progressiveWriteCustody } = await import('../dist/progressive-writes.js');
const { fixture, gate, until, mutation } = await import('./helpers/progressive-writes.mjs');
const regression = (item, name, work) => test(`E17 item ${item}: ${name}`, {
  timeout: 20_000, skip: process.env.E17_ITEM && !process.env.E17_ITEM.split(',').includes(String(item)),
}, work);
const url = 'https://progressive-writes.invalid', key = storeKey('writes', url, 'alice');
function hook(t, name, value) { globalThis[name] = value; t.after(() => { delete globalThis[name]; }); }
function browser(t) {
  const entries = new Map(), storage = { get length() { return entries.size; }, key: i => [...entries.keys()][i] ?? null,
    getItem: k => entries.get(k) ?? null, setItem: (k, value) => entries.set(k, String(value)), removeItem: k => entries.delete(k) };
  for (const [name, value] of Object.entries({ window: Object.assign(new EventTarget(), { location: { href: 'https://app.invalid' } }), localStorage: storage })) {
    const before = Object.getOwnPropertyDescriptor(globalThis, name); Object.defineProperty(globalThis, name, { configurable: true, value });
    t.after(() => before ? Object.defineProperty(globalThis, name, before) : delete globalThis[name]);
  }
  return entries;
}

async function recovered(t, options = {}) {
  const memory = memorySessionStore(); await memory.set(key, 'damaged opening');
  let blocked = true, progressive;
  const store = { ...memory, async get(k) { if (k === key && blocked) throw Error('opening unavailable'); return memory.get(k); } };
  const install = ProgressiveWrites.prototype.install;
  t.mock.method(ProgressiveWrites.prototype, 'install', function(...args) { progressive = this; return install.apply(this, args); });
  const f = await fixture(t, { raw: true, store, report: () => {}, ...options });
  const saved = { close: f.app.client.close, signOut: f.app.client.signOut };
  blocked = false;
  await until(async () => { await progressive.pending(); return !!progressive.custody; });
  return { ...f, progressive, saved };
}

for (const method of ['close', 'signOut', 'pause', 'viewer', 'store']) regression(1, `${method} refuses a fresh write already waiting on the non-browser gate`, async t => {
  const memory = memorySessionStore(), entered = gate(), id = mintId(), requests = [];
  const raw = createClient({ url, persona: 'alice', fetch: async (input, init) => {
    if (new URL(input).pathname === '/probe') return Response.json({ ok: true, store_id: 'A', seq: 0 });
    requests.push(JSON.parse(init.body).id); return Response.json({ state: 'sent', seq: 1 });
  } });
  await identifyDispatch(raw);
  const custody = await onlineCustody(raw, url, memory, error => { throw error; }, false);
  t.after(() => custody.client.close());
  hook(t, '__e17Gate', waiting => { if (waiting === id) entered.resolve(); });
  const writing = custody.client.mutate(mutation, {}, { id, waitSeconds: 0 });
  await entered.promise;
  let ending;
  if (method === 'pause') custody.pause();
  else if (method === 'viewer') { t.mock.method(raw, 'viewer', () => 'dev:bob'); custody.start(); }
  else if (method === 'store') { ending = custody.refuseStore({ code: 'E_STORE_REPLACED', family: 'store', message: 'store replaced' }); custody.start(); }
  else ending = custody.client[method]();
  const write = await writing; await ending;
  const journal = JSON.parse(await memory.get(storeKey('writes', url, 'dev:alice')) ?? 'null');
  assert.deepEqual(journal?.pending ?? [], [], 'the retired waiter must leave no replayable intent');
  assert.equal(write.state, 'failed');
  assert.equal(write.why.code, method === 'store' ? 'E_STORE_REPLACED' : 'E_AUTH');
  assert.deepEqual(requests, []);
});

for (const capture of [false, true]) for (const frame of ['steady', 'retained']) for (const method of ['close', 'signOut']) regression(3, `${frame} ${method} fences listener re-entry before pausing custody (capture=${capture})`, async t => {
  const entries = browser(t);
  const authority = capture ? { capture: () => ({ key: 'e17-session', epoch: '1', principal: 'alice', source: 'browser' }),
    read: async requested => requested === 'e17-session' ? JSON.stringify({ principal: 'alice', snapback4Epoch: '1' }) : '1', recheck() {} } : undefined;
  // Exercise the browser's synchronous admission path through a persistent
  // provider shape, retaining the backing map across opens for inspection.
  const persist = { ...memoryPersistence() };
  const f = frame === 'retained' ? await recovered(t, { hold: false, persist, authority }) : await fixture(t, { raw: true, hold: false, persist, authority });
  const client = f.app.client, id = mintId(), custody = progressiveWriteCustody(client);
  assert.ok(custody);
  await client.sync();
  let writing, armed = true;
  const stop = client.onPendingWrites(() => {
    if (!armed) return;
    armed = false; writing = client.mutate(mutation, {}, { id, waitSeconds: 0 });
  });
  t.after(stop);
  await (frame === 'retained' ? f.saved[method]() : client[method]());
  assert.ok(writing, 'the close notification re-enters mutate');
  const write = await writing;
  assert.deepEqual([...entries].filter(([k]) => k.startsWith('snapback4-online-admission:')), [], 'close notifications cannot create browser journal captures');
  assert.deepEqual([...entries].filter(([k]) => k.startsWith('snapback4-admission:')), [], 'the device admission outbox stays empty');
  assert.deepEqual([...persist.stores.values()].flatMap(store => [...store.values()].filter(change => change.s === 'o')), [], 'no device outbox intent survives close');
  assert.equal(write.state, 'failed', 'a synchronous close listener cannot admit into the device');
  assert.ok(['E_CLOSED', 'E_AUTH'].includes(write.why.code), JSON.stringify(write));
  assert.deepEqual((await f.journal())?.pending ?? [], []);
  assert.deepEqual(f.requests, []);
  // Reopen the same device persistence to inspect any intent admitted by re-entry.
  const reopened = await f.reopen({ startup: 'awaited' }); await reopened.ready;
  assert.deepEqual(await reopened.client.pendingWrites(), [], 'the device outbox stays empty');
  assert.deepEqual(f.requests, []);
});

for (const method of ['close', 'signOut']) regression(2, `retained ${method} after recovery closes private transport before a held response arrives`, async t => {
  let transports = 0, closed = 0;
  hook(t, '__e17Prepared', (options, client) => {
    if (options.device) return;
    transports++;
    const close = client.close;
    t.mock.method(client, 'close', () => { closed++; return close(); });
  });
  const f = await recovered(t, { receiptReply: reply => ({ ...reply, result: 'held-result' }) });
  assert.equal(transports, 1);
  assert.equal(f.progressive.recovering, undefined, 'opening recovery has fully completed');
  const writing = f.app.client.mutate(mutation, {}, { waitSeconds: 5 });
  await f.posted.promise;
  await f.saved[method]();
  const closedAtCutoff = closed;
  f.release.resolve();
  const write = await writing;
  assert.deepEqual({ closed: closedAtCutoff > 0, state: write.state, result: write.result },
    { closed: true, state: 'pending', result: undefined }, 'a response released after public close has no outcome custody');
  assert.equal(f.progressive.retryInspection, undefined, 'installed inspection scheduling is retired');
});

for (const method of ['close', 'signOut']) regression(4, `nested quarantine after ${method} reports its preserved side key`, async t => {
  const memory = memorySessionStore(), entered = gate(), release = gate(), reports = [], saves = [];
  await memory.set(key, 'damaged outer opening');
  const damaged = 'damaged nested opening'; let installs = 0, held = false, progressive;
  const store = { ...memory, async get(k) {
    if (k === key && installs === 2 && !held) { held = true; entered.resolve(); await release.promise; return damaged; }
    return memory.get(k);
  }, async set(k, value) { if (held && (k === key || k.startsWith(`${key}.damaged.`))) saves.push([k, value]); return memory.set(k, value); } };
  const install = ProgressiveWrites.prototype.install;
  t.mock.method(ProgressiveWrites.prototype, 'install', function(...args) { progressive = this; installs++; return install.apply(this, args); });
  t.after(() => release.resolve());
  const f = await fixture(t, { raw: true, store, hold: false, report: error => reports.push(error) });
  const recovering = progressive.pending(); await entered.promise;
  assert.equal(progressive.custody, undefined, 'the nested journal read precedes custody publication');
  reports.length = 0;
  const ending = f.app.client[method](); release.resolve(); await recovering; await ending;
  const sides = saves.filter(([k]) => k.startsWith(`${key}.damaged.`));
  assert.equal(sides.length, 1, 'the nested quarantine side key commits');
  assert.ok(saves.some(([k, value]) => k === key && JSON.parse(value).pending.length === 0), 'the empty active journal commits');
  assert.equal(await memory.get(sides[0][0]), damaged);
  assert.deepEqual(JSON.parse(await memory.get(key)).pending, []);
  assert.equal(reports.length, 1, 'successful preservation must disclose the recovery key after nested retirement');
  const side = JSON.parse(reports[0].why.rewrite.match(/sessionStore\.get\(("[^"]+")\)/)[1]);
  assert.equal(side, sides[0][0]);
  assert.equal(progressive.custody, undefined);
});

// retired under LLP 3000.002.000.000 §2.4
regression(5, 'pause during a failed preservation reports the retired opening streak once', async t => {
  const memory = memorySessionStore(), entered = gate(), release = gate(), reports = [];
  const damaged = 'damaged paused recovery'; await memory.set(key, damaged);
  let holding = false, attempts = 0, installs = 0, progressive;
  const store = { ...memory, async get(k) {
    if (k === key && holding) { holding = false; entered.resolve(); await release.promise; }
    return memory.get(k);
  }, async set(k, value) {
    if (k.startsWith(`${key}.damaged.`)) { attempts++; throw Error('preservation unavailable'); }
    return memory.set(k, value);
  } };
  const install = ProgressiveWrites.prototype.install;
  t.mock.method(ProgressiveWrites.prototype, 'install', async function(...args) {
    progressive = this; const opening = ++installs; await install.apply(this, args);
    if (opening === 1) {
      const handle = progressiveWriteCustody(args[0]), start = handle.start; let initial = true;
      handle.start = () => { if (initial) { initial = false; return; } start(); };
    }
  });
  t.after(() => release.resolve());
  const f = await fixture(t, { raw: true, store, hold: false, report: error => reports.push(error) });
  reports.length = 0; holding = true;
  const handle = progressiveWriteCustody(f.app.client), recovering = progressive.pending(); await entered.promise;
  handle.pause(); release.resolve(); await recovering;
  assert.equal(attempts, 1);
  handle.start(); await progressive.pending();
  assert.equal(attempts, 1, 'start after pause cannot retry preservation');
  assert.equal(reports.length, 1, 'retirement reports the last preservation failure once');
  assert.match(reports[0].why.message, /could not be preserved/);
  assert.equal(await memory.get(key), damaged);
  assert.equal(progressive.custody, undefined);
  assert.equal((await f.app.client.mutate(mutation, {}, { waitSeconds: 0 })).why?.code, 'E_CLOSED');
});

regression(1, 'a captured gate waiter commits journal custody for recovery after close', async t => {
  const entries = browser(t), memory = memorySessionStore(), entered = gate(), id = mintId(), requests = [];
  const authority = { capture: () => ({ key: 'e17-session', epoch: '1', principal: 'dev:alice', source: 'browser' }),
    read: async requested => requested === 'e17-session' ? JSON.stringify({ principal: 'dev:alice', snapback4Epoch: '1' }) : '1', recheck() {} };
  const open = async () => {
    const raw = createClient({ url, persona: 'alice', fetch: async (input, init) => {
      if (new URL(input).pathname === '/probe') return Response.json({ ok: true, store_id: 'A', seq: 0 });
      requests.push(JSON.parse(init.body).id); return Response.json({ state: 'sent', seq: 1 });
    } });
    await identifyDispatch(raw);
    const custody = await onlineCustody(raw, url, memory, error => { throw error; }, false, authority);
    t.after(() => custody.client.close()); return custody;
  };
  const first = await open();
  hook(t, '__e17Gate', waiting => { if (waiting === id) entered.resolve(); });
  const writing = first.client.mutate(mutation, {}, { id, waitSeconds: 0 }); await entered.promise;
  assert.equal([...entries.keys()].filter(k => k.startsWith('snapback4-online-admission:')).length, 1);
  await first.client.close(); assert.equal((await writing).state, 'pending', 'owned capture must not become an unadmitted refusal');
  const journal = JSON.parse(await memory.get(storeKey('writes', url, 'dev:alice')));
  assert.deepEqual(journal.pending.map(intent => intent.id), [id], 'the live session commits the captured intent even after close');
  assert.equal(journal.captured.length, 1);
  assert.ok(journal.captured[0].startsWith(`${id}:`), 'admitted.known leaves the capture marker in the commit');
  assert.deepEqual([...entries.keys()].filter(k => k.startsWith('snapback4-online-admission:')), [], 'the committed capture key is removed before reopen');
  assert.deepEqual(requests, [], 'closed custody cannot dispatch its newly committed intent');
  const next = await open(); next.start();
  await until(async () => (await next.client.write(id))?.state === 'sent');
  assert.deepEqual(requests, [id], 'the committed journal intent replays once on reopen');
  assert.deepEqual([...entries.keys()].filter(k => k.startsWith('snapback4-online-admission:')), []);
});

for (const method of ['signOut', 'viewer']) regression('HF1', `${method} cancels a captured gate waiter whose session ended before admission`, async t => {
  const entries = browser(t), memory = memorySessionStore(), entered = gate(), id = mintId(), requests = [], reads = [];
  let session = JSON.stringify({ principal: 'dev:alice', snapback4Epoch: '1' }), epoch = '1', rechecks = 0;
  const authority = { capture: () => ({ key: 'hf1-session', epoch: '1', principal: 'dev:alice', source: 'browser' }),
    async read(requested) { reads.push(requested); return requested === 'hf1-session' ? session : epoch; },
    recheck() { rechecks++; } };
  const open = async () => {
    const raw = createClient({ url, persona: 'alice', fetch: async (input, init) => {
      if (new URL(input).pathname === '/probe') return Response.json({ ok: true, store_id: 'A', seq: 0 });
      requests.push(JSON.parse(init.body).id); return Response.json({ state: 'sent', seq: 1 });
    } });
    await identifyDispatch(raw);
    const custody = await onlineCustody(raw, url, memory, error => { throw error; }, false, authority);
    t.after(() => custody.client.close()); return { raw, custody };
  };
  const { raw, custody: first } = await open();
  hook(t, '__e17Gate', waiting => { if (waiting === id) entered.resolve(); });
  const writing = first.client.mutate(mutation, {}, { id, waitSeconds: 0 }); await entered.promise;
  const captures = () => [...entries.keys()].filter(k => k.startsWith('snapback4-online-admission:'));
  const journal = async () => JSON.parse(await memory.get(storeKey('writes', url, 'dev:alice')) ?? 'null');
  assert.equal(captures().length, 1, 'the click is captured before the opening gate');
  assert.deepEqual((await journal())?.pending ?? [], [], 'the capture has not committed');
  reads.length = 0; epoch = '2';
  session = JSON.stringify(method === 'signOut' ? { snapback4Logout: epoch } : { principal: 'dev:bob', snapback4Epoch: epoch });
  if (method === 'signOut') await first.client.signOut();
  else { t.mock.method(raw, 'viewer', () => 'dev:bob'); first.pause(); }
  const write = await writing;
  assert.equal(write.state, 'failed', 'retirement must still check the captured admission authority');
  assert.deepEqual(write.why, {
    code: 'E_AUTH', family: 'auth', message: 'the session changed before this journaled write was admitted',
    site: 'client.mutate', rewrite: 'restore the current app session; submit again only if the write is still intended', guide: 'writes',
  });
  assert.ok(reads.includes('hf1-session'), 'admission reads current durable authority');
  assert.equal(rechecks, 1, 'the session-ended admission schedules a scope recheck');
  assert.deepEqual(captures(), [], 'the unadmitted capture is cancelled');
  assert.deepEqual((await journal())?.pending ?? [], []);
  assert.deepEqual((await journal())?.captured ?? [], [], 'cancellation creates no admission marker');
  assert.deepEqual(requests, []);
  const { custody: next } = await open(); next.start();
  await next.inspect();
  assert.deepEqual(await next.client.pendingWrites(), []);
  assert.equal(await next.client.write(id), undefined);
  assert.deepEqual(requests, [], 'reopen must not replay the cancelled click');
});

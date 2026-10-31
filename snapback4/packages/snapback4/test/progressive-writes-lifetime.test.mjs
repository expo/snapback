// @ref LLP 3000.002.000.000#2.4 — terminal lifetime, including held nested work.
import test from 'node:test';
import assert from 'node:assert/strict';
import { registerHooks } from 'node:module';
registerHooks({ load(url, context, nextLoad) {
  const result = nextLoad(url, context);
  if (url === new URL('../dist/client-start.js', import.meta.url).href) {
    const source = String(result.source), needle = 'const client = await create();';
    assert.ok(source.includes(needle));
    result.source = source.replace(needle, `${needle} await globalThis.__s3bPrepared?.(options, client);`);
  }
  return result;
} });
const { memorySessionStore, sessionKey } = await import('../dist/auth.js');
const { storeKey } = await import('../dist/app-storage.js');
const { mintId } = await import('../dist/client.js');
const { ProgressiveWrites, prepareProgressiveWrites, progressiveWriteCustody } = await import('../dist/progressive-writes.js');
const { ClosingResponse, ClosingResponses, trackClose } = await import('../dist/closing-responses.js');
const { fixture, gate, tick, until, mutation } = await import('./helpers/progressive-writes.mjs');
const url = 'https://progressive-writes.invalid', key = storeKey('writes', url, 'alice');

test('S3b lifetime table: every state × every event; absent edges have no effects', async () => {
  // Independent specification matrix, not imported from the implementation.
  const events = ['denied', 'recover', 'installed', 'retire', 'cleaned'];
  const rows = {
    opening:    ['denied', 'opening', 'installed', 'retiring', 'opening'],
    denied:     ['denied', 'recovering', 'denied', 'retiring', 'denied'],
    recovering: ['denied', 'recovering', 'installed', 'retiring', 'recovering'],
    installed:  ['installed', 'installed', 'installed', 'retiring', 'installed'],
    retiring:   ['retiring', 'retiring', 'retiring', 'retiring', 'retired'],
    retired:    ['retired', 'retired', 'retired', 'retired', 'retired'],
  };
  let edges = 0;
  for (const [state, targets] of Object.entries(rows)) for (const [i, event] of events.entries()) {
    const options = {}; prepareProgressiveWrites(options, { store: memorySessionStore(), report() {} });
    const writes = new ProgressiveWrites(options, url, 'alice'), held = gate(), calls = [];
    const responses = new ClosingResponses(), local = {};
    trackClose(local, responses);
    writes.local = local;
    writes.original = { close() { calls.push('fence'); responses.begin(); responses.finish(); return Promise.resolve(); } };
    writes.custody = { client: { close() { calls.push('custody'); return Promise.resolve(); } } };
    writes.lifetime = state;
    writes.track(held.promise);
    let released = false; responses.done.then(() => { released = true; });
    const result = writes.transition(event);
    assert.equal(writes.lifetime, targets[i], `${state} × ${event}`);
    const retires = event === 'retire' && !['retiring', 'retired'].includes(state);
    assert.deepEqual(calls, retires ? ['fence', 'custody'] : []);
    await Promise.resolve(); assert.equal(released, false, 'the response hold outlives all tracked opening work');
    held.resolve(); await result;
    if (retires) {
      assert.equal(writes.lifetime, 'retired');
      await responses.done;
      await writes.transition('retire'); writes.start();
      assert.deepEqual(calls, ['fence', 'custody'], 'one retirement, no resumed dispatcher');
    }
    edges++;
  }
  assert.equal(edges, 30);
});

for (const method of ['close', 'signOut']) test(`S3b H1: retained ${method} holds action response through installed opening inspection`, { timeout: 20_000 }, async t => {
  const memory = memorySessionStore(), entered = gate(), release = gate(), response = gate(), captured = gate(), deviceClosed = gate();
  await memory.set(key, 'damaged opening');
  let installs = 0, reads = 0, progressive, ended = false, answered = false;
  const store = { ...memory, async get(k) {
    if (k === key && installs === 2 && ++reads === 2) { entered.resolve(); await release.promise; }
    return memory.get(k);
  } };
  const install = ProgressiveWrites.prototype.install, capture = ClosingResponse.prototype.capture;
  t.mock.method(ProgressiveWrites.prototype, 'install', function(local, ...args) {
    progressive = this;
    if (++installs === 1) {
      const close = local.close;
      local.close = async () => { await close(); deviceClosed.resolve(); };
    }
    return install.call(this, local, ...args);
  });
  t.mock.method(ClosingResponse.prototype, 'capture', function(json, ...args) {
    capture.call(this, json, ...args); if (json.state === 'done') captured.resolve();
  });
  t.after(() => { release.resolve(); response.resolve(); });
  const f = await fixture(t, { raw: true, store, report() {}, actionReply: async id => {
    await response.promise; return { id, state: 'done', result: 'response owned through inspection' };
  } });
  const saved = f.app.client[method], recovering = progressive.pending(); await entered.promise;
  assert.ok(progressive.custody, 'custody is published while its first inspection is held');
  const acting = f.app.client.act({ kind: 'action', name: 'perform' }, {}).then(value => { answered = true; return value; });
  await until(() => f.actions.length === 1);
  const ending = saved().then(() => { ended = true; }); await deviceClosed.promise;
  response.resolve(); await captured.promise; await tick();
  assert.equal(ended, false); assert.equal(answered, false, 'local cleanup alone cannot release response custody');
  release.resolve(); await recovering; await ending;
  assert.equal((await acting).result, 'response owned through inspection');
  assert.equal(progressive.lifetime, 'retired');
});

function browser(t, enabled) {
  if (!enabled) return { entries: new Map(), end() {} };
  const entries = new Map(), storage = { get length() { return entries.size; }, key: i => [...entries.keys()][i] ?? null,
    getItem: key => entries.get(key) ?? null, setItem: (key, value) => entries.set(key, String(value)), removeItem: key => entries.delete(key) };
  for (const [name, value] of Object.entries({ window: Object.assign(new EventTarget(), { location: { href: 'https://app.invalid' } }), localStorage: storage })) {
    const before = Object.getOwnPropertyDescriptor(globalThis, name); Object.defineProperty(globalThis, name, { configurable: true, value });
    t.after(() => before ? Object.defineProperty(globalThis, name, before) : delete globalThis[name]);
  }
  let epoch = '1';
  return { entries, end() { epoch = '2'; }, authority: {
    capture: () => ({ key: 's3b-session', epoch: '1', principal: 'alice', source: 'browser' }),
    read: async key => key === 's3b-session' ? JSON.stringify({ principal: 'alice', snapback4Epoch: epoch }) : epoch,
    recheck() {},
  } };
}

// A reproducible scheduler walks actual asynchronous installs/admissions. The
// oracle tracks only custody facts: committed ids survive, uncommitted captures
// require current authority, and unowned writes never acquire custody on retire.
// Three held boundaries × two capture modes × four retirement events; each walk
// shuffles intake, repeated retire, start and pending calls around the release.
for (let seed = 0; seed < 48; seed++) test(`S3b lifetime model walk seed ${seed}`, { timeout: 20_000 }, async t => {
  const phase = ['prepare', 'journal', 'inspection'][seed % 3], capture = !!(Math.floor(seed / 3) % 2);
  const method = ['pause', 'close', 'signOut', 'viewer'][Math.floor(seed / 6) % 4];
  let random = seed + 1;
  const pick = n => { random = (Math.imul(random, 1664525) + 1013904223) >>> 0; return random % n; };
  const browserState = browser(t, capture), memory = memorySessionStore(), entered = gate(), release = gate();
  const restored = mintId(), fresh = [mintId(), mintId()], after = mintId();
  await memory.set(key, JSON.stringify({ owner: 'alice', backend: url, pending: [{ owner: 'alice', id: restored, op: 'write', args: {}, storeId: 'A' }], receipts: [] }));
  let first = true, installs = 0, nestedReads = 0, progressive, closes = 0, fenced = false;
  const store = { ...memory, async get(k) {
    if (k === key) {
      if (first) { first = false; throw Error('held initial opening'); }
      if (installs === 2 && ++nestedReads === (phase === 'journal' ? 1 : phase === 'inspection' ? 2 : -1)) {
        entered.resolve(); await release.promise;
      }
    }
    return memory.get(k);
  } };
  globalThis.__s3bPrepared = async (options, client) => {
    if (options.device || installs !== 2) return;
    const close = client.close; t.mock.method(client, 'close', () => { closes++; return close(); });
    if (phase === 'prepare') { entered.resolve(); await release.promise; }
  };
  t.after(() => { release.resolve(); delete globalThis.__s3bPrepared; });
  const install = ProgressiveWrites.prototype.install;
  t.mock.method(ProgressiveWrites.prototype, 'install', async function(local, ...args) {
    progressive = this; const opening = ++installs;
    if (opening === 1) {
      const close = local.close, signOut = local.signOut;
      t.mock.method(local, 'close', () => { fenced = true; return close(); });
      t.mock.method(local, 'signOut', () => { fenced = true; return signOut(); });
    }
    await install.call(this, local, ...args);
    if (opening === 1) {
      const handle = progressiveWriteCustody(local), start = handle.start;
      let firstStart = true;
      handle.start = () => { if (firstStart) { firstStart = false; return; } start(); };
    }
  });
  const f = await fixture(t, { raw: true, store, authority: browserState.authority, hold: false, report() {} });
  const local = f.app.client, savedClose = local.close, handle = progressiveWriteCustody(local);
  const recovering = progressive.pending(); await entered.promise;
  assert.equal(progressive.lifetime, 'recovering', 'published custody still waits for prefix activation');
  const outcomes = new Map(), promised = [];
  const submit = id => { const task = local.mutate(mutation, {}, { id, waitSeconds: 0 }); promised.push(task.then(value => outcomes.set(id, value))); };
  const actions = [...fresh.map(id => () => submit(id)), () => submit(restored)];
  while (actions.length) actions.splice(pick(actions.length), 1)[0]();
  const accepted = phase === 'inspection' && capture;
  if (accepted) assert.equal(handle.captures().length, fresh.length, 'fresh clicks own synchronous durable capture');
  const captures = () => [...browserState.entries.keys()].filter(k => k.startsWith('snapback4-online-admission:'));
  if (method === 'signOut' || method === 'viewer') browserState.end();
  let ending;
  if (method === 'pause') { handle.pause(); ending = savedClose(); }
  else if (method === 'viewer') ending = progressive.transition('retire', 'viewer');
  else ending = local[method]();
  assert.equal(fenced, true, 'device fence precedes custody notifications');
  assert.equal(progressive.lifetime, 'retiring');
  let ended = false; ending.then(() => { ended = true; });
  const refusal = method === 'signOut' || method === 'viewer' ? 'E_AUTH' : 'E_CLOSED';
  for (let n = 0; n < 6; n++) {
    switch (pick(3)) {
      case 0: handle.start(); break;
      case 1: assert.equal((await local.mutate(mutation, {}, { id: after, waitSeconds: 0 })).why?.code, refusal); break;
      case 2: void savedClose(); break;
    }
  }
  await tick(); assert.equal(ended, false, 'retained close drains the held opening/inspection');
  assert.deepEqual(f.requests, []);
  release.resolve(); await recovering; await ending; await Promise.all(promised);
  assert.equal(progressive.lifetime, 'retired'); assert.ok(closes > 0);
  const journal = JSON.parse(await memory.get(key));
  const preserved = accepted && !['signOut', 'viewer'].includes(method);
  assert.deepEqual(journal.pending.map(write => write.id).sort(), [restored, ...(preserved ? fresh : [])].sort());
  for (const id of fresh) {
    const outcome = outcomes.get(id);
    if (preserved) assert.equal(outcome.state, 'pending');
    else assert.equal(outcome.why?.code, accepted ? 'E_AUTH' : phase === 'inspection' ? refusal : 'E_ADMISSION');
  }
  if (phase === 'inspection') assert.equal(outcomes.get(restored).state, 'pending', 'committed replay keeps custody');
  assert.deepEqual(captures(), []);
  assert.deepEqual(f.requests, []);
  const saved = await memory.get(key), count = installs;
  handle.start(); await progressive.pending(); await tick();
  assert.equal(installs, count); assert.equal(await memory.get(key), saved, 'no writes after cleanup');
  // A new sign-in supplies the next opening's authority after signOut.
  await memory.set(sessionKey(url), JSON.stringify({ token: 'next-token', principal: 'alice', kind: 'user', expiresAt: Date.now() + 86400000 }));
  const reopened = await f.reopen(); await reopened.ready;
  await until(() => f.requests.length === journal.pending.length);
  assert.deepEqual([...f.requests].sort(), journal.pending.map(write => write.id).sort(), 'next open recovers every preserved id');
});

import { withHangGuard } from './helpers/wait.mjs';
import test from 'node:test';
import assert from 'node:assert/strict';
import { setTimeout as delay } from 'node:timers/promises';
import { readFileSync } from 'node:fs';
import { setup, q, m, until } from './helpers/one-shot.mjs';
import { createMockClient } from '../dist/mock.js';
const { createClient } = await import('../dist/client.js');
const { guardClient } = await import('../dist/app-client.js');

// Fire the production deadline only after the competing state is recorded.
// This avoids turning a slow CI setup into a different race.
function deadline(t) {
  const set = globalThis.setTimeout; let fire;
  t.mock.method(globalThis, 'setTimeout', (fn, ms, ...args) => {
    if (ms === 30_000) { fire ??= () => fn(...args); return set(() => {}, ms); }
    return set(fn, ms, ...args);
  });
  return () => { assert.ok(fire); fire(); };
}
async function bounded(work) {
  return withHangGuard(() => work, 'independent query watchdog');
}

for (const tier of ['wasm', 'process', 'app-wasm', 'app-process']) {
  test(`${tier}: a terminal change-stream refusal wins a blocked query deadline`, async t => {
    const gate = Promise.withResolvers(), change = Promise.withResolvers(); let armed = false, blocked = false;
    t.after(() => { gate.resolve(); change.resolve(); });
    const f = await setup(t, tier, {
      changes: async () => { await change.promise; return Response.json({ denied: { code: 'E_SYNC', family: 'sync', retryable: false, message: 'change stream refused' } }, { status: 400 }); },
      device: core => ({ ...core, async call(request, commit) {
        const result = await core.call(request, commit);
        if (armed && !blocked && request.op === 'query') { blocked = true; await gate.promise; }
        return result;
      } }),
    });
    const fire = deadline(t); armed = true;
    const pending = f.client.query(q('item'), {}); await until(() => blocked);
    change.resolve();
    let next;
    await until(async () => { next = await f.client.query(q('item'), {}); return next.denied?.code === 'E_SYNC'; });
    fire(); assert.deepEqual(await bounded(pending), next);
  });
  for (const terminal of ['restore', 'partition']) test(`${tier}: ${terminal} refusal wins a blocked query deadline`, async t => {
    let changed = false, core, armed = false, blocked = false;
    const gate = Promise.withResolvers(); t.after(() => gate.resolve());
    const f = await setup(t, tier, {
      device: c => { core = c; return { ...c, async call(request, commit) {
        const result = await c.call(request, commit);
        if (armed && !blocked && request.op === 'query') { blocked = true; await gate.promise; }
        return result;
      } }; },
      fetch: async (path, init, send) => {
        const response = await send();
        if (!changed || path !== '/sync') return response;
        if (terminal === 'partition') return Response.json({ denied: { code: 'E_SYNC', family: 'sync', message: 'partition refused', retryable: false } });
        const json = await response.json(); json.watermark = 0; json.images_at = 0;
        return Response.json(json);
      },
    });
    const fire = deadline(t); armed = true;
    const pending = f.client.query(q('item'), {}); await until(() => blocked);
    changed = true; await f.client.sync();
    const expected = terminal === 'restore' ? 'E_STORE_RESTORE' : 'E_SYNC';
    if (terminal === 'restore') assert.equal((await core.call({ op: 'sync_state', capture: false })).ok.restore_refusal?.code, expected);
    // A fresh query already sees the terminal state; the outstanding one must too.
    const next = await f.client.query(q('item'), {}); assert.equal(next.denied?.code, expected);
    fire();
    const read = await bounded(pending);
    assert.deepEqual(read, next); assert.notEqual(read.denied.retryable, true);
  });

  test(`${tier}: impossible held count refuses in one evaluation and never contacts the server`, async t => {
    let evaluations = 0, requests = 0;
    const f = await setup(t, tier, {
      device: core => ({ ...core, async call(request, commit) {
        const result = await core.call(request, commit);
        if (request.op === 'query' && request.name === 'heldInsights') evaluations++;
        return result;
      } }),
      fetch: (path, init, send) => { if (path === '/q/heldInsights') requests++; return send(); },
    });
    const read = await bounded(f.client.query(q('heldInsights'), {}));
    assert.equal(read.denied?.code, 'E_QUERY_HELD'); assert.equal(read.denied.retryable, false);
    assert.match(read.denied.message, /online.*(?:remove|drop).*held/i);
    assert.equal(evaluations, 1); assert.equal(requests, 0);
    // Observe keeps its loading contract; a non-held query still answers online.
    const watch = f.client.observe(q('heldInsights'), {}); t.after(() => watch.close());
    watch.subscribe(() => {}); await until(() => evaluations > 1);
    assert.equal(watch.getSnapshot().loading, true);
    assert.equal((await f.client.query(q('insights'), {})).data, 1);
    await f.offline();
    assert.equal((await f.client.query(q('heldInsights'), {})).denied?.code, 'E_OFFLINE');
  });

  test(`${tier}: a held query retries a concurrent prediction and can answer its other branch`, async t => {
    const f = await setup(t, tier); let rounds = 0;
    f.controls.boundary = async () => {
      if (++rounds === 1) await f.client.mutate(m('edit'), { body: 'local-branch' });
    };
    const read = await f.client.query(q('heldChoice'), {});
    assert.equal(read.data, 7); assert.equal(rounds, 2);
    assert.equal((await f.client.query(q('heldItem'), {})).data.body, 'local-branch');
  });
}

for (const facade of [false, true]) for (const replaced of [false, true]) for (const stage of ['transport', 'authority']) {
  if (!facade && stage === 'authority') continue;
  test(`${facade ? 'facade' : 'online'}: ${replaced ? 'reset' : 'restore'} wins the ${stage} deadline`, async t => {
    const gate = Promise.withResolvers(); let changed = false, block = false, started = false;
    t.after(() => gate.resolve());
    const raw = createClient({ url: 'http://terminal.test', persona: 'alice', fetch: async url => {
      if (url.includes('/q/profile') && block) { started = true; await gate.promise; }
      return Response.json({ store_id: changed && replaced ? 'B' : 'A', seq: changed ? 1 : 10, data: ['answer'], complete: true });
    } });
    const guarded = guardClient(raw, async () => {
      if (block && stage === 'authority') { started = true; await gate.promise; }
      return true;
    }, () => true, () => ({ code: 'E_AUTH', family: 'auth', message: 'scope changed' }));
    const client = facade ? guarded.client : raw;
    t.after(() => raw.close());
    await raw.query(q('item'), {});
    const fire = deadline(t); block = true;
    const pending = client.query(q('profile'), {}); await until(() => started);
    changed = true;
    const next = await raw.query(q('item'), {});
    assert.equal(next.denied?.code, replaced ? 'E_STORE_REPLACED' : 'E_STORE_RESTORE');
    fire(); assert.deepEqual(await bounded(pending), next);
  });
}

for (const tier of ['app-online', 'app-wasm', 'app-process']) for (const transition of ['logout', 'viewer']) test(`${tier}: ${transition} scope change wins a blocked authority deadline`, async t => {
  const f = await setup(t, tier, { fetch: (path, init, send) => path === '/auth/guest'
    ? Response.json({ ok: true, session: { kind: 'user', principal: 'dev:alice', token: 'alice-session', expiresAt: Date.now() + 10 * 86400000 } }) : send() });
  const gate = Promise.withResolvers(); let started = false;
  t.after(() => gate.resolve());
  const fire = deadline(t);
  f.controls.authority = () => { started = true; return gate.promise; };
  const pending = f.client.query(q('item'), {}); await until(() => started);
  // Real app sign-out revokes the exposed viewer scope synchronously, before
  // its private logout I/O and before this outstanding authority check returns.
  const ending = transition === 'logout' ? f.app.auth.logout() : f.app.auth.guest();
  if (transition === 'viewer') { const signedIn = await ending; t.diagnostic(JSON.stringify({ signedIn, auth: f.app.auth.getSnapshot() })); assert.equal(signedIn.ok, true); assert.equal(f.app.client.viewer(), 'dev:alice'); }
  fire(); const read = await bounded(pending);
  assert.equal(read.denied?.code, 'E_AUTH');
  gate.resolve(); await ending;
});


for (const tier of ['online', 'app-online']) test(`${tier}: held queries retain the terminal server refusal`, async t => {
  const f = await setup(t, tier);
  const read = await f.client.query(q('heldInsights'), {});
  assert.equal(read.denied?.code, 'E_QUERY_HELD'); assert.notEqual(read.denied.retryable, true);
});

function mock(t, queries) {
  const client = createMockClient({ viewer: 'alice', tables: {}, ops: { queries, mutations: {} } });
  t.after(() => client.close()); return client;
}
test('mock: a retired one-shot rereads instead of returning the old value', async t => {
  let current = 'old', calls = 0;
  const client = mock(t, { item: () => {
    calls++;
    if (calls === 1) queueMicrotask(() => { current = 'new'; client.setLink('online'); });
    return current;
  } });
  assert.equal((await client.query(q('item'), {})).data, 'new'); assert.equal(calls, 2);
});
test('mock: genuine publication exhaustion uses the shared retryable refusal', async t => {
  let calls = 0;
  const client = mock(t, { item: () => { calls++; client.setLink('online'); return 'value'; } });
  const read = await client.query(q('item'), {});
  assert.equal(read.denied?.code, 'E_QUERY_RETRY'); assert.equal(read.denied.retryable, true); assert.equal(calls, 4);
});
test('mock: closed and signed-out clients preserve terminal refusals', async t => {
  const client = mock(t, { item: () => 'value' });
  await client.close(); assert.equal((await client.query(q('item'), {})).denied?.code, 'E_CLOSED');
  const signedOut = mock(t, { item: () => 'value' });
  await signedOut.signOut(); assert.equal((await signedOut.query(q('item'), {})).denied?.code, 'E_AUTH');
});
test('mock: a throwing evaluator settles with the shared client refusal', async t => {
  const client = mock(t, { item: () => { throw Error('broken mock handler'); } });
  const read = await client.query(q('item'), {});
  assert.equal(read.denied?.code, 'E_CLIENT'); assert.match(read.denied.message, /broken mock handler/);
});

test('guide: stale one-shot continuations refuse and retain the first-page recovery', () => {
  const text = readFileSync(new URL('../../../crates/snapback4-lang/src/guide/search_all.md', import.meta.url), 'utf8').replace(/\s+/g, ' ');
  assert.match(text, /one-shot query[^.]*E_QUERY_RETRY[^.]*fresh first page/i);
  assert.doesNotMatch(text, /one-shot query returns loading/i);
});
test('guide: server-needing decorations remain separate', () => {
  const cards = ['client', 'offline_interactions'].map(name => readFileSync(new URL(`../../../crates/snapback4-lang/src/guide/${name}.md`, import.meta.url), 'utf8')).join('\n');
  assert.match(cards, /Keep server-needing decorations separate/);
});

for (const tier of ['online', 'app-online']) for (const stage of ['transport', 'authority']) {
 if (tier === 'online' && stage === 'authority') continue;
 test(`${tier}: terminal changes refusal at ${stage} deadline`, async t => {
  const gate = Promise.withResolvers(), change = Promise.withResolvers(); let block = false, started = false;
  t.after(() => { gate.resolve(); change.resolve(); });
  const f = await setup(t, tier, {
   changes: async () => { await change.promise; return Response.json({ denied: {code:'E_SYNC', family:'sync', retryable:false, message:'change stream refused'} }, {status:400}); },
   fetch: async (path, init, send) => { if (block && stage === 'transport' && path === '/q/profile') { started = true; await gate.promise; } return send(); }
  });
  const watch = f.client.observe(q('item'), {}); watch.subscribe(() => {}); t.after(() => watch.close());
  await until(() => watch.getSnapshot().data);
  if(stage === 'authority') f.controls.authority = () => { started=true; return gate.promise; };
  const fire = deadline(t);
  block = true; const pending = f.client.query(q('profile'), {}); await until(() => started);
  change.resolve();
  await until(() => watch.getSnapshot().denied?.code === 'E_SYNC');
  // Authority hook is only a scheduler; let fresh calls through.
  if(stage === 'authority') delete f.controls.authority;
  const next = await f.client.query(q('item'), {}); assert.equal(next.denied?.code, 'E_SYNC');
  fire(); const read = await bounded(pending);
  t.diagnostic(JSON.stringify({next, pending:read}));
  assert.deepEqual(read, next);
 });
}

for (const tier of ['wasm', 'process', 'app-wasm', 'app-process']) {
  test(`${tier}: a time-dependent held miss rereads across its cutoff`, async t => {
    // Capture a controlled wall reader when the client creates its clock, then
    // cross the cutoff only once its first held miss reaches the boundary.
    let wall = Date.now();
    t.mock.method(Date, 'now', () => wall);
    const f = await setup(t, tier); let rounds = 0;
    const cutoff = wall + 3_600_000;
    f.controls.boundary = async result => {
      if (++rounds === 1) {
        assert.equal(result.read.loading, true);
        wall = cutoff + 1;
      }
    };
    const current = await bounded(f.client.query(q('heldTime'), { cutoff }));
    assert.equal((await f.client.query(q('heldTime'), { cutoff })).data, 7);
    assert.equal(current.data, 7);
    assert.equal(rounds, 3, 'two outstanding evaluations plus the identical fresh call');
  });
  for (const input of ['arguments', 'coverage', 'membership']) test(`${tier}: a held miss dependent on ${input} remains retryable`, async t => {
    let requests = 0;
    const f = await setup(t, tier, { fetch: (path, init, send) => { if (path.startsWith('/q/held')) requests++; return send(); } });
    const name = { arguments: 'heldArgument', coverage: 'heldChoice', membership: 'heldMembership' }[input];
    const read = await f.client.query(q(name), input === 'arguments' ? { want: true } : {});
    assert.equal(read.denied?.code, 'E_QUERY_RETRY'); assert.equal(read.denied.retryable, true);
    if (input === 'coverage') await f.client.mutate(m('edit'), { body: 'answerable' });
    if (input === 'membership') { await f.client.mutate(m('remove'), {}); await f.client.sync(); }
    assert.equal((await f.client.query(q(name), input === 'arguments' ? { want: false } : {})).data, 7);
    assert.equal(requests, 0, 'held never asks the server');
  });
}
test('guide: the client contract names only proven permanent held refusals', () => {
  const card = readFileSync(new URL('../../../crates/snapback4-lang/src/guide/client.md', import.meta.url), 'utf8');
  const contract = card.split('\n').find(line => line.startsWith('`query(op, args)`'));
  assert.match(contract, /E_QUERY_RETRY.*proven permanently unavailable held reads refuse non-retryable `E_QUERY_HELD`/);
});

for (const tier of ['app-wasm', 'app-process']) for (const source of ['changes', 'partition', 'restore']) {
  for (const phase of ['opening', 'final']) test(`${tier}: ${source} wins a blocked ${phase} authority deadline`, async t => {
    const gate = Promise.withResolvers(), change = Promise.withResolvers();
    let changed = false, raw, checks = 0, started = false;
    t.after(() => { gate.resolve(); change.resolve(); });
    const f = await setup(t, tier, {
      changes: async signal => {
        if (source !== 'changes') return new Promise((_, reject) => signal.addEventListener('abort', () => reject(signal.reason), { once: true }));
        await change.promise;
        return Response.json({ denied: { code: 'E_SYNC', family: 'sync', retryable: false, message: 'change stream refused' } });
      },
      fetch: async (path, init, send) => {
        const response = await send();
        if (!changed || path !== '/sync') return response;
        if (source === 'partition') return Response.json({ denied: { code: 'E_SYNC', family: 'sync', retryable: false, message: 'partition refused' } });
        const json = await response.json(); json.watermark = 0; json.images_at = 0; return Response.json(json);
      },
    });
    f.controls.authority = client => {
      raw = client;
      if (++checks === (phase === 'opening' ? 1 : 2)) { started = true; return gate.promise; }
    };
    const fire = deadline(t), pending = f.client.query(q('item'), {});
    await until(() => started);
    if (source === 'changes') change.resolve();
    else { changed = true; await raw.sync(); }
    let fresh;
    const expected = source === 'restore' ? 'E_STORE_RESTORE' : 'E_SYNC';
    await until(async () => { fresh = await raw.query(q('item'), {}); return fresh.denied?.code === expected; });
    fire(); assert.deepEqual(await bounded(pending), fresh); assert.notEqual(fresh.denied.retryable, true);
  });
}

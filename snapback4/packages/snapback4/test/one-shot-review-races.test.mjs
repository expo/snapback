// @ref LLP 3000.023#11 — Astra/Grok overlap reproductions, preserving the round-1 prediction exception.
import test from 'node:test';
import assert from 'node:assert/strict';
import { writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { setTimeout as delay } from 'node:timers/promises';
const { setup } = await import('./helpers/one-shot.mjs');
const { fixture, source, q, m, until, parked, opener } = await import('./helpers/answers-stay.mjs');
const { createLocalClient } = await import('../dist/local.js');

const program = source.replace('  name: text\n  read <- allow', '  name: text\n  update <- allow\n  read <- allow') + `
mutation rename(name: text): server
  update profiles['bob'] { name }
`;

for (const tier of ['wasm', 'process']) for (const adopt of [false, true]) test(`${tier}: observation overlapping a committed POST preserves its outcome; adopt=${adopt}`, { timeout: 20000 }, async t => {
  const f = await fixture(t, program, { watch: true });
  const getSchema = () => fetch(f.url + '/schema', { headers: { 'x-snapback-persona': 'bob' } }).then(r => r.json());
  const before = await getSchema();
  const first = Promise.withResolvers(), tail = Promise.withResolvers();
  let tailCommitted = false;
  t.after(() => { first.resolve(); tail.resolve(); });
  const client = await createLocalClient({ url: f.url, persona: 'bob', device: opener(tier, join(f.dir, 'device')), fetch: async (url, init) => {
    const path = new URL(url).pathname;
    if (path === '/changes') return parked(init.signal);
    if (path === '/m/edit') await first.promise;
    const response = await fetch(url, init);
    if (path === '/m/rename') { tailCommitted = true; await tail.promise; }
    return response;
  } });
  t.after(() => client.close());
  await client.sync();
  const earlier = await client.mutate(m('edit'), { body: 'first-observed' }, { waitSeconds: 0 });
  const later = await client.mutate(m('rename'), { name: 'tail-committed' }, { waitSeconds: 0 });
  first.resolve();
  await until(() => tailCommitted);
  if (adopt) {
    writeFileSync(join(f.dir, 'snapback/schema.q'), program + '\nquery newGeneration():\n  return 42\n');
    await until(async () => (await getSchema()).generation > before.generation);
  }
  const read = await client.query(q('item'), {});
  assert.equal(read.data?.body, 'first-observed', JSON.stringify(read));
  tail.resolve();
  await until(async () => (await client.write(later.id))?.state === 'sent');
  assert.equal((await client.write(earlier.id)).state, 'sent');
  await client.sync();
  assert.equal((await client.query(q('profile'), {})).data?.name, 'tail-committed');
  console.log(JSON.stringify({ tier, adopt, earlier: await client.write(earlier.id), later: await client.write(later.id) }));
});

for (const tier of ['online', 'app-online']) for (const kind of ['gap', 'replay', 'dependent']) test(`${tier}: ${kind} receipt cannot hide a relevant commit`, async t => {
  const f = await setup(t, tier, { program });
  const replayId = '01K00000000000000000000001';
  let rounds = 0;
  f.controls.boundary = async () => {
    if (++rounds !== 1) return;
    if (kind !== 'dependent') {
      if (kind === 'replay') assert.equal((await f.post('/m/rename', { id: replayId, args: { name: 'new-name' } }, 'bob')).state, 'sent');
      assert.equal((await f.post('/m/edit', { id: 'external-edit', args: { body: 'changed' } })).state, 'sent');
      const write = await f.client.mutate(m('rename'), { name: 'new-name' }, kind === 'replay' ? { id: replayId } : undefined);
      assert.equal(write.state, 'sent', JSON.stringify(write));
    } else assert.equal((await f.client.mutate(m('edit'), { body: 'changed' })).state, 'sent');
  };
  const read = await f.client.query(q('item'), {});
  assert.ok(rounds > 0, 'the publication scheduling hook must have run');
  assert.equal(read.data?.body, 'changed', JSON.stringify(read));
  assert.equal(rounds, 2);
});

for (const tier of ['wasm', 'process']) test(`${tier}: store replacement during observation does not rewrite the held POST outcome`, { timeout: 45000 }, async t => {
  const nonPredicting = program.replace('mutation edit(body: text <=200):', 'mutation edit(body: text <=200): server');
  const old = await fixture(t, nonPredicting), replacement = await fixture(t, nonPredicting);
  const first = Promise.withResolvers(), tail = Promise.withResolvers();
  let activeUrl = old.url, tailCommitted = false, core, syncRequests = 0;
  const storeId = async url => (await fetch(url + '/schema', { headers: { 'x-snapback-persona': 'bob' } }).then(r => r.json())).store_id;
  const oldStore = await storeId(old.url), newStore = await storeId(replacement.url);
  t.after(() => { first.resolve(); tail.resolve(); });
  const underlying = opener(tier, join(old.dir, 'device'));
  const client = await createLocalClient({ url: old.url, persona: 'bob', device: { async open(...args) { return core = await underlying.open(...args); } }, fetch: async (url, init) => {
    const path = new URL(url).pathname;
    if (path === '/changes') return parked(init.signal);
    if (path === '/sync') syncRequests++;
    if (path === '/m/edit') await first.promise;
    const response = await fetch(String(url).replace(old.url, activeUrl), init);
    if (path === '/m/rename') { tailCommitted = true; await tail.promise; }
    return response;
  } });
  t.after(() => client.close());
  await client.sync();
  await client.mutate(m('edit'), { body: 'old-first' }, { waitSeconds: 0 });
  const tailOutcome = client.mutate(m('rename'), { name: 'old-tail' });
  first.resolve(); await until(() => tailCommitted);
  activeUrl = replacement.url;
  const beforeSync = syncRequests; let done = false;
  const reading = client.query(q('item'), {}).then(read => { done = true; return read; });
  await until(() => syncRequests > beforeSync); await delay(50);
  assert.equal(done, false, 'replacement adoption awaits the held POST');
  tail.resolve();
  const read = await reading, outcome = await tailOutcome;
  console.log(JSON.stringify({ tier, replacementRead: read, oldPostOutcome: outcome }));
  assert.equal(read.data?.body, 'image-1', JSON.stringify(read));
  assert.equal(outcome.state, 'sent', JSON.stringify(outcome));
  await until(async () => {
    const queued = await core.call({ op: 'queued' });
    const entry = queued.ok.find(entry => entry.id === outcome.id);
    const state = await core.call({ op: 'sync_state', capture: false });
    return state.ok.acquired && (!entry || entry.receipt_store?.success_seq != null);
  }, 'late receipt persistence and replacement acquisition');
  const remaining = await core.call({ op: 'queued' });
  console.log(JSON.stringify({ tier, oldStore, newStore, remaining, current: await core.call({ op: 'sync_state', capture: false }) }));
  assert.ok(remaining.ok.every(entry => entry.receipt_store?.id !== newStore), 'an old-store POST cannot become a successful receipt in the replacement');
  const syncsBeforeQuery = syncRequests;
  const profile = await client.query(q('profile'), {});
  console.log(JSON.stringify({ tier, profile, observationRequests: syncRequests - syncsBeforeQuery }));
  assert.equal(profile.data?.name, 'Bob', JSON.stringify(profile));
});

import test from 'node:test';
import assert from 'node:assert/strict';
import { localStatus } from '../dist/app.js';
import { memorySessionStore } from '../dist/auth.js';
import { mintId } from '../dist/client.js';
import { storeKey } from '../dist/app-storage.js';
import { ProgressiveWrites } from '../dist/progressive-writes.js';
import { episodeDeadline } from '../dist/read-episode.js';
import { fixture, gate, tick, until, mutation, query, schema } from './helpers/progressive-writes.mjs';
const regression = (name, work) => test(name, { timeout: 20_000 }, work);

regression('E12 inspected peer success cannot borrow the observing generation for an expanded write footprint', async t => {
  const owners = [], install = ProgressiveWrites.prototype.install;
  t.mock.method(ProgressiveWrites.prototype, 'install', async function(...args) {
    const result = await install.apply(this, args); owners.push(this); return result;
  });
  const store = memorySessionStore(), backend = structuredClone(schema), peerBackend = structuredClone(schema);
  const cover = gate(); let settled = false, covering = false; t.after(() => cover.resolve());
  const a = await fixture(t, { raw: true, store, backend, syncHead: 20, queryReply: async () => {
    if (!settled) return { data: 'other', complete: true, tables: ['other'], seq: 20, store_id: 'A', generation: 1 };
    covering = true; await cover.promise;
    return { data: 'other after write', complete: true, tables: ['other'], seq: 21, store_id: 'A', generation: 2 };
  } });
  await until(() => localStatus(a.app.client).getSnapshot().state === 'ready');
  const other = { kind: 'query', name: 'other' };
  assert.equal((await a.app.client.query(other, {})).data, 'other');
  // Only the executing peer adopts the expanded program. Inspection still sees
  // generation 1 here and the durable receipt has no execution generation.
  peerBackend.generation = 2;
  peerBackend.programs.find(op => op.name === 'write').settlement.writes.other = null;
  const b = await fixture(t, { raw: true, store, backend: peerBackend, receiptReply: r => ({ ...r, generation: 2 }) });
  const id = mintId(), writing = b.app.client.mutate(mutation, {}, { id, waitSeconds: 5 });
  await b.posted.promise;
  await until(() => !owners[0].uncertain && owners[0].current().some(write => write.id === id));
  settled = true; b.release.resolve(); assert.equal((await writing).state, 'sent');
  await until(() => !owners[0].uncertain && !owners[0].current().some(write => write.id === id));
  assert.equal(backend.generation, 1);
  assert.equal((await a.journal()).receipts.find(write => write.id === id).generation, undefined);
  let answer;
  const reading = a.app.client.query(other, {}).then(read => { answer = read; });
  await until(() => answer !== undefined || covering); await tick();
  assert.equal(answer, undefined, 'the pre-write other value at watermark 20 must wait for cut 21');
  assert.equal(covering, true, 'unknown execution generation requires a covering server read');
  cover.resolve(); await reading;
  assert.equal(answer.data, 'other after write');
});

for (const preserved of [[], ['items']]) regression(`E12 current own generation-mismatched receipt bounds a known preservation list ${JSON.stringify(preserved)}`, async t => {
  const held = gate(), queried = gate(); let revoke = false;
  t.after(() => held.resolve());
  const backend = structuredClone(schema);
  const f = await fixture(t, { backend, receiptReply: r => ({ ...r, generation: 2, preserved }), queryReply: async (_path, head) => {
    if (revoke) { queried.resolve(); await held.promise; }
    return { data: revoke ? 'replacement' : 'displayed', complete: true, tables: ['items'], scopes: { items: [{}] }, seq: head, store_id: 'A', generation: 2 };
  } });
  await f.app.ready;
  // The first receipt observes generation 2 and takes its normal reset. The
  // next receipt stays in that live authority while dependency metadata is 1.
  const warming = f.app.mutate(mutation, {}); await f.posted.promise; f.release.resolve();
  assert.equal((await warming).state, 'sent');
  const watch = f.app.client.observe(query, {}); watch.subscribe(() => {}); t.after(() => watch.close());
  await until(() => watch.getSnapshot().data === 'displayed');
  // Online evidence already knows generation 2, while the held device's
  // dependency metadata is generation 1. Receipt authority remains current.
  const receipt = ProgressiveWrites.prototype.receipt; let evidence;
  t.mock.method(ProgressiveWrites.prototype, 'receipt', function(id, value) { evidence = value; return receipt.call(this, id, value); });
  revoke = true;
  const writing = f.app.mutate(mutation, {}); await f.posted.promise; f.release.resolve();
  assert.equal((await writing).state, 'sent'); await queried.promise;
  assert.equal(backend.generation, 1); assert.equal(evidence.authorityCurrent(), true);
  assert.deepEqual(evidence.preserved, preserved);
  const deadline = episodeDeadline(watch.getSnapshot());
  assert.ok(deadline !== undefined && deadline - Date.now() <= 1000, 'known preservation still starts the withdrawal bound');
  await until(() => !('data' in watch.getSnapshot()));
  assert.ok(Date.now() <= deadline + 250, 'generation mismatch cannot retain the answer past its original bound');
  held.resolve(); await until(() => watch.getSnapshot().data === 'replacement');
});

regression('E12 replacement refusal naming C fences adopted B even when the journal transport is bound to A', async t => {
  const changes = [], store = memorySessionStore(), url = 'https://progressive-writes.invalid';
  const key = storeKey('writes', url, 'alice'), id = mintId();
  await store.set(key, JSON.stringify({ owner: 'alice', backend: url, pending: [{ owner: 'alice', id, op: 'write', args: {}, storeId: 'A' }], receipts: [] }));
  const f = await fixture(t, { raw: true, startup: 'awaited', journal: true, store, hold: false, onStoreChange: why => changes.push(why) });
  await until(async () => (await f.app.client.write(id))?.state === 'sent');
  f.replace('B'); await f.app.client.sync();
  const watch = f.app.client.observe(query, {}); watch.subscribe(() => {}); t.after(() => watch.close());
  await until(() => watch.getSnapshot().data === 'local');
  const before = changes.length;
  f.replace('C');
  const write = await f.app.client.mutate(mutation, {}, { waitSeconds: 5 });
  assert.equal(write.state, 'failed'); assert.equal(write.why.code, 'E_STORE_REPLACED');
  assert.equal(changes.length, before + 1, 'C is a new replacement, not the already-adopted B');
  assert.equal(watch.getSnapshot().denied?.code, 'E_STORE_REPLACED', 'the displayed B answer is fenced immediately');
  f.offline(true);
  assert.equal((await f.app.client.query(query, {})).denied?.code, 'E_STORE_REPLACED');
});

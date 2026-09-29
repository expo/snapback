import test from 'node:test';
import assert from 'node:assert/strict';
import { ReadIndex } from '../dist/read-index.js';
import { ReadObservation, invalidateReadEvidence } from '../dist/read-observation.js';
import { LocalReads } from '../dist/local-reads.js';
import { AssetLifetime, assetEvidence } from '../dist/asset-lifetime.js';
const ready = data => ({ data, fresh: true, complete: true, cut: null });
const watch = (name, table) => Object.assign(new ReadObservation(), { op: { name }, args: {}, tables: new Set([table]), subscribers: new Set() });

for (const shared of [false, true]) test(`indexed replacements visit linear owners (shared table=${shared})`, () => {
  for (const n of [100, 200, 400]) {
    const index = new ReadIndex();
    for (let i = 0; i < n; i++) { const w = watch('q' + i, shared ? 'rows' : 't' + i); w.publish(ready(i)); index.set(String(i), w); }
    let visits = 0;
    const count = iterable => ({ *[Symbol.iterator]() { for (const value of iterable) { visits++; yield value; } } });
    for (const method of ['matching', 'evidence']) { const original = index[method].bind(index); index[method] = (...args) => count(original(...args)); }
    index.values = () => { assert.fail('per-result scan of unrelated watches'); };
    for (let i = 0; i < n; i++) invalidateReadEvidence(index, { name: 'q' + i }, {}, ready(i), w => { w.serverSeq = 2; }, undefined, () => true, new Set([shared ? 'rows' : 't' + i]), 2);
    assert.equal(visits, 2 * n, `${n} replacements should visit ${2 * n}, not ${n * n}`);
    for (const w of index.affected(shared ? ['rows'] : ['t0'])) w.retire();
  }
});
test('dependency reassignment and close remove index registrations', () => {
  const index = new ReadIndex(), w = watch('q', 'a'); index.set('q', w);
  w.tables = new Set(['b']); assert.equal(index.affected(['a']).size, 0); assert.equal(index.affected(['b']).size, 1);
  w.tables = new Set(); assert.equal(index.affected(['a']).size, 1);
  index.delete('q'); assert.equal(index.affected(['b']).size, 0); assert.equal([...index.matching(w.op, {})].length, 0);
});
test('unknown-cut dependency evidence survives a known-cut replacement and an earlier sync', () => {
  const reads = new LocalReads(), serial = reads.evidenceSerial;
  reads.replacement('q:{}', undefined, new Set(['rows'])); reads.replacement('other:{}', 2, new Set(['rows']));
  reads.applied(2, true, serial);
  assert.equal(reads.blocked('alias:{}', new Set(['rows'])), true);
  assert.equal(reads.blocked('unrelated:{}', new Set(['notes'])), false);
  assert.equal(reads.accepts(new Set(['rows']), 2, serial), false);
  reads.applied(2, true, reads.evidenceSerial); assert.equal(reads.blocked('alias:{}', new Set(['rows'])), false);
});
const grant = seq => assetEvidence({ url: 'blob:secret', type: 'image/png', bytes: 1, revoke() {} }, seq === undefined ? {} : { seq });
const refusal = seq => assetEvidence({ denied: { code: 'E_ASSET_UNKNOWN' } }, seq === undefined ? {} : { seq });
for (const cut of [undefined, 2]) test(`per-asset refusal fences old acquisition (cut=${cut})`, () => {
  const life = new AssetLifetime(), revision = life.revision, old = life.begin(), newer = life.begin();
  life.own(refusal(cut), revision, 'secret', newer);
  assert.equal(life.own(grant(cut === undefined ? undefined : 1), revision, 'secret', old).denied?.code, 'E_ASSET_UNKNOWN');
  assert.ok(life.own(grant(cut === undefined ? undefined : 3), life.revision, 'secret', life.begin()).url);
});
for (const cut of [undefined, 2]) test(`older refusal preserves newer grant (cut=${cut})`, () => {
  const life = new AssetLifetime(), revision = life.revision, old = life.begin(), newer = life.begin();
  const handle = life.own(grant(cut === undefined ? undefined : 3), revision, 'secret', newer);
  life.own(refusal(cut), revision, 'secret', old); assert.ok(handle.url); handle.revoke();
});

// Exercise the actual mutation receipt loop, including lazy validation of an
// unrelated watch and the conservative reset when a later receipt has a gap.
test('Grok: 400 unrelated receipts do not visit all 400 online observations', async t => {
  const { createClient } = await import('../dist/client.js');
  const { until } = await import('./helpers/app-server.mjs');
  let cut = 1, gap = false;
  const reply = json => new Response(JSON.stringify(json), { headers: { 'content-type': 'application/json' } });
  const client = createClient({ url: 'http://receipts.test', persona: 'alice', fetch: async (input, init) => {
    const path = new URL(input).pathname;
    if (path === '/changes') return new Promise((_, reject) => {
      const abort = () => reject(Error('closed')); if (init.signal.aborted) abort(); else init.signal.addEventListener('abort', abort, { once: true });
    });
    if (path === '/schema') return reply({ generation: 1, schema: { tables: {} }, programs: [] });
    if (path.startsWith('/q/')) return reply({ generation: 1, seq: cut, data: { id: path }, tables: [path], complete: true });
    if (path.startsWith('/m/')) {
      const body = JSON.parse(init.body); cut += gap ? 2 : 1;
      return reply({ state: 'sent', id: body.id, seq: cut, head: cut, tables: ['notes'], result: null });
    }
    throw Error('unexpected path: ' + path);
  } });
  const watches = Array.from({ length: 400 }, (_, i) => client.observe({ kind: 'query', name: 'q' + i }, {}));
  watches.forEach(w => w.subscribe(() => {}));
  t.after(async () => { watches.forEach(w => w.close()); await client.close(); });
  await until(() => watches.every(w => w.getSnapshot().data), 'all watches ready');
  const original = ReadIndex.prototype.values;
  let visits = 0;
  ReadIndex.prototype.values = function* () { for (const watch of original.call(this)) { visits++; yield watch; } };
  t.after(() => { ReadIndex.prototype.values = original; });
  for (let i = 0; i < 400; i++) assert.equal((await client.mutate({ kind: 'mutation', name: 'note' }, {})).state, 'sent');
  assert.equal(visits, 400, 'first receipt establishes the interval; adjacent known unrelated receipts use their empty bucket');
  assert.ok(watches.every(w => w.getSnapshot().data));
  let withdrawn = 0; watches.forEach(w => w.subscribe(() => { if (w.getSnapshot().loading) withdrawn++; }));
  gap = true;
  assert.equal((await client.mutate({ kind: 'mutation', name: 'note' }, {})).state, 'sent');
  assert.ok(visits >= 800, 'an unseen commit gap checks every interval');
  assert.equal(withdrawn >= 400, true, 'unknown intervening effects still withdraw all old owners');
});

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

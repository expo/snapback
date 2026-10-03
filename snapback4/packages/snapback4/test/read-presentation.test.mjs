// @ref LLP 3000.031#7 — presentation consumes the published classifier; no second absence proof.
import test from 'node:test';
import assert from 'node:assert/strict';
import { existence, readPresentation } from '../dist/contract.js';
import { readyRead } from '../dist/read-existence.js';
import { ReadObservation } from '../dist/read-observation.js';
import { LocalReads } from '../dist/local-reads.js';

const ready = (data, metadata = {}, pending = false) => readyRead({ data, complete: true, cut: null, fresh: true, ...metadata }, pending);
const flags = (existence, rest = {}) => ({ existence, pending: false, incomplete: false, stale: false, revalidating: false, ...rest });

test('nonempty incomplete page keeps present and shows incompleteness for coverage, cuts and continuation', () => {
  for (const metadata of [{ complete: false }, { cut: 'meter' }, { cut: 'words' }, { next: 'more' }]) {
    assert.deepEqual(readPresentation(ready([{ id: 'row' }], metadata)), flags('present', { incomplete: true }));
  }
});

test('empty continuation is uncertain even when complete; final empty page can prove absence', () => {
  assert.deepEqual(readPresentation(ready([], { next: 'more' })), flags('partial', { incomplete: true }));
  assert.deepEqual(readPresentation(ready([], { next: null })), flags('absent'));
});

test('pending insertion consumes recomputed existence while the old empty answer is revalidating', t => {
  const reads = new LocalReads(), watch = new ReadObservation(true);
  t.after(() => watch.retire());
  watch.pending = () => reads.pending(new Set(['rows']));
  reads.queued([]); watch.publish(ready(null)); watch.reload();
  assert.equal(readPresentation(watch.read(null)).existence, 'absent');
  for (const predicted of [['rows/new'], undefined]) {
    reads.queued([{ predictable: true, ...(predicted ? { predicted } : {}) }]);
    assert.deepEqual(readPresentation(watch.read(null)), flags('partial', { incomplete: true, revalidating: true }));
  }
  reads.queued([{ predictable: true, predicted: ['other/new'] }]);
  assert.equal(readPresentation(watch.read(null)).existence, 'absent');
  watch.publish(ready([{ id: 'new', pending: true }], {}, true));
  assert.deepEqual(readPresentation(watch.read(null)), flags('present'), 'row pending is not read pending');
});

test('stale empty read remains absent, with freshness independent of revalidation and timestamp zero intact', () => {
  for (const fresh of [false, true]) for (const revalidating of [undefined, true]) {
    assert.deepEqual(readPresentation(ready([], { fresh, revalidating, since: 0 })),
      flags('absent', { stale: !fresh, revalidating: revalidating === true, since: 0 }));
  }
});

test('stale nonempty incomplete read stays present with both notices', () => {
  assert.deepEqual(readPresentation(ready([{ id: 'row' }], { fresh: false, complete: false })),
    flags('present', { incomplete: true, stale: true }));
});

test('presentation does not promote dev-meter internals into a disclosed cut or refusal', () => {
  const read = ready([], { meter: { cut: 'meter' } });
  assert.deepEqual(readPresentation(read), flags('absent'));
});

test('denied carries the exact refusal; hard withdrawal drops every ready flag without holding a result', t => {
  const watch = new ReadObservation(true); t.after(() => watch.retire());
  watch.publish(ready(['protected'], { fresh: false, since: 42, complete: false }));
  watch.reload(); readPresentation(watch.read(null));
  watch.publish({ loading: true });
  assert.deepEqual(readPresentation(watch.read(null)), flags('loading', { pending: true }));
  const why = Object.freeze({ code: 'E_AUTH', family: 'auth', message: 'Sign in again' });
  watch.publish({ denied: why });
  const status = readPresentation(watch.read(null));
  assert.deepEqual(status, flags('denied', { why })); assert.equal(status.why, why);
  assert.equal('data' in status, false); assert.equal('since' in status, false);
});

test('all derived cases agree with existence and neither inspect data nor change the input', () => {
  let cases = 0;
  const verify = read => {
    const before = structuredClone(read); Object.freeze(read);
    assert.equal(readPresentation(read).existence, existence(read));
    assert.deepEqual(read, before); cases++;
  };
  for (const data of [null, [], ['row'], false, 0, '', { nested: null }])
  for (const complete of [true, false]) for (const cut of [null, 'meter', 'words'])
  for (const next of [undefined, null, 'more']) for (const pending of [false, true])
  for (const fresh of [true, false]) for (const revalidating of [undefined, true]) {
    verify(ready(data, { complete, cut, next, fresh, revalidating }, pending));
  }
  verify({ loading: true }); verify({ denied: { code: 'NO', family: 'test', message: 'No' } });
  assert.equal(cases, 1010);
  const opaque = { existence: 'present', complete: true, cut: null, fresh: true,
    get data() { throw Error('presentation must not read protected values'); } };
  assert.deepEqual(readPresentation(opaque), flags('present'));
});

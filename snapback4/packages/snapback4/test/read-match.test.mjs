// @ref LLP 3000.031#8 — matching dispatches the published word, with original values.
import test from 'node:test';
import assert from 'node:assert/strict';
import { existence, matchRead, readPresentation } from '../dist/contract.js';
import { matchRead as reactMatch } from '../dist/react.js';
import { readyRead } from '../dist/read-existence.js';

const why = Object.freeze({ code: 'E_OFFLINE', family: 'client', message: 'Unavailable offline' });

test('matchRead dispatches every state once with the original narrowed arguments and return value', () => {
  assert.equal(reactMatch, matchRead);
  let cases = 0;
  const inspect = read => {
    Object.freeze(read);
    const calls = [], result = {};
    const handlers = Object.fromEntries(['loading', 'denied', 'absent', 'partial', 'present'].map(state => [state, (...args) => {
      calls.push(state);
      assert.equal(args.at(-1), read);
      if (state === 'denied') assert.equal(args[0], why);
      if (state === 'present' || state === 'partial') assert.equal(args[0], read.data);
      return result;
    }]));
    assert.equal(matchRead(read, Object.freeze(handlers)), result);
    assert.deepEqual(calls, [existence(read)]);
    cases++;
  };
  inspect({ loading: true }); inspect({ denied: why });
  // Includes nullable points, ordinary/empty pages, scalars, continuations,
  // coverage and disclosed cuts, pending-prediction uncertainty, and both
  // freshness values independently of revalidation and timestamps (including 0).
  for (const data of [null, Object.freeze([]), Object.freeze([{ id: 'row' }]), Object.freeze({ id: 'point' }), false, 0, '', undefined])
    for (const complete of [false, true]) for (const cut of [null, 'meter', 'words'])
      for (const next of [undefined, null, 'cursor']) for (const pending of [false, true])
        for (const fresh of [false, true]) for (const revalidating of [undefined, true])
          for (const since of [undefined, 0, 1234])
            inspect(readyRead({ data, complete, cut, next, fresh, revalidating, since }, pending));
  assert.equal(cases, 3458);
});

test('otherwise covers omitted loading, absent and present only; explicit handlers take precedence', () => {
  const reads = [
    { loading: true }, { denied: why },
    readyRead({ data: null, complete: true, cut: null, fresh: false, revalidating: true }),
    readyRead({ data: [], complete: false, cut: null, fresh: true }),
    readyRead({ data: [{ id: 'row' }], complete: false, cut: 'meter', fresh: false, next: 'more' }),
  ];
  const seen = [];
  const handlers = {
    denied: (refusal, read) => { assert.equal(refusal, why); seen.push(read); return 'denied'; },
    partial: (data, read) => { assert.equal(data, read.data); seen.push(read); return 'partial'; },
    otherwise: read => { seen.push(read); return 'otherwise'; },
  };
  assert.deepEqual(reads.map(read => matchRead(read, handlers)), ['otherwise', 'denied', 'otherwise', 'partial', 'otherwise']);
  assert.deepEqual(seen, reads);
  const all = { ...handlers, loading: () => 'loading', absent: () => 'absent', present: () => 'present' };
  assert.deepEqual(reads.map(read => matchRead(read, all)), ['loading', 'denied', 'absent', 'partial', 'present']);
});

test('matching never reclassifies, retains, traverses data or consumes metadata', () => {
  const data = new Proxy({}, { get() { throw Error('data traversal'); } });
  const ready = Object.freeze({ existence: 'present', data,
    get complete() { throw Error('metadata inspection'); },
    get fresh() { throw Error('metadata inspection'); } });
  assert.equal(matchRead(ready, { denied: () => assert.fail(), partial: () => assert.fail(), present: value => value, otherwise: () => assert.fail() }), data);
  // The private pending predicate can make otherwise complete emptiness partial.
  const pending = readyRead({ data: null, complete: true, cut: null, fresh: true, revalidating: true }, true);
  assert.equal(matchRead(pending, { denied: () => assert.fail(), partial: (_, read) => read, otherwise: () => assert.fail() }), pending);
  for (const read of [{ loading: true }, { denied: why }]) {
    assert.equal(matchRead(read, { loading: () => 'loading', denied: () => 'denied', partial: () => assert.fail(), otherwise: () => assert.fail() }), existence(read));
  }
});

test('present pages still expose incomplete, stale and revalidating independently', () => {
  for (const metadata of [{ complete: false }, { cut: 'meter' }, { cut: 'words' }, { next: 'more' }]) {
    const read = readyRead({ data: [{ id: 'row' }], complete: true, cut: null, fresh: false, revalidating: true, since: 0, ...metadata });
    const result = matchRead(read, { loading: () => assert.fail(), denied: () => assert.fail(), absent: () => assert.fail(), partial: () => assert.fail(), present: (data, narrowed) => {
      assert.equal(data, read.data); assert.equal(narrowed, read);
      return readPresentation(narrowed);
    } });
    assert.deepEqual(result, { existence: 'present', pending: false, incomplete: true, stale: true, revalidating: true, since: 0 });
  }
});

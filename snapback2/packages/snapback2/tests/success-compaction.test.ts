import assert from 'node:assert/strict';
import { test } from 'node:test';
import { CarrierIndex, PersistentRangeStore, SwapJournal, compactSuccesses, emptyState, factAssertion } from '../dist/sqlite-test.mjs';

const key = (id: string) => `messages\0${id}`;
const image = (id: string, body = id) => ({ table: 'messages', id, row: { id, body } });
const schema = { tables: { messages: { columns: { id: 'Id', body: { Text: { max: 100 } } },
  indexes: { byId: { components: [{ Column: 'id' }], unique: true } }, rules: {}, constraints: [] } } };
const program = { generation: 'g', schemaHash: 's', schema, programs: { edit: { planHash: 'p' } } };
const terminal = (intent: string, ids: string[], seq = 10) => ({ intent, op: 'edit', state: 'committed',
  response: { seq, program: { schemaHash: 's', planHash: 'p' }, effects: ids.map(id => ({ table: 'messages', id })) } });
const clone = (state: any) => JSON.parse(JSON.stringify(state));
function seed() {
  const state = emptyState(); state.facts = { generation: 'g', schemaHash: 's' }; state.programs = { g: clone(program) };
  for (const id of ['a', 'b', 'c']) { state.rows[key(id)] = image(id); state.rowSeq[key(id)] = 1; }
  state.outbox = { both: terminal('both', ['a', 'b']), other: terminal('other', ['c']), unseen: terminal('unseen', ['never-held']) };
  return state;
}
function oracle() {
  const state = seed(); let index = new CarrierIndex(state);
  const step = (mutate: (draft: any) => void, rollback = false) => {
    const before = clone(state), journal = new SwapJournal(state); mutate(journal.draft);
    const exhaustive = clone(state), candidates = index.successCandidates(journal.draft, journal.changed);
    const expected = compactSuccesses(exhaustive);
    const actual = compactSuccesses(journal.draft, undefined, candidates);
    assert.deepEqual(actual.sort(), expected.sort(), 'the same aliases leave custody');
    assert.deepEqual(state, exhaustive, 'incremental compaction equals exhaustive compaction');
    if (rollback) { journal.rollback(); assert.deepEqual(state, before); }
    else index.update(state, journal.changed);
    return candidates;
  };
  return { state, step, reopen: () => { index = new CarrierIndex(clone(state)); } };
}
const answer = (state: any, id: string, seq: number, extra = {}) => ({ op: 'view', args: {}, seq, state: 'complete', refs: [],
  rowProofs: { [key(id)]: factAssertion(state.rows[key(id)]) }, ...extra });

test('incremental success compaction follows answer proofs, exact images, and never-held negatives', () => {
  const { state, step, reopen } = oracle();
  assert.equal(step(() => {}), undefined, 'cold index requires an exhaustive pass');
  assert.deepEqual([...step(s => { s.rowSeq[key('a')] = 10; })!], ['both']);
  assert.deepEqual(state.outbox.both.effects, [{ table: 'messages', id: 'b' }]);
  assert.equal(step(s => { s.rowSeq[key('a')] = 11; })!.size, 0, 'discharged effects stop retaining candidates');
  for (const flag of ['retained', 'clockOnly', 'needsFactProofs']) {
    step(s => { s.answers.view = answer(state, 'b', 10, { [flag]: true }); });
    assert(state.outbox.both, `${flag} cannot discharge an effect`);
  }
  step(s => { s.answers.view = answer(state, 'b', 10, { state: 'denied' }); });
  step(s => { s.answers.view = answer(state, 'b', 10, { rowProofs: { [key('b')]: 'wrong-image' } }); });
  assert(state.outbox.both);
  assert.deepEqual([...step(s => { s.answers.view = answer(state, 'b', 10); })!], ['both'], 'answer-only unchanged proof selects the terminal');
  assert.equal(state.outbox.both, undefined);
  step(s => { s.negative[key('never-held')] = 10; });
  assert.equal(state.outbox.unseen, undefined, 'explicit absence need not have a positive image');
  step(s => { s.outbox.empty = terminal('empty', []); });
  assert.equal(state.outbox.empty, undefined, 'new empty effect terminal is checked without changed rows');
  step(s => { s.outbox.fresh = terminal('fresh', ['a']); });
  assert.equal(state.outbox.fresh, undefined, 'new terminal observes an already held image');
  reopen(); assert.equal(step(() => {}), undefined, 'a rebuilt cold index also requires an exhaustive pass');
});

test('incremental compaction falls back across identity, supersession, and root replacement', () => {
  for (const kind of ['facts', 'programs', 'superseded', 'rows', 'rowSeq', 'negative', 'answers', 'outbox']) {
    const { state, step } = oracle(); step(() => {});
    assert.equal(step(s => { s[kind] = kind === 'superseded' ? { generation: 'new' } : clone(s[kind]); }), undefined, kind);
    assert(state.outbox.both);
  }
  const { state, step } = oracle(); step(() => {});
  assert.equal(step(s => { s.facts.generation = 'other'; }), undefined);
  assert.equal(step(s => { s.facts.generation = 'g'; }), undefined);
  step(s => { s.programs.g.programs.edit.planHash = 'new'; s.rowSeq[key('c')] = 10; });
  assert(state.outbox.other, 'a different held plan cannot discharge old success');
  step(s => { s.programs.g.programs.edit.planHash = 'p'; });
  assert.equal(state.outbox.other, undefined, 'restoring the matching plan rechecks retained effects');
  step(s => { s.superseded = { generation: 'new' }; s.rowSeq[key('a')] = 10; s.rowSeq[key('b')] = 10; });
  assert(state.outbox.both);
  step(s => { delete s.superseded; });
  assert.equal(state.outbox.both, undefined);
});

test('failed compaction leaves the reverse effect index at its durable revision', () => {
  const { state, step } = oracle(); step(() => {});
  step(s => { s.rowSeq[key('a')] = 10; }, true);
  assert.equal(state.outbox.both.effects, undefined);
  step(s => { s.rowSeq[key('b')] = 10; });
  assert.deepEqual(state.outbox.both.effects, [{ table: 'messages', id: 'a' }]);
  step(s => { s.rowSeq[key('a')] = 10; }, true);
  assert(state.outbox.both);
  step(s => { s.rowSeq[key('a')] = 10; });
  assert.equal(state.outbox.both, undefined);
  step(s => { delete s.outbox.other; }, true);
  step(s => { s.rowSeq[key('c')] = 10; });
  assert.equal(state.outbox.other, undefined, 'a failed deletion does not remove the dependency');
});

test('unrelated retained effects are not revisited and replaced terminal dependencies leave the index', () => {
  const state = seed();
  for (let n = 0; n < 1000; n++) state.outbox[`retained-${n}`] = terminal(`retained-${n}`, [`unheld-${n}`]);
  const index = new CarrierIndex(state); index.update(state, new Map());
  const journal = new SwapJournal(state); journal.draft.rowSeq[key('a')] = 10;
  const candidates = index.successCandidates(journal.draft, journal.changed);
  assert.deepEqual([...candidates!], ['both']);
  let visited = 0;
  const observed = { ...state, outbox: new Proxy(state.outbox, { get(target, name: string) { visited++; return target[name]; } }) };
  compactSuccesses(observed, undefined, candidates);
  assert.equal(visited, 1, 'work depends on affected terminals rather than retained ledger length');
  index.update(state, new Map([['outbox', new Set(['both'])]]));
  const next = new SwapJournal(state); next.draft.outbox.both = terminal('both', ['c']);
  compactSuccesses(next.draft, undefined, index.successCandidates(next.draft, next.changed)); index.update(state, next.changed);
  assert.equal(index.successCandidates(state, new Map([['rowSeq', new Set([key('b')])]]))!.size, 0);
  assert.deepEqual([...index.successCandidates(state, new Map([['negative', new Set([key('c')])]]))!].sort(), ['both', 'other']);
});


test('mixed durable revisions stay equivalent to exhaustive compaction', () => {
  const { state, step, reopen } = oracle(); let random = 1729;
  const choose = (n: number) => { random = (Math.imul(random, 1664525) + 1013904223) >>> 0; return random % n; };
  for (let seq = 2; seq < 250; seq++) {
    const id = ['a', 'b', 'c', 'never-held'][choose(4)], intent = `write-${choose(13)}`, operation = choose(8);
    step(s => {
      if (operation === 0) { s.rows[key(id)] = image(id, `version-${seq}`); s.rowSeq[key(id)] = seq; }
      else if (operation === 1) s.negative[key(id)] = seq;
      else if (operation === 2) s.outbox[intent] = terminal(intent, [id, 'c'], seq + 2);
      else if (operation === 3) delete s.outbox[intent];
      else if (operation === 4 && s.rows[key(id)]) s.answers.view = answer(state, id, seq, { retained: choose(3) === 0 });
      else if (operation === 5) delete s.answers.view;
      else if (operation === 6) s.programs.g.programs.edit.planHash = choose(3) ? 'p' : 'different';
      else s.rowSeq[key(id)] = seq;
    }, choose(7) === 0);
    if (seq % 19 === 0) reopen();
  }
});

test('cold reads and failed carrier writes cannot mark an unchecked or aborted compaction complete', async () => {
  let saved = seed(), fail = false;
  saved.answers.view = { op: 'view', args: {}, seq: 1, state: 'complete', data: [], refs: [] };
  const factory = () => new PersistentRangeStore({ carrier: 'memory', open: async () => clone(saved),
    replace: async (state: any) => { if (fail) { fail = false; throw new Error('failed durable swap'); } saved = clone(state); },
    close() {}, wipe: async () => {} });
  let store = factory();
  try {
    await store.open('alice'); await store.answer('view', {}); await store.commit({});
    fail = true;
    await assert.rejects(store.commit({ tombstones: [{ table: 'messages', id: 'a', seq: 10 }] }), /failed durable swap/);
    await store.commit({ tombstones: [{ table: 'messages', id: 'b', seq: 10 }] });
    assert.deepEqual((await store.outbox.get('both')).effects, [{ table: 'messages', id: 'a' }]);
    await store.commit({ tombstones: [{ table: 'messages', id: 'a', seq: 10 }] });
    assert.equal(await store.outbox.get('both'), undefined);
    await store.close();
    // A legacy/cold image may hold an already observed success; reading an answer
    // can construct the carrier index before the first compaction transaction.
    saved.rowSeq[key('c')] = 10;
    store = factory(); await store.open('alice'); await store.answer('view', {});
    await store.commit({});
    assert.equal(await store.outbox.get('other'), undefined, 'cold read does not skip the exhaustive pass');
  } finally { await store.close(); }
});

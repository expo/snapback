import test from 'node:test';
import assert from 'node:assert/strict';
import { execute, generate, operations, round9Operations, round10Operations, round12Operations } from './helpers/online-client-model.mjs';

for (const [seed, tier, defect] of [[1615, 'client', 'round-9 direct-read schedule'], [142, 'app', 'a paused durable owner cannot report an unpersisted failure']])
  test(`model replay seed ${seed}: ${defect}`, () => execute(generate(seed, 32, round9Operations), tier));

for (const boundary of ['replacement', 'revocation']) test(`model scheduled replay: ${boundary} fences an accepted direct return`, () => execute([
  { op: 'query', holdReturn: true }, { op: 'release' },
  ...(boundary === 'replacement' ? [{ op: 'replace' }, { op: 'query' }] : [{ op: 'revoke' }]),
  { op: 'release', pick: 1 }, { op: 'release' },
], 'client'));

test('expanded model replay seed 1615: a poll awaiting refresh stops at terminal refusal', () => execute(generate(1615, 32, round10Operations), 'client'));

test('expanded model replay seed 16: overlapping callers keep paused durable intent pending', () => execute(generate(16, 32, round12Operations), 'app'));

test('model replay seed 1278: store refusal during discovery cannot admit intent after retirement', () =>
  execute(generate(1278), 'app', {}, { journalSize: 255 }));

test('R5 scheduled replay: a signed-out refresh still revokes its committed successor', () => execute([
  { op: 'refresh' }, { op: 'signOut' }, { op: 'release' },
], 'client'));
test('R5 scheduled replay: terminal refusal still owns the unread refresh successor', () => execute([
  { op: 'query' }, { op: 'release' }, { op: 'replace' }, { op: 'query' },
  { op: 'refresh' }, { op: 'release' }, { op: 'release' },
], 'client'));
for (const op of ['login', 'guest']) for (const ending of ['signOut', 'close'])
  test(`R5 scheduled replay: ${op} completes after ${ending} without orphaning its bearer`, () => execute([
    { op }, { op: ending }, { op: 'release' },
  ], 'app'));

test('online clients preserve R1–R6 across 3,000 seeded interleavings', { timeout: 180_000 }, async t => {
  const coverage = {}, count = Number(process.env.SNAPBACK4_ONLINE_SEQUENCES ?? 3000);
  for (let seed = 1; seed <= count; seed++) {
    const tier = seed % 2 ? 'client' : 'app', sequence = generate(seed);
    // Query counters are per sequence; aggregate only coverage labels.
    const measured = {};
    try { await execute(sequence, tier, measured, { journalSize: tier === 'app' ? (seed % 4 ? 255 : 256) : 0,
      unknownReceipts: seed % 8 ? 0 : 8, oldestFailure: seed % 8 === 4, saturated: seed % 20 === 0 }); }
    catch (error) { assert.fail(`seed=${seed} tier=${tier}: ${error.message}\nsequence=${JSON.stringify(sequence)}`); }
    for (const [key, n] of Object.entries(measured)) if (!key.startsWith('query.requests.')) coverage[key] = (coverage[key] ?? 0) + n;
  }
  if (count >= 3000) for (const op of operations) assert.ok(coverage['op.' + op] > 0, `exercised ${op}`);
  if (count >= 3000) for (const key of ['held.storage', 'failed.storage', 'held.return', 'released.return', 'released.reordered', 'wire./probe', 'write.emitted',
    'terminal.E_STORE_REPLACED', 'terminal.E_STORE_RESTORE', 'ack.revocation', 'check.durable-terminal', 'query.refetch',
    'wire./assets', 'wire./assets/photo', 'wire./a/charge', 'wire./auth/refresh', 'asset.released', 'refresh.committed', 'refresh.retired', 'body.aborted', 'check.bearer-custody', 'write.duplicate', 'wire./auth/guest', 'journal.preloaded.255', 'journal.preloaded.256', 'journal.full', 'journal.compact', 'write.retired-retry',
    'journal.saturated', 'check.admitted-pending', 'retirement.displaced.sent', 'write.displaced-retry', 'check.retirement-admission',
    'check.unpersisted-terminal', 'write.unpersisted-replayed', 'write.deduped', 'write.store-fenced',
    'refresh.unreached', 'probe.unrotated', 'journal.preloaded.ordinary-failure', 'retirement.displaced.ordinary-failure', 'write.displaced-ordinary-retry'])
    assert.ok(coverage[key] > 0, `exercised ${key}`);
  t.diagnostic(`sequences=${count}, seeds=1..${count}, coverage=${JSON.stringify(coverage)}`);
});

for (const unknownReceipts of [0, 8]) test(`full-journal model: replacement never replays retirement (${unknownReceipts} old failures)`, () => execute([
  { op: 'query' }, { op: 'release' }, { op: 'write' },
  { op: 'replace' }, { op: 'query' }, { op: 'release', pick: 1 },
  { op: 'release' }, { op: 'release' },
], 'app', {}, { journalSize: 256, unknownReceipts }));

test('R6 scheduled replay: saturation preserves admitted pending recovery', async () => {
  const coverage = {};
  await execute([{ op: 'release' }, { op: 'recoverPending' }, { op: 'reopen' }, { op: 'release' }, { op: 'recoverPending' }, { op: 'release' }],
    'app', coverage, { journalSize: 256, saturated: true });
  assert.ok(coverage['check.admitted-pending'] > 0, 'the schedule recovered a held pending intent');
});

for (const ordinaryFailureCode of [null, 'E_UNIQUE', 'E_CONFLICT']) test(`R6 scheduled replay: retry ${ordinaryFailureCode ? `an ${ordinaryFailureCode}` : 'a sent'} id displaced by retirement after reopening`, async () => {
  const coverage = {}, oldestFailure = ordinaryFailureCode !== null;
  await execute([{ op: 'query' }, { op: 'release' }, { op: 'write' }, { op: 'replace' },
    { op: 'query' }, { op: 'release', pick: 1 }, { op: 'release' }, { op: 'release' }],
    'app', coverage, { journalSize: 256, oldestFailure, ordinaryFailureCode });
  assert.ok(coverage[oldestFailure ? 'retirement.displaced.ordinary-failure' : 'retirement.displaced.sent'] > 0, 'retirement displaced the oldest receipt');
  assert.ok(coverage['write.displaced-retry'] > 0, 'the reopened client retried its id');
  if (oldestFailure) assert.ok(coverage['write.displaced-ordinary-retry'] > 0, 'the retry covers the displaced ordinary failure');
});

test('session recovery replay: replacement keeps a refresh that never reached the server', () => execute([
  { op: 'query' }, { op: 'release' }, { op: 'replace' }, { op: 'query' },
  { op: 'refreshUnreached' }, { op: 'release' }, { op: 'release' }, { op: 'release' },
], 'app', {}, { keepUnreachedSession: true }));

test('session recovery replay: sign-out still cleans up an unreached refresh', () => execute([
  { op: 'refreshUnreached' }, { op: 'signOut' }, { op: 'release' },
], 'client'));

// E's epoch lookup awaits storage; J's terminal store fence still owns dispatch
// after that await. These schedules exercise both action and mutation sends.
for (const seed of [774, 2592]) test(`integrated store fence survives an awaited epoch check: seed ${seed}`, () => execute(
  generate(seed), 'app', {}, { journalSize: seed % 4 ? 255 : 256,
    unknownReceipts: seed % 8 ? 0 : 8, oldestFailure: seed % 8 === 4, saturated: seed % 20 === 0 }));

test("R3 concurrent settlement retains the dispatch's previously persisted store binding", () => execute(
  generate(2140), 'app', {}, { journalSize: 256, oldestFailure: true, saturated: true }));

test('R3 scheduled replay: a known terminal with a failed receipt save dedupes after same-store reopen', async () => {
  const coverage = {};
  await execute(['query', 'release', 'failStorage', 'write', 'release', 'close', 'failStorage', 'reopen', 'release'].map(op => ({ op })), 'app', coverage);
  assert.ok(coverage['check.unpersisted-terminal'] > 0);
  assert.ok(coverage['write.unpersisted-replayed'] > 0);
  assert.ok(coverage['write.deduped'] > 0);
});

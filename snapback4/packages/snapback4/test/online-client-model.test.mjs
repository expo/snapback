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
    try { await execute(sequence, tier, measured, { journalSize: tier === 'app' ? (seed % 4 ? 255 : 256) : 0, unknownReceipts: seed % 8 ? 0 : 8, saturated: seed % 20 === 0 }); }
    catch (error) { assert.fail(`seed=${seed} tier=${tier}: ${error.message}\nsequence=${JSON.stringify(sequence)}`); }
    for (const [key, n] of Object.entries(measured)) if (!key.startsWith('query.requests.')) coverage[key] = (coverage[key] ?? 0) + n;
  }
  if (count >= 3000) for (const op of operations) assert.ok(coverage['op.' + op] > 0, `exercised ${op}`);
  if (count >= 3000) for (const key of ['held.storage', 'failed.storage', 'held.return', 'released.return', 'released.reordered', 'wire./probe', 'write.emitted',
    'terminal.E_STORE_REPLACED', 'terminal.E_STORE_RESTORE', 'ack.revocation', 'check.durable-terminal', 'query.refetch',
    'wire./assets', 'wire./assets/photo', 'wire./a/charge', 'wire./auth/refresh', 'asset.released', 'refresh.committed', 'refresh.retired', 'body.aborted', 'check.bearer-custody', 'write.duplicate', 'wire./auth/guest', 'journal.preloaded.255', 'journal.preloaded.256', 'journal.full', 'journal.compact', 'write.retired-retry',
    'journal.saturated', 'check.admitted-pending', 'retirement.displaced.sent', 'write.displaced-retry', 'check.retirement-admission'])
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
  await execute([{ op: 'recoverPending' }, { op: 'reopen' }, { op: 'recoverPending' }, { op: 'release' }],
    'app', coverage, { journalSize: 256, saturated: true });
  assert.ok(coverage['check.admitted-pending'] > 0, 'the schedule recovered a held pending intent');
});

test('R6 scheduled replay: retry a sent id displaced by retirement after reopening', async () => {
  const coverage = {};
  await execute([{ op: 'query' }, { op: 'release' }, { op: 'write' }, { op: 'replace' },
    { op: 'query' }, { op: 'release', pick: 1 }, { op: 'release' }, { op: 'release' }],
    'app', coverage, { journalSize: 256 });
  assert.ok(coverage['retirement.displaced.sent'] > 0, 'retirement displaced a sent receipt');
  assert.ok(coverage['write.displaced-retry'] > 0, 'the reopened client retried its id');
});

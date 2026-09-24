import test from 'node:test';
import assert from 'node:assert/strict';
import { execute, generate, operations, round9Operations } from './helpers/online-client-model.mjs';

for (const [seed, tier, defect] of [[1615, 'client', 'round-9 direct-read schedule'], [142, 'app', 'a paused durable owner cannot report an unpersisted failure']])
  test(`model replay seed ${seed}: ${defect}`, () => execute(generate(seed, 32, round9Operations), tier));

for (const boundary of ['replacement', 'revocation']) test(`model scheduled replay: ${boundary} fences an accepted direct return`, () => execute([
  { op: 'query', holdReturn: true }, { op: 'release' },
  ...(boundary === 'replacement' ? [{ op: 'replace' }, { op: 'query' }] : [{ op: 'revoke' }]),
  { op: 'release', pick: 1 }, { op: 'release' },
], 'client'));

test('expanded model replay seed 1615: a poll awaiting refresh stops at terminal refusal', () => execute(generate(1615), 'client'));

test('online clients preserve R1–R4 across 3,000 seeded interleavings', { timeout: 180_000 }, async t => {
  const coverage = {}, count = Number(process.env.SNAPBACK4_ONLINE_SEQUENCES ?? 3000);
  for (let seed = 1; seed <= count; seed++) {
    const tier = seed % 2 ? 'client' : 'app', sequence = generate(seed);
    // Query counters are per sequence; aggregate only coverage labels.
    const measured = {};
    try { await execute(sequence, tier, measured); }
    catch (error) { assert.fail(`seed=${seed} tier=${tier}: ${error.message}\nsequence=${JSON.stringify(sequence)}`); }
    for (const [key, n] of Object.entries(measured)) if (!key.startsWith('query.requests.')) coverage[key] = (coverage[key] ?? 0) + n;
  }
  if (count >= 3000) for (const op of operations) assert.ok(coverage['op.' + op] > 0, `exercised ${op}`);
  if (count >= 3000) for (const key of ['held.storage', 'failed.storage', 'held.return', 'released.return', 'released.reordered', 'wire./probe', 'write.emitted',
    'terminal.E_STORE_REPLACED', 'terminal.E_STORE_RESTORE', 'ack.revocation', 'check.durable-terminal', 'query.refetch',
    'wire./assets', 'wire./assets/photo', 'wire./a/charge', 'wire./auth/refresh', 'asset.released', 'refresh.aborted', 'refresh.retired'])
    assert.ok(coverage[key] > 0, `exercised ${key}`);
  t.diagnostic(`sequences=${count}, seeds=1..${count}, coverage=${JSON.stringify(coverage)}`);
});

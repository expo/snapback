import assert from 'node:assert/strict';
import { nextNominalAfter } from '../src/cron-utils.js';
import { startProof } from './harness.mjs';

for (const [now, expected] of [[9, 10], [10, 20], [11, 20], [35, 40], [40, 50]]) {
  assert.equal(nextNominalAfter(0, 10, now), expected, `now=${now}`);
}
assert.equal(nextNominalAfter(1_700_000_000_000, 180_000, 1_700_000_999_999), 1_700_001_080_000);
assert.throws(() => nextNominalAfter(0, 0, 1), /positive interval/);

const proof = await startProof({ app: 'all-aboard' });
try {
  // Durable Object alarms are absolute epoch timestamps and workerd clamps a
  // timestamp in 1970 to the real present. Translate the logical 0/10 clock
  // into a future epoch, then subtract that epoch in every assertion. The
  // scheduler math is translation-invariant, while the stored alarm remains
  // a real Miniflare alarm that can be inspected exactly.
  const epochMs = Date.now() + 60_000;
  for (const { nowMs, expected } of [
    { nowMs: 35, expected: 40 },
    { nowMs: 40, expected: 50 },
  ]) {
    const response = await proof.raw('/_snapback/test/cron-nominal-reconciliation', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ previousNominalMs: epochMs, intervalMs: 10, nowMs: epochMs + nowMs }),
    });
    assert.equal(response.status, 200, `Miniflare reconciliation status at now=${nowMs}`);
    const body = await response.json();
    assert.equal(body.previousNominalMs - epochMs, 0, `logical previous nominal at now=${nowMs}`);
    assert.equal(body.nowMs - epochMs, nowMs, `logical reconciliation time at now=${nowMs}`);
    assert.equal(body.nextNominalAtMs - epochMs, expected, `production advance at now=${nowMs}`);
    assert.equal(body.persistedNextNominalAtMs - epochMs, expected, `durable nominal at now=${nowMs}`);
    assert.equal(body.scheduledAlarmAtMs - epochMs, expected, `production alarm reconciliation at now=${nowMs}`);
    assert.equal(body.storedAlarmAtMs - epochMs, expected, `Durable Object alarm persistence at now=${nowMs}`);
  }
} finally {
  await proof.dispose();
}

const production = await startProof({ app: 'all-aboard', bindings: { SNAPBACK_TESTING: '0' } });
try {
  const hidden = await production.raw('/_snapback/test/cron-nominal-reconciliation', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ previousNominalMs: 0, intervalMs: 10, nowMs: 35 }),
  });
  assert.equal(hidden.status, 404, 'the deterministic scheduler seam must be absent in production');
} finally {
  await production.dispose();
}

console.log('cloudflare cron-utils tests: strict-next arithmetic, durable nominal persistence, and DO alarm rearming passed');

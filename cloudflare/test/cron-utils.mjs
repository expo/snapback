import assert from 'node:assert/strict';
import { nextNominalAfter } from '../src/cron-utils.js';

for (const [now, expected] of [[9, 10], [10, 20], [11, 20], [35, 40], [40, 50]]) {
  assert.equal(nextNominalAfter(0, 10, now), expected, `now=${now}`);
}
assert.equal(nextNominalAfter(1_700_000_000_000, 180_000, 1_700_000_999_999), 1_700_001_080_000);
assert.throws(() => nextNominalAfter(0, 0, 1), /positive interval/);

console.log('cloudflare cron-utils tests: strict-next boundary and missed-tick coalescing passed');

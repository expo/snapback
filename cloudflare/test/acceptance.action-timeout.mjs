// ENG-24343: once an action watchdog answers failure, a nested mutation that
// was already in flight must never cross its final synchronous commit fence.
import fs from 'node:fs';
import { startProof, ADMIN_TOKEN } from './harness.mjs';
import { SnapbackClient } from '../../demos/_kit/client.mjs';

const seed = JSON.parse(fs.readFileSync(new URL('../../demos/all-aboard/snapback/seed.json', import.meta.url), 'utf8'));

const proof = await startProof({
  app: 'all-aboard',
  port: 0,
  bindings: {
    SNAPBACK_ACTION_TIMEOUT_MS: '50',
    SNAPBACK_TEST_NESTED_COMMIT_DELAY_MS: '200',
  },
});

try {
  const base = await proof.url();
  const client = new SnapbackClient(base, { adminToken: ADMIN_TOKEN });
  await client.ensureApp({ seed });
  const before = await client.query('feedState', {});

  const startedAt = Date.now();
  const outcome = await client.action('probeNestedTimeout', { args: {} });
  if (outcome.ok !== false || outcome.diagnostic?.code !== 'SNAPBACK_ACTION_TIMEOUT') {
    throw new Error(`expected SNAPBACK_ACTION_TIMEOUT, got ${JSON.stringify(outcome)}`);
  }
  if (Date.now() - startedAt >= 175) {
    throw new Error('watchdog did not answer before the delayed nested commit boundary');
  }

  // Let the already-started nested invocation settle, then prove its staged
  // writes were discarded and the coordinator mutex remains usable.
  await new Promise((resolve) => setTimeout(resolve, 300));
  const responsiveAt = Date.now();
  const after = await client.query('feedState', {});
  if (Date.now() - responsiveAt >= 1000) throw new Error('coordinator remained wedged after timeout abandonment');
  if (after.version !== before.version || JSON.stringify(after.rows) !== JSON.stringify(before.rows)) {
    throw new Error(`nested mutation committed after timeout: before=${JSON.stringify(before)} after=${JSON.stringify(after)}`);
  }

  console.log('cloudflare action-timeout acceptance: timeout wins, delayed nested mutation commits nothing, coordinator recovers');
} finally {
  await proof.dispose();
}

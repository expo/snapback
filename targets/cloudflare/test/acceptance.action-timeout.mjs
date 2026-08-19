// ENG-24343: once an action watchdog answers failure, a nested mutation that
// was already in flight must never cross its final synchronous commit fence.
import fs from 'node:fs';
import http from 'node:http';
import { startProof, ADMIN_TOKEN, proxyOutboundTo } from './harness.mjs';
import { SnapbackClient } from '../../../demos/_kit/client.mjs';
import { cloudflareClientOptions } from '../client-options.mjs';

const seed = JSON.parse(fs.readFileSync(new URL('../../../demos/all-aboard/snapback/seed.json', import.meta.url), 'utf8'));
const AUTHORED_ORIGIN = 'https://upstream.example';

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
  const client = new SnapbackClient(base, cloudflareClientOptions({ adminToken: ADMIN_TOKEN }));
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

// A u64-like deployment binding must clamp to the hosted 15-minute ceiling,
// not overflow JavaScript's setTimeout range into an immediate timeout.
const quickServer = http.createServer((_request, response) => {
  setTimeout(() => {
    response.writeHead(200, { 'content-type': 'text/plain' });
    response.end('ok');
  }, 50);
});
await new Promise((resolve) => quickServer.listen(0, '127.0.0.1', resolve));
const hugeTimeout = await startProof({
  app: 'all-aboard',
  port: 0,
  bindings: { SNAPBACK_ACTION_TIMEOUT_MS: '18446744073709551615' },
  outboundService: proxyOutboundTo(`http://127.0.0.1:${quickServer.address().port}`),
});
try {
  const client = new SnapbackClient(
    await hugeTimeout.url(),
    cloudflareClientOptions({ adminToken: ADMIN_TOKEN }),
  );
  await client.ensureApp({ seed });
  const outcome = await client.action('probeLateMutation', {
    args: { url: `${AUTHORED_ORIGIN}/quick` },
  });
  if (outcome.ok !== true) {
    throw new Error(`huge action timeout overflowed instead of clamping: ${JSON.stringify(outcome)}`);
  }
  console.log('cloudflare action-timeout clamp acceptance: u64-like binding clamps instead of overflowing');
} finally {
  await hugeTimeout.dispose();
  quickServer.close();
}

// Reset is a second abandonment boundary independent of the wall-clock
// watchdog: an action that began before reset may not commit after reset has
// returned, even when it was parked in host fetch at the linearization point.
let releaseFetch;
let markFetchStarted;
const fetchStarted = new Promise((resolve) => { markFetchStarted = resolve; });
const slowServer = http.createServer((_request, response) => {
  markFetchStarted();
  releaseFetch = () => {
    if (response.destroyed) return;
    response.writeHead(200, { 'content-type': 'text/plain' });
    response.end('released');
  };
});
await new Promise((resolve) => slowServer.listen(0, '127.0.0.1', resolve));
const resetProof = await startProof({
  app: 'all-aboard',
  port: 0,
  bindings: { SNAPBACK_ACTION_TIMEOUT_MS: '5000' },
  outboundService: proxyOutboundTo(`http://127.0.0.1:${slowServer.address().port}`),
});
try {
  const base = await resetProof.url();
  const client = new SnapbackClient(base, cloudflareClientOptions({ adminToken: ADMIN_TOKEN }));
  await client.ensureApp({ seed });
  const action = client.action('probeLateMutation', {
    args: { url: `${AUTHORED_ORIGIN}/slow` },
  });
  await fetchStarted;
  const reset = await resetProof.reset();
  if (!reset.reset) throw new Error(`reset did not commit during the slow action: ${JSON.stringify(reset)}`);
  if (releaseFetch) releaseFetch();
  const outcome = await action;
  if (outcome.ok !== false || outcome.diagnostic?.code !== 'SNAPBACK_ACTION_RESET_ABORTED') {
    throw new Error(`pre-reset action was not abandoned: ${JSON.stringify(outcome)}`);
  }
  await new Promise((resolve) => setTimeout(resolve, 100));
  const after = await client.query('feedState', {});
  if (after.version !== 1 || after.rows[0]?.lastSource !== 'seed') {
    throw new Error(`pre-reset action committed after reset returned: ${JSON.stringify(after)}`);
  }
  console.log('cloudflare action-reset acceptance: reset abandons active action and no late nested mutation commits');
} finally {
  if (releaseFetch) releaseFetch();
  await resetProof.dispose();
  slowServer.close();
}

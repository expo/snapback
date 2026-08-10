import assert from 'node:assert/strict';
import test from 'node:test';

import {
  assertHoldingTag,
  awaitExactVersionPropagation,
  deriveHoldingTag,
  parseArguments,
} from './snapback-fastpath-release.mjs';

test('stage and release arguments parse without side effects', () => {
  const stage = parseArguments([
    'stage', '--version', '0.1.17', '--out', 'candidate', '--runtime-platforms', 'all',
  ]);
  assert.equal(stage.subcommand, 'stage');
  assert.equal(stage.version, '0.1.17');
  assert.equal(stage.runtimePlatforms, 'all');

  const release = parseArguments([
    'release', '--version', '0.1.17', '--out', 'candidate',
    '--receipt', 'darwin-arm64=darwin.json',
    '--receipt', 'linux-x64=linux.json',
    '--retain-ledger', 'retained.json',
    '--publish', '--otp', '123456',
  ]);
  assert.equal(release.subcommand, 'release');
  assert.equal(release.receipts.size, 2);
  assert.equal(release.publish, true);
  assert.equal(release.otp, '123456');

  assert.throws(
    () => parseArguments(['stage', '--version', 'latest']),
    (error) => error.code === 'SNAPBACK_FASTPATH_ARGUMENT_INVALID',
  );
  assert.throws(
    () => parseArguments(['stage', '--version', '01.2.3']),
    (error) => error.code === 'SNAPBACK_FASTPATH_ARGUMENT_INVALID',
  );
});

test('release refuses an incomplete receipt matrix', () => {
  assert.throws(
    () => parseArguments([
      'release', '--version', '0.1.17',
      '--receipt', 'darwin-arm64=darwin.json',
    ]),
    (error) => error.code === 'SNAPBACK_FASTPATH_STORE_RECEIPT_MISSING',
  );
});

test('holding tag is derived from exact version and source revision', () => {
  assert.equal(
    deriveHoldingTag('0.1.17', 'abcdef0123456789abcdef0123456789abcdef01'),
    'fastpath-0-1-17-abcdef012345',
  );
});

test('latest is never accepted as a holding tag', () => {
  assert.throws(
    () => assertHoldingTag('latest'),
    (error) => error.code === 'SNAPBACK_FASTPATH_HOLDING_TAG_INVALID',
  );
});

test('exact-version propagation waits for a lagging read replica', async () => {
  const packages = [
    { name: '@expo/snapback-cli', version: '0.1.17' },
    { name: '@expo/snapback-client', version: '0.1.17' },
  ];
  let probe = 0;
  const clock = { value: 0 };
  const summary = await awaitExactVersionPropagation(packages, {
    deadlineMs: 60_000,
    pollMs: 1_000,
    // The cli name answers ETARGET on the first sweep, exactly as the real
    // 0.1.17 cut did, and resolves on the second.
    exists: (name) => {
      if (name !== '@expo/snapback-cli') return true;
      probe += 1;
      return probe > 1;
    },
    now: () => clock.value,
    wait: async (ms) => { clock.value += ms; },
  });
  assert.equal(summary.ok, true);
  assert.equal(summary.resolved.length, 2);
  assert.equal(summary.waitedMs, 1_000);
});

test('exact-version propagation fails closed on a genuinely absent version', async () => {
  const clock = { value: 0 };
  await assert.rejects(
    () => awaitExactVersionPropagation([{ name: '@expo/snapback-cli', version: '9.9.9' }], {
      deadlineMs: 10_000,
      pollMs: 1_000,
      exists: () => false,
      now: () => clock.value,
      wait: async (ms) => { clock.value += ms; },
    }),
    (error) => error.code === 'SNAPBACK_FASTPATH_REGISTRY_PROPAGATION_TIMEOUT',
  );
});

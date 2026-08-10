import assert from 'node:assert/strict';
import test from 'node:test';

import {
  assertHoldingTag,
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

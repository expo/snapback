import assert from 'node:assert/strict';
import {
  mkdtempSync,
  realpathSync,
  rmSync,
} from 'node:fs';
import { dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

import { assessMetroWatchInertness } from './expo-dev.mjs';

const packageDirectory = dirname(fileURLToPath(import.meta.url));

function assertFrozen(advisories) {
  assert(Object.isFrozen(advisories));
  for (const advisory of advisories) {
    assert(Object.isFrozen(advisory));
    assert(Object.isFrozen(advisory.details));
  }
}

const defaulted = assessMetroWatchInertness({ env: {}, directory: packageDirectory });
assertFrozen(defaulted);
assert.equal(defaulted.length, 1);
assert.equal(defaulted[0].condition, 'ci-environment');
assert.equal(defaulted[0].details.defaulted, true);
assert.equal(defaulted[0].code, 'SNAPBACK_EXPO_METRO_WATCH_INERT');

for (const ci of ['1', 'true']) {
  const advisories = assessMetroWatchInertness({ env: { CI: ci }, directory: packageDirectory });
  assertFrozen(advisories);
  assert.equal(advisories.length, 1);
  assert.equal(advisories[0].condition, 'ci-environment');
  assert.equal(advisories[0].details.defaulted, false);
  assert.equal(advisories[0].details.ci, ci);
}

for (const ci of ['', '0', 'false']) {
  const advisories = assessMetroWatchInertness({ env: { CI: ci }, directory: packageDirectory });
  assertFrozen(advisories);
  assert.equal(advisories.some((advisory) => advisory.condition === 'ci-environment'), false);
}

const scratchDirectory = mkdtempSync('/tmp/snapback-watch-advisory-');
try {
  const realScratchDirectory = realpathSync(scratchDirectory);
  const pathOnly = assessMetroWatchInertness({
    env: { CI: '0' },
    directory: scratchDirectory,
  });
  assertFrozen(pathOnly);
  assert.equal(pathOnly.length, 1);
  assert.equal(pathOnly[0].condition, 'watcher-blind-root');
  assert(['/private/tmp', '/tmp'].includes(pathOnly[0].details.root));
  assert.equal(pathOnly[0].details.directory, realScratchDirectory);

  const both = assessMetroWatchInertness({ env: {}, directory: scratchDirectory });
  assertFrozen(both);
  assert.equal(both.length, 2);
  assert.deepEqual(
    both.map((advisory) => advisory.condition),
    ['ci-environment', 'watcher-blind-root'],
  );
} finally {
  rmSync(scratchDirectory, { recursive: true, force: true });
}

const missingDirectory = `/tmp/snapback-watch-advisory-missing-${process.pid}`;
let missing;
assert.doesNotThrow(() => {
  missing = assessMetroWatchInertness({
    env: { CI: '0' },
    directory: missingDirectory,
  });
});
assertFrozen(missing);
assert.equal(missing.length, 1);
assert.equal(missing[0].condition, 'watcher-blind-root');
assert.equal(missing[0].details.directory, missingDirectory);

const safe = assessMetroWatchInertness({ env: { CI: '0' }, directory: packageDirectory });
assertFrozen(safe);
assert.deepEqual(safe, []);

console.log('expo-metro-watch-advisory.test.mjs: Metro watch-inertness advisories pass');

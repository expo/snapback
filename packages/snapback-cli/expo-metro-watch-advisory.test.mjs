import assert from 'node:assert/strict';
import {
  mkdtempSync,
  realpathSync,
  rmSync,
} from 'node:fs';

import {
  assessMetroWatchInertness,
  expoMetroChildEnvironment,
  expoSupervisorChildEnvironment,
  resolveExpoMetroCommand,
} from './expo-dev.mjs';

const watchCapableDirectory = '/snapback/project';

function assertFrozen(advisories) {
  assert(Object.isFrozen(advisories));
  for (const advisory of advisories) {
    assert(Object.isFrozen(advisory));
    assert(Object.isFrozen(advisory.details));
  }
}

const parentEnvironment = {
  SNAPBACK_CLIENT_RQS_DIR: '/tmp/app-owned-rqs',
  SNAPBACK_RUNTIME_BINARY: '/tmp/snapback',
};
const childEnvironment = expoSupervisorChildEnvironment(parentEnvironment);
assert.equal(
  Object.hasOwn(childEnvironment, 'SNAPBACK_CLIENT_RQS_DIR'),
  false,
  'supervised children must not contend for the caller-owned RQS namespace',
);
assert.equal(childEnvironment.SNAPBACK_RUNTIME_BINARY, '/tmp/snapback');
assert.equal(
  parentEnvironment.SNAPBACK_CLIENT_RQS_DIR,
  '/tmp/app-owned-rqs',
  'child environment derivation must not mutate the supervisor environment',
);

const defaultMetroEnvironment = expoMetroChildEnvironment({
  env: childEnvironment,
  bootstrapOrigin: 'http://127.0.0.1:4288',
  port: 8081,
});
assert.equal(Object.hasOwn(defaultMetroEnvironment, 'CI'), false);
assert.equal(defaultMetroEnvironment.EXPO_NO_TELEMETRY, '1');
assert.equal(defaultMetroEnvironment.SNAPBACK_EXPO_METRO_PORT, '8081');
assert.equal(defaultMetroEnvironment.RCT_METRO_PORT, '8081');
assert.equal(
  defaultMetroEnvironment.EXPO_PUBLIC_SNAPBACK_SUPERVISOR_ORIGIN,
  'http://127.0.0.1:4288',
);
for (const ci of ['1', 'true', '0', 'false', '']) {
  assert.equal(
    expoMetroChildEnvironment({ env: { CI: ci }, bootstrapOrigin: 'x', port: 1 }).CI,
    ci,
    'the supervisor must preserve every explicit caller CI value',
  );
}

const webCommand = resolveExpoMetroCommand(null, 19006, 'web');
assert.deepEqual(
  webCommand.args,
  ['--no-install', 'expo', 'start', '--localhost', '--port', '19006', '--web'],
  'the first-class web selection launches Expo web through the supervised Metro arm',
);
assert.match(webCommand.display, /expo start .* --web$/u);
assert.equal(
  resolveExpoMetroCommand(null, 19006, 'ios').args.includes('--web'),
  false,
  'native defaults keep their existing Expo start command',
);

const defaulted = assessMetroWatchInertness({ env: {}, directory: watchCapableDirectory });
assertFrozen(defaulted);
assert.deepEqual(defaulted, []);

for (const ci of ['1', 'true']) {
  const advisories = assessMetroWatchInertness({ env: { CI: ci }, directory: watchCapableDirectory });
  assertFrozen(advisories);
  assert.equal(advisories.length, 1);
  assert.equal(advisories[0].condition, 'ci-environment');
  assert.equal(advisories[0].details.defaulted, false);
  assert.equal(advisories[0].details.ci, ci);
}

for (const ci of ['', '0', 'false']) {
  const advisories = assessMetroWatchInertness({ env: { CI: ci }, directory: watchCapableDirectory });
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

  const both = assessMetroWatchInertness({ env: { CI: '1' }, directory: scratchDirectory });
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

const safe = assessMetroWatchInertness({ env: { CI: '0' }, directory: watchCapableDirectory });
assertFrozen(safe);
assert.deepEqual(safe, []);

console.log('expo-metro-watch-advisory.test.mjs: Metro watch-inertness advisories pass');

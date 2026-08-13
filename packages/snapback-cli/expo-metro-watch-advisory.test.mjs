import assert from 'node:assert/strict';
import {
  mkdtempSync,
  realpathSync,
  rmSync,
} from 'node:fs';

import {
  assessMetroWatchInertness,
  cliMetroWatchInertAdvisory,
  emitCliMetroWatchInertAdvisory,
  expoMetroChildEnvironment,
  expoSupervisorChildEnvironment,
  resolveExpoMetroCommand,
} from './expo-dev.mjs';
import { runCli } from './index.mjs';

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

assert.equal(cliMetroWatchInertAdvisory({ env: {} }), null);
assert.equal(cliMetroWatchInertAdvisory({ env: { CI: '0' } }), null);
assert.equal(cliMetroWatchInertAdvisory({ env: { CI: 'false' } }), null);
assert.equal(cliMetroWatchInertAdvisory({ env: { CI: '' } }), null);

for (const ci of ['1', 'true']) {
  const assessed = assessMetroWatchInertness({ env: { CI: ci } });
  const cliAdvisory = cliMetroWatchInertAdvisory({
    env: { CI: ci },
    clientCommand: 'npx expo start',
  });
  assert.equal(cliAdvisory.code, assessed[0].code);
  assert.equal(cliAdvisory.code, 'SNAPBACK_EXPO_METRO_WATCH_INERT');
  assert.equal(cliAdvisory.condition, 'ci-environment');
  assert.equal(cliAdvisory.details.ci, ci);
  assert.equal(cliAdvisory.details.unsupervised, true);
  assert.equal(cliAdvisory.details.clientCommand, 'npx expo start');
  assert.match(cliAdvisory.message, /If you launch Metro\/Expo yourself/u);
  assert.match(cliAdvisory.message, /do not inherit CI=1/u);
  assert.match(cliAdvisory.message, /unset CI or pass CI=0/u);
  assert.match(cliAdvisory.message, /--client-command "npx expo start"/u);
  assert.match(cliAdvisory.remediation, /Prefer snapback dev --expo/u);
}

const withoutClient = cliMetroWatchInertAdvisory({ env: { CI: '1' } });
assert.equal(withoutClient.details.clientCommand, null);
assert.match(withoutClient.message, /If you launch Metro\/Expo yourself/u);
assert.doesNotMatch(withoutClient.message, /--client-command/u);

const written = [];
const emitted = emitCliMetroWatchInertAdvisory({
  env: { CI: '1' },
  clientCommand: 'npx expo start',
  write: (line) => written.push(line),
});
assert.equal(emitted.code, 'SNAPBACK_EXPO_METRO_WATCH_INERT');
assert.equal(written.length, 1);
assert.match(written[0], /SNAPBACK_EXPO_METRO_WATCH_INERT/u);
assert.match(written[0], /If you launch Metro\/Expo yourself/u);

const jsonWritten = [];
emitCliMetroWatchInertAdvisory({
  env: { CI: '1' },
  json: true,
  write: (line) => jsonWritten.push(line),
});
const jsonPayload = JSON.parse(jsonWritten[0]);
assert.equal(jsonPayload.ok, true);
assert.equal(jsonPayload.code, 'SNAPBACK_EXPO_METRO_WATCH_INERT');
assert.equal(jsonPayload.diagnostic.code, 'SNAPBACK_EXPO_METRO_WATCH_INERT');

assert.equal(emitCliMetroWatchInertAdvisory({ env: { CI: '0' }, write: () => {
  throw new Error('must not emit when CI is falsy');
} }), null);

async function captureDevAdvisory(argv, env) {
  const order = [];
  const lines = [];
  const originalError = console.error;
  console.error = (...args) => {
    const text = args.map(String).join(' ');
    lines.push(text);
    if (text.includes('SNAPBACK_EXPO_METRO_WATCH_INERT')) order.push('advisory');
  };
  let runDevCalled = false;
  let runExpoDevCalled = false;
  try {
    const code = await runCli(argv, {
      env,
      async runDev() {
        runDevCalled = true;
        order.push('runDev');
        return { ok: true, close: async () => {} };
      },
      async runExpoDev() {
        runExpoDevCalled = true;
        order.push('runExpoDev');
        return { ok: false, diagnostics: [] };
      },
    });
    return { code, order, lines, runDevCalled, runExpoDevCalled };
  } finally {
    console.error = originalError;
  }
}

{
  const captured = await captureDevAdvisory(
    ['dev', 'snapback', '--no-watch', '--client-command', 'npx expo start'],
    { CI: '1' },
  );
  assert.equal(captured.code, 0, 'the CI advisory must not refuse snapback dev');
  assert.equal(captured.runDevCalled, true);
  assert.deepEqual(captured.order, ['advisory', 'runDev']);
  assert.match(captured.lines.join('\n'), /SNAPBACK_EXPO_METRO_WATCH_INERT/u);
  assert.match(captured.lines.join('\n'), /If you launch Metro\/Expo yourself/u);
  assert.match(captured.lines.join('\n'), /--client-command "npx expo start"/u);
}

{
  const captured = await captureDevAdvisory(
    ['dev', 'snapback', '--no-watch', '--json', '--client-command', 'npx expo start'],
    { CI: '1' },
  );
  assert.equal(captured.code, 0);
  const payload = JSON.parse(captured.lines[0]);
  assert.equal(payload.code, 'SNAPBACK_EXPO_METRO_WATCH_INERT');
  assert.match(payload.diagnostic.message, /do not inherit CI=1/u);
}

{
  const captured = await captureDevAdvisory(
    ['dev', 'snapback', '--no-watch'],
    { CI: '1' },
  );
  assert.equal(captured.code, 0);
  assert.match(captured.lines.join('\n'), /SNAPBACK_EXPO_METRO_WATCH_INERT/u);
  assert.match(captured.lines.join('\n'), /If you launch Metro\/Expo yourself/u);
}

{
  const captured = await captureDevAdvisory(
    ['dev', 'snapback', '--no-watch', '--client-command', 'npx expo start'],
    { CI: '0' },
  );
  assert.equal(captured.code, 0);
  assert.equal(captured.runDevCalled, true);
  assert.equal(captured.lines.some((line) => line.includes('SNAPBACK_EXPO_METRO_WATCH_INERT')), false);
}

{
  const captured = await captureDevAdvisory(['dev', 'snapback', '--expo'], { CI: '1' });
  assert.equal(captured.runExpoDevCalled, true);
  assert.deepEqual(captured.order, ['advisory', 'runExpoDev']);
  assert.match(captured.lines.join('\n'), /SNAPBACK_EXPO_METRO_WATCH_INERT/u);
}

console.log('expo-metro-watch-advisory.test.mjs: Metro watch-inertness advisories pass');

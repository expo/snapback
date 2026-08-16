// 0137 a4-f2 regression: `snapback dev` must never exit 1 silently.
//
// 1. When the managed loop's first result is not ok (here: a generation
//    failure), the failed envelope reaches the terminal through the same
//    printResult path every other command uses — previously the dev branch
//    returned `result.ok ? 0 : 1` without printing anything.
// 2. `snapback dev --help` is routed through composed package help before the
//    dev command executes.

import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdtempSync, realpathSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { genericClientCommandAdvisory, scaffoldApp } from './index.mjs';

const packageDir = dirname(fileURLToPath(import.meta.url));
const cli = join(packageDir, 'cli.mjs');

for (const command of [
  'expo start --web',
  'npx --no-install expo start --web',
  'bunx expo start',
  'pnpm exec expo start --web',
]) {
  const advisory = genericClientCommandAdvisory(command);
  assert.equal(advisory?.code, 'SNAPBACK_DEV_EXPO_SUPERVISOR_BYPASSED');
  assert.equal(advisory?.details?.supervisedAlternative, 'snapback dev snapback --expo --expo-platform web');
  assert.match(advisory?.message ?? '', /no supervised Expo bootstrap origin was installed/u);
}
for (const command of ['vite', 'npm run web', 'echo expo start', 'next dev']) {
  assert.equal(genericClientCommandAdvisory(command), null, `${command} is not a high-confidence Expo start command`);
}

const root = realpathSync(mkdtempSync(join(tmpdir(), 'snapback-dev-diagnostics-')));
try {
  const project = join(root, 'broken-app');
  const scaffolded = scaffoldApp(project, { template: 'todo-contract' });
  assert.equal(scaffolded.ok ?? true, true, `scaffold failed: ${JSON.stringify(scaffolded)}`);

  // Break generation deterministically: a query against an undeclared table.
  writeFileSync(join(project, 'snapback', 'functions.mjs'), `
import { defineQuery } from '@expo/snapback-codegen/define';
export const listGhosts = defineQuery({ table: 'ghosts', args: {} });
`);

  const dev = spawnSync(process.execPath, [cli, 'dev', 'snapback'], {
    cwd: project,
    encoding: 'utf8',
    env: { ...process.env, SNAPBACK_CRON_DISABLED: '1' },
    timeout: 120_000,
  });
  assert.equal(dev.status, 1, `dev over a failing backend must exit 1, got ${dev.status}`);
  const surfaced = `${dev.stdout}\n${dev.stderr}`;
  assert.notEqual(
    surfaced.trim(),
    '',
    'dev must print the failed result envelope, not exit silently',
  );
  assert.match(
    surfaced,
    /FUNCTION_UNKNOWN_TABLE|"ok":\s*false/,
    `dev must surface the generation diagnostic, got: ${surfaced.slice(0, 2_000)}`,
  );

  const help = spawnSync(process.execPath, [cli, 'dev', '--help'], {
    cwd: project,
    encoding: 'utf8',
    env: { ...process.env },
    timeout: 60_000,
  });
  assert.equal(help.status, 0, 'dev --help must exit 0');
  const helpSurfaced = `${help.stdout}\n${help.stderr}`;
  assert.match(helpSurfaced, /Usage: snapback dev/, 'help must carry dev usage');
  assert.match(helpSurfaced, /Lifecycle: long-running/, 'help must declare lifecycle');
  assert.match(helpSurfaced, /--expo-platform ios\|android\|web/u, 'help must expose supervised Expo web');
  assert.match(helpSurfaced, /--native-checkout/u, 'help must expose the default-off native checkout opt-in');
  assert.match(helpSurfaced, /own bundle\/component and URL scheme/u, 'help must explain the development-client boundary');
  for (const platform of ['ios', 'android', 'web']) {
    assert.match(
      helpSurfaced,
      new RegExp(`snapback dev snapback --expo --expo-platform ${platform}`, 'u'),
      `help must show the complete supervised ${platform} command`,
    );
  }
  assert.match(helpSurfaced, /--client-command is a generic child/u, 'help must explain the generic-arm boundary');
  assert.doesNotMatch(helpSurfaced, /SNAPBACK_CLI_ARGUMENT_INVALID/);

  for (const [args, message] of [
    [['--expo-platform', 'android'], /require --expo/u],
    [['--ios-udid', 'ios-device-1'], /require --expo/u],
    [['--expo', '--no-watch'], /long-running supervisor/u],
    [['--expo', '--android-serial', 'emulator-1'], /requires --expo-platform android/u],
    [['--expo', '--expo-platform', 'android', '--ios-udid', 'ios-device-1'], /requires --expo-platform ios/u],
    [['--native-checkout'], /require --expo/u],
    [['--expo', '--native-checkout'], /requires --ios-bundle-identifier/u],
    [['--expo', '--expo-platform', 'android', '--native-checkout'], /requires --android-component/u],
    [['--expo', '--expo-platform', 'web', '--native-checkout'], /only for native Expo targets/u],
    [['--expo', '--ios-bundle-identifier', 'dev.snapback.witness'], /require --native-checkout/u],
    [['--expo', '--expo-app-scheme', 'snapback-witness'], /require --native-checkout/u],
    [[
      '--expo', '--native-checkout',
      '--ios-bundle-identifier', 'dev.snapback.witness',
    ], /requires --expo-app-scheme/u],
  ]) {
    const refused = spawnSync(process.execPath, [cli, 'dev', ...args], {
      cwd: project,
      encoding: 'utf8',
      env: { ...process.env },
      timeout: 60_000,
    });
    assert.equal(refused.status, 1);
    assert.match(`${refused.stdout}\n${refused.stderr}`, message);
  }

  console.log('dev-cli-diagnostics.test.mjs: all cases passed');
} finally {
  rmSync(root, { recursive: true, force: true });
}

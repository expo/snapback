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
import { mkdirSync, mkdtempSync, realpathSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { genericClientCommandAdvisory, runCli, scaffoldApp } from './index.mjs';

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

let envPinnedRunDevOptions = null;
assert.equal(await runCli([
  'dev', 'snapback', '--no-watch',
  '--external-client-origin', 'http://127.0.0.1:5173',
  '--write-env', 'config/dev.env',
], {
  env: { SNAPBACK_DEV_PORT: '48100' },
  async runDev(options) {
    envPinnedRunDevOptions = options;
    return { ok: true, close: async () => {} };
  },
}), 0);
assert.deepEqual(
  envPinnedRunDevOptions.portPlan.owners,
  [{ owner: 'backend', port: 48100, source: 'pinned', declaredBy: 'env' }],
);
assert.equal(envPinnedRunDevOptions.externalClientOrigin, 'http://127.0.0.1:5173');
assert.equal(envPinnedRunDevOptions.writeEnvFile, 'config/dev.env');

let unpinnedRunDevCalled = false;
await assert.rejects(
  runCli([
    'dev', 'snapback', '--no-watch',
    '--external-client-origin', 'http://127.0.0.1:5173',
  ], {
    env: {},
    async runDev() {
      unpinnedRunDevCalled = true;
      return { ok: true, close: async () => {} };
    },
  }),
  (error) => error?.code === 'SNAPBACK_CLI_ARGUMENT_INVALID'
    && /requires a backend pin/u.test(error.message),
);
assert.equal(unpinnedRunDevCalled, false);

const root = realpathSync(mkdtempSync(join(tmpdir(), 'snapback-dev-diagnostics-')));
try {
  const staleProject = join(root, 'stale-ready-app');
  const staleScaffold = scaffoldApp(staleProject, { template: 'todo-contract' });
  assert.equal(staleScaffold.ok ?? true, true, `scaffold failed: ${JSON.stringify(staleScaffold)}`);
  const staleStateRoot = join(staleProject, '.snapback');
  const staleReadyFile = join(staleStateRoot, 'dev.ready.json');
  const staleDatabase = join(staleStateRoot, 'dev.sqlite3');
  const stalePid = 2_147_483_647;
  const staleOrigin = 'http://127.0.0.1:9';
  mkdirSync(staleStateRoot, { recursive: true });
  writeFileSync(staleReadyFile, `${JSON.stringify({
    schemaVersion: 'snapback.v0',
    descriptorKind: 'snapbackHostReady',
    ready: true,
    pid: stalePid,
    serverUrl: staleOrigin,
    database: { mode: 'file', path: staleDatabase },
  })}\n`, { mode: 0o600 });

  const stalePlain = spawnSync(process.execPath, [
    cli,
    'dev', 'snapback',
    '--attach',
    '--no-watch',
    '--ready-file', staleReadyFile,
    '--db', staleDatabase,
    '--json',
  ], {
    cwd: staleProject,
    encoding: 'utf8',
    env: { ...process.env },
    timeout: 120_000,
  });
  assert.equal(stalePlain.status, 1, `${stalePlain.stdout}\n${stalePlain.stderr}`);
  const stalePlainOutput = `${stalePlain.stdout}\n${stalePlain.stderr}`;
  assert.doesNotMatch(stalePlainOutput, /SNAPBACK_CLIENT_REFUSED|fetch failed/u);
  const stalePlainEnvelope = stalePlainOutput.split('\n').flatMap((line) => {
    try { return [JSON.parse(line)]; } catch { return []; }
  }).find((value) => value?.diagnostics?.[0]?.code === 'SNAPBACK_DEV_READY_FILE_STALE');
  assert.ok(stalePlainEnvelope, `plain dev did not surface the stale-owner diagnostic: ${stalePlainOutput}`);
  assert.deepEqual(stalePlainEnvelope.diagnostics[0].details, {
    descriptorFile: staleReadyFile,
    pid: stalePid,
    origin: staleOrigin,
    recovery: {
      standalone: `remove ${staleReadyFile} and rerun snapback dev`,
      supervised: 'rerun snapback dev --attach --ready-file <path> against a descriptor published by a live development loop',
    },
  });

  const staleExpo = spawnSync(process.execPath, [
    cli,
    'dev', 'snapback',
    '--attach',
    '--expo',
    '--expo-platform', 'web',
    '--ready-file', staleReadyFile,
    '--db', staleDatabase,
    '--json',
  ], {
    cwd: staleProject,
    encoding: 'utf8',
    env: { ...process.env },
    timeout: 120_000,
  });
  assert.equal(staleExpo.status, 1, `${staleExpo.stdout}\n${staleExpo.stderr}`);
  const staleExpoOutput = `${staleExpo.stdout}\n${staleExpo.stderr}`;
  assert.doesNotMatch(staleExpoOutput, /SNAPBACK_CLIENT_REFUSED|fetch failed/u);
  const staleExpoEvents = staleExpo.stdout.split('\n').flatMap((line) => {
    try { return [JSON.parse(line)]; } catch { return []; }
  });
  assert.equal(
    staleExpoEvents.some((event) => event.state === 'device-selected'),
    true,
    'Expo regression must reach the same post-device-selection attach path',
  );
  const staleExpoFailure = staleExpoEvents.find((event) => event.state === 'startup-failed');
  assert.equal(staleExpoFailure?.diagnostics?.[0]?.code, 'SNAPBACK_DEV_READY_FILE_STALE');
  assert.deepEqual(staleExpoFailure?.diagnostics?.[0]?.details, stalePlainEnvelope.diagnostics[0].details);

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
  for (const flag of ['--client-port', '--bootstrap-port', '--port-range']) {
    assert.match(helpSurfaced, new RegExp(flag, 'u'), `help must expose ${flag}`);
  }
  assert.match(
    helpSurfaced,
    /EOF closes only the optional stdin command channel/u,
    'help recovery must agree that stdin EOF leaves the dev-loop owner live',
  );
  assert.doesNotMatch(
    helpSurfaced,
    /EOF or SIGINT\/SIGTERM ends this dev-loop attachment/u,
    'help must not retain the pre-repair EOF shutdown claim',
  );
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
    [['--client-port', '48110'], /profile has owners: backend/u],
    [['--bootstrap-port', '48120'], /profile has owners: backend/u],
    [[
      '--expo', '--port', '48100', '--client-port', '48100',
    ], /backend and client cannot pin the same port 48100/u],
    [['--port-range', '48100:48199'], /form <lo>-<hi>/u],
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

  const envForAbsentOwner = spawnSync(process.execPath, [cli, 'dev'], {
    cwd: project,
    encoding: 'utf8',
    env: {
      ...process.env,
      SNAPBACK_DEV_CLIENT_PORT: '48110',
    },
    timeout: 60_000,
  });
  assert.equal(envForAbsentOwner.status, 1);
  assert.match(
    `${envForAbsentOwner.stdout}\n${envForAbsentOwner.stderr}`,
    /profile has owners: backend/u,
  );

  console.log('dev-cli-diagnostics.test.mjs: stale ready-owner, CLI refusal/help, and environment-pin cases passed');
} finally {
  rmSync(root, { recursive: true, force: true });
}

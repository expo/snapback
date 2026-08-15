import assert from 'node:assert/strict';
import { spawn, spawnSync } from 'node:child_process';
import {
  cpSync,
  existsSync,
  mkdirSync,
  mkdtempSync,
  readdirSync,
  readFileSync,
  realpathSync,
  rmSync,
  statSync,
  writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { pathToFileURL, fileURLToPath } from 'node:url';

import {
  createSnapbackExpoBoot,
  createSupervisedExpoEnvironment,
} from '../snapback-expo/index.mjs';
import {
  observeSnapbackPresence,
  observeSnapbackQueries,
  observeSnapbackSurface,
  invokeSnapbackMutation,
} from '@expo/snapback-react';

import {
  SUPERVISED_EXCHANGE_PATH,
  createExpoRoutingPlan,
  installAndroidPortForwarding,
  runExpoDev,
} from './expo-dev.mjs';

const packageRoot = dirname(fileURLToPath(import.meta.url));
const repoRoot = resolve(packageRoot, '..', '..');
const runtimeBinary = process.env.SNAPBACK_RUNTIME_BINARY
  ?? '/Users/ccheever/projects/snapback-g0-land/target/debug/snapback';
assert.ok(existsSync(runtimeBinary), `real Snapback runtime is missing: ${runtimeBinary}`);

const sourceFixture = join(packageRoot, 'fixtures', 'comparator', 'app', 'snapback');
const scratchRoot = realpathSync(mkdtempSync(join(tmpdir(), 'snapback-expo-dev-loop-')));
const metroScript = join(scratchRoot, 'headless-metro.mjs');
const supervisors = [];

writeFileSync(metroScript, `
import { writeFileSync } from 'node:fs';
import { createServer } from 'node:http';
import { getDefaultResultOrder } from 'node:dns';

const port = Number(process.env.SNAPBACK_EXPO_METRO_PORT);
const origin = process.env.EXPO_PUBLIC_SNAPBACK_SUPERVISOR_ORIGIN;
writeFileSync(process.env.SNAPBACK_EXPO_TEST_ENV, JSON.stringify({
  nodeOptions: process.env.NODE_OPTIONS,
  defaultResultOrder: getDefaultResultOrder(),
}));
writeFileSync(process.env.SNAPBACK_EXPO_TEST_BUNDLE, [
  '// headless Metro bundle fixture',
  'export const supervisedOrigin = ' + JSON.stringify(origin) + ';',
].join('\\n') + '\\n');
writeFileSync(process.env.SNAPBACK_EXPO_TEST_SOURCE_MAP, JSON.stringify({
  version: 3,
  sources: ['App.tsx'],
  sourcesContent: ['export const supervisedOrigin = ' + JSON.stringify(origin)],
  names: [],
  mappings: '',
}));
const server = createServer((request, response) => {
  response.setHeader('content-type', 'application/json');
  response.end(JSON.stringify({ ok: true, hmr: request.url === '/hmr' }));
});
server.listen(port, '127.0.0.1', () => {
  console.log(JSON.stringify({ event: 'metro-ready', host: '127.0.0.1', port }));
});
const stop = () => server.close(() => process.exit(0));
process.once('SIGTERM', stop);
process.once('SIGINT', stop);
`);

function appStateHarness() {
  const listeners = new Set();
  return {
    currentState: 'active',
    addEventListener(event, listener) {
      assert.equal(event, 'change');
      listeners.add(listener);
      return { remove: () => listeners.delete(listener) };
    },
    emit(state) {
      this.currentState = state;
      for (const listener of [...listeners]) listener(state);
    },
    count: () => listeners.size,
  };
}

async function eventually(check, { timeoutMs = 30_000, label = 'condition' } = {}) {
  const deadline = Date.now() + timeoutMs;
  let lastError = null;
  while (Date.now() < deadline) {
    try {
      const value = await check();
      if (value) return value;
    } catch (error) {
      lastError = error;
    }
    await new Promise((resolveWait) => setTimeout(resolveWait, 50));
  }
  throw new Error(`timed out waiting for ${label}${lastError ? `: ${lastError.message}` : ''}`);
}

function snapshotEnvFiles(directory) {
  const files = {};
  const visit = (current, prefix = '') => {
    const entries = readdirSync(current, { withFileTypes: true })
      .sort((left, right) => left.name.localeCompare(right.name));
    for (const entry of entries) {
      if (entry.name === 'node_modules' || entry.name === '.git') continue;
      const path = join(current, entry.name);
      const relativePath = join(prefix, entry.name);
      if (entry.isDirectory()) {
        visit(path, relativePath);
      } else if (/^\.env/u.test(entry.name)) {
        files[relativePath] = readFileSync(path).toString('base64');
      }
    }
  };
  visit(directory);
  return files;
}

function fixture(name, { sessions }) {
  const projectRoot = join(scratchRoot, name);
  const backendRoot = join(projectRoot, 'snapback');
  const expoRoot = join(projectRoot, 'app');
  cpSync(sourceFixture, backendRoot, { recursive: true });
  rmSync(join(backendRoot, 'generated'), { recursive: true, force: true });
  mkdirSync(expoRoot, { recursive: true });
  if (sessions) {
    const schemaPath = join(backendRoot, 'schema.mjs');
    const source = readFileSync(schemaPath, 'utf8');
    const updated = source.replace(
      '  {\n    ephemeral: defineEphemeral({',
      "  {\n    auth: { mode: 'sessions' },\n    ephemeral: defineEphemeral({",
    );
    assert.notEqual(updated, source, 'sessions fixture must alter the schema auth mode');
    writeFileSync(schemaPath, updated);
  }
  const publicConfig = {
    appJson: join(expoRoot, 'app.json'),
    easJson: join(expoRoot, 'eas.json'),
    committedEnv: join(expoRoot, '.env'),
  };
  writeFileSync(publicConfig.appJson, `${JSON.stringify({ expo: { plugins: ['@expo/snapback-expo'] } }, null, 2)}\n`);
  writeFileSync(publicConfig.easJson, `${JSON.stringify({ build: { development: {} } }, null, 2)}\n`);
  writeFileSync(publicConfig.committedEnv, 'EXPO_PUBLIC_FIXTURE_LABEL=headless-e1\n');
  const stateRoot = join(projectRoot, '.snapback');
  const bundle = join(expoRoot, 'bundle.js');
  const sourceMap = join(expoRoot, 'bundle.js.map');
  const metroEnv = join(stateRoot, 'metro-env.json');
  return {
    projectRoot,
    backendRoot,
    expoRoot,
    stateRoot,
    readyFile: join(stateRoot, 'dev.ready.json'),
    database: join(stateRoot, 'dev.sqlite3'),
    bundle,
    sourceMap,
    metroEnv,
    publicConfig,
  };
}

async function startFixture(target, options = {}) {
  const events = [];
  const environmentBefore = snapshotEnvFiles(target.expoRoot);
  const supervisor = await runExpoDev({
    backendDirectory: target.backendRoot,
    projectRoot: target.projectRoot,
    expoDirectory: target.expoRoot,
    readyFile: target.readyFile,
    database: target.database,
    runtimeBinary,
    platform: options.platform ?? 'ios',
    email: options.email ?? 'first@expo-e1.test',
    metroCommand: { command: process.execPath, args: [metroScript] },
    env: {
      ...process.env,
      CI: '1',
      SNAPBACK_RUNTIME_BINARY: runtimeBinary,
      SNAPBACK_EXPO_TEST_BUNDLE: target.bundle,
      SNAPBACK_EXPO_TEST_SOURCE_MAP: target.sourceMap,
      SNAPBACK_EXPO_TEST_ENV: target.metroEnv,
      NODE_OPTIONS: '--trace-warnings',
    },
    serverStdio: ['ignore', 'ignore', 'ignore'],
    onEvent(event) { events.push(event); },
  });
  supervisors.push(supervisor);
  assert.deepEqual(
    snapshotEnvFiles(target.expoRoot),
    environmentBefore,
    'supervised startup must not create or mutate any .env* file',
  );
  return { supervisor, events };
}

function assertListenerInventory(supervisor) {
  assert.deepEqual(
    [...new Set(supervisor.listeners.map(({ owner }) => owner))].sort(),
    ['backend', 'bootstrap', 'metro'],
    'the supervisor must enumerate backend, bootstrap, and Metro listeners',
  );
  assert(supervisor.listeners.every(({ loopback }) => loopback === true));
  assert(supervisor.listeners.every(({ host }) => host === '127.0.0.1' || host === '::1'));
}

async function assertOriginClosed(origin, label) {
  await eventually(async () => {
    try {
      await fetch(origin);
      return false;
    } catch {
      return true;
    }
  }, { label: `${label} listener cleanup` });
}

async function runCliSupervisor(target, platform = 'ios') {
  const cli = join(packageRoot, 'cli.mjs');
  const events = [];
  let stdoutBuffer = '';
  let stderr = '';
  const child = spawn(process.execPath, [
    cli,
    'dev',
    target.backendRoot,
    '--expo',
    '--expo-platform', platform,
    '--expo-dir', target.expoRoot,
    '--ready-file', target.readyFile,
    '--db', target.database,
    '--email', 'cli@expo-e1.test',
    '--expo-command', `${JSON.stringify(process.execPath)} ${JSON.stringify(metroScript)}`,
  ], {
    cwd: target.projectRoot,
    env: {
      ...process.env,
      SNAPBACK_RUNTIME_BINARY: runtimeBinary,
      SNAPBACK_EXPO_TEST_BUNDLE: target.bundle,
      SNAPBACK_EXPO_TEST_SOURCE_MAP: target.sourceMap,
      SNAPBACK_EXPO_TEST_ENV: target.metroEnv,
    },
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  child.stdout.setEncoding('utf8');
  child.stderr.setEncoding('utf8');
  child.stderr.on('data', (chunk) => { stderr += chunk; });
  child.stdout.on('data', (chunk) => {
    stdoutBuffer += chunk;
    let newline;
    while ((newline = stdoutBuffer.indexOf('\n')) !== -1) {
      const line = stdoutBuffer.slice(0, newline);
      stdoutBuffer = stdoutBuffer.slice(newline + 1);
      if (!line) continue;
      try { events.push(JSON.parse(line)); } catch { /* eventually reports raw output */ }
    }
  });
  await eventually(
    () => events.find((event) => event.schemaVersion === 'snapback.expo-dev.v1'
      && event.state === 'ready'),
    { label: 'snapback dev --expo CLI readiness' },
  );
  const readyEvent = events.find((event) => event.state === 'ready');
  assert.equal(readyEvent.connectCarrier, 'supervisor-rendezvous');
  const listenerEvent = events.find((event) => event.state === 'listeners-verified');
  const exchange = await (
    await fetch(`${readyEvent.bootstrap.origin}${SUPERVISED_EXCHANGE_PATH}`)
  ).json();
  child.kill('SIGTERM');
  const exit = await Promise.race([
    new Promise((resolveExit) => child.once('exit', (code, signal) => resolveExit({ code, signal }))),
    new Promise((_, rejectExit) => setTimeout(
      () => rejectExit(new Error('snapback dev --expo CLI did not join shutdown')),
      15_000,
    )),
  ]);
  assert.deepEqual(exit, { code: 0, signal: null }, stderr || stdoutBuffer);
  assert(events.some((event) => event.schemaVersion === 'snapback.expo-dev.v1'
    && event.state === 'control-event'));
  assert(events.some((event) => event.schemaVersion === 'snapback.expo-dev.v1'
    && event.state === 'closed'));
  return { events, readyEvent, listenerEvent, bearer: exchange.authority.token };
}

function assertGrepAbsent(label, files, bearers) {
  for (const bearer of bearers) {
    const result = spawnSync('/usr/bin/grep', ['-F', '--', bearer, ...files], {
      encoding: 'utf8',
    });
    assert.equal(
      result.status,
      1,
      `${label} leaked an issued bearer: ${result.stdout}${result.stderr}`,
    );
  }
}

try {
  const web = createExpoRoutingPlan({
    platform: 'web',
    backendPort: 4001,
    metroPort: 4002,
    bootstrapPort: 4003,
  });
  assert.equal(web.transport, 'same-host-loopback');
  assert.equal(web.appHost, '127.0.0.1');
  assert.deepEqual(web.device, { serial: null, class: 'browser' });
  assert.deepEqual(web.forwards, []);

  // Android headless mechanics: all three ports are installed, verified, and
  // removed with exact adb reverse rules. The 10.0.2.2 posture is explicit but
  // is not selected by the preferred route and creates no listener.
  const android = createExpoRoutingPlan({
    platform: 'android',
    backendPort: 4101,
    metroPort: 4102,
    bootstrapPort: 4103,
    androidSerial: 'emulator-e1',
  });
  assert.equal(android.transport, 'adb-reverse');
  assert.equal(android.appHost, '127.0.0.1');
  assert.deepEqual(android.forwards.map(({ device, host }) => [device, host]), [
    ['tcp:4101', 'tcp:4101'],
    ['tcp:4102', 'tcp:4102'],
    ['tcp:4103', 'tcp:4103'],
  ]);
  assert.deepEqual(android.fallback, { host: '10.0.2.2', requiresAdbReverse: false });
  const adbCalls = [];
  const installedRules = new Set();
  const adbRun = (_binary, args) => {
    adbCalls.push(args);
    const command = args.slice(2);
    if (command[0] === 'reverse' && command[1] === '--list') {
      return {
        status: 0,
        stdout: [...installedRules].map((rule) => `emulator-e1 ${rule} ${rule}`).join('\n'),
        stderr: '',
      };
    }
    if (command[0] === 'reverse' && command[1] === '--remove') {
      installedRules.delete(command[2]);
      return { status: 0, stdout: '', stderr: '' };
    }
    if (command[0] === 'reverse') {
      installedRules.add(command[1]);
      return { status: 0, stdout: '', stderr: '' };
    }
    return { status: 1, stdout: '', stderr: 'unexpected adb call' };
  };
  const forwarding = installAndroidPortForwarding(android, { adbRun, run: adbRun });
  assert.equal(forwarding.installed.length, 3);
  forwarding.remove();
  assert.equal(installedRules.size, 0);
  assert.equal(adbCalls.filter((args) => args.includes('--remove')).length, 3);
  const alias = createExpoRoutingPlan({
    platform: 'android',
    backendPort: 4201,
    metroPort: 4202,
    bootstrapPort: 4203,
    androidTransport: 'emulator-host-alias',
  });
  assert.equal(alias.appHost, '10.0.2.2');
  assert.deepEqual(alias.forwards, []);

  // A target not settled in Sessions mode still completes binding delivery,
  // but the real native mint refusal becomes authority-required in the app.
  const unsettled = fixture('unsettled', { sessions: false });
  const unsettledRun = await startFixture(unsettled);
  assert.deepEqual(JSON.parse(readFileSync(unsettled.metroEnv, 'utf8')), {
    nodeOptions: '--trace-warnings --dns-result-order=ipv4first',
    defaultResultOrder: 'ipv4first',
  });
  assert.equal(unsettledRun.supervisor.state, 'authority-required');
  assertListenerInventory(unsettledRun.supervisor);
  const unsettledExchange = await (
    await fetch(`${unsettledRun.supervisor.exchangeOrigin}${SUPERVISED_EXCHANGE_PATH}`)
  ).json();
  assert.equal(unsettledExchange.authority.status, 'authority-required');
  assert.equal(unsettledExchange.authority.diagnostic.code, 'SNAPBACK_AUTH_POLICY_UNAVAILABLE');
  assert.equal(Object.hasOwn(unsettledExchange.authority, 'token'), false);
  const unsettledApp = JSON.parse(readFileSync(
    join(unsettled.backendRoot, 'generated', 'app.descriptor.json'),
    'utf8',
  ));
  const unsettledBoot = createSnapbackExpoBoot({
    app: unsettledApp,
    environment: createSupervisedExpoEnvironment({
      exchangeOrigin: unsettledRun.supervisor.exchangeOrigin,
      appState: appStateHarness(),
    }),
  });
  const authorityRequired = await unsettledBoot.start();
  assert.equal(authorityRequired.status, 'authority-required');
  assert.equal(authorityRequired.diagnostic.code, 'SNAPBACK_AUTH_POLICY_UNAVAILABLE');
  assert.equal(authorityRequired.diagnostic.details.cause, 'sessions-auth-mode-unavailable');
  await unsettledBoot.dispose();
  const unsettledOrigins = {
    backend: unsettledRun.supervisor.binding.target.origin,
    metro: unsettledRun.supervisor.metroOrigin,
    bootstrap: unsettledRun.supervisor.exchangeOrigin,
  };
  await unsettledRun.supervisor.close();
  supervisors.splice(supervisors.indexOf(unsettledRun.supervisor), 1);
  await Promise.all(Object.entries(unsettledOrigins).map(([label, origin]) => (
    assertOriginClosed(origin, `unsettled ${label}`)
  )));
  await eventually(() => !existsSync(unsettled.readyFile), { label: 'unsettled ready-file cleanup' });

  // Settled Sessions mode: real mint, provider boot, canonical live/mutation/
  // presence owners, HMR-shaped reattachment, reconnect, and authority barrier.
  const settled = fixture('settled', { sessions: true });
  const settledRun = await startFixture(settled, { platform: 'web' });
  const { supervisor, events } = settledRun;
  assert.equal(supervisor.state, 'ready');
  assert.equal(supervisor.connectCarrier, 'supervisor-rendezvous');
  assert.deepEqual(supervisor.device, { serial: null, class: 'browser' });
  const settledReadyEvent = events.find((event) => event.state === 'ready');
  assert.equal(settledReadyEvent?.connectCarrier, 'supervisor-rendezvous');
  assert.equal(settledReadyEvent?.platform, 'web');
  const supervisorDescriptor = join(dirname(settled.readyFile), 'expo-supervisor.json');
  assert.equal(existsSync(supervisorDescriptor), true);
  assert.equal(statSync(supervisorDescriptor).mode & 0o777, 0o600);
  assertListenerInventory(supervisor);
  assert.equal(supervisor.binding.source, 'supervised-dev');
  assert.equal(supervisor.binding.integrity.channel, 'local-supervised-ipc');
  assert(Date.parse(supervisor.binding.provenance.expiresAt) > Date.now());
  const firstExchange = await (
    await fetch(`${supervisor.exchangeOrigin}${SUPERVISED_EXCHANGE_PATH}`)
  ).json();
  const firstBearer = firstExchange.authority.token;
  assert.match(firstBearer, /^sbs_/u);
  assert.equal(JSON.stringify(firstExchange.binding).includes(firstBearer), false);

  const app = JSON.parse(readFileSync(
    join(settled.backendRoot, 'generated', 'app.descriptor.json'),
    'utf8',
  ));
  const generated = await import(
    `${pathToFileURL(join(settled.backendRoot, 'generated', 'api.mjs')).href}?e1=${Date.now()}`
  );
  const api = generated.default;
  const appState = appStateHarness();
  const environment = createSupervisedExpoEnvironment({
    exchangeOrigin: supervisor.exchangeOrigin,
    appState,
    clientOptions: {
      rqsStore: null,
      offlineQueue: false,
      clientStoreId: 'expo-e1-provider',
    },
  });
  const bootStates = [];
  const boot = createSnapbackExpoBoot({ app, environment });
  const offBoot = boot.subscribe(() => bootStates.push(boot.getSnapshot()));
  const ready = await boot.start();
  assert.equal(ready.status, 'ready');
  assert.equal(ready.binding.target.origin, supervisor.binding.target.origin);
  assert.equal(ready.authority.authMode, 'sessions');
  assert.equal(appState.count(), 1);
  const firstUserId = ready.authority.userId;
  const provider = boot.reactProvider();
  assert(provider, 'ready Expo boot must project the canonical React provider');

  const queryStates = [];
  const queryEntries = { rows: { ref: api.liveRows, args: {} } };
  const query = observeSnapbackQueries(provider, queryEntries, (state) => {
    queryStates.push(state);
  });
  await eventually(
    () => query.snapshot().queries.rows.status === 'ready',
    { label: 'provider live query ready' },
  );
  const surfaceStates = [];
  const surface = observeSnapbackSurface(
    provider,
    generated.app.surfaces.fixtureSurface,
    { roomId: 'expo-e1-room' },
    {},
    (state) => { surfaceStates.push(state); },
  );
  await eventually(
    () => surface.snapshot().state.rows.status === 'ready',
    { label: 'surface live query ready' },
  );
  assert.strictEqual(
    surface.snapshot().state.rows,
    query.snapshot().queries.rows,
    'real low-level and surface reads must share the canonical store snapshot',
  );
  assert.equal(provider.inspection().stores, 1);
  assert.equal(provider.inspection().serverSubscriptions, 1);
  // @ref LLP 0223#design-detail — ticket 1's live connect proof is this
  // app-level mutation followed by its observed canonical live-query update.
  const firstBody = `expo-e1-first-${process.pid}`;
  await surface.mutations.publish({ body: firstBody });
  await eventually(
    () => query.snapshot().queries.rows.status === 'ready'
      && query.snapshot().queries.rows.data.some((row) => row.body === firstBody),
    { label: 'ordinary mutation observed by live query' },
  );

  const presenceStates = [];
  const presenceOptions = {
    scope: { roomId: 'expo-e1-room' },
    value: { state: 'present' },
    ttlMs: 5_000,
  };
  const presence = observeSnapbackPresence(
    provider,
    api.ephemeral.fixturePresence,
    presenceOptions,
    (state) => { presenceStates.push(state); },
  );
  await eventually(
    () => presence.snapshot().status === 'ready'
      && presence.snapshot().publisher.status === 'published',
    { label: 'scoped presence publish' },
  );
  const siblingPresence = observeSnapbackPresence(
    provider,
    api.ephemeral.fixturePresence,
    presenceOptions,
    () => {},
  );
  await eventually(
    () => provider.inspection().presenceConsumers === 3,
    { label: 'equivalent presence consumer share' },
  );
  assert.equal(provider.inspection().presenceStores, 1);
  assert.equal(provider.inspection().presenceSubscriptions, 1);
  await siblingPresence.dispose();

  // HMR-shaped observer updates stay on one store/room, and AppState reconnect
  // releases then restores the same provider-owned resources.
  assert.equal((await fetch(`${supervisor.metroOrigin}/hmr`)).ok, true);
  query.update(queryEntries);
  presence.update(presenceOptions);
  assert.equal(provider.inspection().stores, 1);
  assert.equal(provider.inspection().serverSubscriptions, 1);
  assert.equal(provider.inspection().presenceStores, 1);
  assert.equal(provider.inspection().presenceSubscriptions, 1);
  appState.emit('background');
  await eventually(
    () => provider.inspection().hostPaused === true
      && provider.inspection().serverSubscriptions === 0
      && provider.inspection().presenceSubscriptions === 0,
    { label: 'provider reconnect quiesce' },
  );
  appState.emit('active');
  await eventually(
    () => provider.inspection().hostPaused === false
      && query.snapshot().queries.rows.status === 'ready'
      && provider.inspection().serverSubscriptions === 1
      && provider.inspection().presenceSubscriptions === 1,
    { label: 'provider reconnect resume' },
  );

  const replacementBootStart = bootStates.length;
  assert.equal(await supervisor.replaceAuthority('second@expo-e1.test'), 'ready');
  const secondExchange = await (
    await fetch(`${supervisor.exchangeOrigin}${SUPERVISED_EXCHANGE_PATH}`)
  ).json();
  const secondBearer = secondExchange.authority.token;
  assert.match(secondBearer, /^sbs_/u);
  assert.notEqual(secondBearer, firstBearer);
  const replaced = await boot.refreshAuthority();
  assert.equal(replaced.status, 'ready');
  assert.notEqual(replaced.authority.userId, firstUserId);
  assert(
    bootStates.slice(replacementBootStart).some(
      (state) => state.status === 'starting' && state.stage === 'authority',
    ),
    'authority replacement must cross the provider authority stage',
  );
  await eventually(
    () => query.snapshot().queries.rows.status === 'ready'
      && presence.snapshot().status === 'ready'
      && presence.snapshot().publisher.status === 'published',
    { label: 'successor authority query/presence re-entry' },
  );
  assert.equal(provider.inspection().serverSubscriptions, 1);
  assert.equal(provider.inspection().presenceSubscriptions, 1);
  const secondBody = `expo-e1-second-${process.pid}`;
  await surface.mutations.publish({ body: secondBody });
  await eventually(
    () => query.snapshot().queries.rows.data.some((row) => row.body === secondBody),
    { label: 'successor ordinary mutation observation' },
  );

  // A source edit rotates the generated descriptor while this supervisor and
  // backend process stay alive. The bootstrap exchange must immediately carry
  // the reminted binding, and that exact successor digest must be callable.
  const functionsPath = join(settled.backendRoot, 'functions.mjs');
  const predecessorFunctions = readFileSync(functionsPath, 'utf8');
  const predecessorDescriptorIdentity = supervisor.binding.descriptorIdentity;
  const predecessorBackendPid = JSON.parse(readFileSync(settled.readyFile, 'utf8')).pid;
  const rotationEventStart = events.length;
  const successorFunctions = predecessorFunctions
    .replace(
      'export const publishLiveRow = defineJsMutation({',
      'export const publishLiveRowAfterReload = defineJsMutation({',
    )
    .replace(
      'mutations: { publish: bind(publishLiveRow,',
      'mutations: { publish: bind(publishLiveRowAfterReload,',
    );
  assert.notEqual(successorFunctions, predecessorFunctions);
  writeFileSync(functionsPath, successorFunctions);
  const rotated = await eventually(
    () => {
      const successorEvents = events.slice(rotationEventStart);
      const event = successorEvents.find((candidate) => candidate.state === 'binding-rotated');
      if (event) return event;
      const failed = successorEvents.find((candidate) => (
        candidate.state === 'backend-event'
        && ['generation-failed', 'generated-but-not-loaded'].includes(candidate.backend?.state)
      ));
      if (failed) throw new Error(JSON.stringify(failed));
      return false;
    },
    { timeoutMs: 60_000, label: 'supervised binding rotation after functions edit' },
  );
  assert.match(rotated.changed, /functions\.mjs$/u);
  assert.equal(rotated.previousDescriptorIdentity, predecessorDescriptorIdentity);
  assert.notEqual(rotated.descriptorIdentity, predecessorDescriptorIdentity);
  assert.equal(JSON.parse(readFileSync(settled.readyFile, 'utf8')).pid, predecessorBackendPid);
  const successorExchange = await (
    await fetch(`${supervisor.exchangeOrigin}${SUPERVISED_EXCHANGE_PATH}`)
  ).json();
  assert.equal(successorExchange.binding.descriptorIdentity, rotated.descriptorIdentity);
  assert.equal(successorExchange.binding.provenance.supervisorGeneration, supervisor.supervisorGeneration);
  const successorApp = JSON.parse(readFileSync(
    join(settled.backendRoot, 'generated', 'app.descriptor.json'),
    'utf8',
  ));
  const successorGenerated = await import(
    `${pathToFileURL(join(settled.backendRoot, 'generated', 'api.mjs')).href}?hot=${Date.now()}`
  );
  const successorState = appStateHarness();
  const successorBoot = createSnapbackExpoBoot({
    app: successorApp,
    environment: createSupervisedExpoEnvironment({
      exchangeOrigin: supervisor.exchangeOrigin,
      appState: successorState,
      clientOptions: {
        rqsStore: null,
        offlineQueue: false,
        clientStoreId: 'expo-e1-hot-successor',
      },
    }),
  });
  const successorReady = await successorBoot.start();
  assert.equal(successorReady.status, 'ready');
  assert.equal(successorReady.binding.descriptorIdentity, rotated.descriptorIdentity);
  const successorProvider = successorBoot.reactProvider();
  const successorQuery = observeSnapbackQueries(
    successorProvider,
    { rows: { ref: successorGenerated.default.liveRows, args: {} } },
    () => {},
  );
  await eventually(
    () => successorQuery.snapshot().queries.rows.status === 'ready',
    { label: 'successor descriptor live query ready' },
  );
  const hotBody = `expo-e1-hot-${process.pid}`;
  await invokeSnapbackMutation(
    successorProvider,
    successorGenerated.default.publishLiveRowAfterReload,
    { body: hotBody },
  );
  await eventually(
    () => successorQuery.snapshot().queries.rows.data.some((row) => row.body === hotBody),
    { label: 'new descriptor digest callable without supervisor restart' },
  );
  successorQuery.dispose();
  await successorBoot.dispose();
  assert.equal(successorState.count(), 0);

  assert(queryStates.length > 0, 'live-query projections must reach the fixture');
  assert(surfaceStates.length > 0, 'surface projections must reach the fixture');
  assert(presenceStates.length > 0, 'presence projections must reach the fixture');

  await surface.dispose();
  assert.equal(provider.inspection().stores, 1, 'surface cleanup retains its low-level sibling');
  assert.equal(provider.inspection().presenceStores, 1, 'surface cleanup retains its low-level room sibling');
  query.dispose();
  await presence.dispose();
  offBoot();
  await boot.dispose();
  assert.equal(appState.count(), 0);
  assert.deepEqual(
    {
      stores: provider.inspection().stores,
      consumers: provider.inspection().consumers,
      subscriptions: provider.inspection().serverSubscriptions,
      presenceStores: provider.inspection().presenceStores,
      presenceConsumers: provider.inspection().presenceConsumers,
      presenceSubscriptions: provider.inspection().presenceSubscriptions,
      publishers: provider.inspection().publishers,
      timers: provider.inspection().timers,
      listeners: provider.inspection().listeners,
    },
    {
      stores: 0,
      consumers: 0,
      subscriptions: 0,
      presenceStores: 0,
      presenceConsumers: 0,
      presenceSubscriptions: 0,
      publishers: 0,
      timers: 0,
      listeners: 0,
    },
  );

  const settledOrigins = {
    backend: supervisor.binding.target.origin,
    metro: supervisor.metroOrigin,
    bootstrap: supervisor.exchangeOrigin,
  };
  await supervisor.close();
  supervisors.splice(supervisors.indexOf(supervisor), 1);
  await Promise.all(Object.entries(settledOrigins).map(([label, origin]) => (
    assertOriginClosed(origin, `settled ${label}`)
  )));
  await eventually(
    () => !existsSync(supervisorDescriptor),
    { label: 'settled supervisor descriptor cleanup' },
  );
  await eventually(() => !existsSync(settled.readyFile), { label: 'settled ready-file cleanup' });

  // Exercise the packaged command wiring and signal path, not only the
  // programmatic supervisor seam. It reuses the settled database, receives a
  // fresh ordinary session, correlates control events, and joins every child.
  const cliRun = await runCliSupervisor(settled, 'web');
  assert.match(cliRun.bearer, /^sbs_/u);
  assert.equal(cliRun.readyEvent.platform, 'web');
  assertListenerInventory({ listeners: cliRun.listenerEvent.listeners });
  const cliOrigins = {
    backend: cliRun.readyEvent.binding.target.origin,
    metro: cliRun.readyEvent.metro.origin,
    bootstrap: cliRun.readyEvent.bootstrap.origin,
  };
  await Promise.all(Object.entries(cliOrigins).map(([label, origin]) => (
    assertOriginClosed(origin, `CLI ${label}`)
  )));
  await eventually(() => !existsSync(settled.readyFile), { label: 'CLI ready-file cleanup' });

  // Bearer-leak matrix: use /usr/bin/grep exactly as the E1 acceptance asks.
  const evidenceRoot = join(settled.projectRoot, 'e1-evidence');
  mkdirSync(evidenceRoot, { recursive: true });
  const bindingEvidence = join(evidenceRoot, 'AppBinding.json');
  const metroLogs = join(evidenceRoot, 'metro.log');
  const readiness = join(evidenceRoot, 'readiness.ndjson');
  writeFileSync(
    bindingEvidence,
    `${JSON.stringify(supervisor.binding)}\n${JSON.stringify(cliRun.readyEvent.binding)}\n`,
  );
  writeFileSync(
    metroLogs,
    `${[
      ...supervisor.inspection().metro.logs.map(({ stream, line }) => `${stream}: ${line}`),
      ...cliRun.events
        .filter((event) => event.state === 'metro-output')
        .map(({ stream, line }) => `${stream}: ${line}`),
    ].join('\n')}\n`,
  );
  writeFileSync(
    readiness,
    `${[...events, ...cliRun.events].map((event) => JSON.stringify(event)).join('\n')}\n`,
  );
  const bearers = [firstBearer, secondBearer, cliRun.bearer];
  assertGrepAbsent('JS bundle', [settled.bundle], bearers);
  assertGrepAbsent('source map', [settled.sourceMap], bearers);
  assertGrepAbsent('Metro logs', [metroLogs], bearers);
  assertGrepAbsent('AppBinding', [bindingEvidence], bearers);
  assertGrepAbsent('persistent public configuration', Object.values(settled.publicConfig), bearers);
  assertGrepAbsent('readiness stream', [readiness], bearers);

  assert(
    events.some((event) => event.state === 'ready' && /snapback admin --ready-file/u.test(event.adminConsoleCommand)),
    'the correlated readiness stream prints the admin console launch command',
  );
  assert(
    events.some((event) => event.state === 'metro-watch-advisory'
      && event.code === 'SNAPBACK_EXPO_METRO_WATCH_INERT'
      && event.advisories.some((advisory) => advisory.condition === 'ci-environment')),
    'the readiness stream warns once when Metro file watching is inert under CI',
  );
  assert(
    events.some((event) => event.state === 'closed'
      && event.reclaimed.backend
      && event.reclaimed.metro
      && event.reclaimed.bootstrap),
    'shutdown reports every owned arm reclaimed',
  );

  console.log('expo-dev-loop.test.mjs: zero-write rendezvous carrier, transient descriptor, Sessions refusal+mint, all-listener loopback proof, provider live/mutation/presence/HMR/reconnect/authority replacement, leak matrix, and strict cleanup pass');
} finally {
  await Promise.allSettled(supervisors.map((supervisor) => supervisor.close()));
  rmSync(scratchRoot, { recursive: true, force: true });
}

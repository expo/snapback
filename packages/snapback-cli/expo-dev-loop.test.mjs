import assert from 'node:assert/strict';
import { spawn, spawnSync } from 'node:child_process';
import { createHash, webcrypto } from 'node:crypto';
import {
  chmodSync,
  cpSync,
  createReadStream,
  existsSync,
  mkdirSync,
  mkdtempSync,
  readdirSync,
  readFileSync,
  realpathSync,
  renameSync,
  rmSync,
  statSync,
  symlinkSync,
  writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import {
  createServer as createHttpServer,
  request as createHttpRequest,
} from 'node:http';
import { createConnection, createServer as createNetServer } from 'node:net';
import { dirname, join, resolve } from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { PassThrough } from 'node:stream';
import { pathToFileURL, fileURLToPath } from 'node:url';
import { IDBFactory } from 'fake-indexeddb';

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
  __test as expoDevTest,
  EXPO_SUPERVISOR_DESCRIPTOR_FORMAT,
  SUPERVISED_CONTROL_PATH,
  SUPERVISED_EXCHANGE_PATH,
  createExpoRoutingPlan,
  expoBackendClientOrigins,
  expoBackendDevAuthEnvironment,
  expoMetroChildEnvironment,
  installAndroidPortForwarding,
  runExpoDev,
} from './expo-dev.mjs';
import {
  attachDevControlChannel,
  managedAdminToken,
  readReadyDescriptor,
  runCli,
  runDev,
} from './index.mjs';
import { CLEANUP_LEASE_DIRECTORY_ENV, stopProcessGroup } from './process-teardown.mjs';
import {
  defineTemplateCarrierConfig,
  runTemplateCarrierCli,
} from './carrier-kit.mjs';

const packageRoot = dirname(fileURLToPath(import.meta.url));
const repoRoot = resolve(packageRoot, '..', '..');
// Default to this checkout's own bootstrapped binary. The previous default was
// an absolute path into one developer's home directory, which made this test
// unrunnable everywhere else.
const runtimeBinary = process.env.SNAPBACK_SERVER_BINARY
  ?? process.env.SNAPBACK_RUNTIME_BINARY
  ?? join(repoRoot, 'target', 'debug', 'snapback');
const metroFreshnessOnly = process.argv.includes('--metro-freshness-only');
const controlSocketOnly = process.argv.includes('--control-socket-only');
const httpControlOnly = process.argv.includes('--http-control-only');
const stopFailureOnly = process.argv.includes('--stop-failure-only');
const metroStopRaceOnly = process.argv.includes('--metro-stop-race-only');
const backendCloseRetryOnly = process.argv.includes('--backend-close-retry-only');
const controlOwnerSurvivalOnly = process.argv.includes('--control-owner-survival-only');
const noTokenCarrierOnly = process.argv.includes('--no-token-carrier-only');
const regularFileOnly = process.argv.includes('--regular-file-only');
if (!metroFreshnessOnly) {
  assert.ok(existsSync(runtimeBinary), `real Snapback runtime is missing: ${runtimeBinary}`);
}

const sourceFixture = join(packageRoot, 'fixtures', 'comparator', 'app', 'snapback');
const scratchRoot = realpathSync(mkdtempSync(join(tmpdir(), 'snapback-expo-dev-loop-')));
const metroScript = join(scratchRoot, 'headless-metro.mjs');
const cliLifecycleRunner = join(scratchRoot, 'cli-lifecycle-runner.mjs');
const supervisors = [];
const cliChildren = [];
const externalScratchRoots = new Set();
const governanceInputs = Object.freeze([
  'elevated-read-site-baseline.json',
  'table-visibility-policy-baseline.json',
  'table-visibility-policy-transition-ledger.json',
  'visibility-governance-quarantine-ledger.json',
  'visibility-override-baseline.json',
  'visibility-override-owner-baseline.json',
]);

writeFileSync(metroScript, `
import { existsSync, readFileSync, watch, watchFile, unwatchFile, writeFileSync } from 'node:fs';
import { createServer } from 'node:http';
import { getDefaultResultOrder } from 'node:dns';
import { join } from 'node:path';

const port = Number(process.env.SNAPBACK_EXPO_METRO_PORT);
const origin = process.env.EXPO_PUBLIC_SNAPBACK_SUPERVISOR_ORIGIN;
const backendOrigin = process.env.EXPO_PUBLIC_SNAPBACK_URL;
const generatedRoot = process.env.SNAPBACK_EXPO_TEST_GENERATED_ROOT;
const launchCountFile = process.env.SNAPBACK_EXPO_TEST_METRO_LAUNCH_COUNT_FILE;
let launchCount = 1;
if (launchCountFile) {
  launchCount = existsSync(launchCountFile)
    ? Number(readFileSync(launchCountFile, 'utf8')) + 1
    : 1;
  writeFileSync(launchCountFile, String(launchCount));
}
if (process.env.SNAPBACK_EXPO_TEST_METRO_FAIL_AFTER_FIRST === '1' && launchCount > 1) {
  process.stderr.write('injected replacement Metro launch failure\\n');
  process.exit(86);
}
const ci = String(process.env.CI ?? '').trim().toLowerCase();
const watching = !['1', 'true'].includes(ci);
const pollGeneratedAlias = process.env.SNAPBACK_EXPO_TEST_POLL_GENERATED === '1';

function publishedGraph() {
  const aliasSource = readFileSync(join(generatedRoot, 'app.mjs'), 'utf8');
  const bindingMatch = /from "\\.\\/(app\\.binding\\.[0-9a-f]{64}\\.mjs)"/u.exec(aliasSource);
  if (bindingMatch === null) throw new Error('generated app alias has no digest binding');
  const bindingPath = join(generatedRoot, bindingMatch[1]);
  if (!existsSync(bindingPath)) throw new Error('digest binding is not yet published');
  const bindingSource = readFileSync(bindingPath, 'utf8');
  const descriptorMatch = /from "\\.\\/(app\\.descriptor\\.[0-9a-f]{64}\\.json)"/u.exec(bindingSource);
  if (descriptorMatch === null) throw new Error('digest binding has no digest descriptor');
  const descriptorPath = join(generatedRoot, descriptorMatch[1]);
  if (!existsSync(descriptorPath)) throw new Error('digest descriptor is not yet published');
  const descriptor = JSON.parse(readFileSync(descriptorPath, 'utf8'));
  return Object.freeze({
    bindingSpecifier: bindingMatch[1],
    descriptorSpecifier: descriptorMatch[1],
    descriptorIdentity: descriptor.identity.descriptor,
  });
}

let servedGraph = publishedGraph();
let filesChanged = 0;
let refreshTimer = null;
const refreshPublishedGraph = () => {
  try {
    const successor = publishedGraph();
    if (successor.descriptorIdentity !== servedGraph.descriptorIdentity) filesChanged += 1;
    servedGraph = successor;
  } catch {
    refreshTimer = setTimeout(refreshPublishedGraph, 10);
  }
};
const scheduleRefresh = () => {
  if (refreshTimer !== null) clearTimeout(refreshTimer);
  refreshTimer = setTimeout(refreshPublishedGraph, 10);
};
let generatedWatcher = null;
if (watching && pollGeneratedAlias) {
  const aliasPath = join(generatedRoot, 'app.mjs');
  watchFile(aliasPath, { interval: 10 }, scheduleRefresh);
  generatedWatcher = { close: () => unwatchFile(aliasPath, scheduleRefresh) };
} else if (watching) {
  generatedWatcher = watch(generatedRoot, scheduleRefresh);
}
writeFileSync(process.env.SNAPBACK_EXPO_TEST_ENV, JSON.stringify({
  nodeOptions: process.env.NODE_OPTIONS,
  defaultResultOrder: getDefaultResultOrder(),
  ci: process.env.CI ?? null,
  watching,
  backendOrigin: backendOrigin ?? null,
}));
writeFileSync(process.env.SNAPBACK_EXPO_TEST_BUNDLE, [
  '// headless Metro bundle fixture',
  'export const supervisedOrigin = ' + JSON.stringify(origin) + ';',
  'export const snapbackUrl = ' + JSON.stringify(backendOrigin) + ';',
].join('\\n') + '\\n');
writeFileSync(process.env.SNAPBACK_EXPO_TEST_SOURCE_MAP, JSON.stringify({
  version: 3,
  sources: ['App.tsx'],
  sourcesContent: [
    'export const supervisedOrigin = ' + JSON.stringify(origin) + ';\\n'
      + 'export const snapbackUrl = ' + JSON.stringify(backendOrigin) + ';',
  ],
  names: [],
  mappings: '',
}));
const server = createServer((request, response) => {
  if (request.url === '/bundle') {
    response.setHeader('content-type', 'application/javascript');
    response.setHeader('x-metro-files-changed-count', String(filesChanged));
    response.end([
      '// headless Metro generated-graph bundle fixture',
      'globalThis.__SNAPBACK_DESCRIPTOR_IDENTITY__ = ' + JSON.stringify(servedGraph.descriptorIdentity) + ';',
      'globalThis.__SNAPBACK_BINDING_SPECIFIER__ = ' + JSON.stringify(servedGraph.bindingSpecifier) + ';',
      'globalThis.__SNAPBACK_DESCRIPTOR_SPECIFIER__ = ' + JSON.stringify(servedGraph.descriptorSpecifier) + ';',
    ].join('\\n') + '\\n');
    return;
  }
  response.setHeader('content-type', 'application/json');
  response.end(JSON.stringify({ ok: true, hmr: request.url === '/hmr' }));
});
const launchDelayMs = Number(process.env.SNAPBACK_EXPO_TEST_METRO_START_DELAY_MS ?? 0);
if (launchDelayMs > 0) await new Promise((resolveDelay) => setTimeout(resolveDelay, launchDelayMs));
server.listen(port, '127.0.0.1', () => {
  console.log(JSON.stringify({ event: 'metro-ready', host: '127.0.0.1', port }));
});
const stop = () => {
  generatedWatcher?.close();
  if (refreshTimer !== null) clearTimeout(refreshTimer);
  if (process.env.SNAPBACK_EXPO_TEST_METRO_STUBBORN_FIRST === '1' && launchCount === 1) return;
  server.close(() => process.exit(0));
};
process.once('SIGTERM', stop);
process.once('SIGINT', stop);
`);

writeFileSync(cliLifecycleRunner, `
import { existsSync, writeFileSync } from 'node:fs';
import { runCli } from ${JSON.stringify(pathToFileURL(join(packageRoot, 'index.mjs')).href)};

const [barrier, cleanupStarted, bundle, sourceMap, metroEnvironment, generatedRoot, ...args] = process.argv.slice(2);
const code = await runCli(args, {
  runtimeBinary: process.env.SNAPBACK_SERVER_BINARY
    ?? process.env.SNAPBACK_RUNTIME_BINARY,
  env: {
    ...process.env,
    SNAPBACK_RUNTIME_BINARY: process.env.SNAPBACK_SERVER_BINARY
      ?? process.env.SNAPBACK_RUNTIME_BINARY,
    SNAPBACK_EXPO_TEST_BUNDLE: bundle,
    SNAPBACK_EXPO_TEST_SOURCE_MAP: sourceMap,
    SNAPBACK_EXPO_TEST_ENV: metroEnvironment,
    SNAPBACK_EXPO_TEST_GENERATED_ROOT: generatedRoot,
  },
  async beforeReadinessPublish({ listeners, metroPid, metroProcessPort, metroOrigin, signal }) {
    writeFileSync(barrier, JSON.stringify({ listeners, metroPid, metroProcessPort, metroOrigin }));
    await new Promise((resolveBarrier, rejectBarrier) => {
      const onAbort = () => {
        writeFileSync(cleanupStarted, 'started');
        rejectBarrier(signal.reason ?? new Error('startup interrupted'));
      };
      if (signal?.aborted) onAbort();
      else signal?.addEventListener('abort', onAbort, { once: true });
    });
  },
});
process.exitCode = code;
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

function deferred() {
  let resolvePromise;
  const promise = new Promise((resolve) => { resolvePromise = resolve; });
  return Object.freeze({ promise, resolve: resolvePromise });
}

async function reserveFreeRange(width) {
  for (let lo = 46_000; lo <= 60_000 - width; lo += width) {
    const servers = [];
    try {
      for (let port = lo; port < lo + width; port += 1) {
        const server = createNetServer();
        await new Promise((resolveListen, rejectListen) => {
          server.once('error', rejectListen);
          server.listen(port, '127.0.0.1', resolveListen);
        });
        servers.push(server);
      }
      await Promise.all(servers.map((server) => new Promise((resolveClose) => server.close(resolveClose))));
      return { lo, hi: lo + width - 1 };
    } catch {
      await Promise.all(servers.map((server) => new Promise((resolveClose) => server.close(resolveClose))));
    }
  }
  throw new Error('could not locate a free loopback range for the Expo supervisor test');
}

if (metroFreshnessOnly) {
  const generatedRoot = join(scratchRoot, 'metro-freshness-generated');
  const bundle = join(scratchRoot, 'metro-freshness-bundle.js');
  const sourceMap = join(scratchRoot, 'metro-freshness-bundle.js.map');
  const metroEnv = join(scratchRoot, 'metro-freshness-env.json');
  mkdirSync(generatedRoot, { recursive: true });
  const publishGraph = ({ digest, identity }) => {
    writeFileSync(
      join(generatedRoot, `app.descriptor.${digest}.json`),
      `${JSON.stringify({ identity: { descriptor: identity } })}\n`,
    );
    writeFileSync(
      join(generatedRoot, `app.binding.${digest}.mjs`),
      `import descriptor from "./app.descriptor.${digest}.json" with { type: "json" };\nexport const app = descriptor;\n`,
    );
    // The stable alias is the atomic publication pointer: digest nodes exist
    // before its bytes rotate, so the watcher can never import a partial graph.
    writeFileSync(
      join(generatedRoot, 'app.mjs'),
      `export { app } from "./app.binding.${digest}.mjs";\n`,
    );
  };
  const predecessor = Object.freeze({
    digest: '1'.repeat(64),
    identity: `sha256:${'a'.repeat(64)}`,
  });
  const successor = Object.freeze({
    digest: '2'.repeat(64),
    identity: `sha256:${'b'.repeat(64)}`,
  });
  publishGraph(predecessor);
  const port = (await reserveFreeRange(1)).lo;
  const child = spawn(process.execPath, [metroScript], {
    env: expoMetroChildEnvironment({
      env: {
        ...process.env,
        CI: '1',
        SNAPBACK_EXPO_TEST_BUNDLE: bundle,
        SNAPBACK_EXPO_TEST_SOURCE_MAP: sourceMap,
        SNAPBACK_EXPO_TEST_ENV: metroEnv,
        SNAPBACK_EXPO_TEST_GENERATED_ROOT: generatedRoot,
        SNAPBACK_EXPO_TEST_POLL_GENERATED: '1',
      },
      bootstrapOrigin: 'http://127.0.0.1:1',
      port,
    }),
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  let metroOutput = '';
  child.stdout.on('data', (chunk) => { metroOutput += chunk; });
  child.stderr.on('data', (chunk) => { metroOutput += chunk; });
  const childExit = new Promise((resolveExit) => {
    child.once('exit', (code, signal) => resolveExit({ code, signal }));
  });
  try {
    const predecessorBundle = await eventually(async () => {
      if (child.exitCode !== null || child.signalCode !== null) {
        throw new Error(metroOutput || `Metro fixture exited ${child.exitCode ?? child.signalCode}`);
      }
      const response = await fetch(`http://127.0.0.1:${port}/bundle`);
      const source = await response.text();
      return source.includes(predecessor.identity) ? { response, source } : false;
    }, { label: 'predecessor generated descriptor bundle' });
    assert.equal(predecessorBundle.response.headers.get('x-metro-files-changed-count'), '0');
    assert.deepEqual(JSON.parse(readFileSync(metroEnv, 'utf8')), {
      nodeOptions: [process.env.NODE_OPTIONS, '--dns-result-order=ipv4first']
        .filter(Boolean)
        .join(' '),
      defaultResultOrder: 'ipv4first',
      ci: null,
      watching: true,
      backendOrigin: null,
    });
    const metroPid = child.pid;
    publishGraph(successor);
    const successorBundle = await eventually(async () => {
      const response = await fetch(`http://127.0.0.1:${port}/bundle`);
      const source = await response.text();
      return source.includes(successor.identity) ? { response, source } : false;
    }, { label: 'successor generated descriptor bundle' });
    assert.equal(successorBundle.response.headers.get('x-metro-files-changed-count'), '1');
    assert.equal(successorBundle.source.includes(predecessor.identity), false);
    assert.equal(child.pid, metroPid);
    assert.equal(child.exitCode, null);
  } finally {
    if (child.exitCode === null && child.signalCode === null) child.kill('SIGTERM');
    await childExit;
    rmSync(scratchRoot, { recursive: true, force: true });
  }
  console.log('expo-dev-loop.test.mjs --metro-freshness-only: 1 successor descriptor served without a Metro restart');
  process.exit(0);
}

function processGroupAlive(pid) {
  try {
    process.kill(-pid, 0);
    return true;
  } catch (error) {
    if (error?.code === 'ESRCH') return false;
    throw error;
  }
}

function processAlive(pid) {
  try {
    process.kill(pid, 0);
    return true;
  } catch (error) {
    if (error?.code === 'ESRCH') return false;
    throw error;
  }
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

function fixture(name, { sessions, root = scratchRoot }) {
  const projectRoot = join(root, name);
  const backendRoot = join(projectRoot, 'snapback');
  const expoRoot = join(projectRoot, 'app');
  mkdirSync(projectRoot, { recursive: true });
  // The copied fixture's generated modules import workspace packages such as
  // @expo/snapback-client. Once they live under this scratch project, Node can
  // resolve those bare imports only through a project-local node_modules.
  symlinkSync(join(repoRoot, 'node_modules'), join(projectRoot, 'node_modules'), 'dir');
  cpSync(sourceFixture, backendRoot, { recursive: true });
  const governance = governanceInputs.map((name) => [
    name,
    readFileSync(join(backendRoot, 'generated', name)),
  ]);
  rmSync(join(backendRoot, 'generated'), { recursive: true, force: true });
  mkdirSync(join(backendRoot, 'generated'), { recursive: true });
  for (const [name, contents] of governance) {
    writeFileSync(join(backendRoot, 'generated', name), contents);
  }
  mkdirSync(expoRoot, { recursive: true });
  if (sessions) {
    const schemaPath = join(backendRoot, 'schema.mjs');
    const source = readFileSync(schemaPath, 'utf8');
    const withAuthImport = source.replace(
      'import { defineEphemeral, defineSchema, defineTable, v }',
      'import { defineAuth, defineEphemeral, defineSchema, defineTable, v }',
    );
    const withAuthProgram = withAuthImport.replace(
      'export default defineSchema(',
      `const authProgram = defineAuth({
  version: 1,
  custody: 'volatile-explicit',
  mechanisms: {
    password: {
      kind: 'password',
      identifier: 'email',
      provider: 'builtIn',
      recovery: 'recoveryCodes',
    },
  },
  assuranceRequirements: {},
  recoveryPolicy: {
    recoveryCodes: {
      enabled: true,
      requiredWhen: 'no-independent-recovery',
      rotateAfterUse: true,
      plaintextCustody: 'one-time-response',
    },
    lastAuthenticator: 'enforce',
  },
  guestPolicy: { enabled: false },
  secretReferences: {},
});

export default defineSchema(`,
    );
    const updated = withAuthProgram.replace(
      '  {\n    ephemeral: defineEphemeral({',
      "  {\n    auth: { mode: 'sessions' },\n    authProgram,\n    ephemeral: defineEphemeral({",
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
  const generatedRoot = join(backendRoot, 'generated');
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
    generatedRoot,
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
    now: options.now,
    bindingTtlMs: options.bindingTtlMs,
    bindingRefreshWindowMs: options.bindingRefreshWindowMs,
    afterSupervisedAuthorityRequested: options.afterSupervisedAuthorityRequested,
    controlSocket: options.controlSocket,
    requireControlCarrier: options.requireControlCarrier,
    stdinControl: options.stdinControl,
    afterControlEndpointLeaseActivation: options.afterControlEndpointLeaseActivation,
    beforeStopChildren: options.beforeStopChildren,
    stopProcessGroup: options.stopProcessGroup,
    beforeDevFreshExpoRefresh: options.beforeDevFreshExpoRefresh,
    afterMetroReloadPreviousStopped: options.afterMetroReloadPreviousStopped,
    afterMetroReloadListenersVerified: options.afterMetroReloadListenersVerified,
    beforeReadinessPublish: options.beforeReadinessPublish,
    devOptions: options.devOptions,
    clientPort: options.clientPort,
    bootstrapPort: options.bootstrapPort,
    portRange: options.portRange,
    metroCommand: { command: process.execPath, args: [metroScript] },
    env: {
      ...process.env,
      ...(options.env ?? {}),
      CI: '1',
      SNAPBACK_RUNTIME_BINARY: runtimeBinary,
      SNAPBACK_EXPO_TEST_BUNDLE: target.bundle,
      SNAPBACK_EXPO_TEST_SOURCE_MAP: target.sourceMap,
      SNAPBACK_EXPO_TEST_ENV: target.metroEnv,
      SNAPBACK_EXPO_TEST_GENERATED_ROOT: target.generatedRoot,
      NODE_OPTIONS: '--trace-warnings',
    },
    serverStdio: ['ignore', 'ignore', 'ignore'],
    onEvent(event) {
      events.push(event);
      options.onEvent?.(event);
    },
  });
  assert.equal(supervisor.ok, true, JSON.stringify(supervisor));
  supervisors.push(supervisor);
  assert.deepEqual(
    snapshotEnvFiles(target.expoRoot),
    environmentBefore,
    'supervised startup must not create or mutate any .env* file',
  );
  return { supervisor, events };
}

function assertListenerInventory(supervisor) {
  const owners = [...new Set(supervisor.listeners.map(({ owner }) => owner))].sort();
  assert(owners.includes('backend'));
  assert(owners.includes('bootstrap'));
  assert(owners.includes('metro'));
  assert(owners.every((owner) => ['backend', 'bootstrap', 'metro', 'metro-front'].includes(owner)));
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

async function requestSupervisedMint(exchangeOrigin, admittedOrigin, bootstrap = null) {
  const bindingExchange = bootstrap ?? await (
    await fetch(`${exchangeOrigin}${SUPERVISED_EXCHANGE_PATH}`, {
      headers: { Origin: admittedOrigin },
    })
  ).json();
  const response = await fetch(
    `${exchangeOrigin}${SUPERVISED_EXCHANGE_PATH}?authority=mint`,
    {
      method: 'POST',
      headers: {
        Origin: admittedOrigin,
        'content-type': 'application/json',
      },
      body: JSON.stringify({ correlationId: bindingExchange.correlationId }),
    },
  );
  assert.equal(response.status, 200);
  return response.json();
}

function authSessionCount(databasePath) {
  const database = new DatabaseSync(databasePath, { readOnly: true });
  try {
    return Number(database.prepare('SELECT COUNT(*) AS count FROM "_auth_sessions"').get().count);
  } finally {
    database.close();
  }
}

function authSessionUserForBearer(databasePath, bearer) {
  const database = new DatabaseSync(databasePath, { readOnly: true });
  try {
    return database.prepare(
      'SELECT user_id AS userId FROM "_auth_sessions" WHERE token_hash = ?',
    ).get(createHash('sha256').update(bearer).digest())?.userId ?? null;
  } finally {
    database.close();
  }
}

function listenerOrigin({ host, port }) {
  return `http://${host.includes(':') ? `[${host}]` : host}:${port}`;
}

function controlCommand(controlSocket, verb, requestId, overrides = {}) {
  return {
    schemaVersion: 'snapback.dev-control-command.v1',
    requestId,
    verb,
    owner: {
      pid: controlSocket.ownerPid,
      uid: controlSocket.ownerUid,
      incarnationId: controlSocket.ownerIncarnationId,
      ...(overrides.owner ?? {}),
    },
    lifecycleReceipt: overrides.lifecycleReceipt ?? controlSocket.lifecycleReceipt,
  };
}

function openControlCommand(controlSocket, command) {
  let resolveAcknowledged;
  let rejectAcknowledged;
  const acknowledged = new Promise((resolveAck, rejectAck) => {
    resolveAcknowledged = resolveAck;
    rejectAcknowledged = rejectAck;
  });
  const completion = new Promise((resolveMessages, rejectMessages) => {
    const messages = [];
    let buffer = '';
    const socket = createConnection(controlSocket.path);
    socket.setEncoding('utf8');
    socket.setTimeout(30_000, () => socket.destroy(new Error(
      `timed out waiting for control result for ${command.requestId}`,
    )));
    socket.once('connect', () => socket.write(`${JSON.stringify(command)}\n`));
    socket.on('data', (chunk) => {
      buffer += chunk;
      let newline;
      while ((newline = buffer.indexOf('\n')) !== -1) {
        const line = buffer.slice(0, newline);
        buffer = buffer.slice(newline + 1);
        if (!line) continue;
        const message = JSON.parse(line);
        messages.push(message);
        if (message.schemaVersion === 'snapback.dev-control-ack.v1') {
          resolveAcknowledged(message);
        }
        if (message.schemaVersion === 'snapback.dev-control-result.v1') {
          socket.end();
        }
      }
    });
    socket.once('error', (error) => {
      rejectAcknowledged(error);
      rejectMessages(error);
    });
    socket.once('close', () => resolveMessages(messages));
  });
  return Object.freeze({ acknowledged, completion });
}

async function sendControlCommand(controlSocket, command) {
  const operation = openControlCommand(controlSocket, command);
  void operation.acknowledged.catch(() => {});
  return await operation.completion;
}

async function sendHttpControl(
  supervisorDescriptor,
  operatorToken,
  verb,
  requestId,
  { origin = null } = {},
) {
  const response = await fetch(
    `${supervisorDescriptor.exchangeOrigin}${supervisorDescriptor.controlPath}`,
    {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        'x-snapback-operator-token': operatorToken,
        ...(origin === null ? {} : { origin }),
      },
      body: JSON.stringify({ verb, requestId }),
    },
  );
  return Object.freeze({
    status: response.status,
    headers: response.headers,
    body: await response.json(),
  });
}

async function runCliSupervisor(target, platform = 'ios', portArgs = [], {
  assertStdinReload = false,
  assertStdinRestartBeforeSocketReload = false,
  assertConcurrentStdinSocketReload = false,
  expectControlUnavailable = false,
  expectHttpFallback = false,
  closeStdinImmediately = false,
  expectNoStdinControlReady = false,
  failMetroReload = false,
  stubbornMetroDuringReload = false,
} = {}) {
  const cli = join(packageRoot, 'cli.mjs');
  const events = [];
  let stdoutBuffer = '';
  let stderr = '';
  const child = spawn(process.execPath, [
    cli,
    'dev',
    target.backendRoot,
    '--expo',
    '--json',
    '--expo-platform', platform,
    '--expo-dir', target.expoRoot,
    '--ready-file', target.readyFile,
    '--db', target.database,
    '--email', 'cli@expo-e1.test',
    '--expo-command', `${JSON.stringify(process.execPath)} ${JSON.stringify(metroScript)}`,
    ...portArgs,
  ], {
    cwd: target.projectRoot,
    env: {
      ...process.env,
      SNAPBACK_RUNTIME_BINARY: runtimeBinary,
      SNAPBACK_EXPO_TEST_BUNDLE: target.bundle,
      SNAPBACK_EXPO_TEST_SOURCE_MAP: target.sourceMap,
      SNAPBACK_EXPO_TEST_ENV: target.metroEnv,
      SNAPBACK_EXPO_TEST_GENERATED_ROOT: target.generatedRoot,
      SNAPBACK_EXPO_TEST_METRO_START_DELAY_MS: '250',
      ...(failMetroReload ? {
        SNAPBACK_EXPO_TEST_METRO_LAUNCH_COUNT_FILE: join(target.stateRoot, 'metro-launch-count'),
        SNAPBACK_EXPO_TEST_METRO_FAIL_AFTER_FIRST: '1',
      } : {}),
      ...(stubbornMetroDuringReload ? {
        SNAPBACK_EXPO_TEST_METRO_LAUNCH_COUNT_FILE: join(target.stateRoot, 'metro-launch-count'),
        SNAPBACK_EXPO_TEST_METRO_STUBBORN_FIRST: '1',
      } : {}),
    },
    stdio: [
      assertStdinReload || assertStdinRestartBeforeSocketReload || assertConcurrentStdinSocketReload
        || expectControlUnavailable || closeStdinImmediately
        ? 'pipe'
        : 'ignore',
      'pipe',
      'pipe',
    ],
  });
  cliChildren.push(child);
  if (closeStdinImmediately) child.stdin.end();
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
    () => {
      const startupOutcome = events.find((event) => event.schemaVersion === 'snapback.expo-dev.v1'
        && (event.state === 'ready' || event.state === 'startup-failed'));
      if (startupOutcome) return startupOutcome;
      if (child.exitCode !== null || child.signalCode !== null) {
        throw new Error(`snapback dev --expo exited before readiness: ${stderr || stdoutBuffer}`);
      }
      return false;
    },
    { label: 'snapback dev --expo CLI readiness' },
  );
  const startupOutcome = events.find((event) => event.schemaVersion === 'snapback.expo-dev.v1'
    && (event.state === 'ready' || event.state === 'startup-failed'));
  assert.equal(
    startupOutcome.state,
    'ready',
    `unexpected CLI startup refusal: ${JSON.stringify(startupOutcome.diagnostics ?? [])}`,
  );
  const readyEvent = events.find((event) => event.state === 'ready');
  assert.equal(readyEvent.connectCarrier, 'supervisor-rendezvous');
  const listenerEvent = events.find((event) => event.state === 'listeners-verified');
  const exchange = await requestSupervisedMint(
    readyEvent.bootstrap.origin,
    readyEvent.metro.origin,
  );
  const supervisorDescriptorPath = join(dirname(target.readyFile), 'expo-supervisor.json');
  const supervisorDescriptor = JSON.parse(readFileSync(supervisorDescriptorPath, 'utf8'));
  const controlSocket = supervisorDescriptor.controlSocket;
  if (expectNoStdinControlReady) {
    await new Promise((resolveWait) => setTimeout(resolveWait, 100));
    assert.equal(
      events.some((event) => event.state === 'control-event'
        && event.control?.state === 'control-ready'),
      false,
      'an unavailable stdin carrier must not emit control-ready',
    );
  }
  const assertReloadThroughStdin = async () => {
    child.stdin.write(`${JSON.stringify({
      schemaVersion: 'snapback.dev-command.v1',
      verb: 'reload',
      requestId: 'stdin-reload-1',
    })}\n`);
    const stdinReloadEvent = await eventually(
      () => events.find((event) => (
        event.backend?.verb === 'reload' && event.backend?.requestId === 'stdin-reload-1'
      )),
      { label: 'JSON stdin reload result' },
    );
    assert.equal(stdinReloadEvent.backend.ok, true, JSON.stringify(stdinReloadEvent.backend));
  };
  if (expectControlUnavailable) {
    const unavailableEvent = events.find((event) => event.state === 'control-socket-unavailable');
    assert.equal(
      unavailableEvent?.diagnostics?.[0]?.code,
      'SNAPBACK_DEV_CONTROL_SOCKET_UNAVAILABLE',
      'an unavailable control socket must emit the coded stdin-only notice',
    );
    assert.equal(readyEvent.controlSocket, null);
    assert.equal(controlSocket, null);
    if (assertStdinReload) await assertReloadThroughStdin();
    const exitPromise = new Promise((resolveExit) => {
      child.once('exit', (code, signal) => resolveExit({ code, signal }));
    });
    child.kill('SIGTERM');
    await Promise.race([
      exitPromise,
      new Promise((_, rejectExit) => setTimeout(
        () => rejectExit(new Error('stdin-only Expo supervisor did not join SIGTERM cleanup')),
        15_000,
      )),
    ]);
    return { events, readyEvent, listenerEvent, bearer: exchange.authority.token };
  }
  if (expectHttpFallback) {
    const unavailableEvent = events.find((event) => event.state === 'control-socket-unavailable');
    assert.equal(
      unavailableEvent?.diagnostics?.[0]?.code,
      'SNAPBACK_DEV_CONTROL_SOCKET_UNAVAILABLE',
      'an unavailable socket must retain its coded diagnostic while HTTP remains usable',
    );
    assert.equal(readyEvent.controlSocket, null);
    assert.equal(readyEvent.controlPath, SUPERVISED_CONTROL_PATH);
    assert.equal(supervisorDescriptor.controlSocket, null);
    assert.equal(supervisorDescriptor.controlPath, SUPERVISED_CONTROL_PATH);
    assert.deepEqual(unavailableEvent.diagnostics[0].details.httpControl, {
      available: true,
      controlPath: SUPERVISED_CONTROL_PATH,
    });
    const operatorToken = managedAdminToken(readReadyDescriptor(target.readyFile), target.database);
    const reload = await sendHttpControl(
      supervisorDescriptor,
      operatorToken,
      'reload-metro',
      'http-fallback-reload-1',
    );
    assert.equal(reload.status, 200);
    assert.equal(reload.body.ok, true, JSON.stringify(reload.body));
    assert.notEqual(reload.body.pid, supervisorDescriptor.metro.pid);
    const backendPid = readReadyDescriptor(target.readyFile).pid;
    const stop = await sendHttpControl(
      supervisorDescriptor,
      operatorToken,
      'stop-children',
      'http-fallback-stop-1',
    );
    assert.equal(stop.status, 200);
    assert.equal(stop.body.ok, true, JSON.stringify(stop.body));
    assert.equal(stop.body.state, 'acknowledged');
    const stopped = await eventually(
      () => events.find((event) => (
        event.state === 'children-stopped' && event.requestId === 'http-fallback-stop-1'
      )),
      { label: 'packaged HTTP-only stop-children effect' },
    );
    assert.equal(stopped.ok, true, JSON.stringify(stopped));
    await eventually(() => !processAlive(backendPid), { label: 'packaged HTTP-only backend stop' });
    await eventually(() => !processGroupAlive(reload.body.pid), {
      label: 'packaged HTTP-only Metro stop',
    });
    const reloadAfterStop = await sendHttpControl(
      supervisorDescriptor,
      operatorToken,
      'reload-metro',
      'http-fallback-reload-after-stop',
    );
    assert.equal(reloadAfterStop.status, 200);
    assert.equal(reloadAfterStop.body.ok, true, JSON.stringify(reloadAfterStop.body));
    assert.equal(reloadAfterStop.body.previousPid, null);
    assert.equal(processGroupAlive(reloadAfterStop.body.pid), true);
    assert.equal(
      JSON.parse(readFileSync(supervisorDescriptorPath, 'utf8')).controlSocket,
      null,
    );
    const exitPromise = new Promise((resolveExit) => {
      child.once('exit', (code, signal) => resolveExit({ code, signal }));
    });
    child.kill('SIGTERM');
    await Promise.race([
      exitPromise,
      new Promise((_, rejectExit) => setTimeout(
        () => rejectExit(new Error('HTTP-fallback Expo supervisor did not join SIGTERM cleanup')),
        15_000,
      )),
    ]);
    return { events, readyEvent, listenerEvent, bearer: exchange.authority.token };
  }
  assert.equal(controlSocket?.schemaVersion, 'snapback.dev-control.v1');
  assert.equal(controlSocket.ownerPid, child.pid);
  assert.equal(controlSocket.ownerIncarnationId, supervisorDescriptor.supervisorGeneration);
  assert.deepEqual(controlSocket.verbs, ['reload-metro', 'stop-children']);
  assert.equal(
    realpathSync.native(dirname(controlSocket.path)),
    realpathSync.native(dirname(target.readyFile)),
    'the control socket must stay in the canonical ready-file directory',
  );
  assert.equal(controlSocket.path.endsWith('/.dc-sock'), true);
  const endpointStat = statSync(controlSocket.path);
  assert.equal(endpointStat.isSocket(), true);
  assert.equal(endpointStat.mode & 0o777, 0o600);
  if (typeof process.getuid === 'function') assert.equal(endpointStat.uid, process.getuid());

  if (assertStdinReload) {
    await assertReloadThroughStdin();
  }

  if (assertStdinRestartBeforeSocketReload) {
    const backendPidBeforeRestart = readReadyDescriptor(target.readyFile).pid;
    child.stdin.write(`${JSON.stringify({
      schemaVersion: 'snapback.dev-command.v1',
      verb: 'restart',
      requestId: 'stdin-restart-before-socket-reload',
    })}\n`);
    const stdinRestartEvent = await eventually(
      () => events.find((event) => (
        event.backend?.verb === 'restart'
          && event.backend?.requestId === 'stdin-restart-before-socket-reload'
      )),
      { label: 'JSON stdin restart result before socket Metro reload' },
    );
    assert.equal(stdinRestartEvent.backend.ok, true, JSON.stringify(stdinRestartEvent.backend));
    assert.notEqual(
      readReadyDescriptor(target.readyFile).pid,
      backendPidBeforeRestart,
      'stdin restart must replace the backend before the socket Metro reload regression',
    );
  }

  const stale = await sendControlCommand(
    controlSocket,
    controlCommand(controlSocket, 'reload-metro', 'stale-1', {
      lifecycleReceipt: 'sha256:stale-lifecycle-receipt',
    }),
  );
  assert.equal(stale.length, 1, 'a stale lifecycle request must not receive an acknowledgement');
  assert.equal(stale.at(-1).diagnostics[0].code, 'SNAPBACK_DEV_CONTROL_STALE_INCARNATION');
  const foreign = await sendControlCommand(
    controlSocket,
    controlCommand(controlSocket, 'reload-metro', 'foreign-1', {
      owner: { incarnationId: 'supervisor-foreign-owner' },
    }),
  );
  assert.equal(foreign.length, 1, 'a foreign owner request must not receive an acknowledgement');
  assert.equal(foreign.at(-1).diagnostics[0].code, 'SNAPBACK_DEV_CONTROL_FOREIGN_OWNER');
  const otherUid = await sendControlCommand(
    controlSocket,
    controlCommand(controlSocket, 'reload-metro', 'uid-1', {
      owner: { uid: controlSocket.ownerUid + 1 },
    }),
  );
  assert.equal(otherUid.length, 1, 'an other-uid request must not receive an acknowledgement');
  assert.equal(otherUid.at(-1).diagnostics[0].code, 'SNAPBACK_DEV_CONTROL_OTHER_UID');
  const unknown = await sendControlCommand(
    controlSocket,
    controlCommand(controlSocket, 'recook', 'unknown-1'),
  );
  assert.equal(unknown.length, 1, 'a refused verb must not receive an acknowledgement');
  assert.equal(unknown[0].diagnostics[0].code, 'SNAPBACK_DEV_COMMAND_UNKNOWN_VERB');

  const metroPidBefore = supervisorDescriptor.metro.pid;
  const intermediateMetroPids = [];
  let reloadRequestId = 'reload-1';
  let reloadPreviousPid = metroPidBefore;
  let reloadOperation = openControlCommand(
    controlSocket,
    controlCommand(controlSocket, 'reload-metro', reloadRequestId),
  );
  await reloadOperation.acknowledged;
  if (failMetroReload) {
    const stopOperation = openControlCommand(
      controlSocket,
      controlCommand(controlSocket, 'stop-children', 'stop-after-failed-reload'),
    );
    await stopOperation.acknowledged;
    child.stdin.write(`${JSON.stringify({
      schemaVersion: 'snapback.dev-command.v1',
      verb: 'restart',
      requestId: 'stdin-restart-after-stop',
    })}\n`);
    const [reload, stop, stdinStopping] = await Promise.all([
      reloadOperation.completion,
      stopOperation.completion,
      eventually(
        () => events.find((event) => event.control?.diagnostics?.some(
          (diagnostic) => diagnostic.code === 'SNAPBACK_DEV_CONTROL_STOPPING',
        )),
        { label: 'stdin lifecycle refusal after stop acknowledgement' },
      ),
    ]);
    assert.equal(reload.length, 2);
    assert.equal(reload[1].ok, false);
    assert.equal(
      reload[1].diagnostics?.[0]?.code ?? reload[1].result?.diagnostics?.[0]?.code,
      'SNAPBACK_EXPO_METRO_RELOAD_FAILED',
    );
    assert.equal(stop.length, 2, 'queued stop must receive its settled result after reload failure');
    assert.equal(stop[0].state, 'acknowledged');
    assert.equal(stop[1].state, 'result');
    assert.equal(stop[1].ok, true);
    assert.equal(stop[1].result.state, 'children-stopped');
    assert.equal(stdinStopping.control.ok, false);
    assert.equal(
      events.some((event) => event.backend?.requestId === 'stdin-restart-after-stop'),
      false,
      'stdin restart after the stop acknowledgement must not spawn a backend',
    );
    const exit = await Promise.race([
      new Promise((resolveExit) => child.once('exit', (code, signal) => resolveExit({ code, signal }))),
      new Promise((_, rejectExit) => setTimeout(
        () => rejectExit(new Error('irrecoverable Metro reload failure left a silent bundler-less owner')),
        15_000,
      )),
    ]);
    assert.equal(exit.code, 1, stderr || stdoutBuffer);
    assert.equal(exit.signal, null, stderr || stdoutBuffer);
    await eventually(() => !processGroupAlive(metroPidBefore), { label: 'failed-reload Metro cleanup' });
    await eventually(() => !existsSync(controlSocket.path), { label: 'failed-reload socket cleanup' });
    return { events, readyEvent, listenerEvent, bearer: exchange.authority.token };
  }

  if (assertConcurrentStdinSocketReload) {
    child.stdin.write(`${JSON.stringify({
      schemaVersion: 'snapback.dev-command.v1',
      verb: 'reload-metro',
      requestId: 'stdin-metro-reload-1',
    })}\n`);
    const firstSocketReload = await reloadOperation.completion;
    assert.equal(firstSocketReload[1].ok, true, JSON.stringify(firstSocketReload));
    const stdinMetroReload = await eventually(
      () => events.find((event) => (
        event.verb === 'reload-metro'
        && event.requestId === 'stdin-metro-reload-1'
        && ['metro-reloaded', 'metro-reload-failed'].includes(event.state)
      )),
      { label: 'concurrent stdin reload-metro result' },
    );
    assert.equal(stdinMetroReload.ok, true, JSON.stringify(stdinMetroReload));
    assert.equal(
      stdinMetroReload.previousPid,
      firstSocketReload[1].result.pid,
      'stdin reload-metro must begin after the socket reload settles on the shared control lane',
    );
    intermediateMetroPids.push(firstSocketReload[1].result.pid);
    reloadPreviousPid = stdinMetroReload.pid;
    reloadRequestId = 'reload-stop-overlap';
    reloadOperation = openControlCommand(
      controlSocket,
      controlCommand(controlSocket, 'reload-metro', reloadRequestId),
    );
    await reloadOperation.acknowledged;
  }

  const stopOperation = openControlCommand(
    controlSocket,
    controlCommand(controlSocket, 'stop-children', 'stop-1'),
  );
  await stopOperation.acknowledged;
  const [reload, stop] = await Promise.all([
    reloadOperation.completion,
    stopOperation.completion,
  ]);
  assert.deepEqual(
    reload.map(({ schemaVersion, state, requestId, verb }) => ({ schemaVersion, state, requestId, verb })),
    [
      {
        schemaVersion: 'snapback.dev-control-ack.v1',
        state: 'acknowledged',
        requestId: reloadRequestId,
        verb: 'reload-metro',
      },
      {
        schemaVersion: 'snapback.dev-control-result.v1',
        state: 'result',
        requestId: reloadRequestId,
        verb: 'reload-metro',
      },
    ],
  );
  assert.equal(reload[1].ok, true);
  assert.equal(reload[1].result.state, 'metro-reloaded');
  assert.equal(reload[1].result.previousPid, reloadPreviousPid);
  assert.notEqual(reload[1].result.pid, reloadPreviousPid);
  assert.equal(stop[0].state, 'acknowledged');
  assert.equal(stop[0].requestId, 'stop-1');
  assert.equal(stop[1].state, 'result');
  assert.equal(stop[1].requestId, 'stop-1');
  assert.equal(stop[1].ok, true, JSON.stringify(stop));
  assert.equal(stop[1].result.state, 'children-stopped');
  assert.equal(
    child.exitCode,
    null,
    'stop-children must leave the packaged Expo lifecycle owner alive',
  );
  assert.equal(
    existsSync(controlSocket.path),
    true,
    'stop-children must preserve the owner-bound control endpoint',
  );
  const reloadAfterStop = await sendControlCommand(
    controlSocket,
    controlCommand(controlSocket, 'reload-metro', 'reload-after-stop'),
  );
  assert.equal(reloadAfterStop.length, 2, JSON.stringify(reloadAfterStop));
  assert.equal(reloadAfterStop[1].ok, true, JSON.stringify(reloadAfterStop));
  assert.equal(reloadAfterStop[1].requestId, 'reload-after-stop');
  assert.equal(reloadAfterStop[1].result.previousPid, null);
  assert.equal(processGroupAlive(reloadAfterStop[1].result.pid), true);
  if (stubbornMetroDuringReload) {
    assert.equal(
      events.some((event) => event.diagnostics?.some(
        (diagnostic) => diagnostic.code === 'SNAPBACK_EXPO_METRO_RELOAD_FAILED',
      )),
      false,
      'an acknowledged stop queued during Metro SIGTERM grace must not make reload critical',
    );
  }
  assert.equal(
    events.some((event) => event.schemaVersion === 'snapback.expo-dev.v1'
      && event.state === 'control-event'),
    assertStdinReload || assertStdinRestartBeforeSocketReload || assertConcurrentStdinSocketReload,
    'stdin control events must exist only when this launch has a usable stdin command channel',
  );
  const exitPromise = new Promise((resolveExit) => {
    child.once('exit', (code, signal) => resolveExit({ code, signal }));
  });
  child.kill('SIGTERM');
  const exit = await Promise.race([
    exitPromise,
    new Promise((_, rejectExit) => setTimeout(
      () => rejectExit(new Error('snapback dev --expo CLI did not join SIGTERM shutdown')),
      15_000,
    )),
  ]);
  assert.deepEqual(exit, { code: 0, signal: null }, stderr || stdoutBuffer);
  assert(events.some((event) => event.schemaVersion === 'snapback.expo-dev.v1'
    && event.state === 'closed'));
  assert.equal(existsSync(controlSocket.path), false);
  for (const pid of [
    metroPidBefore,
    ...intermediateMetroPids,
    reloadPreviousPid,
    reload[1].result.pid,
    reloadAfterStop[1].result.pid,
  ]) {
    await eventually(() => !processGroupAlive(pid), { label: `Metro cleanup for pid ${pid}` });
  }
  const metroProcessPort = Number(new URL(readyEvent.metro.upstreamOrigin).port);
  const portProbe = createNetServer();
  await new Promise((resolveListen, rejectListen) => {
    portProbe.once('error', rejectListen);
    portProbe.listen(metroProcessPort, '127.0.0.1', resolveListen);
  });
  await new Promise((resolveClose) => portProbe.close(resolveClose));
  return { events, readyEvent, listenerEvent, bearer: exchange.authority.token };
}

function expoCliArguments(target, {
  readyFile = target.readyFile,
  database = target.database,
} = {}) {
  return [
    'dev',
    target.backendRoot,
    '--expo',
    '--expo-platform', 'web',
    '--expo-dir', target.expoRoot,
    '--ready-file', readyFile,
    '--db', database,
    '--email', 'cli-lifecycle@expo-e1.test',
    '--expo-command', `${JSON.stringify(process.execPath)} ${JSON.stringify(metroScript)}`,
  ];
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

async function runHttpControlE1Suite() {
  const controlRoot = mkdtempSync('/tmp/sb-http-e1-');
  const target = fixture('http-control-app', { sessions: true, root: controlRoot });
  chmodSync(target.projectRoot, 0o775);
  const stopAtBarrier = deferred();
  const releaseStop = deferred();
  let holdStop = false;
  let run = null;
  try {
    run = await startFixture(target, {
      platform: 'web',
      controlSocket: true,
      requireControlCarrier: true,
      stdinControl: { available: false, kind: 'null', reason: 'stdin is /dev/null' },
      async beforeStopChildren({ requestId } = {}) {
        if (!holdStop || requestId !== 'http-stop-1') return;
        stopAtBarrier.resolve();
        await releaseStop.promise;
      },
    });
    const supervisorDescriptorPath = join(dirname(target.readyFile), 'expo-supervisor.json');
    const supervisorDescriptor = JSON.parse(readFileSync(supervisorDescriptorPath, 'utf8'));
    assert.equal(run.supervisor.controlSocket, null);
    assert.equal(supervisorDescriptor.controlSocket, null);
    const operatorToken = managedAdminToken(
      readReadyDescriptor(target.readyFile),
      target.database,
    );
    console.log('HTTP E1: supervisor ready');

    const unauthorized = await sendHttpControl(
      supervisorDescriptor,
      'wrong-operator-token',
      'reload-metro',
      'http-unauthorized-1',
      { origin: 'http://127.0.0.1:19006' },
    );
    assert.equal(unauthorized.status, 401);
    assert.equal(unauthorized.body.code, 'SNAPBACK_EXPO_CONTROL_UNAUTHORIZED');
    assert.equal(
      unauthorized.headers.get('access-control-allow-methods'),
      null,
      'the native operator-control POST must not inherit bootstrap GET CORS methods',
    );

    const unknown = await sendHttpControl(
      supervisorDescriptor,
      operatorToken,
      'recook',
      'http-unknown-1',
    );
    assert.equal(unknown.status, 400);
    assert.equal(unknown.body.code, 'SNAPBACK_EXPO_CONTROL_VERB_UNKNOWN');
    assert.deepEqual(unknown.body.supported, ['dev-fresh', 'reload-metro', 'stop-children']);
    console.log('HTTP E1: unauthorized and unknown verbs refused');

    const initialMetroPid = supervisorDescriptor.metro.pid;
    const reload = await sendHttpControl(
      supervisorDescriptor,
      operatorToken,
      'reload-metro',
      'http-reload-1',
    );
    assert.equal(reload.status, 200);
    assert.equal(reload.body.ok, true, JSON.stringify(reload.body));
    assert.equal(reload.body.requestId, 'http-reload-1');
    assert.equal(reload.body.previousPid, initialMetroPid);
    assert.notEqual(reload.body.pid, initialMetroPid);
    assert.equal(processGroupAlive(initialMetroPid), false);
    assert.equal(processGroupAlive(reload.body.pid), true);
    assert.equal(
      JSON.parse(readFileSync(supervisorDescriptorPath, 'utf8')).metro.pid,
      reload.body.pid,
      'HTTP reload-metro must publish the replacement Metro pid',
    );
    console.log('HTTP E1: reload-metro replaced Metro with correlated result');

    const backendPid = readReadyDescriptor(target.readyFile).pid;
    holdStop = true;
    const stopResponse = await Promise.race([
      sendHttpControl(
        supervisorDescriptor,
        operatorToken,
        'stop-children',
        'http-stop-1',
      ),
      new Promise((_, rejectStop) => setTimeout(
        () => rejectStop(new Error('HTTP stop-children did not flush its response before teardown')),
        5_000,
      )),
    ]);
    assert.equal(stopResponse.status, 200);
    assert.equal(stopResponse.body.ok, true, JSON.stringify(stopResponse.body));
    assert.equal(stopResponse.body.requestId, 'http-stop-1');
    assert.equal(stopResponse.body.verb, 'stop-children');
    assert.equal(stopResponse.body.state, 'acknowledged');
    console.log('HTTP E1: stop-children response flushed');
    await stopAtBarrier.promise;
    releaseStop.resolve();
    const stopped = await eventually(
      () => run.events.find((event) => (
        event.state === 'children-stopped' && event.requestId === 'http-stop-1'
      )),
      { label: 'HTTP stop-children effect after response flush' },
    );
    assert.equal(stopped.ok, true, JSON.stringify(stopped));
    console.log('HTTP E1: stop-children effect settled');
    await eventually(() => !processAlive(backendPid), { label: 'HTTP-stopped backend child' });
    await eventually(() => !processGroupAlive(reload.body.pid), { label: 'HTTP-stopped Metro child' });
    assert.equal(run.supervisor.controlSocket, null);
    assert.equal(run.supervisor.inspection().metro, null);
    console.log('HTTP E1: child process groups gone; HTTP-only owner remains');

    const afterStop = await sendHttpControl(
      supervisorDescriptor,
      operatorToken,
      'reload-metro',
      'http-reload-after-http-stop',
    );
    assert.equal(afterStop.status, 200);
    assert.equal(afterStop.body.ok, true, JSON.stringify(afterStop));
    assert.equal(afterStop.body.requestId, 'http-reload-after-http-stop');
    assert.equal(afterStop.body.previousPid, null);
    assert.equal(processGroupAlive(afterStop.body.pid), true);
    console.log('HTTP E1: token gate, refusal arms, correlated Metro effect, flushed stop, and HTTP-only owner reuse pass');
  } finally {
    releaseStop.resolve();
    if (run !== null) {
      await run.supervisor.close().catch(() => {});
      supervisors.splice(supervisors.indexOf(run.supervisor), 1);
    }
    rmSync(controlRoot, { recursive: true, force: true });
  }
}

async function runHttpReloadFailureDeliverySuite() {
  const root = mkdtempSync('/tmp/sb-http-reload-failure-');
  const target = fixture('http-reload-failure-app', { sessions: true, root });
  let run = null;
  try {
    run = await startFixture(target, {
      platform: 'web',
      env: {
        SNAPBACK_EXPO_TEST_METRO_LAUNCH_COUNT_FILE: join(target.stateRoot, 'metro-launch-count'),
        SNAPBACK_EXPO_TEST_METRO_FAIL_AFTER_FIRST: '1',
      },
    });
    const supervisorDescriptor = JSON.parse(readFileSync(
      join(dirname(target.readyFile), 'expo-supervisor.json'),
      'utf8',
    ));
    const operatorToken = managedAdminToken(readReadyDescriptor(target.readyFile), target.database);
    const response = await sendHttpControl(
      supervisorDescriptor,
      operatorToken,
      'reload-metro',
      'http-reload-failure-delivery',
    );
    assert.equal(response.status, 200);
    assert.equal(response.body.ok, false, JSON.stringify(response.body));
    assert.equal(response.body.state, 'metro-reload-failed');
    assert.equal(response.body.requestId, 'http-reload-failure-delivery');
    assert.equal(
      response.body.diagnostics?.[0]?.code,
      'SNAPBACK_EXPO_METRO_RELOAD_FAILED',
    );
    console.log('HTTP reload failure: ok:false response flushes before fatal supervisor close');
  } finally {
    if (run !== null) {
      await run.supervisor.close().catch(() => {});
      supervisors.splice(supervisors.indexOf(run.supervisor), 1);
    }
    rmSync(root, { recursive: true, force: true });
  }
}

async function runPackagedDualCleanupFailureSuite() {
  const supervisorCleanupFailure = new Error('injected supervisor cleanup failure');
  const stdin = new PassThrough();
  stdin.isTTY = true;
  stdin.setRawMode = () => {};
  let leaseDirectory = null;
  try {
    await assert.rejects(
      () => runCli(['dev', 'snapback', '--expo'], {
        env: {},
        stdin,
        async runExpoDev(options) {
          leaseDirectory = options.env[CLEANUP_LEASE_DIRECTORY_ENV];
          // Make the reaper observe graceful release while forcing the owner-side
          // `wx` publication of that release marker to fail deterministically.
          writeFileSync(join(leaseDirectory, 'release'), 'release\n', { flag: 'wx', mode: 0o600 });
          setImmediate(() => stdin.write('q'));
          return {
            ok: true,
            verbs: {},
            reportControlEvent() {},
            async close() { throw supervisorCleanupFailure; },
          };
        },
      }),
      (error) => {
        assert(error instanceof AggregateError);
        assert.equal(error.errors[0], supervisorCleanupFailure);
        assert.equal(error.errors[1]?.code, 'EEXIST');
        return true;
      },
    );
  } finally {
    stdin.destroy();
    if (leaseDirectory !== null) rmSync(leaseDirectory, { recursive: true, force: true });
  }
  console.log('packaged cleanup aggregation: supervisor and carrier cleanup failures both surface');
}

async function runStopChildrenFailureRetrySuite() {
  const controlRoot = mkdtempSync('/tmp/sb-stop-failure-');
  const target = fixture('stop-failure-app', { sessions: true, root: controlRoot });
  chmodSync(target.projectRoot, 0o700);
  const displacedReadyFile = `${target.readyFile}.stop-failure`;
  let run = null;
  let backendPid = null;
  try {
    run = await startFixture(target, {
      platform: 'web',
      controlSocket: true,
      beforeStopChildren({ requestId } = {}) {
        if (requestId !== 'fault-stop-1') return;
        renameSync(target.readyFile, displacedReadyFile);
        writeFileSync(target.readyFile, '{}\n', { mode: 0o600 });
      },
    });
    const controlSocket = run.supervisor.controlSocket;
    const supervisorDescriptorPath = join(dirname(target.readyFile), 'expo-supervisor.json');
    backendPid = readReadyDescriptor(target.readyFile).pid;
    const firstStop = await sendControlCommand(
      controlSocket,
      controlCommand(controlSocket, 'stop-children', 'fault-stop-1'),
    );
    assert.equal(firstStop.length, 2, JSON.stringify(firstStop));
    assert.equal(firstStop[1].ok, false, JSON.stringify(firstStop));
    assert.equal(firstStop[1].result?.state, 'children-stop-failed', JSON.stringify(firstStop));
    assert.equal(
      firstStop[1].result?.diagnostics?.[0]?.code,
      'SNAPBACK_EXPO_CHILD_STOP_FAILED',
      JSON.stringify(firstStop),
    );
    assert.equal(processAlive(backendPid), true, 'a refused native stop must retain its live backend');
    const failedDescriptor = JSON.parse(readFileSync(supervisorDescriptorPath, 'utf8'));
    assert.equal(failedDescriptor.state, 'children-stop-failed');
    assert.equal(failedDescriptor.metro, null);
    assert.equal(failedDescriptor.listeners.some(({ owner }) => owner === 'backend'), true);
    const failedInspection = run.supervisor.inspection();
    assert.equal(failedInspection.metro, null);
    assert.equal(failedInspection.listeners.some(({ owner }) => owner === 'backend'), true);

    rmSync(target.readyFile, { force: true });
    renameSync(displacedReadyFile, target.readyFile);
    const retry = await sendControlCommand(
      controlSocket,
      controlCommand(controlSocket, 'stop-children', 'fault-stop-retry'),
    );
    assert.equal(retry.length, 2, JSON.stringify(retry));
    assert.equal(retry[1].ok, true, JSON.stringify(retry));
    assert.equal(retry[1].result?.state, 'children-stopped', JSON.stringify(retry));
    await eventually(() => !processAlive(backendPid), { label: 'retried backend child stop' });
    assert.equal(
      JSON.parse(readFileSync(supervisorDescriptorPath, 'utf8')).state,
      'children-stopped',
    );
    console.log('stop-children failure: partial custody stays truthful and a coded retry reclaims the backend');
  } finally {
    if (existsSync(displacedReadyFile)) {
      rmSync(target.readyFile, { force: true });
      renameSync(displacedReadyFile, target.readyFile);
    }
    if (run !== null) {
      await run.supervisor.close().catch(() => {});
      supervisors.splice(supervisors.indexOf(run.supervisor), 1);
    }
    if (backendPid !== null && processAlive(backendPid) && existsSync(target.readyFile)) {
      spawnSync(runtimeBinary, ['stop', '--ready-file', target.readyFile], {
        cwd: target.projectRoot,
        env: process.env,
      });
      await eventually(() => !processAlive(backendPid), { label: 'fault-injection cleanup' });
    }
    rmSync(controlRoot, { recursive: true, force: true });
  }
}

async function runDelayedMetroExitAfterStopFailureSuite() {
  const controlRoot = mkdtempSync('/tmp/sb-metro-stop-race-');
  const target = fixture('metro-stop-race-app', { sessions: true, root: controlRoot });
  chmodSync(target.projectRoot, 0o700);
  let run = null;
  let injected = false;
  let delayedStop = Promise.resolve();
  try {
    run = await startFixture(target, {
      platform: 'web',
      controlSocket: true,
      async stopProcessGroup(child, options) {
        if (!injected && options?.processGroup === true) {
          injected = true;
          delayedStop = new Promise((resolveStop) => setTimeout(resolveStop, 250))
            .then(() => stopProcessGroup(child, options));
          const error = new Error('injected Metro process group survived SIGKILL');
          error.code = 'SNAPBACK_TEST_METRO_STOP_FAILED';
          throw error;
        }
        return stopProcessGroup(child, options);
      },
    });
    const supervisorDescriptorPath = join(dirname(target.readyFile), 'expo-supervisor.json');
    const initialDescriptor = JSON.parse(readFileSync(supervisorDescriptorPath, 'utf8'));
    const stopped = await sendControlCommand(
      run.supervisor.controlSocket,
      controlCommand(run.supervisor.controlSocket, 'stop-children', 'metro-stop-race-1'),
    );
    assert.equal(stopped[1]?.ok, false, JSON.stringify(stopped));
    assert.equal(stopped[1]?.result?.state, 'children-stop-failed', JSON.stringify(stopped));
    assert.equal(
      JSON.parse(readFileSync(supervisorDescriptorPath, 'utf8')).metro.pid,
      initialDescriptor.metro.pid,
      'a failed Metro stop must retain its live descriptor until the child exits',
    );
    await delayedStop;
    await eventually(
      () => !existsSync(supervisorDescriptorPath)
        || run.events.some((event) => event.state === 'closed'),
      { label: 'delayed Metro exit reconciliation after failed stop' },
    );
    assert.equal(processGroupAlive(initialDescriptor.metro.pid), false);
    console.log('delayed Metro exit: failed stop is not suppressed and the supervisor reconciles closed');
  } finally {
    await delayedStop.catch(() => {});
    if (run !== null) {
      await run.supervisor.close().catch(() => {});
      supervisors.splice(supervisors.indexOf(run.supervisor), 1);
    }
    rmSync(controlRoot, { recursive: true, force: true });
  }
}

async function runNonExpoCloseRetrySuite() {
  const controlRoot = mkdtempSync('/tmp/sb-backend-close-retry-');
  const target = fixture('backend-close-retry-app', { sessions: true, root: controlRoot });
  chmodSync(target.projectRoot, 0o700);
  const displacedReadyFile = `${target.readyFile}.retry`;
  const events = [];
  let dev = null;
  let detachInput = () => {};
  const input = new PassThrough();
  try {
    dev = await runDev({
      backendDirectory: target.backendRoot,
      projectRoot: target.projectRoot,
      readyFile: target.readyFile,
      database: target.database,
      runtimeBinary,
      watch: true,
      serverStdio: ['ignore', 'ignore', 'ignore'],
      onEvent(event) { events.push(event); },
    });
    const applicationReadyFile = dev.applicationReadyFile;
    assert.equal(existsSync(applicationReadyFile), true);
    detachInput = attachDevControlChannel({
      verbs: dev.verbs,
      stop() {},
      onEvent(event) { events.push(event); },
      stdin: input,
    });
    renameSync(target.readyFile, displacedReadyFile);
    writeFileSync(target.readyFile, '{}\n', { mode: 0o600 });
    const stopAttempt = dev.closeForExpoStopChildren();
    input.write(`${JSON.stringify({
      schemaVersion: 'snapback.dev-command.v1',
      verb: 'reload',
      requestId: 'reload-while-backend-stopping',
    })}\n`);
    const duringStop = await eventually(
      () => events.find((event) => event.requestId === 'reload-while-backend-stopping'),
      { timeoutMs: 3_000, label: 'coded stdin reload during retryable backend stop' },
    );
    assert.equal(
      duringStop.diagnostics?.[0]?.code,
      'SNAPBACK_DEV_CONTROL_BACKEND_STOPPING',
      JSON.stringify(duringStop),
    );
    await assert.rejects(
      stopAttempt,
      (error) => error?.code === 'SNAPBACK_DEV_SERVER_STOP_FAILED',
    );
    assert.equal(
      existsSync(applicationReadyFile),
      true,
      'a refused native stop must preserve the application-ready receipt',
    );

    rmSync(target.readyFile, { force: true });
    renameSync(displacedReadyFile, target.readyFile);
    const recoveredReload = await dev.verbs.reload({ requestId: 'reload-after-stop-refusal' });
    assert.equal(recoveredReload?.state, 'generated-and-loaded', JSON.stringify(recoveredReload));
    await dev.closeForExpoStopChildren();
    const afterStop = await dev.verbs.restart({ requestId: 'restart-after-backend-stop' });
    assert.equal(
      afterStop?.diagnostics?.[0]?.code,
      'SNAPBACK_DEV_CONTROL_BACKEND_STOPPED',
      JSON.stringify(afterStop),
    );
    console.log('non-Expo close retry: stdin is coded while stopping, refusal preserves custody, retry and stopped-state verbs settle');
  } finally {
    detachInput();
    input.destroy();
    if (existsSync(displacedReadyFile)) {
      rmSync(target.readyFile, { force: true });
      renameSync(displacedReadyFile, target.readyFile);
    }
    await dev?.close?.().catch(() => {});
    rmSync(controlRoot, { recursive: true, force: true });
  }
}

async function runPackagedControlOwnerSurvivalSuite() {
  const controlRoot = mkdtempSync('/tmp/sb-owner-e1-');
  let directRun = null;
  try {
    const directTarget = fixture('in-process-owner-app', { sessions: true, root: controlRoot });
    directRun = await startFixture(directTarget, { platform: 'web' });
    assert.equal(
      typeof directRun.supervisor.verbs['stop-children'],
      'function',
      'the in-process Expo lifecycle surface must expose serialized stop-children',
    );
    const stopped = await directRun.supervisor.verbs['stop-children']({
      requestId: 'in-process-stop-children',
    });
    assert.equal(stopped.ok, true, JSON.stringify(stopped));
    const respawned = await directRun.supervisor.verbs['reload-metro']({
      requestId: 'in-process-reload-after-stop',
    });
    assert.equal(respawned.ok, true, JSON.stringify(respawned));
    await directRun.supervisor.close();
    supervisors.splice(supervisors.indexOf(directRun.supervisor), 1);
    directRun = null;
    const target = fixture('packaged-owner-app', { sessions: true, root: controlRoot });
    const range = await reserveFreeRange(8);
    await runCliSupervisor(target, 'web', [
      '--port-range', `${range.lo}-${range.hi}`,
    ]);
    console.log('packaged owner: stop-children preserves owner/socket and later reload-metro respawns Metro');
  } finally {
    if (directRun !== null) {
      await directRun.supervisor.close().catch(() => {});
      supervisors.splice(supervisors.indexOf(directRun.supervisor), 1);
    }
    rmSync(controlRoot, { recursive: true, force: true });
  }
}

async function runPackagedHttpOnlyAfterStopSuite() {
  const controlRoot = mkdtempSync('/tmp/sb-http-only-packaged-');
  try {
    const target = fixture('packaged-http-only-app', { sessions: true, root: controlRoot });
    chmodSync(target.projectRoot, 0o775);
    mkdirSync(target.stateRoot, { recursive: true, mode: 0o700 });
    chmodSync(target.stateRoot, 0o700);
    const range = await reserveFreeRange(8);
    await runCliSupervisor(target, 'web', [
      '--port-range', `${range.lo}-${range.hi}`,
    ], { expectHttpFallback: true });
    console.log('packaged HTTP-only: 0775 + /dev/null reloads, stops, and respawns Metro without a socket');
  } finally {
    rmSync(controlRoot, { recursive: true, force: true });
  }
}

async function runControlSocketSuite() {
  const unavailableMessages = [
    {
      details: { component: '/tmp/project', reason: 'writable-component' },
      expected: /failed secure directory-chain admission \(writable-component\)/u,
      forbidden: /could not bind|advertised.*probe/iu,
    },
    {
      details: {
        component: '/tmp/state',
        reason: 'socket-bind-failed',
        cause: 'ENAMETOOLONG',
      },
      expected: /could not bind.*ENAMETOOLONG/iu,
      forbidden: /directory-chain admission|advertised.*probe/iu,
    },
    {
      details: {
        component: '/tmp/state',
        reason: 'advertised-path-probe-failed',
        cause: 'ETIMEDOUT',
      },
      expected: /advertised.*probe.*ETIMEDOUT/iu,
      forbidden: /directory-chain admission|could not bind/iu,
    },
  ];
  for (const { details, expected, forbidden } of unavailableMessages) {
    const diagnostic = expoDevTest.requiredDevControlChannelDiagnostic({
      unavailableDetails: details,
      stdinControl: { available: false, kind: 'null', reason: 'stdin is /dev/null' },
      readyFile: join(details.component, 'dev.ready.json'),
    });
    assert.equal(diagnostic.code, 'SNAPBACK_DEV_CONTROL_CHANNEL_UNAVAILABLE');
    assert.match(diagnostic.message, expected);
    assert.doesNotMatch(diagnostic.message, forbidden);
    assert.match(diagnostic.message, /--ready-file/u);
  }
  console.log('required control channel: chain, bind, and advertised-probe diagnostics stay distinct');

  const controlRoot = mkdtempSync('/tmp/sbctl-');
  const controlFixture = fixture('app', { sessions: true, root: controlRoot });
  const controlRange = await reserveFreeRange(8);
  try {
    const earlyControlFixture = fixture('early-control-app', { sessions: true, root: controlRoot });
    let earlyControlResult = null;
    const earlyControlRun = await startFixture(earlyControlFixture, {
      platform: 'web',
      controlSocket: true,
      async afterControlEndpointLeaseActivation({ path, ownerStatePath }) {
        const owner = JSON.parse(readFileSync(ownerStatePath, 'utf8'));
        const descriptor = {
          path,
          ownerPid: owner.ownerPid,
          ownerUid: owner.ownerUid,
          ownerIncarnationId: owner.ownerIncarnationId,
          lifecycleReceipt: owner.lifecycleReceipt,
        };
        earlyControlResult = await sendControlCommand(
          descriptor,
          controlCommand(descriptor, 'stop-children', 'early-stop'),
        );
        assert.equal(
          earlyControlResult.length,
          1,
          'stop-children during endpoint publication must be refused without acknowledgement',
        );
        assert.equal(
          earlyControlResult[0].diagnostics?.[0]?.code,
          'SNAPBACK_DEV_CONTROL_SOCKET_UNAVAILABLE',
        );
      },
    });
    const earlyReady = earlyControlRun.events.find((event) => event.state === 'ready');
    assert(earlyReady, 'the supervisor must reach ready after refusing an early control command');
    assert.equal(processAlive(earlyReady.backend.pid), true, 'the backend must remain live at ready');
    assert.equal(
      processGroupAlive(earlyReady.metro.pid),
      true,
      'Metro must remain live at ready after the early command refusal',
    );
    assert.equal(
      existsSync(join(dirname(earlyControlFixture.readyFile), 'expo-supervisor.json')),
      true,
    );
    await earlyControlRun.supervisor.close();
    supervisors.splice(supervisors.indexOf(earlyControlRun.supervisor), 1);
    console.log('endpoint publication: early stop-children is refused and live children reach ready');

    const lateExitFixture = fixture('late-exit-app', { sessions: true, root: controlRoot });
    mkdirSync(lateExitFixture.stateRoot, { recursive: true });
    chmodSync(lateExitFixture.stateRoot, 0o755);
    let injectReplacementExit = false;
    let replacementExitInjected = false;
    const lateExitRun = await startFixture(lateExitFixture, {
      platform: 'web',
      controlSocket: true,
      afterMetroReloadListenersVerified({ metro }) {
        if (!injectReplacementExit) return;
        replacementExitInjected = true;
        metro.child.emit('exit', 87, null);
      },
    });
    assert.equal(
      statSync(lateExitFixture.stateRoot).mode & 0o777,
      0o700,
      'an Expo owner publishing the control socket must tighten its ready-file directory',
    );
    const lateExitDescriptorPath = join(dirname(lateExitFixture.readyFile), 'expo-supervisor.json');
    const descriptorBeforeReload = statSync(lateExitDescriptorPath);
    const settledReload = await lateExitRun.supervisor.verbs['reload-metro']({
      requestId: 'atomic-descriptor-reload',
    });
    assert.equal(settledReload.ok, true, JSON.stringify(settledReload));
    const descriptorAfterReload = statSync(lateExitDescriptorPath);
    assert.notEqual(
      descriptorAfterReload.ino,
      descriptorBeforeReload.ino,
      'reload-metro must atomically replace the supervisor descriptor inode',
    );
    assert.equal(descriptorAfterReload.mode & 0o777, 0o600);
    injectReplacementExit = true;
    const lateExitReload = await lateExitRun.supervisor.verbs['reload-metro']({
      requestId: 'late-exit-reload',
    });
    assert.equal(replacementExitInjected, true);
    assert.equal(lateExitReload.ok, false, JSON.stringify(lateExitReload));
    assert.equal(
      lateExitReload.diagnostics?.[0]?.code,
      'SNAPBACK_EXPO_METRO_RELOAD_FAILED',
    );
    await eventually(() => !existsSync(lateExitDescriptorPath), {
      label: 'late-exit supervisor descriptor cleanup',
    });
    supervisors.splice(supervisors.indexOf(lateExitRun.supervisor), 1);

    const dispatcherFixture = fixture('dispatcher-overlap-app', {
      sessions: true,
      root: controlRoot,
    });
    let reloadAtDispatcherBarrier = deferred();
    let releaseDispatcherReload = deferred();
    const reloadAfterFreshStoppedPrevious = deferred();
    const releaseReloadAfterFresh = deferred();
    let holdDispatcherReload = false;
    let reloadAfterHttpDevFresh = null;
    let queueReloadAfterHttpDevFresh = false;
    const dispatcherRun = await startFixture(dispatcherFixture, {
      platform: 'web',
      controlSocket: true,
      async afterMetroReloadListenersVerified() {
        if (!holdDispatcherReload) return;
        reloadAtDispatcherBarrier.resolve();
        await releaseDispatcherReload.promise;
      },
      async afterMetroReloadPreviousStopped() {
        if (queueReloadAfterHttpDevFresh) return;
        if (reloadAfterHttpDevFresh === null) return;
        reloadAfterFreshStoppedPrevious.resolve();
        await releaseReloadAfterFresh.promise;
      },
      async beforeDevFreshExpoRefresh() {
        if (reloadAfterHttpDevFresh === null) return;
        await Promise.race([
          reloadAfterFreshStoppedPrevious.promise,
          new Promise((resolveWait) => setTimeout(resolveWait, 250)),
        ]);
      },
      onEvent(event) {
        if (!queueReloadAfterHttpDevFresh
            || event.state !== 'backend-event'
            || event.backend?.state !== 'generated-and-loaded'
            || event.backend?.verb !== 'dev-fresh') return;
        queueReloadAfterHttpDevFresh = false;
        reloadAfterHttpDevFresh = openControlCommand(
          dispatcherControl,
          controlCommand(
            dispatcherControl,
            'reload-metro',
            'reload-after-http-dev-fresh',
          ),
        );
      },
    });
    const dispatcherControl = dispatcherRun.supervisor.controlSocket;
    const dispatcherDescriptor = JSON.parse(readFileSync(
      join(dirname(dispatcherFixture.readyFile), 'expo-supervisor.json'),
      'utf8',
    ));
    await requestSupervisedMint(
      dispatcherRun.supervisor.exchangeOrigin,
      dispatcherRun.supervisor.metroOrigin,
    );
    let dispatcherOperatorToken = managedAdminToken(
      readReadyDescriptor(dispatcherFixture.readyFile),
      dispatcherFixture.database,
    );
    holdDispatcherReload = true;
    const dispatcherReload = openControlCommand(
      dispatcherControl,
      controlCommand(dispatcherControl, 'reload-metro', 'dispatcher-reload'),
    );
    await dispatcherReload.acknowledged;
    await reloadAtDispatcherBarrier.promise;
    let httpDevFreshSettled = false;
    const httpDevFresh = fetch(
      `${dispatcherDescriptor.exchangeOrigin}${dispatcherDescriptor.controlPath}`,
      {
        method: 'POST',
        headers: {
          'content-type': 'application/json',
          'x-snapback-operator-token': dispatcherOperatorToken,
        },
        body: JSON.stringify({
          verb: 'dev-fresh',
          requestId: 'http-dev-fresh-overlap',
        }),
      },
    ).then(async (response) => {
      const body = await response.json();
      httpDevFreshSettled = true;
      return { status: response.status, body };
    });
    let receiptMissingWhileReloadBlocked = false;
    const overlapDeadline = Date.now() + 500;
    while (Date.now() < overlapDeadline) {
      if (!existsSync(`${dispatcherFixture.readyFile}.application-ready`)) {
        receiptMissingWhileReloadBlocked = true;
        break;
      }
      await new Promise((resolveWait) => setTimeout(resolveWait, 10));
    }
    const httpSettledWhileReloadBlocked = httpDevFreshSettled;
    releaseDispatcherReload.resolve();
    const [dispatcherReloadMessages, httpDevFreshResult] = await Promise.all([
      dispatcherReload.completion,
      httpDevFresh,
    ]);
    dispatcherOperatorToken = null;
    assert.equal(
      receiptMissingWhileReloadBlocked,
      false,
      'HTTP dev-fresh must remain queued while an acknowledged socket reload owns the dispatcher lane',
    );
    assert.equal(
      httpSettledWhileReloadBlocked,
      false,
      'HTTP dev-fresh must not settle before the acknowledged socket reload releases the lane',
    );
    assert.equal(dispatcherReloadMessages.at(-1)?.ok, true, JSON.stringify(dispatcherReloadMessages));
    assert.equal(httpDevFreshResult.status, 200);
    assert.equal(httpDevFreshResult.body.ok, true, JSON.stringify(httpDevFreshResult.body));
    assert.equal(httpDevFreshResult.body.requestId, 'http-dev-fresh-overlap');
    const authorityReplacementCount = dispatcherRun.events.filter(
      (event) => event.state === 'authority-replaced',
    ).length;
    queueReloadAfterHttpDevFresh = true;
    const httpDevFreshBeforeReload = fetch(
      `${dispatcherDescriptor.exchangeOrigin}${dispatcherDescriptor.controlPath}`,
      {
        method: 'POST',
        headers: {
          'content-type': 'application/json',
          'x-snapback-operator-token': managedAdminToken(
            readReadyDescriptor(dispatcherFixture.readyFile),
            dispatcherFixture.database,
          ),
        },
        body: JSON.stringify({
          verb: 'dev-fresh',
          requestId: 'http-dev-fresh-before-reload',
        }),
      },
    ).then(async (response) => ({ status: response.status, body: await response.json() }));
    await eventually(
      () => reloadAfterHttpDevFresh,
      { label: 'socket Metro reload queued from HTTP dev-fresh generated-and-loaded boundary' },
    );
    await reloadAfterHttpDevFresh.acknowledged;
    const httpBeforeReloadResult = await httpDevFreshBeforeReload;
    await reloadAfterFreshStoppedPrevious.promise;
    releaseReloadAfterFresh.resolve();
    const reloadAfterFreshMessages = await reloadAfterHttpDevFresh.completion;
    assert.equal(httpBeforeReloadResult.status, 200);
    assert.equal(
      httpBeforeReloadResult.body.ok,
      true,
      JSON.stringify(httpBeforeReloadResult.body),
    );
    assert.equal(
      reloadAfterFreshMessages.at(-1)?.ok,
      true,
      JSON.stringify(reloadAfterFreshMessages),
    );
    assert.equal(
      dispatcherRun.events.filter((event) => event.state === 'authority-replaced').length,
      authorityReplacementCount + 1,
      'HTTP dev-fresh must remint authority before the queued socket reload runs',
    );
    const remintIndex = dispatcherRun.events.findIndex(
      (event, index) => index >= 0
        && event.state === 'authority-replaced'
        && index > dispatcherRun.events.findIndex(
          (candidate) => candidate.backend?.requestId === 'http-dev-fresh-before-reload',
        ),
    );
    const reloadIndex = dispatcherRun.events.findIndex(
      (event) => event.state === 'metro-reloaded'
        && event.requestId === 'reload-after-http-dev-fresh',
    );
    assert(remintIndex !== -1 && reloadIndex !== -1 && remintIndex < reloadIndex);
    reloadAtDispatcherBarrier = deferred();
    releaseDispatcherReload = deferred();
    holdDispatcherReload = true;
    const reloadBeforeStopping = openControlCommand(
      dispatcherControl,
      controlCommand(dispatcherControl, 'reload-metro', 'reload-before-stopping'),
    );
    await reloadBeforeStopping.acknowledged;
    await reloadAtDispatcherBarrier.promise;
    const stopForHttpRefusal = openControlCommand(
      dispatcherControl,
      controlCommand(dispatcherControl, 'stop-children', 'stop-for-http-refusal'),
    );
    await stopForHttpRefusal.acknowledged;
    const stoppingOperatorToken = managedAdminToken(
      readReadyDescriptor(dispatcherFixture.readyFile),
      dispatcherFixture.database,
    );
    const stoppingResponse = await fetch(
      `${dispatcherDescriptor.exchangeOrigin}${dispatcherDescriptor.controlPath}`,
      {
        method: 'POST',
        headers: {
          'content-type': 'application/json',
          'x-snapback-operator-token': stoppingOperatorToken,
        },
        body: JSON.stringify({
          verb: 'dev-fresh',
          requestId: 'http-dev-fresh-while-stopping',
        }),
      },
    );
    const stoppingBody = await stoppingResponse.json();
    assert.equal(stoppingResponse.status, 200);
    assert.equal(stoppingBody.ok, false);
    assert.equal(stoppingBody.requestId, 'http-dev-fresh-while-stopping');
    assert.equal(stoppingBody.diagnostics?.[0]?.code, 'SNAPBACK_DEV_CONTROL_STOPPING');
    holdDispatcherReload = false;
    releaseDispatcherReload.resolve();
    const [reloadBeforeStoppingMessages, stopForHttpRefusalMessages] = await Promise.all([
      reloadBeforeStopping.completion,
      stopForHttpRefusal.completion,
    ]);
    assert.equal(reloadBeforeStoppingMessages.at(-1)?.ok, true);
    assert.equal(stopForHttpRefusalMessages.at(-1)?.ok, true);
    await dispatcherRun.supervisor.close();
    supervisors.splice(supervisors.indexOf(dispatcherRun.supervisor), 1);
    console.log('control dispatcher: HTTP dev-fresh serializes both ways and returns coded stopping refusal');

    const ignoredStdinFixture = fixture('ignored-stdin-app', { sessions: true, root: controlRoot });
    const ignoredStdinRange = await reserveFreeRange(8);
    await runCliSupervisor(ignoredStdinFixture, 'web', [
      '--port-range', `${ignoredStdinRange.lo}-${ignoredStdinRange.hi}`,
    ], { stubbornMetroDuringReload: true, expectNoStdinControlReady: true });
    const groupWritableFixture = fixture('group-writable-project', {
      sessions: true,
      root: controlRoot,
    });
    chmodSync(groupWritableFixture.projectRoot, 0o775);
    mkdirSync(groupWritableFixture.stateRoot, { recursive: true, mode: 0o700 });
    chmodSync(groupWritableFixture.stateRoot, 0o700);
    const groupWritableRefusalRange = await reserveFreeRange(8);
    await runCliSupervisor(groupWritableFixture, 'web', [
      '--port-range', `${groupWritableRefusalRange.lo}-${groupWritableRefusalRange.hi}`,
    ], {
      expectHttpFallback: true,
    });

    const groupWritableExternalState = join(controlRoot, 'group-writable-external-state');
    mkdirSync(groupWritableExternalState, { mode: 0o700 });
    chmodSync(groupWritableExternalState, 0o700);
    const groupWritableExternalTarget = {
      ...groupWritableFixture,
      readyFile: join(groupWritableExternalState, 'dev.ready.json'),
    };
    const groupWritableExternalRange = await reserveFreeRange(8);
    await runCliSupervisor(groupWritableExternalTarget, 'web', [
      '--port-range', `${groupWritableExternalRange.lo}-${groupWritableExternalRange.hi}`,
    ]);
    console.log('group-writable project: authenticated HTTP survives socket loss; no-token triple loss refuses; external 0700 ready tree publishes a socket');
    const customReadyFixture = fixture('custom-ready-app', { sessions: true, root: controlRoot });
    const customReadyParent = join(customReadyFixture.projectRoot, 'caller-ready-state');
    mkdirSync(customReadyParent, { mode: 0o755 });
    chmodSync(customReadyParent, 0o755);
    const customReadyTarget = {
      ...customReadyFixture,
      readyFile: join(customReadyParent, 'dev.ready.json'),
    };
    const closedPipeRange = await reserveFreeRange(8);
    await runCliSupervisor(customReadyTarget, 'web', [
      '--port-range', `${closedPipeRange.lo}-${closedPipeRange.hi}`,
    ], {
      closeStdinImmediately: true,
      expectHttpFallback: true,
      expectNoStdinControlReady: true,
    });
    const customReadyRange = await reserveFreeRange(8);
    await runCliSupervisor(customReadyTarget, 'web', [
      '--port-range', `${customReadyRange.lo}-${customReadyRange.hi}`,
    ], { expectControlUnavailable: true, assertStdinReload: true });
    assert.equal(
      statSync(customReadyParent).mode & 0o777,
      0o755,
      'the packaged CLI must not chmod a caller-selected ready-file parent',
    );
    const chainFixture = fixture('chain-app', { sessions: true, root: controlRoot });
    mkdirSync(chainFixture.stateRoot, { recursive: true, mode: 0o700 });
    const outsideChainRoot = join(controlRoot, 'outside-chain');
    const outsideChainState = join(outsideChainRoot, 'state');
    mkdirSync(outsideChainState, { recursive: true, mode: 0o755 });
    chmodSync(outsideChainState, 0o755);
    symlinkSync(outsideChainRoot, join(chainFixture.stateRoot, 'link'), 'dir');
    const chainTarget = {
      ...chainFixture,
      readyFile: join(chainFixture.stateRoot, 'link', 'state', 'dev.ready.json'),
    };
    const chainRange = await reserveFreeRange(8);
    await runCliSupervisor(chainTarget, 'web', [
      '--port-range', `${chainRange.lo}-${chainRange.hi}`,
    ], { expectControlUnavailable: true });
    assert.equal(
      statSync(outsideChainState).mode & 0o777,
      0o755,
      'managed-state lexical containment must not chmod through an intermediate symlink',
    );
    const longStateFixture = fixture(`long-state-${'x'.repeat(100)}`, {
      sessions: true,
      root: controlRoot,
    });
    const longStateExternalReadyParent = join(controlRoot, 'long-state-external-ready');
    mkdirSync(longStateExternalReadyParent, { mode: 0o700 });
    chmodSync(longStateExternalReadyParent, 0o700);
    const longStateTarget = {
      ...longStateFixture,
      readyFile: join(longStateExternalReadyParent, 'dev.ready.json'),
    };
    const longStateRange = await reserveFreeRange(8);
    const longStateRun = await runCliSupervisor(longStateTarget, 'web', [
      '--port-range', `${longStateRange.lo}-${longStateRange.hi}`,
    ]);
    assert.equal(
      longStateRun.events.some((event) => event.state === 'control-socket-unavailable'),
      false,
      'a long checkout must publish control through an external owner-only ready-file directory',
    );
    assert.equal(
      longStateRun.readyEvent.controlSocket.path,
      join(realpathSync.native(longStateExternalReadyParent), '.dc-sock'),
      'a literal /tmp ready-file spelling must publish the canonical socket path',
    );
    console.log('external /tmp spelling: /dev/null owner acknowledges reload-metro on the canonical socket');
    const controlRun = await runCliSupervisor(controlFixture, 'web', [
      '--port-range', `${controlRange.lo}-${controlRange.hi}`,
    ], {
      assertStdinRestartBeforeSocketReload: true,
      assertConcurrentStdinSocketReload: true,
    });
    assert.equal(controlRun.readyEvent.platform, 'web');
    const failureFixture = fixture('failure-app', { sessions: true, root: controlRoot });
    const failureRange = await reserveFreeRange(8);
    await runCliSupervisor(failureFixture, 'web', [
      '--port-range', `${failureRange.lo}-${failureRange.hi}`,
    ], {
      assertStdinReload: true,
      failMetroReload: true,
    });
    console.log('expo-dev-loop.test.mjs: closed-pipe HTTP fallback, open-pipe stdin reload fallback, --json /dev/null default control posture, long-project external ready path, socket concurrency, reload failure, stdin stopping latch, refusals, and cleanup pass');
  } finally {
    rmSync(controlRoot, { recursive: true, force: true });
  }
}

async function runNoTokenCarrierRefusalSuite() {
  const root = mkdtempSync('/tmp/sbnotoken-');
  try {
    const secureTarget = fixture('secure-no-token-project', { sessions: true, root });
    chmodSync(secureTarget.projectRoot, 0o700);
    mkdirSync(secureTarget.stateRoot, { recursive: true, mode: 0o700 });
    chmodSync(secureTarget.stateRoot, 0o700);
    let removedTokenFile = null;
    const secureRun = await startFixture(secureTarget, {
      platform: 'web',
      controlSocket: true,
      requireControlCarrier: true,
      stdinControl: {
        available: false,
        kind: 'empty-regular-file',
        reason: 'stdin regular file reached EOF before control-channel startup',
      },
      beforeReadinessPublish() {
        const descriptor = JSON.parse(readFileSync(secureTarget.readyFile, 'utf8'));
        removedTokenFile = descriptor.adminTokenFile;
        delete descriptor.adminTokenFile;
        writeFileSync(secureTarget.readyFile, `${JSON.stringify(descriptor, null, 2)}\n`);
        if (typeof removedTokenFile === 'string') rmSync(removedTokenFile, { force: true });
      },
    });
    try {
      const supervisorDescriptorPath = join(
        dirname(secureTarget.readyFile),
        'expo-supervisor.json',
      );
      const supervisorDescriptor = JSON.parse(readFileSync(supervisorDescriptorPath, 'utf8'));
      const controlSocket = secureRun.supervisor.controlSocket;
      assert.equal(managedAdminToken(readReadyDescriptor(secureTarget.readyFile), secureTarget.database), null);
      assert.equal(typeof removedTokenFile === 'string' && existsSync(removedTokenFile), false);
      assert.deepEqual(supervisorDescriptor.controlSocket, controlSocket);
      assert.equal(controlSocket?.schemaVersion, 'snapback.dev-control.v1');

      const httpRefusal = await sendHttpControl(
        supervisorDescriptor,
        'removed-token-carrier',
        'reload-metro',
        'no-token-http-refusal',
      );
      assert.equal(httpRefusal.status, 401);
      assert.equal(httpRefusal.body.code, 'SNAPBACK_EXPO_CONTROL_UNAUTHORIZED');

      const initialMetroPid = supervisorDescriptor.metro.pid;
      const reload = await sendControlCommand(
        controlSocket,
        controlCommand(controlSocket, 'reload-metro', 'no-token-socket-reload'),
      );
      assert.equal(reload.length, 2, JSON.stringify(reload));
      assert.equal(reload[1].ok, true, JSON.stringify(reload));
      assert.equal(reload[1].result?.requestId, 'no-token-socket-reload');
      assert.equal(reload[1].result?.previousPid, initialMetroPid);
      assert.notEqual(reload[1].result?.pid, initialMetroPid);
      assert.equal(processGroupAlive(initialMetroPid), false);
      assert.equal(processGroupAlive(reload[1].result?.pid), true);
      assert.equal(
        JSON.parse(readFileSync(supervisorDescriptorPath, 'utf8')).metro.pid,
        reload[1].result?.pid,
      );
      console.log('no-token carrier: secure owner socket publishes and correlated reload-metro works while HTTP refuses');
    } finally {
      await secureRun.supervisor.close().catch(() => {});
      supervisors.splice(supervisors.indexOf(secureRun.supervisor), 1);
    }

    const target = fixture('group-writable-no-token-project', { sessions: true, root });
    chmodSync(target.projectRoot, 0o775);
    mkdirSync(target.stateRoot, { recursive: true, mode: 0o700 });
    chmodSync(target.stateRoot, 0o700);
    await assert.rejects(
      startFixture(target, {
        platform: 'web',
        controlSocket: true,
        requireControlCarrier: true,
        stdinControl: {
          available: false,
          kind: 'empty-regular-file',
          reason: 'stdin regular file reached EOF before control-channel startup',
        },
        beforeReadinessPublish() {
          const descriptor = JSON.parse(readFileSync(target.readyFile, 'utf8'));
          const adminTokenFile = descriptor.adminTokenFile;
          delete descriptor.adminTokenFile;
          writeFileSync(target.readyFile, `${JSON.stringify(descriptor, null, 2)}\n`);
          if (typeof adminTokenFile === 'string') rmSync(adminTokenFile, { force: true });
        },
      }),
      (error) => error?.diagnostic?.code === 'SNAPBACK_DEV_CONTROL_CHANNEL_UNAVAILABLE',
      'no managed token, unusable stdin, and an unavailable socket must refuse startup',
    );
    console.log('unavailable carrier refusal: no token + stdin EOF + no socket refuses startup');
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
}

async function runUnreadableDeclaredTokenSuite(kind) {
  const root = mkdtempSync(`/tmp/sbunreadable-${kind}-`);
  let run = null;
  try {
    const target = fixture(`${kind}-token-project`, { sessions: true, root });
    chmodSync(target.projectRoot, 0o700);
    mkdirSync(target.stateRoot, { recursive: true, mode: 0o700 });
    chmodSync(target.stateRoot, 0o700);
    run = await startFixture(target, {
      platform: 'web',
      controlSocket: true,
      requireControlCarrier: true,
      stdinControl: {
        available: false,
        kind: 'empty-regular-file',
        reason: 'stdin regular file reached EOF before control-channel startup',
      },
      beforeReadinessPublish() {
        const descriptor = JSON.parse(readFileSync(target.readyFile, 'utf8'));
        const tokenFile = descriptor.adminTokenFile;
        assert.equal(typeof tokenFile, 'string');
        if (kind === 'missing') rmSync(tokenFile, { force: true });
        else chmodSync(tokenFile, 0o644);
      },
    });
    const unavailable = run.events.find((event) => event.state === 'http-control-unavailable');
    assert.equal(
      unavailable?.diagnostics?.[0]?.code,
      'SNAPBACK_DEV_ADMIN_TOKEN_FILE_INVALID',
      `${kind} declared admin-token file must log its coded HTTP-control refusal`,
    );
    assert.equal(run.supervisor.controlSocket?.schemaVersion, 'snapback.dev-control.v1');
    const reload = await sendControlCommand(
      run.supervisor.controlSocket,
      controlCommand(run.supervisor.controlSocket, 'reload-metro', `${kind}-token-reload`),
    );
    assert.equal(reload.at(-1)?.ok, true, JSON.stringify(reload));
    console.log(`${kind} declared token: coded HTTP refusal falls through to the owner socket`);
  } finally {
    if (run !== null) {
      await run.supervisor.close().catch(() => {});
      supervisors.splice(supervisors.indexOf(run.supervisor), 1);
    }
    rmSync(root, { recursive: true, force: true });
  }
}

async function runUnavailableStdinAdvertisementSuite() {
  const emptyInputPath = join(scratchRoot, 'unavailable-empty-control-input.jsonl');
  writeFileSync(emptyInputPath, '');
  const cases = [
    ['null-device', () => createReadStream('/dev/null')],
    ['empty-regular-file', () => createReadStream(emptyInputPath)],
  ];
  const advertised = [];
  for (const [label, makeInput] of cases) {
    const input = makeInput();
    if (Number.isInteger(input.fd) === false && typeof input.once === 'function') {
      await new Promise((resolveOpen, rejectOpen) => {
        input.once('open', resolveOpen);
        input.once('error', rejectOpen);
      });
    }
    const events = [];
    const abort = new AbortController();
    const exitCode = await runCli(['dev', 'snapback', '--expo', '--json'], {
      cwd: scratchRoot,
      stdin: input,
      signal: abort.signal,
      async runExpoDev(options) {
        assert.equal(options.stdinControl.available, false, label);
        setImmediate(() => abort.abort());
        return {
          ok: true,
          verbs: {},
          reportControlEvent(event) { events.push(event); },
          async close() {},
        };
      },
    });
    assert.equal(exitCode, 0);
    advertised.push(...events
      .filter((event) => event.state === 'control-ready')
      .map((event) => `${label}:${event.channel}`));
    input.destroy();
  }
  assert.deepEqual(
    advertised,
    [],
    'unavailable stdin inputs must not advertise a JSON control channel',
  );
  console.log('/dev/null and empty-file stdin do not advertise control-ready');
}

async function runRegularFileControlInputSuite() {
  const emptyInputPath = join(scratchRoot, 'empty-control-input.jsonl');
  writeFileSync(emptyInputPath, '');
  const emptyInput = createReadStream(emptyInputPath);
  await new Promise((resolveOpen, rejectOpen) => {
    emptyInput.once('open', resolveOpen);
    emptyInput.once('error', rejectOpen);
  });
  await assert.rejects(
    runCli(['dev', 'snapback', '--expo', '--json'], {
      cwd: scratchRoot,
      stdin: emptyInput,
      async runExpoDev(options) {
        assert.deepEqual(options.stdinControl, {
          available: false,
          kind: 'empty-regular-file',
          reason: 'stdin regular file reached EOF before control-channel startup',
        });
        assert.equal(
          options.requireControlCarrier,
          true,
          'an empty regular stdin file must require another detached control carrier',
        );
        const error = new Error('no authenticated HTTP route or owner-bound socket');
        error.diagnostic = {
          code: 'SNAPBACK_DEV_CONTROL_CHANNEL_UNAVAILABLE',
          severity: 'error',
          subsystem: 'cli',
          message: error.message,
        };
        throw error;
      },
    }),
    (error) => error?.diagnostic?.code === 'SNAPBACK_DEV_CONTROL_CHANNEL_UNAVAILABLE',
  );

  const commandInputPath = join(scratchRoot, 'regular-control-input.jsonl');
  writeFileSync(commandInputPath, `${JSON.stringify({
    schemaVersion: 'snapback.dev-command.v1',
    verb: 'reload-metro',
    requestId: 'regular-file-reload-1',
  })}\n`);
  const commandInput = createReadStream(commandInputPath);
  await new Promise((resolveOpen, rejectOpen) => {
    commandInput.once('open', resolveOpen);
    commandInput.once('error', rejectOpen);
  });
  const abort = new AbortController();
  let invoked = null;
  let closed = false;
  const exitCode = await runCli(['dev', 'snapback', '--expo', '--json'], {
    cwd: scratchRoot,
    stdin: commandInput,
    signal: abort.signal,
    async runExpoDev(options) {
      assert.deepEqual(options.stdinControl, {
        available: true,
        kind: 'regular-file-command-channel',
      });
      assert.equal(options.requireControlCarrier, false);
      return {
        ok: true,
        verbs: {
          async 'reload-metro'(context) {
            invoked = context;
            abort.abort();
          },
        },
        reportControlEvent() {},
        async close() { closed = true; },
      };
    },
  });
  assert.equal(exitCode, 0);
  assert.deepEqual(invoked, { requestId: 'regular-file-reload-1' });
  assert.equal(closed, true);
  console.log('regular-file stdin: empty EOF requires another carrier; buffered JSON command executes');
}

try {
  if (metroStopRaceOnly) {
    await runDelayedMetroExitAfterStopFailureSuite();
  } else if (backendCloseRetryOnly) {
    await runNonExpoCloseRetrySuite();
  } else if (stopFailureOnly) {
    await runStopChildrenFailureRetrySuite();
    await runDelayedMetroExitAfterStopFailureSuite();
    await runNonExpoCloseRetrySuite();
  } else if (httpControlOnly) {
    await runHttpControlE1Suite();
    await runHttpReloadFailureDeliverySuite();
    await runPackagedHttpOnlyAfterStopSuite();
  } else if (noTokenCarrierOnly) {
    await runNoTokenCarrierRefusalSuite();
    await runUnreadableDeclaredTokenSuite('missing');
    await runUnreadableDeclaredTokenSuite('loose');
  } else if (regularFileOnly) {
    await runUnavailableStdinAdvertisementSuite();
    await runRegularFileControlInputSuite();
  } else if (controlOwnerSurvivalOnly) {
    await runPackagedControlOwnerSurvivalSuite();
  } else if (controlSocketOnly) {
    await runPackagedDualCleanupFailureSuite();
    await runHttpControlE1Suite();
    await runHttpReloadFailureDeliverySuite();
    await runStopChildrenFailureRetrySuite();
    await runDelayedMetroExitAfterStopFailureSuite();
    await runNonExpoCloseRetrySuite();
    await runNoTokenCarrierRefusalSuite();
    await runRegularFileControlInputSuite();
    await runControlSocketSuite();
  } else {
  // The package-default suite owns the E1 no-TTY witness too; CI cannot green
  // by running only the broader lifecycle cases below.
  await runHttpControlE1Suite();
  await runHttpReloadFailureDeliverySuite();
  await runPackagedDualCleanupFailureSuite();
  await runStopChildrenFailureRetrySuite();
  await runDelayedMetroExitAfterStopFailureSuite();
  await runNonExpoCloseRetrySuite();
  await runNoTokenCarrierRefusalSuite();
  await runUnreadableDeclaredTokenSuite('missing');
  await runUnreadableDeclaredTokenSuite('loose');
  await runUnavailableStdinAdvertisementSuite();
  await runRegularFileControlInputSuite();
  await runControlSocketSuite();
  let largeUpstreamCancelled = false;
  let largeUpstreamBytes = 0;
  const largeUpstreamTotal = 16 * 1024 * 1024;
  const proxyUpstream = createHttpServer((request, response) => {
    if (request.url === '/large') {
      response.writeHead(200, {
        'content-type': 'application/octet-stream',
        'content-length': String(largeUpstreamTotal),
      });
      const chunk = Buffer.alloc(64 * 1024, 0x61);
      const pump = () => {
        while (largeUpstreamBytes < largeUpstreamTotal) {
          largeUpstreamBytes += chunk.length;
          if (!response.write(chunk)) return;
        }
        response.end();
      };
      response.on('drain', pump);
      response.on('close', () => {
        if (!response.writableEnded) largeUpstreamCancelled = true;
      });
      pump();
      return;
    }
    response.end('proxy survived\n');
  });
  proxyUpstream.on('upgrade', (request, socket) => {
    assert.equal(request.url, '/hot');
    socket.write([
      'HTTP/1.1 101 Switching Protocols',
      'Connection: Upgrade',
      'Upgrade: websocket',
      '',
      '',
    ].join('\r\n'));
    setTimeout(() => {
      if (typeof socket.resetAndDestroy === 'function') socket.resetAndDestroy();
      else socket.destroy();
    }, 10);
  });
  await new Promise((resolveListen, rejectListen) => {
    proxyUpstream.once('error', rejectListen);
    proxyUpstream.listen(0, '127.0.0.1', resolveListen);
  });
  const proxyUpstreamPort = proxyUpstream.address().port;
  const metroFront = await expoDevTest.startMetroWebFront({
    port: 0,
    upstreamOrigin: `http://127.0.0.1:${proxyUpstreamPort}`,
    attestation: { serve: () => false },
  });
  try {
    let upgradeBytes = '';
    await new Promise((resolveClose, rejectClose) => {
      const socket = createConnection(Number(new URL(metroFront.origin).port), '127.0.0.1');
      socket.setEncoding('utf8');
      socket.on('data', (chunk) => { upgradeBytes += chunk; });
      socket.once('connect', () => socket.write([
        'GET /hot HTTP/1.1',
        `Host: 127.0.0.1:${new URL(metroFront.origin).port}`,
        'Connection: Upgrade',
        'Upgrade: websocket',
        'Sec-WebSocket-Key: c25hcGJhY2staG90LXJlc2V0',
        'Sec-WebSocket-Version: 13',
        '',
        '',
      ].join('\r\n')));
      socket.once('error', (error) => {
        if (error?.code === 'ECONNRESET') resolveClose();
        else rejectClose(error);
      });
      socket.once('close', resolveClose);
    });
    assert.match(upgradeBytes, /^HTTP\/1\.1 101/u);
    assert.equal(await (await fetch(`${metroFront.origin}/after-hot-reset`)).text(), 'proxy survived\n');

    await new Promise((resolveCancelled, rejectCancelled) => {
      const client = createHttpRequest(`${metroFront.origin}/large`, (response) => {
        response.once('data', () => {
          response.destroy();
          client.destroy();
          resolveCancelled();
        });
        response.once('error', (error) => {
          if (error?.code === 'ECONNRESET' || error?.code === 'ABORT_ERR') resolveCancelled();
          else rejectCancelled(error);
        });
      });
      client.once('error', (error) => {
        if (error?.code === 'ECONNRESET' || error?.code === 'ABORT_ERR') resolveCancelled();
        else rejectCancelled(error);
      });
      client.end();
    });
    await eventually(() => largeUpstreamCancelled, {
      label: 'cancelled large response aborts Metro upstream',
    });
    assert(largeUpstreamBytes < largeUpstreamTotal);
    assert.equal(await (await fetch(`${metroFront.origin}/after-large-cancel`)).text(), 'proxy survived\n');
  } finally {
    await metroFront.close();
    await new Promise((resolveClose) => proxyUpstream.close(resolveClose));
  }

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

  // LLP 0299: all three public pins are strict and their provenance is
  // projected consistently through the event, descriptor, handle, and
  // inspection surfaces. Metro remains the unpinned internal web upstream.
  const pinnedPorts = await reserveFreeRange(3);
  const pinned = fixture('pinned-ports', { sessions: true });
  const pinnedRun = await startFixture(pinned, {
    platform: 'web',
    devOptions: { port: pinnedPorts.lo },
    clientPort: pinnedPorts.lo + 1,
    bootstrapPort: pinnedPorts.lo + 2,
  });
  const pinnedSupervisor = pinnedRun.supervisor;
  assert.equal(new URL(pinnedSupervisor.binding.target.origin).port, String(pinnedPorts.lo));
  assert.equal(new URL(pinnedSupervisor.metroOrigin).port, String(pinnedPorts.lo + 1));
  assert.equal(new URL(pinnedSupervisor.exchangeOrigin).port, String(pinnedPorts.lo + 2));
  const pinnedOwners = Object.fromEntries(
    pinnedSupervisor.portPlan.owners.map((entry) => [entry.owner, entry]),
  );
  for (const owner of ['backend', 'client', 'bootstrap']) {
    assert.equal(pinnedOwners[owner].source, 'pinned');
    assert.equal(pinnedOwners[owner].declaredBy, 'flag');
  }
  const pinnedReady = pinnedRun.events.find((event) => event.state === 'ready');
  assert.deepEqual(pinnedReady.portPlan, pinnedSupervisor.portPlan);
  assert.deepEqual(
    pinnedSupervisor.applicationReady.clientOrigins,
    expoBackendClientOrigins(pinnedPorts.lo + 1),
  );
  const pinnedDescriptor = JSON.parse(readFileSync(
    join(dirname(pinned.readyFile), 'expo-supervisor.json'),
    'utf8',
  ));
  assert.deepEqual(pinnedDescriptor.portPlan, pinnedSupervisor.portPlan);
  assert.deepEqual(pinnedSupervisor.inspection().portPlan, pinnedSupervisor.portPlan);
  await pinnedSupervisor.close();
  supervisors.splice(supervisors.indexOf(pinnedSupervisor), 1);
  await eventually(() => !existsSync(pinned.readyFile), { label: 'pinned ready-file cleanup' });

  // A held client pin refuses before either child can write its first startup
  // artifact, and lsof attributes this process without authorizing adoption
  // or a signal.
  const occupiedPort = (await reserveFreeRange(1)).lo;
  const occupiedServer = createNetServer();
  await new Promise((resolveListen, rejectListen) => {
    occupiedServer.once('error', rejectListen);
    occupiedServer.listen(occupiedPort, '127.0.0.1', resolveListen);
  });
  const occupied = fixture('occupied-client-pin', { sessions: true });
  try {
    await assert.rejects(
      startFixture(occupied, { platform: 'web', clientPort: occupiedPort }),
      (error) => {
        assert.equal(error?.code, 'SNAPBACK_DEV_PORT_UNAVAILABLE');
        assert.equal(error?.diagnostic?.details?.owner, 'client');
        assert.equal(error?.diagnostic?.details?.port, occupiedPort);
        assert.equal(error?.diagnostic?.details?.holder?.pid, process.pid);
        return true;
      },
    );
    assert.equal(existsSync(occupied.readyFile), false, 'the backend child must not start');
    assert.equal(existsSync(occupied.metroEnv), false, 'the Metro child must not start');
    assert.equal(existsSync(occupied.bundle), false, 'Metro must not write a bundle');
  } finally {
    await new Promise((resolveClose) => occupiedServer.close(resolveClose));
  }

  const rangedPorts = await reserveFreeRange(8);
  const ranged = fixture('ranged-ports', { sessions: true });
  const rangedRun = await startFixture(ranged, {
    platform: 'web',
    portRange: `${rangedPorts.lo}-${rangedPorts.hi}`,
  });
  const rangedByOwner = Object.fromEntries(
    rangedRun.supervisor.portPlan.owners.map((entry) => [entry.owner, entry.port]),
  );
  assert.deepEqual(rangedByOwner, {
    backend: rangedPorts.lo,
    client: rangedPorts.hi,
    bootstrap: rangedPorts.hi - 1,
    metro: rangedPorts.hi - 2,
  });
  assert.equal(rangedRun.supervisor.portPlan.range.source, 'flag');
  assert(rangedRun.supervisor.portPlan.owners.every(({ port }) => (
    port >= rangedPorts.lo && port <= rangedPorts.hi
  )));
  await rangedRun.supervisor.close();
  supervisors.splice(supervisors.indexOf(rangedRun.supervisor), 1);
  await eventually(() => !existsSync(ranged.readyFile), { label: 'ranged ready-file cleanup' });

  const envClientPort = (await reserveFreeRange(1)).lo;
  const envPinned = fixture('env-pinned-client', { sessions: true });
  const envPinnedRun = await startFixture(envPinned, {
    platform: 'web',
    env: { SNAPBACK_DEV_CLIENT_PORT: String(envClientPort) },
  });
  assert.deepEqual(
    envPinnedRun.supervisor.portPlan.owners.find(({ owner }) => owner === 'client'),
    { owner: 'client', port: envClientPort, source: 'pinned', declaredBy: 'env' },
  );
  await envPinnedRun.supervisor.close();
  supervisors.splice(supervisors.indexOf(envPinnedRun.supervisor), 1);
  await eventually(() => !existsSync(envPinned.readyFile), { label: 'env-pinned ready-file cleanup' });

  // Ruling 2 makes supervised web anonymous-first. A separate native-default
  // boot below adopts on demand and surfaces the unsettled Sessions refusal;
  // the ordinary exchange itself never mints or leaks a bearer.
  const unsettled = fixture('anonymous-web-no-mint', { sessions: true });
  const unsettledRun = await startFixture(unsettled, { platform: 'web' });
  assert.deepEqual(JSON.parse(readFileSync(unsettled.metroEnv, 'utf8')), {
    nodeOptions: '--trace-warnings --dns-result-order=ipv4first',
    defaultResultOrder: 'ipv4first',
    ci: null,
    watching: true,
    backendOrigin: unsettledRun.supervisor.binding.target.origin,
  });
  assert.equal(unsettledRun.supervisor.state, 'ready');
  assertListenerInventory(unsettledRun.supervisor);
  const unsettledExchange = await (
    await fetch(`${unsettledRun.supervisor.exchangeOrigin}${SUPERVISED_EXCHANGE_PATH}`)
  ).json();
  assert.equal(unsettledExchange.authority.status, 'unavailable');
  assert.equal(Object.hasOwn(unsettledExchange.authority, 'token'), false);
  const unsettledApp = JSON.parse(readFileSync(
    join(unsettled.backendRoot, 'generated', 'app.descriptor.json'),
    'utf8',
  ));
  const unsettledWebBaseEnvironment = createSupervisedExpoEnvironment({
    exchangeOrigin: unsettledRun.supervisor.exchangeOrigin,
    appState: appStateHarness(),
    runtimePlatform: 'web',
  });
  let unsettledWebPlatformResolutions = 0;
  const unsettledWebEnvironment = Object.freeze({
    ...unsettledWebBaseEnvironment,
    resolveNativeAuthCustodyOperatingSystem() { return 'web'; },
    resolveAppClientPlatform() {
      unsettledWebPlatformResolutions += 1;
      return Object.freeze({
        kind: 'expo-web',
        indexedDB: new IDBFactory(),
        lockManager: Object.freeze({
          request: (_name, _options, operation) => operation(),
        }),
        cryptoObject: webcrypto,
        databaseName: 'expo-track-b-unsettled-web',
      });
    },
  });
  const unsettledBoot = createSnapbackExpoBoot({
    app: unsettledApp,
    environment: unsettledWebEnvironment,
  });
  const anonymousUnsettled = await unsettledBoot.start();
  assert.equal(anonymousUnsettled.status, 'ready', JSON.stringify({
    state: anonymousUnsettled,
    mintCount: unsettledRun.supervisor.inspection().authorityMintCount,
    platformResolutions: unsettledWebPlatformResolutions,
  }));
  assert.equal(unsettledWebPlatformResolutions, 1);
  assert.equal(unsettledBoot.appClient().auth.currentPrincipal().status, 'anonymous');
  assert.equal(unsettledRun.supervisor.inspection().authorityMintCount, 0);
  await unsettledBoot.dispose();

  const unsettledOrigins = {
    backend: unsettledRun.supervisor.binding.target.origin,
    metro: unsettledRun.supervisor.metroOrigin,
    bootstrap: unsettledRun.supervisor.exchangeOrigin,
  };
  await unsettledRun.supervisor.close();
  supervisors.splice(supervisors.indexOf(unsettledRun.supervisor), 1);
  await Promise.all(Object.entries(unsettledOrigins).map(([label, origin]) => (
    assertOriginClosed(origin, `unsettled web ${label}`)
  )));
  await eventually(() => !existsSync(unsettled.readyFile), {
    label: 'unsettled web ready-file cleanup',
  });

  const unsettledNative = fixture('unsettled-native', { sessions: false });
  const unsettledNativeRun = await startFixture(unsettledNative, { platform: 'ios' });
  const unsettledNativeApp = JSON.parse(readFileSync(
    join(unsettledNative.backendRoot, 'generated', 'app.descriptor.json'),
    'utf8',
  ));
  const unsettledNativeEnvironment = Object.freeze({
    ...createSupervisedExpoEnvironment({
      exchangeOrigin: unsettledNativeRun.supervisor.exchangeOrigin,
      appState: appStateHarness(),
      runtimePlatform: 'native',
    }),
    resolveNativeAuthCustodyOperatingSystem() { return 'ios'; },
    resolveAppClientPlatform() {
      return Object.freeze({ kind: 'memory', cryptoObject: webcrypto });
    },
  });
  const unsettledNativeAdoptionBoot = createSnapbackExpoBoot({
    app: unsettledNativeApp,
    environment: unsettledNativeEnvironment,
  });
  const authorityRequired = await unsettledNativeAdoptionBoot.start();
  assert.equal(authorityRequired.status, 'authority-required');
  assert.equal(authorityRequired.diagnostic.code, 'SNAPBACK_AUTH_POLICY_UNAVAILABLE');
  assert.equal(authorityRequired.diagnostic.details.cause, 'sessions-auth-mode-unavailable');
  assert.equal(
    unsettledNativeRun.supervisor.inspection().authorityMintCount,
    1,
    'native default adoption performs exactly one on-demand mint attempt',
  );
  await unsettledNativeAdoptionBoot.dispose();
  const unsettledNativeOrigins = {
    backend: unsettledNativeRun.supervisor.binding.target.origin,
    metro: unsettledNativeRun.supervisor.metroOrigin,
    bootstrap: unsettledNativeRun.supervisor.exchangeOrigin,
  };
  await unsettledNativeRun.supervisor.close();
  supervisors.splice(supervisors.indexOf(unsettledNativeRun.supervisor), 1);
  await Promise.all(Object.entries(unsettledNativeOrigins).map(([label, origin]) => (
    assertOriginClosed(origin, `unsettled native ${label}`)
  )));
  await eventually(() => !existsSync(unsettledNative.readyFile), {
    label: 'unsettled native ready-file cleanup',
  });

  // A real Metro exit in the former post-inventory/pre-publish race must be
  // latched as startup-fatal. Killing the admitted listener synchronously
  // from the inventory event exercises the exact window without a mocked
  // child or listener seam.
  const startupExit = fixture('startup-exit', { sessions: true });
  let killedStartupMetro = false;
  await assert.rejects(
    startFixture(startupExit, {
      platform: 'web',
      onEvent(event) {
        if (killedStartupMetro || event.state !== 'listeners-verified') return;
        const listener = event.listeners.find(({ owner }) => owner === 'metro');
        assert.ok(listener?.pid);
        killedStartupMetro = true;
        process.kill(listener.pid, 'SIGKILL');
      },
    }),
    (error) => {
      assert([
        'SNAPBACK_EXPO_METRO_EXITED',
        'SNAPBACK_EXPO_CHILD_EXITED_DURING_STARTUP',
        'SNAPBACK_EXPO_LISTENER_ENUMERATION_INCOMPLETE',
      ].includes(error?.diagnostic?.code), error?.stack ?? String(error));
      return true;
    },
  );
  assert.equal(killedStartupMetro, true);
  assert.equal(existsSync(join(dirname(startupExit.readyFile), 'expo-supervisor.json')), false);
  await eventually(() => !existsSync(startupExit.readyFile), {
    label: 'startup-critical backend cleanup',
  });
  assert.equal(existsSync(join(startupExit.expoRoot, 'public')), false);
  if (process.argv.includes('--startup-exit-only')) {
    console.log('expo-dev-loop.test.mjs: real post-inventory Metro exit is startup-fatal and fully reclaimed');
    rmSync(scratchRoot, { recursive: true, force: true });
    process.exit(0);
  }

  // The production index.mjs -> runExpoDev path owns signals before startup
  // returns and keeps those handlers installed through cleanup. Pause at an
  // explicit pre-publication barrier, signal twice only after cleanup starts,
  // and require the real detached Metro group to be gone.
  const cliSignal = fixture('cli-startup-signal', { sessions: true });
  mkdirSync(cliSignal.stateRoot, { recursive: true });
  const cliSignalBarrier = join(cliSignal.stateRoot, 'pre-publish-barrier.json');
  const cliSignalCleanup = join(cliSignal.stateRoot, 'cleanup-started');
  const cliSignalChild = spawn(process.execPath, [
    cliLifecycleRunner,
    cliSignalBarrier,
    cliSignalCleanup,
    cliSignal.bundle,
    cliSignal.sourceMap,
    cliSignal.metroEnv,
    cliSignal.generatedRoot,
    ...expoCliArguments(cliSignal),
  ], {
    cwd: cliSignal.projectRoot,
    env: { ...process.env, SNAPBACK_RUNTIME_BINARY: runtimeBinary },
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  let cliSignalOutput = '';
  cliSignalChild.stdout.on('data', (chunk) => { cliSignalOutput += chunk; });
  cliSignalChild.stderr.on('data', (chunk) => { cliSignalOutput += chunk; });
  await eventually(() => {
    if (existsSync(cliSignalBarrier)) return true;
    if (cliSignalChild.exitCode !== null || cliSignalChild.signalCode !== null) {
      throw new Error(cliSignalOutput || `CLI exited ${cliSignalChild.exitCode ?? cliSignalChild.signalCode}`);
    }
    return false;
  }, {
    label: 'production CLI pre-publication signal barrier',
  });
  const cliSignalState = JSON.parse(readFileSync(cliSignalBarrier, 'utf8'));
  cliSignalChild.kill('SIGTERM');
  await eventually(() => existsSync(cliSignalCleanup), {
    label: 'production CLI cleanup-start barrier',
  });
  cliSignalChild.kill('SIGTERM');
  const cliSignalExit = await new Promise((resolveExit, rejectExit) => {
    cliSignalChild.once('error', rejectExit);
    cliSignalChild.once('close', (code, signal) => resolveExit({ code, signal }));
  });
  assert.deepEqual(cliSignalExit, { code: 0, signal: null }, cliSignalOutput);
  await eventually(() => !processGroupAlive(cliSignalState.metroPid), {
    label: 'production CLI SIGTERM Metro group cleanup',
  });
  await assertOriginClosed(
    listenerOrigin(cliSignalState.listeners.find(({ owner }) => owner === 'backend')),
    'production CLI SIGTERM backend',
  );
  assert.equal(existsSync(join(dirname(cliSignal.readyFile), 'expo-supervisor.json')), false);
  assert.equal(existsSync(join(cliSignal.expoRoot, 'public')), false);

  // Drive the same production runExpoDev barrier through the carrier's real
  // startup timeout. The carrier SIGTERMs the CLI; the early CLI handlers and
  // durable Metro lease must jointly leave no detached group or descriptor.
  const cliTimeout = fixture('cli-startup-timeout', { sessions: true });
  mkdirSync(cliTimeout.stateRoot, { recursive: true });
  const cliTimeoutArtifacts = join(scratchRoot, 'cli-startup-timeout-artifacts');
  const cliTimeoutBarrier = join(cliTimeout.stateRoot, 'pre-publish-barrier.json');
  const cliTimeoutCleanup = join(cliTimeout.stateRoot, 'cleanup-started');
  const timeoutVerifier = join(scratchRoot, 'cli-timeout-verifier.mjs');
  writeFileSync(timeoutVerifier, `
import { mkdirSync, writeFileSync } from 'node:fs';
mkdirSync('.snapback', { recursive: true });
writeFileSync('.snapback/cli-timeout-verify.json', JSON.stringify({
  schemaVersion: 'snapback.verify-receipt.v1', ok: true, status: 'passed'
}));
`);
  const timeoutConfig = defineTemplateCarrierConfig({
    schemaVersion: 'snapback.template-carriers.v1',
    verifyCommand: [process.execPath, timeoutVerifier],
    verifyReceipt: '.snapback/cli-timeout-verify.json',
    carriers: {
      'web-browser': {
        command: [
          process.execPath,
          cliLifecycleRunner,
          cliTimeoutBarrier,
          cliTimeoutCleanup,
          cliTimeout.bundle,
          cliTimeout.sourceMap,
          cliTimeout.metroEnv,
          cliTimeout.generatedRoot,
          ...expoCliArguments(cliTimeout, {
            readyFile: '{supervisorState}/dev.ready.json',
            database: '{supervisorState}/dev.sqlite3',
          }),
        ],
        structuredReadiness: {
          kind: 'expo-supervisor',
          file: '{supervisorState}/expo-supervisor.json',
        },
        startupTimeoutMs: 15_000,
      },
    },
  });
  await assert.rejects(
    runTemplateCarrierCli(timeoutConfig, [
      'web-browser', '--browser', metroScript, '--artifacts', cliTimeoutArtifacts,
    ], { root: scratchRoot }),
    /did not write structured readiness/u,
  );
  assert.equal(existsSync(cliTimeoutBarrier), true);
  assert.equal(existsSync(cliTimeoutCleanup), true);
  const cliTimeoutState = JSON.parse(readFileSync(cliTimeoutBarrier, 'utf8'));
  await eventually(() => !processGroupAlive(cliTimeoutState.metroPid), {
    label: 'production runExpoDev carrier-timeout Metro group cleanup',
  });
  await assertOriginClosed(
    listenerOrigin(cliTimeoutState.listeners.find(({ owner }) => owner === 'backend')),
    'production runExpoDev carrier-timeout backend',
  );
  assert.equal(existsSync(join(cliTimeoutArtifacts, 'expo-supervisor.json')), false);
  assert.equal(existsSync(join(cliTimeout.expoRoot, 'public')), false);

  // Settled Sessions mode: real mint, provider boot, canonical live/mutation/
  // presence owners, HMR-shaped reattachment, reconnect, and authority barrier.
  const settled = fixture('settled', { sessions: true });
  let settledNow = Date.now();
  let concurrentAuthorityBarrier = null;
  const bindingTtlMs = 1_000;
  const bindingRefreshWindowMs = 200;
  const settledRun = await startFixture(settled, {
    platform: 'web',
    now: () => settledNow,
    bindingTtlMs,
    bindingRefreshWindowMs,
    afterSupervisedAuthorityRequested: () => concurrentAuthorityBarrier?.(),
  });
  const { supervisor, events } = settledRun;
  assert.deepEqual(
    {
      backend: supervisor.binding.target.origin,
      metro: supervisor.metroOrigin,
      bootstrap: supervisor.exchangeOrigin,
    },
    unsettledOrigins,
    'two quiet default web runs keep the same public origins',
  );
  assert.equal(supervisor.state, 'ready');
  assert.equal(supervisor.connectCarrier, 'supervisor-rendezvous');
  assert.deepEqual(supervisor.device, { serial: null, class: 'browser' });
  const settledReadyEvent = events.find((event) => event.state === 'ready');
  assert.equal(settledReadyEvent?.connectCarrier, 'supervisor-rendezvous');
  assert.equal(settledReadyEvent?.platform, 'web');
  assert.equal(settledReadyEvent?.snapbackUrl, supervisor.snapbackUrl);
  assert.equal(settledReadyEvent?.androidEmulatorUrl, supervisor.androidEmulatorUrl);
  const supervisorDescriptor = join(dirname(settled.readyFile), 'expo-supervisor.json');
  assert.equal(existsSync(supervisorDescriptor), true);
  assert.equal(statSync(supervisorDescriptor).mode & 0o777, 0o600);
  const supervisorDiscovery = JSON.parse(readFileSync(supervisorDescriptor, 'utf8'));
  assert.equal(supervisorDiscovery.schemaVersion, EXPO_SUPERVISOR_DESCRIPTOR_FORMAT);
  assert.equal(supervisorDiscovery.state, 'ready');
  assert.equal(supervisorDiscovery.platform, 'web');
  assert.equal(supervisorDiscovery.pid, process.pid);
  assert.equal(supervisorDiscovery.supervisor.pid, process.pid);
  assert.equal(typeof supervisorDiscovery.supervisor.startTime, 'string');
  assert.equal(typeof supervisorDiscovery.metro.startTime, 'string');
  assert.equal(supervisorDiscovery.metro.origin, supervisor.metroOrigin);
  // The supervisor is the only process that can see whether the shared
  // development broker is being served, so the descriptor records its
  // projection for a separate `snapback auth status` to read. This fixture
  // declares no provider, so the recorded answer is that there is no broker —
  // stated, not left silent.
  assert.equal(
    supervisorDiscovery.sharedAuth.format,
    'snapback.shared-development-auth-projection.v1',
  );
  assert.equal(supervisorDiscovery.sharedAuth.available, false);
  assert.equal(supervisorDiscovery.sharedAuth.reason, 'no-broker');
  assert.equal(supervisor.applicationReady.formatVersion, 'snapback.application-ready.v1');
  assert.equal(supervisor.applicationReady.admissionPosture, 'explicit-list');
  assert.deepEqual(supervisorDiscovery.applicationReady, supervisor.applicationReady);
  const metroClientOrigins = expoBackendClientOrigins(
    Number(new URL(supervisor.metroOrigin).port),
  );
  assert.deepEqual(supervisor.applicationReady.clientOrigins, metroClientOrigins);
  assert.equal(supervisor.applicationReady.binding.descriptorIdentity, supervisor.binding.descriptorIdentity);
  assert.notEqual(
    supervisor.applicationReady.binding.provenance.supervisorGeneration,
    supervisor.binding.provenance.supervisorGeneration,
    'the CLI-owned receipt and Expo device-route projection have distinct issuers',
  );
  assert.match(
    supervisor.applicationReady.runtimeIdentity.qualifiedBinary.sha256,
    /^sha256:[0-9a-f]{64}$/u,
  );
  for (const origin of metroClientOrigins) {
    const cors = await fetch(`${supervisor.applicationReady.binding.target.origin}/health`, {
      headers: { origin },
    });
    assert.equal(cors.status, 200);
    assert.equal(cors.headers.get('access-control-allow-origin'), origin);
  }

  // The canonical CLI cut remains idempotently attachable after Expo has
  // published its separate route projection. Expo never substitutes that
  // projection into the application-ready file.
  const cliAttachAfterProjection = await runDev({
    backendDirectory: settled.backendRoot,
    projectRoot: settled.projectRoot,
    readyFile: settled.readyFile,
    database: settled.database,
    runtimeBinary,
    env: expoBackendDevAuthEnvironment(process.env, Number(new URL(supervisor.metroOrigin).port)),
    supervisedClientOrigins: metroClientOrigins,
    attach: true,
    watch: false,
    serverStdio: ['ignore', 'ignore', 'ignore'],
  });
  assert.equal(cliAttachAfterProjection.managed, false);
  assert.deepEqual(cliAttachAfterProjection.clientOrigins, metroClientOrigins);
  await cliAttachAfterProjection.close();
  const applicationReadyAfterCliAttach = readFileSync(supervisor.applicationReady.path, 'utf8');
  assert(supervisorDiscovery.listeners.some((listener) => (
    listener.owner === 'metro'
      && listener.port === Number(new URL(supervisorDiscovery.metro.upstreamOrigin).port)
      && listener.loopback === true
      && typeof listener.startTime === 'string'
  )));
  assert(supervisorDiscovery.listeners.some((listener) => (
    listener.owner === 'metro-front'
      && listener.port === Number(new URL(supervisor.metroOrigin).port)
      && listener.pid === process.pid
      && listener.loopback === true
  )));
  assert.match(
    supervisorDiscovery.attestation.path,
    /^\/_snapback\/expo\/v1\/web-attestation\//u,
  );
  assert.equal(supervisorDiscovery.attestation.nonce.length >= 32, true);
  assert.equal(
    await (await fetch(`${supervisor.metroOrigin}${supervisorDiscovery.attestation.path}`)).text(),
    `${supervisorDiscovery.attestation.nonce}\n`,
  );
  assert.equal(
    (await fetch(`${supervisor.metroOrigin}${supervisorDiscovery.attestation.path}`)).status,
    410,
    'the process-bound web attestation must be single-use',
  );
  assertListenerInventory(supervisor);
  assert.equal(supervisor.binding.source, 'supervised-dev');
  assert.equal(supervisor.binding.integrity.channel, 'local-supervised-ipc');
  assert(Date.parse(supervisor.binding.provenance.expiresAt) > settledNow);
  const firstExchange = await (
    await fetch(`${supervisor.exchangeOrigin}${SUPERVISED_EXCHANGE_PATH}`)
  ).json();
  assert.equal(firstExchange.authority.status, 'unavailable');
  assert.equal(Object.hasOwn(firstExchange.authority, 'token'), false);
  const supervisorOriginMint = await fetch(
    `${supervisor.exchangeOrigin}${SUPERVISED_EXCHANGE_PATH}?authority=mint`,
    {
      method: 'POST',
      headers: {
        Origin: supervisor.exchangeOrigin,
        'content-type': 'application/json',
      },
      body: JSON.stringify({ correlationId: firstExchange.correlationId }),
    },
  );
  assert.equal(
    supervisorOriginMint.status,
    403,
    'shared-auth scripts on the supervisor origin cannot request an ordinary-session mint',
  );

  const injectedMetroEnvironment = JSON.parse(readFileSync(settled.metroEnv, 'utf8'));
  assert.equal(
    injectedMetroEnvironment.backendOrigin,
    supervisor.binding.target.origin,
    'EXPO_PUBLIC_SNAPBACK_URL is the exact supervised backend data/auth origin',
  );
  assert.notEqual(
    injectedMetroEnvironment.backendOrigin,
    supervisor.exchangeOrigin,
    'the rendezvous control plane is not projected as a second Snapback backend',
  );

  const applicationApp = JSON.parse(readFileSync(
    join(settled.backendRoot, 'generated', 'app.descriptor.json'),
    'utf8',
  ));
  const applicationDiagnostics = [];
  const applicationEnvironment = (databaseName) => Object.freeze({
    ...createSupervisedExpoEnvironment({
      exchangeOrigin: supervisor.exchangeOrigin,
      appState: appStateHarness(),
      runtimePlatform: 'web',
      clientOptions: {
        rqsStore: null,
        offlineQueue: false,
        clientStoreId: databaseName,
      },
      onDiagnostic(diagnostic) { applicationDiagnostics.push(diagnostic); },
    }),
    resolveNativeAuthCustodyOperatingSystem() { return 'web'; },
    resolveAppClientPlatform() {
      return Object.freeze({
        kind: 'expo-web',
        indexedDB: new IDBFactory(),
        lockManager: Object.freeze({
          request: (_name, _options, operation) => operation(),
        }),
        cryptoObject: webcrypto,
        databaseName,
      });
    },
  });
  const anonymousBoot = createSnapbackExpoBoot({
    app: applicationApp,
    environment: applicationEnvironment('expo-track-b-anonymous'),
    now: () => settledNow,
  });
  const anonymousReady = await anonymousBoot.start();
  assert.equal(anonymousReady.status, 'ready', JSON.stringify(anonymousReady));
  assert.equal(anonymousReady.binding.source, 'supervised-dev');
  assert.equal(
    anonymousBoot.appClient().client.baseUrl,
    injectedMetroEnvironment.backendOrigin,
    'a first-party boot with no url option uses the injected backend origin while rendezvous remains the binding source',
  );
  assert.equal(anonymousBoot.appClient().auth.currentPrincipal().status, 'anonymous');
  const passwordEmail = `expo-track-b-${process.pid}@example.com`;
  const password = 'expo-track-b-password';
  const signup = await anonymousBoot.appClient().auth.signUpWithPassword({
    email: passwordEmail,
    password,
  });
  assert.equal(signup.recoveryCodes.length, 8);
  assert.equal(anonymousBoot.appClient().auth.currentPrincipal().status, 'authenticated');
  await anonymousBoot.appClient().auth.signOut();
  assert.equal(anonymousBoot.appClient().auth.currentPrincipal().status, 'anonymous');
  await anonymousBoot.appClient().auth.signInWithPassword({ email: passwordEmail, password });
  assert.equal(anonymousBoot.appClient().auth.currentPrincipal().status, 'authenticated');
  await anonymousBoot.appClient().auth.signOut();
  assert.equal(anonymousBoot.appClient().auth.currentPrincipal().status, 'anonymous');
  await anonymousBoot.dispose();
  assert.equal(
    supervisor.inspection().authorityMintCount,
    0,
    'the real mint call count remains zero before the first explicit web adoption',
  );

  const replacementEventsBeforeAdoption = events.filter(
    (event) => event.state === 'authority-replaced',
  ).length;
  const adoptedBoot = createSnapbackExpoBoot({
    app: applicationApp,
    environment: applicationEnvironment('expo-track-b-adopted'),
    adoptSupervisedSession: true,
    now: () => settledNow,
  });
  const adoptedReady = await adoptedBoot.start();
  assert.equal(adoptedReady.status, 'ready', JSON.stringify(adoptedReady));
  assert.equal(adoptedReady.binding.source, 'supervised-dev');
  assert.equal(adoptedReady.authoritySource, 'supervised-development');
  assert.equal(adoptedBoot.appClient().auth.currentPrincipal().status, 'authenticated');
  assert.equal(
    supervisor.inspection().authorityMintCount,
    1,
    'the first explicit adoption is the first real supervisor mint',
  );
  await adoptedBoot.appClient().auth.signOut();
  assert.equal(adoptedBoot.appClient().auth.currentPrincipal().status, 'anonymous');
  assert.equal(adoptedBoot.getSnapshot().status, 'ready');
  assert.equal(
    applicationDiagnostics.some(({ code }) => code === 'SNAPBACK_AUTH_SESSION_EXPIRED'),
    false,
  );
  assert.equal(
    events.filter((event) => event.state === 'authority-replaced').length,
    replacementEventsBeforeAdoption,
    'the first explicit mint is issuance, not authority replacement',
  );
  await adoptedBoot.dispose();

  const readoptedBoot = createSnapbackExpoBoot({
    app: applicationApp,
    environment: applicationEnvironment('expo-track-b-readopted'),
    adoptSupervisedSession: true,
    now: () => settledNow,
  });
  const readoptedReady = await readoptedBoot.start();
  assert.equal(readoptedReady.status, 'ready', JSON.stringify(readoptedReady));
  assert.equal(readoptedReady.authoritySource, 'supervised-development');
  assert.equal(
    readoptedBoot.appClient().auth.currentPrincipal().status,
    'authenticated',
    'a second explicit adopter receives a fresh session after the first adopter signs out',
  );
  await readoptedBoot.dispose();
  assert.equal(
    applicationDiagnostics.some(({ code }) => code === 'SNAPBACK_AUTH_SESSION_EXPIRED'),
    false,
  );
  assert.equal(
    events.filter((event) => event.state === 'authority-replaced').length,
    replacementEventsBeforeAdoption + 1,
    'the second explicit adoption remints and reports an authority replacement',
  );
  assert.equal(supervisor.inspection().authorityMintCount, 2);

  const postMintPlainExchange = await (
    await fetch(`${supervisor.exchangeOrigin}${SUPERVISED_EXCHANGE_PATH}`)
  ).json();
  assert.equal(postMintPlainExchange.authority.status, 'unavailable');
  assert.equal(Object.hasOwn(postMintPlainExchange.authority, 'token'), false);

  const concurrentMintCount = supervisor.inspection().authorityMintCount;
  const concurrentSessionCount = authSessionCount(settled.database);
  let concurrentAuthorityArrivals = 0;
  let releaseConcurrentAuthorities;
  const concurrentAuthoritiesReady = new Promise((resolve) => {
    releaseConcurrentAuthorities = resolve;
  });
  concurrentAuthorityBarrier = async () => {
    concurrentAuthorityArrivals += 1;
    if (concurrentAuthorityArrivals === 2) releaseConcurrentAuthorities();
    await concurrentAuthoritiesReady;
  };
  const concurrentBootstrap = await (
    await fetch(`${supervisor.exchangeOrigin}${SUPERVISED_EXCHANGE_PATH}`, {
      headers: { Origin: supervisor.metroOrigin },
    })
  ).json();
  const [concurrentExchangeA, concurrentExchangeB] = await Promise.all([
    requestSupervisedMint(
      supervisor.exchangeOrigin,
      supervisor.metroOrigin,
      concurrentBootstrap,
    ),
    requestSupervisedMint(
      supervisor.exchangeOrigin,
      supervisor.metroOrigin,
      concurrentBootstrap,
    ),
  ]);
  concurrentAuthorityBarrier = null;
  const concurrentBearers = [
    concurrentExchangeA.authority.token,
    concurrentExchangeB.authority.token,
  ];
  assert.equal(
    new Set(concurrentBearers).size,
    2,
    'concurrent adoption responses must each carry the session minted for that request',
  );
  assert.equal(
    supervisor.inspection().authorityMintCount,
    concurrentMintCount + 2,
    'two concurrent adoption requests mint exactly two ordinary sessions',
  );
  assert.equal(
    authSessionCount(settled.database),
    concurrentSessionCount + 2,
    'two concurrent adoption requests create exactly two server-side session rows',
  );
  assert(concurrentBearers.every((bearer) => (
    authSessionUserForBearer(settled.database, bearer) !== null
  )));

  const app = JSON.parse(readFileSync(
    join(settled.backendRoot, 'generated', 'app.descriptor.json'),
    'utf8',
  ));
  // This E1 fixture exercises the legacy supervised authority projection and
  // its live/query/presence lifecycle. First-party application-auth bootstrap
  // has its own dedicated suite; keep that newer opt-in from changing this
  // carrier witness's public ready-state shape, and opt in explicitly because
  // the legacy web default is now the separately proven anonymous/no-mint path.
  delete app.authBootstrap;
  app.capabilities.required = app.capabilities.required.filter(
    (capability) => capability !== 'auth.application-bootstrap.v1',
  );
  const generated = await import(
    `${pathToFileURL(join(settled.backendRoot, 'generated', 'api.mjs')).href}?e1=${Date.now()}`
  );
  const api = generated.default;
  const appState = appStateHarness();
  const authorityExchangeBearers = [];
  const supervisedFetch = async (input, init) => {
    const response = await fetch(input, init);
    if (
      input === `${supervisor.exchangeOrigin}${SUPERVISED_EXCHANGE_PATH}?authority=mint`
      && init?.method === 'POST'
      && response.ok
    ) {
      const exchange = await response.clone().json();
      if (exchange.authority?.status === 'ready') {
        authorityExchangeBearers.push(exchange.authority.token);
      }
    }
    return response;
  };
  const supervisedEnvironment = createSupervisedExpoEnvironment({
    exchangeOrigin: supervisor.exchangeOrigin,
    fetch: supervisedFetch,
    appState,
    runtimePlatform: 'web',
    clientOptions: {
      rqsStore: null,
      offlineQueue: false,
      clientStoreId: 'expo-e1-provider',
    },
  });
  const environment = Object.freeze({
    ...supervisedEnvironment,
    resolveAppClientPlatform() {
      return Object.freeze({
        kind: 'expo-web',
        indexedDB: new IDBFactory(),
        lockManager: Object.freeze({
          request: (_name, _options, operation) => operation(),
        }),
        cryptoObject: webcrypto,
        databaseName: 'snapback-expo-dev-loop',
      });
    },
  });
  const bootStates = [];
  const boot = createSnapbackExpoBoot({
    app,
    environment,
    adoptSupervisedSession: true,
    now: () => settledNow,
  });
  const offBoot = boot.subscribe(() => bootStates.push(boot.getSnapshot()));
  const ready = await boot.start();
  assert.equal(ready.status, 'ready', JSON.stringify(ready));
  assert.equal(ready.binding.target.origin, supervisor.binding.target.origin);
  assert.equal(ready.authority.authMode, 'sessions');
  assert.equal(appState.count(), 1);
  const firstUserId = ready.authority.userId;
  assert.equal(authorityExchangeBearers.length, 1);
  const firstBearer = authorityExchangeBearers[0];
  assert.match(firstBearer, /^sbs_/u);
  assert.equal(authSessionUserForBearer(settled.database, firstBearer), firstUserId);
  const provider = boot.reactProvider();
  assert(provider, 'ready Expo boot must project the canonical React provider');

  // A fake-clock loop crosses three predecessor TTL boundaries. Each cycle
  // proves a cold boot immediately before the refresh window and another just
  // after the predecessor's expiry, without replacing the supervisor.
  const ordinaryFlowNow = settledNow;
  const initialSupervisorGeneration = supervisor.supervisorGeneration;
  const coldBootIssuedAt = [];
  const runColdBoot = async (label) => {
    const coldState = appStateHarness();
    const coldBoot = createSnapbackExpoBoot({
      app,
      environment: createSupervisedExpoEnvironment({
        exchangeOrigin: supervisor.exchangeOrigin,
        appState: coldState,
        runtimePlatform: 'web',
        clientOptions: {
          rqsStore: null,
          offlineQueue: false,
          clientStoreId: `expo-e1-${label}`,
        },
      }),
      now: () => settledNow,
    });
    const coldReady = await coldBoot.start();
    assert.equal(coldReady.status, 'ready', `${label} must reach application-ready state`);
    assert.equal(
      coldReady.authority.sessionId,
      null,
      `${label} must stay anonymous instead of minting a supervised web session`,
    );
    assert.equal(
      coldReady.binding.provenance.supervisorGeneration,
      initialSupervisorGeneration,
      `${label} must stay on the original supervisor generation`,
    );
    coldBootIssuedAt.push(coldReady.binding.provenance.issuedAt);
    await coldBoot.dispose();
    assert.equal(coldState.count(), 0);
    return coldReady;
  };
  for (let cycle = 1; cycle <= 3; cycle += 1) {
    const predecessor = supervisor.binding;
    const predecessorExpiry = Date.parse(predecessor.provenance.expiresAt);
    settledNow = predecessorExpiry - bindingRefreshWindowMs - 1;
    const beforeBoundary = await runColdBoot(`ttl-${cycle}-before`);
    assert.equal(beforeBoundary.binding.provenance.issuedAt, predecessor.provenance.issuedAt);

    settledNow = predecessorExpiry - bindingRefreshWindowMs;
    const refreshedExchange = await (
      await fetch(`${supervisor.exchangeOrigin}${SUPERVISED_EXCHANGE_PATH}`)
    ).json();
    assert.notEqual(
      refreshedExchange.binding.provenance.issuedAt,
      predecessor.provenance.issuedAt,
      `cycle ${cycle} must publish one fresh issuance inside the window`,
    );
    settledNow = predecessorExpiry + 1;
    const afterBoundary = await runColdBoot(`ttl-${cycle}-after`);
    assert.equal(
      afterBoundary.binding.provenance.issuedAt,
      refreshedExchange.binding.provenance.issuedAt,
    );
  }
  assert.equal(coldBootIssuedAt.length, 6);
  assert.equal(supervisor.supervisorGeneration, initialSupervisorGeneration);
  assert.equal(
    events.filter((event) => event.state === 'binding-refreshed').length,
    3,
  );
  assert.equal(
    JSON.parse(readFileSync(supervisorDescriptor, 'utf8'))
      .binding.provenance.issuedAt,
    supervisor.binding.provenance.issuedAt,
    'the transient Expo descriptor must project the refreshed Expo binding',
  );
  assert.equal(
    readFileSync(supervisor.applicationReady.path, 'utf8'),
    applicationReadyAfterCliAttach,
    'Expo binding refresh must never rewrite the CLI-owned application-ready file',
  );
  assert.equal(
    JSON.stringify(events.filter((event) => event.state === 'binding-refreshed')).includes(firstBearer),
    false,
    'structured binding refresh events must carry no bearer material',
  );
  // The TTL witness owns its fake-clock excursion. Restore F's ordinary
  // carrier timeline before its later legacy authority/HMR journey re-admits
  // the binding originally held by this long-lived boot.
  settledNow = ordinaryFlowNow;

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
  const replacementMintCount = supervisor.inspection().authorityMintCount;
  const replacementSessionCount = authSessionCount(settled.database);
  assert.equal(await supervisor.replaceAuthority('second@expo-e1.test'), 'ready');
  const replaced = await boot.refreshAuthority();
  assert.equal(replaced.status, 'ready');
  assert.notEqual(replaced.authority.userId, firstUserId);
  assert.equal(
    supervisor.inspection().authorityMintCount,
    replacementMintCount + 1,
    'one authority replacement mints exactly one server session',
  );
  assert.equal(
    authSessionCount(settled.database),
    replacementSessionCount + 1,
    'one authority replacement creates exactly one server-side session row',
  );
  assert.equal(authorityExchangeBearers.length, 2);
  const secondBearer = authorityExchangeBearers[1];
  assert.match(secondBearer, /^sbs_/u);
  assert.notEqual(secondBearer, firstBearer);
  assert.equal(
    authSessionUserForBearer(settled.database, secondBearer),
    replaced.authority.userId,
    'the exact pending replacement bearer crosses the provider refresh',
  );
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
  const predecessorMetroPid = supervisor.inspection().metro.pid;
  const predecessorBundleResponse = await fetch(`${supervisor.metroOrigin}/bundle`);
  const predecessorBundle = await predecessorBundleResponse.text();
  assert.equal(predecessorBundleResponse.headers.get('x-metro-files-changed-count'), '0');
  assert.match(predecessorBundle, new RegExp(predecessorDescriptorIdentity, 'u'));
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
  const successorBundle = await eventually(
    async () => {
      const response = await fetch(`${supervisor.metroOrigin}/bundle`);
      const source = await response.text();
      if (!source.includes(rotated.descriptorIdentity)) return false;
      return { response, source };
    },
    { timeoutMs: 30_000, label: 'Metro serves successor generated descriptor' },
  );
  assert.equal(successorBundle.response.headers.get('x-metro-files-changed-count'), '1');
  assert.equal(successorBundle.source.includes(predecessorDescriptorIdentity), false);
  assert.equal(supervisor.inspection().metro.pid, predecessorMetroPid);
  const successorApp = JSON.parse(readFileSync(
    join(settled.backendRoot, 'generated', 'app.descriptor.json'),
    'utf8',
  ));
  delete successorApp.authBootstrap;
  successorApp.capabilities.required = successorApp.capabilities.required.filter(
    (capability) => capability !== 'auth.application-bootstrap.v1',
  );
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
    now: () => settledNow,
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
  const settledInspection = supervisor.inspection();
  await supervisor.close();
  supervisors.splice(supervisors.indexOf(supervisor), 1);
  await Promise.all(Object.entries(settledOrigins).map(([label, origin]) => (
    assertOriginClosed(origin, `settled ${label}`)
  )));
  await eventually(
    () => !existsSync(supervisorDescriptor),
    { label: 'settled supervisor descriptor cleanup' },
  );
  assert.equal(existsSync(join(settled.expoRoot, 'public')), false);
  await eventually(() => !existsSync(settled.readyFile), { label: 'settled ready-file cleanup' });

  // Native supervision is still sessions-first at the provider boundary, but
  // it no longer creates and discards an eager S1. The omitted-prop native
  // default performs the first and only mint on its adoption request.
  const nativeOnDemand = fixture('native-on-demand-mint', { sessions: true });
  const nativeOnDemandRun = await startFixture(nativeOnDemand, {
    platform: 'ios',
    env: { EXPO_PUBLIC_SNAPBACK_URL: 'https://stale-parent.example.invalid' },
  });
  assert.equal(
    JSON.parse(readFileSync(nativeOnDemand.metroEnv, 'utf8')).backendOrigin,
    null,
    'native Metro omits EXPO_PUBLIC_SNAPBACK_URL instead of inheriting a parent value',
  );
  assert.equal(nativeOnDemandRun.supervisor.inspection().authorityMintCount, 0);
  const nativeOnDemandApp = JSON.parse(readFileSync(
    join(nativeOnDemand.backendRoot, 'generated', 'app.descriptor.json'),
    'utf8',
  ));
  const nativeOnDemandEnvironment = Object.freeze({
    ...createSupervisedExpoEnvironment({
      exchangeOrigin: nativeOnDemandRun.supervisor.exchangeOrigin,
      appState: appStateHarness(),
      runtimePlatform: 'native',
      clientOptions: { rqsStore: null, offlineQueue: false },
    }),
    resolveNativeAuthCustodyOperatingSystem() { return 'ios'; },
    resolveAppClientPlatform() {
      return Object.freeze({ kind: 'memory', cryptoObject: webcrypto });
    },
  });
  const nativeOnDemandBoot = createSnapbackExpoBoot({
    app: nativeOnDemandApp,
    environment: nativeOnDemandEnvironment,
  });
  const nativeOnDemandReady = await nativeOnDemandBoot.start();
  assert.equal(nativeOnDemandReady.status, 'ready', JSON.stringify(nativeOnDemandReady));
  assert.equal(nativeOnDemandReady.authoritySource, 'supervised-development');
  assert.equal(
    nativeOnDemandRun.supervisor.inspection().authorityMintCount,
    1,
    'one native boot mints exactly one session and has no eager S1',
  );
  await nativeOnDemandBoot.dispose();
  const nativeOnDemandOrigins = {
    backend: nativeOnDemandRun.supervisor.binding.target.origin,
    metro: nativeOnDemandRun.supervisor.metroOrigin,
    bootstrap: nativeOnDemandRun.supervisor.exchangeOrigin,
  };
  await nativeOnDemandRun.supervisor.close();
  supervisors.splice(supervisors.indexOf(nativeOnDemandRun.supervisor), 1);
  await Promise.all(Object.entries(nativeOnDemandOrigins).map(([label, origin]) => (
    assertOriginClosed(origin, `native on-demand ${label}`)
  )));
  await eventually(
    () => !existsSync(nativeOnDemand.readyFile),
    { label: 'native on-demand ready-file cleanup' },
  );

  // Exercise the packaged command wiring and signal path, not only the
  // programmatic supervisor seam. It reuses the settled database, receives a
  // fresh ordinary session, correlates control events, and joins every child.
  // The suite's Darwin tmpdir spelling is too long for an AF_UNIX endpoint;
  // use the documented external owner-only ready tree now that ignored stdin
  // makes a publishable control socket a startup requirement.
  const cliStateRoot = realpathSync(mkdtempSync('/tmp/sbcli-'));
  externalScratchRoots.add(cliStateRoot);
  chmodSync(cliStateRoot, 0o700);
  const cliTarget = {
    ...settled,
    readyFile: join(cliStateRoot, 'dev.ready.json'),
  };
  const cliSupervisorDescriptor = join(cliStateRoot, 'expo-supervisor.json');
  const cliRange = await reserveFreeRange(8);
  const cliRun = await runCliSupervisor(cliTarget, 'web', [
    '--port-range', `${cliRange.lo}-${cliRange.hi}`,
  ]);
  assert.match(cliRun.bearer, /^sbs_/u);
  assert.equal(cliRun.readyEvent.platform, 'web');
  assert.deepEqual(
    Object.fromEntries(cliRun.readyEvent.portPlan.owners.map(({ owner, port }) => [owner, port])),
    {
      backend: cliRange.lo,
      client: cliRange.hi,
      bootstrap: cliRange.hi - 1,
      metro: cliRange.hi - 2,
    },
  );
  assert.equal(cliRun.readyEvent.portPlan.range.source, 'flag');
  assertListenerInventory({ listeners: cliRun.listenerEvent.listeners });
  const cliOrigins = {
    backend: cliRun.readyEvent.binding.target.origin,
    metro: cliRun.readyEvent.metro.origin,
    bootstrap: cliRun.readyEvent.bootstrap.origin,
  };
  await Promise.all(Object.entries(cliOrigins).map(([label, origin]) => (
    assertOriginClosed(origin, `CLI ${label}`)
  )));
  await eventually(
    () => !existsSync(cliSupervisorDescriptor),
    { label: 'CLI supervisor descriptor cleanup' },
  );
  await eventually(() => !existsSync(cliTarget.readyFile), { label: 'CLI ready-file cleanup' });
  rmSync(cliStateRoot, { recursive: true, force: true });
  externalScratchRoots.delete(cliStateRoot);

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
      ...settledInspection.metro.logs.map(({ stream, line }) => `${stream}: ${line}`),
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
  assert.equal(
    events.some((event) => event.state === 'metro-watch-advisory'
      && event.code === 'SNAPBACK_EXPO_METRO_WATCH_INERT'
      && event.advisories.some((advisory) => advisory.condition === 'ci-environment')),
    false,
    'the supervisor-owned Metro child must not inherit the controller CI environment',
  );
  assert(
    events.some((event) => event.state === 'closed'
      && event.reclaimed.backend
      && event.reclaimed.metro
      && event.reclaimed.bootstrap),
    'shutdown reports every owned arm reclaimed',
  );

  console.log('expo-dev-loop.test.mjs: 6 LLP 0299 port-plan cases plus WS reset/cancelled-response handoff, zero-write rendezvous carrier, supervised web backend URL, anonymous password signup/signin, explicit on-demand mint adoption and safe signout, control-socket reload/refusals/ack/cleanup, repeated TTL cold boots, transient descriptor, served successor generated descriptor without Metro restart, Sessions refusal+mint, all-listener loopback proof, provider live/mutation/presence/HMR/reconnect/authority replacement+conflict, leak matrix, SIGINT, and strict cleanup pass');
  }
} finally {
  for (const child of cliChildren) {
    if (child.exitCode === null && child.signalCode === null) child.kill('SIGINT');
  }
  await Promise.allSettled(supervisors.flatMap((supervisor) => (
    typeof supervisor?.close === 'function' ? [supervisor.close()] : []
  )));
  for (const root of externalScratchRoots) {
    rmSync(root, { recursive: true, force: true });
  }
  rmSync(scratchRoot, { recursive: true, force: true });
}

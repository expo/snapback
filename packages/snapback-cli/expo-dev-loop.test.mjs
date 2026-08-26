import assert from 'node:assert/strict';
import { spawn, spawnSync } from 'node:child_process';
import { createHash, webcrypto } from 'node:crypto';
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
  SUPERVISED_EXCHANGE_PATH,
  createExpoRoutingPlan,
  expoBackendClientOrigins,
  expoBackendDevAuthEnvironment,
  expoMetroChildEnvironment,
  installAndroidPortForwarding,
  runExpoDev,
} from './expo-dev.mjs';
import { runDev } from './index.mjs';
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
if (!metroFreshnessOnly) {
  assert.ok(existsSync(runtimeBinary), `real Snapback runtime is missing: ${runtimeBinary}`);
}

const sourceFixture = join(packageRoot, 'fixtures', 'comparator', 'app', 'snapback');
const scratchRoot = realpathSync(mkdtempSync(join(tmpdir(), 'snapback-expo-dev-loop-')));
const metroScript = join(scratchRoot, 'headless-metro.mjs');
const cliLifecycleRunner = join(scratchRoot, 'cli-lifecycle-runner.mjs');
const supervisors = [];
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
server.listen(port, '127.0.0.1', () => {
  console.log(JSON.stringify({ event: 'metro-ready', host: '127.0.0.1', port }));
});
const stop = () => {
  generatedWatcher?.close();
  if (refreshTimer !== null) clearTimeout(refreshTimer);
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

async function runCliSupervisor(target, platform = 'ios', portArgs = []) {
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
  const exchange = await requestSupervisedMint(
    readyEvent.bootstrap.origin,
    readyEvent.metro.origin,
  );
  child.kill('SIGINT');
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

try {
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
  const unsettled = fixture('unsettled-web', { sessions: true });
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
            readyFile: '{artifacts}/dev.ready.json',
            database: '{artifacts}/dev.sqlite3',
          }),
        ],
        structuredReadiness: {
          kind: 'expo-supervisor',
          file: '{artifacts}/expo-supervisor.json',
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
  const bindingTtlMs = 1_000;
  const bindingRefreshWindowMs = 200;
  const settledRun = await startFixture(settled, {
    platform: 'web',
    now: () => settledNow,
    bindingTtlMs,
    bindingRefreshWindowMs,
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
  const cliRange = await reserveFreeRange(8);
  const cliRun = await runCliSupervisor(settled, 'web', [
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
    () => !existsSync(supervisorDescriptor),
    { label: 'CLI supervisor descriptor cleanup' },
  );
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

  console.log('expo-dev-loop.test.mjs: 6 LLP 0299 port-plan cases plus WS reset/cancelled-response handoff, zero-write rendezvous carrier, supervised web backend URL, anonymous password signup/signin, explicit on-demand mint adoption and safe signout, repeated TTL cold boots, transient descriptor, served successor generated descriptor without Metro restart, Sessions refusal+mint, all-listener loopback proof, provider live/mutation/presence/HMR/reconnect/authority replacement+conflict, leak matrix, SIGINT, and strict cleanup pass');
} finally {
  await Promise.allSettled(supervisors.flatMap((supervisor) => (
    typeof supervisor?.close === 'function' ? [supervisor.close()] : []
  )));
  rmSync(scratchRoot, { recursive: true, force: true });
}

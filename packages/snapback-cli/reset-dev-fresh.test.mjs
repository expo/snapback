import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import {
  chmodSync,
  cpSync,
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  realpathSync,
  rmSync,
  statSync,
  writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

import { createExternalSessionClient } from '@expo/snapback-client';
import { GOVERNANCE_FILES } from '@expo/snapback-codegen/visibility-governance';

import {
  managedAdminToken,
  readReadyDescriptor,
  runDev,
} from './index.mjs';
import {
  SUPERVISED_CONTROL_PATH,
  SUPERVISED_EXCHANGE_PATH,
  mintSupervisedOrdinarySession,
  runExpoDev,
} from './expo-dev.mjs';

const packageRoot = dirname(fileURLToPath(import.meta.url));
const repoRoot = resolve(packageRoot, '..', '..');
const cli = join(packageRoot, 'cli.mjs');
const runtimeBinary = process.env.SNAPBACK_RUNTIME_BINARY
  ?? join(repoRoot, 'target', 'debug', 'snapback');
assert.ok(
  existsSync(runtimeBinary),
  `native snapback binary missing at ${runtimeBinary}; run \`cargo build --bin snapback\` or set SNAPBACK_RUNTIME_BINARY`,
);

const sourceFixture = join(packageRoot, 'fixtures', 'comparator', 'app', 'snapback');
const generatedGovernanceFiles = Object.freeze(
  Object.values(GOVERNANCE_FILES).filter((path) => path.startsWith('generated/')),
);
const scratchRoot = realpathSync(mkdtempSync(join(tmpdir(), 'snapback-reset-dev-fresh-')));
const metroScript = join(scratchRoot, 'headless-metro.mjs');
const openHandles = [];

writeFileSync(metroScript, `
import { createServer } from 'node:http';
const port = Number(process.env.SNAPBACK_EXPO_METRO_PORT);
const server = createServer((_request, response) => {
  response.setHeader('content-type', 'application/json');
  response.end(JSON.stringify({ ok: true }));
});
server.listen(port, '127.0.0.1');
const stop = () => server.close(() => process.exit(0));
process.once('SIGTERM', stop);
process.once('SIGINT', stop);
`);

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

function fixture(name, { sessions = true } = {}) {
  const projectRoot = join(scratchRoot, name);
  const backendRoot = join(projectRoot, 'snapback');
  const expoRoot = join(projectRoot, 'app');
  cpSync(sourceFixture, backendRoot, { recursive: true });
  // @ref LLP 0234#d5--exact-ratchets-cover-overrides-and-ordinary-policy-widening —
  // fixture regeneration retains the governance baselines and ledgers that
  // authorize the generated schema/function pair.
  const governanceFiles = generatedGovernanceFiles.map((path) => [
    path,
    readFileSync(join(backendRoot, path)),
  ]);
  rmSync(join(backendRoot, 'generated'), { recursive: true, force: true });
  mkdirSync(join(backendRoot, 'generated'), { recursive: true });
  for (const [path, bytes] of governanceFiles) {
    writeFileSync(join(backendRoot, path), bytes);
  }
  mkdirSync(expoRoot, { recursive: true });
  const seedPath = join(backendRoot, 'seed.json');
  const seed = JSON.parse(readFileSync(seedPath, 'utf8'));
  seed.seedVersion = 'reset-dev-fresh-v1';
  writeFileSync(seedPath, `${JSON.stringify(seed, null, 2)}\n`);
  if (sessions) {
    const schemaPath = join(backendRoot, 'schema.mjs');
    const source = readFileSync(schemaPath, 'utf8');
    if (!/auth:\s*\{\s*mode:\s*['"]sessions['"]/u.test(source)) {
      const updated = source.replace(
        '  {\n    ephemeral: defineEphemeral({',
        "  {\n    auth: { mode: 'sessions' },\n    ephemeral: defineEphemeral({",
      );
      assert.notEqual(updated, source, 'sessions fixture must alter the schema auth mode');
      writeFileSync(schemaPath, updated);
    }
  }
  const stateRoot = join(projectRoot, '.snapback');
  return {
    projectRoot,
    backendRoot,
    expoRoot,
    stateRoot,
    readyFile: join(stateRoot, 'dev.ready.json'),
    supervisorFile: join(stateRoot, 'expo-supervisor.json'),
    database: join(stateRoot, 'dev.sqlite3'),
    schemaPath: join(backendRoot, 'schema.mjs'),
  };
}

function evolveSchema(target) {
  const source = readFileSync(target.schemaPath, 'utf8');
  const evolved = source.replace(
    'const valueTable = () => defineTable({ value: v.string() })\n  .visibility',
    "const valueTable = () => defineTable({ value: v.string() })\n  .index('by_value', ['value'])\n  .visibility",
  );
  assert.notEqual(evolved, source, 'schema evolution fixture must add an index');
  writeFileSync(target.schemaPath, evolved);
}

function parseJsonDocuments(output) {
  const documents = [];
  let start = null;
  let depth = 0;
  let inString = false;
  let escaped = false;
  for (let index = 0; index < output.length; index += 1) {
    const character = output[index];
    if (start === null) {
      if (character === '{') {
        start = index;
        depth = 1;
      }
      continue;
    }
    if (inString) {
      if (escaped) escaped = false;
      else if (character === '\\') escaped = true;
      else if (character === '"') inString = false;
      continue;
    }
    if (character === '"') inString = true;
    else if (character === '{') depth += 1;
    else if (character === '}') {
      depth -= 1;
      if (depth === 0) {
        documents.push(JSON.parse(output.slice(start, index + 1)));
        start = null;
      }
    }
  }
  return documents;
}

async function runCli(args, { cwd = scratchRoot, env = {} } = {}) {
  const child = spawn(process.execPath, [cli, ...args], {
    cwd,
    env: { ...process.env, SNAPBACK_RUNTIME_BINARY: runtimeBinary, ...env },
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  let stdout = '';
  let stderr = '';
  child.stdout.setEncoding('utf8');
  child.stderr.setEncoding('utf8');
  child.stdout.on('data', (chunk) => { stdout += chunk; });
  child.stderr.on('data', (chunk) => { stderr += chunk; });
  const timeout = setTimeout(() => child.kill('SIGKILL'), 180_000);
  const status = await new Promise((resolveExit, rejectExit) => {
    child.once('error', rejectExit);
    child.once('exit', (code) => resolveExit(code));
  });
  clearTimeout(timeout);
  return {
    status,
    stdout,
    stderr,
    documents: parseJsonDocuments(`${stdout}\n${stderr}`),
  };
}

async function closeDev(dev) {
  dev?.close?.();
  const child = dev?.child;
  if (child && child.exitCode === null && child.signalCode === null) {
    await eventually(
      () => child.exitCode !== null || child.signalCode !== null,
      { label: 'managed backend exit' },
    );
  }
}

function mintBearer(target, dev, email) {
  let operatorToken = managedAdminToken(readReadyDescriptor(target.readyFile), target.database);
  try {
    const authority = mintSupervisedOrdinarySession({
      runtimeBinary: dev.runtime.binary,
      readyFile: target.readyFile,
      email,
      operatorToken,
      cwd: target.projectRoot,
    });
    assert.equal(authority.status, 'ready');
    return authority.token;
  } finally {
    operatorToken = null;
  }
}

async function mintSupervisedBearer(supervisor) {
  const headers = { Origin: supervisor.metroOrigin };
  const bindingResponse = await fetch(
    `${supervisor.exchangeOrigin}${SUPERVISED_EXCHANGE_PATH}`,
    { headers },
  );
  assert.equal(bindingResponse.status, 200);
  const bindingExchange = await bindingResponse.json();
  assert.equal(bindingExchange.authority.status, 'unavailable');
  assert.equal(Object.hasOwn(bindingExchange.authority, 'token'), false);
  const adoptionResponse = await fetch(
    `${supervisor.exchangeOrigin}${SUPERVISED_EXCHANGE_PATH}?authority=mint`,
    {
      method: 'POST',
      headers: { ...headers, 'content-type': 'application/json' },
      body: JSON.stringify({ correlationId: bindingExchange.correlationId }),
    },
  );
  assert.equal(adoptionResponse.status, 200);
  const adoptionExchange = await adoptionResponse.json();
  assert.equal(adoptionExchange.authority.status, 'ready');
  return adoptionExchange;
}

async function seededRows(origin, bearer) {
  const client = createExternalSessionClient(origin, {
    bearerToken: bearer,
    rqsStore: null,
    offlineQueue: false,
  });
  try {
    return (await client.query('rejectionRows')).rows;
  } finally {
    await client.closeAuth?.();
  }
}

function assertListenerInventory(supervisor) {
  const owners = [...new Set(supervisor.listeners.map(({ owner }) => owner))].sort();
  assert(owners.includes('backend'));
  assert(owners.includes('bootstrap'));
  assert(owners.includes('metro'));
  assert(owners.every((owner) => ['backend', 'bootstrap', 'metro', 'metro-front'].includes(owner)));
  assert(supervisor.listeners.every(({ loopback }) => loopback === true));
}

try {
  // Standalone: an evolved Sessions schema gets a genuinely fresh database,
  // a versioned seed install, a verification mint, and a stopped-server report.
  const standalone = fixture('standalone');
  let first = await runDev({
    backendDirectory: standalone.backendRoot,
    projectRoot: standalone.projectRoot,
    readyFile: standalone.readyFile,
    database: standalone.database,
    runtimeBinary,
    watch: false,
    serverStdio: ['ignore', 'ignore', 'ignore'],
  });
  openHandles.push(first);
  assert.equal(first.state, 'generated-and-loaded', JSON.stringify(first.diagnostics ?? null));
  await closeDev(first);
  openHandles.splice(openHandles.indexOf(first), 1);
  first = null;
  evolveSchema(standalone);
  const standaloneCli = await runCli([
    'reset', standalone.backendRoot, '--dev-fresh',
    '--ready-file', standalone.readyFile,
    '--db', standalone.database,
    '--json',
  ], { cwd: standalone.projectRoot });
  assert.equal(standaloneCli.status, 0, standaloneCli.stderr);
  const standaloneReport = standaloneCli.documents.find(
    (document) => document.schemaVersion === 'snapback.reset-dev-fresh.v1',
  );
  assert.deepEqual(
    {
      mode: standaloneReport.mode,
      database: standaloneReport.database,
      seed: standaloneReport.seed,
      authority: standaloneReport.authority,
      server: standaloneReport.server,
    },
    {
      mode: 'standalone',
      database: 'fresh',
      seed: 'applied',
      authority: 'verified',
      server: 'stopped',
    },
  );
  assert.equal(existsSync(standalone.readyFile), false);

  const rebooted = await runDev({
    backendDirectory: standalone.backendRoot,
    projectRoot: standalone.projectRoot,
    readyFile: standalone.readyFile,
    database: standalone.database,
    runtimeBinary,
    watch: false,
    serverStdio: ['ignore', 'ignore', 'ignore'],
  });
  openHandles.push(rebooted);
  assert.equal(rebooted.state, 'generated-and-loaded');
  const rebootedBearer = mintBearer(standalone, rebooted, 'standalone-check@test.invalid');
  assert(
    (await seededRows(rebooted.serverUrl, rebootedBearer)).some(
      (row) => row._id === 'fixture_rejection_seed' && row.value === 'before',
    ),
    'the standalone successor must retain the declared seeded row',
  );
  await closeDev(rebooted);
  openHandles.splice(openHandles.indexOf(rebooted), 1);

  // Supervised: the control route is capability-protected, refreshes the
  // backend/binding/listener facts, and replaces the invalidated bearer.
  const supervised = fixture('supervised');
  const supervisor = await runExpoDev({
    backendDirectory: supervised.backendRoot,
    projectRoot: supervised.projectRoot,
    expoDirectory: supervised.expoRoot,
    readyFile: supervised.readyFile,
    database: supervised.database,
    runtimeBinary,
    platform: 'ios',
    email: 'supervised@test.invalid',
    metroCommand: { command: process.execPath, args: [metroScript] },
    serverStdio: ['ignore', 'ignore', 'ignore'],
  });
  openHandles.push(supervisor);
  assert.equal(supervisor.state, 'ready');
  assert.equal(existsSync(supervised.supervisorFile), true);
  assert.equal(statSync(supervised.supervisorFile).mode & 0o077, 0);
  assert.equal(readFileSync(supervised.supervisorFile, 'utf8').includes('token'), false);
  assertListenerInventory(supervisor);
  const firstExchange = await mintSupervisedBearer(supervisor);
  const bearer1 = firstExchange.authority.token;

  const unauthorized = await fetch(`${supervisor.exchangeOrigin}${SUPERVISED_CONTROL_PATH}`, {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      'x-snapback-operator-token': 'wrong-operator-token',
    },
    body: JSON.stringify({ verb: 'dev-fresh' }),
  });
  assert.equal(unauthorized.status, 401);
  assert.deepEqual(await unauthorized.json(), {
    ok: false,
    code: 'SNAPBACK_EXPO_CONTROL_UNAUTHORIZED',
  });
  let currentOperatorToken = managedAdminToken(
    readReadyDescriptor(supervised.readyFile),
    supervised.database,
  );
  const unknown = await fetch(`${supervisor.exchangeOrigin}${SUPERVISED_CONTROL_PATH}`, {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      'x-snapback-operator-token': currentOperatorToken,
    },
    body: JSON.stringify({ verb: 'unknown' }),
  });
  currentOperatorToken = null;
  assert.equal(unknown.status, 400);
  assert.deepEqual(await unknown.json(), {
    ok: false,
    code: 'SNAPBACK_EXPO_CONTROL_VERB_UNKNOWN',
    supported: ['dev-fresh', 'reload-metro', 'stop-children'],
  });

  evolveSchema(supervised);
  const supervisedCli = await runCli([
    'reset', supervised.backendRoot, '--dev-fresh',
    '--ready-file', supervised.readyFile,
    '--db', supervised.database,
    '--json',
  ], { cwd: supervised.projectRoot });
  assert.equal(supervisedCli.status, 0, supervisedCli.stderr);
  const supervisedReport = supervisedCli.documents.find(
    (document) => document.schemaVersion === 'snapback.reset-dev-fresh.v1',
  );
  assert.equal(supervisedReport.mode, 'supervised');
  assert.equal(supervisedReport.database, 'fresh');
  assert.equal(supervisedReport.seed, 'applied');
  assert.equal(supervisedReport.authority.status, 'ready');
  assert.equal(JSON.stringify(supervisedReport).includes(bearer1), false);
  const secondExchange = await mintSupervisedBearer(supervisor);
  const bearer2 = secondExchange.authority.token;
  assert.notEqual(bearer2, bearer1);
  assert.equal(JSON.stringify(supervisedReport).includes(bearer2), false);
  assert.equal(supervisor.state, 'ready');
  assert.equal(secondExchange.binding.target.origin, supervisedReport.backend.origin);
  assert.equal(supervisor.binding.target.origin, supervisedReport.backend.origin);
  assertListenerInventory(supervisor);

  const staleClient = createExternalSessionClient(supervisedReport.backend.origin, {
    bearerToken: bearer1,
    rqsStore: null,
    offlineQueue: false,
  });
  await assert.rejects(
    staleClient.query('rejectionRows'),
    (error) => (error?.code ?? error?.diagnostic?.code) === 'SNAPBACK_AUTH_REQUIRED',
  );
  await staleClient.closeAuth?.();
  assert(
    (await seededRows(supervisedReport.backend.origin, bearer2)).some(
      (row) => row._id === 'fixture_rejection_seed' && row.value === 'before',
    ),
    'the replacement bearer must read the declared seeded row',
  );
  await supervisor.close();
  openHandles.splice(openHandles.indexOf(supervisor), 1);
  assert.equal(existsSync(supervised.supervisorFile), false);

  // Packaged help is non-executing; all non-dev-fresh reset forms delegate
  // byte-for-byte; invalid packaged flags never touch the runtime.
  const mockRoot = join(scratchRoot, 'mock-runtime');
  mkdirSync(mockRoot, { recursive: true });
  const argvLog = join(mockRoot, 'argv.log');
  const mockRuntime = join(mockRoot, 'snapback-mock');
  writeFileSync(mockRuntime, `#!/bin/sh\nprintf '%s\\n' "$@" > ${JSON.stringify(argvLog)}\n`);
  chmodSync(mockRuntime, 0o755);
  const mockEnv = { SNAPBACK_RUNTIME_BINARY: mockRuntime };

  const resetHelp = await runCli(['reset', '--help'], { env: mockEnv });
  assert.equal(resetHelp.status, 0, resetHelp.stderr);
  assert.match(resetHelp.stdout, /Usage: snapback reset \[<backend-dir>\] --dev-fresh/u);
  assert.equal(existsSync(argvLog), false, 'packaged reset help must not execute native reset');

  const delegatedArgs = ['reset', '--seed', 'fixture.json', '--ready-file', 'native.ready.json'];
  const delegated = await runCli(delegatedArgs, { env: mockEnv });
  assert.equal(delegated.status, 0, delegated.stderr);
  assert.deepEqual(readFileSync(argvLog, 'utf8').trim().split('\n'), delegatedArgs);
  rmSync(argvLog, { force: true });

  const bogus = await runCli(['reset', '--dev-fresh', '--bogus-flag'], { env: mockEnv });
  assert.equal(bogus.status, 1);
  assert.equal(bogus.documents.at(-1).diagnostics[0].code, 'SNAPBACK_CLI_ARGUMENT_INVALID');
  assert.equal(existsSync(argvLog), false, 'argument refusal must not execute the runtime');

  const directoryDatabaseProject = join(scratchRoot, 'directory-database-refusal');
  const directoryDatabaseState = join(directoryDatabaseProject, '.snapback');
  const directoryDatabase = join(directoryDatabaseState, 'dev.sqlite3');
  const directoryDatabaseSentinel = join(directoryDatabase, 'keep-me.txt');
  mkdirSync(directoryDatabase, { recursive: true });
  writeFileSync(directoryDatabaseSentinel, 'preserve');
  const directoryDatabaseRefusal = await runCli([
    'reset', join(directoryDatabaseProject, 'snapback'), '--dev-fresh',
    '--db', directoryDatabase,
    '--json',
  ], { cwd: directoryDatabaseProject, env: mockEnv });
  assert.equal(directoryDatabaseRefusal.status, 1);
  assert.equal(
    directoryDatabaseRefusal.documents.at(-1).diagnostics[0].code,
    'SNAPBACK_RESET_DATABASE_PATH_INVALID',
  );
  assert.equal(
    directoryDatabaseRefusal.documents.at(-1).diagnostics[0].details.observedType,
    'directory',
  );
  assert.equal(readFileSync(directoryDatabaseSentinel, 'utf8'), 'preserve');
  assert.equal(existsSync(argvLog), false, 'directory-as-db refusal must not execute the runtime');

  const sharedDatabaseProject = join(scratchRoot, 'shared-database-refusal');
  const sharedStore = join(sharedDatabaseProject, 'stores');
  const sharedDatabase = join(sharedStore, 'first.sqlite3');
  const secondDatabase = join(sharedStore, 'second.sqlite3');
  const sharedBlob = join(sharedStore, 'assets', 'blobs', 'second-database-blob');
  const sharedMembers = [
    sharedDatabase,
    `${sharedDatabase}.auth-keyring.json`,
    secondDatabase,
    `${secondDatabase}.auth-keyring.json`,
    join(sharedStore, 'resume-keyring.json'),
    join(sharedStore, 'completeness-proof-keyring.json'),
    sharedBlob,
    join(sharedStore, 'keep-me.txt'),
  ];
  mkdirSync(dirname(sharedBlob), { recursive: true });
  for (const path of sharedMembers) writeFileSync(path, 'preserve');
  const sharedStoreRefusal = await runCli([
    'reset', join(sharedDatabaseProject, 'snapback'), '--dev-fresh',
    '--db', sharedDatabase,
    '--json',
  ], { cwd: sharedDatabaseProject, env: mockEnv });
  assert.equal(sharedStoreRefusal.status, 1);
  assert.equal(
    sharedStoreRefusal.documents.at(-1).diagnostics[0].code,
    'SNAPBACK_RESET_STORE_OWNERSHIP_AMBIGUOUS',
  );
  assert.deepEqual(
    sharedStoreRefusal.documents.at(-1).diagnostics[0].details.sharedMembers,
    ['assets/blobs', 'resume-keyring.json', 'completeness-proof-keyring.json'],
  );
  for (const path of sharedMembers) {
    assert.equal(readFileSync(path, 'utf8'), 'preserve', `shared-store refusal preserves ${path}`);
  }
  assert.equal(existsSync(argvLog), false, 'shared-store refusal must not execute the runtime');

  // A non-supervised live dev loop owns the target and must be driven through
  // its stdin verb instead of being raced by a second lifecycle owner.
  const active = fixture('active-loop');
  const activeDev = await runDev({
    backendDirectory: active.backendRoot,
    projectRoot: active.projectRoot,
    readyFile: active.readyFile,
    database: active.database,
    runtimeBinary,
    watch: true,
    serverStdio: ['ignore', 'ignore', 'ignore'],
  });
  openHandles.push(activeDev);
  const activeRefusal = await runCli([
    'reset', active.backendRoot, '--dev-fresh',
    '--ready-file', active.readyFile,
    '--db', active.database,
    '--json',
  ], { cwd: active.projectRoot });
  assert.equal(activeRefusal.status, 1);
  assert.equal(
    activeRefusal.documents.at(-1).diagnostics[0].code,
    'SNAPBACK_RESET_DEV_LOOP_ACTIVE',
  );
  await closeDev(activeDev);
  openHandles.splice(openHandles.indexOf(activeDev), 1);

  const stale = fixture('stale-supervisor', { sessions: false });
  mkdirSync(stale.stateRoot, { recursive: true });
  writeFileSync(stale.supervisorFile, `${JSON.stringify({
    formatVersion: 1,
    correlationId: 'stale',
    supervisorGeneration: 'stale',
    pid: 999_999,
    exchangeOrigin: 'http://127.0.0.1:9',
    controlPath: SUPERVISED_CONTROL_PATH,
    startedAt: new Date(0).toISOString(),
  })}\n`, { mode: 0o600 });
  const staleRefusal = await runCli([
    'reset', stale.backendRoot, '--dev-fresh',
    '--ready-file', stale.readyFile,
    '--db', stale.database,
    '--json',
  ], { cwd: stale.projectRoot });
  assert.equal(staleRefusal.status, 1);
  assert.equal(
    staleRefusal.documents.at(-1).diagnostics[0].code,
    'SNAPBACK_RESET_SUPERVISOR_STALE',
  );

  console.log('reset-dev-fresh.test.mjs: standalone reset, supervised coordination/auth boundary, control authorization, native delegation, and lifecycle refusals pass');
} finally {
  await Promise.allSettled(openHandles.map(async (handle) => handle.close?.()));
  rmSync(scratchRoot, { recursive: true, force: true });
}

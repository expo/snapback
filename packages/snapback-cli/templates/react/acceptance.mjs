import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { webcrypto } from 'node:crypto';
import { existsSync, mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';

import { createSnapbackAppClient } from '@expo/snapback-client';
import { IDBFactory } from 'fake-indexeddb';
import {
  createSnapbackReactProvider,
  invokeSnapbackMutation,
  observeSnapbackQueries,
} from '@expo/snapback-react';
import api, { app } from './snapback/generated/api.mjs';
import artifacts from './snapback/generated/artifacts.json' with { type: 'json' };
import functions from './snapback/generated/functions.manifest.json' with { type: 'json' };
import capabilityManifest from './snapback/generated/capability.manifest.json' with { type: 'json' };

// @ref LLP 0010#test-surfaces-and-harness — the generated default test owns
// a real isolated server, drives the product client, and cannot report a
// vacuous success. Static scaffold coherence lives in acceptance.static.mjs.

const EXPECTED_CHECKS = Object.freeze([
  'managed-lifecycle',
  'anonymous-ready',
  'password-signup-recovery',
  'password-signout',
  'password-signin',
  'artifact-identity',
  'query',
  'mutation-and-observation',
]);
const MAX_CHILD_OUTPUT_BYTES = 64 * 1024;
const root = resolve(import.meta.dirname);
const stateRoot = mkdtempSync(join(tmpdir(), 'snapback-react-acceptance-'));
const readyFile = join(stateRoot, 'dev.ready.json');
const database = join(stateRoot, 'dev.sqlite3');
const executable = join(
  root,
  'node_modules',
  '.bin',
  process.platform === 'win32' ? 'snapback.cmd' : 'snapback',
);
const child = spawn(executable, [
  'dev', 'snapback', '--db', database, '--ready-file', readyFile,
], {
  cwd: root,
  stdio: ['pipe', 'pipe', 'pipe'],
});

let stdout = '';
let stderr = '';
let stdoutRemainder = '';
const lifecycleEvents = [];
const checks = [];
const cleanup = {
  attempted: false,
  clientResourcesReleased: false,
  devExited: false,
  temporaryStateRemoved: false,
  ok: false,
};
let failure = null;
let observer = null;
let provider = null;
let client = null;
let appClient = null;
let childSpawnError = null;

const appendBounded = (current, chunk) =>
  `${current}${chunk.toString('utf8')}`.slice(-MAX_CHILD_OUTPUT_BYTES);

child.stdout.on('data', (chunk) => {
  const text = chunk.toString('utf8');
  stdout = appendBounded(stdout, chunk);
  stdoutRemainder = `${stdoutRemainder}${text}`.slice(-MAX_CHILD_OUTPUT_BYTES);
  for (;;) {
    const newline = stdoutRemainder.indexOf('\n');
    if (newline === -1) break;
    const line = stdoutRemainder.slice(0, newline).trim();
    stdoutRemainder = stdoutRemainder.slice(newline + 1);
    if (!line) continue;
    try {
      const event = JSON.parse(line);
      if (event?.schemaVersion === 'snapback.dev.v1') lifecycleEvents.push(event);
    } catch {
      // Non-event output is retained only in the bounded failure diagnostic.
    }
  }
});
child.stderr.on('data', (chunk) => { stderr = appendBounded(stderr, chunk); });
child.on('error', (error) => { childSpawnError = error; });

const waitForApplicationReady = async () => {
  // @ref LLP 0224#phases — Phase 1 proof: the harness waits on the application-readiness receipt; the first authority-bearing call runs un-retried.
  const waiter = spawn(executable, [
    'wait', '--ready-file', readyFile,
    '--level', 'application', '--timeout-ms', '60000',
  ], {
    cwd: root,
    env: process.env,
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  let waitStdout = '';
  let waitStderr = '';
  waiter.stdout.on('data', (chunk) => { waitStdout = appendBounded(waitStdout, chunk); });
  waiter.stderr.on('data', (chunk) => { waitStderr = appendBounded(waitStderr, chunk); });
  const exit = await new Promise((resolveExit, reject) => {
    waiter.once('error', reject);
    waiter.once('close', (code, signal) => resolveExit({ code, signal }));
  });
  let envelope = null;
  try { envelope = JSON.parse(waitStdout); } catch {}
  if (exit.code !== 0) {
    throw new Error(
      `application readiness wait failed (${exit.code ?? exit.signal}): ${JSON.stringify(envelope?.diagnostics ?? waitStdout.trim())}${waitStderr ? `\n${waitStderr}` : ''}`,
    );
  }
  assert.equal(envelope?.ok, true, `application readiness wait returned an invalid envelope: ${waitStdout}`);
};

const until = async (predicate, label, timeoutMs = 30_000) => {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    if (childSpawnError) throw childSpawnError;
    const value = await predicate();
    if (value) return value;
    if (child.exitCode !== null) {
      throw new Error(`${label}: dev exited ${child.exitCode}\n${stdout}\n${stderr}`);
    }
    await new Promise((resolveWait) => setTimeout(resolveWait, 25));
  }
  throw new Error(`${label}: timed out\n${stdout}\n${stderr}`);
};

const pass = (id, details = null) => {
  assert.equal(EXPECTED_CHECKS[checks.length], id, `unexpected acceptance check order: ${id}`);
  checks.push({ id, status: 'passed', details });
};

const waitForExit = async (timeoutMs) => {
  const deadline = Date.now() + timeoutMs;
  while (child.exitCode === null && child.signalCode === null && Date.now() < deadline) {
    await new Promise((resolveWait) => setTimeout(resolveWait, 25));
  }
  return child.exitCode !== null || child.signalCode !== null;
};

try {
  await waitForApplicationReady();
  if (childSpawnError) throw childSpawnError;
  const ready = JSON.parse(readFileSync(readyFile, 'utf8'));
  assert.equal(ready.ready, true);
  pass('managed-lifecycle', {
    owned: true,
    applicationReadyObserved: true,
    waitLevel: 'application',
    firstQueryRetries: 0,
  });

  const now = Date.now();
  const binding = Object.freeze({
    format: 'snapback.app-binding.v1',
    source: 'supervised-dev',
    descriptorIdentity: app.identity.descriptor,
    target: Object.freeze({
      app: app.identity.app,
      schema: app.identity.schema,
      functions: app.identity.functions,
      origin: ready.serverUrl,
      routing: 'loopback',
    }),
    capabilities: Object.freeze({
      offered: Object.freeze([...new Set([
        ...app.capabilities.required,
        'auth.passwords',
      ])].sort()),
    }),
    provenance: Object.freeze({
      supervisorGeneration: `react-starter-acceptance-${process.pid}`,
      issuedAt: new Date(now - 60_000).toISOString(),
      expiresAt: new Date(now + 60 * 60_000).toISOString(),
    }),
    integrity: Object.freeze({ channel: 'local-supervised-ipc' }),
  });
  appClient = await createSnapbackAppClient({
    app,
    binding,
    platform: Object.freeze({
      kind: 'browser',
      indexedDB: new IDBFactory(),
      lockManager: Object.freeze({ request: (_name, _options, operation) => operation() }),
      cryptoObject: webcrypto,
      databaseName: `snapback-react-starter-acceptance-${process.pid}`,
    }),
    now: () => now,
  });
  client = appClient.client;
  assert.equal(appClient.bootstrapState().status, 'ready');
  assert.equal(appClient.auth.currentPrincipal().status, 'anonymous');
  pass('anonymous-ready', { custody: appClient.bootstrapState().custody.carrier });

  const identity = `react-starter-${process.pid}@example.com`;
  const password = 'react-starter-password';
  const signup = await appClient.auth.signUpWithPassword({ email: identity, password });
  assert.equal(signup.recoveryCodes.length, 8);
  assert.equal(Object.hasOwn(signup, 'token'), false);
  assert.equal(appClient.auth.currentPrincipal().status, 'authenticated');
  pass('password-signup-recovery', { recoveryCodeCount: signup.recoveryCodes.length });
  await appClient.auth.signOut();
  assert.equal(appClient.auth.currentPrincipal().status, 'anonymous');
  pass('password-signout');
  const signin = await appClient.auth.signInWithPassword({ email: identity, password });
  assert.equal(Object.hasOwn(signin, 'recoveryCodes'), false);
  assert.equal(appClient.auth.currentPrincipal().status, 'authenticated');
  pass('password-signin', { userId: signin.session.userId });
  const initial = await client.query(api.listTodos, { args: {} });
  assert(Array.isArray(initial.rows));
  const inspected = await client.inspect();
  assert.equal(inspected.functions?.appId, artifacts.appId);
  assert.equal(inspected.functions?.bundleHash, artifacts.bundleHash);
  pass('artifact-identity', {
    appId: artifacts.appId,
    bundleHash: artifacts.bundleHash,
  });

  const preparedBinding = await client.prepareReactBinding({
    generatedManifest: { functions, capabilityManifest },
  });
  provider = createSnapbackReactProvider(preparedBinding, {
    connectionId: 'react_starter_acceptance',
  });
  let latest = null;
  observer = observeSnapbackQueries(provider, {
    todos: { ref: api.listTodos, args: {} },
  }, (snapshot) => { latest = snapshot; });
  await until(() => latest?.queries.todos.status === 'ready', 'initial React starter query');
  pass('query', { functionId: api.listTodos.id, rowCount: latest.queries.todos.data.length });

  const title = `Generated acceptance ${process.pid}`;
  const created = await invokeSnapbackMutation(provider, api.createTodo, { title });
  assert.equal(created.status, 'settled');
  assert.equal(typeof created.result, 'string');
  await until(
    () => latest?.queries.todos.status === 'ready'
      && latest.queries.todos.data.some((row) => row.title === title),
    'React starter mutation observation',
  );
  pass('mutation-and-observation', {
    functionId: api.createTodo.id,
    observedBy: api.listTodos.id,
  });
} catch (error) {
  failure = {
    code: error?.diagnostic?.code ?? error?.code ?? 'SNAPBACK_STARTER_ACCEPTANCE_FAILED',
    message: String(error?.message ?? error).slice(0, 4_096),
  };
} finally {
  cleanup.attempted = true;
  try {
    observer?.dispose();
    observer = null;
    await provider?.dispose();
    if (provider) {
      assert.deepEqual(
        {
          stores: provider.inspection().stores,
          consumers: provider.inspection().consumers,
          subscriptions: provider.inspection().serverSubscriptions,
          leases: provider.inspection().leases,
          timers: provider.inspection().timers,
          listeners: provider.inspection().listeners,
        },
        { stores: 0, consumers: 0, subscriptions: 0, leases: 0, timers: 0, listeners: 0 },
      );
    }
    if (client) assert.equal((await client.inspect()).subscriptions.length, 0);
    await appClient?.dispose();
    appClient = null;
    cleanup.clientResourcesReleased = true;
  } catch (error) {
    failure ??= {
      code: error?.code ?? 'SNAPBACK_STARTER_ACCEPTANCE_CLEANUP_FAILED',
      message: String(error?.message ?? error).slice(0, 4_096),
    };
  }

  if (child.exitCode === null && child.signalCode === null) child.kill('SIGTERM');
  if (!(await waitForExit(10_000))) child.kill('SIGKILL');
  cleanup.devExited = await waitForExit(5_000);
  if (!cleanup.devExited) {
    failure ??= {
      code: 'SNAPBACK_STARTER_ACCEPTANCE_CLEANUP_FAILED',
      message: 'managed dev process did not exit during bounded cleanup',
    };
  }
  try {
    rmSync(stateRoot, { recursive: true, force: true });
    cleanup.temporaryStateRemoved = !existsSync(stateRoot);
  } catch (error) {
    failure ??= {
      code: 'SNAPBACK_STARTER_ACCEPTANCE_CLEANUP_FAILED',
      message: String(error?.message ?? error).slice(0, 4_096),
    };
  }
  cleanup.ok = cleanup.clientResourcesReleased
    && cleanup.devExited
    && cleanup.temporaryStateRemoved
    && failure === null;
}

const passed = failure === null
  && checks.length === EXPECTED_CHECKS.length
  && EXPECTED_CHECKS.every((id, index) => checks[index]?.id === id)
  && cleanup.ok;
const receipt = {
  schemaVersion: 'snapback.starter-acceptance.v1',
  status: passed ? 'passed' : 'failed',
  expectedCheckCount: EXPECTED_CHECKS.length,
  executedCheckCount: checks.length,
  checks,
  identity: {
    artifact: {
      appId: artifacts.appId,
      inputsHash: artifacts.inputsHash,
      schemaHash: artifacts.schemaHash,
      bundleHash: artifacts.bundleHash,
    },
    loaded: checks.find(({ id }) => id === 'artifact-identity')?.details ?? null,
  },
  lifecycle: checks.find(({ id }) => id === 'managed-lifecycle')?.details ?? {
    owned: true,
    readyDescriptorObserved: false,
    generatedAndLoadedObserved: false,
  },
  operations: {
    queryFunctionId: api.listTodos.id,
    mutationFunctionId: api.createTodo.id,
  },
  cleanup,
  diagnostic: failure,
};
process.stdout.write(`${JSON.stringify(receipt)}\n`);
process.exitCode = passed ? 0 : 1;

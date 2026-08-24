import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { webcrypto } from 'node:crypto';
import { existsSync, mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';

import { SnapbackClient, createSnapbackAppClient } from '@expo/snapback-client';
import api, { app } from './snapback/generated/api.mjs';
import artifacts from './snapback/generated/artifacts.json' with { type: 'json' };

// @ref LLP 0010#first-acceptance-app — the generated todo default proves a
// real query and mutation against an owned isolated target. Static artifact
// checks are deliberately separate in acceptance.static.mjs.

const EXPECTED_CHECKS = Object.freeze([
  'managed-lifecycle',
  'headless-app-auth',
  'artifact-identity',
  'query',
  'mutation-and-observation',
]);
const MAX_CHILD_OUTPUT_BYTES = 64 * 1024;
const root = resolve(import.meta.dirname);
const stateRoot = mkdtempSync(join(tmpdir(), 'snapback-todo-acceptance-'));
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
const checks = [];
const cleanup = {
  attempted: false,
  clientResourcesReleased: false,
  devExited: false,
  temporaryStateRemoved: false,
  ok: false,
};
let failure = null;
let client = null;
let appAuthClient = null;
let childSpawnError = null;

const appendBounded = (current, chunk) =>
  `${current}${chunk.toString('utf8')}`.slice(-MAX_CHILD_OUTPUT_BYTES);

child.stdout.on('data', (chunk) => { stdout = appendBounded(stdout, chunk); });
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

  process.env.SNAPBACK_URL = ready.serverUrl;
  appAuthClient = await createSnapbackAppClient({
    app,
    url: process.env.SNAPBACK_URL,
    streamless: true,
    platform: { kind: 'memory', cryptoObject: webcrypto },
    storagePartition: `todo-contract-headless-${process.pid}`,
    rqsStore: null,
  });
  const signup = await appAuthClient.auth.signUpWithPassword({
    email: `todo-contract-headless-${process.pid}@example.com`,
    password: 'todo-contract-headless-password',
  });
  assert.equal(signup.session.userId, appAuthClient.auth.currentPrincipal().userId);
  pass('headless-app-auth', {
    streamless: true,
    principal: appAuthClient.auth.currentPrincipal().status,
  });

  const adminToken = readFileSync(ready.adminTokenFile, 'utf8').trim();
  client = new SnapbackClient(ready.serverUrl, {
    adminToken,
    rqsStore: null,
    offlineQueue: false,
  });
  const userId = 'generated_acceptance_user';
  const before = await client.query(api.listTodos, { userId });
  assert(Array.isArray(before.rows));
  const inspected = await client.inspect();
  assert.equal(inspected.functions?.appId, artifacts.appId);
  assert.equal(inspected.functions?.bundleHash, artifacts.bundleHash);
  pass('artifact-identity', {
    appId: artifacts.appId,
    bundleHash: artifacts.bundleHash,
  });

  pass('query', { functionId: api.listTodos.id, rowCount: before.rows.length });

  const title = `Generated acceptance ${process.pid}`;
  const mutation = await client.mutate(api.createTodo, {
    args: { title },
    userId,
    clientMutationId: `generated-acceptance-${process.pid}`,
  });
  assert.equal(mutation.changed_count, 1);
  const after = await client.query(api.listTodos, { userId });
  assert(after.rows.some((row) => row.title === title));
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
    await appAuthClient?.dispose();
    appAuthClient = null;
    if (client) assert.equal((await client.inspect()).subscriptions.length, 0);
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
    applicationReadyObserved: false,
    waitLevel: 'application',
    firstQueryRetries: 0,
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

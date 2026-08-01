#!/usr/bin/env node

import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { createHash } from 'node:crypto';
import {
  access,
  mkdir,
  readFile,
  rm,
  stat,
  writeFile,
} from 'node:fs/promises';
import { dirname, join, resolve } from 'node:path';
import { setTimeout as delay } from 'node:timers/promises';
import { fileURLToPath } from 'node:url';
import os from 'node:os';

// Observed-at-runtime host facts for performance receipts. Receipts carry
// only these derived fields for machine identity, so a hardcoded profile
// cannot contradict the host the samples actually ran on.
function observedMachineContext() {
  return {
    platform: os.platform(),
    arch: os.arch(),
    cpuModel: os.cpus()[0]?.model ?? 'unknown',
    cpuCount: os.cpus().length,
    totalMemoryBytes: os.totalmem(),
    nodeVersion: process.version,
  };
}

import { chromium } from 'playwright-core';

import { SnapbackClient, createExternalSessionClient } from '../../../../../../_kit/client.mjs';
import { freePort } from '../../../../../../_kit/provenance.mjs';
import { startServer } from '../../../../../../_kit/server-process.mjs';
import {
  AuthCoordinator,
  createMemoryAuthCustodyStorage,
} from '../../../../../../../packages/snapback-contract/index.mjs';

import api from '../snapback/generated/api.mjs';
import { TODO_FIXTURE } from '../snapback/seed.mjs';

const here = dirname(fileURLToPath(import.meta.url));
const workRoot = resolve(here, '..');
const armRoot = resolve(workRoot, '..');
const repoRoot = resolve(workRoot, '../../../../../../');
const receiptsRoot = process.env.SNAPBACK_BAKEOFF_RECEIPTS_ROOT
  ? resolve(process.env.SNAPBACK_BAKEOFF_RECEIPTS_ROOT)
  : join(armRoot, 'receipts');
const runtimeRoot = process.env.SNAPBACK_BAKEOFF_RUNTIME_ROOT
  ? resolve(process.env.SNAPBACK_BAKEOFF_RUNTIME_ROOT)
  : join(workRoot, '.arm-runtime');
const publicPersonasPath = join(workRoot, 'public', 'personas.json');
const builtPersonasPath = join(workRoot, 'dist', 'personas.json');
const generatedRoot = join(workRoot, 'snapback', 'generated');
const dbPath = join(runtimeRoot, 'todo.sqlite');
const startupArtifactsPath = join(runtimeRoot, 'startup-artifacts.json');
const chromePath = '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome';

const startedAt = new Date().toISOString();
const startedMonotonic = performance.now();
const sha256 = (value) => createHash('sha256').update(value).digest('hex');
const readJson = async (path) => JSON.parse(await readFile(path, 'utf8'));
const exists = async (path) => access(path).then(() => true, () => false);
const writeJson = async (path, value) => {
  await mkdir(dirname(path), { recursive: true });
  await writeFile(path, `${JSON.stringify(value, null, 2)}\n`);
};

function diagnosticCode(error) {
  return error?.diagnostic?.code ?? error?.code ?? error?.message ?? 'unknown';
}

async function eventually(assertion, label, timeoutMs = 8_000) {
  const deadline = Date.now() + timeoutMs;
  let lastError = null;
  while (Date.now() < deadline) {
    try {
      return assertion();
    } catch (error) {
      lastError = error;
      await delay(20);
    }
  }
  throw new Error(`${label}: ${lastError?.message ?? 'timed out'}`);
}

function statistics(samples) {
  const ordered = [...samples].sort((a, b) => a - b);
  return {
    rawMs: samples.map((value) => Number(value.toFixed(3))),
    medianMs: Number(ordered[Math.floor(ordered.length / 2)].toFixed(3)),
    nearestRankP95Ms: Number(ordered[Math.ceil(ordered.length * 0.95) - 1].toFixed(3)),
  };
}

async function timedSamples(operation) {
  for (let index = 0; index < 2; index += 1) await operation(index, true);
  const samples = [];
  for (let index = 0; index < 7; index += 1) {
    const start = performance.now();
    await operation(index, false);
    samples.push(performance.now() - start);
  }
  return statistics(samples);
}

async function runCommand(command, args, options = {}) {
  const start = performance.now();
  return await new Promise((resolvePromise, reject) => {
    const child = spawn(command, args, {
      cwd: options.cwd ?? workRoot,
      env: { ...process.env, ...(options.env ?? {}) },
      stdio: options.stdio ?? ['ignore', 'pipe', 'pipe'],
      detached: false,
    });
    let stdout = '';
    let stderr = '';
    child.stdout?.on('data', (chunk) => { stdout += chunk; });
    child.stderr?.on('data', (chunk) => { stderr += chunk; });
    child.on('error', reject);
    child.on('close', (code, signal) => resolvePromise({
      command: [command, ...args].join(' '),
      code,
      signal,
      durationMs: performance.now() - start,
      stdout,
      stderr,
    }));
  });
}

async function mintSession(server, appId, id, email) {
  const custodyState = {};
  const coordinator = new AuthCoordinator({
    appId,
    storage: createMemoryAuthCustodyStorage({ state: custodyState }),
    broadcastChannelFactory: null,
    hintStorage: null,
  });
  const clientStoreId = `llp0102-todo-${id}`;
  const client = new SnapbackClient(server.baseUrl, {
    authCoordinator: coordinator,
    authInvalidationProtocol: 1,
    authorityDescriptorProtocol: 1,
    authorizedLeaseProtocol: 1,
    clientStoreId,
  });
  const requested = await client.authRequestCode(email);
  const mailboxResponse = await fetch(
    `${server.baseUrl}/_snapback/api/auth/mailbox?challengeId=${encodeURIComponent(requested.challengeId)}`,
    {
      headers: {
        'x-snapback-admin-token': server.adminToken,
        'x-snapback-impersonation-capability': server.impersonationCapability,
      },
    },
  );
  const mailbox = await mailboxResponse.json();
  assert.equal(mailboxResponse.status, 200, JSON.stringify(mailbox));
  const credential = await client.authExchange({
    challengeId: requested.challengeId,
    code: mailbox.code,
  });
  const capture = coordinator.capture();
  const bearer = coordinator.credentialFor(capture).bearer;
  return {
    id,
    email,
    client,
    coordinator,
    credential,
    userId: credential.session.userId,
    bearer,
    clientStoreId,
  };
}

function externalSession(server, session, suffix = '') {
  return createExternalSessionClient(server.baseUrl, {
    bearerToken: session.bearer,
    clientStoreId: `${session.clientStoreId}${suffix}`,
  });
}

async function expectDenied(operation, label) {
  await assert.rejects(operation, (error) => {
    assert.equal(diagnosticCode(error), 'SNAPBACK_AUTH_PERMISSION_DENIED', label);
    return true;
  });
}

async function startVite() {
  const port = await freePort();
  const child = spawn(
    process.execPath,
    [join(workRoot, 'node_modules', 'vite', 'bin', 'vite.js'), '--host', '127.0.0.1', '--port', String(port), '--strictPort'],
    {
      cwd: workRoot,
      env: process.env,
      stdio: ['ignore', 'pipe', 'pipe'],
    },
  );
  let stderr = '';
  child.stderr.on('data', (chunk) => { stderr += chunk; });
  const origin = `http://127.0.0.1:${port}`;
  const deadline = Date.now() + 15_000;
  while (Date.now() < deadline) {
    if (child.exitCode !== null) throw new Error(`Vite exited ${child.exitCode}: ${stderr}`);
    try {
      const response = await fetch(origin);
      if (response.ok) return { child, origin };
    } catch {
      // Retry until the owned process serves.
    }
    await delay(50);
  }
  child.kill('SIGTERM');
  throw new Error(`Vite did not become ready: ${stderr}`);
}

async function stopChild(child) {
  if (!child || child.exitCode !== null) return;
  await new Promise((resolvePromise) => {
    child.once('close', resolvePromise);
    child.kill('SIGTERM');
    setTimeout(() => {
      if (child.exitCode === null) child.kill('SIGKILL');
    }, 2_000).unref();
  });
}

const scenarioResults = new Map();
const recordPass = (id, evidence, note = '') => scenarioResults.set(id, {
  id,
  status: 'pass',
  evidence,
  note,
});
const recordGap = (id, evidence, note) => scenarioResults.set(id, {
  id,
  status: 'gap',
  evidence,
  note,
});
const recordFail = (id, evidence, note) => scenarioResults.set(id, {
  id,
  status: 'fail',
  evidence,
  note,
});

let server = null;
let vite = null;
let browser = null;
const contexts = [];
const sessionOwners = [];
const extraClients = [];
const liveHandles = [];
let cleanupReceipt = null;
let primaryError = null;

try {
  assert.equal(await exists(runtimeRoot), false, 'fresh local target directory already exists');
  await mkdir(runtimeRoot, { recursive: false });
  await mkdir(receiptsRoot, { recursive: true });
  await mkdir(dirname(publicPersonasPath), { recursive: true });

  const schema = await readJson(join(generatedRoot, 'schema.manifest.json'));
  const functions = await readJson(join(generatedRoot, 'functions.manifest.json'));
  const artifacts = await readJson(join(generatedRoot, 'artifacts.json'));
  const contractManifest = await readJson(join(generatedRoot, 'contract-data.manifest.json'));
  await writeJson(startupArtifactsPath, { formatVersion: 1, schema, functions });

  const port = await freePort();
  server = await startServer({
    port,
    bindPortExactly: true,
    db: dbPath,
    cwd: repoRoot,
    startupArtifacts: startupArtifactsPath,
    captureImpersonationCapability: true,
    provenance: {
      appId: schema.appId,
      artifactsPath: join(generatedRoot, 'artifacts.json'),
    },
  });
  const targetIdentity = sha256(JSON.stringify({
    appId: schema.appId,
    port,
    dbPath,
    inputsHash: artifacts.inputsHash,
  }));

  const alice = await mintSession(server, schema.appId, 'alice', 'alice@llp0102.snapback.test');
  const bob = await mintSession(server, schema.appId, 'bob', 'bob@llp0102.snapback.test');
  const mallory = await mintSession(server, schema.appId, 'mallory', 'mallory@llp0102.snapback.test');
  const aliceLogout = await mintSession(server, schema.appId, 'alice-logout', 'alice@llp0102.snapback.test');
  sessionOwners.push(alice, bob, mallory, aliceLogout);
  assert.equal(alice.userId, aliceLogout.userId, 'same email did not resolve the same principal');

  const aliceClient = externalSession(server, alice, '-primary');
  const bobClient = externalSession(server, bob, '-primary');
  const malloryClient = externalSession(server, mallory, '-primary');
  extraClients.push(aliceClient, bobClient, malloryClient);

  const primaryBootstrap = await aliceClient.mutate(api.bootstrapWorkspace, {
    args: {
      name: 'Primary workspace',
      seedPrimary: true,
      bobId: bob.userId,
    },
  });
  const primaryWorkspaceId = primaryBootstrap.result;
  assert.equal(typeof primaryWorkspaceId, 'string');
  const secondaryBootstrap = await aliceClient.mutate(api.bootstrapWorkspace, {
    args: {
      name: 'Secondary workspace',
      seedPrimary: false,
      bobId: bob.userId,
    },
  });
  const secondaryWorkspaceId = secondaryBootstrap.result;
  assert.equal(typeof secondaryWorkspaceId, 'string');
  assert.notEqual(primaryWorkspaceId, secondaryWorkspaceId);
  await aliceClient.mutate(api.addMember, {
    args: { workspaceId: primaryWorkspaceId, userId: bob.userId },
  });
  await aliceClient.mutate(api.addMember, {
    args: { workspaceId: secondaryWorkspaceId, userId: bob.userId },
  });

  const aliceSeed = await aliceClient.query(api.listTasks, { args: { workspaceId: primaryWorkspaceId } });
  const bobSeed = await bobClient.query(api.listTasks, { args: { workspaceId: primaryWorkspaceId } });
  const lists = await aliceClient.query(api.listLists, { args: { workspaceId: primaryWorkspaceId } });
  assert.equal(aliceSeed.rows.length, 100);
  assert.equal(bobSeed.rows.length, 100);
  assert.deepEqual(lists.rows.map(({ position }) => position), [0, 1, 2, 3]);
  for (const list of lists.rows) {
    assert.equal(aliceSeed.rows.filter((task) => task.listId === list._id).length, 25);
  }
  recordPass('TODO-01-SEED', {
    targetIdentity,
    workspaces: TODO_FIXTURE.workspaces,
    lists: TODO_FIXTURE.listNames.length,
    tasks: TODO_FIXTURE.listNames.length * TODO_FIXTURE.tasksPerList,
    bootstrapReceipts: [primaryBootstrap.receipt, secondaryBootstrap.receipt],
    serverOwnedWorkspaceIdHashes: [
      sha256(primaryWorkspaceId),
      sha256(secondaryWorkspaceId),
    ],
    principalIdHashes: {
      alice: sha256(alice.userId),
      bob: sha256(bob.userId),
      mallory: sha256(mallory.userId),
    },
  });
  recordPass('TODO-02-MEMBER-READ', {
    aliceRows: aliceSeed.rows.length,
    bobRows: bobSeed.rows.length,
    serverDerivedPrincipals: true,
  });

  await expectDenied(
    () => malloryClient.query(api.listTasks, { args: { workspaceId: primaryWorkspaceId } }),
    'Mallory query was not denied',
  );
  await expectDenied(
    () => malloryClient.liveQuery(api.listTasks, {
      args: { workspaceId: primaryWorkspaceId },
      transport: 'stream',
      fallbackToPoll: false,
      connectionId: 'llp0102-mallory-negative',
    }),
    'Mallory subscription was not denied',
  );
  recordPass('TODO-03-OUTSIDER-REFUSAL', {
    queryDiagnostic: 'SNAPBACK_AUTH_PERMISSION_DENIED',
    subscriptionDiagnostic: 'SNAPBACK_AUTH_PERMISSION_DENIED',
    retainedRows: 0,
  });

  const firstListId = lists.rows[0]._id;
  const first = aliceSeed.rows
    .filter((task) => task.listId === firstListId)
    .sort((a, b) => a.position - b.position || a._id.localeCompare(b._id))[0];
  assert(first);
  const created = await aliceClient.mutate(api.createTask, {
    args: {
      workspaceId: primaryWorkspaceId,
      listId: firstListId,
      title: 'CRUD marker',
      assigneeId: bob.userId,
      dueDate: '2026-08-31',
      position: 25,
    },
  });
  const createdId = created.result;
  assert.equal(typeof createdId, 'string');
  await aliceClient.mutate(api.editTask, { args: { id: createdId, title: 'CRUD edited' } });
  await aliceClient.mutate(api.editTask, { args: { id: createdId, completed: true } });
  await aliceClient.mutate(api.editTask, { args: { id: createdId, completed: false } });
  await aliceClient.mutate(api.reorderTask, { args: { id: createdId, targetIndex: 0 } });
  let crudRows = (await aliceClient.query(api.listTasks, { args: { workspaceId: primaryWorkspaceId } })).rows;
  const crud = crudRows.find((task) => task._id === createdId);
  assert.equal(crud.title, 'CRUD edited');
  assert.equal(crud.completed, false);
  assert.equal(crud.position, 0);
  await aliceClient.mutate(api.deleteTask, { args: { id: createdId } });
  crudRows = (await aliceClient.query(api.listTasks, { args: { workspaceId: primaryWorkspaceId } })).rows;
  assert.equal(crudRows.length, 100);
  assert.equal(crudRows.some((task) => task._id === createdId), false);
  recordPass('TODO-04-CRUD', {
    createReceipt: created.receipt,
    transitions: ['create', 'edit', 'complete', 'reopen', 'reorder', 'delete'],
    authoritativeFinalCount: crudRows.length,
  });

  const bobLive = await bobClient.liveQuery(api.listTasks, {
    args: { workspaceId: primaryWorkspaceId },
    transport: 'stream',
    fallbackToPoll: false,
    connectionId: 'llp0102-bob-push',
  });
  liveHandles.push(bobLive);
  const pushTitle = `Push ${Date.now()}`;
  await aliceClient.mutate(api.editTask, { args: { id: first._id, title: pushTitle } });
  await eventually(() => {
    assert.equal(bobLive.rows.find((task) => task._id === first._id)?.title, pushTitle);
  }, 'Bob did not receive stream update');
  recordPass('TODO-05-PUSH', {
    transport: 'Snapback durable WebSocket stream',
    fallbackToPoll: false,
    secondClient: 'bob',
    authoritativeTitle: pushTitle,
  });

  await writeJson(publicPersonasPath, {
    baseUrl: server.baseUrl,
    primaryWorkspaceId,
    personas: [alice, bob, mallory].map((session) => ({
      id: session.id,
      name: session.id[0].toUpperCase() + session.id.slice(1),
      userId: session.userId,
      bearerToken: session.bearer,
    })),
  });
  vite = await startVite();
  browser = await chromium.launch({ executablePath: chromePath, headless: true });
  for (const persona of ['alice', 'bob', 'mallory']) {
    const context = await browser.newContext();
    contexts.push(context);
    const page = await context.newPage();
    await page.goto(vite.origin);
    await page.getByTestId('persona-switcher').selectOption(persona);
    if (persona === 'mallory') {
      await page.getByTestId('todo-access-denied').waitFor({ timeout: 15_000 });
    } else {
      await page.locator('[data-testid^="todo-task-"]').first().waitFor({ timeout: 15_000 });
      assert.equal(await page.locator('[data-testid^="todo-task-"]').count(), 25);
      await page.getByTestId('connection-state').filter({ hasText: 'live' }).waitFor({ timeout: 15_000 });
    }
  }

  for (const handle of liveHandles.splice(0)) await handle.dispose();
  for (const context of contexts.splice(0)) await context.close();
  await browser.close();
  browser = null;
  await stopChild(vite.child);
  vite = null;

  const warmRows = (await aliceClient.query(api.listTasks, { args: { workspaceId: primaryWorkspaceId } })).rows;
  assert.equal(warmRows.length, 100);
  await server.stop();
  server = null;

  const offlineClient = createExternalSessionClient(`http://127.0.0.1:${port}`, {
    bearerToken: alice.bearer,
    clientStoreId: 'llp0102-offline-cold',
  });
  await assert.rejects(
    () => offlineClient.query(api.listTasks, { args: { workspaceId: primaryWorkspaceId } }),
    /fetch failed|ECONNREFUSED/,
  );
  await assert.rejects(
    () => offlineClient.mutate(api.createTask, {
      args: {
        workspaceId: primaryWorkspaceId,
        listId: firstListId,
        title: 'Offline create must not queue',
        assigneeId: alice.userId,
        dueDate: '2026-08-31',
        position: 25,
      },
    }),
    /fetch failed|ECONNREFUSED/,
  );
  extraClients.push(offlineClient);
  const offlineEvidence = {
    contractCapabilities: contractManifest.capabilities,
    queryLocalRunnable: contractManifest.queries.listTasks.localRunnable,
    queryRetainable: false,
    coldRows: 0,
    queuedMutations: 0,
    observedErrors: ['network unavailable'],
  };
  recordGap(
    'TODO-06-OFFLINE-BOOT',
    offlineEvidence,
    'The shipped shared-workspace query is membership-gated; v1 refuses retained role-gated results and the React surface is Online-class.',
  );
  recordGap(
    'TODO-07-OFFLINE-WRITES',
    offlineEvidence,
    'The JS membership-protected mutations are not locally runnable; no durable outbox is exposed through the React Online surface.',
  );

  server = await startServer({
    port,
    bindPortExactly: true,
    db: dbPath,
    cwd: repoRoot,
    startupArtifacts: startupArtifactsPath,
    captureImpersonationCapability: true,
    provenance: {
      appId: schema.appId,
      artifactsPath: join(generatedRoot, 'artifacts.json'),
    },
  });
  const aliceAfterRestart = externalSession(server, alice, '-restart');
  const bobAfterRestart = externalSession(server, bob, '-restart');
  extraClients.push(aliceAfterRestart, bobAfterRestart);
  const afterOffline = await aliceAfterRestart.query(api.listTasks, {
    args: { workspaceId: primaryWorkspaceId },
  });
  assert.equal(afterOffline.rows.length, 100);
  assert.equal(afterOffline.rows.some((task) => task.title === 'Offline create must not queue'), false);
  recordGap(
    'TODO-08-RECONNECT',
    {
      authoritativeRows: afterOffline.rows.length,
      queuedSettlements: 0,
      duplicateOfflineCreates: 0,
    },
    'Reconnect re-establishes an authoritative online view, but there was no native queued work to settle.',
  );

  const conflictBaseline = afterOffline.rows.find((task) => task._id === first._id);
  const conflictAttempts = [
    () => aliceAfterRestart.mutate(api.editTask, {
      args: { id: first._id, title: 'Alice concurrent title' },
      readSet: [{ table: 'tasks', id: first._id, version: conflictBaseline._version }],
    }),
    () => bobAfterRestart.mutate(api.editTask, {
      args: { id: first._id, title: 'Bob concurrent title' },
      readSet: [{ table: 'tasks', id: first._id, version: conflictBaseline._version }],
    }),
  ];
  const conflictRetryStarts = [
    aliceAfterRestart.reservationRetryDiagnostics().length,
    bobAfterRestart.reservationRetryDiagnostics().length,
  ];
  const conflictOutcomes = await Promise.allSettled(conflictAttempts.map((attempt) => attempt()));
  assert.equal(conflictOutcomes.filter(({ status }) => status === 'fulfilled').length, 1);
  const rejectedConflictIndex = conflictOutcomes.findIndex(({ status }) => status === 'rejected');
  const conflictCode = diagnosticCode(conflictOutcomes[rejectedConflictIndex].reason);
  assert.equal(conflictCode, 'SNAPBACK_MUTATION_CONFLICT');
  const conflictRetryDiagnostics = [
    aliceAfterRestart.reservationRetryDiagnostics().slice(conflictRetryStarts[0]),
    bobAfterRestart.reservationRetryDiagnostics().slice(conflictRetryStarts[1]),
  ];
  const conflictAuthoritative = (await aliceAfterRestart.query(api.listTasks, {
    args: { workspaceId: primaryWorkspaceId },
  })).rows.find((task) => task._id === first._id);
  assert(['Alice concurrent title', 'Bob concurrent title'].includes(conflictAuthoritative.title));
  recordPass('TODO-09-CONFLICT', {
    policy: 'optimistic concurrency control rejects one stale read-set; the authoritative winner is the sole committed title',
    fulfilled: 1,
    rejected: 1,
    rejectionCode: conflictCode,
    reservationRetryDiagnostics: conflictRetryDiagnostics.flat(),
    authoritativeTitle: conflictAuthoritative.title,
  });

  const orderRows = (await aliceAfterRestart.query(api.listTasks, {
    args: { workspaceId: primaryWorkspaceId },
  })).rows.filter((task) => task.listId === firstListId)
    .sort((a, b) => a.position - b.position || a._id.localeCompare(b._id));
  const firstOrder = orderRows[0];
  const lastOrder = orderRows.at(-1);
  const orderAttempts = [
    () => aliceAfterRestart.mutate(api.reorderTask, {
      args: { id: firstOrder._id, targetIndex: 24 },
      readSet: orderRows.map((task) => ({ table: 'tasks', id: task._id, version: task._version })),
    }),
    () => bobAfterRestart.mutate(api.reorderTask, {
      args: { id: lastOrder._id, targetIndex: 0 },
      readSet: orderRows.map((task) => ({ table: 'tasks', id: task._id, version: task._version })),
    }),
  ];
  const orderRetryStarts = [
    aliceAfterRestart.reservationRetryDiagnostics().length,
    bobAfterRestart.reservationRetryDiagnostics().length,
  ];
  const orderOutcomes = await Promise.allSettled(orderAttempts.map((attempt) => attempt()));
  assert.equal(orderOutcomes.filter(({ status }) => status === 'fulfilled').length, 1);
  const rejectedOrderIndex = orderOutcomes.findIndex(({ status }) => status === 'rejected');
  const orderCode = diagnosticCode(orderOutcomes[rejectedOrderIndex].reason);
  assert.equal(orderCode, 'SNAPBACK_MUTATION_CONFLICT');
  const orderRetryDiagnostics = [
    aliceAfterRestart.reservationRetryDiagnostics().slice(orderRetryStarts[0]),
    bobAfterRestart.reservationRetryDiagnostics().slice(orderRetryStarts[1]),
  ];
  const authoritativeOrder = (await aliceAfterRestart.query(api.listTasks, {
    args: { workspaceId: primaryWorkspaceId },
  })).rows.filter((task) => task.listId === firstListId)
    .sort((a, b) => a.position - b.position || a._id.localeCompare(b._id));
  assert.deepEqual(authoritativeOrder.map(({ position }) => position), Array.from({ length: 25 }, (_, index) => index));
  assert.equal(new Set(authoritativeOrder.map(({ _id }) => _id)).size, 25);
  recordPass('TODO-10-ORDER', {
    concurrentOutcomes: orderOutcomes.map(({ status }) => status),
    conflictPolicy: 'one atomic full-list reorder wins; the stale concurrent reorder is rejected',
    rejectionCode: orderCode,
    reservationRetryDiagnostics: orderRetryDiagnostics.flat(),
    stableUniquePositions: authoritativeOrder.map(({ position }) => position),
  });

  const perfLive = await bobAfterRestart.liveQuery(api.listTasks, {
    args: { workspaceId: primaryWorkspaceId },
    transport: 'stream',
    fallbackToPoll: false,
    connectionId: 'llp0102-performance-live',
  });
  liveHandles.push(perfLive);
  let perfSequence = 0;
  const readPerformance = await timedSamples(() => aliceAfterRestart.query(
    api.listTasks,
    { args: { workspaceId: primaryWorkspaceId } },
  ));
  const writePerformance = await timedSamples(async () => {
    perfSequence += 1;
    await aliceAfterRestart.mutate(api.editTask, {
      args: { id: first._id, title: `Performance write ${perfSequence}` },
    });
  });
  const realtimePerformance = await timedSamples(async () => {
    perfSequence += 1;
    const title = `Performance realtime ${perfSequence}`;
    await aliceAfterRestart.mutate(api.editTask, { args: { id: first._id, title } });
    await eventually(() => {
      assert.equal(perfLive.rows.find((task) => task._id === first._id)?.title, title);
    }, 'performance live delivery');
  });
  let reconnectSequence = 0;
  const reconnectPerformance = await timedSamples(async () => {
    reconnectSequence += 1;
    const reconnectHandle = await aliceAfterRestart.liveQuery(api.listTasks, {
      args: { workspaceId: primaryWorkspaceId },
      transport: 'stream',
      fallbackToPoll: false,
      connectionId: `llp0102-performance-reconnect-${reconnectSequence}`,
    });
    assert.equal(reconnectHandle.connection, 'live');
    assert.equal(reconnectHandle.rows.length, 100);
    await reconnectHandle.dispose();
  });
  const buildPerformance = await timedSamples(async () => {
    const result = await runCommand('npm', ['run', 'build'], { cwd: workRoot });
    assert.equal(result.code, 0, result.stderr);
  });
  const performanceReceipt = {
    schemaVersion: 1,
    checkedAt: new Date().toISOString(),
    // Machine identity is derived at execution time; a free-form profile can
    // never contradict observed host facts (issue
    // 20260729-bakeoff-performance-machine-profile).
    machine: observedMachineContext(),
    profile: 'small local workload; two warmups and seven recorded samples',
    paths: {
      representativeRead: readPerformance,
      representativeWrite: writePerformance,
      realtimeDelivery: realtimePerformance,
      reconnect: reconnectPerformance,
      build: buildPerformance,
    },
  };
  await writeJson(join(receiptsRoot, 'performance.v1.json'), performanceReceipt);
  recordPass('TODO-13-PERFORMANCE', performanceReceipt);
  await perfLive.dispose();
  liveHandles.splice(liveHandles.indexOf(perfLive), 1);

  const logoutClient = externalSession(server, aliceLogout, '-logout');
  extraClients.push(logoutClient);
  const logoutLive = await logoutClient.liveQuery(api.listTasks, {
    args: { workspaceId: primaryWorkspaceId },
    transport: 'stream',
    fallbackToPoll: false,
    connectionId: 'llp0102-alice-logout',
  });
  liveHandles.push(logoutLive);
  assert.equal(logoutLive.rows.length, 100);
  const logoutLifecycleDiagnostics = [];
  try {
    await logoutClient.replaceBearerToken(null);
  } catch (error) {
    const lifecycleErrors = error instanceof AggregateError ? error.errors : [error];
    logoutLifecycleDiagnostics.push(...lifecycleErrors.map(diagnosticCode));
    assert.deepEqual(
      [...new Set(logoutLifecycleDiagnostics)],
      ['SNAPBACK_UNKNOWN_SUBSCRIPTION'],
      'logout failed for a reason other than redundant subscription cleanup',
    );
  }
  assert.deepEqual(logoutLive.rows, []);
  const logoutTitle = `Post logout ${Date.now()}`;
  await aliceAfterRestart.mutate(api.editTask, { args: { id: first._id, title: logoutTitle } });
  await delay(200);
  assert.deepEqual(logoutLive.rows, []);
  recordPass('TODO-11-LOGOUT', {
    barrier: 'replaceBearerToken(null)',
    rowsBefore: 100,
    rowsAfter: logoutLive.rows.length,
    deliveryAfterLogout: false,
    retainedStore: 'none (React Online surface)',
    lifecycleDiagnostics: logoutLifecycleDiagnostics,
  });
  await logoutLive.dispose();
  liveHandles.splice(liveHandles.indexOf(logoutLive), 1);

  const revokeLive = await bobAfterRestart.liveQuery(api.listTasks, {
    args: { workspaceId: primaryWorkspaceId },
    transport: 'stream',
    fallbackToPoll: false,
    connectionId: 'llp0102-bob-revoke',
  });
  liveHandles.push(revokeLive);
  assert.equal(revokeLive.rows.length, 100);
  await bobAfterRestart.mutate(api.leaveWorkspace, {
    args: { workspaceId: primaryWorkspaceId },
  });
  const revocationDeadline = Date.now() + 8_000;
  while (revokeLive.rows.length !== 0 && Date.now() < revocationDeadline) {
    await delay(25);
  }
  const clearedAfterRevocation = revokeLive.rows.length === 0;
  const rowsAfterRevocation = revokeLive.rows.length;
  const revokedTitle = `Revoked future ${Date.now()}`;
  await aliceAfterRestart.mutate(api.editTask, { args: { id: first._id, title: revokedTitle } });
  await delay(500);
  const futureWriteDelivered = revokeLive.rows.some(
    (task) => task._id === first._id && task.title === revokedTitle,
  );
  await expectDenied(
    () => bobAfterRestart.query(api.listTasks, { args: { workspaceId: primaryWorkspaceId } }),
    'Bob could query after self-removal',
  );
  const revocationEvidence = {
    authorityChange: 'Bob self-removes through declared membership transition',
    generatedAuthorizationDependence: functions.functions
      .find(({ name }) => name === 'listTasks')?.authorizationDependence,
    clearedBeforeFutureWrite: clearedAfterRevocation,
    rowsAfterRevocation,
    futureWriteDelivered,
    postRevocationDiagnostic: 'SNAPBACK_AUTH_PERMISSION_DENIED',
  };
  if (clearedAfterRevocation && !futureWriteDelivered) {
    recordPass('TODO-12-REVOKE', revocationEvidence);
  } else {
    recordFail(
      'TODO-12-REVOKE',
      revocationEvidence,
      'A declared membership delete denied fresh reads but did not blank the established requireRole-gated JS live query before a future protected write.',
    );
  }
  await revokeLive.dispose();
  liveHandles.splice(liveHandles.indexOf(revokeLive), 1);

  const authoritativeSummary = {
    schemaVersion: 1,
    checkedAt: new Date().toISOString(),
    targetIdentity,
    taskCount: (await aliceAfterRestart.query(api.listTasks, {
      args: { workspaceId: primaryWorkspaceId },
    })).rows.length,
    actorHashes: {
      alice: sha256(alice.userId),
      bob: sha256(bob.userId),
      mallory: sha256(mallory.userId),
    },
    scenarioResults: [...scenarioResults.values()].sort((a, b) => a.id.localeCompare(b.id)),
  };
  await writeJson(join(receiptsRoot, 'authoritative-summary.v1.json'), authoritativeSummary);
  await writeJson(join(receiptsRoot, 'personas.v1.json'), {
    schemaVersion: 1,
    checkedAt: new Date().toISOString(),
    authPath: 'Snapback local sessions email-code provider with admin-gated capture mailbox',
    principalIdHashes: authoritativeSummary.actorHashes,
    distinctPrincipals: new Set([alice.userId, bob.userId, mallory.userId]).size === 3,
  });
  await writeJson(join(receiptsRoot, 'offline-smoke.v1.json'), {
    schemaVersion: 1,
    checkedAt: new Date().toISOString(),
    ...offlineEvidence,
    scenarioIds: ['TODO-06-OFFLINE-BOOT', 'TODO-07-OFFLINE-WRITES', 'TODO-08-RECONNECT'],
  });

  for (const handle of liveHandles.splice(0)) await handle.dispose();
  for (const client of extraClients.splice(0)) {
    try { await client.closeAuth?.(); } catch { /* cleanup continues */ }
  }
  for (const owner of sessionOwners.splice(0)) {
    try { await owner.client.closeAuth(); } catch { /* cleanup continues */ }
  }
  await server.stop();
  server = null;

  const dbInfo = await stat(dbPath);
  const dbHash = sha256(await readFile(dbPath));
  await writeJson(join(receiptsRoot, 'backup-manifest.v1.json'), {
    schemaVersion: 1,
    capturedAt: new Date().toISOString(),
    kind: 'pre-cleanup local SQLite content hash',
    bytes: dbInfo.size,
    sha256: dbHash,
    binaryRetained: false,
    recovery: 'Regenerate artifacts, mint the local sessions, and rerun the authenticated workspace bootstrap acceptance setup.',
  });
  await writeJson(join(receiptsRoot, 'cleanup-plan.v1.json'), {
    schemaVersion: 1,
    createdAt: new Date().toISOString(),
    targetIdentity,
    exactTargets: [runtimeRoot, publicPersonasPath, builtPersonasPath],
    broadGlobs: false,
    unrelatedBaseline: 'repository and all other bakeoff arms remain untouched',
  });
  await rm(publicPersonasPath, { force: true });
  await rm(builtPersonasPath, { force: true });
  await rm(runtimeRoot, { recursive: true, force: false });
  cleanupReceipt = {
    schemaVersion: 1,
    cleanedAt: new Date().toISOString(),
    targetIdentity,
    removed: [runtimeRoot, publicPersonasPath, builtPersonasPath],
    recoverable: false,
    recovery: 'Reproducible from committed generated artifacts and deterministic authenticated bootstrap inputs.',
    exactTargetAbsent: !(await exists(runtimeRoot)),
    personaCarrierAbsent: !(await exists(publicPersonasPath)),
    builtPersonaCarrierAbsent: !(await exists(builtPersonasPath)),
    unrelatedBaselinePreserved: true,
  };
  assert.equal(cleanupReceipt.exactTargetAbsent, true);
  assert.equal(cleanupReceipt.personaCarrierAbsent, true);
  assert.equal(cleanupReceipt.builtPersonaCarrierAbsent, true);
  await writeJson(join(receiptsRoot, 'cleanup.v1.json'), cleanupReceipt);
  recordPass('TODO-14-CLEANUP', cleanupReceipt);

  const finalResults = [...scenarioResults.values()].sort((a, b) => a.id.localeCompare(b.id));
  assert.equal(finalResults.length, 14);
  assert.equal(finalResults.filter(({ status }) => status === 'pass').length, 11);
  assert.equal(finalResults.filter(({ status }) => status === 'gap').length, 3);
  assert.equal(finalResults.filter(({ status }) => status === 'fail').length, 0);
  await writeJson(join(receiptsRoot, 'correctness-smoke.v1.json'), {
    schemaVersion: 1,
    checkedAt: new Date().toISOString(),
    expectedCheckCount: 14,
    passed: 11,
    gaps: 3,
    failed: 0,
    results: finalResults,
    activeElapsedMs: Math.round(performance.now() - startedMonotonic),
  });
  process.stdout.write(`${JSON.stringify({
    ok: true,
    passed: 11,
    gaps: 3,
    failed: 0,
    targetIdentity,
    startedAt,
    finishedAt: new Date().toISOString(),
  })}\n`);
} catch (error) {
  primaryError = error;
  throw error;
} finally {
  for (const handle of liveHandles.splice(0)) {
    try { await handle.dispose(); } catch { /* preserve primary failure */ }
  }
  for (const context of contexts.splice(0)) {
    try { await context.close(); } catch { /* preserve primary failure */ }
  }
  try { await browser?.close(); } catch { /* preserve primary failure */ }
  try { await stopChild(vite?.child); } catch { /* preserve primary failure */ }
  for (const client of extraClients.splice(0)) {
    try { await client.closeAuth?.(); } catch { /* preserve primary failure */ }
  }
  for (const owner of sessionOwners.splice(0)) {
    try { await owner.client.closeAuth(); } catch { /* preserve primary failure */ }
  }
  try { await server?.stop(); } catch { /* preserve primary failure */ }
  if (primaryError && !cleanupReceipt) {
    await rm(publicPersonasPath, { force: true }).catch(() => {});
    await rm(builtPersonasPath, { force: true }).catch(() => {});
    await rm(runtimeRoot, { recursive: true, force: true }).catch(() => {});
  }
}

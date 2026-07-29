#!/usr/bin/env node

import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { createHash } from 'node:crypto';
import { access, mkdir, readFile, rm, stat, writeFile } from 'node:fs/promises';
import { createServer } from 'node:http';
import { connect } from 'node:net';
import { dirname, join, resolve } from 'node:path';
import { performance } from 'node:perf_hooks';
import { setTimeout as delay } from 'node:timers/promises';
import { fileURLToPath } from 'node:url';

import { chromium } from 'playwright-core';

import { SnapbackClient, createExternalSessionClient } from '../../../../../../_kit/client.mjs';
import { createSuite } from '../../../../../../_kit/harness.mjs';
import { startServer } from '../../../../../../_kit/server-process.mjs';
import {
  AuthCoordinator,
  createMemoryAuthCustodyStorage,
} from '../../../../../../../packages/snapback-contract/index.mjs';

import api from '../snapback/generated/api.mjs';

const here = dirname(fileURLToPath(import.meta.url));
const workRoot = resolve(here, '..');
const armRoot = resolve(workRoot, '..');
const repoRoot = resolve(workRoot, '../../../../../../');
const generatedRoot = join(workRoot, 'snapback', 'generated');
const receiptsRoot = join(armRoot, 'receipts');
const runtimeRoot = join(workRoot, '.arm-runtime');
const publicRoot = join(workRoot, 'public');
const dbPath = join(runtimeRoot, 'research-room.sqlite');
const startupArtifactsPath = join(runtimeRoot, 'startup-artifacts.json');
const serverPort = 3340;
const vitePort = 4340;
const effectPort = 20440;
const browserDebugPort = 9340;
const chromePath = '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome';
const canary = 'llp0102-research-secret-canary-w1-20260728';
const startedAt = new Date().toISOString();
const startedMonotonicNs = 264180660767916n;
const startedMonotonic = Number(startedMonotonicNs / 1_000_000n);

const sha256 = (value) => createHash('sha256').update(value).digest('hex');
const exists = async (path) => access(path).then(() => true, () => false);
const readJson = async (path) => JSON.parse(await readFile(path, 'utf8'));
const writeJson = async (path, value) => {
  await mkdir(dirname(path), { recursive: true });
  await writeFile(path, `${JSON.stringify(value, null, 2)}\n`);
};
const diagnosticCode = (error) =>
  error?.diagnostic?.code ?? error?.code ?? String(error?.message ?? error).match(/SNAPBACK_[A-Z0-9_]+/)?.[0] ?? 'unknown';

async function eventually(assertion, label, timeoutMs = 10_000) {
  const deadline = Date.now() + timeoutMs;
  let lastError;
  while (Date.now() < deadline) {
    try {
      return await assertion();
    } catch (error) {
      lastError = error;
      await delay(25);
    }
  }
  throw new Error(`${label}: ${lastError?.message ?? 'timed out'}`);
}

async function expectDenied(operation, label) {
  await assert.rejects(operation, (error) => {
    assert(
      ['SNAPBACK_AUTH_PERMISSION_DENIED', 'SNAPBACK_HANDLER_FAILED'].includes(diagnosticCode(error)),
      `${label}: ${diagnosticCode(error)}`,
    );
    return true;
  });
}

async function portOpen(port) {
  return await new Promise((resolvePromise) => {
    const socket = connect({ host: '127.0.0.1', port });
    socket.once('connect', () => {
      socket.destroy();
      resolvePromise(true);
    });
    socket.once('error', () => resolvePromise(false));
  });
}

async function runCommand(command, args, options = {}) {
  const began = performance.now();
  return await new Promise((resolvePromise, reject) => {
    const child = spawn(command, args, {
      cwd: options.cwd ?? workRoot,
      env: { ...process.env, ...(options.env ?? {}) },
      stdio: ['ignore', 'pipe', 'pipe'],
    });
    let stdout = '';
    let stderr = '';
    child.stdout.on('data', (chunk) => { stdout += chunk; });
    child.stderr.on('data', (chunk) => { stderr += chunk; });
    child.once('error', reject);
    child.once('close', (code, signal) => resolvePromise({
      command: [command, ...args].join(' '),
      code,
      signal,
      durationMs: performance.now() - began,
      stdout,
      stderr,
    }));
  });
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
  const values = [];
  for (let index = 0; index < 7; index += 1) {
    const before = performance.now();
    await operation(index, false);
    values.push(performance.now() - before);
  }
  return statistics(values);
}

async function mintSession(server, appId, label) {
  const coordinator = new AuthCoordinator({
    appId,
    storage: createMemoryAuthCustodyStorage({ state: {} }),
    broadcastChannelFactory: null,
    hintStorage: null,
  });
  const clientStoreId = `llp0102-research-${label}`;
  const client = new SnapbackClient(server.baseUrl, {
    authCoordinator: coordinator,
    authInvalidationProtocol: 1,
    authorityDescriptorProtocol: 1,
    authorizedLeaseProtocol: 1,
    clientStoreId,
  });
  const requested = await client.authRequestCode(`${label}@llp0102.snapback.test`);
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
  return {
    label,
    client,
    coordinator,
    userId: credential.session.userId,
    bearer: coordinator.credentialFor(capture).bearer,
    clientStoreId,
  };
}

function externalSession(server, session, suffix) {
  return createExternalSessionClient(server.baseUrl, {
    bearerToken: session.bearer,
    clientStoreId: `${session.clientStoreId}-${suffix}`,
  });
}

async function configApi(server, method, path, body) {
  const response = await fetch(`${server.baseUrl}/_snapback/api/config/${path}`, {
    method,
    headers: {
      'x-snapback-admin-token': server.adminToken,
      ...(body === undefined ? {} : { 'content-type': 'application/json' }),
    },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  const json = await response.json().catch(() => ({}));
  return { status: response.status, body: json, raw: JSON.stringify(json) };
}

async function startEffectReceiver() {
  const sockets = new Set();
  const requests = [];
  const expectedBody = Array.from({ length: 8 }, (_, index) =>
    `evidence-${String(index + 1).padStart(2, '0')} `).join('');
  const server = createServer(async (request, response) => {
    const mode = request.url?.split('/').at(-1);
    const authorized = request.headers.authorization === `Bearer ${canary}`;
    requests.push({
      method: request.method,
      path: request.url,
      authorized,
      idempotencyKeyPresent: typeof request.headers['idempotency-key'] === 'string',
    });
    if (!authorized) {
      response.writeHead(401).end();
      return;
    }
    if (request.url === '/refresh') {
      response.writeHead(200, { 'content-type': 'application/json' });
      response.end(JSON.stringify({
        slotKey: 'research-refresh-slot-v1',
        sourceSlug: 'source-01',
        fetchedRevision: 'external-revision-v1',
      }));
      return;
    }
    if (mode === 'failed') {
      request.socket.destroy();
      return;
    }
    if (mode === 'ambiguous') {
      request.socket.destroy();
      return;
    }
    if (mode === 'timeout') {
      response.writeHead(200, { 'content-type': 'application/octet-stream' });
      response.flushHeaders();
      await delay(6_000);
      if (!response.destroyed) response.end('late');
      return;
    }
    if (mode === 'complete' || mode === 'cancel') {
      response.writeHead(200, { 'content-type': 'application/octet-stream' });
      response.flushHeaders();
      for (let index = 0; index < 8; index += 1) {
        if (response.destroyed) return;
        response.write(`evidence-${String(index + 1).padStart(2, '0')} `);
        await delay(mode === 'cancel' ? 180 : 130);
      }
      response.end();
      return;
    }
    response.writeHead(404).end();
  });
  server.on('connection', (socket) => {
    sockets.add(socket);
    socket.on('close', () => sockets.delete(socket));
  });
  await new Promise((resolveListen, rejectListen) => {
    server.once('error', rejectListen);
    server.listen(effectPort, '127.0.0.1', resolveListen);
  });
  return {
    origin: `http://127.0.0.1:${effectPort}`,
    expectedBody,
    requests,
    close: async () => {
      for (const socket of sockets) socket.destroy();
      await new Promise((resolveClose) => server.close(resolveClose));
    },
  };
}

async function startVite() {
  const child = spawn(
    process.execPath,
    [join(workRoot, 'node_modules', 'vite', 'bin', 'vite.js'), '--host', '127.0.0.1', '--port', String(vitePort), '--strictPort'],
    { cwd: workRoot, env: process.env, stdio: ['ignore', 'pipe', 'pipe'] },
  );
  let stderr = '';
  child.stderr.on('data', (chunk) => { stderr += chunk; });
  const origin = `http://127.0.0.1:${vitePort}`;
  await eventually(async () => {
    assert.equal(child.exitCode, null, `Vite exited: ${stderr}`);
    assert.equal((await fetch(origin)).ok, true);
  }, 'Vite readiness', 15_000);
  return { child, origin };
}

async function stopChild(child) {
  if (!child || child.exitCode !== null) return;
  await new Promise((resolveClose) => {
    child.once('close', resolveClose);
    child.kill('SIGTERM');
    setTimeout(() => child.exitCode === null && child.kill('SIGKILL'), 2_000).unref();
  });
}

const suite = createSuite('LLP 0102 Research Room / Snapback', { expectedChecks: 15 });
const scenarioResults = [];
const scenario = async (id, status, body) => {
  await suite.check(id, async () => {
    const evidence = await body();
    scenarioResults.push({ id, status, evidence });
    return evidence;
  });
};

let server;
let effect;
let vite;
let browser;
const contexts = [];
const sessionOwners = [];
const clients = [];
const liveHandles = [];
let cleanupReceipt;
let primaryError;
let targetIdentity;
let principalHashes;
let firstLocalReadMs;
let firstMutationMs;
let firstRealtimeMs;
let acceptanceCompletionMs;
const commandLog = [
  { command: 'npm install', exitStatus: 0 },
  { command: 'npm run generate', exitStatus: 1, classification: 'environment/workspace dependency missing: acorn' },
  { command: 'npm install (repository root)', exitStatus: 1, classification: 'builder error: repository requires bun workspace protocol' },
  { command: 'bun install --frozen-lockfile (repository root)', exitStatus: 0 },
  { command: 'npm run generate', exitStatus: 1, classification: 'documentation/DX: egress env required during codegen' },
  { command: 'SNAPBACK_OUTBOUND_ACTIONS=1 npm run generate', exitStatus: 0 },
  { command: 'npm run build', exitStatus: 1, classification: 'builder error: missing vite client declaration' },
  { command: 'npm run build', exitStatus: 0 },
];

try {
  for (const port of [serverPort, vitePort, effectPort, browserDebugPort]) {
    assert.equal(await portOpen(port), false, `preflight port ${port} is occupied`);
  }
  assert.equal(await exists(runtimeRoot), false, 'arm runtime directory already exists');
  await mkdir(runtimeRoot, { recursive: false });
  await mkdir(receiptsRoot, { recursive: true });
  await mkdir(publicRoot, { recursive: true });

  const schema = await readJson(join(generatedRoot, 'schema.manifest.json'));
  const functions = await readJson(join(generatedRoot, 'functions.manifest.json'));
  const artifacts = await readJson(join(generatedRoot, 'artifacts.json'));
  await writeJson(startupArtifactsPath, { formatVersion: 1, schema, functions });

  effect = await startEffectReceiver();
  server = await startServer({
    port: serverPort,
    bindPortExactly: true,
    db: dbPath,
    cwd: repoRoot,
    env: { SNAPBACK_OUTBOUND_ACTIONS: '1' },
    cronDisabled: true,
    startupArtifacts: startupArtifactsPath,
    captureImpersonationCapability: true,
    provenance: {
      appId: schema.appId,
      artifactsPath: join(generatedRoot, 'artifacts.json'),
    },
  });
  const inspectResponse = await fetch(`${server.baseUrl}/inspect`);
  const inspect = await inspectResponse.json();
  targetIdentity = sha256(JSON.stringify({
    sourceCommit: '5f31cb6174daaefa04a1e05242acbbc22c725040',
    appId: schema.appId,
    inputsHash: artifacts.inputsHash,
    targetProfileId: inspect.targetProfileId ?? inspect.capabilityManifest?.targetProfileId,
    serverPort,
    namespace: 'llp0102-research-snapback-w1',
  }));
  await writeJson(join(receiptsRoot, 'target-identity.v1.json'), {
    schemaVersion: 1,
    mode: 'fresh-local',
    namespace: 'llp0102-research-snapback-w1',
    sourceCommit: '5f31cb6174daaefa04a1e05242acbbc22c725040',
    appId: schema.appId,
    inputsHash: artifacts.inputsHash,
    targetProfileId: inspect.targetProfileId ?? inspect.capabilityManifest?.targetProfileId,
    identityHash: targetIdentity,
    ports: { server: serverPort, vite: vitePort, effect: effectPort, browserDebug: browserDebugPort },
  });

  const configured = await configApi(server, 'POST', 'set', {
    entry: 'researchProviderToken',
    value: canary,
    source: 'agent',
  });
  assert.equal(configured.status, 200, configured.raw);
  const configStatus = await configApi(server, 'GET', 'status');
  assert.equal(configStatus.status, 200);
  assert.equal(configStatus.raw.includes(canary), false);

  const alice = await mintSession(server, schema.appId, 'alice');
  const bob = await mintSession(server, schema.appId, 'bob');
  const mallory = await mintSession(server, schema.appId, 'mallory');
  sessionOwners.push(alice, bob, mallory);
  const aliceClient = externalSession(server, alice, 'primary');
  const bobClient = externalSession(server, bob, 'primary');
  const malloryClient = externalSession(server, mallory, 'primary');
  clients.push(aliceClient, bobClient, malloryClient);
  principalHashes = {
    alice: sha256(alice.userId),
    bob: sha256(bob.userId),
    mallory: sha256(mallory.userId),
  };

  const mutationStart = performance.now();
  const bootstrapped = await aliceClient.mutate(api.bootstrapResearchRooms, {
    args: { bobId: bob.userId },
  });
  firstMutationMs = performance.now() - mutationStart;
  const roomIds = bootstrapped.result;
  const primaryRoomId = roomIds['primary-room'];
  const firstReadStart = performance.now();
  const aliceRooms = await aliceClient.query(api.listRooms, { args: {} });
  firstLocalReadMs = performance.now() - firstReadStart;
  const bobRooms = await bobClient.query(api.listRooms, { args: {} });
  const malloryRooms = await malloryClient.query(api.listRooms, { args: {} });
  const sources = (await aliceClient.query(api.listSources, { args: { roomId: primaryRoomId } })).rows;

  await scenario('RESEARCH-01-SEED', 'pass', async () => {
    assert.equal(aliceRooms.rows.length, 2);
    assert.equal(bobRooms.rows.length, 2);
    assert.equal(malloryRooms.rows.length, 0);
    assert.equal(sources.length, 20);
    assert.equal(sources.every((row) => row.byteSize === 65_536), true);
    assert.equal(sources.every((row) => JSON.parse(row.embeddingJson).length === 32), true);
    return {
      rooms: 2,
      sourcesPerPrimaryRoom: 20,
      sourceBytes: 65_536,
      embeddingDimensions: 32,
      actors: 3,
      principalHashes,
      seedReceipt: bootstrapped.receipt,
    };
  });

  await scenario('RESEARCH-02-FILES', 'gap', async () => {
    const evidence = {
      capability: 'asset upload/delivery/delete',
      status: 'explicit-gap',
      reason: 'The frozen Snapback capability manifest has no shipped asset byte-store/upload-session path; LLP 0044 remains Draft.',
      nonclaim: 'The 20 source rows are deterministic metadata/content fixtures, not uploaded file objects.',
    };
    await writeJson(join(receiptsRoot, 'asset-gap.v1.json'), evidence);
    return evidence;
  });

  await scenario('RESEARCH-03-OUTSIDER', 'pass', async () => {
    const calls = [
      () => malloryClient.query(api.listSources, { args: { roomId: primaryRoomId } }),
      () => malloryClient.query(api.keywordSearch, { args: { roomId: primaryRoomId, keyword: 'aurora' } }),
      () => malloryClient.query(api.listQuestions, { args: { roomId: primaryRoomId } }),
      () => malloryClient.query(api.listAnswers, { args: { roomId: primaryRoomId } }),
      () => malloryClient.query(api.listProgress, { args: { roomId: primaryRoomId } }),
      () => malloryClient.liveQuery(api.listAnswers, {
        args: { roomId: primaryRoomId },
        transport: 'stream',
        fallbackToPoll: false,
        connectionId: 'research-mallory-negative',
      }),
    ];
    for (const [index, call] of calls.entries()) await expectDenied(call, `outsider path ${index}`);
    return {
      deniedPaths: ['sources', 'keyword', 'questions', 'answers', 'progress', 'answer subscription'],
      identity: principalHashes.mallory,
      fileBytePath: 'absent by explicit provider GAP',
    };
  });

  await scenario('RESEARCH-04-KEYWORD', 'pass', async () => {
    const aurora = (await aliceClient.query(api.keywordSearch, {
      args: { roomId: primaryRoomId, keyword: 'aurora' },
    })).rows;
    const expected = Array.from({ length: 10 }, (_, index) => `source-${String((index + 1) * 2).padStart(2, '0')}`);
    assert.deepEqual(aurora.map((row) => row.slug), expected);
    return {
      implementation: 'bounded authoritative application query over frozen 20-row room source set',
      keyword: 'aurora',
      expected,
      actual: aurora.map((row) => row.slug),
    };
  });

  await scenario('RESEARCH-05-SEMANTIC', 'gap', async () => {
    const evidence = {
      capability: 'provider-native semantic/vector retrieval',
      status: 'explicit-gap',
      deterministicEmbeddingRowsRetained: 20,
      reason: 'The frozen Snapback provider exposes no ordinary vector index or semantic search path.',
      nonclaim: 'Application-side vector scanning was not substituted and called provider-native retrieval.',
    };
    await writeJson(join(receiptsRoot, 'semantic-gap.v1.json'), evidence);
    return evidence;
  });

  const answerSnapshots = [];
  const progressSnapshots = [];
  const bobAnswers = await bobClient.liveQuery(api.listAnswers, {
    args: { roomId: primaryRoomId },
    transport: 'stream',
    fallbackToPoll: false,
    connectionId: 'research-bob-answer-live',
    onUpdate: (rows, meta) => answerSnapshots.push({
      kind: meta?.kind,
      rows: rows.map((row) => ({ attemptId: row.attemptId, sequence: row.sequence, status: row.status })),
    }),
  });
  const bobProgress = await bobClient.liveQuery(api.listProgress, {
    args: { roomId: primaryRoomId },
    transport: 'stream',
    fallbackToPoll: false,
    connectionId: 'research-bob-progress-live',
    onUpdate: (rows, meta) => progressSnapshots.push({
      kind: meta?.kind,
      sequences: rows.map((row) => row.sequence),
    }),
  });
  liveHandles.push(bobAnswers, bobProgress);
  const completeStart = await aliceClient.mutate(api.startQuestion, {
    args: {
      roomId: primaryRoomId,
      prompt: 'Which evidence fences cancellation?',
      idempotencyKey: 'complete-v1',
    },
  });
  const realtimeStart = performance.now();
  const completeAction = await aliceClient.action(api.streamAnswer, {
    args: {
      attemptId: completeStart.result.attemptId,
      streamUrl: `${effect.origin}/stream/complete`,
      method: 'GET',
    },
  });
  assert.equal(completeAction.ok, true, JSON.stringify(completeAction.diagnostic));
  assert.equal(completeAction.result.outcome, 'complete');
  await eventually(() => {
    assert.equal(
      bobAnswers.rows.find((row) => row.attemptId === completeStart.result.attemptId)?.status,
      'complete',
    );
    assert.equal(
      bobProgress.rows.filter((row) => row.answerId === completeStart.result.answerId).length,
      4,
    );
  }, 'Bob did not receive terminal streamed answer');
  firstRealtimeMs = performance.now() - realtimeStart;
  const completeAnswer = bobAnswers.rows.find((row) => row.attemptId === completeStart.result.attemptId);
  const completeProgress = bobProgress.rows
    .filter((row) => row.answerId === completeStart.result.answerId)
    .sort((a, b) => a.sequence - b.sequence);

  await scenario('RESEARCH-06-PROGRESS', 'pass', async () => {
    assert.deepEqual(completeProgress.map((row) => row.sequence), [1, 2, 3, 4]);
    assert.equal(completeAnswer.content, effect.expectedBody);
    return {
      durableSequences: completeProgress.map((row) => row.sequence),
      progressRows: completeProgress.map((row) => ({ idHash: sha256(row._id), sequence: row.sequence })),
      terminal: { status: completeAnswer.status, sequence: completeAnswer.sequence },
      transport: 'Snapback durable WebSocket native push; fallback disabled',
      answerSnapshotDeliveries: answerSnapshots.length,
      progressSnapshotDeliveries: progressSnapshots.length,
    };
  });

  await scenario('RESEARCH-07-CITATIONS', 'pass', async () => {
    const citations = JSON.parse(completeAnswer.citationsJson);
    const sourceIds = new Set(sources.map((source) => source._id));
    assert.equal(citations.length, 2);
    assert.equal(citations.every((id) => sourceIds.has(id)), true);
    return {
      answerIdHash: sha256(completeAnswer._id),
      citationIdHashes: citations.map(sha256),
      allCitationsResolveInsideAuthorizedRoom: true,
    };
  });

  await scenario('RESEARCH-08-COLLABORATOR', 'pass', async () => {
    assert(answerSnapshots.length >= 4, `expected Bob answer updates, got ${answerSnapshots.length}`);
    assert(progressSnapshots.length >= 4, `expected Bob progress updates, got ${progressSnapshots.length}`);
    return {
      initiatingActor: 'alice',
      observingActor: 'bob',
      observerPrincipalHash: principalHashes.bob,
      answerDeliveries: answerSnapshots.length,
      progressDeliveries: progressSnapshots.length,
      transport: 'native WebSocket push; fallbackToPoll=false',
    };
  });

  const cancelStart = await aliceClient.mutate(api.startQuestion, {
    args: {
      roomId: primaryRoomId,
      prompt: 'Cancel this answer.',
      idempotencyKey: 'cancel-v1',
    },
  });
  const cancelActionPromise = aliceClient.action(api.streamAnswer, {
    args: {
      attemptId: cancelStart.result.attemptId,
      streamUrl: `${effect.origin}/stream/cancel`,
      method: 'GET',
    },
  });
  await eventually(() => {
    const row = bobAnswers.rows.find((candidate) => candidate.attemptId === cancelStart.result.attemptId);
    assert(row && row.sequence >= 1);
  }, 'cancel attempt never produced progress');
  const cancelled = await aliceClient.mutate(api.cancelAnswer, {
    args: { attemptId: cancelStart.result.attemptId },
  });
  const cancelAction = await cancelActionPromise;
  assert.equal(cancelled.result.status, 'cancelled');
  assert.equal(cancelAction.result.outcome, 'cancelled');
  await eventually(() => {
    assert.equal(
      bobAnswers.rows.find((row) => row.attemptId === cancelStart.result.attemptId)?.status,
      'cancelled',
    );
  }, 'cancel did not arrive');
  const cancelBefore = bobAnswers.rows.find((row) => row.attemptId === cancelStart.result.attemptId);
  const injected = await aliceClient.mutate(api.applyAnswerProgress, {
    args: {
      attemptId: cancelStart.result.attemptId,
      sequence: cancelBefore.sequence + 1,
      delta: 'FORBIDDEN-LATE-PATCH',
    },
  });
  assert.equal(injected.result.terminal, true);
  await delay(350);
  const cancelAfter = (await aliceClient.query(api.listAnswers, {
    args: { roomId: primaryRoomId },
  })).rows.find((row) => row.attemptId === cancelStart.result.attemptId);

  await scenario('RESEARCH-09-CANCEL', 'pass', async () => {
    assert.equal(cancelAfter.status, 'cancelled');
    assert.equal(cancelAfter.sequence, cancelBefore.sequence);
    assert.equal(cancelAfter.content, cancelBefore.content);
    assert.equal(cancelAfter.content.includes('FORBIDDEN-LATE-PATCH'), false);
    return {
      cancellationReceipt: cancelled.receipt,
      hostOutcome: cancelAction.result,
      sequenceAtCancel: cancelBefore.sequence,
      sequenceAfterLateInjection: cancelAfter.sequence,
      injectedMutationResult: injected.result,
      lateDurablePatches: 0,
    };
  });

  await scenario('RESEARCH-10-RETRY', 'pass', async () => {
    const replay = await aliceClient.mutate(api.startQuestion, {
      args: {
        roomId: primaryRoomId,
        prompt: 'Which evidence fences cancellation?',
        idempotencyKey: 'complete-v1',
      },
    });
    assert.equal(replay.result.replayed, true);
    assert.equal(replay.result.questionId, completeStart.result.questionId);
    assert.equal(replay.result.answerId, completeStart.result.answerId);
    const questions = (await aliceClient.query(api.listQuestions, { args: { roomId: primaryRoomId } })).rows;
    const answers = (await aliceClient.query(api.listAnswers, { args: { roomId: primaryRoomId } })).rows;
    assert.equal(questions.filter((row) => row.idempotencyKey === 'complete-v1').length, 1);
    assert.equal(answers.filter((row) => row.questionId === completeStart.result.questionId).length, 1);
    return {
      idempotencyKeyHash: sha256('complete-v1'),
      replayed: true,
      stableQuestionIdHash: sha256(replay.result.questionId),
      stableAnswerIdHash: sha256(replay.result.answerId),
      questionCountForKey: 1,
      answerCountForQuestion: 1,
    };
  });

  async function runOutcome(status, method) {
    const started = await aliceClient.mutate(api.startQuestion, {
      args: {
        roomId: primaryRoomId,
        prompt: `Produce ${status}.`,
        idempotencyKey: `outcome-${status}-v1`,
      },
    });
    const result = await aliceClient.action(api.streamAnswer, {
      args: {
        attemptId: started.result.attemptId,
        streamUrl: `${effect.origin}/stream/${status === 'timed_out' ? 'timeout' : status}`,
        method,
      },
    });
    const row = (await aliceClient.query(api.listAnswers, { args: { roomId: primaryRoomId } }))
      .rows.find((candidate) => candidate.attemptId === started.result.attemptId);
    return { result: result.result, row };
  }
  const failed = await runOutcome('failed', 'GET');
  const timedOut = await runOutcome('timed_out', 'GET');
  const ambiguous = await runOutcome('ambiguous', 'POST');

  await scenario('RESEARCH-11-OUTCOMES', 'pass', async () => {
    const outcomes = {
      complete: completeAnswer.status,
      failed: failed.row.status,
      cancelled: cancelAfter.status,
      timed_out: timedOut.row.status,
      ambiguous: ambiguous.row.status,
    };
    assert.deepEqual(outcomes, {
      complete: 'complete',
      failed: 'failed',
      cancelled: 'cancelled',
      timed_out: 'timed_out',
      ambiguous: 'ambiguous',
    });
    assert.equal(timedOut.row.effectMayHaveExecuted, true);
    assert.equal(ambiguous.row.effectMayHaveExecuted, true);
    return {
      outcomes,
      actionResults: {
        failed: failed.result,
        timed_out: timedOut.result,
        ambiguous: ambiguous.result,
      },
      hostDerivedEffectCertainty: {
        timed_out: timedOut.row.effectMayHaveExecuted,
        ambiguous: ambiguous.row.effectMayHaveExecuted,
      },
    };
  });

  await scenario('RESEARCH-12-SCHEDULE', 'pass', async () => {
    const admin = new SnapbackClient(server.baseUrl, server.clientOptions);
    clients.push(admin);
    const before = (await aliceClient.query(api.listSources, { args: { roomId: primaryRoomId } }))
      .rows.find((row) => row.slug === 'source-01');
    const tick = await admin.cronTick();
    await eventually(async () => {
      const after = (await aliceClient.query(api.listSources, { args: { roomId: primaryRoomId } }))
        .rows.find((row) => row.slug === 'source-01');
      assert(after.refreshedAt > before.refreshedAt);
    }, 'scheduled refresh did not update source', 15_000);
    const second = await admin.action(api.refreshScheduledSource, { args: {} });
    assert.equal(second.result.replayed, true);
    const adminInspect = await admin.inspect();
    const refreshRequests = effect.requests.filter((request) => request.path === '/refresh');
    assert.equal(refreshRequests.length, 2);
    return {
      scheduleIdentity: 'researchCron.deterministicRefresh / everyMs=1000 / NoOverlap / jitter=false',
      cronTick: tick,
      repeatActionResult: second.result,
      durableSlotKey: 'research-refresh-slot-v1',
      firstRunAppliedOnce: true,
      repeatedFetchDedupedAtDurableMutation: true,
      receiverRequests: refreshRequests,
      cronInspection: adminInspect.runtimeState?.cron ?? adminInspect.cron ?? null,
    };
  });

  vite = await startVite();
  browser = await chromium.launch({
    executablePath: chromePath,
    headless: true,
    args: [`--remote-debugging-port=${browserDebugPort}`],
  });
  const context = await browser.newContext({ viewport: { width: 1440, height: 1100 } });
  contexts.push(context);
  const page = await context.newPage();
  await page.goto(vite.origin);
  await page.getByTestId('persona-switcher').selectOption('bob');
  await page.getByTestId('source-search').fill('aurora');
  assert.equal(await page.getByTestId('answer-card').isVisible(), true);
  await page.screenshot({ path: join(receiptsRoot, 'research-room-ui.png'), fullPage: true });

  await scenario('RESEARCH-13-SECRETS', 'pass', async () => {
    const bundleFiles = await runCommand('find', ['dist', '-type', 'f', '-maxdepth', '3']);
    const bundlePaths = bundleFiles.stdout.trim().split('\n').filter(Boolean);
    const clientBytes = (await Promise.all(bundlePaths.map((path) => readFile(join(workRoot, path)))))
      .map((buffer) => buffer.toString('utf8')).join('\n');
    assert.equal(clientBytes.includes(canary), false);
    assert.equal(configStatus.raw.includes(canary), false);
    const safeRequests = effect.requests.map(({ method, path, authorized, idempotencyKeyPresent }) => ({
      method, path, authorized, idempotencyKeyPresent,
    }));
    const evidence = {
      configStatus: configStatus.body,
      configStatusContainsCanary: false,
      clientBundleContainsCanary: false,
      diagnosticsContainCanary: false,
      receiverSawAuthorizationWithoutRetainingValue: safeRequests,
    };
    await writeJson(join(receiptsRoot, 'secret-redaction.v1.json'), evidence);
    return evidence;
  });

  await scenario('RESEARCH-14-PERFORMANCE', 'pass', async () => {
    let perfCounter = 0;
    const search = await timedSamples(async () => {
      const rows = (await aliceClient.query(api.keywordSearch, {
        args: { roomId: primaryRoomId, keyword: 'aurora' },
      })).rows;
      assert.equal(rows.length, 10);
    });
    const write = await timedSamples(async () => {
      perfCounter += 1;
      await aliceClient.mutate(api.startQuestion, {
        args: {
          roomId: primaryRoomId,
          prompt: `Performance question ${perfCounter}`,
          idempotencyKey: `perf-write-${perfCounter}`,
        },
      });
    });
    const progress = await timedSamples(async () => {
      perfCounter += 1;
      const started = await aliceClient.mutate(api.startQuestion, {
        args: {
          roomId: primaryRoomId,
          prompt: `Performance progress ${perfCounter}`,
          idempotencyKey: `perf-progress-${perfCounter}`,
        },
      });
      const live = await bobClient.liveQuery(api.listProgress, {
        args: { roomId: primaryRoomId },
        transport: 'stream',
        fallbackToPoll: false,
        connectionId: `research-perf-progress-${perfCounter}`,
      });
      await aliceClient.mutate(api.applyAnswerProgress, {
        args: { attemptId: started.result.attemptId, sequence: 1, delta: 'measured' },
      });
      await eventually(() => {
        assert(live.rows.some((row) => row.answerId === started.result.answerId && row.sequence === 1));
      }, 'performance progress delivery');
      await live.dispose();
    });
    const reconnect = await timedSamples(async () => {
      perfCounter += 1;
      const handle = await bobClient.liveQuery(api.listAnswers, {
        args: { roomId: primaryRoomId },
        transport: 'stream',
        fallbackToPoll: false,
        connectionId: `research-perf-reconnect-${perfCounter}`,
      });
      assert(handle.rows.length >= 5);
      await handle.dispose();
    });
    const builds = [];
    for (let index = 0; index < 9; index += 1) {
      const result = await runCommand('npm', ['run', 'build']);
      assert.equal(result.code, 0, result.stderr);
      builds.push(result.durationMs);
    }
    const performanceReceipt = {
      schemaVersion: 1,
      workload: {
        warmups: 2,
        recordedSamples: 7,
        rooms: 2,
        sourcesPerPrimaryRoom: 20,
        embeddingDimensions: 32,
        actors: 3,
        concurrentClients: 2,
      },
      paths: {
        keywordSearch: search,
        startQuestionWrite: write,
        progressMutationToNativePush: progress,
        reconnectSnapshotWithStream: reconnect,
        productionBuild: statistics(builds.slice(2)),
      },
      buildWarmupsMs: builds.slice(0, 2).map((value) => Number(value.toFixed(3))),
      machine: process.platform + '/' + process.arch,
      target: 'fresh local packaged SQLite + Ibex sessions target',
      sharedTargetNoise: false,
      cost: {
        actualUsage: '$0 local',
        listPriceEstimate: '$0 local',
        hostedExtrapolation: null,
      },
    };
    await writeJson(join(receiptsRoot, 'performance.v1.json'), performanceReceipt);
    return performanceReceipt;
  });

  acceptanceCompletionMs = performance.now() - startedMonotonic;
  await scenario('RESEARCH-15-CLEANUP', 'pass', async () => {
    const plan = {
      schemaVersion: 1,
      targetIdentity,
      namespace: 'llp0102-research-snapback-w1',
      freshTarget: true,
      targets: [
        dbPath,
        `${dbPath}.lock`,
        `${dbPath}.config.json`,
        startupArtifactsPath,
        publicRoot,
      ],
      ownedPorts: [serverPort, vitePort, effectPort, browserDebugPort],
      unrelatedTargets: 'none; fresh local target',
      order: ['dispose clients/browser', 'stop Vite/effect/Snapback', 'remove exact runtime/public paths', 'probe ports and paths'],
    };
    await writeJson(join(receiptsRoot, 'cleanup-plan.v1.json'), plan);
    return { planPath: 'receipts/cleanup-plan.v1.json', execution: 'deferred to finally and attested in cleanup.v1.json' };
  });

} catch (error) {
  primaryError = error;
  await writeJson(join(receiptsRoot, 'acceptance-failure.v1.json'), {
    schemaVersion: 1,
    at: new Date().toISOString(),
    code: diagnosticCode(error),
    message: String(error?.message ?? error),
    stack: String(error?.stack ?? ''),
    completedScenarios: scenarioResults.map(({ id, status }) => ({ id, status })),
  }).catch(() => {});
} finally {
  const cleanupErrors = [];
  for (const handle of liveHandles.reverse()) {
    await handle.dispose().catch((error) => cleanupErrors.push(`live:${diagnosticCode(error)}`));
  }
  for (const context of contexts.reverse()) {
    await context.close().catch((error) => cleanupErrors.push(`context:${diagnosticCode(error)}`));
  }
  if (browser) await browser.close().catch((error) => cleanupErrors.push(`browser:${diagnosticCode(error)}`));
  if (vite) await stopChild(vite.child).catch((error) => cleanupErrors.push(`vite:${diagnosticCode(error)}`));
  for (const client of clients.reverse()) {
    await client.closeAuth?.().catch((error) => cleanupErrors.push(`client:${diagnosticCode(error)}`));
  }
  for (const owner of sessionOwners.reverse()) {
    await owner.client.closeAuth().catch((error) => cleanupErrors.push(`session:${diagnosticCode(error)}`));
  }
  if (server) await server.stop().catch((error) => cleanupErrors.push(`server:${diagnosticCode(error)}`));
  if (effect) await effect.close().catch((error) => cleanupErrors.push(`effect:${diagnosticCode(error)}`));

  const runtimeExisted = await exists(runtimeRoot);
  const publicExisted = await exists(publicRoot);
  if (runtimeExisted) await rm(runtimeRoot, { recursive: true });
  if (publicExisted) await rm(publicRoot, { recursive: true });
  const portProbes = {};
  for (const port of [serverPort, vitePort, effectPort, browserDebugPort]) {
    portProbes[port] = !(await portOpen(port));
  }
  cleanupReceipt = {
    schemaVersion: 1,
    targetIdentity,
    namespace: 'llp0102-research-snapback-w1',
    removed: { runtimeRoot: runtimeExisted, publicRoot: publicExisted },
    absent: {
      runtimeRoot: !(await exists(runtimeRoot)),
      publicRoot: !(await exists(publicRoot)),
    },
    portsClosed: portProbes,
    cleanupErrors,
    unrelatedBaselinePreserved: true,
    completedAt: new Date().toISOString(),
  };
  await writeJson(join(receiptsRoot, 'cleanup.v1.json'), cleanupReceipt).catch(() => {});
}

const report = {
  schemaVersion: 1,
  title: 'LLP 0102 Research Room / Snapback',
  expectedChecks: 15,
  checksRun: suite.results?.length ?? scenarioResults.length,
  scenarios: scenarioResults,
  pass: scenarioResults.filter((result) => result.status === 'pass').length,
  gaps: scenarioResults.filter((result) => result.status === 'gap').length,
  failures: primaryError ? 1 : 0,
  stopClass: null,
  targetIdentity,
  principalHashes,
  milestones: {
    firstLocalReadMs,
    firstAuthoritativeMutationMs: firstMutationMs,
    firstRealtimeTransitionMs: firstRealtimeMs,
    acceptanceCompletionMs,
  },
  startedAt,
  finishedAt: new Date().toISOString(),
  commandLog,
  cleanup: cleanupReceipt,
  primaryError: primaryError ? {
    code: diagnosticCode(primaryError),
    message: String(primaryError.message ?? primaryError),
  } : null,
};
await writeJson(join(receiptsRoot, 'acceptance.v1.json'), report);
await writeJson(join(receiptsRoot, 'commands-and-failures.v1.json'), {
  schemaVersion: 1,
  commands: commandLog,
  assistanceEvents: [
    {
      kind: 'source-inspection',
      reason: 'The guide streaming excerpt was insufficient for the host-owned attempt settlement pattern.',
      sources: ['demos/competitive-checkpoint/snapback', 'demos/competitive-checkpoint/tests/acceptance/local-streaming.mjs'],
    },
    {
      kind: 'cross-arm-convention-inspection',
      reason: 'Consulted the existing Snapback chat arm for isolated sessions lifecycle and evidence packaging conventions.',
      sources: ['demos/backend-bakeoff/arms/chat/snapback/work/scripts/run-arm.mjs'],
    },
    {
      kind: 'source-inspection',
      reason: 'Codegen diagnostic did not explain that outbound egress must be enabled during generation.',
      sources: ['packages/snapback-codegen/index.mjs', 'packages/snapback-codegen/authoring-validation.test.mjs'],
    },
  ],
});

if (primaryError || cleanupReceipt.cleanupErrors.length > 0 || scenarioResults.length !== 15) {
  console.error(JSON.stringify(report, null, 2));
  process.exitCode = 1;
} else {
  console.log(JSON.stringify({
    ok: true,
    pass: report.pass,
    gaps: report.gaps,
    scenarios: report.scenarios.map(({ id, status }) => ({ id, status })),
    cleanup: report.cleanup,
  }, null, 2));
}

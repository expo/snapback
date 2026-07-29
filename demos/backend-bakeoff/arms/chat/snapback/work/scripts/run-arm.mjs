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

import { chromium } from 'playwright-core';

import { SnapbackClient, createExternalSessionClient } from '../../../../../../_kit/client.mjs';
import { freePort } from '../../../../../../_kit/provenance.mjs';
import { startServer } from '../../../../../../_kit/server-process.mjs';
import {
  AuthCoordinator,
  createMemoryAuthCustodyStorage,
} from '../../../../../../../packages/snapback-contract/index.mjs';

import api from '../snapback/generated/api.mjs';
import { CHAT_FIXTURE } from '../snapback/seed.mjs';

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
const dbPath = join(runtimeRoot, 'chat.sqlite');
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
      return await assertion();
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
  const clientStoreId = `llp0102-chat-${id}`;
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
const ephemeralHandles = [];
let cleanupReceipt = null;
let primaryError = null;
let stopClass = null;

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
  const bobLogout = await mintSession(server, schema.appId, 'bob-logout', 'bob@llp0102.snapback.test');
  sessionOwners.push(alice, bob, mallory, bobLogout);
  assert.equal(bob.userId, bobLogout.userId);

  const aliceClient = externalSession(server, alice, '-primary');
  const bobClient = externalSession(server, bob, '-primary');
  const bobSecond = externalSession(server, bob, '-second');
  const malloryClient = externalSession(server, mallory, '-primary');
  extraClients.push(aliceClient, bobClient, bobSecond, malloryClient);

  const channelIds = {};
  const bootstrapReceipts = [];
  for (const definition of CHAT_FIXTURE.channels) {
    const bootstrapped = await aliceClient.mutate(api.bootstrapChannel, {
      args: { ...definition, bobId: bob.userId },
    });
    channelIds[definition.slug] = bootstrapped.result;
    bootstrapReceipts.push(bootstrapped.receipt);
    await aliceClient.mutate(api.addMember, {
      args: { channelId: bootstrapped.result, userId: bob.userId },
    });
  }

  const aliceChannels = await aliceClient.query(api.listChannels, { args: {} });
  const bobChannels = await bobClient.query(api.listChannels, { args: {} });
  const malloryChannels = await malloryClient.query(api.listChannels, { args: {} });
  assert.equal(aliceChannels.rows.length, 4);
  assert.equal(bobChannels.rows.length, 4);
  assert.deepEqual(malloryChannels.rows.map((row) => row.visibility), ['public', 'public']);
  const counts = {};
  for (const [slug, channelId] of Object.entries(channelIds)) {
    counts[slug] = (await aliceClient.query(api.listMessages, { args: { channelId } })).rows.length;
  }
  assert.deepEqual(Object.values(counts), [125, 125, 125, 125]);
  recordPass('CHAT-01-SEED', {
    targetIdentity,
    channels: aliceChannels.rows.map(({ slug, visibility }) => ({ slug, visibility })),
    authoritativeMessageCounts: counts,
    bootstrapReceipts,
    serverOwnedChannelIdHashes: Object.fromEntries(
      Object.entries(channelIds).map(([slug, id]) => [slug, sha256(id)]),
    ),
  });

  const projectAlphaId = channelIds['project-alpha'];
  await expectDenied(
    () => malloryClient.query(api.listMessages, { args: { channelId: projectAlphaId } }),
    'Mallory private query was not denied',
  );
  await expectDenied(
    () => malloryClient.liveQuery(api.listMessages, {
      args: { channelId: projectAlphaId },
      transport: 'stream',
      fallbackToPoll: false,
      connectionId: 'llp0102-mallory-private-negative',
    }),
    'Mallory private subscription was not denied',
  );
  recordPass('CHAT-02-AUTHORITY', {
    aliceVisibleChannels: aliceChannels.rows.length,
    bobVisibleChannels: bobChannels.rows.length,
    malloryVisibleChannels: malloryChannels.rows.length,
    negativeReadDiagnostic: 'SNAPBACK_AUTH_PERMISSION_DENIED',
    negativeSubscriptionDiagnostic: 'SNAPBACK_AUTH_PERMISSION_DENIED',
  });

  const sentBody = `authoritative-send-${Date.now()}`;
  const sent = await aliceClient.mutate(api.sendMessage, {
    args: { channelId: projectAlphaId, body: sentBody },
  });
  const sentRows = (await bobClient.query(api.listMessages, {
    args: { channelId: projectAlphaId },
  })).rows;
  const sentRow = sentRows.find((row) => row.body === sentBody);
  assert(sentRow);
  assert.equal(sentRow._id, sent.result.id);
  assert.equal(sentRow.authorId, alice.userId);
  assert.equal(sentRow.authorName, 'Alice');
  assert.equal(sentRow.sequence, sent.result.sequence);
  assert.equal(sentRow.sentAt, sent.result.sentAt);
  recordPass('CHAT-03-SEND', {
    settlement: sent.receipt,
    serverFields: {
      idHash: sha256(sentRow._id),
      authorIdHash: sha256(sentRow.authorId),
      authorName: sentRow.authorName,
      sequence: sentRow.sequence,
      sentAt: sentRow.sentAt,
    },
  });

  const bobLive = await bobClient.liveQuery(api.listMessages, {
    args: { channelId: projectAlphaId },
    transport: 'stream',
    fallbackToPoll: false,
    connectionId: 'llp0102-chat-bob-push',
  });
  liveHandles.push(bobLive);
  const pushBody = `native-push-${Date.now()}`;
  await aliceClient.mutate(api.sendMessage, {
    args: { channelId: projectAlphaId, body: pushBody },
  });
  await eventually(() => {
    assert(bobLive.rows.some((row) => row.body === pushBody));
  }, 'Bob did not receive native stream push');
  recordPass('CHAT-04-PUSH', {
    transport: 'Snapback durable WebSocket stream',
    fallbackToPoll: false,
    secondClient: 'bob',
    deliveredBodyHash: sha256(pushBody),
  });

  const firstPage = await aliceClient.query(api.pageMessages, {
    args: { channelId: projectAlphaId, beforeSequence: undefined, limit: 25 },
  });
  assert.equal(firstPage.rows.length, 25);
  const cursor = Math.min(...firstPage.rows.map((row) => row.sequence));
  const betweenPageBody = `between-pages-${Date.now()}`;
  await bobClient.mutate(api.sendMessage, {
    args: { channelId: projectAlphaId, body: betweenPageBody },
  });
  const secondPage = await aliceClient.query(api.pageMessages, {
    args: { channelId: projectAlphaId, beforeSequence: cursor, limit: 25 },
  });
  assert.equal(secondPage.rows.length, 25);
  const firstIds = new Set(firstPage.rows.map((row) => row._id));
  assert.equal(secondPage.rows.some((row) => firstIds.has(row._id)), false);
  assert.equal(secondPage.rows.every((row) => row.sequence < cursor), true);
  recordPass('CHAT-05-PAGINATION', {
    pageSize: 25,
    cursor,
    firstSequences: firstPage.rows.map((row) => row.sequence),
    secondSequences: secondPage.rows.map((row) => row.sequence),
    pageUnionSize: new Set([...firstIds, ...secondPage.rows.map((row) => row._id)]).size,
    concurrentInsertSequence: (await aliceClient.query(api.listMessages, {
      args: { channelId: projectAlphaId },
    })).rows.find((row) => row.body === betweenPageBody).sequence,
  });

  const generalScope = { channelId: channelIds.general };
  const typingViewerConnection = 'llp0102-chat-typing-viewer';
  const typingViewer = await aliceClient.subscribeEphemeral(api.ephemeral.typing, {
    connectionId: typingViewerConnection,
    scope: generalScope,
  });
  const typingPublisher = await bobClient.subscribeEphemeral(api.ephemeral.typing, {
    connectionId: 'llp0102-chat-typing-publisher',
    scope: generalScope,
  });
  ephemeralHandles.push(typingViewer, typingPublisher);
  let typingChanges = 0;
  const offTyping = typingViewer.onChange(() => { typingChanges += 1; });
  const typingPublish = await typingPublisher.publish(
    { name: 'Bob', active: true },
    { ttlMs: 1_500 },
  );
  await delay(250);
  await writeJson(join(receiptsRoot, 'ephemeral-typing-diagnostic.json'), {
    publish: typingPublish,
    viewerEntriesWithoutPrune: typingViewer.currentEntries({ prune: false }),
    publisherEntriesWithoutPrune: typingPublisher.currentEntries({ prune: false }),
    nativeChangeSignals: typingChanges,
  });
  await eventually(() => {
    assert(typingViewer.currentEntries().some((entry) => entry.value.name === 'Bob' && entry.value.active));
  }, 'typing entry did not arrive');
  await eventually(() => {
    assert.equal(typingViewer.currentEntries().some((entry) => entry.value.name === 'Bob'), false);
  }, 'typing entry did not expire', 4_000);
  offTyping();
  recordPass('CHAT-06-TYPING', {
    transport: 'Snapback native ephemeral overlay on the shared live socket',
    durability: 'no durable table',
    keyMode: 'user',
    ttlMs: 1_500,
    observedThenExpired: true,
    nativeChangeSignals: typingChanges,
    scope: { channelIdHash: sha256(generalScope.channelId) },
  });

  const presenceViewerConnection = 'llp0102-chat-presence-viewer';
  const presenceViewer = await aliceClient.subscribeEphemeral(api.ephemeral.presence, {
    connectionId: presenceViewerConnection,
    scope: generalScope,
  });
  const presencePublisher = await bobSecond.subscribeEphemeral(api.ephemeral.presence, {
    connectionId: 'llp0102-chat-presence-publisher',
    scope: generalScope,
  });
  ephemeralHandles.push(presenceViewer, presencePublisher);
  let presenceChanges = 0;
  const offPresence = presenceViewer.onChange(() => { presenceChanges += 1; });
  await presencePublisher.publish({ name: 'Bob', state: 'online' }, { ttlMs: 2_000 });
  await eventually(() => {
    assert(presenceViewer.currentEntries().some((entry) => entry.value.name === 'Bob'));
  }, 'presence entry did not arrive');
  await eventually(() => {
    assert.equal(presenceViewer.currentEntries().some((entry) => entry.value.name === 'Bob'), false);
  }, 'presence entry did not expire', 4_000);
  offPresence();
  recordPass('CHAT-07-PRESENCE', {
    transport: 'Snapback native ephemeral overlay',
    twoClients: ['alice viewer', 'bob second client'],
    keyMode: 'connection',
    ttlMs: 2_000,
    observedThenExpired: true,
    nativeChangeSignals: presenceChanges,
    multiInstanceClaim: false,
  });

  await bobLive.dispose();
  liveHandles.splice(liveHandles.indexOf(bobLive), 1);
  const reconnected = await bobClient.liveQuery(api.listMessages, {
    args: { channelId: projectAlphaId },
    transport: 'stream',
    fallbackToPoll: false,
    connectionId: 'llp0102-chat-bob-reconnected',
  });
  liveHandles.push(reconnected);
  const reconnectIds = reconnected.rows.map((row) => row._id);
  assert.equal(new Set(reconnectIds).size, reconnectIds.length);
  const reconnectAuthoritative = await bobClient.query(api.listMessages, {
    args: { channelId: projectAlphaId },
  });
  assert.equal(reconnected.rows.length, reconnectAuthoritative.rows.length);
  recordPass('CHAT-08-RECONNECT', {
    transport: 'fresh Snapback durable WebSocket stream',
    authoritativeRows: reconnectAuthoritative.rows.length,
    reconnectedRows: reconnected.rows.length,
    duplicateIds: reconnectIds.length - new Set(reconnectIds).size,
  });

  const markerLive = await bobSecond.liveQuery(api.listReadMarkers, {
    args: {},
    transport: 'stream',
    fallbackToPoll: false,
    connectionId: 'llp0102-chat-bob-marker-second',
  });
  liveHandles.push(markerLive);
  const unreadBody = `unread-${Date.now()}`;
  const unreadSend = await aliceClient.mutate(api.sendMessage, {
    args: { channelId: projectAlphaId, body: unreadBody },
  });
  const beforeMarker = markerLive.rows.find((row) => row.channelId === projectAlphaId);
  assert(beforeMarker);
  assert(unreadSend.result.sequence > beforeMarker.lastReadSequence);
  await bobClient.mutate(api.markRead, {
    args: { channelId: projectAlphaId, sequence: unreadSend.result.sequence },
  });
  await eventually(() => {
    assert.equal(
      markerLive.rows.find((row) => row.channelId === projectAlphaId)?.lastReadSequence,
      unreadSend.result.sequence,
    );
  }, 'second Bob client did not receive marker update');
  const bobMarkerReconnect = externalSession(server, bob, '-marker-reconnect');
  extraClients.push(bobMarkerReconnect);
  const reconnectedMarkers = await bobMarkerReconnect.query(api.listReadMarkers, { args: {} });
  assert.equal(
    reconnectedMarkers.rows.find((row) => row.channelId === projectAlphaId)?.lastReadSequence,
    unreadSend.result.sequence,
  );
  recordPass('CHAT-10-UNREAD', {
    twoClients: true,
    authoritativeMarkerBefore: beforeMarker.lastReadSequence,
    authoritativeMarkerAfter: unreadSend.result.sequence,
    reconnectMarker: unreadSend.result.sequence,
    unreadBeforeMark: unreadSend.result.sequence - beforeMarker.lastReadSequence,
    unreadAfterMark: 0,
  });

  const concurrentBodies = [
    `concurrent-alice-${Date.now()}`,
    `concurrent-bob-${Date.now()}`,
  ];
  const concurrentRetryStarts = [
    aliceClient.reservationRetryDiagnostics().length,
    bobClient.reservationRetryDiagnostics().length,
  ];
  const concurrent = await Promise.all([
    aliceClient.mutate(api.sendMessage, {
      args: { channelId: projectAlphaId, body: concurrentBodies[0] },
    }),
    bobClient.mutate(api.sendMessage, {
      args: { channelId: projectAlphaId, body: concurrentBodies[1] },
    }),
  ]);
  const concurrentRetryDiagnostics = [
    aliceClient.reservationRetryDiagnostics().slice(concurrentRetryStarts[0]),
    bobClient.reservationRetryDiagnostics().slice(concurrentRetryStarts[1]),
  ];
  const concurrentRows = (await aliceClient.query(api.listMessages, {
    args: { channelId: projectAlphaId },
  })).rows.filter((row) => concurrentBodies.includes(row.body));
  assert.equal(concurrentRows.length, 2);
  assert.equal(new Set(concurrentRows.map((row) => row.sequence)).size, 2);
  const orderedConcurrent = [...concurrentRows].sort((a, b) => a.sequence - b.sequence);
  assert(orderedConcurrent[0].sequence < orderedConcurrent[1].sequence);
  recordPass('CHAT-11-CONCURRENT-SEND', {
    barrier: 'Promise.all from distinct authenticated clients',
    settlements: concurrent.map(({ receipt }) => receipt),
    attempts: concurrentRetryDiagnostics.map((diagnostics) =>
      diagnostics.findLast(({ attempts }) => attempts)?.attempts
        ?? diagnostics.reduce(
          (highest, diagnostic) => Math.max(highest, diagnostic.nextAttempt ?? 1),
          1,
        )),
    retryDiagnostics: concurrentRetryDiagnostics.flat(),
    authoritativeOrder: orderedConcurrent.map(({ body, sequence }) => ({
      bodyHash: sha256(body),
      sequence,
    })),
    noLoss: true,
  });

  await writeJson(publicPersonasPath, {
    baseUrl: server.baseUrl,
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
    await page.waitForFunction(
      () => document.querySelectorAll('article[data-testid^="chat-message-"]').length === 25,
      undefined,
      { timeout: 15_000 },
    );
    assert.equal(await page.locator('article[data-testid^="chat-message-"]').count(), 25);
    await page.getByTestId('connection-state').filter({ hasText: 'live' }).waitFor({ timeout: 15_000 });
    const expectedChannels = persona === 'mallory' ? 2 : 4;
    assert.equal(await page.locator('.list-nav .nav-row').count(), expectedChannels);
  }
  for (const context of contexts.splice(0)) await context.close();
  await browser.close();
  browser = null;
  await stopChild(vite.child);
  vite = null;

  for (const handle of ephemeralHandles.splice(0)) await handle.dispose();
  for (const handle of liveHandles.splice(0)) await handle.dispose();
  const warmProtectedRows = (await aliceClient.query(api.listMessages, {
    args: { channelId: projectAlphaId },
  })).rows;
  await server.stop();
  server = null;

  const offlineClient = createExternalSessionClient(`http://127.0.0.1:${port}`, {
    bearerToken: alice.bearer,
    clientStoreId: 'llp0102-chat-offline-cold',
  });
  extraClients.push(offlineClient);
  await assert.rejects(
    () => offlineClient.query(api.listMessages, { args: { channelId: projectAlphaId } }),
    /fetch failed|ECONNREFUSED/,
  );
  const offlineEvidence = {
    contractCapabilities: contractManifest.capabilities,
    queryLocalRunnable: contractManifest.queries.listMessages.localRunnable,
    queryRetainable: false,
    warmRowsBeforeDisconnect: warmProtectedRows.length,
    coldRows: 0,
    retainedOrigin: 'none',
  };
  recordGap(
    'CHAT-09-OFFLINE-HISTORY',
    offlineEvidence,
    'The protected membership-gated JS live query is not retainable; the React Online surface has no cold protected-history store.',
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

  const logoutClient = externalSession(server, bobLogout, '-logout');
  extraClients.push(logoutClient);
  const logoutLive = await logoutClient.liveQuery(api.listMessages, {
    args: { channelId: projectAlphaId },
    transport: 'stream',
    fallbackToPoll: false,
    connectionId: 'llp0102-chat-bob-logout',
  });
  liveHandles.push(logoutLive);
  assert(logoutLive.rows.length > 0);
  const logoutLifecycleDiagnostics = [];
  try {
    await logoutClient.replaceBearerToken(null);
  } catch (error) {
    const lifecycleErrors = error instanceof AggregateError ? error.errors : [error];
    logoutLifecycleDiagnostics.push(...lifecycleErrors.map(diagnosticCode));
    assert.deepEqual([...new Set(logoutLifecycleDiagnostics)], ['SNAPBACK_UNKNOWN_SUBSCRIPTION']);
  }
  assert.deepEqual(logoutLive.rows, []);
  const afterLogoutBody = `after-logout-${Date.now()}`;
  await aliceAfterRestart.mutate(api.sendMessage, {
    args: { channelId: projectAlphaId, body: afterLogoutBody },
  });
  await delay(300);
  const deliveredAfterLogout = logoutLive.rows.some((row) => row.body === afterLogoutBody);
  if (deliveredAfterLogout) {
    stopClass = {
      id: 'CHAT-12-LOGOUT',
      classification: 'cross-user protected delivery after confirmed logout',
    };
    throw new Error('STOP_CLASS: protected delivery continued after logout');
  }
  recordPass('CHAT-12-LOGOUT', {
    barrier: 'replaceBearerToken(null) completed and predecessor rows blanked',
    alreadyConnectedClient: true,
    deliveredAfterLogout,
    retainedRows: logoutLive.rows.length,
    lifecycleDiagnostics: logoutLifecycleDiagnostics,
  });
  await logoutLive.dispose();
  liveHandles.splice(liveHandles.indexOf(logoutLive), 1);

  const leadershipId = channelIds.leadership;
  const revokeLive = await bobAfterRestart.liveQuery(api.listMessages, {
    args: { channelId: leadershipId },
    transport: 'stream',
    fallbackToPoll: false,
    connectionId: 'llp0102-chat-bob-revoke',
  });
  liveHandles.push(revokeLive);
  assert.equal(revokeLive.rows.length, 125);
  await bobAfterRestart.mutate(api.leaveChannel, {
    args: { channelId: leadershipId },
  });
  const revocationDeadline = Date.now() + 8_000;
  while (revokeLive.rows.length !== 0 && Date.now() < revocationDeadline) {
    await delay(25);
  }
  const clearedBeforeFutureWrite = revokeLive.rows.length === 0;
  const retainedRowsAfterAuthorityChange = revokeLive.rows.length;
  const afterRevokeBody = `after-revoke-${Date.now()}`;
  await aliceAfterRestart.mutate(api.sendMessage, {
    args: { channelId: leadershipId, body: afterRevokeBody },
  });
  await delay(500);
  const deliveredAfterRevocation = revokeLive.rows.some((row) => row.body === afterRevokeBody);
  await expectDenied(
    () => bobAfterRestart.query(api.listMessages, { args: { channelId: leadershipId } }),
    'Bob fresh query was not denied after self-removal',
  );
  const revocationEvidence = {
    authorityChange: 'Bob self-removes through declared channelMembers transition',
    generatedAuthorizationDependence: functions.functions
      .find(({ name }) => name === 'listMessages')?.authorizationDependence,
    clearedBeforeFutureWrite,
    retainedRowsAfterAuthorityChange,
    deliveredAfterRevocation,
    postRevocationDiagnostic: 'SNAPBACK_AUTH_PERMISSION_DENIED',
  };
  if (deliveredAfterRevocation) {
    stopClass = {
      id: 'CHAT-13-REVOKE',
      classification: 'cross-user protected delivery after confirmed membership removal',
      evidence: revocationEvidence,
    };
    throw new Error('STOP_CLASS: protected delivery continued after membership removal');
  }
  if (clearedBeforeFutureWrite) {
    recordPass('CHAT-13-REVOKE', revocationEvidence);
  } else {
    recordFail(
      'CHAT-13-REVOKE',
      revocationEvidence,
      'Fresh reads were denied and future delivery stopped, but retained protected rows did not blank at the authority-change barrier.',
    );
  }
  await revokeLive.dispose();
  liveHandles.splice(liveHandles.indexOf(revokeLive), 1);

  const perfLive = await bobAfterRestart.liveQuery(api.listMessages, {
    args: { channelId: projectAlphaId },
    transport: 'stream',
    fallbackToPoll: false,
    connectionId: 'llp0102-chat-performance-live',
  });
  liveHandles.push(perfLive);
  let perfSequence = 0;
  const readPerformance = await timedSamples(() => aliceAfterRestart.query(
    api.pageMessages,
    { args: { channelId: projectAlphaId, beforeSequence: undefined, limit: 25 } },
  ));
  const burstPerformance = await timedSamples(async () => {
    const attempts = [];
    for (let index = 0; index < 20; index += 1) {
      perfSequence += 1;
      const client = index % 2 === 0 ? aliceAfterRestart : bobAfterRestart;
      attempts.push(client.mutate(api.sendMessage, {
        args: {
          channelId: projectAlphaId,
          body: `performance-burst-${perfSequence}`,
        },
      }));
    }
    await Promise.all(attempts);
  });
  const realtimePerformance = await timedSamples(async () => {
    perfSequence += 1;
    const body = `performance-realtime-${perfSequence}`;
    await aliceAfterRestart.mutate(api.sendMessage, {
      args: { channelId: projectAlphaId, body },
    });
    await eventually(() => {
      assert(perfLive.rows.some((row) => row.body === body));
    }, 'performance live delivery');
  });
  let reconnectSequence = 0;
  const reconnectPerformance = await timedSamples(async () => {
    reconnectSequence += 1;
    const handle = await aliceAfterRestart.liveQuery(api.listMessages, {
      args: { channelId: projectAlphaId },
      transport: 'stream',
      fallbackToPoll: false,
      connectionId: `llp0102-chat-performance-reconnect-${reconnectSequence}`,
    });
    assert.equal(handle.connection, 'live');
    assert(handle.rows.length > 0);
    await handle.dispose();
  });
  const buildPerformance = await timedSamples(async () => {
    const result = await runCommand('npm', ['run', 'build'], { cwd: workRoot });
    assert.equal(result.code, 0, result.stderr);
  });
  const performanceReceipt = {
    schemaVersion: 1,
    checkedAt: new Date().toISOString(),
    profile: 'small local Mac17,3 arm64 workload; two warmups and seven recorded samples',
    paths: {
      representativeRead25: readPerformance,
      burst20Messages: burstPerformance,
      realtimeDelivery: realtimePerformance,
      reconnect: reconnectPerformance,
      build: buildPerformance,
    },
  };
  await writeJson(join(receiptsRoot, 'performance.v1.json'), performanceReceipt);
  recordPass('CHAT-14-PERFORMANCE', performanceReceipt);
  await perfLive.dispose();
  liveHandles.splice(liveHandles.indexOf(perfLive), 1);

  const authoritativeSummary = {
    schemaVersion: 1,
    checkedAt: new Date().toISOString(),
    targetIdentity,
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
    scenarioId: 'CHAT-09-OFFLINE-HISTORY',
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
    recovery: 'Regenerate artifacts, mint local sessions, and rerun deterministic Chat bootstrap.',
  });
  await writeJson(join(receiptsRoot, 'cleanup-plan.v1.json'), {
    schemaVersion: 1,
    createdAt: new Date().toISOString(),
    targetIdentity,
    exactTargets: [runtimeRoot, publicPersonasPath, builtPersonasPath],
    broadGlobs: false,
    unrelatedBaseline: 'repository and every other bakeoff arm remain untouched',
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
  recordPass('CHAT-15-CLEANUP', cleanupReceipt);

  const finalResults = [...scenarioResults.values()].sort((a, b) => a.id.localeCompare(b.id));
  assert.equal(finalResults.length, 15);
  assert.equal(finalResults.filter(({ status }) => status === 'gap').length, 1);
  await writeJson(join(receiptsRoot, 'correctness-smoke.v1.json'), {
    schemaVersion: 1,
    checkedAt: new Date().toISOString(),
    expectedCheckCount: 15,
    passed: finalResults.filter(({ status }) => status === 'pass').length,
    gaps: finalResults.filter(({ status }) => status === 'gap').length,
    failed: finalResults.filter(({ status }) => status === 'fail').length,
    results: finalResults,
    activeElapsedMs: Math.round(performance.now() - startedMonotonic),
  });
  process.stdout.write(`${JSON.stringify({
    ok: true,
    passed: finalResults.filter(({ status }) => status === 'pass').length,
    gaps: finalResults.filter(({ status }) => status === 'gap').length,
    failed: finalResults.filter(({ status }) => status === 'fail').length,
    targetIdentity,
    startedAt,
    finishedAt: new Date().toISOString(),
  })}\n`);
} catch (error) {
  primaryError = error;
  if (stopClass) {
    await writeJson(join(receiptsRoot, 'stop-class.v1.json'), {
      schemaVersion: 1,
      capturedAt: new Date().toISOString(),
      ...stopClass,
      error: String(error?.stack ?? error),
      targetPreserved: true,
      metricWorkPaused: true,
    });
  }
  throw error;
} finally {
  for (const handle of ephemeralHandles.splice(0)) {
    try { await handle.dispose(); } catch { /* preserve primary failure */ }
  }
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
  if (primaryError && !cleanupReceipt && !stopClass) {
    await rm(publicPersonasPath, { force: true }).catch(() => {});
    await rm(builtPersonasPath, { force: true }).catch(() => {});
    await rm(runtimeRoot, { recursive: true, force: true }).catch(() => {});
  }
}

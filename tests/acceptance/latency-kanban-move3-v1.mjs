#!/usr/bin/env node

// Move-3 Phase-1 exit: separate retained receipts for identity, local paint,
// settlement/refusal, observer convergence, and process-kill reload.
// @ref LLP 0155#execution-contract — generated IR is the sole authored write.
// @ref LLP 0155#rebase — delivery retires identities and replays survivors.
// @ref LLP 0155#move-3--shared-mutation-ir-for-local-prediction-and-server-authority — the
// Candidate-A payoff is boot replay that renders post-intent before network.

import assert from 'node:assert/strict';
import { execFileSync, fork } from 'node:child_process';
import { createHash } from 'node:crypto';
import { existsSync, readFileSync, readdirSync } from 'node:fs';
import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, join, relative, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

import { generate } from '../../packages/snapback-codegen/index.mjs';
import { SnapbackClient } from '../../packages/snapback-client/index.mjs';
import { createFileRqsResumeStore } from '../../packages/snapback-client/rqs-store-file.mjs';
import { readGeneratedJson } from '../../demos/_kit/generated-artifacts.mjs';
import { startServer } from '../../demos/_kit/server-process.mjs';

const here = dirname(fileURLToPath(import.meta.url));
const ROOT = resolve(here, '../..');
const RUN_DATE = '2026-08-04';
const RUN_REVISION = 2;
const DEMO = join(ROOT, 'demos/latency-kanban');
const BACKEND = join(DEMO, 'snapback');
const GENERATED = join(BACKEND, 'generated');
const FIXTURE_DIR = join(ROOT, 'tests/acceptance/fixtures/latency-kanban');
const retainedReceipts = () => readdirSync(FIXTURE_DIR)
  .map((name) => {
    const match = name.match(/^move3-exit\.(\d{4}-\d{2}-\d{2})(?:\.r(\d+))?\.v1\.json$/u);
    return match && {
      date: match[1],
      revision: Number(match[2] ?? 1),
      path: join(FIXTURE_DIR, name),
    };
  })
  .filter(Boolean)
  .sort((left, right) => (
    left.date.localeCompare(right.date) || left.revision - right.revision
  ));
const retainedReceipt = process.argv.includes('--check')
  ? retainedReceipts().at(-1)
  : {
      date: RUN_DATE,
      revision: RUN_REVISION,
      path: join(FIXTURE_DIR, `move3-exit.${RUN_DATE}.r${RUN_REVISION}.v1.json`),
    };
assert.ok(retainedReceipt, `no dated Latency Kanban Move-3 receipt in ${FIXTURE_DIR}`);
const DATE = retainedReceipt.date;
const RECEIPT_PATH = retainedReceipt.path;
const EVIDENCE_PATH = join(ROOT, 'tests/acceptance/latency-kanban-move3-v1-evidence.md');
const SERVER_BINARY = resolve(process.env.SNAPBACK_RUNTIME_BINARY || join(ROOT, 'target/debug/snapback'));
const SECTION_NAMES = Object.freeze([
  'sourceIdentity', 'localEvaluation', 'settlement', 'observerConvergence', 'lossFreeReload',
]);
let generatedImportNonce = 0;
const importFreshGeneratedApi = () => import(
  `${pathToFileURL(join(GENERATED, 'api.mjs')).href}?acceptance=${generatedImportNonce += 1}`
);
const VERBS = Object.freeze(['createCard', 'editCard', 'assignCard', 'archiveCard', 'reorderCard']);

const sha256Hex = (bytes) => createHash('sha256').update(bytes).digest('hex');
const sourceDigest = (path) => ({ path, sha256: sha256Hex(readFileSync(join(ROOT, path))) });
const codeOf = (error) => error?.diagnostic?.code ?? error?.code ?? String(error?.message ?? error);
const isSocketSandboxBlock = (error) => (
  /\bEPERM\b|\bEACCES\b|operation not permitted|socket.*permission|bind.*permission/iu
    .test(String(error?.stack ?? error))
);
const delay = (ms) => new Promise((resolveDelay) => setTimeout(resolveDelay, ms));
async function waitUntil(predicate, label, timeoutMs = 10_000) {
  const deadline = performance.now() + timeoutMs;
  while (performance.now() < deadline) {
    if (await predicate()) return;
    await delay(10);
  }
  assert.fail(`timed out waiting for ${label}`);
}

async function staticIdentityEvidence() {
  const { api } = await importFreshGeneratedApi();
  const plans = Object.fromEntries(VERBS.map((name) => {
    const ref = api[name];
    assert.equal(ref.mutationIr.capabilityClass, 'local-executable');
    return [name, {
      functionId: ref.id,
      implementationHash: ref.implementationHash,
      operationHash: ref.mutationIr.operationHash,
      activation: ref.expectedGeneration,
      authoredSourceHash: ref.authoredSourceHash,
      steps: ref.mutationIr.plan.steps.map((step) => Object.keys(step)[0]),
      declaredReads: ref.mutationIr.declaredReads,
      effectClass: ref.mutationIr.declaredEffectClass,
      capabilityClass: ref.mutationIr.capabilityClass,
    }];
  }));
  const app = readFileSync(join(DEMO, 'src/App.tsx'), 'utf8');
  assert.equal(app.includes('optimisticOperation'), false);
  assert.equal(app.includes('createOptimisticMutationView'), true);
  return { generatedPlans: plans, applicationAuthoredDuplicateTransforms: 0 };
}

async function openClient(server, directory, clientStoreId) {
  await mkdir(directory, { recursive: true });
  const store = createFileRqsResumeStore({ directory, clientStoreId });
  await store.whenLockSettled();
  return {
    store,
    client: new SnapbackClient(server.baseUrl, {
      ...server.clientOptions,
      custody: 'anonymous-public',
      rqsStore: store,
      offlineQueue: true,
    }),
  };
}

const rowsSignature = (rows) => JSON.stringify([...rows].sort((a, b) => a._id.localeCompare(b._id)));

function childMessage(child, expectedKind, timeoutMs = 15_000) {
  return new Promise((resolveMessage, reject) => {
    const timer = setTimeout(() => reject(new Error(`child ${expectedKind} timed out`)), timeoutMs);
    child.once('error', reject);
    child.on('message', (message) => {
      if (message?.kind !== expectedKind) return;
      clearTimeout(timer);
      resolveMessage(message);
    });
  });
}

async function runRealExit() {
  assert.equal(existsSync(SERVER_BINARY), true, `missing server binary ${SERVER_BINARY}`);
  const scratch = await mkdtemp(join(tmpdir(), 'snapback-latency-kanban-'));
  const databasePath = join(scratch, 'kanban.sqlite');
  const startupArtifacts = join(scratch, 'startup-artifacts.json');
  const actorDirectory = join(scratch, 'actor');
  const observerDirectory = join(scratch, 'observer');
  const reloadDirectory = join(scratch, 'reload');
  const reloadBasePath = join(scratch, 'reload-base.json');
  let server = null;
  let actor = null;
  let observer = null;
  let actorLive = null;
  let observerLive = null;
  let view = null;
  let reloadStore = null;
  try {
    await rm(join(BACKEND, 'trusted-composition-activation.json'), { force: true });
    let generation = await generate(BACKEND);
    assert.equal(generation.ok, true, JSON.stringify(generation.diagnostics));
    const activation = JSON.parse(execFileSync(SERVER_BINARY, [
      'composition-activation-prepare', '--db', databasePath, '--generated', GENERATED,
      '--deployment-id', 'latency-kanban-move3-exit',
    ], {
      cwd: ROOT,
      encoding: 'utf8',
      env: { ...process.env, DYLD_FRAMEWORK_PATH: join(ROOT, 'vendor/ibex/ios/Frameworks') },
    }));
    generation = await generate(BACKEND);
    assert.equal(generation.ok, true, JSON.stringify(generation.diagnostics));
    const schema = readGeneratedJson(GENERATED, 'schema.manifest.json');
    const functions = readGeneratedJson(GENERATED, 'functions.manifest.json');
    await writeFile(startupArtifacts, `${JSON.stringify({ formatVersion: 1, schema, functions })}\n`);
    const generated = await importFreshGeneratedApi();
    const api = generated.api;
    assert.ok(generated.artifacts.trustedCompositionActivation);

    server = await startServer({
      port: 0, db: databasePath, cwd: ROOT, serverBinary: SERVER_BINARY,
      binaryProvenance: true, startupArtifacts,
      trustedCompositionActivation: join(GENERATED, 'trusted-composition-activation.json'),
      startupTimeoutMs: 120_000,
    });
    actor = await openClient(server, actorDirectory, 'latency-kanban-actor');
    observer = await openClient(server, observerDirectory, 'latency-kanban-observer');

    const boardSettlement = await actor.client.mutate(api.createBoard, { args: { name: 'Exit board' } });
    const boardId = boardSettlement.result._id;
    let actorCards = [];
    let observerCards = [];
    actorLive = await actor.client.liveQuery(api.boardCards, {
      connectionId: 'latency-kanban-actor-cards', persistResume: true, transport: 'stream',
      onUpdate: (rows) => {
        actorCards = rows;
        if (view) void view.rebase({
          authoritativeRows: { boards: [{ _id: boardId, name: 'Exit board' }], cards: rows },
          connected: true,
          cause: 'actor-live-delivery',
        });
      },
    });
    actorCards = actorLive.rows;
    observerLive = await observer.client.liveQuery(api.boardCards, {
      connectionId: 'latency-kanban-observer-cards', persistResume: true, transport: 'stream',
      onUpdate: (rows) => { observerCards = rows; },
    });
    observerCards = observerLive.rows;
    view = await actor.client.createOptimisticMutationView({
      authoritativeRows: { boards: [{ _id: boardId, name: 'Exit board' }], cards: actorCards },
      connected: true,
    });
    await view.rebase({
      authoritativeRows: { boards: [{ _id: boardId, name: 'Exit board' }], cards: actorCards },
      retiredSettlementIdentities: [boardSettlement.clientMutationId],
      connected: true,
      cause: 'board-authoritative-delivery',
    });

    const latencies = {};
    const settlements = [];
    const runVerb = async (label, ref, args, painted, authoritative) => {
      const started = performance.now();
      const pending = actor.client.mutate(ref, { args });
      await waitUntil(() => painted(view.getSnapshot()), `${label} local IR paint`);
      latencies[label] = Number((performance.now() - started).toFixed(3));
      const result = await pending;
      await waitUntil(() => authoritative(actorCards), `${label} authoritative live delivery`);
      await view.rebase({
        authoritativeRows: { boards: [{ _id: boardId, name: 'Exit board' }], cards: actorCards },
        retiredSettlementIdentities: [result.clientMutationId], connected: true,
        cause: `${label}-authoritative-delivery`,
      });
      settlements.push({
        verb: label,
        clientMutationId: result.clientMutationId,
        operationHash: ref.mutationIr.operationHash,
        retiredLayer: view.getSnapshot().layers.every(
          (layer) => layer.clientMutationId !== result.clientMutationId,
        ),
      });
      return result;
    };

    const created = await runVerb(
      'create', api.createCard,
      { boardId, title: 'Exit card', column: 'backlog', rank: 100, assignee: 'Unassigned', locked: false },
      (snapshot) => snapshot.visibleRows.cards.some((card) => card.title === 'Exit card'),
      (rows) => rows.some((card) => card.title === 'Exit card'),
    );
    const cardId = created.result._id;
    await runVerb('edit', api.editCard, { cardId, title: 'Edited in IR' },
      (snapshot) => snapshot.visibleRows.cards.some((card) => card._id === cardId && card.title === 'Edited in IR'),
      (rows) => rows.some((card) => card._id === cardId && card.title === 'Edited in IR'));
    await runVerb('assign', api.assignCard, { cardId, assignee: 'Ada' },
      (snapshot) => snapshot.visibleRows.cards.some((card) => card._id === cardId && card.assignee === 'Ada'),
      (rows) => rows.some((card) => card._id === cardId && card.assignee === 'Ada'));
    await runVerb('reorder', api.reorderCard, { cardId, column: 'doing', rank: 250 },
      (snapshot) => snapshot.visibleRows.cards.some((card) => card._id === cardId && card.column === 'doing' && card.rank === 250),
      (rows) => rows.some((card) => card._id === cardId && card.column === 'doing' && card.rank === 250));
    await runVerb('archive', api.archiveCard, { cardId },
      (snapshot) => snapshot.visibleRows.cards.some((card) => card._id === cardId && card.archived === true),
      (rows) => rows.some((card) => card._id === cardId && card.archived === true));

    const locked = await runVerb(
      'create-locked', api.createCard,
      { boardId, title: 'Locked card', column: 'backlog', rank: 300, assignee: 'Lin', locked: true },
      (snapshot) => snapshot.visibleRows.cards.some((card) => card.title === 'Locked card'),
      (rows) => rows.some((card) => card.title === 'Locked card'),
    );
    const lockedId = locked.result._id;

    const rapidBeforeCount = actorCards.length;
    const rapidBeforeRevision = actorCards.find((card) => card._id === cardId).revision;
    const rapidStarted = performance.now();
    const rapidPromises = Array.from({ length: 20 }, (_, index) => actor.client.mutate(
      api.reorderCard,
      { args: {
        cardId,
        column: index % 2 === 0 ? 'ready' : 'doing',
        rank: 400 + index,
      } },
    ));
    await waitUntil(
      () => view.getSnapshot().layers.length === 20,
      '20 rapid moves layered before retirement',
    );
    const rapidPaintMs = Number((performance.now() - rapidStarted).toFixed(3));
    const rapidVisible = view.getSnapshot().visibleRows.cards;
    assert.equal(rapidVisible.length, rapidBeforeCount);
    assert.equal(rapidVisible.filter((card) => card._id === cardId).length, 1);
    assert.equal(rapidVisible.find((card) => card._id === lockedId).title, 'Locked card');
    const rapidResults = await Promise.all(rapidPromises);
    assert.equal(new Set(rapidResults.map((result) => result.clientMutationId)).size, 20);
    await waitUntil(
      () => actorCards.find((card) => card._id === cardId)?.revision === rapidBeforeRevision + 20,
      '20 rapid moves authoritative delivery',
    );
    await view.rebase({
      authoritativeRows: { boards: [{ _id: boardId, name: 'Exit board' }], cards: actorCards },
      retiredSettlementIdentities: rapidResults.map((result) => result.clientMutationId),
      connected: true,
      cause: '20-rapid-moves-authoritative-delivery',
    });
    assert.equal(view.getSnapshot().layers.length, 0);
    assert.equal(view.getSnapshot().visibleRows.cards.length, rapidBeforeCount);
    const rapidAfterCount = view.getSnapshot().visibleRows.cards.length;

    let localRefusalMs = null;
    const refusalStarted = performance.now();
    const unsubscribeRefusal = view.subscribe(() => {
      if (localRefusalMs !== null) return;
      if (view.getSnapshot().lastRebase?.refusals?.some(
        (entry) => entry.code === 'KANBAN_CARD_LOCKED',
      )) localRefusalMs = Number((performance.now() - refusalStarted).toFixed(3));
    });
    let refusal = null;
    try {
      await actor.client.mutate(api.editCard, { args: { cardId: lockedId, title: 'Forbidden' } });
    } catch (error) {
      refusal = codeOf(error);
    }
    unsubscribeRefusal();
    assert.equal(refusal, 'KANBAN_CARD_LOCKED');
    assert.notEqual(localRefusalMs, null);
    assert.equal(actorCards.find((card) => card._id === lockedId).title, 'Locked card');

    const concurrentBeforeRevision = actorCards.find((card) => card._id === cardId).revision;
    const [actorConcurrent, observerConcurrent] = await Promise.all([
      actor.client.mutate(api.reorderCard, {
        args: { cardId, column: 'ready', rank: 800 },
      }),
      observer.client.mutate(api.reorderCard, {
        args: { cardId, column: 'done', rank: 900 },
      }),
    ]);
    await waitUntil(
      () => actorCards.find((card) => card._id === cardId)?.revision === concurrentBeforeRevision + 2,
      'two-client concurrent moves authoritative delivery',
    );
    await view.rebase({
      authoritativeRows: { boards: [{ _id: boardId, name: 'Exit board' }], cards: actorCards },
      retiredSettlementIdentities: [actorConcurrent.clientMutationId],
      connected: true,
      cause: 'concurrent-moves-authoritative-delivery',
    });

    await waitUntil(
      () => rowsSignature(observerCards) === rowsSignature(actorCards),
      'second-client convergence',
    );

    const base = {
      boards: [{ _id: boardId, name: 'Exit board' }],
      cards: actorCards,
    };
    await writeFile(reloadBasePath, `${JSON.stringify(base)}\n`);
    const childPath = join(DEMO, 'tests/reload-child.mjs');
    const queueChild = fork(childPath, ['queue', reloadDirectory, reloadBasePath], {
      cwd: ROOT, stdio: ['ignore', 'inherit', 'inherit', 'ipc'],
    });
    const queued = await childMessage(queueChild, 'queued');
    assert.equal(queued.outcome.status, 'queued');
    assert.equal(queued.layers, 1);
    assert.equal(queued.titles.filter((title) => title === 'Retained after SIGKILL').length, 1);
    const killed = new Promise((resolveExit) => queueChild.once('exit', (code, signal) => resolveExit({ code, signal })));
    queueChild.kill('SIGKILL');
    const killedExit = await killed;
    assert.equal(killedExit.signal, 'SIGKILL');

    const inspectChild = fork(childPath, ['inspect', reloadDirectory, reloadBasePath], {
      cwd: ROOT, stdio: ['ignore', 'inherit', 'inherit', 'ipc'],
    });
    const inspected = await childMessage(inspectChild, 'inspected');
    await new Promise((resolveExit, reject) => {
      inspectChild.once('exit', (code) => code === 0 ? resolveExit() : reject(new Error(`inspect child exit ${code}`)));
    });
    assert.equal(inspected.layers, 1);
    assert.deepEqual(inspected.layerIds, [queued.outcome.clientMutationId]);
    assert.equal(inspected.titles.filter((title) => title === 'Retained after SIGKILL').length, 1);

    reloadStore = createFileRqsResumeStore({
      directory: reloadDirectory, clientStoreId: 'latency-kanban-kill-reload',
    });
    await reloadStore.whenLockSettled();
    const reloadClient = new SnapbackClient(server.baseUrl, {
      ...server.clientOptions,
      custody: 'anonymous-public',
      rqsStore: reloadStore, offlineQueue: true,
    });
    const replay = await reloadClient.replayQueuedMutations();
    assert.equal(replay.replayed, 1);
    await waitUntil(
      () => observerCards.filter((card) => card.title === 'Retained after SIGKILL').length === 1,
      'observer delivery of relaunched intent',
    );
    const actorFinal = (await actor.client.query(api.boardCards)).rows;
    const observerFinal = (await observer.client.query(api.boardCards)).rows;
    assert.equal(rowsSignature(actorFinal), rowsSignature(observerFinal));
    assert.equal(actorFinal.filter((card) => card.title === 'Retained after SIGKILL').length, 1);
    const reloadRecords = await reloadStore.outboxRecords();
    assert.equal(reloadRecords.filter((record) => record.id === queued.outcome.clientMutationId).length, 1);

    return {
      sourceIdentity: await staticIdentityEvidence(),
      localEvaluation: {
        allFivePaintedFromIr: true,
        latencyMs: Object.fromEntries(VERBS.map((name) => [
          name.replace('Card', '').replace('reorder', 'reorder').toLowerCase(),
          latencies[name === 'createCard' ? 'create' : name === 'editCard' ? 'edit'
            : name === 'assignCard' ? 'assign' : name === 'archiveCard' ? 'archive' : 'reorder'],
        ])),
        lockedRefusalLocalMs: localRefusalMs,
        rapidMoves: {
          count: rapidResults.length,
          stackPaintMs: rapidPaintMs,
          peakLayers: 20,
          visibleRowsBefore: rapidBeforeCount,
          visibleRowsAfter: rapidAfterCount,
        },
      },
      settlement: {
        settlements,
        rapidSettlementIdentities: rapidResults.map((result) => result.clientMutationId),
        concurrentSettlementIdentities: [
          actorConcurrent.clientMutationId,
          observerConcurrent.clientMutationId,
        ],
        refusal: { code: refusal, surfaced: true },
      },
      observerConvergence: {
        secondClient: true, authoritativeRows: actorFinal.length,
        signaturesEqual: rowsSignature(actorFinal) === rowsSignature(observerFinal),
        concurrentMoves: {
          count: 2,
          finalCard: actorFinal.find((card) => card._id === cardId),
        },
      },
      lossFreeReload: {
        processKilledWith: killedExit.signal,
        queuedIdentity: queued.outcome.clientMutationId,
        preKillLayers: queued.layers,
        relaunchLayers: inspected.layers,
        postIntentRowsBeforeNetwork: inspected.titles.filter((title) => title === 'Retained after SIGKILL').length,
        replayed: replay.replayed,
        authoritativeApplications: actorFinal.filter((card) => card.title === 'Retained after SIGKILL').length,
      },
      activation: {
        format: activation.format,
        activationHash: activation.activationHash,
        deploymentId: 'latency-kanban-move3-exit',
      },
      runtime: {
        serverBinary: relative(ROOT, SERVER_BINARY),
        serverBinarySha256: sha256Hex(readFileSync(SERVER_BINARY)),
        launchRung: server.launch?.rung ?? null,
      },
    };
  } finally {
    try { view?.close(); } catch {}
    try { await actorLive?.dispose(); } catch {}
    try { await observerLive?.dispose(); } catch {}
    try { await actor?.store?.close(); } catch {}
    try { await observer?.store?.close(); } catch {}
    try { await reloadStore?.close(); } catch {}
    try { await server?.stop(); } catch {}
    await rm(scratch, { recursive: true, force: true });
  }
}

function sourceProvenance() {
  const paths = [
    'tests/acceptance/latency-kanban-move3-v1.mjs',
    'demos/latency-kanban/tests/reload-child.mjs',
    'demos/latency-kanban/snapback/schema.mjs',
    'demos/latency-kanban/snapback/functions.mjs',
    'demos/latency-kanban/snapback/trusted-composition-activation.json',
    'demos/latency-kanban/snapback/generated/artifacts.json',
    'demos/latency-kanban/src/App.tsx',
    'packages/snapback-client/generated-mutation-ir.mjs',
    'packages/snapback-codegen/index.mjs',
  ];
  return {
    revision: execFileSync('git', ['rev-parse', 'HEAD'], { cwd: ROOT, encoding: 'utf8' }).trim(),
    dirty: true,
    files: paths.filter((path) => existsSync(join(ROOT, path))).map(sourceDigest),
  };
}

function evidenceMarkdown(receipt) {
  const rows = SECTION_NAMES.map((name) => {
    const section = receipt.sections[name];
    return `| ${name} | ${section.status} | ${JSON.stringify(section.evidence).replaceAll('|', '\\|')} |`;
  }).join('\n');
  return `# Latency Kanban Move-3 exit evidence

**Run date:** ${DATE}

**Controlled run:** ${receipt.controlledRun.status}

Each row is a separate receipt section. A sandbox socket denial is recorded as
BLOCKED and is never promoted to PASS.

| Section | Status | Evidence |
| --- | --- | --- |
${rows}
`;
}

async function verifyReceipt() {
  const receipt = JSON.parse(await readFile(RECEIPT_PATH, 'utf8'));
  assert.equal(receipt.schemaVersion, 'snapback.latency-kanban.move3-exit.v1');
  assert.equal(receipt.date, DATE);
  assert.deepEqual(Object.keys(receipt.sections), SECTION_NAMES);
  for (const name of SECTION_NAMES) {
    const section = receipt.sections[name];
    assert.ok(['PASS', 'BLOCKED'].includes(section.status));
    assert.equal(typeof section.evidence, 'object');
    if (section.status === 'BLOCKED') assert.match(section.reason, /^SNAPBACK_KANBAN_SANDBOX_SOCKET_BLOCKED:/u);
  }
  for (const file of receipt.source.files) {
    assert.equal(
      sha256Hex(await readFile(join(ROOT, file.path))),
      file.sha256,
      `${file.path}: retained receipt source drifted from the working tree`,
    );
  }
  if (receipt.controlledRun.status === 'PASS') {
    const activation = JSON.parse(await readFile(
      join(BACKEND, 'trusted-composition-activation.json'),
      'utf8',
    ));
    assert.equal(activation.format, 'snapback.trusted-composition-activation.v1');
    assert.equal(receipt.controlledRun.activation.activationHash, activation.activationHash);
    assert.equal(
      receipt.controlledRun.activation.deploymentId,
      activation.activation.deploymentId,
    );
    // @ref LLP 0157#amendment--2026-08-10-toolchain-stable-activation-identity-ruled
    // — v2 binds authored bytes while retaining the mint-time generation as
    // receipt provenance; v1 keeps its exact-generation binding.
    const activationGeneration = activation.activation.format === 'snapback.composition-activation.v2'
      ? activation.activation.mintedGeneration
      : activation.activation.expectedGeneration;
    for (const plan of Object.values(receipt.sections.sourceIdentity.evidence.generatedPlans)) {
      assert.deepEqual(plan.activation, activationGeneration);
      if (activation.activation.format === 'snapback.composition-activation.v2') {
        assert.equal(plan.authoredSourceHash, activation.activation.authoredSourceHash);
      }
    }
    assert.equal(receipt.summary.pass, 5);
    assert.equal(receipt.summary.blocked, 0);
    assert.deepEqual(Object.keys(receipt.sections.localEvaluation.evidence.latencyMs).sort(), [
      'archive', 'assign', 'create', 'edit', 'reorder',
    ]);
  }
  assert.equal(existsSync(EVIDENCE_PATH), true);
  console.log(`PASS Latency Kanban retained receipt: ${receipt.summary.pass}/5 PASS, ${receipt.summary.blocked} BLOCKED`);
}

async function main() {
  if (process.argv.includes('--check')) return verifyReceipt();
  await rm(join(BACKEND, 'trusted-composition-activation.json'), { force: true });
  const initialGeneration = await generate(BACKEND);
  assert.equal(initialGeneration.ok, true, JSON.stringify(initialGeneration.diagnostics));
  const identity = await staticIdentityEvidence();
  let real = null;
  let block = null;
  try {
    real = await runRealExit();
  } catch (error) {
    if (!isSocketSandboxBlock(error)) throw error;
    block = `SNAPBACK_KANBAN_SANDBOX_SOCKET_BLOCKED: ${String(error?.message ?? error)}`;
  }
  const section = (name) => real
    ? { status: 'PASS', evidence: real[name] }
    : name === 'sourceIdentity'
      ? { status: 'PASS', evidence: identity }
      : { status: 'BLOCKED', evidence: { controlledServerRun: false }, reason: block };
  const sections = Object.fromEntries(SECTION_NAMES.map((name) => [name, section(name)]));
  const receipt = {
    schemaVersion: 'snapback.latency-kanban.move3-exit.v1',
    date: DATE,
    authority: ['LLP 0155 Move 3', 'LLP 0129 Phase 1', 'LLP 0051 D5'],
    source: sourceProvenance(),
    controlledRun: real
      ? { status: 'PASS', activation: real.activation, runtime: real.runtime }
      : { status: 'BLOCKED', reason: block },
    sections,
    summary: {
      pass: Object.values(sections).filter(({ status }) => status === 'PASS').length,
      blocked: Object.values(sections).filter(({ status }) => status === 'BLOCKED').length,
      total: 5,
      capabilityClaimsChanged: false,
    },
  };
  await mkdir(FIXTURE_DIR, { recursive: true });
  await writeFile(RECEIPT_PATH, `${JSON.stringify(receipt, null, 2)}\n`);
  await writeFile(EVIDENCE_PATH, evidenceMarkdown(receipt));
  console.log(JSON.stringify({
    ok: real !== null,
    pass: receipt.summary.pass,
    blocked: receipt.summary.blocked,
    receipt: relative(ROOT, RECEIPT_PATH),
    evidence: relative(ROOT, EVIDENCE_PATH),
  }));
}

await main();

#!/usr/bin/env node

// LLP 0129 Phase-2b sidecar evidence gate: real packaged-runtime process,
// real HostReadyDescriptor/capabilities, native stop, crash restart, a
// pending-work-preserving stop/start swap, fail-closed rollback, and the
// unchanged empty-outbox updater swap.
//
// @ref LLP 0129#phases — a working sidecar behind acceptance precedes any
// in-process embedding claim.
// @ref LLP 0081#desktop-sidecar-updater-attachment-boundary-2026-08-05 —
// incompatible successor artifacts refuse before adopted replay; upgrade
// quarantine remains a separately owned tombstone-and-re-entry seam.

import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { existsSync, readFileSync, readdirSync, realpathSync } from 'node:fs';
import {
  chmod,
  cp,
  mkdir,
  mkdtemp,
  readFile,
  rm,
  symlink,
  writeFile,
} from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, join, relative, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { test } from 'node:test';

import { resolveGeneratedArtifact } from '../../packages/snapback-cli/index.mjs';
import { SnapbackClient } from '../../packages/snapback-client/index.mjs';
import { createFileRqsResumeStore } from '../../packages/snapback-client/rqs-store-file.mjs';
import { generate } from '../../packages/snapback-codegen/index.mjs';
import {
  SidecarChildDiedError,
  SidecarSwapError,
  createSidecarSupervisor,
} from '../../packages/snapback-sidecar/index.mjs';

const here = dirname(fileURLToPath(import.meta.url));
const ROOT = resolve(here, '../..');
const RUN_DATE = '2026-08-06';
const FIXTURE_DIRECTORY = join(ROOT, 'tests/acceptance/fixtures/desktop-sidecar');
const RECEIPT_PATH = join(FIXTURE_DIRECTORY, `phase-2b.${RUN_DATE}.v1.json`);
const SERVER_BINARY = resolve(
  process.env.SNAPBACK_RUNTIME_BINARY ?? join(ROOT, 'target/debug/snapback'),
);
const CHECK_ONLY = process.argv.includes('--check');
const SOURCE_FILES = Object.freeze([
  'packages/snapback-sidecar/index.mjs',
  'packages/snapback-sidecar/index.d.mts',
  'packages/snapback-client/index.mjs',
  'packages/snapback-client/index.d.mts',
  'tests/acceptance/desktop-sidecar-v1.mjs',
]);

const sha256 = (bytes) => createHash('sha256').update(bytes).digest('hex');
const codeOf = (error) => error?.diagnostic?.code ?? error?.code ?? String(error?.message ?? error);
const errorEvidence = (error, depth = 0) => {
  if (!error || depth > 8) return '';
  return [
    error?.stack,
    error?.message,
    error?.diagnostic?.message,
    error?.diagnostic?.details?.stdout,
    error?.diagnostic?.details?.stderr,
    errorEvidence(error?.cause, depth + 1),
  ].filter((value) => typeof value === 'string').join('\n');
};
const isListenerSandboxBlock = (error) => (
  /\bEPERM\b|\bEACCES\b|operation not permitted|socket.*permission|bind.*permission/iu
    .test(errorEvidence(error))
);

const artifactGenerationFromInspection = (inspection) => ({
  schemaVersion: inspection.schema.schemaVersion,
  appId: inspection.schema.appId,
  schemaHash: inspection.schema.schemaHash,
  bundleHash: inspection.functions.bundleHash,
  inputsHash: inspection.schema.inputsHash,
});

function sourceRecord(path) {
  return { path, sha256: sha256(readFileSync(join(ROOT, path))) };
}

function nextEvent(supervisor, type, timeoutMs = 30_000) {
  return new Promise((resolveEvent, reject) => {
    const timer = setTimeout(() => {
      unsubscribe();
      reject(new Error(`timed out waiting for sidecar event ${type}`));
    }, timeoutMs);
    const unsubscribe = supervisor.subscribe((event) => {
      if (event.type !== type) return;
      clearTimeout(timer);
      unsubscribe();
      resolveEvent(event);
    });
  });
}

async function verifyRetainedReceipt() {
  assert.equal(existsSync(RECEIPT_PATH), true, `missing retained sidecar receipt ${RECEIPT_PATH}`);
  const receipt = JSON.parse(await readFile(RECEIPT_PATH, 'utf8'));
  assert.equal(receipt.schemaVersion, 'snapback.desktop-sidecar-acceptance.v1');
  assert.equal(receipt.status, 'PASS');
  assert.equal(receipt.date, RUN_DATE);
  for (const section of Object.values(receipt.sections)) assert.equal(section.status, 'PASS');
  for (const source of receipt.source.files) {
    assert.equal(
      sha256(readFileSync(join(ROOT, source.path))),
      source.sha256,
      `${source.path}: retained sidecar evidence drifted`,
    );
  }
}

test('LLP 0129 Phase 2b desktop sidecar first rung', { timeout: 180_000 }, async () => {
  if (CHECK_ONLY) {
    await verifyRetainedReceipt();
    return;
  }
  assert.equal(existsSync(SERVER_BINARY), true, `missing Snapback runtime ${SERVER_BINARY}`);
  const scratch = await mkdtemp(join(tmpdir(), 'snapback-desktop-sidecar-'));
  const backend = join(scratch, 'app', 'snapback');
  const generated = join(backend, 'generated');
  const database = join(scratch, 'state', 'desktop.sqlite3');
  const startupArtifacts = join(scratch, 'state', 'startup-artifacts.json');
  const clientStoreDirectory = join(scratch, 'client-store');
  const candidatePackage = join(scratch, 'runtime-candidate');
  const candidateBinary = join(candidatePackage, 'bin', 'snapback');
  let supervisor = null;
  let store = null;
  let currentClient = null;
  let rebindStoreOverride = null;
  let rebindGenerationOverride = null;
  let cleanupFailure = null;
  const resumeEvidence = [];
  const restartDecisions = [];

  try {
    await cp(join(ROOT, 'packages/snapback-cli/templates/todo-contract/snapback'), backend, {
      recursive: true,
    });
    const generation = await generate(backend);
    assert.equal(generation.ok, true, JSON.stringify(generation.diagnostics));
    await mkdir(dirname(startupArtifacts), { recursive: true });
    await writeFile(startupArtifacts, `${JSON.stringify({
      formatVersion: 1,
      schema: JSON.parse(await readFile(
        resolveGeneratedArtifact(generated, 'schema.manifest.json'),
        'utf8',
      )),
      functions: JSON.parse(await readFile(
        resolveGeneratedArtifact(generated, 'functions.manifest.json'),
        'utf8',
      )),
    })}\n`, { mode: 0o600 });
    const apiModule = await import(
      `${pathToFileURL(resolveGeneratedArtifact(generated, 'api.mjs')).href}?sidecar=${Date.now()}`
    );
    const api = apiModule.default;
    const artifactGeneration = api.createTodo.expectedGeneration;

    await mkdir(clientStoreDirectory, { recursive: true });
    store = createFileRqsResumeStore({
      directory: clientStoreDirectory,
      clientStoreId: 'desktop-sidecar-acceptance',
    });
    await store.whenLockSettled();

    const attachClient = async (attachment, rqsStore = store) => {
      const adminToken = await attachment.capabilities.adminToken.read();
      currentClient = new SnapbackClient(attachment.url, {
        adminToken,
        rqsStore,
        offlineQueue: true,
      });
      return currentClient;
    };
    const outbox = {
      async status() {
        const records = await store.outboxRecords();
        const storeMeta = await store.readStoreMeta();
        return {
          schemaVersion: 'snapback.desktop-sidecar-store-handoff.v1',
          clientStoreId: storeMeta.clientStoreId,
          writer: store.isWriter() === true,
          artifactGeneration,
          pending: records.filter((record) => record.status === 'pending').length,
          settled: records.filter((record) => record.status === 'settled').length,
          failed: records.filter((record) => record.status === 'failed').length,
          quarantined: records.filter((record) => record.status === 'quarantined').length,
          resultGone: records.filter((record) => record.status === 'result-gone').length,
        };
      },
      async quiesce() {
        const snapshot = await this.status();
        let reboundClient = null;
        let reboundUrl = null;
        let candidateResumeAttempted = false;
        return {
          snapshot,
          async settled() {
            const status = await currentClient.outboxStatus();
            assert.equal(status.replaying, false, 'swap begins only after the in-flight replay drain settles');
          },
          async rebind({ outcome, attachment }) {
            const selectedStore = outcome === 'swapped' && rebindStoreOverride
              ? rebindStoreOverride
              : store;
            reboundClient = await attachClient(attachment, selectedStore);
            reboundUrl = reboundClient.baseUrl;
            assert.equal(
              reboundUrl,
              attachment.url.replace(/\/$/u, ''),
              'the app-owned client must target the selected sidecar attachment before replay',
            );
            // The application owns this barrier: restore one complete fresh
            // application snapshot before the adopted queue can submit.
            await reboundClient.query(api.listTodos, { userId });
            const candidateGeneration = rebindGenerationOverride && outcome === 'swapped'
              ? rebindGenerationOverride
              : artifactGenerationFromInspection(await reboundClient.inspect());
            const storeMeta = await selectedStore.readStoreMeta();
            return {
              schemaVersion: 'snapback.desktop-sidecar-binding.v2',
              attachedUrl: reboundUrl,
              startupNonce: attachment.healthyStart.startupNonce,
              clientStoreId: storeMeta.clientStoreId,
              writer: selectedStore.isWriter() === true,
              freshSnapshotBarrier: {
                schemaVersion: 'snapback.outbox-fresh-snapshot-barrier.v1',
                status: 'passed',
                kind: 'full-snapshot',
              },
              artifactGeneration: candidateGeneration,
            };
          },
          async resume({ outcome, attachment, binding, snapshot: captured }) {
            assert(reboundClient, 'resume requires a completed client rebind');
            assert.equal(binding.attachedUrl, reboundUrl);
            assert.equal(reboundUrl, attachment.url.replace(/\/$/u, ''));
            if (outcome !== 'swapped' && !candidateResumeAttempted) {
              const retained = await outbox.status();
              return {
                schemaVersion: 'snapback.desktop-sidecar-outbox-resume.v2',
                attachedUrl: reboundUrl,
                startupNonce: attachment.healthyStart.startupNonce,
                clientStoreId: binding.clientStoreId,
                writer: binding.writer,
                freshSnapshotBarrier: binding.freshSnapshotBarrier,
                artifactGeneration: binding.artifactGeneration,
                pendingBefore: captured.pending,
                replayed: 0,
                failedDelta: 0,
                quarantinedDelta: 0,
                resultGoneDelta: 0,
                remaining: retained.pending + retained.quarantined + retained.resultGone,
                stopped: retained.pending + retained.quarantined + retained.resultGone > 0,
              };
            }
            if (outcome === 'swapped') candidateResumeAttempted = true;
            const replay = await reboundClient.adoptQueuedMutations({
              expectedClientStoreId: captured.clientStoreId,
              expectedGeneration: captured.artifactGeneration,
              afterFreshSnapshot: async () => binding.freshSnapshotBarrier,
            });
            resumeEvidence.push({ outcome, replay });
            return {
              schemaVersion: 'snapback.desktop-sidecar-outbox-resume.v2',
              attachedUrl: reboundUrl,
              startupNonce: attachment.healthyStart.startupNonce,
              clientStoreId: replay.clientStoreId,
              writer: replay.writer,
              freshSnapshotBarrier: replay.freshSnapshotBarrier,
              artifactGeneration: replay.artifactGeneration,
              pendingBefore: replay.pendingBefore,
              replayed: replay.replayed,
              failedDelta: replay.failedDelta,
              quarantinedDelta: replay.quarantinedDelta,
              resultGoneDelta: replay.resultGoneDelta,
              remaining: replay.remaining,
              stopped: replay.stopped,
            };
          },
        };
      },
    };

    supervisor = createSidecarSupervisor({
      projectRoot: ROOT,
      database,
      runtimeBinary: SERVER_BINARY,
      stateDirectory: join(scratch, 'sidecar-state'),
      startArgs: ['--startup-artifacts', startupArtifacts],
      readyTimeoutMs: 120_000,
      stopTimeoutMs: 20_000,
      env: {
        ...process.env,
        DYLD_FRAMEWORK_PATH: join(ROOT, 'vendor/ibex/ios/Frameworks'),
      },
      restartPolicy: {
        maxAttempts: 1,
        backoffMs: 0,
        decide(context) {
          restartDecisions.push({ attempt: context.attempt, code: context.error.code });
          return 'restart';
        },
      },
      outbox,
    });

    let attachment;
    try {
      attachment = await supervisor.start();
    } catch (error) {
      if (isListenerSandboxBlock(error)) {
        const blocked = new Error(
          'SIDECAR_LISTENER_BLOCKED: rerun outside the listener-blocked sandbox with '
          + `DYLD_FRAMEWORK_PATH=$PWD/vendor/ibex/ios/Frameworks SNAPBACK_RUNTIME_BINARY=$PWD/target/debug/snapback node --test tests/acceptance/desktop-sidecar-v1.mjs`,
          { cause: error },
        );
        blocked.code = 'SIDECAR_LISTENER_BLOCKED';
        throw blocked;
      }
      throw error;
    }
    assert.equal(attachment.healthyStart.attested, true);
    assert.equal(attachment.healthyStart.requestedPort, 0);
    assert.equal(attachment.healthyStart.actualPort, attachment.port);
    assert.equal(new URL(attachment.url).port, String(attachment.port));
    assert.notEqual(attachment.port, 0);
    // macOS symlinks /var -> /private/var; the runtime reports the resolved
    // path while the test's tmpdir may be the symlink. Compare canonically.
    assert.equal(realpathSync(attachment.database.path), realpathSync(database));
    const capabilitySecrets = await Promise.all([
      attachment.capabilities.adminToken.read(),
      attachment.capabilities.secretReadRoot.read(),
      attachment.capabilities.impersonation.read(),
    ]);
    assert(capabilitySecrets.every((secret) => typeof secret === 'string' && secret.length > 0));
    const serializedAttachment = JSON.stringify(attachment);
    for (const secret of capabilitySecrets) assert.equal(serializedAttachment.includes(secret), false);
    await supervisor.health();

    await attachClient(attachment);
    const userId = 'desktop_sidecar_user';
    const baseline = await currentClient.mutate(api.createTodo, {
      userId,
      args: { title: 'before crash restart' },
      clientMutationId: 'cm-sidecar-baseline',
    });
    assert.equal(baseline.changed_count, 1);
    const deadMintingClient = currentClient;

    const childDied = nextEvent(supervisor, 'child-died');
    const restarted = nextEvent(supervisor, 'restarted');
    process.kill(attachment.pid, 'SIGKILL');
    const diedEvent = await childDied;
    assert(diedEvent.error instanceof SidecarChildDiedError);
    assert.equal(diedEvent.error.code, 'SIDECAR_CHILD_DIED');
    const restartedEvent = await restarted;
    assert.notEqual(restartedEvent.attachment.pid, attachment.pid);
    assert.deepEqual(restartDecisions, [{ attempt: 1, code: 'SIDECAR_CHILD_DIED' }]);
    await supervisor.health();
    attachment = restartedEvent.attachment;
    await attachClient(attachment);

    await mkdir(dirname(candidateBinary), { recursive: true });
    await symlink(SERVER_BINARY, candidateBinary);
    assert.equal((await outbox.status()).pending, 0);
    const oldPidBeforeEmptySwap = supervisor.attachment.pid;
    const swap = await supervisor.swap({ runtime: { runtimeBinary: candidateBinary } });
    assert.equal(swap.outcome, 'swapped');
    assert.equal(swap.fromPid, oldPidBeforeEmptySwap);
    assert.notEqual(swap.fromPid, swap.toPid);
    assert.equal(swap.outboxSnapshot.pending, 0);
    assert.equal(swap.outboxResume.attachedUrl, swap.attachment.url.replace(/\/$/u, ''));
    assert.equal(swap.outboxResume.replayed, 0);
    assert.equal(swap.outboxResume.remaining, 0);
    assert.equal(swap.outboxResume.stopped, false);
    assert.equal(resumeEvidence.at(-1).outcome, 'swapped');
    assert.equal(resumeEvidence.at(-1).replay.replayed, 0);
    assert.equal((await outbox.status()).pending, 0);

    // Queue through the shipped transport-failure path on the SAME client
    // instance that minted the intent. Its original runtime URL died in the
    // crash-restart leg above, so this is a genuine offline enqueue rather
    // than direct test-store fabrication.
    const queued = await deadMintingClient.mutate(api.createTodo, {
      userId,
      args: { title: 'durable pending intent during updater swap' },
    });
    assert.equal(queued.status, 'queued');
    assert.equal((await outbox.status()).pending, 1);
    const pendingRecord = (await store.outboxRecords()).find(
      (record) => record.id === queued.clientMutationId,
    );
    assert.equal(pendingRecord?.status, 'pending');

    const swapProtocolEvents = [];
    const unsubscribeSwapEvents = supervisor.subscribe((event) => {
      if (event.type.startsWith('swap-')) swapProtocolEvents.push(event);
    });
    const resumesBeforePendingSwap = resumeEvidence.length;
    const pendingSwap = await supervisor.swap({ runtime: { runtimeBinary: SERVER_BINARY } });
    unsubscribeSwapEvents();
    assert.equal(
      swapProtocolEvents.some((event) => event.type === 'swap-completed'),
      true,
      'a checked shared-store adoption commits the candidate',
    );
    const pendingCandidateResume = resumeEvidence[resumesBeforePendingSwap];
    assert.equal(pendingCandidateResume.outcome, 'swapped');
    assert.equal(pendingCandidateResume.replay.pendingBefore, 1);
    assert.equal(pendingCandidateResume.replay.replayed, 1);
    assert.equal(pendingCandidateResume.replay.remaining, 0);
    assert.equal(pendingCandidateResume.replay.stopped, false);
    assert.equal(pendingSwap.outboxResume.clientStoreId, (await store.readStoreMeta()).clientStoreId);
    assert.equal(pendingSwap.outboxResume.startupNonce, pendingSwap.attachment.healthyStart.startupNonce);
    assert.equal(pendingSwap.outboxResume.writer, true);
    assert.equal(supervisor.status().state, 'attached');
    assert.equal(supervisor.attachment.runtime.binary, SERVER_BINARY);
    await supervisor.health();
    assert.equal((await outbox.status()).pending, 0, 'candidate adoption drained the shared store');
    assert.equal(
      (await store.outboxRecords()).find((record) => record.id === queued.clientMutationId)?.status,
      'settled',
    );

    const firstRows = (await currentClient.query(api.listTodos, { userId })).rows;
    assert.equal(
      firstRows.filter((row) => row.title === 'durable pending intent during updater swap').length,
      1,
      'candidate applied the adopted intent exactly once',
    );
    const adoptedSettlement = (await currentClient.settledMutations({ userId }))
      .find((entry) => entry.clientMutationId === queued.clientMutationId)?.settlement;
    assert(adoptedSettlement, 'adopted settlement remains recoverable before ACK');
    const duplicate = await currentClient.mutate(api.createTodo, {
      userId,
      args: { title: 'durable pending intent during updater swap' },
      clientMutationId: queued.clientMutationId,
      queue: false,
    });
    const afterDuplicateRows = (await currentClient.query(api.listTodos, { userId })).rows;
    assert.equal(afterDuplicateRows.length, firstRows.length, 'duplicate did not add a row');
    assert.equal(duplicate.version, adoptedSettlement.version, 'duplicate republished the same version');
    assert.deepEqual(duplicate.result, adoptedSettlement.result, 'duplicate republished the same result');

    // Identity divergence is candidate-local failure, not permission to
    // drop the shared record. The adoption drain leaves it pending, the
    // sidecar stops the candidate, and rollback reattaches the predecessor.
    const divergentId = 'cm-sidecar-identity-divergence';
    const directClient = new SnapbackClient(supervisor.attachment.url, {
      adminToken: await supervisor.attachment.capabilities.adminToken.read(),
      rqsStore: null,
      offlineQueue: false,
    });
    await directClient.mutate(api.createTodo, {
      userId,
      args: { title: 'settled identity' },
      clientMutationId: divergentId,
      queue: false,
    });
    await store.outboxEnqueue({
      id: divergentId,
      function: api.createTodo.name,
      args: { title: 'divergent identity' },
      userId,
      expectedGeneration: artifactGeneration,
    });
    let divergentCandidatePid = null;
    await assert.rejects(
      () => supervisor.swap({
        runtime: { runtimeBinary: candidateBinary },
        async verifyCandidate(candidate) {
          divergentCandidatePid = candidate.pid;
        },
      }),
      (error) => {
        assert(error instanceof SidecarSwapError);
        assert.equal(error.code, 'SIDECAR_SWAP_FAILED');
        assert.equal(error.details.causeCode, 'SIDECAR_OUTBOX_RESUME_INCOMPLETE');
        assert.equal(error.attached, 'old');
        assert(error.attachment);
        return true;
      },
    );
    assert.notEqual(supervisor.attachment.pid, divergentCandidatePid);
    assert.equal(supervisor.status().state, 'attached');
    await supervisor.health();
    assert.equal((await outbox.status()).pending, 1);
    assert.equal(
      (await store.outboxRecords()).find((record) => record.id === divergentId)?.status,
      'pending',
    );
    await store.outboxDiscard(divergentId);

    // A fresh same-identity store instance is a reader until exact writer
    // takeover. The sidecar rejects its v2 binding and rolls back without
    // attempting replay or losing the intent.
    const writerFenceId = 'cm-sidecar-writer-fence';
    await store.outboxEnqueue({
      id: writerFenceId,
      function: api.createTodo.name,
      args: { title: 'writer fence' },
      userId,
      expectedGeneration: artifactGeneration,
    });
    const readerStore = createFileRqsResumeStore({ directory: clientStoreDirectory });
    await readerStore.whenLockSettled();
    assert.equal(readerStore.isWriter(), false);
    rebindStoreOverride = readerStore;
    let writerFenceCandidatePid = null;
    await assert.rejects(
      () => supervisor.swap({
        runtime: { runtimeBinary: candidateBinary },
        async verifyCandidate(candidate) { writerFenceCandidatePid = candidate.pid; },
      }),
      (error) => (
        error instanceof SidecarSwapError
        && error.details.causeCode === 'SIDECAR_OUTBOX_REBIND_INVALID'
        && error.attached === 'old'
      ),
    );
    rebindStoreOverride = null;
    await readerStore.close();
    assert.notEqual(supervisor.attachment.pid, writerFenceCandidatePid);
    assert.equal(
      (await store.outboxRecords()).find((record) => record.id === writerFenceId)?.status,
      'pending',
    );
    await store.outboxDiscard(writerFenceId);

    // A candidate schema/function receipt that diverges from the predecessor
    // handoff is refused before adoption. The client suite separately proves
    // the same comparison against the real /inspect response.
    const incompatibleId = 'cm-sidecar-incompatible-successor';
    await store.outboxEnqueue({
      id: incompatibleId,
      function: api.createTodo.name,
      args: { title: 'incompatible successor' },
      userId,
      expectedGeneration: artifactGeneration,
    });
    rebindGenerationOverride = {
      ...artifactGeneration,
      schemaHash: `sha256:${'f'.repeat(64)}`,
    };
    let incompatibleCandidatePid = null;
    await assert.rejects(
      () => supervisor.swap({
        runtime: { runtimeBinary: candidateBinary },
        async verifyCandidate(candidate) { incompatibleCandidatePid = candidate.pid; },
      }),
      (error) => (
        error instanceof SidecarSwapError
        && error.details.causeCode === 'SIDECAR_OUTBOX_REBIND_INVALID'
        && error.attached === 'old'
      ),
    );
    rebindGenerationOverride = null;
    assert.notEqual(supervisor.attachment.pid, incompatibleCandidatePid);
    assert.equal(
      (await store.outboxRecords()).find((record) => record.id === incompatibleId)?.status,
      'pending',
    );
    await store.outboxDiscard(incompatibleId);

    const stop = await supervisor.stop();
    assert.equal(stop.graceful, true);
    assert.equal(stop.childExited, true);
    assert.equal(stop.descriptorRemoved, true);
    assert.equal(stop.healthUnavailable, true);
    assert.equal(stop.escalatedTo, null);

    const sourceRevision = execFileSync('git', ['rev-parse', 'HEAD'], {
      cwd: ROOT,
      encoding: 'utf8',
    }).trim();
    const receipt = {
      schemaVersion: 'snapback.desktop-sidecar-acceptance.v1',
      date: RUN_DATE,
      status: 'PASS',
      authority: ['LLP 0129 Phase 2b', 'LLP 0030 attach'],
      source: {
        revision: sourceRevision,
        dirty: execFileSync('git', ['status', '--porcelain'], { cwd: ROOT, encoding: 'utf8' }).trim().length > 0,
        files: SOURCE_FILES.map(sourceRecord),
      },
      runtime: {
        platform: process.platform,
        architecture: process.arch,
        binary: relative(ROOT, SERVER_BINARY),
        binarySha256: sha256(readFileSync(SERVER_BINARY)),
      },
      sections: {
        healthyStart: {
          status: 'PASS',
          descriptorValidated: true,
          healthNonceAttested: true,
          capabilityHandles: ['admin-token', 'secret-read-root', 'impersonation'],
          secretSerialization: 'redacted',
        },
        portCustody: {
          status: 'PASS',
          requested: 0,
          actualReportedByDescriptor: true,
          fixedPort: false,
        },
        crashRestart: {
          status: 'PASS',
          errorCode: diedEvent.error.code,
          restartAttempts: restartDecisions.length,
          boundedMaximum: 1,
          newProcessAttached: true,
        },
        pendingOutboxSwap: {
          status: 'PASS',
          pendingBefore: 1,
          queuedBy: 'same-client transport failure',
          clientMutationId: queued.clientMutationId,
          candidateReplay: pendingCandidateResume.replay,
          successfulSwapEventEmitted: true,
          candidateOrigin: pendingSwap.outboxResume.attachedUrl,
          candidateStartupNonce: pendingSwap.outboxResume.startupNonce,
          clientStoreId: pendingSwap.outboxResume.clientStoreId,
          writer: pendingSwap.outboxResume.writer,
          pendingAfter: 0,
          durableRecordStatus: 'settled',
          rowCountUnchangedByDuplicate: afterDuplicateRows.length === firstRows.length,
          duplicateVersion: duplicate.version,
          disposition: 'pending-work-preserving stop/start swap',
        },
        emptyOutboxSwap: {
          status: 'PASS',
          pendingBefore: swap.outboxSnapshot.pending,
          reboundUrl: swap.outboxResume.attachedUrl,
          replayedAfterAttach: swap.outboxResume.replayed,
          pendingAfter: swap.outboxResume.remaining,
          outcome: swap.outcome,
          outboxCustody: 'client-file-store',
        },
        failClosedMatrix: {
          status: 'PASS',
          identityDivergence: 'candidate stopped; predecessor reattached; intent pending',
          writerFenceNotAcquired: 'candidate stopped; predecessor reattached; intent pending',
          incompatibleSuccessor: 'candidate stopped; predecessor reattached; intent pending',
        },
        gracefulStop: {
          status: 'PASS',
          nativeNonceVerifiedStop: stop.stopStatus === 0,
          childExited: stop.childExited,
          descriptorRemoved: stop.descriptorRemoved,
          healthUnavailable: stop.healthUnavailable,
        },
      },
      explicitFollowOns: {
        llp0081: 'upgrade-required hook only; tombstone-and-re-entry quarantine not implemented',
        llp0123: 'package seal is consumed; an in-serving-process boot witness remains separate',
        pendingOutboxHotSwap: 'built for one explicit caller-owned shared sidecar store with checked adoption',
        zeroRequestDowntime: 'not claimed: the supervisor still stops the predecessor before starting the candidate; a stable front door or overlapping runtimes is separate work',
        inProcessEmbedding: 'no stable ABI; separately gated spike remains',
      },
    };
    await mkdir(FIXTURE_DIRECTORY, { recursive: true });
    await writeFile(RECEIPT_PATH, `${JSON.stringify(receipt, null, 2)}\n`);
  } finally {
    try {
      if (supervisor?.status().state === 'attached') await supervisor.stop();
    } catch (error) {
      cleanupFailure = error;
    }
    try {
      await store?.close();
    } catch (error) {
      cleanupFailure ??= error;
    }
    await rm(scratch, { recursive: true, force: true });
    if (cleanupFailure) throw cleanupFailure;
  }
});

if (!CHECK_ONLY) {
  process.on('beforeExit', () => {
    if (existsSync(RECEIPT_PATH)) {
      const names = readdirSync(FIXTURE_DIRECTORY).filter((name) => name.startsWith('phase-2b.'));
      assert(names.includes(`phase-2b.${RUN_DATE}.v1.json`));
    }
  });
}

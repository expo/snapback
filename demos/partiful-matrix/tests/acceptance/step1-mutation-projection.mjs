#!/usr/bin/env bun

import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { spawnSync } from 'node:child_process';

import { createKeyedSnapbackContractProvider } from '../../../../packages/snapback-contract/keyed-provider.mjs';

const here = dirname(fileURLToPath(import.meta.url));
const snapbackRoot = resolve(here, '../../../..');
const exactRoot = resolve(process.env.EXACT_ROOT ?? join(snapbackRoot, '..', 'exact'));
const resultPath = join(snapbackRoot, 'demos/partiful-matrix/acceptance/results/step1-mutation-projection.json');
const write = process.argv.includes('--write');

assert(existsSync(join(exactRoot, 'packages/exact-contract/src/runtime/index.ts')),
  `Exact runtime source is missing under ${exactRoot}; set EXACT_ROOT to the Exact checkout under test`);
const runtime = await import(pathToFileURL(join(exactRoot, 'packages/exact-contract/src/runtime/index.ts')).href);
const { SyntheticFailingDataProvider } = await import(pathToFileURL(
  join(exactRoot, 'packages/exact-contract/src/runtime/synthetic-failing-provider.ts'),
).href);

const exactTest = spawnSync(
  process.execPath,
  ['test', 'packages/exact-contract/src/__tests__/mutation-projection.test.ts'],
  { cwd: exactRoot, encoding: 'utf8', env: process.env },
);
assert.equal(exactTest.status, 0, `Exact mutation projection oracle failed\n${exactTest.stdout}\n${exactTest.stderr}`);
const exactTestOutput = `${exactTest.stdout}\n${exactTest.stderr}`;
const exactOracleTests = Number(exactTestOutput.match(/(\d+) pass/)?.[1] ?? 0);
assert(exactOracleTests >= 14, `expected at least 14 Exact projection tests, observed ${exactOracleTests}`);

const ATTEMPT = 'attempt-partitime';
const address = {
  version: 1,
  moduleId: '/partitime/event.contract',
  templateKind: 'component',
  template: 'EventDetail',
  declarationKind: 'mutation',
  declarationId: 'mutation:rsvp',
  logicalInstancePath: ['root', 'event'],
};
const commitReceipt = (outcome, overrides = {}) => ({
  version: 1,
  receiptId: `commit-${outcome.kind}`,
  attemptId: ATTEMPT,
  address,
  outcome,
  winningInputId: 'input-1',
  inputSequence: 1,
  queueEpoch: 10,
  causalParents: [],
  scopeId: 'scope-root',
  evidencePosture: 'promised',
  committedAtMonotonicMs: 100,
  ...overrides,
});
const evidenceLink = (receipt, overrides = {}) => ({
  version: 1,
  evidenceId: `evidence-${receipt.mutationId}`,
  attemptId: ATTEMPT,
  providerId: 'snapback-partitime',
  providerReceiptId: receipt.mutationId,
  posture: 'promised',
  outcome: receipt.outcome,
  observedAtEpoch: 5,
  ...overrides,
});
const project = (inputs) => runtime.reduceMutationProjection(runtime.projectionFactsFromRuntime(inputs));

class FaultInjectingSnapbackClient {
  scripts = [];
  listeners = new Set();
  ring = new Map();
  deferredReceipts = [];
  hanging = [];
  effects = new Map();
  sequence = 0;

  script(...behaviors) { this.scripts.push(...behaviors); }
  onReceipt(listener) { this.listeners.add(listener); return () => this.listeners.delete(listener); }
  receipts() { return [...this.ring.values()]; }
  flushLateReceipts() {
    for (const receipt of this.deferredReceipts.splice(0)) this.emit(receipt);
  }
  emit(receipt) {
    // The provider-core ring is idempotent by mutation identity even when the
    // transport duplicates delivery. Observers may still see the duplicate.
    this.ring.set(receipt.mutationId, receipt);
    for (const listener of [...this.listeners]) {
      try { listener(receipt); } catch { /* observational isolation */ }
    }
  }
  receipt(id, outcome, correlation, extra = {}) {
    this.sequence += 1;
    return {
      kind: 'mutation',
      mutationId: id,
      rootId: correlation?.rootId ?? 'partitime-root',
      bindingIds: correlation?.bindingIds ?? [],
      actionInvocationId: correlation?.actionInvocationId,
      optimisticWaveId: correlation?.optimisticWaveId,
      outcome,
      snapshotVersion: this.sequence,
      transport: 'stream',
      ...extra,
    };
  }
  async mutate(name, options) {
    const behavior = this.scripts.shift() ?? { kind: 'reject', message: 'unscripted fault' };
    const id = String(options.args.clientMutationId ?? `mutation-${this.sequence + 1}`);
    const existing = this.effects.get(id);

    if (behavior.kind === 'hang') {
      return new Promise((resolvePromise) => this.hanging.push({ id, resolvePromise }));
    }
    if (behavior.kind === 'commit-timeout') {
      if (!existing) this.effects.set(id, { value: { settled: id }, effectCount: 1 });
      return new Promise((resolvePromise) => this.hanging.push({ id, resolvePromise }));
    }
    if (behavior.kind === 'confirm' || behavior.kind === 'duplicate-confirm') {
      const effect = existing ?? { value: { settled: id }, effectCount: 1 };
      if (!existing) this.effects.set(id, effect);
      const receipt = this.receipt(id, 'confirmed', options.correlation, { overlayClass: 'derived' });
      if (behavior.timing === 'deferred') this.deferredReceipts.push(receipt);
      else this.emit(receipt);
      if (behavior.kind === 'duplicate-confirm') this.emit(receipt);
      return effect.value;
    }
    const receipt = this.receipt(id, 'rejected', options.correlation, {
      rollbackReason: behavior.message ?? 'capacity',
      overlayClass: 'reducer',
    });
    this.emit(receipt);
    const error = new Error(behavior.message ?? 'rejected');
    error.receipt = receipt;
    throw error;
  }
}

const manifest = {
  artifactKind: 'contractDataManifest',
  manifestVersion: 2,
  provider: 'snapback-partitime-faults',
  capabilities: {
    localReplica: false,
    subscriptions: false,
    initialSnapshot: false,
    optimisticMutations: true,
    rowSyncState: false,
    serverRunnableQueries: false,
    forceStates: false,
    branchableFixtures: false,
    headlessBoot: true,
  },
  queries: {},
  mutations: { rsvp: { name: 'rsvp', args: {}, writes: ['rsvps'], optimistic: true, serverRunnable: true } },
};
const client = new FaultInjectingSnapbackClient();
const surface = createKeyedSnapbackContractProvider({
  runtime,
  client,
  manifest,
  userId: 'user-partitime',
  rootId: 'partitime-mutation-root',
});

// Rejection + rollback: settled provider refusal becomes consistent evidence
// for an immutable supervisor error outcome.
client.script({ kind: 'reject', message: 'event is full' });
const rejected = await surface.links.rsvp({ eventId: 'event-a', clientMutationId: 'reject-1' });
assert.equal(rejected.ok, false);
const rejectedReceipt = client.receipts().at(-1);
assert.equal(rejectedReceipt.outcome, 'rejected');
const rejectionProjection = project({
  receipt: commitReceipt({ kind: 'error', error: { message: 'event is full' } }),
  evidenceLinks: [evidenceLink(rejectedReceipt)],
  overlayClass: 'reducer',
  overlayLifecycle: 'failed',
});
assert.equal(rejectionProjection.display, 'matched');
assert.equal(rejectionProjection.flags.canRetry, true);
assert.equal(rejectionProjection.flags.rolledBack, true);

// Late confirmation: the commit is first rendered as awaiting; a delayed raw
// provider receipt later projects to late+reconciled without rewriting it.
client.script({ kind: 'confirm', timing: 'deferred' });
const lateResult = await surface.links.rsvp({ eventId: 'event-a', clientMutationId: 'late-1' });
assert.equal(lateResult.ok, true);
assert.equal(client.receipts().some((receipt) => receipt.mutationId === 'late-1'), false);
const awaitingProjection = project({
  receipt: commitReceipt({ kind: 'ok' }),
  evidenceLinks: [],
  declaredPosture: 'promised',
  nowEpoch: 11,
  missingPromisedWindow: { epochs: 5 },
  overlayClass: 'derived',
  overlayLifecycle: 'confirmed',
});
assert.equal(awaitingProjection.display, 'awaiting');
client.flushLateReceipts();
const lateReceipt = client.receipts().find((receipt) => receipt.mutationId === 'late-1');
const lateProjection = project({
  receipt: commitReceipt({ kind: 'ok' }),
  evidenceLinks: [evidenceLink(lateReceipt, { observedAtEpoch: 42 })],
  overlayClass: 'derived',
  overlayLifecycle: 'confirmed',
});
assert.equal(lateProjection.display, 'late');
assert.equal(lateProjection.flags.reconciled, true);

// Receipt-less timeout remains an explicit ambiguous/missing-promised state.
client.script({ kind: 'hang' });
let timeoutSettled = false;
void surface.links.rsvp({ eventId: 'event-a', clientMutationId: 'timeout-1' })
  .then(() => { timeoutSettled = true; });
await Promise.resolve();
assert.equal(timeoutSettled, false);
assert.equal(project({ attemptId: ATTEMPT, evidenceLinks: [], declaredPosture: 'promised' }).display, 'not-applicable');
const ambiguityProjection = project({
  receipt: commitReceipt({ kind: 'error', error: { message: 'transport timeout' } }),
  evidenceLinks: [],
  declaredPosture: 'promised',
  nowEpoch: 20,
  missingPromisedWindow: { epochs: 5 },
});
assert.equal(ambiguityProjection.display, 'missing-promised');
assert.equal(ambiguityProjection.flags.canRetry, true);

// Retry/duplicate/idempotency: the first request commits but loses its
// response; retrying the same clientMutationId returns the one settlement,
// duplicate receipt delivery does not create another effect or ring row.
client.script(
  { kind: 'commit-timeout' },
  { kind: 'confirm' },
  { kind: 'duplicate-confirm' },
);
void surface.links.rsvp({ eventId: 'event-b', clientMutationId: 'retry-1' });
await Promise.resolve();
const retried = await surface.links.rsvp({ eventId: 'event-b', clientMutationId: 'retry-1' });
const duplicated = await surface.links.rsvp({ eventId: 'event-b', clientMutationId: 'retry-1' });
assert.equal(retried.ok, true);
assert.equal(duplicated.ok, true);
assert.equal(client.effects.get('retry-1').effectCount, 1, 'retry and duplicate delivery execute one effect');
assert.equal(client.receipts().filter((receipt) => receipt.mutationId === 'retry-1').length, 1,
  'duplicate delivery retains one provider-core settlement row');

// Non-Snapback comparison provider drives the same projection vocabulary.
const synthetic = new SyntheticFailingDataProvider(['rsvp']);
synthetic.scriptMutation('rsvp', {
  kind: 'reject',
  message: 'event is full',
  rollbackReason: 'capacity',
  overlayClass: 'reducer',
});
const syntheticResult = await synthetic.mutate('rsvp', {}, { rootId: 'synthetic-root' });
assert.equal(syntheticResult.ok, false);
const syntheticReceipt = synthetic.receipts()[0];
const syntheticProjection = project({
  receipt: commitReceipt({ kind: 'error', error: { message: 'event is full' } }),
  evidenceLinks: [evidenceLink(syntheticReceipt, { providerId: 'synthetic-failing' })],
  overlayClass: syntheticReceipt.overlayClass,
  overlayLifecycle: 'failed',
});
assert.deepEqual(syntheticProjection.flags, rejectionProjection.flags);
assert.equal(syntheticProjection.display, rejectionProjection.display);

// Contradictory late evidence stays visible and never rewrites the immutable
// error commit.
const disagreement = project({
  receipt: commitReceipt({ kind: 'error', error: { message: 'supervisor refused' } }),
  evidenceLinks: [evidenceLink(lateReceipt, { observedAtEpoch: 42, outcome: 'confirmed' })],
  overlayClass: 'derived',
  overlayLifecycle: 'confirmed',
});
assert.equal(disagreement.display, 'late-contradictory');
assert.equal(disagreement.flags.disagreement, true);
assert.deepEqual(disagreement.attempt, { phase: 'committed', outcome: 'error' });

surface.dispose();

const sourceFiles = [
  join(snapbackRoot, 'packages/snapback-contract/keyed-provider.mjs'),
  join(snapbackRoot, 'llp/0043-offline-replay-retention.rfc.md'),
  join(exactRoot, 'packages/exact-contract/src/runtime/mutation-projection.ts'),
  join(exactRoot, 'packages/exact-contract/src/runtime/synthetic-failing-provider.ts'),
  join(exactRoot, 'packages/exact-contract/src/__tests__/mutation-projection.test.ts'),
];
const sha256 = (path) => createHash('sha256').update(readFileSync(path)).digest('hex');
const receipt = {
  schemaVersion: 'partitime.step1-mutation-projection.v1',
  claim: 'STEP1.MUTATION_PROJECTION',
  ok: true,
  providers: ['snapback-partitime-faults', 'synthetic-failing'],
  schedules: ['rejection', 'timeout', 'retry', 'duplicate', 'idempotency', 'late-confirmation', 'receiptless-ambiguity', 'contradictory-late-evidence'],
  observed: {
    exactOracleTests,
    snapbackEffectsForRetryIdentity: client.effects.get('retry-1').effectCount,
    snapbackSettlementRowsForRetryIdentity: client.receipts().filter((entry) => entry.mutationId === 'retry-1').length,
    rejectionDisplay: rejectionProjection.display,
    lateDisplay: lateProjection.display,
    ambiguityDisplay: ambiguityProjection.display,
    disagreementDisplay: disagreement.display,
  },
  sources: sourceFiles.map((path) => ({
    path: path.startsWith(snapbackRoot)
      ? path.slice(snapbackRoot.length + 1)
      : `exact/${path.slice(exactRoot.length + 1)}`,
    sha256: sha256(path),
  })),
};
if (write) writeFileSync(resultPath, `${JSON.stringify(receipt, null, 2)}\n`);
console.log(JSON.stringify(receipt, null, 2));

import assert from 'node:assert/strict';
import {join} from 'node:path';

import {
  EMPTY_VISIBLE_FACTS,
  MUTATION_DISPOSITIONS,
  MUTATION_REFS,
  MutationPresentationController,
} from '../../../src/data/mutations.ts';
import {
  CONTROL_ROOT,
  FROZEN_MUTATION_NAMES,
  LANE_CHECK_IDS,
  LANE4_MUTATION_LOGICAL_NAMES,
  actorIdentityFromLaneReceipts,
  assertLaneCheck,
  buildGateReceiptFields,
  createHeadlessStack,
  loadGateContext,
  mutationTraceFor,
  runLaneHarness,
} from '../gate-support.mjs';
import {runZBGate} from '../zbgate.mjs';

// @ref LLP 0183#zb3--optimistic-programs-and-durable-intent — every frozen
// mutation retains submit/paint-disposition/settlement facts and replay proof.

const LANE4_IDS = LANE_CHECK_IDS.lane4.map(id => `lane4.${id}`);
const EFFECT_IDS = Object.freeze([
  'effect-eight-trigger-classes-exact-capture-and-internal-recipients',
  'effect-fault-before-send-retries-from-durable-intent-once',
  'effect-fault-after-send-is-explicitly-ambiguous-and-fenced',
  'all-eight-nontriggers-produce-no-delivery',
]);
const CHECK_IDS = Object.freeze([
  ...LANE4_IDS,
  'lane6a.reducer-paints-then-authoritative-result-settles',
  'lane6a.refusal-drops-and-rebases-optimistic-layer',
  'reducer-ledger-all-16-dispositions',
  'concurrent-authority-rebases-remaining-operation',
  ...EFFECT_IDS.map(id => `lane5.${id}`),
  'durable-queued-intent-restart',
  'revocation-crossing-queued-write',
]);

const TRIGGERING = new Set([
  'issue.create', 'issue.update', 'issue.addLabel', 'issue.removeLabel',
  'emoji.addToIssue', 'emoji.addToComment', 'comment.add', 'comment.edit',
]);

// Static copy of Lane 4's authoritative Scenario.name/logicalName pairings.
// Generated names are authored identities, not a spelling transform: the gate
// checks this table against the frozen inventory, Lane 4 check order, and the
// generated functions manifest before accepting any per-mutator evidence.
export const LANE4_MUTATION_PAIRS = Object.freeze([
  Object.freeze({logicalName: 'issue.create', generatedName: 'issueCreate'}),
  Object.freeze({logicalName: 'issue.update', generatedName: 'issueUpdate'}),
  Object.freeze({logicalName: 'issue.addLabel', generatedName: 'issueAddLabel'}),
  Object.freeze({logicalName: 'issue.removeLabel', generatedName: 'issueRemoveLabel'}),
  Object.freeze({logicalName: 'notification.update', generatedName: 'notificationUpdate'}),
  Object.freeze({logicalName: 'emoji.addToIssue', generatedName: 'emojiAddToIssue'}),
  Object.freeze({logicalName: 'comment.add', generatedName: 'commentAdd'}),
  Object.freeze({logicalName: 'emoji.addToComment', generatedName: 'emojiAddToComment'}),
  Object.freeze({logicalName: 'emoji.remove', generatedName: 'emojiRemove'}),
  Object.freeze({logicalName: 'comment.edit', generatedName: 'commentEdit'}),
  Object.freeze({logicalName: 'comment.remove', generatedName: 'commentRemove'}),
  Object.freeze({logicalName: 'label.create', generatedName: 'labelCreate'}),
  Object.freeze({logicalName: 'label.createAndAddToIssue', generatedName: 'labelCreateAndAddToIssue'}),
  Object.freeze({logicalName: 'viewState.set', generatedName: 'viewStateSet'}),
  Object.freeze({logicalName: 'userPref.set', generatedName: 'userPrefSet'}),
  Object.freeze({logicalName: 'issue.delete', generatedName: 'issueDelete'}),
]);

export function resolveLane4MutationIdentities(functionsManifest, inventoryLogicalNames) {
  assert(Array.isArray(functionsManifest?.functions), 'functions manifest has functions[]');
  assert(Array.isArray(inventoryLogicalNames), 'frozen inventory supplies mutation names');
  const logicalNames = LANE4_MUTATION_PAIRS.map(pair => pair.logicalName);
  const generatedNames = LANE4_MUTATION_PAIRS.map(pair => pair.generatedName);
  assert.equal(new Set(logicalNames).size, LANE4_MUTATION_PAIRS.length, 'logical names are unique');
  assert.equal(new Set(generatedNames).size, LANE4_MUTATION_PAIRS.length, 'generated names are unique');
  assert.deepEqual(
    [...logicalNames].sort(),
    [...FROZEN_MUTATION_NAMES].sort(),
    'static logical names equal the frozen mutation inventory',
  );
  assert.deepEqual(
    [...logicalNames].sort(),
    [...inventoryLogicalNames].sort(),
    'static logical names equal stage0 mutation demand',
  );
  assert.deepEqual(
    logicalNames,
    [...LANE4_MUTATION_LOGICAL_NAMES],
    'static pair order equals Lane 4 scenario order',
  );
  assert.deepEqual(
    LANE_CHECK_IDS.lane4.slice(2),
    logicalNames.map((name, index) => `mutator-${String(index + 1).padStart(2, '0')}-${name}`),
    'Lane 4 check ids use scenario declaration order',
  );
  return Object.freeze(LANE4_MUTATION_PAIRS.map(pair => {
    const operations = functionsManifest.functions.filter(row => row.name === pair.generatedName);
    assert.equal(
      operations.length,
      1,
      `${pair.logicalName} resolves exactly once to generated function ${pair.generatedName}`,
    );
    const [operation] = operations;
    assert.equal(operation.kind, 'Mutation', `${pair.generatedName} is a mutation`);
    return Object.freeze({...pair, operation});
  }));
}

function lane4CheckId(logicalName) {
  const index = LANE4_MUTATION_PAIRS.findIndex(pair => pair.logicalName === logicalName);
  assert.notEqual(index, -1, `${logicalName} has a Lane 4 scenario`);
  return LANE_CHECK_IDS.lane4[index + 2];
}

async function main() {
  const context = await loadGateContext([
    join(import.meta.dirname, 'zb3.mjs'),
    join(CONTROL_ROOT, 'tests/acceptance/lane4-live.mts'),
    join(CONTROL_ROOT, 'tests/acceptance/lane5-live.mts'),
    join(CONTROL_ROOT, 'tests/acceptance/lane6a-live.mts'),
    join(CONTROL_ROOT, 'tests/lane4-oracle.mts'),
    join(CONTROL_ROOT, 'tests/lane6a-mutations.test.mts'),
    join(CONTROL_ROOT, 'src/data/mutations.ts'),
    join(CONTROL_ROOT, 'composition/effects/deliver.mts'),
    join(CONTROL_ROOT, 'composition/effects/payloads.mts'),
  ]);
  const attempt = process.env.ZBUGS_ATTEMPT ?? 'v1';
  let lane4 = null;
  let lane5 = null;
  let lane6a = null;
  let mutationIdentities = [];
  const actorIdentity = actorIdentityFromLaneReceipts();

  return await runZBGate({
    arm: 'snapback-control',
    gate: 'zb3',
    attempt,
    title: 'Zerobugs control ZB3 — optimistic programs and durable intent',
    expectedCheckIds: CHECK_IDS,
    run: async gate => {
      mutationIdentities = resolveLane4MutationIdentities(
        context.functionsManifest,
        context.inventory.mutationDemand.mutators.map(row => row.name),
      );
      const lane4Stack = await createHeadlessStack(gate, 'zb3-lane4');
      lane4 = await runLaneHarness('lane4', lane4Stack, {traceMutations: true});

      for (const id of LANE_CHECK_IDS.lane4.slice(0, 2)) {
        await gate.check(`lane4.${id}`, async () => assertLaneCheck(lane4, id));
      }
      for (const [index, identity] of mutationIdentities.entries()) {
        const name = identity.logicalName;
        const sourceId = LANE_CHECK_IDS.lane4[index + 2];
        await gate.check(`lane4.${sourceId}`, async () => {
          const source = assertLaneCheck(lane4, sourceId);
          const timing = mutationTraceFor(lane4, index);
          const disposition = MUTATION_DISPOSITIONS[name];
          const demand = context.inventory.mutationDemand.mutators.find(row => row.name === name);
          const operation = identity.operation;
          assert(disposition, `${name} has a reducer/pending disposition`);
          assert(demand, `${name} has a frozen lowering classification`);
          assert(operation, `${name} has a generated function identity`);
          assert.equal(operation.kind, 'Mutation');
          assert.equal(operation.ir ?? null, null);
          assert(operation.runtime?.IbexModule, `${name} uses the declared JS/Ibex fallback`);
          return {
            ...source,
            mutation: name,
            timingMarks: {
              submit: timing.initial.submittedAt,
              optimisticPaintFact: {
                applicable: disposition.reducer,
                disposition: disposition.reducer ? 'app-owned-visible-fact-reducer' : 'honest-server-pending',
                observedAt: null,
                timingReason: disposition.reducer
                  ? 'The reducer is synchronous before transport submission; Lane 6a proves the representative paint-before-settlement ordering, while Lane 4 does not invoke the app adapter and therefore supplies no fabricated per-mutator paint timestamp.'
                  : 'No optimistic paint is admitted for this mutation.',
                pendingBranches: disposition.serverOnlyBranches,
                evidence: disposition.reducer
                  ? 'Lane 6a mutation presentation ledger; representative live paint check below'
                  : 'label.create declares server-only-label-create and paints no false fact',
              },
              authoritativeSettlement: timing.initial.settledAt,
              submitToSettlementMs: timing.initial.durationMs,
            },
            replay: {
              submit: timing.replay.submittedAt,
              settlement: timing.replay.settledAt,
              outcome: timing.replay.outcome,
            },
            conflict: {
              disposition: 'authorization refusal leaves no partial write; authoritative rebase is checked against the reducer ledger below',
              observer: 'Lane 4 raw server audit converges after commit and replay',
            },
            generatedAdmission: {
              preliminaryClass: demand.preliminaryClass,
              actualTier: 'JS/Ibex-authoritative-fallback',
              generatedIrPresent: false,
              reason: demand.classificationReason,
            },
            durableEffectIntent: TRIGGERING.has(name),
          };
        });
      }

      const lane6aStack = await createHeadlessStack(gate, 'zb3-lane6a');
      lane6a = await runLaneHarness('lane6a', lane6aStack);
      for (const id of [
        'reducer-paints-then-authoritative-result-settles',
        'refusal-drops-and-rebases-optimistic-layer',
      ]) {
        await gate.check(`lane6a.${id}`, async () => assertLaneCheck(lane6a, id));
      }
      await gate.check('reducer-ledger-all-16-dispositions', async () => {
        assert.deepEqual(Object.keys(MUTATION_REFS).sort(), [...FROZEN_MUTATION_NAMES].sort());
        assert.deepEqual(Object.keys(MUTATION_DISPOSITIONS).sort(), [...FROZEN_MUTATION_NAMES].sort());
        const reducer = Object.values(MUTATION_DISPOSITIONS).filter(row => row.reducer).length;
        const pendingOnly = FROZEN_MUTATION_NAMES.length - reducer;
        assert.equal(reducer, 15);
        assert.equal(pendingOnly, 1);
        return {mutations: FROZEN_MUTATION_NAMES.length, reducer, pendingOnly};
      });
      await gate.check('concurrent-authority-rebases-remaining-operation', async () => {
        const issue = Object.freeze({
          id: 'source-issue', title: 'base', open: true, modified: 1, created: 1,
          projectID: 'source-project', creatorID: 'source-user', description: '',
          visibility: 'public',
        });
        const actor = Object.freeze({
          id: 'source-user', login: 'actor', avatar: '', role: 'user',
        });
        const controller = new MutationPresentationController(Object.freeze({
          ...EMPTY_VISIBLE_FACTS,
          issues: Object.freeze([issue]),
        }));
        controller.begin('zb3-concurrent-rebase', 'issue.update', {
          id: issue.id,
          title: 'optimistic',
          modified: 2,
        }, {actor});
        controller.adoptAuthoritative(Object.freeze({
          ...EMPTY_VISIBLE_FACTS,
          issues: Object.freeze([{...issue, description: 'concurrent-authority'}]),
        }));
        const snapshot = controller.snapshot();
        assert.equal(snapshot.facts.issues[0]?.title, 'optimistic');
        assert.equal(snapshot.facts.issues[0]?.description, 'concurrent-authority');
        assert.equal(snapshot.attempts.length, 1);
        return {
          remainingOperations: snapshot.attempts.length,
          authoritativeBaseAdopted: true,
          optimisticVisibleFactReapplied: true,
        };
      });

      const lane5Stack = await createHeadlessStack(gate, 'zb3-lane5');
      lane5 = await runLaneHarness('lane5', lane5Stack);
      for (const id of EFFECT_IDS) {
        await gate.check(`lane5.${id}`, async () => assertLaneCheck(lane5, id));
      }

      gate.gap('durable-queued-intent-restart', {
        owner: 'ZB5 real-browser offline/custody arm and D3/D5 integration',
        reason: 'The control adapter passes queue:false; no disconnected enqueue or browser-process restart surface exists to exercise honestly in this headless gate.',
      });
      gate.gap('revocation-crossing-queued-write', {
        owner: 'ZB5 real-browser offline/custody arm and D3/D5 integration',
        reason: 'Without an admitted queued control mutation, a revocation-crossing replay would be fabricated. Online refusal/rebase is proved by Lane 6a instead.',
      });
    },
    buildReceipt: async run => buildGateReceiptFields(context, run, {
      actorIdentity,
      capabilityFacts: [
        ...FROZEN_MUTATION_NAMES.map(name => ({
          id: `mutation.${name}`,
          status: run.checks.rows.find(row => row.id === `lane4.${lane4CheckId(name)}`)?.status === 'PASS'
            ? 'supported-local-control'
            : 'refused',
          optimisticCarrier: MUTATION_DISPOSITIONS[name].reducer
            ? 'application-owned-visible-fact-reducer'
            : 'honest-server-pending',
          preliminaryClass: context.inventory.mutationDemand.mutators.find(row => row.name === name)?.preliminaryClass,
          actualTier: 'JS/Ibex-authoritative-fallback',
          durableIntent: TRIGGERING.has(name),
        })),
        {id: 'effect.email-durable', status: 'supported-local-capture-composition'},
        {id: 'effect.webhook-durable', status: 'supported-local-capture-composition'},
        {id: 'durable-disconnected-intent', status: 'gap', owner: 'ZB5 and D3/D5'},
      ],
      refusalFacts: [
        {id: 'speculative-effect-delivery', status: 'refused', evidence: 'Lane 4 emits intent only; Lane 5 delivers after commit'},
        {id: 'ambiguous-effect-replay', status: 'refused', evidence: 'Lane 5 ambiguity fence'},
      ],
      workarounds: [
        {id: 'W-MUTATION-IR', status: 'retained; authoritative JS fallback named per mutation'},
        {id: 'W-REDUCER', status: '15 app-owned visible-fact reducers'},
        {id: 'W-PENDING', status: 'one pending-only mutation plus named hidden branches'},
        {id: 'C-NOTIFY', status: 'durable local companion intent/attempt ledger'},
      ],
      sourceAccounting: {
        frozenMutations: FROZEN_MUTATION_NAMES.length,
        authoritativeLaneChecks: lane4?.receipt.expectedChecks ?? null,
        adapterLaneChecks: lane6a?.receipt.expectedChecks ?? null,
        compositionLaneChecks: lane5?.receipt.expectedChecks ?? null,
        reducerDispositions: 15,
        honestPendingOnlyDispositions: 1,
        durableEffectTriggers: TRIGGERING.size,
        nonTriggers: FROZEN_MUTATION_NAMES.length - TRIGGERING.size,
      },
      custodyAccounting: {
        mode: 'headless online mutation/effect evidence',
        mutationTimingTraces: lane4?.mutationTrace.length ?? 0,
        browserFactsRetained: 0,
        queuedOfflineIntents: 0,
        speculativeExternalEffects: 0,
      },
    }),
  });
}

if (import.meta.main) {
  const result = await main();
  if (result.exitCode !== 0) process.exitCode = result.exitCode;
}

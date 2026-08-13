import assert from 'node:assert/strict';
import { test } from 'node:test';

import {
  deriveGeneratedLocalReadCoverageV1,
  evaluateLocalMutationWithReadAdmissionV1,
} from './local-read-admission.mjs';
import { createRegistrationLedger } from './registration-ledger.mjs';
import { SnapbackClient } from './index.mjs';

const QMK = `qmk1.${'A'.repeat(43)}`;
const digest = (character) => `sha256:${character.repeat(64)}`;
const encoder = new TextEncoder();

const schema = {
  tables: [{
    name: 'todos',
    fields: [{ name: 'title' }, { name: 'done' }],
  }],
};

const pointPlan = {
  steps: [
    {
      Get: {
        table: 'todos',
        id: { Arg: 'id' },
        bind_as: 'todo',
        else_error: 'TODO_NOT_FOUND',
      },
    },
    {
      Guard: {
        cond: {
          Binary: {
            op: 'Eq',
            left: { Field: { base: { Binding: 'todo' }, key: 'done' } },
            right: { Literal: false },
          },
        },
        else_error: 'TODO_ALREADY_DONE',
      },
    },
    {
      Patch: {
        table: 'todos',
        id: { Arg: 'id' },
        values: { done: { Literal: true } },
      },
    },
  ],
  return_value: 'ChangedCount',
};

const operation = (overrides = {}) => ({
  name: 'finishTodo',
  schema,
  plan: pointPlan,
  args: { id: 'todo-1' },
  ctxLedger: { version: 1, ids: [], now: 1 },
  layerId: 'layer-finish-todo',
  declaredReads: ['todos'],
  localReadRequirements: [{
    kind: 'point',
    table: 'todos',
    idArg: 'id',
    binding: 'todo',
    requiredFields: ['_id', 'done'],
  }],
  ...overrides,
});

const generatedReference = ({ complete }) => ({
  artifactKind: 'functionReference',
  argumentSchema: {
    type: 'object',
    additionalProperties: false,
    properties: {},
  },
  resultContractHash: digest('2'),
  composition: {
    planHash: digest('1'),
    normalizedCompositePlan: {
      format: 'snapback.normalized-composite-plan.v1',
      profileId: 'single-node.v1',
      nodes: [{
        position: 0,
        nodePlan: {
          format: 'snapback.node-plan.v1',
          classId: 'single_table_v1',
          classVersion: 1,
          normalizedPlan: {
            format: 'snapback.single-table-plan.v1',
            query: {
              table: 'todos',
              filters: complete ? [] : [{ field: 'done', op: 'Eq', value: { Literal: false } }],
              membershipFilters: [],
              order: [],
              limit: null,
              indexedBy: null,
            },
          },
        },
      }],
    },
    resultContract: {
      kind: 'documents',
      table: 'todos',
      document: {
        fields: [{ name: 'title' }, { name: '_id' }, { name: 'done' }],
      },
    },
  },
});

async function demandedLedger({ complete }) {
  const ref = generatedReference({ complete });
  const coverage = deriveGeneratedLocalReadCoverageV1({
    ref,
    materializationKey: QMK,
  });
  assert.ok(coverage, 'the generated single-table identity must produce coverage');
  assert.equal(coverage.absence, complete ? 'table-complete' : 'unproven');
  const ledger = await createRegistrationLedger({
    storeHandle: null,
    clientStoreId: 'store-1',
  });
  const registration = {
    format: 'snapback.query-registration.v1',
    registrationId: complete ? 'complete-demand' : 'partial-demand',
    source: 'active',
    ownerContext: { kind: 'subscription', contextId: 'context-1' },
    functionReference: {
      materializationAddress: [
        'snapback:client-materialization-address:v1',
        'store-1',
        QMK,
      ],
      authorityPartitionDigest: digest('3'),
      localReadCoverage: coverage,
    },
    canonicalArgs: {},
    requestedScope: { kind: 'page', input: { kind: 'first' } },
    retentionRequest: 'none',
    idleTtlClass: 'default',
  };
  ledger.applyContextDemands({
    contextId: 'context-1',
    authorityPartitionDigest: digest('3'),
    revision: 1,
    demands: [registration],
  });
  assert.equal(ledger.demandedMaterializations().length, 1);
  assert.equal(ledger.demandedMaterializations()[0].demandState, 'demanded-active');
  return ledger;
}

const positiveRows = [{ _id: 'todo-1', title: 'one', done: false }];
const states = [
  { name: 'authoritative', answerClass: 'authoritative', rows: positiveRows, sourceClass: 'durable-store' },
  { name: 'labeled-retained', answerClass: 'labeled-retained', rows: positiveRows, sourceClass: 'durable-store' },
  { name: 'unknown', answerClass: 'unknown', rows: positiveRows, sourceClass: 'durable-store' },
  { name: 'refused', answerClass: 'refused', rows: positiveRows, sourceClass: 'durable-store' },
  { name: 'empty-authoritative', answerClass: 'authoritative', rows: [], sourceClass: 'durable-store' },
  { name: 'live-authoritative', answerClass: 'authoritative', rows: positiveRows, sourceClass: 'live-registration' },
  { name: 'live-empty-authoritative', answerClass: 'authoritative', rows: [], sourceClass: 'live-registration' },
];

const variants = [
  {
    name: 'complete-point',
    ledger: 'complete',
    operation: operation(),
    expected: {
      authoritative: 'ready',
      'labeled-retained': 'server-only',
      unknown: 'server-only',
      refused: 'server-only',
      'empty-authoritative': 'ready',
      'live-authoritative': 'ready',
      'live-empty-authoritative': 'ready',
    },
  },
  {
    name: 'partial-positive-point',
    ledger: 'partial',
    operation: operation({ layerId: 'layer-partial' }),
    expected: {
      authoritative: 'predictable-with-partial-input',
      'labeled-retained': 'server-only',
      unknown: 'server-only',
      refused: 'server-only',
      'empty-authoritative': 'server-only',
      'live-authoritative': 'predictable-with-partial-input',
      'live-empty-authoritative': 'server-only',
    },
  },
  {
    name: 'server-only-plan',
    ledger: 'complete',
    operation: operation({
      plan: {
        steps: [{ Guard: { cond: 'AuthUserId', else_error: 'NO_USER' } }],
        return_value: 'ChangedCount',
      },
      declaredReads: [],
      localReadRequirements: [],
      layerId: 'layer-server-only',
    }),
    expected: Object.fromEntries(states.map((state) => [state.name, 'server-only'])),
  },
  {
    name: 'refused-declaration',
    ledger: 'complete',
    operation: operation({
      declaredReads: [],
      localReadRequirements: [],
      layerId: 'layer-refused',
    }),
    expected: Object.fromEntries(states.map((state) => [state.name, 'refused'])),
  },
];

test('M2 admission matrix: five store states plus two live-source states x four evaluator paths', async () => {
  const ledgers = {
    complete: await demandedLedger({ complete: true }),
    partial: await demandedLedger({ complete: false }),
  };
  let cells = 0;
  const observedClasses = new Set();
  for (const variant of variants) {
    for (const state of states) {
      let reads = 0;
      const ledger = ledgers[variant.ledger];
      for (const demand of ledger.demandedMaterializations()) {
        for (const entry of demand.registrations) {
          ledger.clearLiveRegistrationAnswer(entry.registration.registrationId);
          if (state.sourceClass === 'live-registration') {
            ledger.publishLiveRegistrationAnswer({
              registrationId: entry.registration.registrationId,
              rows: state.rows,
              version: 2,
              subscriptionId: `live-${variant.ledger}`,
              materialization: {
                materializationKey: QMK,
                queryInstanceId: 1,
                planHash: digest('1'),
                resultContractHash: digest('2'),
                authorityPartitionDigest: digest('3'),
              },
            });
          }
        }
      }
      const outcome = await evaluateLocalMutationWithReadAdmissionV1({
        operation: variant.operation,
        registrationLedger: ledger,
        readMaterializationAnswer: async () => {
          reads += 1;
          return {
            answerClass: state.answerClass,
            freshness: state.answerClass === 'authoritative' ? 'current' : 'retained',
            // Nonauthoritative rows are deliberate poison: admission must not
            // decode or feed them to M1 merely because bytes happen to exist.
            value: encoder.encode(JSON.stringify(state.rows)),
            materialization: {
              materializationKey: QMK,
              queryInstanceId: 1,
              planHash: digest('1'),
              resultContractHash: digest('2'),
              authorityPartitionDigest: digest('3'),
            },
          };
        },
      });
      cells += 1;
      observedClasses.add(outcome.admission.classification);
      assert.equal(
        outcome.admission.classification,
        variant.expected[state.name],
        `${state.name} x ${variant.name}`,
      );
      assert.equal(
        outcome.prediction.classification,
        outcome.admission.classification,
        `${state.name} x ${variant.name}: evaluator consumes the exact class`,
      );

      const predictsRows = ['authoritative', 'live-authoritative'].includes(state.name)
        && ['complete-point', 'partial-positive-point'].includes(variant.name);
      if (predictsRows) {
        assert.equal(outcome.prediction.layer?.writes.length, 1);
        assert.equal(outcome.prediction.layer.writes[0].id, 'todo-1');
      } else {
        assert.equal(
          outcome.prediction.layer,
          null,
          `${state.name} x ${variant.name}: no fabricated row effect`,
        );
      }

      if (
        variant.name === 'complete-point'
        && ['empty-authoritative', 'live-empty-authoritative'].includes(state.name)
      ) {
        assert.equal(outcome.admission.reads[0].state, 'admitted');
        assert.deepEqual(outcome.admission.reads[0].rows, []);
        assert.equal(outcome.admission.reads[0].points[0].state, 'absent');
        assert.deepEqual(outcome.admission.admittedRows.todos, []);
        assert.equal(outcome.prediction.execution.status, 'rejected');
        assert.equal(outcome.prediction.execution.rejectionCode, 'TODO_NOT_FOUND');
      }
      if (
        ['labeled-retained', 'unknown', 'refused'].includes(state.name)
        && ['complete-point', 'partial-positive-point'].includes(variant.name)
      ) {
        assert.equal(outcome.admission.reads[0].state, 'missing');
        assert.equal(outcome.admission.reads[0].rows, null);
        assert.equal(outcome.admission.admittedRows, null);
        assert.equal(outcome.prediction.execution, null);
      }
      if (['server-only-plan', 'refused-declaration'].includes(variant.name)) {
        assert.equal(reads, 0, 'plan/declaration refusal does not touch store answers');
      } else if (state.sourceClass === 'live-registration') {
        assert.equal(reads, 0, 'authoritative-current live rows take precedence over durable bytes');
      } else {
        assert.equal(reads, 1, 'the durable source is read exactly once without a current live answer');
      }
      if (outcome.admission.reads[0]?.state === 'admitted') {
        assert.deepEqual(
          outcome.admission.reads[0].admittedSourceClasses,
          [state.sourceClass],
          `${state.name} names the source class that admitted the point read`,
        );
      }
    }
  }
  assert.equal(cells, 28);
  assert.deepEqual([...observedClasses].sort(), [
    'predictable-with-partial-input',
    'ready',
    'refused',
    'server-only',
  ]);
});

test('membership-restricted coverage cannot prove point absence', () => {
  const ref = generatedReference({ complete: true });
  ref.composition.normalizedCompositePlan.nodes[0]
    .nodePlan.normalizedPlan.query.membershipFilters = [{ role: 'member' }];
  const coverage = deriveGeneratedLocalReadCoverageV1({
    ref,
    materializationKey: QMK,
  });
  assert.equal(coverage.absence, 'unproven');
});

test('released demand cannot lend grace-held bytes to mutation admission', async () => {
  const ledger = await demandedLedger({ complete: true });
  ledger.releaseContextDemands({ contextId: 'context-1' });
  assert.deepEqual(ledger.demandedMaterializations(), []);
  let answerReads = 0;
  const outcome = await evaluateLocalMutationWithReadAdmissionV1({
    operation: operation(),
    registrationLedger: ledger,
    readMaterializationAnswer: async () => {
      answerReads += 1;
      return assert.fail('an undemanded materialization must not be read');
    },
  });
  assert.equal(outcome.admission.classification, 'server-only');
  assert.equal(outcome.admission.reads[0].state, 'missing');
  assert.equal(outcome.admission.reads[0].rows, null);
  assert.equal(outcome.prediction.layer, null);
  assert.equal(answerReads, 0);
});

test('SnapbackClient resolves active generated demand through its checked QMK answer seam', async () => {
  const ref = generatedReference({ complete: true });
  const coverage = deriveGeneratedLocalReadCoverageV1({ ref, materializationKey: QMK });
  const address = [
    'snapback:client-materialization-address:v1',
    'store-1',
    QMK,
  ];
  const materialization = {
    materializationKey: QMK,
    queryInstanceId: 1,
    planHash: digest('1'),
    activationHash: digest('4'),
    resultContractHash: digest('2'),
    authorityPartitionDigest: digest('3'),
  };
  const observation = {
    format: 'snapback.materialization-observation.v1',
    present: true,
    generation: {
      queryInstanceId: 1,
      authorityGeneration: 0,
      queryGeneration: 0,
    },
    status: 'complete',
    freshness: 'current',
    materialization,
  };
  const store = {
    observeMaterialization(_address, listener) {
      listener(observation);
      return () => {};
    },
    async beginEstablishment() {},
    async readRenderable() {
      return encoder.encode(JSON.stringify(positiveRows));
    },
  };
  const client = new SnapbackClient('https://m2-admission.test', {
    clientStoreId: 'store-1',
    rqsStore: null,
    offlineQueue: false,
    __materializationStore: store,
  });
  const registration = await client.__registerActiveQueryDemand(
    ref,
    {},
    false,
    {
      bridge: {
        address,
        authorityPartitionDigest: digest('3'),
        retentionClass: 'rqs-authority-independent-snapshot-v1',
        localReadCoverage: coverage,
      },
    },
  );
  const outcome = await client.__evaluateLocalMutationWithReadAdmission({
    operation: operation({ layerId: 'client-integrated-layer' }),
    connected: true,
  });
  assert.equal(outcome.admission.classification, 'ready');
  assert.equal(outcome.prediction.layer.writes.length, 1);
  assert.equal(outcome.admission.reads[0].points[0].state, 'present');
  assert.deepEqual(outcome.admission.reads[0].admittedSourceClasses, ['durable-store']);
  registration.release();
});

test('live_replace advances admission without rewriting the durable establishment fragment', async () => {
  const coverageRef = generatedReference({ complete: true });
  const coverage = deriveGeneratedLocalReadCoverageV1({
    ref: coverageRef,
    materializationKey: QMK,
  });
  const address = ['snapback:client-materialization-address:v1', 'store-1', QMK];
  const materialization = {
    materializationKey: QMK,
    queryInstanceId: 1,
    planHash: digest('1'),
    activationHash: digest('4'),
    resultContractHash: digest('2'),
    authorityPartitionDigest: digest('3'),
  };
  let durableReads = 0;
  const durableRows = [];
  const materializationStore = {
    observeMaterialization(_address, listener) {
      listener({
        format: 'snapback.materialization-observation.v1',
        present: true,
        generation: { queryInstanceId: 1, authorityGeneration: 0, queryGeneration: 0 },
        status: 'complete',
        freshness: 'retained',
        materialization,
      });
      return () => {};
    },
    async beginEstablishment() {},
    async readRenderable() {
      durableReads += 1;
      return encoder.encode(JSON.stringify(durableRows));
    },
  };
  const ref = {
    ...coverageRef,
    name: 'watchTodos',
    kind: 'LiveQuery',
    materializationAddress: address,
    authorityPartitionDigest: digest('3'),
    localReadCoverage: coverage,
  };
  const client = new SnapbackClient('https://live-admission.test', {
    clientStoreId: 'store-1',
    rqsStore: null,
    offlineQueue: false,
    __materializationStore: materializationStore,
  });
  client.subscribeLive = async () => ({
    subscription_id: 'live-admission-subscription',
    snapshot: { rows: [], version: 1 },
  });
  client.unsubscribeLive = async () => ({ disposed: true });
  const streamListeners = new Set();
  client.liveStreamManager = () => ({
    onState(listener) {
      streamListeners.add(listener);
      return () => streamListeners.delete(listener);
    },
    isOpen: () => true,
  });

  const live = await client.liveQuery(ref, {
    connectionId: 'live-admission-connection',
    transport: 'stream',
    persistResume: false,
  });
  const initial = await client.__evaluateLocalMutationWithReadAdmission({
    operation: operation({ layerId: 'initial-empty-live-layer' }),
    connected: true,
  });
  assert.equal(initial.admission.reads[0].points[0].state, 'absent');
  assert.deepEqual(initial.admission.reads[0].admittedSourceClasses, ['live-registration']);
  assert.equal(initial.prediction.execution.rejectionCode, 'TODO_NOT_FOUND');
  assert.equal(durableReads, 0, 'establishment-era durable bytes are not read while live is current');

  const consumers = client.__laneConsumers.get('live-admission-connection')?.durable;
  assert.equal(consumers?.size, 1, 'the real live delivery path owns one durable consumer');
  for (const consumer of consumers) {
    consumer({
      kind: 'live_replace',
      subscription_id: live.subscriptionId,
      version: 2,
      rows: positiveRows,
    });
  }
  const delivered = await client.__evaluateLocalMutationWithReadAdmission({
    operation: operation({ layerId: 'post-delivery-live-layer' }),
    connected: true,
  });
  assert.equal(delivered.admission.reads[0].points[0].state, 'present');
  assert.deepEqual(delivered.admission.reads[0].admittedSourceClasses, ['live-registration']);
  assert.equal(delivered.admission.reads[0].sources[0].sourceClass, 'live-registration');
  assert.equal(delivered.admission.reads[0].sources[0].subscriptionId, live.subscriptionId);
  assert.equal(delivered.prediction.layer.writes.length, 1, 'the delivered point read produces a mutation layer');
  assert.deepEqual(durableRows, [], 'the unproved delivery never rewrites the durable fragment');
  assert.equal(durableReads, 0);

  for (const listener of streamListeners) listener('budget-missed');
  const staleFallback = await client.__evaluateLocalMutationWithReadAdmission({
    operation: operation({ layerId: 'stale-live-fallback-layer' }),
    connected: true,
  });
  assert.equal(staleFallback.admission.reads[0].points[0].state, 'absent');
  assert.deepEqual(staleFallback.admission.reads[0].admittedSourceClasses, ['durable-store']);
  assert.equal(durableReads, 1, 'a stale live registration falls back to the proof-validated store');

  await live.dispose();
});

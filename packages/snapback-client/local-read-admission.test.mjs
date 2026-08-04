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
  { name: 'authoritative', answerClass: 'authoritative', rows: positiveRows },
  { name: 'labeled-retained', answerClass: 'labeled-retained', rows: positiveRows },
  { name: 'unknown', answerClass: 'unknown', rows: positiveRows },
  { name: 'refused', answerClass: 'refused', rows: positiveRows },
  { name: 'empty-authoritative', answerClass: 'authoritative', rows: [] },
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

test('M2 admission matrix: five store states x four evaluator paths', async () => {
  const ledgers = {
    complete: await demandedLedger({ complete: true }),
    partial: await demandedLedger({ complete: false }),
  };
  let cells = 0;
  const observedClasses = new Set();
  for (const variant of variants) {
    for (const state of states) {
      let reads = 0;
      const outcome = await evaluateLocalMutationWithReadAdmissionV1({
        operation: variant.operation,
        registrationLedger: ledgers[variant.ledger],
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

      const predictsRows = state.name === 'authoritative'
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

      if (variant.name === 'complete-point' && state.name === 'empty-authoritative') {
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
      }
    }
  }
  assert.equal(cells, 20);
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
  const release = await client.__registerActiveQueryDemand(
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
  release();
});

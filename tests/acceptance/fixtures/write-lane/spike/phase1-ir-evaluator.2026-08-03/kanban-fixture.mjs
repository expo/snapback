// THROWAWAY SPIKE fixture: serde-shaped IR, not generated product artifacts.

import {
  SPIKE_KANBAN_EFFECT_CLASS,
} from './browser-evaluator.mjs';

const arg = (name) => ({ Arg: name });
const field = (binding, key) => ({ Field: { base: { Binding: binding }, key } });
const lit = (value) => ({ Literal: value });
const binary = (op, left, right) => ({ Binary: { op, left, right } });
const digest = (character) => `sha256:${character.repeat(64)}`;
const QMK = `qmk1.${'A'.repeat(43)}`;
const get = (requiredFields) => ({
  step: { Get: { table: 'cards', id: arg('id'), bind_as: 'card', else_error: 'CARD_NOT_FOUND' } },
  requirement: {
    kind: 'point',
    table: 'cards',
    binding: 'card',
    idArg: 'id',
    requiredFields,
  },
});
const unlockedGuard = {
  Guard: { cond: { Unary: { op: 'Not', expr: field('card', 'locked') } }, else_error: 'CARD_LOCKED' },
};
const revisionGuard = {
  Guard: {
    cond: binary('Eq', field('card', 'revision'), arg('expectedRevision')),
    else_error: 'CARD_REVISION_CONFLICT',
  },
};
const nextRevision = binary('Add', field('card', 'revision'), lit(1));
const returnsCard = { Document: { table: 'cards', id: arg('id') } };

function guardedPatch(values, requiredFields) {
  const point = get(requiredFields);
  return {
    effectClass: SPIKE_KANBAN_EFFECT_CLASS,
    localReadRequirements: [point.requirement],
    plan: {
      steps: [
        point.step,
        unlockedGuard,
        revisionGuard,
        { Patch: { table: 'cards', id: arg('id'), values: { ...values, revision: nextRevision } } },
      ],
      return_value: returnsCard,
    },
  };
}

export const KANBAN_OPERATIONS = Object.freeze({
  create: Object.freeze({
    effectClass: SPIKE_KANBAN_EFFECT_CLASS,
    localReadRequirements: [],
    plan: {
      steps: [{
        Insert: {
          table: 'cards',
          values: {
            key: arg('key'),
            title: arg('title'),
            columnKey: arg('columnKey'),
            rank: arg('rank'),
            assigneeId: arg('assigneeId'),
            archived: lit(false),
            locked: lit(false),
            revision: lit(0),
          },
          bind_id_as: 'cardId',
        },
      }],
      return_value: { Binding: 'cardId' },
    },
  }),
  edit: Object.freeze(guardedPatch({ title: arg('title') }, ['_id', 'locked', 'revision', 'title'])),
  assign: Object.freeze(guardedPatch({ assigneeId: arg('assigneeId') }, ['_id', 'locked', 'revision', 'assigneeId'])),
  archive: Object.freeze(guardedPatch({ archived: arg('archived') }, ['_id', 'locked', 'revision', 'archived'])),
  reorder: Object.freeze(guardedPatch({
    columnKey: arg('columnKey'),
    rank: arg('rank'),
  }, ['_id', 'locked', 'revision', 'columnKey', 'rank'])),
});

export const KANBAN_PROJECTED_FIELDS = Object.freeze([
  '_id', 'key', 'title', 'columnKey', 'rank', 'assigneeId', 'archived', 'locked', 'revision',
]);

export function qmk1BoardMaterialization(rows, {
  completeForTable = true,
  queryInstanceId = 1,
  filters = [],
} = {}) {
  return {
    record: {
      format: 'snapback.materialization-record.v1',
      address: ['snapback:client-materialization-address:v1', 'spike-store', QMK],
      queryInstanceId,
      planHash: digest('1'),
      activationHash: digest('2'),
      argsDigest: digest('3'),
      authorityPartitionDigest: digest('4'),
      storageProfile: 'durable-fragments-v1',
      productState: {
        lifecycle: 'active',
        effectiveDisposition: 'retain',
        freshness: 'current',
        requestedScope: { kind: 'page-set', from: 'first', through: 'terminal' },
        requestedVersion: 'as-of-proof',
        attempt: 'idle',
        heldProofs: [],
      },
      authorityState: {
        query_instance_id: queryInstanceId,
        query_lifecycle: 'active',
        authority_generation: 0,
        query_generation: 0,
        authority_instance_id: 'spike-authority',
        expected_authorization: {
          incarnation: 'spike-incarnation',
          epoch: 1,
          version_stream: 'spike-stream',
        },
        effective_disposition: 'retain',
      },
      fragments: [],
      pageSets: [],
      memberships: [],
      subscription: {
        delivery: 'none',
        connectionState: 'inactive',
        resumeCredentialDigest: null,
      },
      optimisticLayerIds: [],
      outboxEntryIds: [],
      settlementIds: [],
    },
    answerFacts: {
      completenessStatus: 'complete',
      freshness: 'current',
      renderable: true,
      connected: true,
    },
    coverage: {
      table: 'cards',
      completeForTable,
      projectedFields: KANBAN_PROJECTED_FIELDS,
      filters,
      order: [
        { field: 'columnKey', direction: 'asc' },
        { field: 'rank', direction: 'asc' },
      ],
    },
    rows,
  };
}

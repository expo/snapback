import assert from 'node:assert/strict';

import { computeEffectCeiling } from './effect-ceiling.mjs';

// A closed HostPlan mutation gets a statically proved ceiling covering every
// step kind, expression-carried host operation, and authorization input.
{
  const ceiling = computeEffectCeiling({
    name: 'fixture',
    runtime: {
      HostPlan: {
        Mutation: {
          steps: [
            { Get: { table: 'todos', id: { Arg: 'id' }, bind_as: 'row', else_error: 'SNAPBACK_ROW_NOT_FOUND' } },
            {
              Guard: {
                cond: {
                  Binary: {
                    op: 'Eq',
                    left: { Field: { base: { Binding: 'row' }, key: 'ownerId' } },
                    right: 'AuthUserId',
                  },
                },
                else_error: 'SNAPBACK_ROW_NOT_FOUND',
              },
            },
            { Patch: { table: 'todos', id: { Arg: 'id' }, values: { updatedAt: 'RuntimeNow' } } },
            { Insert: { table: 'audit', values: { at: 'RuntimeNow', by: 'AuthUserId', tag: { Literal: 'x' } }, bind_id_as: null } },
          ],
          return_value: null,
        },
      },
    },
  });
  assert.deepEqual(ceiling, {
    version: 'EffectCeilingV1',
    basis: 'static',
    reads: [{ table: 'todos', access: 'point' }],
    writes: [
      { table: 'audit', operations: ['insert'] },
      { table: 'todos', operations: ['patch'] },
    ],
    hostOperations: ['runtimeNow'],
    authorizationInputs: ['authUserId'],
  });
}

// A query plan records its table, index, and authorization inputs.
{
  const ceiling = computeEffectCeiling({
    name: 'fixture',
    runtime: {
      HostPlan: {
        Query: {
          table: 'todos',
          filters: [{ field: 'ownerId', op: 'Eq', value: 'AuthUserId' }],
          order: [],
          limit: 100,
          membership_filters: [],
          indexed_by: 'by_owner_created',
        },
      },
    },
  });
  assert.deepEqual(ceiling.reads, [{ table: 'todos', access: 'query', index: 'by_owner_created' }]);
  assert.deepEqual(ceiling.authorizationInputs, ['authUserId']);
}

// Default-deny: an unknown step, expression, or plan field aborts rather
// than being skipped — a vocabulary extension cannot escape the ceiling.
{
  const unknownStep = {
    name: 'fixture',
    runtime: { HostPlan: { Mutation: { steps: [{ Upsert: { table: 'todos' } }], return_value: null } } },
  };
  assert.throws(() => computeEffectCeiling(unknownStep), /unknown mutation step Upsert/);

  const unknownExpr = {
    name: 'fixture',
    runtime: {
      HostPlan: {
        Mutation: {
          steps: [{ Guard: { cond: { Random: {} }, else_error: 'X' } }],
          return_value: null,
        },
      },
    },
  };
  assert.throws(() => computeEffectCeiling(unknownExpr), /unknown expression kind Random/);

  const unknownPlanField = {
    name: 'fixture',
    runtime: {
      HostPlan: {
        Query: { table: 'todos', filters: [], order: [], limit: 1, membership_filters: [], indexed_by: null, join: {} },
      },
    },
  };
assert.throws(() => computeEffectCeiling(unknownPlanField), /unknown query-plan field join/);

{
  const ceiling = computeEffectCeiling({
    runtime: { HostPlan: { PushLedgerQuery: {} } },
  });
  assert.deepEqual(ceiling.reads, [{
    table: '_snapback_push_ledger_v1',
    access: 'point',
  }]);
  assert.deepEqual(ceiling.authorizationInputs, ['pushAudienceAuthorization']);
}
}

// Opaque handlers keep author declarations and are marked declared, never
// upgraded to a static proof.
{
  const ceiling = computeEffectCeiling({
    name: 'fixture',
    runtime: { IbexModule: { source: '...' } },
    declaredReads: ['todos'],
    declaredWrites: ['todos'],
    authScopeField: 'ownerId',
  });
  assert.equal(ceiling.basis, 'declared');
  assert.deepEqual(ceiling.reads, [{ table: 'todos', access: 'query' }]);
  assert.deepEqual(ceiling.writes, [{ table: 'todos', operations: ['declared'] }]);
}

console.log('effect-ceiling.test.mjs: all cases passed');

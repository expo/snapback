import assert from 'node:assert/strict';

import { SnapbackClient } from './index.mjs';

let requests = 0;
const originalFetch = globalThis.fetch;
globalThis.fetch = async () => {
  requests += 1;
  return new Response(JSON.stringify({ rows: [] }), {
    status: 200,
    headers: { 'content-type': 'application/json' },
  });
};

const ref = Object.freeze({
  artifactKind: 'functionReference',
  schemaVersion: 'snapback.v0',
  appId: 'argument-test',
  id: 'argument-test:update',
  name: 'update',
  kind: 'Mutation',
  argumentSchema: {
    type: 'object',
    additionalProperties: false,
    properties: {
      title: { type: 'string' },
      count: { type: 'integer' },
      options: {
        type: 'object',
        additionalProperties: false,
        properties: { enabled: { type: 'boolean' } },
        required: ['enabled'],
      },
    },
    required: ['title', 'count'],
  },
});

const expectRefusal = async (args, problem) => {
  await assert.rejects(
    () => new SnapbackClient('http://127.0.0.1:9').mutate(ref, { args }),
    (error) => {
      assert.equal(error.code, 'SNAPBACK_ARGUMENT_NORMALIZATION_FAILED');
      assert(error.diagnostic.details.path.includes(problem));
      return true;
    },
  );
};

try {
  const forged = { title: 'x', count: 1, forged: true };
  const client = new SnapbackClient('http://127.0.0.1:9');
  const generatedCallFamilies = [
    ['query', () => client.query({ ...ref, kind: 'Query' }, { args: forged })],
    ['mutation', () => client.mutate(ref, { args: forged })],
    ['action', () => client.action({ ...ref, kind: 'Action' }, { args: forged })],
    ['live subscribe', () => client.subscribeLive(
      { ...ref, kind: 'LiveQuery' },
      { connectionId: 'argument-validation', args: forged },
    )],
    ['live query', () => client.liveQuery(
      { ...ref, kind: 'LiveQuery' },
      { connectionId: 'argument-validation', args: forged },
    )],
    ['authorized lease', () => client.authorizedLeaseQuery(
      { ...ref, kind: 'Query' },
      {
        args: forged,
        leaseRequestId: 'lease_argument_validation',
        authorizationNamespace: {
          clientStoreId: 'argument-validation',
          queryKey: 'argument-validation',
          queryInstanceId: 'argument-validation',
        },
      },
    )],
  ];
  for (const [family, call] of generatedCallFamilies) {
    await assert.rejects(Promise.resolve().then(call), (error) => {
      assert.equal(error.code, 'SNAPBACK_ARGUMENT_NORMALIZATION_FAILED', family);
      assert.equal(error.diagnostic.details.key, 'forged', family);
      return true;
    });
  }
  await expectRefusal({ count: 1 }, 'args.title');
  await expectRefusal({ title: 'x', count: 1.5 }, 'args.count');
  await expectRefusal({ title: 'x', count: 1, options: { enabled: 'yes' } }, 'args.options.enabled');
  await expectRefusal({ title: 'x', count: 1, options: { enabled: true, extra: 1 } }, 'args.options');
  assert.equal(requests, 0, 'invalid generated calls must fail before network I/O');

  assert.throws(
    () => client.query({
      ...ref,
      kind: 'Query',
      name: 'todos.list',
      id: 'argument-test:todos.list',
      argumentSchema: {
        type: 'object',
        additionalProperties: false,
        properties: { after: { type: 'string' } },
      },
      argumentCapabilityRefusals: [{
        argument: 'after',
        when: 'present',
        code: 'SNAPBACK_DATA_QUERY_CAPABILITY_UNAVAILABLE',
        guideAnchor: 'guide/data/resources#continue-a-list',
        alternative: 'Omit after and request the first page.',
      }],
    }, { args: { after: 'dc1.not-yet-admitted' } }),
    (error) => {
      assert.equal(error.code, 'SNAPBACK_DATA_QUERY_CAPABILITY_UNAVAILABLE');
      assert.equal(error.diagnostic.schemaVersion, 'snapback.client-diagnostic.v2');
      assert.equal(error.diagnostic.details.guideAnchor, 'guide/data/resources#continue-a-list');
      assert.equal(error.effectMayHaveCommitted, false);
      return true;
    },
  );
  assert.equal(requests, 0, 'a present Phase 1 data cursor must refuse before network I/O');

  await client.query({
    ...ref,
    kind: 'Query',
    name: 'read',
    id: 'argument-test:read',
  }, {
    args: { title: 'x', count: 1, options: { enabled: true } },
  });
  assert.equal(requests, 1, 'valid generated call reaches the transport');

  await client.query('legacyUntyped', { args: { anything: true } });
  assert.equal(requests, 2, 'legacy string references remain untyped');

  await client.query('_snapback.myMemberships', {
    args: { membership: 'roomMembers' },
  });
  assert.equal(requests, 3, 'the documented caller-seat system query reaches the transport');
} finally {
  globalThis.fetch = originalFetch;
}

console.log('argument-validation.test.mjs: all cases passed');

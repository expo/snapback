import assert from 'node:assert/strict';

import {
  SnapbackClient,
  canonicalReactStoreKeyV1,
  normalizeGeneratedArgumentsV1,
} from './index.mjs';

const optionalRef = Object.freeze({
  artifactKind: 'functionReference',
  schemaVersion: 'snapback.v0',
  appId: 'normalization-test',
  id: 'normalization-test:reply',
  name: 'reply',
  kind: 'Query',
  implementationHash: 'sha256:implementation',
  argsContractHash: 'sha256:args',
  argsContract: {
    fields: [
      { name: 'body', required: true, value: { kind: 'string' } },
      { name: 'replyToId', required: false, value: { kind: 'string' } },
    ],
  },
  argumentSchema: {
    type: 'object',
    additionalProperties: false,
    properties: {
      body: { type: 'string' },
      replyToId: { type: 'string' },
    },
    required: ['body'],
  },
  resultContractHash: 'sha256:result',
});

const requestBodies = [];
const originalFetch = globalThis.fetch;
globalThis.fetch = async (_url, init) => {
  requestBodies.push(init.body);
  return new Response(JSON.stringify({ rows: [] }), {
    status: 200,
    headers: { 'content-type': 'application/json' },
  });
};

const client = new SnapbackClient('http://normalization.invalid');
const explicitUndefined = { body: 'hello', replyToId: undefined };
const conditionalOmission = { body: 'hello', ...(false ? { replyToId: 'never' } : {}) };

try {
  const normalizedExplicit = normalizeGeneratedArgumentsV1(optionalRef, explicitUndefined);
  const normalizedOmitted = normalizeGeneratedArgumentsV1(optionalRef, conditionalOmission);
  assert.deepEqual({ ...normalizedExplicit }, { body: 'hello' });
  assert.deepEqual({ ...normalizedOmitted }, { body: 'hello' });

  const reactExplicit = canonicalReactStoreKeyV1('provider-one', optionalRef, explicitUndefined);
  const reactOmitted = canonicalReactStoreKeyV1('provider-one', optionalRef, conditionalOmission);
  assert.equal(reactExplicit, reactOmitted, 'React canonical bytes treat optional undefined as omission');

  await client.query(optionalRef, { args: explicitUndefined });
  await client.query(optionalRef, { args: conditionalOmission });
  assert.equal(requestBodies[0], requestBodies[1], 'headless wire bytes match conditional omission');
  assert.deepEqual(JSON.parse(requestBodies[0]).args, { body: 'hello' });

  const requiredRef = Object.freeze({
    ...optionalRef,
    id: 'normalization-test:required',
    name: 'required',
    argsContract: { fields: [{ name: 'body', required: true, value: { kind: 'string' } }] },
  });
  const arrayRef = Object.freeze({
    ...optionalRef,
    id: 'normalization-test:array',
    name: 'array',
    argsContract: {
      fields: [{ name: 'items', required: true, value: { kind: 'array', element: { kind: 'string' } } }],
    },
  });
  const jsonRef = Object.freeze({
    ...optionalRef,
    id: 'normalization-test:json',
    name: 'json',
    argsContract: { fields: [{ name: 'metadata', required: true, value: { kind: 'json' } }] },
  });
  const cyclic = {};
  cyclic.self = cyclic;
  const accessor = {};
  Object.defineProperty(accessor, 'body', { enumerable: true, get() { throw new Error('must not run'); } });
  const symbolValue = { body: 'hello' };
  symbolValue[Symbol('forged')] = true;
  const sparse = [];
  sparse.length = 1;

  const refusals = [
    ['required undefined', requiredRef, { body: undefined }],
    ['array undefined', arrayRef, { items: [undefined] }],
    ['array hole', arrayRef, { items: sparse }],
    ['open JSON undefined', jsonRef, { metadata: { bad: undefined } }],
    ['open JSON cycle', jsonRef, { metadata: cyclic }],
    ['unknown property', optionalRef, { body: 'hello', forged: true }],
    ['symbol property', optionalRef, symbolValue],
    ['accessor property', optionalRef, accessor],
    ['exotic prototype', optionalRef, Object.assign(Object.create({}), { body: 'hello' })],
    ['legacy string undefined', 'legacyReply', { replyToId: undefined }],
  ];

  const requestsBeforeRefusals = requestBodies.length;
  for (const [name, reference, args] of refusals) {
    await assert.rejects(
      async () => client.query(reference, { args }),
      (error) => error?.code === 'SNAPBACK_ARGUMENT_NORMALIZATION_FAILED',
      `headless ${name}`,
    );
    assert.throws(
      () => canonicalReactStoreKeyV1('provider-one', reference, args),
      (error) => error?.code === 'SNAPBACK_ARGUMENT_NORMALIZATION_FAILED',
      `React ${name}`,
    );
  }
  assert.equal(
    requestBodies.length,
    requestsBeforeRefusals,
    'every invalid golden refuses before transport in both arms',
  );
} finally {
  globalThis.fetch = originalFetch;
}

console.log('argument-normalization.test.mjs: 2 omission vectors and 10 cross-arm refusal vectors passed');

import assert from 'node:assert/strict';
import { test } from 'node:test';

import { isOperationName } from '@expo/snapback-contract/operation-name';
import { createCommandClient } from './commands.mjs';
import { SnapbackClient } from './index.mjs';
import { assertClientReferenceKind } from './reference-kinds.mjs';

const functionReference = (kind) => Object.freeze({
  artifactKind: 'functionReference',
  kind,
  name: `fixture${kind}`,
});

const references = Object.freeze({
  Query: functionReference('Query'),
  LiveQuery: functionReference('LiveQuery'),
  Mutation: functionReference('Mutation'),
  Action: functionReference('Action'),
  Command: Object.freeze({ kind: 'asset-bearing-command.v1' }),
});

const correctVerbs = Object.freeze({
  Query: 'query',
  LiveQuery: 'liveQuery',
  Mutation: 'mutate',
  Action: 'action',
  Command: 'commandClient.start',
});

test('every wrong generated reference/verb pair refuses before transport', async () => {
  const originalFetch = globalThis.fetch;
  let transports = 0;
  globalThis.fetch = async () => {
    transports += 1;
    throw new Error('transport must not run for a reference-kind mismatch');
  };
  const client = new SnapbackClient('http://127.0.0.1:9', {
    offlineQueue: false,
    devDiagnosticsReporter: false,
  });
  const commandClient = createCommandClient(client);
  const callFamilies = [
    {
      verb: 'query',
      accepted: ['Query', 'LiveQuery'],
      call: (reference) => client.query(reference),
    },
    {
      verb: 'liveQuery',
      accepted: ['Query', 'LiveQuery'],
      call: (reference) => client.liveQuery(reference, { connectionId: 'kind-fixture' }),
    },
    {
      verb: 'mutate',
      accepted: ['Mutation'],
      call: (reference) => client.mutate(reference, { queue: false }),
    },
    {
      verb: 'action',
      accepted: ['Action'],
      call: (reference) => client.action(reference),
    },
    {
      verb: 'commandClient.start',
      accepted: ['Command'],
      call: (reference) => commandClient.start(reference, {}),
    },
  ];

  let wrongPairs = 0;
  try {
    for (const family of callFamilies) {
      for (const [receivedKind, reference] of Object.entries(references)) {
        if (family.accepted.includes(receivedKind)) continue;
        wrongPairs += 1;
        await assert.rejects(
          Promise.resolve().then(() => family.call(reference)),
          (error) => {
            assert.equal(error.code, 'SNAPBACK_CLIENT_REFERENCE_KIND_MISMATCH');
            assert.equal(error.diagnostic.details.receivedKind, receivedKind);
            assert.deepEqual(error.diagnostic.details.acceptedKinds, family.accepted);
            assert.equal(error.diagnostic.details.invokedVerb, family.verb);
            assert.equal(error.diagnostic.details.correctVerb, correctVerbs[receivedKind]);
            assert.match(error.diagnostic.details.guideAnchor, /headless\.md#generated-reference-kinds/u);
            return true;
          },
          `${family.verb} accepted ${receivedKind}`,
        );
      }
    }
    assert.equal(wrongPairs, 18);
    assert.equal(transports, 0);
    const diagnosticEvents = client.diagnosticsChannel().snapshot().events.filter(
      ({ code }) => code === 'SNAPBACK_CLIENT_REFERENCE_KIND_MISMATCH',
    );
    assert.equal(diagnosticEvents.length, 5, 'one coalesced event per invoked verb');
    assert.equal(
      diagnosticEvents.reduce((count, event) => count + event.occurrence.count, 0),
      wrongPairs,
    );
  } finally {
    globalThis.fetch = originalFetch;
    await commandClient.dispose();
    client.diagnosticsChannel().dispose();
  }
});

test('missing, future, and malformed object kinds refuse every verb before transport', async () => {
  const originalFetch = globalThis.fetch;
  let transports = 0;
  globalThis.fetch = async () => {
    transports += 1;
    throw new Error('transport must not run for an invalid reference kind');
  };
  const client = new SnapbackClient('http://127.0.0.1:9', {
    offlineQueue: false,
    devDiagnosticsReporter: false,
  });
  const commandClient = createCommandClient(client);
  const callFamilies = [
    ['query', (reference) => client.query(reference)],
    ['liveQuery', (reference) => client.liveQuery(reference, { connectionId: 'invalid-kind' })],
    ['mutate', (reference) => client.mutate(reference, { queue: false })],
    ['action', (reference) => client.action(reference)],
    ['commandClient.start', (reference) => commandClient.start(reference, {})],
  ];
  const invalidReferences = [
    ['missing', Object.freeze({ artifactKind: 'functionReference' })],
    ['unknown', Object.freeze({ artifactKind: 'functionReference', kind: 'FutureQuery', name: null })],
    ['malformed', Object.freeze({ artifactKind: 'functionReference', kind: Object.freeze({ private: 'payload' }), name: 42 })],
  ];

  try {
    for (const [verb, call] of callFamilies) {
      for (const [receivedKind, reference] of invalidReferences) {
        await assert.rejects(
          Promise.resolve().then(() => call(reference)),
          (error) => {
            assert.equal(error.code, 'SNAPBACK_CLIENT_REFERENCE_KIND_MISMATCH');
            assert.equal(error.diagnostic.details.receivedKind, receivedKind);
            assert.equal(error.diagnostic.details.invokedVerb, verb);
            assert.equal(error.diagnostic.details.correctVerb, null);
            assert.match(error.diagnostic.details.repair, /Regenerate generated references/u);
            assert.doesNotMatch(JSON.stringify(error.diagnostic), /FutureQuery|private|payload/u);
            return true;
          },
          `${verb} accepted ${receivedKind} object kind`,
        );
      }
    }
    assert.equal(transports, 0);
  } finally {
    globalThis.fetch = originalFetch;
    await commandClient.dispose();
    client.diagnosticsChannel().dispose();
  }
});

test('profile admission is opt-in and refuses before a familiar alias can dispatch', () => {
  const explicit = Object.freeze({
    artifactKind: 'functionReference',
    kind: 'LiveQuery',
    name: 'todos.list',
    authoringProfile: 'snapback-explicit-v1',
  });
  assert.doesNotThrow(() => assertClientReferenceKind({
    reference: explicit,
    acceptedKinds: ['LiveQuery'],
    invokedVerb: 'canonical.liveQuery',
  }));
  assert.throws(
    () => assertClientReferenceKind({
      reference: explicit,
      acceptedKinds: ['LiveQuery'],
      acceptedAuthoringProfiles: ['snapback-familiar-ts-v1'],
      invokedVerb: 'familiar.useQuery',
    }),
    (error) => error.code === 'SNAPBACK_CLIENT_REFERENCE_PROFILE_MISMATCH'
      && error.diagnostic.details.receivedProfile === 'snapback-explicit-v1'
      && error.diagnostic.details.acceptedProfiles[0] === 'snapback-familiar-ts-v1',
  );
  assert.throws(
    () => assertClientReferenceKind({
      reference: 'todos.list',
      acceptedKinds: ['LiveQuery'],
      acceptedAuthoringProfiles: ['snapback-familiar-ts-v1'],
      invokedVerb: 'familiar.useQuery',
    }),
    (error) => error.code === 'SNAPBACK_CLIENT_REFERENCE_PROFILE_MISMATCH'
      && error.diagnostic.details.receivedProfile === 'missing',
  );
});

test('shared operation-name grammar makes every generated spelling callable', async () => {
  const client = new SnapbackClient('http://127.0.0.1:9', {
    offlineQueue: false,
    devDiagnosticsReporter: false,
  });
  try {
    const accepted = [
      'publish',
      '_publish2',
      'todos.list',
      'todos.publish',
      'todos.tx_0123456789abcdef',
      'data.tx_0123456789abcdef',
    ];
    const refused = [
      '',
      '1publish',
      'todos.',
      '.publish',
      'todos.publish.extra',
      'todos/publish',
      'todos-publish',
      'todos publish',
      'todos.publísh',
    ];
    for (const name of accepted) {
      assert.equal(isOperationName(name), true, name);
      assert.equal(client.__storeFunctionName({ name }), name);
    }
    for (const name of refused) {
      assert.equal(isOperationName(name), false, name);
      assert.throws(
        () => client.__storeFunctionName({ name }),
        /Snapback function name must match/u,
        name,
      );
    }
  } finally {
    await client.closeAuth();
  }
});

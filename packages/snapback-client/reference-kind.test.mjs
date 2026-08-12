import assert from 'node:assert/strict';
import { test } from 'node:test';

import { createCommandClient } from './commands.mjs';
import { SnapbackClient } from './index.mjs';

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

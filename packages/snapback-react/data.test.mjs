import assert from 'node:assert/strict';
import { test } from 'node:test';

import React from 'react';
import TestRenderer, { act } from 'react-test-renderer';

import { prepareReactBindingForClient } from '../snapback-client/react-binding.mjs';
import { SnapbackProvider } from './index.mjs';
import { db } from './data.mjs';

globalThis.IS_REACT_ACT_ENVIRONMENT = true;

const manifest = ({ withData }) => {
  const generated = {
    artifactKind: 'functionManifest',
    schemaVersion: 'snapback.v0',
    appId: 'react-data-fixture',
    bundleHash: 'sha256:react-data-bundle',
    functions: Object.freeze([]),
  };
  if (withData) {
    const data = {};
    Object.defineProperty(data, '__snapbackDataBinding', {
      value: Object.freeze({
        dataResources: Object.freeze([]),
        dataQueryCatalog: Object.freeze([]),
        dataTransactionCatalog: Object.freeze([]),
        operations: Object.freeze({}),
      }),
    });
    Object.defineProperty(generated, 'data', { value: Object.freeze(data) });
  }
  return Object.freeze(generated);
};

function clientFor(generated) {
  return {
    __dataMutation() {},
    async __dataPendingWrites() { return []; },
    mutationStatus() {},
    async query() { return { rows: [], cursor: null }; },
    liveQuery() {},
    subscribeMutation() { return () => {}; },
    subscribeOutbox() { return () => {}; },
    async inspect() {
      return {
        targetProfileId: 'local-dev-sqlite-ibex',
        target: 'local',
        schema: { schemaHash: 'sha256:react-data-schema' },
        functions: generated,
        routeManifestHash: null,
        capabilityManifest: {
          artifactKind: 'capabilityManifest',
          schemaVersion: 'snapback.v0',
          targetProfileId: 'local-dev-sqlite-ibex',
          supportedCapabilities: [],
        },
      };
    },
    async authSession() { return { activeMode: 'dev' }; },
  };
}

const providerFor = (binding) => ({
  kind: 'snapback.react-provider.v1',
  binding,
  start() {},
});

test('React data runtime exports only db', async () => {
  const exports = await import('./data.mjs');
  assert.deepEqual(Object.keys(exports), ['db']);
  assert.equal('useQuery' in exports, false);
});

test('db.useQuery("skip") is provider-bound and opens no materialization', async () => {
  const generated = manifest({ withData: true });
  const client = clientFor(generated);
  let liveCalls = 0;
  client.liveQuery = () => { liveCalls += 1; };
  const binding = await prepareReactBindingForClient(client, { generatedManifest: generated });
  let observed = null;
  function Probe() {
    observed = db.useQuery('skip');
    return null;
  }
  let root;
  await act(async () => {
    root = TestRenderer.create(React.createElement(
      SnapbackProvider,
      { provider: providerFor(binding) },
      React.createElement(Probe),
    ));
  });
  assert.deepEqual(observed, {
    status: 'skipped', data: undefined, error: null, connection: 'idle',
    freshness: 'unknown', retention: null, pendingWrites: [],
  });
  assert.equal(liveCalls, 0);
  await act(async () => root.unmount());
});

test('React doorway refuses a provider without generated data and names setup', async () => {
  const generated = manifest({ withData: false });
  const client = clientFor(generated);
  const binding = await prepareReactBindingForClient(client, { generatedManifest: generated });
  function Probe() {
    db.useQuery('skip');
    return null;
  }
  let failure = null;
  try {
    await act(async () => {
      TestRenderer.create(React.createElement(
        SnapbackProvider,
        { provider: providerFor(binding) },
        React.createElement(Probe),
      ));
    });
  } catch (error) {
    failure = error;
  }
  assert.equal(failure?.code, 'SNAPBACK_DATA_BINDING_REQUIRED');
  assert.match(failure?.diagnostic?.details?.action ?? '', /normal Snapback generation/u);
});

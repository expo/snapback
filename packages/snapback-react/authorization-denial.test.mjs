import assert from 'node:assert/strict';

import { prepareReactBindingForClient } from '../snapback-client/react-binding.mjs';
import { resultContractHash } from '../snapback-codegen/result-contracts.mjs';
import {
  createSnapbackReactProvider,
  observeSnapbackQueries,
} from './index.mjs';

// Regression: 0137 A1-Expo f4 — after a bearer custody transition to a
// lesser-privileged successor, the client records the server-answered denial
// on the handle and delivers an 'authorization_denied' update. The React
// provider must project that denial on the error axis (renderable), and the
// denial must survive the trailing connection movement to 'disconnected'.
// Pre-fix the hook presented status 'ready' with zero rows and error null,
// and the next connection event wiped any error state back to pending.

const flush = () => new Promise((resolve) => setImmediate(resolve));
const queryContract = {
  kind: 'records',
  record: {
    kind: 'object',
    fields: [
      { name: 'id', required: true, value: { kind: 'string', maxBytes: 32 } },
    ],
    allowExtra: false,
  },
};
const records = Object.freeze({
  artifactKind: 'functionReference',
  schemaVersion: 'snapback.v0',
  appId: 'denial-fixture',
  id: 'denial-fixture:records',
  name: 'records',
  kind: 'LiveQuery',
  implementationHash: 'sha256:records-implementation',
  argsContractHash: 'sha256:records-args',
  argsContract: { kind: 'object', fields: [] },
  resultContractHash: resultContractHash(queryContract),
  resultContract: queryContract,
});
const functions = Object.freeze({
  artifactKind: 'functionManifest',
  schemaVersion: 'snapback.v0',
  appId: 'denial-fixture',
  bundleHash: 'sha256:denial-bundle',
  functions: [records],
});

const ROWS = [{ id: 'rec-1' }, { id: 'rec-2' }];

function fakeClient() {
  const handles = [];
  return {
    liveQuery() {},
    async inspect() {
      return {
        targetProfileId: 'local-dev-sqlite-ibex',
        target: 'local-dev-sqlite-ibex',
        schema: { schemaHash: 'sha256:denial-schema' },
        functions,
        capabilityManifest: {
          artifactKind: 'capabilityManifest',
          schemaVersion: 'snapback.v0',
          targetProfileId: 'local-dev-sqlite-ibex',
          supportedCapabilities: ['live_subscriptions'],
        },
      };
    },
    async authSession() { return { activeMode: 'dev' }; },
    registerAuthBarrierParticipant() { return async () => {}; },
    liveStreamManager() { return { async settled() {} }; },
    startLiveQuery(_reference, options) {
      const current = {
        rows: [...ROWS],
        connection: 'live',
      };
      const handle = {
        current,
        options,
        started: async () => {},
        dispose() {},
        settled: async () => {},
      };
      handles.push(handle);
      queueMicrotask(() => options.onUpdate(current.rows, {}));
      return Object.freeze(handle);
    },
    inspection() { return { handles }; },
  };
}

const client = fakeClient();
const binding = await prepareReactBindingForClient(client, { generatedManifest: functions });
const provider = createSnapbackReactProvider(binding, { connectionId: 'denial-test' });
const observer = observeSnapbackQueries(
  provider,
  { records: { ref: records, args: {} } },
  () => {},
);
await flush();
assert.equal(observer.snapshot().queries.records.data.length, 2, 'boot renders rows');

const [handle] = client.inspection().handles;
const drive = (connection) => {
  handle.current.connection = connection;
  handle.options.onConnectionChange(connection, {});
};

// The custody barrier blanks predecessor rows first (mustNotRegress half).
handle.current.rows = [];
handle.options.onUpdate([], {
  version: 0,
  kind: 'authorization_delete',
  authorization: { kind: 'delete', reason: 'authority_blanked' },
});
drive('disconnected');
assert.deepEqual(observer.snapshot().queries.records.data, [], 'blank lands before the successor');

// The successor's fresh subscribe is ANSWERED with a denial: the client
// records the fact on the handle and delivers authorization_denied.
const denial = new Error('SNAPBACK_AUTH_PERMISSION_DENIED: role requirement not satisfied');
denial.code = 'SNAPBACK_AUTH_PERMISSION_DENIED';
denial.diagnostic = {
  code: 'SNAPBACK_AUTH_PERMISSION_DENIED',
  message: 'role requirement not satisfied',
};
denial.status = 403;
drive('connecting');
handle.current.connection = 'disconnected';
handle.options.onUpdate([], {
  version: 0,
  kind: 'authorization_denied',
  authorization: { kind: 'denied', code: denial.code },
  error: denial,
});
let state = observer.snapshot().queries.records;
assert.equal(state.status, 'error', 'the denial is a renderable error state');
assert.equal(state.error?.code, 'SNAPBACK_AUTH_PERMISSION_DENIED');

// The trailing connection movement (the handle parks 'disconnected') must
// not wipe the denial back to pending.
drive('disconnected');
state = observer.snapshot().queries.records;
assert.equal(state.status, 'error', 'the denial survives connection movement');
assert.equal(state.error?.code, 'SNAPBACK_AUTH_PERMISSION_DENIED');
assert.equal(state.connection, 'disconnected');

// Rotating back: a successful fresh subscribe under restored authority
// delivers authoritative rows, which clear the denial.
drive('connecting');
state = observer.snapshot().queries.records;
assert.equal(state.status, 'error', 'the denial holds until authoritative rows land');
handle.current.rows = [...ROWS];
drive('live');
handle.options.onUpdate([...ROWS], {});
state = observer.snapshot().queries.records;
assert.equal(state.status, 'ready', 'restored authority re-renders');
assert.deepEqual(state.data, ROWS);
assert.equal(state.error, null, 'the denial clears with authoritative rows');

observer.dispose();
await flush();
console.log('snapback-react authorization denial tests: ok');

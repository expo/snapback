import assert from 'node:assert/strict';

import { prepareReactBindingForClient } from '../snapback-client/react-binding.mjs';
import { resultContractHash } from '../snapback-codegen/result-contracts.mjs';
import {
  createSnapbackReactProvider,
  invokeSnapbackMutation,
  observeSnapbackQueries,
} from './index.mjs';

const flush = () => new Promise((resolve) => setImmediate(resolve));
const queryContract = {
  kind: 'records',
  record: {
    kind: 'object',
    fields: [
      { name: 'id', required: true, value: { kind: 'string', maxBytes: 32 } },
      { name: 'count', required: true, value: { kind: 'integer', min: 0, max: 100 } },
    ],
    allowExtra: false,
  },
};
const mutationContract = {
  kind: 'value',
  value: {
    kind: 'object',
    fields: [
      { name: 'targetCount', required: true, value: { kind: 'integer', min: 0, max: 100 } },
    ],
    allowExtra: false,
  },
};
const ref = (name, kind, contract) => Object.freeze({
  artifactKind: 'functionReference',
  schemaVersion: 'snapback.v0',
  appId: 'optimistic-fixture',
  id: `optimistic-fixture:${name}`,
  name,
  kind,
  implementationHash: `sha256:${name}-implementation`,
  argsContractHash: `sha256:${name}-args`,
  resultContractHash: resultContractHash(contract),
  resultContract: contract,
});
const feed = ref('feed', 'LiveQuery', queryContract);
const increment = ref('increment', 'Mutation', mutationContract);
const functions = Object.freeze({
  artifactKind: 'functionManifest',
  schemaVersion: 'snapback.v0',
  appId: 'optimistic-fixture',
  bundleHash: 'sha256:optimistic-bundle',
  functions: [feed, increment],
});

function fakeClient() {
  const handles = new Set();
  const attempts = [];
  let dispatches = 0;
  return {
    liveQuery() {},
    async inspect() {
      return {
        targetProfileId: 'local-dev-sqlite-ibex',
        target: 'local-dev-sqlite-ibex',
        schema: { schemaHash: 'sha256:optimistic-schema' },
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
        rows: [{ id: 'counter', count: 0 }],
        connection: 'live',
      };
      const handle = {
        current,
        started: async () => {},
        dispose() { handles.delete(handle); },
        settled: async () => {},
        emit(rows) {
          current.rows = rows;
          options.onUpdate(rows);
        },
      };
      handles.add(handle);
      queueMicrotask(() => options.onUpdate(current.rows));
      return Object.freeze(handle);
    },
    mutate(_reference, options) {
      dispatches += 1;
      let resolve;
      let reject;
      const promise = new Promise((yes, no) => {
        resolve = (result) => yes({ result, version: dispatches });
        reject = no;
      });
      attempts.push({ options, resolve, reject });
      return promise;
    },
    emit(rows) {
      for (const handle of handles) handle.emit(rows);
    },
    inspection() { return { attempts, dispatches, handles: handles.size }; },
  };
}

const client = fakeClient();
const binding = await prepareReactBindingForClient(client, { generatedManifest: functions });
const provider = createSnapbackReactProvider(binding, { connectionId: 'optimistic-test' });
const observer = observeSnapbackQueries(
  provider,
  { feed: { ref: feed, args: {} } },
  () => {},
);
await flush();
assert.equal(observer.snapshot().queries.feed.data[0].count, 0);

const optimistic = (targetCount, extra = {}) => ({
  query: feed,
  args: {},
  update: (current) => current.map((row) => ({ ...row, count: row.count + 1 })),
  isAuthoritative: (current, result) => current[0].count === result.targetCount,
  ...extra,
});
const first = invokeSnapbackMutation(
  provider,
  increment,
  { amount: 1 },
  { optimistic: optimistic(1) },
);
const firstObserved = first.catch((error) => error);
const second = invokeSnapbackMutation(
  provider,
  increment,
  { amount: 1 },
  { optimistic: optimistic(1) },
);
assert.equal(observer.snapshot().queries.feed.data[0].count, 2);
client.inspection().attempts[0].reject(new Error('rejected'));
assert.equal((await firstObserved).message, 'rejected');
assert.equal(observer.snapshot().queries.feed.data[0].count, 1);
client.inspection().attempts[1].resolve({ targetCount: 1 });
assert.deepEqual(await second, { targetCount: 1 });
assert.equal(observer.snapshot().queries.feed.data[0].count, 1);
client.emit([{ id: 'counter', count: 1 }]);
assert.equal(observer.snapshot().queries.feed.data[0].count, 1);

// Query-first: live authority arrives before the HTTP mutation response.
const queryFirst = invokeSnapbackMutation(
  provider,
  increment,
  { amount: 1 },
  { optimistic: optimistic(2) },
);
client.emit([{ id: 'counter', count: 2 }]);
assert.equal(observer.snapshot().queries.feed.data[0].count, 3);
client.inspection().attempts[2].resolve({ targetCount: 2 });
await queryFirst;
assert.equal(observer.snapshot().queries.feed.data[0].count, 2);

// Response-first: HTTP confirms, but the layer remains until matching live authority.
const responseFirst = invokeSnapbackMutation(
  provider,
  increment,
  { amount: 1 },
  { optimistic: optimistic(3) },
);
client.inspection().attempts[3].resolve({ targetCount: 3 });
await responseFirst;
assert.equal(observer.snapshot().queries.feed.data[0].count, 3);
client.emit([{ id: 'counter', count: 3 }]);
assert.equal(observer.snapshot().queries.feed.data[0].count, 3);

// A later rebase failure removes only that layer; backend settlement remains
// the mutation promise's truth.
const rebaseFailure = invokeSnapbackMutation(
  provider,
  increment,
  { amount: 1 },
  {
    optimistic: optimistic(5, {
      update(current) {
        if (current[0].count >= 4) throw new Error('cannot rebase');
        return current.map((row) => ({ ...row, count: row.count + 1 }));
      },
    }),
  },
);
assert.equal(observer.snapshot().queries.feed.data[0].count, 4);
client.emit([{ id: 'counter', count: 4 }]);
assert.equal(observer.snapshot().queries.feed.data[0].count, 4);
assert.equal(
  provider.inspection().diagnostics.at(-1).code,
  'SNAPBACK_REACT_OPTIMISTIC_REBASE_FAILED',
);
client.inspection().attempts[4].resolve({ targetCount: 5 });
assert.deepEqual(await rebaseFailure, { targetCount: 5 });

await assert.rejects(
  invokeSnapbackMutation(provider, increment, { amount: 1 }, {
    optimistic: {
      query: feed,
      args: {},
      update: () => [{ id: 'counter', count: 'invalid' }],
    },
  }),
  (error) => error?.code === 'SNAPBACK_REACT_OPTIMISTIC_INSTALL_FAILED',
);
assert.equal(client.inspection().dispatches, 5, 'invalid projection refuses before dispatch');

observer.dispose();
await flush();
await provider.dispose();
assert.equal(client.inspection().handles, 0);

console.log('optimistic.test.mjs: overlap, rollback, matcher ordering, rebase failure, and install refusal pass');

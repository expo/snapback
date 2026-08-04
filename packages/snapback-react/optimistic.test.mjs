import assert from 'node:assert/strict';

import { prepareReactBindingForClient } from '../snapback-client/react-binding.mjs';
import { resultContractHash } from '../snapback-codegen/result-contracts.mjs';
import {
  createSnapbackReactProvider,
  invokeSnapbackMutation,
  observeSnapbackQueries,
  projectRecordFields,
} from './index.mjs';

const flush = () => new Promise((resolve) => setImmediate(resolve));

// Capture the dev replay advisory (LLP 0107 replay-safety affordances) so the
// fixtures below can assert exactly when it fires; everything else passes
// through to the real console.
const replayWarnings = [];
const originalConsoleWarn = console.warn;
console.warn = (...parts) => {
  const line = parts.join(' ');
  if (line.includes('SNAPBACK_REACT_OPTIMISTIC_REPLAY_DIVERGENT')) {
    replayWarnings.push(line);
    return;
  }
  originalConsoleWarn(...parts);
};
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

// The increment reducer above is exactly the action-shaped anti-pattern the
// dev replay advisory exists to catch: replayed over its own output it
// double-applies. One warning per (mutation, query) site, not per attempt.
assert.equal(replayWarnings.length, 1, 'the replay advisory warns once per mutation site');
assert.match(replayWarnings[0], /increment over feed/);
assert.match(replayWarnings[0], /guide\/recipes\/optimistic-toggle\.md/);

observer.dispose();
await flush();
await provider.dispose();
assert.equal(client.inspection().handles, 0);

// The optimistic toggle recipe (guide/recipes/optimistic-toggle.md): one
// viewer-aware query supplies both `liked` and `likeCount`, one replayable
// projection sets both atomically, and the matcher recognizes only the
// complete mutation receipt. The same post is mounted in two query stores to
// pin the v1 one-canonical-store boundary.
const postsContract = {
  kind: 'records',
  record: {
    kind: 'object',
    fields: [
      { name: 'id', required: true, value: { kind: 'string', maxBytes: 32 } },
      { name: 'liked', required: true, value: { kind: 'boolean' } },
      { name: 'likeCount', required: true, value: { kind: 'integer', min: 0, max: 1_000_000 } },
    ],
    allowExtra: false,
  },
};
const likeReceiptContract = {
  kind: 'value',
  value: {
    kind: 'object',
    fields: [
      { name: 'liked', required: true, value: { kind: 'boolean' } },
      { name: 'likeCount', required: true, value: { kind: 'integer', min: 0, max: 1_000_000 } },
    ],
    allowExtra: false,
  },
};
const timeline = ref('timeline', 'LiveQuery', postsContract);
const profilePosts = ref('profilePosts', 'LiveQuery', postsContract);
const toggleLike = ref('toggleLike', 'Mutation', likeReceiptContract);
const likeFunctions = Object.freeze({
  artifactKind: 'functionManifest',
  schemaVersion: 'snapback.v0',
  appId: 'optimistic-fixture',
  bundleHash: 'sha256:optimistic-toggle-bundle',
  functions: [timeline, profilePosts, toggleLike],
});

function fakeSurfacesClient(initialRowsByQuery) {
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
        functions: likeFunctions,
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
    startLiveQuery(reference, options) {
      const handle = {
        name: reference.name,
        current: { rows: initialRowsByQuery[reference.name], connection: 'live' },
        started: async () => {},
        dispose() { handles.delete(handle); },
        settled: async () => {},
        emit(rows) {
          handle.current.rows = rows;
          options.onUpdate(rows);
        },
      };
      handles.add(handle);
      queueMicrotask(() => options.onUpdate(handle.current.rows));
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
    emit(name, rows) {
      for (const handle of handles) if (handle.name === name) handle.emit(rows);
    },
    inspection() { return { attempts, dispatches, handles: handles.size }; },
  };
}

const likeClient = fakeSurfacesClient({
  timeline: [{ id: 'p1', liked: false, likeCount: 10 }],
  profilePosts: [{ id: 'p1', liked: false, likeCount: 10 }],
});
const likeBinding = await prepareReactBindingForClient(likeClient, { generatedManifest: likeFunctions });
const likeProvider = createSnapbackReactProvider(likeBinding, { connectionId: 'optimistic-toggle-test' });
const likeObserver = observeSnapbackQueries(
  likeProvider,
  {
    timeline: { ref: timeline, args: {} },
    profile: { ref: profilePosts, args: { handle: 'ada' } },
  },
  () => {},
);
await flush();
const view = () => likeObserver.snapshot().queries;
assert.equal(view().timeline.data[0].liked, false);
assert.equal(view().profile.data[0].likeCount, 10);

// Capture the intended outcome at admission. The projection is replayed over
// every newer authoritative base during rebase, so it must set the captured
// outcome; toggling or incrementing the incoming row would re-run the user
// action on replay and visibly invert or double-apply it.
const intended = { liked: true, likeCount: 11 };
const optimisticLike = {
  query: timeline,
  args: {},
  update: (posts) => posts.map((post) => post.id === 'p1' ? { ...post, ...intended } : post),
  isAuthoritative: (posts, receipt) => posts.some((post) => post.id === 'p1'
    && post.liked === receipt.liked && post.likeCount === receipt.likeCount),
};
const like = invokeSnapbackMutation(
  likeProvider,
  toggleLike,
  { postId: 'p1' },
  { optimistic: optimisticLike },
);
assert.equal(view().timeline.data[0].liked, true);
assert.equal(view().timeline.data[0].likeCount, 11, 'both fields change atomically');
assert.equal(view().profile.data[0].liked, false, 'v1: one canonical store carries the layer');

// A partial authoritative delivery (the like row landed, the denormalized
// count has not) rebases the layer instead of retiring it: the captured
// outcome holds, and a toggle-style reducer would have inverted here.
likeClient.emit('timeline', [{ id: 'p1', liked: true, likeCount: 10 }]);
assert.equal(view().timeline.data[0].liked, true, 'replay does not invert the heart');
assert.equal(view().timeline.data[0].likeCount, 11, 'partial delivery keeps the layer installed');

// Response-before-query: the HTTP receipt settles the mutation promise, but
// the layer retires only after a live delivery matches the complete receipt.
likeClient.inspection().attempts[0].resolve({ liked: true, likeCount: 11 });
assert.deepEqual(await like, { liked: true, likeCount: 11 });
assert.equal(view().timeline.data[0].likeCount, 11, 'settled response alone does not retire the layer');
likeClient.emit('timeline', [{ id: 'p1', liked: true, likeCount: 11 }]);
assert.equal(view().timeline.data[0].likeCount, 11);
likeClient.emit('timeline', [{ id: 'p1', liked: true, likeCount: 12 }]);
assert.equal(view().timeline.data[0].likeCount, 12, 'layer retired after the complete receipt');

// Other mounted stores rendering the same record update through their own
// authoritative subscriptions, not through the optimistic layer.
likeClient.emit('profilePosts', [{ id: 'p1', liked: true, likeCount: 12 }]);
assert.equal(view().profile.data[0].liked, true, 'other surfaces settle authoritatively');
assert.equal(view().profile.data[0].likeCount, 12);

// The recipe's capture-and-set projection is replay-stable, so the advisory
// stayed silent across the whole toggle section.
assert.equal(replayWarnings.length, 1, 'capture-and-set projections pass the replay advisory');

likeObserver.dispose();
await flush();
await likeProvider.dispose();
assert.equal(likeClient.inspection().handles, 0);

// projectRecordFields derives the same recipe shape from one declaration: an
// idempotent capture-and-set update plus a complete-receipt matcher, spread
// into the ordinary optimistic options.
const helperClient = fakeSurfacesClient({
  timeline: [{ id: 'p2', liked: false, likeCount: 3 }],
  profilePosts: [{ id: 'p2', liked: false, likeCount: 3 }],
});
const helperBinding = await prepareReactBindingForClient(helperClient, { generatedManifest: likeFunctions });
const helperProvider = createSnapbackReactProvider(helperBinding, { connectionId: 'optimistic-helper-test' });
const helperObserver = observeSnapbackQueries(
  helperProvider,
  { timeline: { ref: timeline, args: {} } },
  () => {},
);
await flush();
const helperView = () => helperObserver.snapshot().queries.timeline.data[0];

// One declaration derives the idempotent capture-and-set update and the
// complete-receipt matcher; spread it into the ordinary optimistic options.
const optimisticHelperLike = {
  query: timeline,
  args: {},
  ...projectRecordFields('p2', { liked: true, likeCount: 4 }, { idField: 'id' }),
};
const helperLike = invokeSnapbackMutation(
  helperProvider,
  toggleLike,
  { postId: 'p2' },
  { optimistic: optimisticHelperLike },
);
assert.equal(helperView().liked, true, 'helper update sets both fields atomically');
assert.equal(helperView().likeCount, 4);

// A partial authoritative delivery rebases the helper's layer instead of
// retiring it: the derived matcher wants the complete receipt.
helperClient.emit('timeline', [{ id: 'p2', liked: true, likeCount: 3 }]);
assert.equal(helperView().liked, true, 'helper projection does not invert on replay');
assert.equal(helperView().likeCount, 4, 'partial delivery keeps the helper layer installed');

helperClient.inspection().attempts[0].resolve({ liked: true, likeCount: 4 });
assert.deepEqual(await helperLike, { liked: true, likeCount: 4 });
helperClient.emit('timeline', [{ id: 'p2', liked: true, likeCount: 4 }]);
helperClient.emit('timeline', [{ id: 'p2', liked: true, likeCount: 5 }]);
assert.equal(helperView().likeCount, 5, 'helper matcher retired on the complete receipt');
assert.equal(replayWarnings.length, 1, 'projectRecordFields is replay-safe by construction');

// Declaration-time refusals: the helper only expresses capture-and-set over
// primitive intended outcomes.
assert.throws(() => projectRecordFields('', { liked: true }), TypeError);
assert.throws(() => projectRecordFields('p2', {}), TypeError);
assert.throws(() => projectRecordFields('p2', { nested: { deep: true } }), TypeError);

// The advisory is development-only: an explicit production NODE_ENV admits
// the same action-shaped reducer silently, and development warns again for a
// site that has not warned before.
const actionShaped = {
  query: timeline,
  args: {},
  update: (posts) => posts.map((post) => ({ ...post, likeCount: post.likeCount + 1 })),
};
const priorNodeEnv = process.env.NODE_ENV;
process.env.NODE_ENV = 'production';
let silent;
try {
  silent = invokeSnapbackMutation(
    helperProvider,
    toggleLike,
    { postId: 'p2' },
    { optimistic: actionShaped },
  );
  assert.equal(replayWarnings.length, 1, 'production skips the replay advisory');
} finally {
  if (priorNodeEnv === undefined) delete process.env.NODE_ENV;
  else process.env.NODE_ENV = priorNodeEnv;
}
helperClient.inspection().attempts[1].resolve({ liked: true, likeCount: 6 });
await silent;
const noisy = invokeSnapbackMutation(
  helperProvider,
  toggleLike,
  { postId: 'p2' },
  { optimistic: actionShaped },
);
assert.equal(replayWarnings.length, 2, 'development warns on the action-shaped reducer');
assert.match(replayWarnings[1], /toggleLike over timeline/);
helperClient.inspection().attempts[2].resolve({ liked: true, likeCount: 7 });
await noisy;
helperClient.emit('timeline', [{ id: 'p2', liked: true, likeCount: 7 }]);

helperObserver.dispose();
await flush();
await helperProvider.dispose();
assert.equal(helperClient.inspection().handles, 0);
console.warn = originalConsoleWarn;

console.log('optimistic.test.mjs: overlap, rollback, matcher ordering, rebase failure, install refusal, the toggle recipe, the replay advisory, and projectRecordFields pass');

import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import React from 'react';
import TestRenderer, { act } from 'react-test-renderer';

import { SnapbackDiagnosticError } from '@expo/snapback-client';
import { prepareReactBindingForClient } from '../snapback-client/react-binding.mjs';
import api from '../../demos/team-chat/snapback/generated/api.mjs';
import {
  SnapbackProvider,
  createSnapbackReactProvider,
  useSnapbackAuthorityMutation,
  useSnapbackAuthorityMutationStatus,
  useSnapbackAuthorityMyRole,
  useSnapbackAuthorityRoster,
} from './index.mjs';

globalThis.IS_REACT_ACT_ENVIRONMENT = true;

const generatedRoot = new URL('../../demos/team-chat/snapback/generated/', import.meta.url);
const baseFunctions = JSON.parse(readFileSync(new URL('functions.manifest.json', generatedRoot)));
const schema = JSON.parse(readFileSync(new URL('schema.manifest.json', generatedRoot)));
const capabilityManifest = JSON.parse(
  readFileSync(new URL('capability.manifest.json', generatedRoot)),
);
const flush = () => new Promise((resolve) => setImmediate(resolve));

const rotatedList = Object.freeze({
  ...api.roomMembersV2.list,
  id: 'team-chat:roomMembersV2Rotated.list',
  name: 'roomMembersV2Rotated.list',
  implementationHash: `sha256:${'a'.repeat(64)}`,
});
const rotatedProfile = Object.freeze({ ...api.roomMembersV2, list: rotatedList });
const functions = Object.freeze({
  ...baseFunctions,
  functions: Object.freeze([...baseFunctions.functions, rotatedList]),
});

const transition = Object.freeze({
  declaration: 'roomMembersV2',
  predecessor: Object.freeze({ role: 'member', status: 'active' }),
  successor: Object.freeze({ role: 'admin', status: 'active' }),
  subject: 'user-grace',
  scope: 'room-a',
  invalidationDisposition: 'global-authorization-epoch-advanced',
});

function authenticatedPrincipal(userId, generation = 1) {
  return Object.freeze({
    status: 'authenticated',
    userId,
    sessionId: `session-${userId}`,
    sessionClass: 'humanSession',
    provider: 'test',
    authorityInstanceId: `authority-${userId}`,
    sessionGeneration: generation,
    authorizationStreamIncarnation: `stream-${userId}-${generation}`,
    expiresAt: null,
    absoluteExpiresAt: null,
  });
}

function createAuthorityClient() {
  const liveHandles = new Map();
  const principalListeners = new Set();
  const mutationListeners = new Map();
  const queryCalls = [];
  const mutationCalls = [];
  const queryPlans = [];
  const rosterRows = new Map();
  let principal = authenticatedPrincipal('user-ada');
  let mutationFailure = null;
  let invalidateCursor = null;
  let namespace = 0;

  const rowsFor = (name, scopeId) => {
    if (name === 'roomMembersV2.myRole') {
      return [{ role: principal.userId === 'user-bob' ? 'admin' : 'owner', status: 'active' }];
    }
    if (rosterRows.has(scopeId)) return rosterRows.get(scopeId);
    return [{ userId: `${principal.userId}:${scopeId}:one`, role: 'owner' }];
  };
  const cursor = (scopeId, page) => `opaque:${principal.userId}:${scopeId}:${page}`;
  const authorityCapture = () => Object.freeze({
    authorityEpoch: principal.sessionGeneration,
    authorityKey: principal.authorityInstanceId,
    custodyRevision: principal.sessionGeneration,
  });

  const client = {
    authProtocols: { authInvalidation: 1 },
    auth: Object.freeze({
      currentPrincipal: () => principal,
      subscribeCurrentPrincipal(listener) {
        principalListeners.add(listener);
        return () => principalListeners.delete(listener);
      },
    }),
    liveQuery() {},
    async inspect() {
      return {
        targetProfileId: 'local-dev-sqlite-ibex',
        target: 'local-dev-sqlite-ibex',
        schema,
        functions,
        capabilityManifest,
        routeManifestHash: null,
      };
    },
    async authSession() { return { activeMode: 'sessions' }; },
    captureAuthority: authorityCapture,
    isAuthorityCaptureCurrent: () => true,
    registerAuthBarrierParticipant() { return async () => {}; },
    registerDurableConsumer() { return () => {}; },
    registerEphemeralRepublisher() { return Object.freeze({ dispose() {} }); },
    allocateLiveQueryNamespace(reference, args) {
      namespace += 1;
      return Object.freeze({
        clientStoreId: 'authority-hooks-test',
        queryKey: `${reference.id}:${JSON.stringify(args)}`,
        queryInstanceId: namespace,
      });
    },
    liveStreamManager() {
      return { inspection: () => ({ socketDemand: liveHandles.size }), async settled() {} };
    },
    async releaseConnection() { return { released: true }; },
    startLiveQuery(reference, options) {
      const scopeId = options.args.scopeId;
      const current = {
        rows: rowsFor(reference.name, scopeId),
        connection: 'live',
        freshness: 'current',
        retention: { retainable: false, code: null, reason: null, store: 'test' },
      };
      const handle = {
        current,
        options,
        started: async () => {},
        settled: async () => {},
        dispose() { liveHandles.delete(`${reference.name}:${scopeId}`); },
      };
      liveHandles.set(`${reference.name}:${scopeId}`, handle);
      queueMicrotask(() => options.onUpdate(current.rows, { freshness: 'current' }));
      return Object.freeze(handle);
    },
    async query(reference, options) {
      const args = structuredClone(options.args);
      queryCalls.push({ name: reference.name, args });
      const scopeId = args.scopeId;
      const after = args.page?.after ?? null;
      const plan = queryPlans.shift();
      if (plan !== undefined) {
        plan.options = options;
        if (plan.error !== undefined) throw plan.error;
        return plan.promise;
      }
      if (after !== null && after === invalidateCursor) {
        const error = new Error('opaque continuation expired');
        error.code = 'SNAPBACK_STANDARD_PATTERN_CURSOR_INVALID';
        error.diagnostic = Object.freeze({
          schemaVersion: 'snapback.client-diagnostic.v1',
          code: error.code,
          severity: 'error',
          message: error.message,
          details: Object.freeze({}),
        });
        throw error;
      }
      if (after === null) {
        return {
          rows: rowsFor(reference.name, scopeId),
          version: 1,
          cursor: reference.name.endsWith('.list') ? cursor(scopeId, 1) : null,
        };
      }
      if (after === cursor(scopeId, 1)) {
        return {
          rows: [{ userId: `${principal.userId}:${scopeId}:two`, role: 'member' }],
          version: 2,
          cursor: cursor(scopeId, 2),
        };
      }
      return { rows: [], version: 3, cursor: null };
    },
    async mutate(reference, options) {
      mutationCalls.push({ name: reference.name, args: structuredClone(options.args) });
      if (mutationFailure !== null) throw mutationFailure;
      return {
        result: null,
        version: 3,
        changed_count: 1,
        authorityTransitions: [transition],
      };
    },
    subscribeMutation(clientMutationId, listener) {
      let listeners = mutationListeners.get(clientMutationId);
      if (listeners === undefined) {
        listeners = new Set();
        mutationListeners.set(clientMutationId, listeners);
      }
      listeners.add(listener);
      queueMicrotask(() => listener(AUTHORITY_UNKNOWN));
      return () => listeners.delete(listener);
    },
    setPrincipal(userId) {
      principal = authenticatedPrincipal(userId, principal.sessionGeneration + 1);
      for (const listener of [...principalListeners]) listener();
    },
    refreshPrincipalGeneration() {
      principal = authenticatedPrincipal(principal.userId, principal.sessionGeneration + 1);
      for (const listener of [...principalListeners]) listener();
    },
    setInvalidCursor(value) { invalidateCursor = value; },
    deferNextQuery() {
      let resolve;
      let reject;
      const plan = {
        options: null,
        promise: new Promise((onResolve, onReject) => {
          resolve = onResolve;
          reject = onReject;
        }),
      };
      plan.resolve = resolve;
      plan.reject = reject;
      queryPlans.push(plan);
      return plan;
    },
    failNextQuery(error) { queryPlans.push({ error, options: null }); },
    setMutationFailure(error) { mutationFailure = error; },
    emitMutation(clientMutationId, disposition) {
      for (const listener of [...(mutationListeners.get(clientMutationId) ?? [])]) {
        listener(disposition);
      }
    },
    driveRole(scopeId, state) {
      const handle = liveHandles.get(`roomMembersV2.myRole:${scopeId}`);
      assert.ok(handle, 'myRole live handle exists');
      if (state === 'denied') {
        const error = new Error('role requirement not satisfied');
        error.code = 'SNAPBACK_AUTH_PERMISSION_DENIED';
        error.diagnostic = Object.freeze({
          schemaVersion: 'snapback.client-diagnostic.v1',
          code: error.code,
          severity: 'error',
          message: error.message,
          details: Object.freeze({}),
        });
        handle.current.rows = [];
        handle.options.onUpdate([], {
          version: 0,
          kind: 'authorization_denied',
          authorization: { kind: 'denied', code: error.code },
          error,
        });
        return;
      }
      const rows = [{ role: 'admin', status: 'active' }];
      handle.current.rows = rows;
      handle.current.connection = 'live';
      handle.options.onConnectionChange?.('live', {});
      handle.options.onUpdate(rows, { freshness: 'current' });
    },
    driveRosterConnection(scopeId, connection) {
      const entry = [...liveHandles.entries()].find(([key]) => key.endsWith(`.list:${scopeId}`));
      assert.ok(entry, 'roster live handle exists');
      const handle = entry[1];
      handle.current.connection = connection;
      handle.options.onConnectionChange?.(connection, {});
    },
    driveRoster(scopeId, state) {
      const entry = [...liveHandles.entries()].find(([key]) => key.endsWith(`.list:${scopeId}`));
      assert.ok(entry, 'roster live handle exists');
      const handle = entry[1];
      if (state === 'denied') {
        const error = new Error('roster visibility requirement not satisfied');
        error.code = 'SNAPBACK_AUTH_PERMISSION_DENIED';
        error.diagnostic = Object.freeze({
          schemaVersion: 'snapback.client-diagnostic.v1',
          code: error.code,
          severity: 'error',
          message: error.message,
          details: Object.freeze({}),
        });
        handle.current.rows = [];
        handle.options.onUpdate([], {
          version: 0,
          kind: 'authorization_denied',
          authorization: { kind: 'denied', code: error.code },
          error,
        });
        return;
      }
      const rows = [{ userId: `${principal.userId}:${scopeId}:granted`, role: 'member' }];
      rosterRows.set(scopeId, rows);
      handle.current.rows = rows;
      handle.current.connection = 'live';
      handle.options.onConnectionChange?.('live', {});
      handle.options.onUpdate(rows, { freshness: 'current' });
    },
    inspection: () => ({ queryCalls, mutationCalls }),
  };
  return client;
}

const AUTHORITY_UNKNOWN = Object.freeze({ status: 'unknown' });
const client = createAuthorityClient();
const binding = await prepareReactBindingForClient(client, { generatedManifest: functions });
const provider = createSnapbackReactProvider(binding, { connectionId: 'authority-hooks-test' });

let roster;
let myRole;
let changeRole;
let mutationStatus;
function Probe({ scopeId, statusId, profile }) {
  roster = useSnapbackAuthorityRoster(profile, scopeId, { limit: 1 });
  myRole = useSnapbackAuthorityMyRole(api.roomMembersV2, scopeId);
  changeRole = useSnapbackAuthorityMutation(api.roomMembersV2.changeRole);
  mutationStatus = useSnapbackAuthorityMutationStatus(statusId);
  return null;
}
const tree = (scopeId, statusId = null, profile = api.roomMembersV2) => React.createElement(
  SnapbackProvider,
  { provider },
  React.createElement(Probe, { scopeId, statusId, profile }),
);

let renderer;
await act(async () => {
  renderer = TestRenderer.create(tree('room-a'));
  await flush();
  await flush();
});
assert.equal(roster.status, 'ready');
assert.deepEqual(roster.data, [{ userId: 'user-ada:room-a:one', role: 'owner' }]);
assert.equal(roster.cursor, 'opaque:user-ada:room-a:1');
assert.equal(roster.hasMore, true);

let pageOutcome;
await act(async () => {
  pageOutcome = await roster.loadMore();
  await flush();
});
assert.deepEqual(pageOutcome, {
  status: 'appended',
  rows: 1,
  cursor: 'opaque:user-ada:room-a:2',
  hasMore: true,
});
assert.deepEqual(roster.data.map(({ userId }) => userId), [
  'user-ada:room-a:one',
  'user-ada:room-a:two',
]);
assert.equal(
  client.inspection().queryCalls.at(-1).args.page.after,
  'opaque:user-ada:room-a:1',
  'the hook forwards the server continuation without interpreting it',
);

const continuationFailure = new Error('continuation transport failed');
continuationFailure.code = 'SNAPBACK_TEST_CONTINUATION_FAILED';
client.failNextQuery(continuationFailure);
await act(async () => {
  await assert.rejects(roster.loadMore(), (error) => error === continuationFailure);
  await flush();
});
assert.equal(roster.status, 'ready', 'continuation failure keeps loaded rows renderable');
assert.deepEqual(roster.data.map(({ userId }) => userId), [
  'user-ada:room-a:one',
  'user-ada:room-a:two',
]);
assert.equal(roster.pageError.code, 'SNAPBACK_TEST_CONTINUATION_FAILED');

client.setInvalidCursor('opaque:user-ada:room-a:2');
await act(async () => {
  pageOutcome = await roster.loadMore();
  await flush();
  await flush();
});
assert.deepEqual(pageOutcome, { status: 'reset', reason: 'cursor-invalid' });
assert.equal(roster.status, 'ready', 'cursor invalidation is an ordinary reset, not an error');
assert.equal(roster.cursor, 'opaque:user-ada:room-a:1');
assert.deepEqual(roster.data, [{ userId: 'user-ada:room-a:one', role: 'owner' }]);
assert.equal(roster.pageError, null);

const initialFailure = new Error('first page failed');
initialFailure.code = 'SNAPBACK_TEST_FIRST_PAGE_FAILED';
client.failNextQuery(initialFailure);
await act(async () => {
  renderer.update(tree('room-first-error'));
  await flush();
  await flush();
});
assert.equal(roster.status, 'error', 'only first-page acquisition uses the query error arm');
assert.equal(roster.error.code, 'SNAPBACK_TEST_FIRST_PAGE_FAILED');
assert.equal(roster.data, undefined);
assert.equal(roster.pageError, null);
await act(async () => {
  roster.reset();
  await flush();
  await flush();
});
assert.equal(roster.status, 'ready', 'reset reacquires after a first-page failure');

await act(async () => {
  renderer.update(tree('room-b'));
  await flush();
  await flush();
});
assert.equal(roster.cursor, 'opaque:user-ada:room-b:1');
assert.deepEqual(roster.data, [{ userId: 'user-ada:room-b:one', role: 'owner' }]);
assert.equal(
  client.inspection().queryCalls.at(-1).args.page?.after,
  undefined,
  'scope replacement drops the predecessor continuation locally',
);

await act(async () => {
  client.setPrincipal('user-bob');
  await flush();
  await flush();
});
assert.equal(roster.cursor, 'opaque:user-bob:room-b:1');
assert.deepEqual(roster.data, [{ userId: 'user-bob:room-b:one', role: 'owner' }]);
assert.equal(
  client.inspection().queryCalls.at(-1).args.page?.after,
  undefined,
  'caller replacement drops the predecessor continuation locally',
);

await act(async () => {
  await roster.loadMore();
  await flush();
});
assert.equal(roster.cursor, 'opaque:user-bob:room-b:2');
await act(async () => {
  client.refreshPrincipalGeneration();
  await flush();
  await flush();
});
assert.equal(roster.cursor, 'opaque:user-bob:room-b:1');
assert.equal(
  client.inspection().queryCalls.at(-1).args.page?.after,
  undefined,
  'same-caller authority-generation replacement drops the continuation locally',
);

const refreshingQueryCount = client.inspection().queryCalls.length;
await act(async () => {
  client.driveRosterConnection('room-b', 'stale');
  await flush();
});
assert.equal(roster.status, 'refreshing');
assert.ok(Array.isArray(roster.data), 'refreshing retains the live owner\'s renderable data');
assert.equal(
  client.inspection().queryCalls.length,
  refreshingQueryCount,
  'refreshing preserves the live-owner state and defers the one-shot first page',
);
await act(async () => {
  client.driveRosterConnection('room-b', 'live');
  await flush();
  await flush();
});
assert.equal(roster.status, 'ready');
assert.equal(client.inspection().queryCalls.length, refreshingQueryCount + 1);

const livePublishDeferred = client.deferNextQuery();
let livePublishLoad;
await act(async () => {
  livePublishLoad = roster.loadMore();
  await flush();
});
assert.equal(roster.loadingMore, true);
await act(async () => {
  client.driveRosterConnection('room-b', 'live');
  livePublishDeferred.resolve({
    rows: [{ userId: 'stale-live-publish-page', role: 'member' }],
    cursor: 'stale-live-publish-cursor',
  });
  await flush();
  await flush();
});
assert.equal(livePublishDeferred.options.signal.aborted, true);
assert.deepEqual(await livePublishLoad, { status: 'reset', reason: 'identity-changed' });
assert.deepEqual(
  roster.data,
  [{ userId: 'user-bob:room-b:one', role: 'owner' }],
  'a same-turn live-owner publish supersedes and discards an in-flight continuation',
);

const resetDeferred = client.deferNextQuery();
let resetLoad;
await act(async () => {
  resetLoad = roster.loadMore();
  await flush();
});
await act(async () => {
  roster.reset();
  await flush();
  await flush();
});
assert.equal(resetDeferred.options.signal.aborted, true);
assert.deepEqual(await resetLoad, { status: 'reset', reason: 'identity-changed' });
resetDeferred.resolve({
  rows: [{ userId: 'stale-reset-page', role: 'member' }],
  cursor: 'stale-reset-cursor',
});
await flush();
assert.deepEqual(
  roster.data,
  [{ userId: 'user-bob:room-b:one', role: 'owner' }],
  'explicit reset prevents its predecessor continuation from appending',
);

await act(async () => {
  client.driveRoster('room-b', 'denied');
  await flush();
});
assert.equal(roster.status, 'error');
assert.equal(roster.error.code, 'SNAPBACK_AUTH_PERMISSION_DENIED');
await act(async () => {
  client.driveRoster('room-b', 'granted');
  await flush();
  await flush();
});
assert.equal(roster.status, 'ready', 'grant wake reaches the dedicated roster hook');
assert.deepEqual(roster.data, [{ userId: 'user-bob:room-b:granted', role: 'member' }]);

await act(async () => {
  await roster.loadMore();
  await flush();
});
assert.equal(roster.cursor, 'opaque:user-bob:room-b:2');
await act(async () => {
  renderer.update(tree('room-b', null, rotatedProfile));
  await flush();
  await flush();
});
assert.equal(roster.cursor, 'opaque:user-bob:room-b:1');
assert.equal(client.inspection().queryCalls.at(-1).name, 'roomMembersV2Rotated.list');
assert.equal(
  client.inspection().queryCalls.at(-1).args.page?.after,
  undefined,
  'generated-reference identity replacement drops the predecessor continuation locally',
);

await act(async () => {
  client.driveRole('room-b', 'denied');
  await flush();
});
assert.equal(myRole.status, 'error');
assert.equal(myRole.error.code, 'SNAPBACK_AUTH_PERMISSION_DENIED');
await act(async () => {
  client.driveRole('room-b', 'granted');
  await flush();
});
assert.equal(myRole.status, 'ready', 'grant wake reaches the dedicated role hook');
assert.deepEqual(myRole.data, { role: 'admin', status: 'active' });

const settled = await changeRole({
  scopeId: 'room-b',
  principal: 'user-grace',
  role: 'admin',
});
assert.deepEqual(settled, {
  status: 'settled',
  result: null,
  authorityTransitions: [transition],
});

const refused = new Error('only an owner may change roles');
refused.code = 'SNAPBACK_AUTH_PERMISSION_DENIED';
client.setMutationFailure(refused);
await assert.rejects(
  changeRole({ scopeId: 'room-b', principal: 'user-grace', role: 'member' }),
  (error) => (
    error instanceof SnapbackDiagnosticError
    && error.code === 'SNAPBACK_AUTH_PERMISSION_DENIED'
    && error.operation === 'authority-mutation'
  ),
  'stable refusal codes use the public typed exception carrier',
);
client.setMutationFailure(null);

await act(async () => {
  renderer.update(tree('room-b', 'queued-authority-1', rotatedProfile));
  await flush();
});
await act(async () => {
  client.emitMutation('queued-authority-1', {
    status: 'settled',
    settlement: {
      result: null,
      version: 4,
      changed_count: 1,
      authorityTransitions: [transition],
    },
    settledAt: 42,
  });
  await flush();
});
assert.equal(mutationStatus.status, 'settled');
assert.deepEqual(mutationStatus.settlement.authorityTransitions, [transition]);
await act(async () => {
  client.emitMutation('queued-authority-1', {
    status: 'failed',
    failure: { code: 'SNAPBACK_AUTH_PERMISSION_DENIED', message: 'denied' },
  });
  await flush();
});
assert.equal(mutationStatus.status, 'failed');
assert.equal(mutationStatus.failure.code, 'SNAPBACK_AUTH_PERMISSION_DENIED');

const unmountDeferred = client.deferNextQuery();
let unmountedLoad;
await act(async () => {
  unmountedLoad = roster.loadMore();
  await flush();
});
await act(async () => {
  renderer.unmount();
  await flush();
});
assert.equal(unmountDeferred.options.signal.aborted, true, 'unmount aborts pending page tasks');
assert.deepEqual(await unmountedLoad, { status: 'reset', reason: 'identity-changed' });
unmountDeferred.resolve({
  rows: [{ userId: 'stale-unmounted-page', role: 'member' }],
  cursor: null,
});
await flush();
await provider.dispose();

console.log('snapback-react authority hooks: epoch, lifecycle, wake, receipt, and refusal tests pass');

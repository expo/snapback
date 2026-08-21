import assert from 'node:assert/strict';
import { test } from 'node:test';
import React from 'react';
import TestRenderer, { act } from 'react-test-renderer';

import { prepareReactBindingForClient } from '../snapback-client/react-binding.mjs';
import { resultContractHash } from '../snapback-codegen/result-contracts.mjs';
import { createSnapbackReactProvider } from './core.mjs';
import { SnapbackProvider, useQuery } from './familiar.mjs';

globalThis.IS_REACT_ACT_ENVIRONMENT = true;

const flush = () => new Promise((resolve) => setImmediate(resolve));
const queryContract = Object.freeze({
  kind: 'records',
  record: Object.freeze({
    kind: 'object',
    fields: Object.freeze([
      Object.freeze({ name: 'id', required: true, value: { kind: 'string', maxBytes: 32 } }),
    ]),
    allowExtra: false,
  }),
});
const optionalRecords = Object.freeze({
  artifactKind: 'functionReference',
  schemaVersion: 'snapback.v0',
  appId: 'optional-user-transition-fixture',
  id: 'optional-user-transition-fixture:records',
  name: 'records.list',
  kind: 'LiveQuery',
  authoringProfile: 'snapback-familiar-ts-v1',
  authRequirement: 'optional-user',
  implementationHash: 'sha256:optional-user-records-implementation',
  argsContractHash: 'sha256:optional-user-records-args',
  argsContract: Object.freeze({ kind: 'object', fields: Object.freeze([]) }),
  resultContractHash: resultContractHash(queryContract),
  resultContract: queryContract,
});
const functions = Object.freeze({
  artifactKind: 'functionManifest',
  schemaVersion: 'snapback.v0',
  appId: 'optional-user-transition-fixture',
  bundleHash: 'sha256:optional-user-transition-bundle',
  functions: Object.freeze([optionalRecords]),
});

const rowsFor = (authority) => Object.freeze([
  Object.freeze({ id: authority === 'anonymous' ? 'anonymous' : `user-${authority}` }),
]);

function fakeClient({ initialAuthority = 'anonymous' } = {}) {
  const diagnostics = [];
  const state = {
    authority: initialAuthority,
    authorityEpoch: initialAuthority === 'anonymous' ? 0 : 1,
    custodyRevision: 1,
    publicationPaused: false,
    participant: null,
    attempts: [],
    diagnostics,
    failNextSuccessor: null,
  };
  const captureForState = () => Object.freeze({
    authorityEpoch: state.authorityEpoch,
    authorityKey: `authority:${state.authority}`,
    custodyRevision: state.custodyRevision,
  });
  const authorityForCapture = (capture) => Object.freeze({
    kind: capture?.authorityKey === 'authority:anonymous' ? 'anonymous' : 'session',
  });
  const coordinator = Object.freeze({
    capture() {
      if (state.publicationPaused) {
        const error = new Error('authority custody is not settled for app-visible work');
        error.code = 'SNAPBACK_CLIENT_AUTHORITY_CLEARING';
        throw error;
      }
      return captureForState();
    },
    credentialFor(capture) {
      return Object.freeze({ authority: authorityForCapture(capture) });
    },
  });
  const client = {
    state,
    authCoordinator: coordinator,
    liveQuery() {},
    async inspect() {
      return {
        targetProfileId: 'local-dev-sqlite-ibex',
        target: 'local-dev-sqlite-ibex',
        schema: { schemaHash: 'sha256:optional-user-transition-schema' },
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
    diagnosticsChannel() {
      return Object.freeze({
        emit(event) { diagnostics.push(event); return event; },
        subscribe() { return () => {}; },
        snapshot() { return Object.freeze([...diagnostics]); },
      });
    },
    captureAuthority() { return coordinator.capture(); },
    isAuthorityCaptureCurrent(capture) {
      const current = captureForState();
      return !state.publicationPaused
        && capture?.authorityEpoch === current.authorityEpoch
        && capture?.authorityKey === current.authorityKey
        && capture?.custodyRevision === current.custodyRevision;
    },
    registerAuthBarrierParticipant(participant) {
      state.participant = participant;
      return async () => { state.participant = null; };
    },
    liveStreamManager() { return { async settled() {} }; },
    startLiveQuery(_reference, options) {
      const attempt = {
        authority: state.authority,
        capture: options.authorityCapture ?? null,
        options,
        disposed: false,
      };
      state.attempts.push(attempt);
      if (state.failNextSuccessor === 'synchronous') {
        state.failNextSuccessor = null;
        const error = new Error('successor transport could not be created');
        error.code = 'SNAPBACK_TRANSPORT_UNAVAILABLE';
        throw error;
      }
      if (state.failNextSuccessor === 'asynchronous') {
        state.failNextSuccessor = null;
        const error = new Error('successor protocol could not be negotiated');
        error.code = 'SNAPBACK_WIRE_VERSION_UNSUPPORTED';
        error.status = 400;
        error.diagnostic = Object.freeze({
          code: error.code,
          message: error.message,
          details: Object.freeze({}),
        });
        const rejection = Promise.reject(error);
        rejection.catch(() => {});
        const handle = Object.freeze({
          current: null,
          started: () => rejection,
          dispose() { attempt.disposed = true; },
          settled: async () => {},
        });
        attempt.handle = handle;
        return handle;
      }
      const current = Object.freeze({
        rows: rowsFor(attempt.authority),
        authoritativeRows: rowsFor(attempt.authority),
        connection: 'live',
        freshness: 'current',
      });
      const handle = Object.freeze({
        current,
        started: async () => {},
        dispose() { attempt.disposed = true; },
        settled: async () => {},
      });
      attempt.handle = handle;
      attempt.publish = (rows = current.rows, detail = {}) => options.onUpdate(rows, {
        kind: 'authorization_snapshot',
        freshness: 'current',
        authoritativeRows: rows,
        ...detail,
      });
      attempt.connection = (connection, detail = {}) => (
        options.onConnectionChange(connection, detail)
      );
      queueMicrotask(() => {
        if (!attempt.disposed) attempt.publish();
      });
      return handle;
    },
    async transitionAuthority(authority, reason, duringBarrier = null) {
      const participant = state.participant;
      assert.ok(participant, 'React provider registered an auth-barrier participant');
      const predecessor = state.attempts.at(-1) ?? null;
      state.publicationPaused = true;
      await participant.quiesce({ reason });
      participant.blank({ reason });
      await duringBarrier?.({ predecessor });
      participant.clearMemory({ reason });
      state.authority = authority;
      state.authorityEpoch += 1;
      state.custodyRevision += 1;
      const capture = captureForState();
      const authorityView = Object.freeze({
        ...capture,
        authority: authorityForCapture(capture),
        bearer: authority === 'anonymous' ? null : 'must-not-enter-live-options',
      });
      const staged = [];
      const attemptsBeforeResume = state.attempts.length;
      await participant.resume({
        reason,
        capture,
        authority: authorityView.authority,
        stagePublication(stagedCapture, commit) {
          assert.deepEqual(stagedCapture, capture);
          staged.push(commit);
        },
      });
      assert.equal(
        state.attempts.length,
        attemptsBeforeResume,
        'resume does not create a successor before exact confirmation',
      );
      assert.equal(staged.length, 1);
      staged[0](authorityView);
      state.publicationPaused = false;
      await flush();
      return { capture, predecessor };
    },
  };
  return client;
}

async function mountRegistry(client) {
  const binding = await prepareReactBindingForClient(client, { generatedManifest: functions });
  const provider = createSnapbackReactProvider(binding, {
    connectionId: 'optional-user-transition-test',
  });
  const descriptor = provider.registry.descriptor(optionalRecords, {});
  const listener = () => {};
  let lease = provider.registry.subscribe(descriptor, listener);
  await flush();
  return {
    provider,
    descriptor,
    listener,
    snapshot: () => provider.registry.snapshot(descriptor),
    get lease() { return lease; },
    set lease(value) { lease = value; },
    remount() { lease = provider.registry.subscribe(descriptor, listener, lease); },
  };
}

const assertReadyFor = (mounted, authority) => {
  const snapshot = mounted.snapshot();
  assert.equal(snapshot.status, 'ready');
  assert.equal(snapshot.connection, 'live');
  assert.equal(snapshot.freshness, 'current');
  assert.deepEqual(snapshot.data, rowsFor(authority));
};

const assertSingleSettledSuccessor = (client, capture, expectedAttempts = 2) => {
  assert.equal(client.state.attempts.length, expectedAttempts);
  assert.deepEqual(client.state.attempts.at(-1).capture, capture);
};

test('core optional-user live query transitions replace one fenced predecessor', async (t) => {
  await t.test('sign-in', async () => {
    const client = fakeClient();
    const mounted = await mountRegistry(client);
    try {
      assertReadyFor(mounted, 'anonymous');
      const { capture, predecessor } = await client.transitionAuthority('A', 'sign-in');
      assertSingleSettledSuccessor(client, capture);
      assertReadyFor(mounted, 'A');

      predecessor.publish(rowsFor('anonymous'));
      predecessor.connection('disconnected');
      assertReadyFor(mounted, 'A');
    } finally {
      mounted.lease.release();
      await mounted.provider.dispose();
    }
  });

  await t.test('sign-out', async () => {
    const client = fakeClient({ initialAuthority: 'A' });
    const mounted = await mountRegistry(client);
    try {
      assertReadyFor(mounted, 'A');
      const { capture } = await client.transitionAuthority('anonymous', 'sign-out');
      assertSingleSettledSuccessor(client, capture);
      assertReadyFor(mounted, 'anonymous');
    } finally {
      mounted.lease.release();
      await mounted.provider.dispose();
    }
  });

  await t.test('user A to user B', async () => {
    const client = fakeClient({ initialAuthority: 'A' });
    const mounted = await mountRegistry(client);
    try {
      const { capture } = await client.transitionAuthority('B', 'replace-user');
      assertSingleSettledSuccessor(client, capture);
      assertReadyFor(mounted, 'B');
      assert.notDeepEqual(client.state.attempts[0].capture, capture);
    } finally {
      mounted.lease.release();
      await mounted.provider.dispose();
    }
  });

  await t.test('reconnect callback during transition', async () => {
    const client = fakeClient();
    const mounted = await mountRegistry(client);
    try {
      const { capture } = await client.transitionAuthority(
        'A',
        'sign-in-during-reconnect',
        ({ predecessor }) => {
          predecessor.connection('disconnected', { reason: 'carrier-reset' });
          predecessor.publish(rowsFor('anonymous'));
        },
      );
      assertSingleSettledSuccessor(client, capture);
      assertReadyFor(mounted, 'A');
    } finally {
      mounted.lease.release();
      await mounted.provider.dispose();
    }
  });

  await t.test('unmount and remount during transition', async () => {
    const client = fakeClient();
    const mounted = await mountRegistry(client);
    try {
      const { capture } = await client.transitionAuthority(
        'A',
        'sign-in-with-remount',
        () => {
          mounted.lease.release();
          mounted.lease = null;
          mounted.remount();
        },
      );
      assertSingleSettledSuccessor(client, capture);
      mounted.remount();
      mounted.remount();
      await flush();
      assertSingleSettledSuccessor(client, capture);
      assertReadyFor(mounted, 'A');
    } finally {
      mounted.lease?.release();
      await mounted.provider.dispose();
    }
  });
});

test('optional-user successor creation failure is a classified projection', async (t) => {
  for (const [mode, causeCode] of [
    ['synchronous', 'SNAPBACK_TRANSPORT_UNAVAILABLE'],
    ['asynchronous', 'SNAPBACK_WIRE_VERSION_UNSUPPORTED'],
  ]) {
    await t.test(mode, async () => {
      const client = fakeClient();
      const mounted = await mountRegistry(client);
      try {
        client.state.failNextSuccessor = mode;
        const { capture } = await client.transitionAuthority('A', `sign-in-${mode}-failure`);
        await flush();
        assertSingleSettledSuccessor(client, capture);
        const failed = mounted.snapshot();
        assert.equal(failed.status, 'error');
        assert.equal(failed.connection, 'error');
        assert.equal(failed.freshness, 'unknown');
        assert.equal(failed.data, undefined);
        assert.equal(failed.error.code, 'SNAPBACK_AUTH_TRANSITION_FAILED');
        assert.equal(failed.error.details.phase, 'react-live-query-successor');
        assert.equal(failed.error.details.causeCode, causeCode);
        assert.equal(
          client.state.diagnostics.at(-1).code,
          'SNAPBACK_AUTH_TRANSITION_FAILED',
        );
      } finally {
        mounted.lease.release();
        await mounted.provider.dispose();
      }
    });
  }
});

test('Familiar useQuery follows the mounted optional-user successor', async () => {
  const client = fakeClient();
  const binding = await prepareReactBindingForClient(client, { generatedManifest: functions });
  const provider = createSnapbackReactProvider(binding, {
    connectionId: 'optional-user-familiar-transition-test',
  });
  const renders = [];
  const Probe = () => (renders.push(useQuery(optionalRecords, {})), null);
  let renderer;
  try {
    await act(async () => {
      renderer = TestRenderer.create(React.createElement(
        SnapbackProvider,
        { provider },
        React.createElement(Probe),
      ));
      await flush();
    });
    assert.deepEqual(renders.at(-1), rowsFor('anonymous'));

    let transition;
    await act(async () => {
      transition = await client.transitionAuthority('A', 'familiar-sign-in');
      await flush();
    });
    assertSingleSettledSuccessor(client, transition.capture);
    assert.deepEqual(renders.at(-1), rowsFor('A'));

    await act(async () => {
      transition.predecessor.publish(rowsFor('anonymous'));
      await flush();
    });
    assert.deepEqual(renders.at(-1), rowsFor('A'));
  } finally {
    await act(async () => {
      renderer?.unmount();
      await flush();
    });
    await provider.dispose();
  }
});

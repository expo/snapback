import assert from 'node:assert/strict';
import { mock, test } from 'node:test';

import { prepareReactBindingForClient } from '../snapback-client/react-binding.mjs';
import { resultContractHash } from '../snapback-codegen/result-contracts.mjs';
import { createSnapbackReactProvider } from './index.mjs';

const flush = () => new Promise((resolve) => setImmediate(resolve));
const deferred = () => {
  let resolve;
  const promise = new Promise((resolvePromise) => { resolve = resolvePromise; });
  return Object.freeze({ promise, resolve });
};
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
const privateRecords = Object.freeze({
  artifactKind: 'functionReference',
  schemaVersion: 'snapback.v0',
  appId: 'auth-blocked-fixture',
  id: 'auth-blocked-fixture:privateRecords',
  name: 'privateRecords',
  kind: 'LiveQuery',
  authRequirement: 'authenticated',
  implementationHash: 'sha256:private-records-implementation',
  argsContractHash: 'sha256:private-records-args',
  argsContract: { kind: 'object', fields: [] },
  resultContractHash: resultContractHash(queryContract),
  resultContract: queryContract,
});
const functions = Object.freeze({
  artifactKind: 'functionManifest',
  schemaVersion: 'snapback.v0',
  appId: 'auth-blocked-fixture',
  bundleHash: 'sha256:auth-blocked-bundle',
  functions: [privateRecords],
});
const ROWS = Object.freeze([{ id: 'private-1' }, { id: 'private-2' }]);

function fakeClient({ initialAuthority = 'anonymous', raceToAnonymous = false } = {}) {
  const state = {
    authority: initialAuthority,
    authorityEpoch: initialAuthority === 'anonymous' ? 0 : 1,
    custodyRevision: 1,
    publicationPaused: false,
    attempts: 0,
    authorityCaptures: [],
    disposals: 0,
    participant: null,
    raceToAnonymous,
    beforeStagedFlush: null,
    afterStagedFlush: null,
    terminalStatus: Object.freeze({
      terminated: false,
      code: null,
      authorityDisposition: null,
      atMs: null,
    }),
  };
  const captureForState = () => Object.freeze({
    authorityEpoch: state.authorityEpoch,
    authorityKey: `authority:${state.authority}`,
    custodyRevision: state.custodyRevision,
  });
  const coordinator = {
    capture() {
      if (state.publicationPaused) {
        const error = new Error('authority custody is not settled for app-visible work');
        error.code = 'SNAPBACK_CLIENT_AUTHORITY_CLEARING';
        throw error;
      }
      return captureForState();
    },
    credentialFor() {
      return Object.freeze({
        authority: Object.freeze({
          kind: state.authority === 'anonymous' ? 'anonymous' : 'session',
        }),
      });
    },
  };
  const client = {
    state,
    authCoordinator: coordinator,
    authTerminalStatus() { return state.terminalStatus; },
    liveQuery() {},
    async inspect() {
      return {
        targetProfileId: 'local-dev-sqlite-ibex',
        target: 'local-dev-sqlite-ibex',
        schema: { schemaHash: 'sha256:auth-blocked-schema' },
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
      state.attempts += 1;
      state.authorityCaptures.push(options.authorityCapture ?? null);
      if (state.raceToAnonymous) {
        state.raceToAnonymous = false;
        state.authority = 'anonymous';
        const error = new Error('SNAPBACK_AUTH_REQUIRED: authentication is required');
        error.code = 'SNAPBACK_AUTH_REQUIRED';
        error.status = 401;
        error.diagnostic = {
          code: 'SNAPBACK_AUTH_REQUIRED',
          message: 'authentication is required',
        };
        const rejection = Promise.reject(error);
        rejection.catch(() => {});
        return Object.freeze({
          current: null,
          started: () => rejection,
          dispose() { state.disposals += 1; },
          settled: async () => {},
        });
      }
      const current = { rows: [...ROWS], connection: 'live', freshness: 'current' };
      const handle = {
        current,
        started: async () => {},
        dispose() { state.disposals += 1; },
        settled: async () => {},
      };
      queueMicrotask(() => options.onUpdate(current.rows, { freshness: 'current' }));
      return Object.freeze(handle);
    },
    async transitionAuthority(authority, reason, duringBarrier = null) {
      const participant = state.participant;
      assert.ok(participant, 'React provider registered its authority barrier participant');
      state.publicationPaused = true;
      await participant.quiesce({ reason });
      participant.blank({ reason });
      await duringBarrier?.();
      participant.clearMemory({ reason });
      state.authority = authority;
      state.authorityEpoch += 1;
      state.custodyRevision += 1;
      state.terminalStatus = Object.freeze({
        terminated: false,
        code: null,
        authorityDisposition: null,
        atMs: null,
      });
      const capture = captureForState();
      const authorityView = Object.freeze({
        ...capture,
        authority: Object.freeze({
          kind: authority === 'anonymous' ? 'anonymous' : 'session',
        }),
        bearer: authority === 'anonymous' ? null : 'must-not-cross-into-live-options',
      });
      const staged = [];
      const attemptsBeforeResume = state.attempts;
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
        state.attempts,
        attemptsBeforeResume,
        'participant resume performs no live work before exact confirmation',
      );
      state.beforeStagedFlush?.();
      for (const commit of staged) commit(authorityView);
      state.afterStagedFlush?.();
      state.publicationPaused = false;
    },
    async revoke(duringBarrier = null) {
      const participant = state.participant;
      assert.ok(participant, 'React provider registered its authority barrier participant');
      const error = new Error('SNAPBACK_AUTH_SESSION_REVOKED: session was revoked');
      error.code = 'SNAPBACK_AUTH_SESSION_REVOKED';
      const context = Object.freeze({
        reason: error.code,
        terminal: true,
        terminalError: error,
        disposition: 'quarantine',
      });
      state.terminalStatus = Object.freeze({
        terminated: true,
        code: error.code,
        authorityDisposition: 'carrier',
        atMs: Date.now(),
      });
      state.publicationPaused = true;
      await participant.quiesce(context);
      participant.blank(context);
      await duringBarrier?.();
      participant.clearMemory(context);
      state.publicationPaused = false;
    },
    async signIn() { return this.transitionAuthority('session', 'login'); },
    async logout() { return this.transitionAuthority('anonymous', 'logout'); },
  };
  return client;
}

async function mount(client, { subscribe = true } = {}) {
  const binding = await prepareReactBindingForClient(client, { generatedManifest: functions });
  const provider = createSnapbackReactProvider(binding, { connectionId: 'auth-blocked-test' });
  const registry = provider.registry;
  const descriptor = registry.descriptor(privateRecords, {});
  let flips = 0;
  const listener = () => { flips += 1; };
  let lease = subscribe ? registry.subscribe(descriptor, listener) : null;
  await flush();
  return {
    provider,
    registry,
    descriptor,
    get lease() { return lease; },
    set lease(value) { lease = value; },
    listener,
    flips: () => flips,
    subscribe() {
      lease = registry.subscribe(descriptor, listener, lease);
      return lease;
    },
  };
}

async function assertBlockedStability(mounted, client, expectedAttempts) {
  const blocked = mounted.registry.snapshot(mounted.descriptor);
  assert.deepEqual(blocked, {
    status: 'blocked',
    reason: 'authentication-required',
    transitionOwner: 'auth-coordinator',
    data: undefined,
    error: null,
    connection: 'idle',
    freshness: 'unknown',
    answerClass: 'unknown',
    retention: null,
    optimisticPresentation: null,
  });
  const flipsAtBlocked = mounted.flips();
  for (let interval = 0; interval < 1_000; interval += 1) {
    mock.timers.tick(10_000);
    mounted.lease = mounted.registry.subscribe(
      mounted.descriptor,
      mounted.listener,
      mounted.lease,
    );
    assert.strictEqual(
      mounted.registry.snapshot(mounted.descriptor),
      blocked,
      `blocked snapshot identity is stable at interval/render ${interval}`,
    );
  }
  await flush();
  assert.equal(client.state.attempts, expectedAttempts);
  assert.equal(mounted.flips(), flipsAtBlocked, 'blocked state publishes no retry/render flips');
}

test('protected React live resources remain auth-blocked until barrier resume', async (t) => {
  await t.test('store mounted after blank remains visibly blocked while commit is held', async () => {
    const client = fakeClient();
    const mounted = await mount(client, { subscribe: false });
    const gateEntered = deferred();
    const releaseGate = deferred();
    const signingIn = client.transitionAuthority('session', 'login', async () => {
      gateEntered.resolve();
      await releaseGate.promise;
    });
    try {
      await gateEntered.promise;
      mounted.subscribe();
      assert.deepEqual(mounted.registry.snapshot(mounted.descriptor), {
        status: 'blocked',
        reason: 'authentication-not-settled',
        transitionOwner: 'auth-coordinator',
        data: undefined,
        error: null,
        connection: 'idle',
        freshness: 'unknown',
        answerClass: 'unknown',
        retention: null,
        optimisticPresentation: null,
      });
      assert.equal(client.state.attempts, 0, 'held custody starts no live transport');
      releaseGate.resolve();
      await signingIn;
      await flush();
      assert.equal(mounted.registry.snapshot(mounted.descriptor).status, 'ready');
      assert.equal(client.state.attempts, 1);
    } finally {
      releaseGate.resolve();
      await signingIn.catch(() => {});
      mounted.lease?.release();
      await mounted.provider.dispose();
    }
  });

  await t.test('store mounted after terminal loss recovers the terminal classification', async () => {
    const client = fakeClient({ initialAuthority: 'session' });
    const mounted = await mount(client, { subscribe: false });
    try {
      await client.revoke();
      mounted.subscribe();
      const snapshot = mounted.registry.snapshot(mounted.descriptor);
      assert.equal(snapshot.status, 'error');
      assert.equal(snapshot.error?.code, 'SNAPBACK_AUTH_SESSION_REVOKED');
      assert.equal(snapshot.transitionOwner, 'auth-coordinator');
      assert.equal(snapshot.error?.details?.transitionOwner, 'auth-coordinator');
      assert.equal(client.state.attempts, 0, 'terminal authority starts no live transport');
    } finally {
      mounted.lease?.release();
      await mounted.provider.dispose();
    }
  });

  await t.test('registration after staged flush but before public exposure starts from the confirmed successor', async () => {
    const client = fakeClient();
    const mounted = await mount(client, { subscribe: false });
    client.state.afterStagedFlush = () => { mounted.subscribe(); };
    try {
      await client.signIn();
      await flush();
      assert.equal(
        client.state.attempts,
        1,
        'a store registered after the once-only staged callback still starts',
      );
      assert.deepEqual(client.state.authorityCaptures, [{
        authorityEpoch: 1,
        authorityKey: 'authority:session',
        custodyRevision: 2,
      }], 'late registration reuses the exact confirmed successor capture');
      assert.equal(mounted.registry.snapshot(mounted.descriptor).status, 'ready');
    } finally {
      mounted.lease?.release();
      await mounted.provider.dispose();
    }
  });

  await t.test('registration between confirmation and staged flush is included in that flush', async () => {
    const client = fakeClient();
    const mounted = await mount(client, { subscribe: false });
    client.state.beforeStagedFlush = () => { mounted.subscribe(); };
    try {
      await client.signIn();
      await flush();
      assert.equal(client.state.attempts, 1);
      assert.deepEqual(client.state.authorityCaptures, [{
        authorityEpoch: 1,
        authorityKey: 'authority:session',
        custodyRevision: 2,
      }]);
      assert.equal(mounted.registry.snapshot(mounted.descriptor).status, 'ready');
    } finally {
      mounted.lease?.release();
      await mounted.provider.dispose();
    }
  });

  await t.test('registration after signin completion starts from current exposed authority', async () => {
    const client = fakeClient();
    const mounted = await mount(client, { subscribe: false });
    try {
      await client.signIn();
      mounted.subscribe();
      await flush();
      assert.equal(client.state.attempts, 1);
      assert.deepEqual(client.state.authorityCaptures, [{
        authorityEpoch: 1,
        authorityKey: 'authority:session',
        custodyRevision: 2,
      }], 'registration captures and carries the current exposed authority');
      assert.equal(mounted.registry.snapshot(mounted.descriptor).status, 'ready');
    } finally {
      mounted.lease?.release();
      await mounted.provider.dispose();
    }
  });

  await t.test('post-signin unmount and remount re-evaluates the current level without double-starting', async () => {
    const client = fakeClient();
    const mounted = await mount(client);
    try {
      await client.signIn();
      await flush();
      assert.equal(client.state.attempts, 1);

      mounted.lease.release();
      await flush();
      await flush();
      mounted.lease = null;
      mounted.subscribe();
      await flush();
      assert.equal(client.state.attempts, 2, 'remount starts one replacement handle');
      assert.deepEqual(client.state.authorityCaptures, [
        {
          authorityEpoch: 1,
          authorityKey: 'authority:session',
          custodyRevision: 2,
        },
        {
          authorityEpoch: 1,
          authorityKey: 'authority:session',
          custodyRevision: 2,
        },
      ], 'each mount is fenced to the still-current exact capture');

      mounted.subscribe();
      mounted.subscribe();
      await flush();
      assert.equal(client.state.attempts, 2, 're-renders keep one handle for the store');
      assert.equal(mounted.registry.snapshot(mounted.descriptor).status, 'ready');
    } finally {
      mounted.lease?.release();
      await mounted.provider.dispose();
    }
  });

  await t.test('anonymous custody performs zero subscribe attempts across 1,000 intervals/renders', async () => {
    mock.timers.enable({ apis: ['setTimeout'] });
    const client = fakeClient();
    const mounted = await mount(client);
    try {
      await assertBlockedStability(mounted, client, 0);
      await client.signIn();
      await flush();
      const ready = mounted.registry.snapshot(mounted.descriptor);
      assert.equal(client.state.attempts, 1, 'sign-in creates one fresh authority-fenced instance');
      assert.deepEqual(client.state.authorityCaptures, [{
        authorityEpoch: 1,
        authorityKey: 'authority:session',
        custodyRevision: 2,
      }], 'the staged successor capture, but no bearer, reaches live admission');
      assert.equal(ready.status, 'ready');
      assert.deepEqual(ready.data, ROWS);
    } finally {
      mounted.lease.release();
      await mounted.provider.dispose();
      mock.timers.reset();
    }
  });

  await t.test('a raced server AUTH_REQUIRED becomes blocked without entering the retry ladder', async () => {
    mock.timers.enable({ apis: ['setTimeout'] });
    const client = fakeClient({ initialAuthority: 'session', raceToAnonymous: true });
    const mounted = await mount(client);
    try {
      await assertBlockedStability(mounted, client, 1);
      await client.signIn();
      await flush();
      assert.equal(client.state.attempts, 2, 'barrier resume constructs one successor instance');
      assert.equal(mounted.registry.snapshot(mounted.descriptor).status, 'ready');
    } finally {
      mounted.lease.release();
      await mounted.provider.dispose();
      mock.timers.reset();
    }
  });

  await t.test('signin, logout, and signin refresh one mounted consumer through the barrier', async () => {
    const client = fakeClient();
    const mounted = await mount(client);
    const mountedProvider = mounted.provider;
    const mountedLease = mounted.lease;
    try {
      await client.signIn();
      await flush();
      assert.equal(mounted.registry.snapshot(mounted.descriptor).status, 'ready');
      assert.equal(client.state.attempts, 1);

      await client.logout();
      await flush();
      assert.equal(mounted.registry.snapshot(mounted.descriptor).status, 'blocked');
      assert.equal(client.state.attempts, 1, 'logout does not subscribe anonymously');

      await client.signIn();
      await flush();
      assert.strictEqual(mounted.provider, mountedProvider, 'provider was not remounted');
      assert.strictEqual(mounted.lease, mountedLease, 'consumer lease was not remounted');
      assert.equal(mounted.registry.snapshot(mounted.descriptor).status, 'ready');
      assert.equal(client.state.attempts, 2, 'second signin starts one fresh query');
    } finally {
      mounted.lease.release();
      await mounted.provider.dispose();
    }
  });

  await t.test('live query projects the five-state auth settlement matrix', async () => {
    const client = fakeClient();
    const mounted = await mount(client);
    const assertTransitionBlocked = (label) => {
      const snapshot = mounted.registry.snapshot(mounted.descriptor);
      assert.equal(snapshot.status, 'blocked', `${label} is not pending`);
      assert.equal(snapshot.reason, 'authentication-not-settled');
      assert.equal(snapshot.transitionOwner, 'auth-coordinator');
      assert.equal(snapshot.error, null);
    };
    try {
      let snapshot = mounted.registry.snapshot(mounted.descriptor);
      assert.equal(snapshot.status, 'blocked');
      assert.equal(snapshot.reason, 'authentication-required');
      assert.equal(snapshot.transitionOwner, 'auth-coordinator');

      await client.transitionAuthority('session', 'login', () => {
        assertTransitionBlocked('signing-in');
      });
      await flush();
      snapshot = mounted.registry.snapshot(mounted.descriptor);
      assert.equal(snapshot.status, 'ready', 'signed-in projects the successful answer');

      await client.transitionAuthority('anonymous', 'logout', () => {
        assertTransitionBlocked('signing-out');
      });
      await flush();
      snapshot = mounted.registry.snapshot(mounted.descriptor);
      assert.equal(snapshot.status, 'blocked', 'signed-out projects a stable refusal');
      assert.equal(snapshot.reason, 'authentication-required');
      assert.equal(snapshot.transitionOwner, 'auth-coordinator');

      await client.signIn();
      await flush();
      await client.revoke(() => {
        const revoked = mounted.registry.snapshot(mounted.descriptor);
        assert.equal(revoked.status, 'error');
        assert.equal(revoked.error?.code, 'SNAPBACK_AUTH_SESSION_REVOKED');
        assert.equal(revoked.transitionOwner, 'auth-coordinator');
        assert.equal(
          revoked.error?.details?.transitionOwner,
          'auth-coordinator',
        );
      });
      snapshot = mounted.registry.snapshot(mounted.descriptor);
      assert.equal(snapshot.status, 'error', 'revoked remains classified');
      assert.equal(snapshot.error?.code, 'SNAPBACK_AUTH_SESSION_REVOKED');
      assert.equal(snapshot.transitionOwner, 'auth-coordinator');
    } finally {
      mounted.lease.release();
      await mounted.provider.dispose();
    }
  });
});

import assert from 'node:assert/strict';

import { createExternalSessionClient } from './index.mjs';

const USER_ID = '018f0d90-7b12-7a22-8c33-445566778899';
const SESSION_ID = '018f0d90-7b13-7a22-8c33-445566778899';
const INCARNATION = '018f0d90-7b11-7a22-8c33-445566778899';

const handshake = {
  protocolVersion: 1,
  serverStartupNonce: 'startup-lifecycle-disposal',
  authorizationStreamIncarnation: INCARNATION,
  transitionGeneration: 1,
  activeMode: 'sessions',
  desiredMode: 'sessions',
  modeState: 'settled',
  appDataAvailability: 'available',
  quarantineCode: null,
  clientProtocols: {
    authClient: 1,
    authInvalidation: 1,
    authorityDescriptor: 1,
    authorizedLease: null,
  },
  availability: {
    onlineRequestResponse: { available: true, reason: null },
    authScopedLive: {
      available: true,
      minimumAuthInvalidationProtocol: 1,
      reason: null,
    },
    retainedReads: {
      available: false,
      minimumAuthInvalidationProtocol: 1,
      minimumAuthorizedLeaseProtocol: 1,
      reason: 'SNAPBACK_AUTH_RETAINED_READS_UNAVAILABLE',
    },
    queuedReplay: {
      available: true,
      minimumAuthorityDescriptorProtocol: 1,
      reason: null,
    },
  },
  provider: { key: 'email-code', available: true },
  transports: ['bearer'],
  authority: {
    kind: 'humanSession',
    userId: USER_ID,
    sessionId: SESSION_ID,
    isAuthenticated: true,
  },
  authorityDescriptor: {
    descriptorVersion: 1,
    authorityInstanceId: INCARNATION,
    sessionGeneration: 1,
  },
  deploymentIdentity: {
    schemaVersion: 'snapback.v1',
    authMode: 'sessions',
    appId: '018f0d90-7b14-7a22-8c33-445566778899',
    schemaHash: `snapback.v1:sessions:schema:sha256:${'1'.repeat(64)}`,
    bundleHash: `snapback.v1:sessions:function:sha256:${'2'.repeat(64)}`,
    inputsHash: `snapback.v1:sessions:inputs:sha256:${'3'.repeat(64)}`,
  },
  authorizedLease: null,
};

const anonymousHandshake = {
  ...handshake,
  authority: {
    kind: 'anonymous',
    userId: null,
    sessionId: null,
    isAuthenticated: false,
  },
  authorityDescriptor: {
    descriptorVersion: 1,
    authorityInstanceId: INCARNATION,
    sessionGeneration: 0,
  },
};

const diagnosticResponse = (code, message, status = 409) => new Response(
  JSON.stringify({ diagnostic: { code, message } }),
  {
    status,
    headers: { 'content-type': 'application/json' },
  },
);

const createHarness = ({ unsubscribe = 'success' } = {}) => {
  let nextSubscription = 1;
  let unsubscribeCalls = 0;
  const subscriptions = new Set();
  const fetch = async (url, init = {}) => {
    const path = new URL(url).pathname;
    if (path === '/auth/session') {
      const authorization = new Headers(init.headers).get('authorization');
      return Response.json(authorization === null ? anonymousHandshake : handshake);
    }
    if (path === '/connection/open') {
      return Response.json({
        connectionId: 'wire-lifecycle-disposal',
        connectionToken: 'sct-lifecycle-disposal',
        authorizationInvalidation: null,
        wireVersion: 'snapback.v1',
      });
    }
    if (path === '/live/lifecycleTodos/subscribe') {
      const subscriptionId = `sub-lifecycle-${nextSubscription}`;
      nextSubscription += 1;
      subscriptions.add(subscriptionId);
      return Response.json({
        subscription_id: subscriptionId,
        snapshot: { version: 1, rows: [{ _id: 'todo-1' }] },
        permission_epochs: {},
      });
    }
    if (path === '/live/lifecycleTodos/unsubscribe') {
      unsubscribeCalls += 1;
      const body = JSON.parse(init.body);
      if (unsubscribe === 'unknown') {
        subscriptions.delete(body.subscription_id);
        return diagnosticResponse(
          'SNAPBACK_UNKNOWN_SUBSCRIPTION',
          `unknown live subscription ${body.subscription_id}`,
          404,
        );
      }
      if (unsubscribe === 'ownership-mismatch') {
        return diagnosticResponse(
          'SNAPBACK_LIVE_RESUME_OWNERSHIP',
          'live subscription belongs to another authority',
        );
      }
      if (!subscriptions.delete(body.subscription_id)) {
        return diagnosticResponse(
          'SNAPBACK_UNKNOWN_SUBSCRIPTION',
          `unknown live subscription ${body.subscription_id}`,
          404,
        );
      }
      return Response.json({
        subscription_id: body.subscription_id,
        disposed: true,
      });
    }
    throw new Error(`unexpected lifecycle disposal request: ${path}`);
  };
  return {
    fetch,
    get unsubscribeCalls() {
      return unsubscribeCalls;
    },
    retire(subscriptionId) {
      subscriptions.delete(subscriptionId);
    },
  };
};

const withHarness = async (options, run) => {
  const originalFetch = globalThis.fetch;
  const harness = createHarness(options);
  globalThis.fetch = harness.fetch;
  try {
    const client = createExternalSessionClient('http://lifecycle-disposal.test', {
      bearerToken: 'sbs_lifecycle_owner',
    });
    await run({ client, harness });
  } finally {
    globalThis.fetch = originalFetch;
  }
};

const openHandle = (client) => client.liveQuery('lifecycleTodos', {
  connectionId: 'lifecycle-label',
  pollCadenceMs: 60_000,
});

const settleBestEffortCleanup = async () => {
  await Promise.resolve();
  await new Promise((resolve) => setTimeout(resolve, 0));
};

await withHarness({}, async ({ client, harness }) => {
  const handle = await openHandle(client);
  const outcome = await handle.dispose();
  assert.equal(outcome.disposed, true);
  await settleBestEffortCleanup();
  assert.equal(harness.unsubscribeCalls, 1, 'normal dispose retires once');
});

await withHarness({}, async ({ client, harness }) => {
  const handle = await openHandle(client);
  const first = handle.dispose();
  const second = handle.dispose();
  assert.equal(first, second, 'concurrent repeated disposal shares one retirement task');
  await Promise.all([first, second]);
  await settleBestEffortCleanup();
  assert.equal(harness.unsubscribeCalls, 1, 'double dispose has no duplicate server effect');
});

await withHarness({ unsubscribe: 'unknown' }, async ({ client, harness }) => {
  const handle = await openHandle(client);
  await client.replaceBearerToken(null);
  assert.deepEqual(handle.rows, [], 'logout blanks the predecessor rows');
  assert.deepEqual(await handle.pause(), {
    subscription_id: handle.subscriptionId,
    disposed: false,
    alreadyRetired: true,
    retirementCode: 'SNAPBACK_LIVE_SUBSCRIPTION_ALREADY_RETIRED',
  });
  assert.deepEqual(await handle.dispose(), {
    subscription_id: handle.subscriptionId,
    disposed: false,
    alreadyRetired: true,
    retirementCode: 'SNAPBACK_LIVE_SUBSCRIPTION_ALREADY_RETIRED',
  });
  await settleBestEffortCleanup();
  assert.equal(
    harness.unsubscribeCalls,
    1,
    'logout accepts the handle generation as already retired and dispose does not retry it',
  );
});

await withHarness({}, async ({ client, harness }) => {
  const handle = await openHandle(client);
  harness.retire(handle.subscriptionId);
  const revocation = new Error(
    'SNAPBACK_AUTH_SESSION_REVOKED: the live authority was revoked',
  );
  revocation.code = 'SNAPBACK_AUTH_SESSION_REVOKED';
  revocation.diagnostic = {
    code: revocation.code,
    message: 'the live authority was revoked',
  };
  revocation.authorityDisposition = 'durableDelete';
  const terminal = client.handleTerminalAuthLoss(null, revocation);
  await terminal.settlement;
  assert.deepEqual(await handle.dispose(), {
    subscription_id: handle.subscriptionId,
    disposed: false,
    alreadyRetired: true,
    retirementCode: 'SNAPBACK_LIVE_SUBSCRIPTION_ALREADY_RETIRED',
  });
  await settleBestEffortCleanup();
  assert.equal(
    harness.unsubscribeCalls,
    0,
    'authority revocation owns retirement and later dispose is local-only',
  );
});

// 0137 A6 f3: a terminal auth loss (e.g. SNAPBACK_AUTH_STREAM_RESET after a
// receipted reset-install) previously surfaced only as a thrown code out of
// whatever op a consumer awaited next. The client now projects the fact:
// authTerminalStatus() flips to terminated at the cut, subscribeAuthTerminal
// fires at the transition, and an explicit custody replacement clears both.
// The authority posture is untouched — this is observation only.
await withHarness({}, async ({ client, harness }) => {
  const handle = await openHandle(client);
  harness.retire(handle.subscriptionId);
  assert.deepEqual(
    client.authTerminalStatus(),
    { terminated: false, code: null, authorityDisposition: null, atMs: null },
    'a live client projects a non-terminal fact',
  );
  let notifications = 0;
  const unsubscribe = client.subscribeAuthTerminal(() => { notifications += 1; });
  const reset = new Error(
    'SNAPBACK_AUTH_STREAM_RESET: the pre-reset world was retired',
  );
  reset.code = 'SNAPBACK_AUTH_STREAM_RESET';
  reset.diagnostic = { code: reset.code, message: 'the pre-reset world was retired' };
  reset.authorityDisposition = 'durableDelete';
  const terminal = client.handleTerminalAuthLoss(null, reset);
  await terminal.settlement;
  const status = client.authTerminalStatus();
  assert.equal(status.terminated, true, 'the cut records a terminal fact');
  assert.equal(status.code, 'SNAPBACK_AUTH_STREAM_RESET');
  assert.equal(status.authorityDisposition, 'durableDelete');
  assert.ok(Number.isFinite(status.atMs), 'the fact carries its recording time');
  assert.equal(notifications, 1, 'the terminal transition notifies exactly once');
  assert.throws(
    () => { client.authTerminalStatus().terminated = false; },
    TypeError,
    'the projected fact is frozen',
  );
  // A repeated identical loss is not a new transition.
  client.handleTerminalAuthLoss(null, reset);
  assert.equal(notifications, 1, 'repeat identical losses do not re-notify');
  // The explicit custody replacement is the rebuild path: it clears the
  // fact and notifies so rigs re-render from authTerminalStatus().
  await client.replaceBearerToken(null);
  assert.equal(client.authTerminalStatus().terminated, false, 'custody replacement clears the fact');
  assert.equal(notifications, 2, 'the clear is an observable transition');
  unsubscribe();
  await settleBestEffortCleanup();
});

await withHarness({ unsubscribe: 'ownership-mismatch' }, async ({ client }) => {
  const handle = await openHandle(client);
  await assert.rejects(
    () => handle.pause(),
    (error) => error?.diagnostic?.code === 'SNAPBACK_LIVE_RESUME_OWNERSHIP',
    'an ownership mismatch is never reclassified as already retired',
  );
  await assert.rejects(
    handle.dispose(),
    (error) => error?.diagnostic?.code === 'SNAPBACK_LIVE_RESUME_OWNERSHIP',
    'explicit disposal preserves a genuine ownership mismatch',
  );
  await settleBestEffortCleanup();
});

await withHarness({ unsubscribe: 'unknown' }, async ({ client }) => {
  const handle = await openHandle(client);
  assert.throws(
    () => {
      handle.subscriptionId = 'sub-foreign-injected';
    },
    TypeError,
    'the authoritative handle generation is read-only',
  );
  assert.match(handle.subscriptionId, /^sub-lifecycle-/u);
  const outcome = await handle.dispose();
  assert.equal(outcome.subscription_id, handle.subscriptionId);
});

await withHarness({ unsubscribe: 'ownership-mismatch' }, async ({ client }) => {
  await assert.rejects(
    () => client.unsubscribeLive('lifecycleTodos', {
      subscriptionId: 'sub-foreign',
      connectionId: 'lifecycle-label',
    }),
    (error) => error?.diagnostic?.code === 'SNAPBACK_LIVE_RESUME_OWNERSHIP',
    'a foreign public unsubscribe remains fail-closed',
  );
});

console.log('snapback-client lifecycle disposal tests: ok');

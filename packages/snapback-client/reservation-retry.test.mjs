import assert from 'node:assert/strict';

import { SnapbackClient } from './index.mjs';

const originalFetch = globalThis.fetch;
const SESSION_USER_ID = '018f0d90-7b12-7a22-8c33-445566778899';
const SESSION_ID = '018f0d90-7b13-7a22-8c33-445566778899';
const SESSION_INCARNATION = '018f0d90-7b11-7a22-8c33-445566778899';
const sessionHandshake = {
  protocolVersion: 1,
  serverStartupNonce: 'startup-reservation-retry',
  authorizationStreamIncarnation: SESSION_INCARNATION,
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
    userId: SESSION_USER_ID,
    sessionId: SESSION_ID,
    isAuthenticated: true,
  },
  authorityDescriptor: {
    descriptorVersion: 1,
    authorityInstanceId: SESSION_INCARNATION,
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
const stale = ({
  status = 409,
  details = {
    retryable: true,
    retryStrategy: 'short-jitter',
    effectCommitted: false,
  },
} = {}) => Response.json({
  diagnostic: {
    code: 'SNAPBACK_AUTH_RESERVATION_STALE',
    message: 'authorization reservation changed before commit',
    details,
  },
}, { status });

const client = (options = {}) => new SnapbackClient('https://snapback.test', {
  reservationRetryJitterMilliseconds: [0, 0],
  rqsStore: null,
  __outboxDrainLifecycle: false,
  ...options,
});

try {
  {
    const requests = [];
    const responses = [stale(), Response.json({
      result: { sent: true },
      receipt: { kind: 'mutation', outcome: 'CONFIRMED', mutationId: 'mut-1' },
    })];
    globalThis.fetch = async (_url, init) => {
      requests.push(JSON.parse(init.body));
      return responses.shift();
    };
    const diagnostics = [];
    const subject = client({
      onReservationRetryDiagnostic: (diagnostic) => diagnostics.push(diagnostic),
    });
    const result = await subject.mutate('sendMessage', {
      args: { body: 'hello' },
      clientMutationId: 'client-mut-1',
      queue: false,
    });
    assert.equal(result.result.sent, true);
    assert.equal(requests.length, 2);
    assert.deepEqual(requests[0], requests[1], 'the complete operation retries unchanged');
    assert.deepEqual(
      diagnostics.map(({ code, outcome }) => ({ code, outcome })),
      [
        {
          code: 'SNAPBACK_AUTH_RESERVATION_RETRY_SCHEDULED',
          outcome: 'effect-free-refusal',
        },
        {
          code: 'SNAPBACK_AUTH_RESERVATION_RETRY_SETTLED',
          outcome: 'settled',
        },
      ],
    );
    assert.equal(diagnostics[0].attempt, 1);
    assert.equal(diagnostics[0].nextAttempt, 2);
    assert.equal(diagnostics[0].effectCommitted, false);
    assert.equal(diagnostics[1].attempts, 2);
    assert.deepEqual(subject.reservationRetryDiagnostics(), diagnostics);
    assert.equal(subject.receipts().length, 1, 'only the confirmed attempt records a receipt');
  }

  {
    const mutationBearers = [];
    let transition = null;
    globalThis.fetch = async (url, init = {}) => {
      const path = new URL(url).pathname;
      if (path === '/auth/session') return Response.json(sessionHandshake);
      if (path === '/mutation/writeAsCapturedUser') {
        mutationBearers.push(new Headers(init.headers).get('authorization'));
        return stale();
      }
      throw new Error(`unexpected authority-pinning request: ${path}`);
    };
    let subject;
    subject = new SnapbackClient('https://snapback.test', {
      bearerToken: 'bearer-A',
      authClientProtocol: 1,
      authInvalidationProtocol: 1,
      reservationRetryJitterMilliseconds: [0, 0],
      rqsStore: null,
      __outboxDrainLifecycle: false,
      onReservationRetryDiagnostic: (diagnostic) => {
        if (diagnostic.outcome === 'effect-free-refusal') {
          transition = subject.replaceBearerToken('bearer-B');
        }
      },
    });
    await assert.rejects(
      subject.mutate('writeAsCapturedUser', { args: { owner: 'A' }, queue: false }),
      (error) => error?.code === 'SNAPBACK_CLIENT_AUTHORITY_STALE',
      'a retry must fail closed when its external bearer generation changes',
    );
    await transition;
    assert.deepEqual(
      mutationBearers,
      ['Bearer bearer-A'],
      'predecessor intent is never replayed under the successor bearer',
    );
    assert.equal(subject.bearerToken, 'bearer-B');
  }

  {
    let requests = 0;
    globalThis.fetch = async () => {
      requests += 1;
      return stale();
    };
    const subject = client({ reservationRetryMaxAttempts: 3 });
    await assert.rejects(
      subject.mutate('exhausted', { queue: false }),
      (error) => error?.diagnostic?.code === 'SNAPBACK_AUTH_RESERVATION_STALE',
    );
    assert.equal(requests, 3);
    assert.equal(
      subject.reservationRetryDiagnostics().at(-1)?.code,
      'SNAPBACK_AUTH_RESERVATION_RETRY_EXHAUSTED',
    );
    assert.equal(subject.reservationRetryDiagnostics().at(-1)?.attempts, 3);
  }

  for (const refusal of [
    stale({ status: 503 }),
    stale({ details: { retryable: true, retryStrategy: 'short-jitter' } }),
    stale({
      details: {
        retryable: true,
        retryStrategy: 'short-jitter',
        effectCommitted: true,
      },
    }),
    stale({
      details: {
        retryable: true,
        retryStrategy: 'application-idempotency',
        effectCommitted: false,
      },
    }),
    stale({
      details: {
        retryable: true,
        retryStrategy: 'short-jitter',
        effectCommitted: false,
        effectMayHaveCommitted: true,
      },
    }),
  ]) {
    let requests = 0;
    globalThis.fetch = async () => {
      requests += 1;
      return requests === 1 ? refusal : Response.json({ result: 'must-not-run' });
    };
    const subject = client();
    await assert.rejects(subject.mutate('notRetryable', { queue: false }));
    assert.equal(requests, 1, 'non-exact or ambiguous refusal is never retried');
    assert.deepEqual(subject.reservationRetryDiagnostics(), []);
  }

  assert.throws(
    () => client({ reservationRetryMaxAttempts: 0 }),
    /reservationRetryMaxAttempts/u,
  );
  assert.throws(
    () => client({ reservationRetryJitterMilliseconds: [10, 5] }),
    /reservationRetryJitterMilliseconds/u,
  );
} finally {
  globalThis.fetch = originalFetch;
}

console.log('snapback client effect-free authorization reservation retry tests pass');

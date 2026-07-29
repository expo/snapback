import assert from 'node:assert/strict';

import { SnapbackClient } from './index.mjs';

const originalFetch = globalThis.fetch;
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
    let requests = 0;
    globalThis.fetch = async () => {
      requests += 1;
      return stale();
    };
    const subject = client({ reservationRetryMaxAttempts: 3 });
    await assert.rejects(
      subject.mutate('exhausted'),
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
  ]) {
    let requests = 0;
    globalThis.fetch = async () => {
      requests += 1;
      return requests === 1 ? refusal : Response.json({ result: 'must-not-run' });
    };
    const subject = client();
    await assert.rejects(subject.mutate('notRetryable'));
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

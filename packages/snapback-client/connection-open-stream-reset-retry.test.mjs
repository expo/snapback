import assert from 'node:assert/strict';

import { SnapbackClient } from './index.mjs';

const retryableStreamReset = (message = 'the authorization stream is no longer current') => (
  Response.json({
    diagnostic: {
      code: 'SNAPBACK_AUTH_STREAM_RESET',
      message,
      details: {
        authorityDisposition: 'carrier',
        retryable: true,
        cause: 'stream_replaced',
      },
    },
  }, { status: 401 })
);

const streamResetWithoutRetryHint = () => Response.json({
  diagnostic: {
    code: 'SNAPBACK_AUTH_STREAM_RESET',
    message: 'the authorization stream is no longer current',
    details: {
      authorityDisposition: 'carrier',
      cause: 'stream_replaced',
    },
  },
}, { status: 401 });

const granted = (connectionId, connectionToken) => Response.json({
  connectionId,
  connectionToken,
  wireVersion: 'snapback.v1',
});

const withFetch = async (fetch, run) => {
  const originalFetch = globalThis.fetch;
  globalThis.fetch = fetch;
  try {
    await run();
  } finally {
    globalThis.fetch = originalFetch;
  }
};

{
  let openAttempts = 0;
  await withFetch(async (url, init = {}) => {
    assert.equal(new URL(url).pathname, '/connection/open');
    assert.equal(init.method, 'POST');
    const connectionId = JSON.parse(init.body).connectionId;
    openAttempts += 1;
    return openAttempts === 1
      ? retryableStreamReset()
      : granted(connectionId, 'sct_retry_success');
  }, async () => {
    const client = new SnapbackClient('https://stream-reset-open-success.test', {
      rqsStore: null,
    });
    const grant = await client.connectionGrant('open-success');
    assert.equal(grant.token, 'sct_retry_success');
    assert.equal(openAttempts, 2, 'retryable refusal gets one internal open retry');
  });
}

{
  let openAttempts = 0;
  await withFetch(async (url, init = {}) => {
    assert.equal(new URL(url).pathname, '/connection/open');
    assert.equal(init.method, 'POST');
    openAttempts += 1;
    return streamResetWithoutRetryHint();
  }, async () => {
    const client = new SnapbackClient('https://stream-reset-open-untyped.test', {
      rqsStore: null,
    });
    await assert.rejects(
      client.connectionGrant('open-untyped'),
      (error) => error.status === 401
        && error.diagnostic?.code === 'SNAPBACK_AUTH_STREAM_RESET',
    );
    assert.equal(openAttempts, 1, 'an untyped stream reset is not retried');
  });
}

{
  let openAttempts = 0;
  await withFetch(async (url, init = {}) => {
    assert.equal(new URL(url).pathname, '/connection/open');
    assert.equal(init.method, 'POST');
    openAttempts += 1;
    return retryableStreamReset(`stream reset attempt ${openAttempts}`);
  }, async () => {
    const client = new SnapbackClient('https://stream-reset-open-bounded.test', {
      rqsStore: null,
    });
    await assert.rejects(
      client.connectionGrant('open-bounded'),
      (error) => error.status === 401
        && error.diagnostic?.message === 'stream reset attempt 2',
    );
    assert.equal(openAttempts, 2, 'a second retryable refusal surfaces unchanged');
  });
}

{
  let openAttempts = 0;
  let operationAttempts = 0;
  await withFetch(async (url, init = {}) => {
    const path = new URL(url).pathname;
    if (path === '/connection/open') {
      openAttempts += 1;
      const body = JSON.parse(init.body);
      if (openAttempts === 2) {
        assert.equal(body.previousToken, 'sct_operation_1');
      }
      return granted(body.connectionId, `sct_operation_${openAttempts}`);
    }
    if (path.startsWith('/outbox/')) {
      operationAttempts += 1;
      assert.equal(
        new Headers(init.headers).get('x-snapback-connection-token'),
        `sct_operation_${operationAttempts}`,
      );
      return operationAttempts === 1 ? retryableStreamReset() : Response.json([]);
    }
    throw new Error(`unexpected request: ${init.method} ${url}`);
  }, async () => {
    const client = new SnapbackClient('https://stream-reset-operation.test', {
      rqsStore: null,
    });
    assert.deepEqual(await client.drainEnvelopes('operation-retry'), []);
    assert.equal(openAttempts, 2, 'the operation refusal refreshes the grant once');
    assert.equal(operationAttempts, 2, 'the connection-scoped operation runs twice');
  });
}

console.log('snapback-client connection-open stream-reset retry tests passed');

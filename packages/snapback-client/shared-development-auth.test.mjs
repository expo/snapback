import assert from 'node:assert/strict';
import test from 'node:test';

import {
  SHARED_DEVELOPMENT_AUTH_ROUTES,
  createSharedDevelopmentVerifier,
  readSharedDevelopmentCallback,
  redeemSharedDevelopmentAuth,
  sharedDevelopmentAuthorizationUrl,
  startSharedDevelopmentAuth,
} from './shared-development-auth.mjs';

const start = Object.freeze({
  transactionId: 'sat_1',
  state: 'sas_1',
  authorizationPath: `${SHARED_DEVELOPMENT_AUTH_ROUTES.authorize}?transaction=sat_1`,
  expiresAt: '2026-08-24T00:05:00.000Z',
});

test('the verifier is client-held and its challenge is the SHA-256 of it', async () => {
  const first = await createSharedDevelopmentVerifier();
  const second = await createSharedDevelopmentVerifier();
  assert.match(first.verifier, /^[A-Za-z0-9_-]{43,128}$/u);
  assert.match(first.codeChallenge, /^[A-Za-z0-9_-]{43}$/u);
  assert.notEqual(first.verifier, second.verifier);
  const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(first.verifier));
  const expected = btoa(String.fromCharCode(...new Uint8Array(digest)))
    .replaceAll('+', '-').replaceAll('/', '_').replaceAll('=', '');
  assert.equal(first.codeChallenge, expected);
});

test('verifier generation refuses rather than weakening when WebCrypto is absent', async () => {
  await assert.rejects(
    createSharedDevelopmentVerifier({ getRandomValues: () => new Uint8Array(48) }),
    (error) => error.code === 'SNAPBACK_AUTH_SHARED_DEVELOPMENT_REFUSED'
      && error.reason === 'webcrypto-unavailable',
  );
});

test('an authorization URL outside the broker origin is refused', () => {
  assert.equal(
    sharedDevelopmentAuthorizationUrl('http://127.0.0.1:3777', start),
    'http://127.0.0.1:3777/v1/shared/authorize?transaction=sat_1',
  );
  for (const path of ['https://evil.example/v1/shared/authorize', '/v1/other/authorize']) {
    assert.throws(
      () => sharedDevelopmentAuthorizationUrl('http://127.0.0.1:3777', { ...start, authorizationPath: path }),
      (error) => error.reason === 'authorization-url-invalid',
      path,
    );
  }
});

test('the callback carries only state and a code, and state must match', () => {
  const { code } = readSharedDevelopmentCallback('snapback://auth/shared?code=sac_1&state=sas_1', start);
  assert.equal(code, 'sac_1');
  assert.throws(
    () => readSharedDevelopmentCallback('snapback://auth/shared?code=sac_1&state=other', start),
    (error) => error.reason === 'callback-state-mismatch',
  );
  assert.throws(
    () => readSharedDevelopmentCallback('snapback://auth/shared?state=sas_1', start),
    (error) => error.reason === 'callback-code-missing',
  );
});

test('start posts the challenge and never the verifier', async () => {
  const { verifier, codeChallenge } = await createSharedDevelopmentVerifier();
  let seen = null;
  await startSharedDevelopmentAuth('http://broker.invalid', {
    appId: 'app-1',
    provider: 'apple',
    returnTo: 'snapback://auth/shared',
    codeChallenge,
  }, {
    fetchImpl: (url, init) => {
      seen = { url, body: init.body };
      return Promise.resolve(new Response(JSON.stringify(start), { status: 200 }));
    },
  });
  assert.equal(seen.url, 'http://broker.invalid/v1/shared/start');
  assert.equal(seen.body.includes(codeChallenge), true);
  assert.equal(seen.body.includes(verifier), false, 'the verifier must never reach the broker at start');
});

test('a broker refusal keeps its reason instead of becoming a generic error', async () => {
  await assert.rejects(
    redeemSharedDevelopmentAuth('http://broker.invalid', {
      appId: 'app-1',
      code: 'sac_1',
      verifier: 'v',
    }, {
      fetchImpl: () => Promise.resolve(new Response(JSON.stringify({
        diagnostic: {
          code: 'SNAPBACK_AUTH_SHARED_DEVELOPMENT_REFUSED',
          message: 'shared development auth redemption verifier does not match',
          details: { reason: 'verifier-mismatch' },
        },
      }), { status: 400 })),
    }),
    (error) => error.reason === 'verifier-mismatch',
  );
});

test('a silent broker times out with a stable reason', async () => {
  await assert.rejects(
    startSharedDevelopmentAuth('http://broker.invalid', {}, {
      timeoutMs: 5,
      fetchImpl: (_url, init) => new Promise((_resolve, reject) => {
        init.signal.addEventListener('abort', () => reject(init.signal.reason));
      }),
    }),
    (error) => error.reason === 'broker-timeout',
  );
});

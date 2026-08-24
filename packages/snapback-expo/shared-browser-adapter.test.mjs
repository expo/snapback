import assert from 'node:assert/strict';
import test from 'node:test';

import {
  createSharedBrowserAdapter,
  resolveExpoSharedBrowserModules,
  selectSharedAuthReturnTarget,
} from './shared-browser-adapter.mjs';

const APP_ID = 'app-expo-fixture';
const ORIGIN = 'http://127.0.0.1:4300';
const RETURN_TO = 'exp://127.0.0.1:8081/--/auth/shared';

const projection = Object.freeze({
  format: 'snapback.shared-development-auth-projection.v1',
  available: true,
  origin: ORIGIN,
  returnTargets: Object.freeze([
    RETURN_TO,
    'exp://localhost:8081/--/auth/shared',
    'http://127.0.0.1:8081/auth/shared',
  ]),
  routes: {
    start: '/v1/shared/start',
    authorize: '/v1/shared/authorize',
    complete: '/v1/shared/complete',
    redeem: '/v1/shared/redeem',
  },
  identityRealm: 'rehearsal',
  userLimit: 100,
});

/// A supervisor stand-in that keeps the verifier honest: it stores the
/// challenge at start and only redeems a verifier whose digest matches.
function fakeSupervisor({ redeemBody = null } = {}) {
  const calls = [];
  let stored = null;
  const fetchImpl = async (url, init) => {
    const target = new URL(url);
    const body = JSON.parse(init.body);
    calls.push({ path: target.pathname, body });
    if (target.pathname === '/v1/shared/start') {
      stored = body;
      return Response.json({
        transactionId: 'sat_1',
        state: 'sas_1',
        authorizationPath: '/v1/shared/authorize?transaction=sat_1',
        expiresAt: '2026-08-24T00:05:00.000Z',
      });
    }
    const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(body.verifier));
    const challenge = btoa(String.fromCharCode(...new Uint8Array(digest)))
      .replaceAll('+', '-').replaceAll('/', '_').replaceAll('=', '');
    if (challenge !== stored.codeChallenge) {
      return Response.json({
        diagnostic: { message: 'verifier mismatch', details: { reason: 'verifier-mismatch' } },
      }, { status: 400 });
    }
    return Response.json(redeemBody ?? {
      exchange: { challengeId: 'challenge-1', code: 'external-code-1' },
      entry: {
        provider: 'apple',
        adapter: 'snapback-shared-browser',
        identityRealm: 'rehearsal',
        providerInstallationId: `shared-development:${APP_ID}:apple:v1`,
      },
    });
  };
  return { calls, fetchImpl, get stored() { return stored; } };
}

function adapter({ supervisor, openAuthSession, createUrl = () => RETURN_TO } = {}) {
  const originalFetch = globalThis.fetch;
  globalThis.fetch = supervisor.fetchImpl;
  const restore = () => { globalThis.fetch = originalFetch; };
  return {
    restore,
    signIn: createSharedBrowserAdapter({
      projection,
      appId: APP_ID,
      openAuthSession,
      createUrl,
    }),
  };
}

test('the Adapter returns exactly the short-lived external completion', async () => {
  const supervisor = fakeSupervisor();
  let openedWith = null;
  const { signIn, restore } = adapter({
    supervisor,
    openAuthSession: (url, returnTo) => {
      openedWith = { url, returnTo };
      return Promise.resolve({ type: 'success', url: `${returnTo}?code=sac_1&state=sas_1` });
    },
  });
  try {
    const result = await signIn({ provider: 'apple' });
    assert.deepEqual(Object.keys(result), ['exchange']);
    assert.deepEqual(result.exchange, { challengeId: 'challenge-1', code: 'external-code-1' });
    assert.equal(openedWith.url, `${ORIGIN}/v1/shared/authorize?transaction=sat_1`);
    assert.equal(openedWith.returnTo, RETURN_TO);
    // The verifier never reaches the broker at start, only at redemption.
    assert.equal(JSON.stringify(supervisor.calls[0].body).includes('verifier'), false);
    assert.equal(typeof supervisor.calls[1].body.verifier, 'string');
    assert.notEqual(supervisor.calls[1].body.verifier, supervisor.stored.codeChallenge);
  } finally {
    restore();
  }
});

test('a mismatched callback state refuses before redemption', async () => {
  const supervisor = fakeSupervisor();
  const { signIn, restore } = adapter({
    supervisor,
    openAuthSession: (_url, returnTo) => Promise.resolve({
      type: 'success',
      url: `${returnTo}?code=sac_1&state=forged`,
    }),
  });
  try {
    await assert.rejects(
      signIn({ provider: 'apple' }),
      (error) => error.reason === 'callback-state-mismatch',
    );
    assert.deepEqual(supervisor.calls.map(({ path }) => path), ['/v1/shared/start']);
  } finally {
    restore();
  }
});

test('cancellation is the result of the attempt, not a retry', async () => {
  for (const type of ['cancel', 'dismiss']) {
    const supervisor = fakeSupervisor();
    const { signIn, restore } = adapter({
      supervisor,
      openAuthSession: () => Promise.resolve({ type }),
    });
    try {
      await assert.rejects(
        signIn({ provider: 'google' }),
        (error) => error.reason === 'user-cancelled',
        type,
      );
      assert.equal(supervisor.calls.length, 1);
    } finally {
      restore();
    }
  }
});

test('a completion without an external exchange refuses', async () => {
  const supervisor = fakeSupervisor({ redeemBody: { entry: { provider: 'apple' } } });
  const { signIn, restore } = adapter({
    supervisor,
    openAuthSession: (_url, returnTo) => Promise.resolve({
      type: 'success',
      url: `${returnTo}?code=sac_1&state=sas_1`,
    }),
  });
  try {
    await assert.rejects(
      signIn({ provider: 'apple' }),
      (error) => error.reason === 'completion-invalid',
    );
  } finally {
    restore();
  }
});

test('only a supervisor-allowlisted return target is used', () => {
  assert.equal(selectSharedAuthReturnTarget(projection, RETURN_TO), RETURN_TO);
  for (const created of ['exp://192.168.1.5:8081/--/auth/shared', 'myapp://auth/shared', undefined]) {
    assert.throws(
      () => selectSharedAuthReturnTarget(projection, created),
      (error) => error.reason === 'return-target-not-allowlisted',
      String(created),
    );
  }
  assert.throws(
    () => selectSharedAuthReturnTarget({ returnTargets: [] }, RETURN_TO),
    (error) => error.reason === 'return-target-missing',
  );
});

test('an unavailable projection or missing Expo module refuses at construction', () => {
  assert.throws(
    () => createSharedBrowserAdapter({
      projection: { available: false, reason: 'deployment-not-admitted:production' },
      appId: APP_ID,
      openAuthSession: () => {},
      createUrl: () => RETURN_TO,
    }),
    (error) => error.reason === 'projection-unavailable',
  );
  assert.throws(
    () => createSharedBrowserAdapter({ projection, appId: APP_ID }),
    (error) => error.reason === 'expo-modules-unavailable',
  );
});

test('absent Expo modules resolve to null rather than failing the boot', async () => {
  assert.equal(await resolveExpoSharedBrowserModules(() => Promise.reject(new Error('not installed'))), null);
  assert.equal(await resolveExpoSharedBrowserModules(() => Promise.resolve({})), null);
  const resolved = await resolveExpoSharedBrowserModules((specifier) => Promise.resolve(
    specifier === 'expo-web-browser'
      ? { openAuthSessionAsync: () => 'opened' }
      : { createURL: () => 'created' },
  ));
  assert.equal(resolved.openAuthSession(), 'opened');
  assert.equal(resolved.createUrl(), 'created');
});

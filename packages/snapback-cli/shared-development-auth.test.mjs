import assert from 'node:assert/strict';
import test from 'node:test';

import { createSharedDevelopmentVerifier } from '@expo/snapback-client/shared-development-auth';

import {
  createSharedDevelopmentAuth,
  sharedDevelopmentAuthAdmitted,
  sharedDevelopmentIdentityKey,
  sharedDevelopmentRehearsalIdentity,
} from './shared-development-auth.mjs';

const APP_ID = 'app-1';
const RETURN_TO = 'snapback://auth/shared';

function broker(overrides = {}) {
  const completions = [];
  const instance = createSharedDevelopmentAuth({
    appId: APP_ID,
    returnTargets: [RETURN_TO],
    identityFor: (provider) => sharedDevelopmentRehearsalIdentity(provider, { appId: APP_ID }),
    completeIdentity: (identity) => {
      completions.push(identity);
      return Promise.resolve({ completed: identity.subject });
    },
    ...overrides,
  });
  return { instance, completions };
}

async function transaction(instance, provider = 'apple') {
  const { verifier, codeChallenge } = await createSharedDevelopmentVerifier();
  const started = instance.start({ appId: APP_ID, provider, returnTo: RETURN_TO, codeChallenge });
  const location = new URL(instance.authorize(started.transactionId));
  return { verifier, started, location };
}

test('admission reads server-held state, never a client claim', () => {
  const nowMs = Date.parse('2026-08-24T00:00:00.000Z');
  assert.equal(sharedDevelopmentAuthAdmitted({ allowSharedDevelopment: false }, nowMs), false);
  assert.equal(sharedDevelopmentAuthAdmitted({ allowSharedDevelopment: true }, nowMs), true);
  for (const deploymentProfile of ['staging', 'production']) {
    assert.equal(
      sharedDevelopmentAuthAdmitted({ allowSharedDevelopment: true, deploymentProfile }, nowMs),
      false,
      deploymentProfile,
    );
  }
  // A preview needs owner authorization and an unexpired window, both held here.
  assert.equal(sharedDevelopmentAuthAdmitted({
    allowSharedDevelopment: true,
    deploymentProfile: 'preview',
  }, nowMs), false);
  assert.equal(sharedDevelopmentAuthAdmitted({
    allowSharedDevelopment: true,
    deploymentProfile: 'preview',
    previewOwnerAuthenticated: true,
    previewExpiresAt: '2026-08-23T23:59:59.000Z',
  }, nowMs), false);
  assert.equal(sharedDevelopmentAuthAdmitted({
    allowSharedDevelopment: true,
    deploymentProfile: 'preview',
    previewOwnerAuthenticated: true,
    previewExpiresAt: '2026-08-24T01:00:00.000Z',
  }, nowMs), true);
});

test('the callback carries only state and a one-use code', async () => {
  const { instance } = broker();
  const { started, location } = await transaction(instance);
  // `snapback:` is a non-special scheme, so compare the serialization rather
  // than an origin the URL parser reports as null.
  assert.equal(location.toString().startsWith('snapback://auth/shared?'), true, location.toString());
  assert.deepEqual([...location.searchParams.keys()].sort(), ['code', 'state']);
  assert.equal(location.searchParams.get('state'), started.state);
  assert.match(location.searchParams.get('code'), /^sac_/u);
  // No provider token and no Snapback session credential crosses the URL.
  assert.equal(location.toString().includes('token'), false);
});

test('redemption requires the client-held verifier', async () => {
  const { instance, completions } = broker();
  const { verifier, location } = await transaction(instance);
  const code = location.searchParams.get('code');
  await assert.rejects(
    instance.redeem({ appId: APP_ID, code, verifier: 'wrong-verifier' }),
    (error) => error.reason === 'verifier-mismatch',
  );
  // The failed attempt already consumed the code: a replay finds nothing.
  await assert.rejects(
    instance.redeem({ appId: APP_ID, code, verifier }),
    (error) => error.reason === 'completion-code-unavailable',
  );
  assert.deepEqual(completions, []);
});

test('a correct redemption completes once and never twice', async () => {
  const { instance, completions } = broker();
  const { verifier, location } = await transaction(instance);
  const code = location.searchParams.get('code');
  const result = await instance.redeem({ appId: APP_ID, code, verifier });
  assert.equal(typeof result.completed, 'string');
  assert.equal(completions.length, 1);
  await assert.rejects(
    instance.redeem({ appId: APP_ID, code, verifier }),
    (error) => error.reason === 'completion-code-unavailable',
  );
});

test('return targets are allowlisted by exact string', async () => {
  const { instance } = broker();
  const { codeChallenge } = await createSharedDevelopmentVerifier();
  for (const returnTo of [
    'snapback://auth/shared/extra',
    'snapback://auth/other',
    'https://evil.example/auth/shared',
  ]) {
    assert.throws(
      () => instance.start({ appId: APP_ID, provider: 'apple', returnTo, codeChallenge }),
      (error) => error.reason === 'return-target-not-allowlisted',
      returnTo,
    );
  }
});

test('the app binding and the provider name are both fixed', async () => {
  const { instance } = broker();
  const { verifier, codeChallenge } = await createSharedDevelopmentVerifier();
  assert.throws(
    () => instance.start({ appId: 'other-app', provider: 'apple', returnTo: RETURN_TO, codeChallenge }),
    (error) => error.reason === 'app-binding-mismatch',
  );
  assert.throws(
    () => instance.start({ appId: APP_ID, provider: 'github', returnTo: RETURN_TO, codeChallenge }),
    (error) => error.reason === 'provider-unsupported',
  );
  const { location } = await transaction(instance);
  await assert.rejects(
    instance.redeem({ appId: 'other-app', code: location.searchParams.get('code'), verifier }),
    (error) => error.reason === 'app-binding-mismatch',
  );
});

test('a weak or absent code challenge is refused', async () => {
  const { instance } = broker();
  for (const codeChallenge of [undefined, '', 'short', 'a'.repeat(200), 'has spaces in it'.repeat(4)]) {
    assert.throws(
      () => instance.start({ appId: APP_ID, provider: 'apple', returnTo: RETURN_TO, codeChallenge }),
      (error) => error.reason === 'code-challenge-invalid',
      String(codeChallenge),
    );
  }
});

test('transactions and completion codes expire', async () => {
  let clock = 1_000;
  const { instance } = broker({ now: () => clock, transactionTtlMs: 100, completionTtlMs: 50 });
  const { codeChallenge } = await createSharedDevelopmentVerifier();
  const started = instance.start({ appId: APP_ID, provider: 'apple', returnTo: RETURN_TO, codeChallenge });
  clock += 101;
  assert.throws(
    () => instance.authorize(started.transactionId),
    (error) => error.reason === 'transaction-unavailable',
  );

  clock = 5_000;
  const second = await createSharedDevelopmentVerifier();
  const live = instance.start({
    appId: APP_ID, provider: 'apple', returnTo: RETURN_TO, codeChallenge: second.codeChallenge,
  });
  const code = new URL(instance.authorize(live.transactionId)).searchParams.get('code');
  clock += 51;
  await assert.rejects(
    instance.redeem({ appId: APP_ID, code, verifier: second.verifier }),
    (error) => error.reason === 'completion-code-unavailable',
  );
});

test('the shared development user cap is enforced by the broker', async () => {
  let seed = 0;
  const { instance } = broker({
    userLimit: 2,
    identityFor: (provider) => sharedDevelopmentRehearsalIdentity(provider, {
      appId: APP_ID,
      seed: `user-${seed}`,
    }),
  });
  for (seed = 0; seed < 2; seed += 1) {
    const { codeChallenge } = await createSharedDevelopmentVerifier();
    const started = instance.start({ appId: APP_ID, provider: 'apple', returnTo: RETURN_TO, codeChallenge });
    instance.authorize(started.transactionId);
  }
  assert.equal(instance.admittedUserCount(), 2);
  seed = 2;
  const { codeChallenge } = await createSharedDevelopmentVerifier();
  const blocked = instance.start({ appId: APP_ID, provider: 'apple', returnTo: RETURN_TO, codeChallenge });
  assert.throws(
    () => instance.authorize(blocked.transactionId),
    (error) => error.reason === 'user-limit-reached',
  );
  // An already-admitted user is not charged a second seat.
  seed = 1;
  const repeat = await createSharedDevelopmentVerifier();
  const again = instance.start({
    appId: APP_ID, provider: 'apple', returnTo: RETURN_TO, codeChallenge: repeat.codeChallenge,
  });
  instance.authorize(again.transactionId);
  assert.equal(instance.admittedUserCount(), 2);
});

test('a userLimit above the shared cap is refused at construction', () => {
  assert.throws(
    () => broker({ userLimit: 101 }),
    (error) => error.reason === 'user-limit-invalid',
  );
});

test('rehearsal identities name their own provenance and are app-scoped', () => {
  const here = sharedDevelopmentRehearsalIdentity('google', { appId: APP_ID });
  const elsewhere = sharedDevelopmentRehearsalIdentity('google', { appId: 'app-2' });
  assert.equal(here.realm, 'rehearsal');
  assert.equal(here.issuer, 'snapback-shared-development.invalid/google');
  assert.equal(here.issuer.includes('accounts.google.com'), false);
  assert.notEqual(here.subject, elsewhere.subject);
  assert.notEqual(
    sharedDevelopmentIdentityKey({
      appId: APP_ID, providerInstallationId: 'shared-development:app-1:google:v1', ...here,
    }),
    sharedDevelopmentIdentityKey({
      appId: 'app-2', providerInstallationId: 'shared-development:app-2:google:v1', ...elsewhere,
    }),
  );
  // The identity key never derives from an email address.
  assert.equal(Object.hasOwn(here, 'email'), false);
});

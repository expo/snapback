import assert from 'node:assert/strict';
import { createHash, randomBytes } from 'node:crypto';
import test from 'node:test';

import { fixtureIdentity } from '../server/provider-verifier.mjs';
import {
  createSharedDevelopmentAuth,
  sharedDevelopmentAuthAdmitted,
} from '../server/shared-development-auth.mjs';

const verifier = () => randomBytes(32).toString('base64url');
const challenge = (value) => createHash('sha256').update(value).digest('base64url');

function shared(options = {}) {
  return createSharedDevelopmentAuth({
    appId: 'knockoff',
    returnTargets: ['knockoff://auth/shared'],
    identityFor: fixtureIdentity,
    completeIdentity: async (identity) => ({ subject: identity.subject }),
    ...options,
  });
}

test('broker admission allows local development and expiring owner previews only', () => {
  assert.equal(sharedDevelopmentAuthAdmitted({
    allowSharedDevelopment: true,
    deploymentProfile: 'development',
  }, 1), true);
  assert.equal(sharedDevelopmentAuthAdmitted({
    allowSharedDevelopment: true,
    deploymentProfile: 'preview',
    previewOwnerAuthenticated: true,
    previewExpiresAt: '2030-01-01T00:00:00.000Z',
  }, Date.parse('2029-01-01T00:00:00.000Z')), true);
  assert.equal(sharedDevelopmentAuthAdmitted({
    allowSharedDevelopment: true,
    deploymentProfile: 'preview',
    previewOwnerAuthenticated: true,
    previewExpiresAt: '2028-01-01T00:00:00.000Z',
  }, Date.parse('2029-01-01T00:00:00.000Z')), false);
  assert.equal(sharedDevelopmentAuthAdmitted({
    allowSharedDevelopment: true,
    deploymentProfile: 'production',
  }, 1), false);
});

test('shared browser completion binds app, return target, state, and verifier', async () => {
  const auth = shared();
  const secret = verifier();
  const started = auth.start({
    appId: 'knockoff',
    provider: 'apple',
    returnTo: 'knockoff://auth/shared',
    codeChallenge: challenge(secret),
  });
  assert.equal(auth.inspect(started.transactionId).provider, 'apple');
  const firstLocation = auth.authorize(started.transactionId);
  assert.equal(auth.authorize(started.transactionId), firstLocation);
  const location = new URL(firstLocation);
  assert.equal(location.origin, 'null');
  assert.equal(location.protocol, 'knockoff:');
  assert.equal(location.searchParams.get('state'), started.state);
  assert.deepEqual([...location.searchParams.keys()].sort(), ['code', 'state']);

  const code = location.searchParams.get('code');
  const result = await auth.redeem({ appId: 'knockoff', code, verifier: secret });
  assert.equal(result.subject, fixtureIdentity('apple').subject);
  await assert.rejects(
    auth.redeem({ appId: 'knockoff', code, verifier: secret }),
    /completion code is unavailable/u,
  );
});

test('shared auth refuses arbitrary returns, bad verifiers, and users past the cap', async () => {
  const auth = shared({ userLimit: 1 });
  await assert.rejects(
    async () => auth.start({
      appId: 'knockoff',
      provider: 'apple',
      returnTo: 'evil://steal',
      codeChallenge: challenge(verifier()),
    }),
    /return target is not allowlisted/u,
  );

  const firstVerifier = verifier();
  const first = auth.start({
    appId: 'knockoff',
    provider: 'apple',
    returnTo: 'knockoff://auth/shared',
    codeChallenge: challenge(firstVerifier),
  });
  const firstLocation = new URL(auth.authorize(first.transactionId));
  await assert.rejects(
    auth.redeem({
      appId: 'knockoff',
      code: firstLocation.searchParams.get('code'),
      verifier: verifier(),
    }),
    /verifier does not match/u,
  );

  const second = auth.start({
    appId: 'knockoff',
    provider: 'google',
    returnTo: 'knockoff://auth/shared',
    codeChallenge: challenge(verifier()),
  });
  assert.throws(() => auth.authorize(second.transactionId), /user limit reached/u);
});

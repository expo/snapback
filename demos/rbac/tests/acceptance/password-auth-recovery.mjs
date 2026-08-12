#!/usr/bin/env node

import assert from 'node:assert/strict';

import {
  api,
  assertCredentialProjection,
  closeClients,
  createScratch,
  expectRefusal,
  publicClient,
  removeScratch,
  startRbacServer,
} from './password-auth-kit.mjs';

const scratch = await createScratch('snapback-password-recovery-');
const clients = [];
let server = null;

// @ref LLP 0214#88-recovery-code-consumption-and-after-use-replacement — recovery custody is one-time, session-minting,
// and replaced atomically after a successful consume.

try {
  server = await startRbacServer({ scratch });
  const owner = publicClient(server.baseUrl, 'password-recovery-signup');
  const signin = publicClient(server.baseUrl, 'password-recovery-signin');
  const consumer = publicClient(server.baseUrl, 'password-recovery-consumer');
  const reuser = publicClient(server.baseUrl, 'password-recovery-reuser');
  clients.push(owner, signin, consumer, reuser);

  const email = 'password-recovery@example.com';
  const password = 'password-recovery-password-123!';
  const signup = await owner.client.authPasswordSignup({ email, password });
  assertCredentialProjection(signup, { recovery: true });
  const originalCodes = [...signup.recoveryCodes];
  const consumedCode = originalCodes[0];

  const ordinarySignin = await signin.client.authPasswordSignIn({ email, password });
  assertCredentialProjection(ordinarySignin);
  assert.equal(Object.hasOwn(ordinarySignin, 'recoveryCodes'), false, 'signin re-disclosed recovery codes');

  const recovered = await consumer.client.authRecoveryConsume({ email, code: consumedCode });
  assertCredentialProjection(recovered, { recovery: true });
  assert.equal(recovered.session.userId, signup.session.userId);
  assert.equal(consumer.coordinator.authority.userId, signup.session.userId);
  assert.equal(
    recovered.recoveryCodes.some((code) => originalCodes.includes(code)),
    false,
    'automatic recovery replacement reused an old code',
  );
  await consumer.client.mutate(api.joinApp, { args: {} });
  assert.deepEqual((await consumer.client.query(api.listAnnouncements, { args: {} })).rows, []);

  await expectRefusal(
    () => reuser.client.authRecoveryConsume({ email, code: consumedCode }),
    ['SNAPBACK_AUTH_CREDENTIAL_INVALID'],
    'consumed recovery code reuse',
  );

  process.stdout.write(`${JSON.stringify({
    ok: true,
    row: 8,
    signupRecoveryCodes: originalCodes.length,
    signinRedisclosedCodes: false,
    consumeMintedSession: true,
    replacementRecoveryCodes: recovered.recoveryCodes.length,
    replacementDisjointFromOriginal: true,
    consumedCodeReuseRefused: true,
  })}\n`);
} finally {
  await closeClients(clients);
  if (server) await server.stop();
  await removeScratch(scratch);
}

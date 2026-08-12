#!/usr/bin/env node

import assert from 'node:assert/strict';

import {
  api,
  assertCredentialProjection,
  closeClients,
  createScratch,
  custodySnapshot,
  expectRefusal,
  publicClient,
  removeScratch,
  startRbacServer,
} from './password-auth-kit.mjs';

const scratch = await createScratch('snapback-password-change-');
const clients = [];
let server = null;

// @ref LLP 0227#principal-binding-same-sessions-no-parallel-identity — change
// rotates acting custody and revokes only the actor's other live sessions.

try {
  server = await startRbacServer({ scratch });
  const acting = publicClient(server.baseUrl, 'password-change-acting');
  const other = publicClient(server.baseUrl, 'password-change-other-session');
  const bystander = publicClient(server.baseUrl, 'password-change-bystander');
  clients.push(acting, other, bystander);

  const email = 'password-change-owner@example.com';
  const oldPassword = 'password-change-predecessor-123!';
  const newPassword = 'password-change-successor-456!';
  const signup = await acting.client.authPasswordSignup({ email, password: oldPassword });
  assertCredentialProjection(signup, { recovery: true });
  await acting.client.mutate(api.joinApp, { args: {} });
  await acting.client.mutate(api.postAnnouncement, { args: { message: 'change consequence row' } });

  const secondSignin = await other.client.authPasswordSignIn({ email, password: oldPassword });
  assert.equal(secondSignin.session.userId, signup.session.userId);
  assert.equal((await other.client.query(api.listAnnouncements, { args: {} })).rows.length, 1);

  const bystanderSignup = await bystander.client.authPasswordSignup({
    email: 'password-change-bystander@example.com',
    password: 'password-change-bystander-789!',
  });
  assert.notEqual(bystanderSignup.session.userId, signup.session.userId);
  await bystander.client.mutate(api.joinApp, { args: {} });
  assert.equal((await bystander.client.query(api.listAnnouncements, { args: {} })).rows.length, 1);

  const before = custodySnapshot(acting);
  const changed = await acting.client.authPasswordChange({
    currentPassword: oldPassword,
    newPassword,
  });
  assertCredentialProjection(changed);
  const after = custodySnapshot(acting);
  assert.notEqual(after.bearer, before.bearer, 'acting bearer did not rotate');
  assert.equal(changed.session.id, signup.session.id, 'change replaced rather than rotated the acting session');
  assert.equal(
    changed.authorityDescriptor.authorityInstanceId,
    signup.authorityDescriptor.authorityInstanceId,
    'change crossed the acting authority instance',
  );
  assert.equal((await acting.client.query(api.listAnnouncements, { args: {} })).rows.length, 1);

  await expectRefusal(
    () => other.client.query(api.listAnnouncements, { args: {} }),
    ['SNAPBACK_AUTH_SESSION_EXPIRED'],
    'other same-user session after password change',
  );
  assert.equal(
    (await bystander.client.query(api.listAnnouncements, { args: {} })).rows.length,
    1,
    'different-user bystander session was revoked by another user password change',
  );

  const oldSignin = publicClient(server.baseUrl, 'password-change-old-signin');
  const newSignin = publicClient(server.baseUrl, 'password-change-new-signin');
  clients.push(oldSignin, newSignin);
  await expectRefusal(
    () => oldSignin.client.authPasswordSignIn({ email, password: oldPassword }),
    ['SNAPBACK_AUTH_CREDENTIAL_INVALID'],
    'old password after change',
  );
  const successor = await newSignin.client.authPasswordSignIn({ email, password: newPassword });
  assertCredentialProjection(successor);
  assert.equal(successor.session.userId, signup.session.userId);

  process.stdout.write(`${JSON.stringify({
    ok: true,
    row: 4,
    actingSessionIdPreserved: true,
    actingBearerRotated: true,
    actingGeneration: {
      before: signup.authorityDescriptor.sessionGeneration,
      after: changed.authorityDescriptor.sessionGeneration,
    },
    otherSameUserSessionRevoked: true,
    differentUserSessionSurvived: true,
    predecessorPasswordRefused: true,
    successorPasswordAccepted: true,
  })}\n`);
} finally {
  await closeClients(clients);
  if (server) await server.stop();
  await removeScratch(scratch);
}

#!/usr/bin/env node

import assert from 'node:assert/strict';

import {
  api,
  assertCredentialProjection,
  closeClients,
  createScratch,
  passwordReadiness,
  publicClient,
  publicSurfaceDeclaration,
  removeScratch,
  startRbacServer,
} from './password-auth-kit.mjs';

const scratch = await createScratch('snapback-password-packaged-client-');
const clients = [];
let server = null;

try {
  server = await startRbacServer({ scratch });
  const { readiness } = await passwordReadiness(server.baseUrl);
  const fixture = publicClient(server.baseUrl, 'password-packaged-client');
  clients.push(fixture);

  const email = 'packaged-client@example.com';
  const password = 'packaged-client-password-123!';
  const successor = 'packaged-client-password-456!';
  const signup = await fixture.client.authPasswordSignup({ email, password });
  assertCredentialProjection(signup, { recovery: true });
  await fixture.client.mutate(api.joinApp, { args: {} });
  await fixture.client.mutate(api.postAnnouncement, { args: { message: 'packaged client row' } });
  assert.deepEqual(
    (await fixture.client.query(api.listAnnouncements, { args: {} })).rows.map(({ message }) => message),
    ['packaged client row'],
  );

  await fixture.client.authLogout();
  const signin = await fixture.client.authPasswordSignIn({ email, password });
  assertCredentialProjection(signin);
  assert.equal(signin.session.userId, signup.session.userId);
  const changed = await fixture.client.authPasswordChange({
    currentPassword: password,
    newPassword: successor,
  });
  assertCredentialProjection(changed);
  assert.deepEqual(
    (await fixture.client.query(api.listAnnouncements, { args: {} })).rows.map(({ message }) => message),
    ['packaged client row'],
  );

  const exclusions = publicSurfaceDeclaration();
  assert.deepEqual(Object.values(exclusions), Array(Object.keys(exclusions).length).fill(false));
  process.stdout.write(`${JSON.stringify({
    ok: true,
    row: 6,
    packageImports: ['@expo/snapback-client', '@expo/snapback-contract'],
    clientMethods: [
      'authPasswordSignup',
      'authPasswordSignIn',
      'authPasswordChange',
      'authLogout',
      'query',
      'mutate',
    ],
    identifierModeObserved: readiness.identifierMode,
    protectedRows: 1,
    exclusions,
  })}\n`);
} finally {
  await closeClients(clients);
  if (server) await server.stop();
  await removeScratch(scratch);
}

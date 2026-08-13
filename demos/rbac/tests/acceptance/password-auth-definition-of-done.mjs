#!/usr/bin/env node

import assert from 'node:assert/strict';

import {
  api,
  assertCredentialProjection,
  closeClients,
  createScratch,
  joinAndReadProtectedLive,
  passwordReadiness,
  publicClient,
  publicSurfaceDeclaration,
  removeScratch,
  schema,
  startRbacServer,
} from './password-auth-kit.mjs';

const email = 'definition-of-done@example.com';
const password = 'definition-of-done-password-123!';
const scratch = await createScratch('snapback-password-dod-');
const clients = [];
let server = null;

try {
  server = await startRbacServer({ scratch, capture: false });
  const { readiness } = await passwordReadiness(server.baseUrl);
  assert.equal(
    readiness.identifierMode,
    'email-v1',
    `SNAPBACK_ACCEPTANCE_EMAIL_IDENTIFIER_MODE_REQUIRED: fresh public sessions activation selected ${readiness.identifierMode}; the charter requires email-v1`,
  );

  const session = publicClient(server.baseUrl, 'password-definition-of-done');
  clients.push(session);
  const signup = await session.client.authPasswordSignup({ email, password });
  assertCredentialProjection(signup, { recovery: true });
  assert.equal(session.coordinator.authority.userId, signup.session.userId);

  const live = await joinAndReadProtectedLive(
    session,
    'password-definition-of-done',
    'password session protected row',
  );
  assert.deepEqual(live.rows.map(({ message }) => message), ['password session protected row']);
  live.dispose();

  await session.client.authLogout();
  assert.equal(session.coordinator.authority?.isAuthenticated, false);

  const signin = await session.client.authPasswordSignIn({ email, password });
  assertCredentialProjection(signin);
  assert.equal(signin.session.userId, signup.session.userId);
  const afterSignin = await session.client.liveQuery(api.listAnnouncements, {
    connectionId: 'password-definition-of-done-resignin',
    args: {},
    transport: 'stream',
    fallbackToPoll: false,
  });
  assert.deepEqual(afterSignin.rows.map(({ message }) => message), ['password session protected row']);
  afterSignin.dispose();

  const exclusions = publicSurfaceDeclaration();
  assert.deepEqual(Object.values(exclusions), Array(Object.keys(exclusions).length).fill(false));
  process.stdout.write(`${JSON.stringify({
    ok: true,
    row: 1,
    appId: schema.appId,
    identifierMode: readiness.identifierMode,
    signupSession: signup.session.id,
    signinSession: signin.session.id,
    protectedRows: 1,
    exclusions,
  })}\n`);
} finally {
  await closeClients(clients);
  if (server) await server.stop();
  await removeScratch(scratch);
}

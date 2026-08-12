#!/usr/bin/env node

import assert from 'node:assert/strict';
import { execFile } from 'node:child_process';
import { mkdir, readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { promisify } from 'node:util';

import {
  assertCredentialProjection,
  closeClients,
  createScratch,
  expectRefusal,
  publicClient,
  rawPasswordRequest,
  removeScratch,
  runtimeBinary,
  startRbacServer,
} from './password-auth-kit.mjs';

const execFileAsync = promisify(execFile);
const scratch = await createScratch('snapback-password-logical-transfer-');
const clients = [];
let server = null;

// @ref LLP 0227#threat-notes — logical export carries identity facts but never
// password hashes, recovery custody, sessions, or attempt-ledger state.

async function cliJson(args) {
  const { stdout } = await execFileAsync(runtimeBinary, args, {
    cwd: process.cwd(),
    env: process.env,
    maxBuffer: 4 * 1024 * 1024,
  });
  return JSON.parse(stdout);
}

try {
  const sourceDirectory = join(scratch.root, 'source-instance');
  const sourceDb = join(sourceDirectory, 'snapback.sqlite3');
  await mkdir(sourceDirectory, { mode: 0o700 });
  server = await startRbacServer({ scratch, db: sourceDb });
  const source = publicClient(server.baseUrl, 'password-logical-source');
  clients.push(source);
  const email = 'password-logical-transfer@example.com';
  const password = 'password-logical-transfer-password-123!';
  const wrong = 'password-logical-transfer-wrong-456!';
  assertCredentialProjection(await source.client.authPasswordSignup({ email, password }), { recovery: true });
  await source.client.authLogout();
  for (let ordinal = 1; ordinal <= 3; ordinal += 1) {
    const failure = await rawPasswordRequest(server.baseUrl, '/auth/password/signin', {
      email,
      password: wrong,
    });
    assert.equal(failure.status, 401);
  }
  await closeClients([source]);
  await server.stop();
  server = null;

  const artifactPath = join(scratch.root, 'auth-logical.json');
  const exported = await cliJson(['auth', 'export', '--db', sourceDb, '--output', artifactPath]);
  assert.equal(exported.ok, true);
  assert.equal(exported.authCatalogVersion, 4);
  assert.equal(exported.carriesSpendableAuthority, false);
  const artifact = JSON.parse(await readFile(artifactPath, 'utf8'));
  assert.deepEqual(Object.keys(artifact).sort(), [
    'authCatalogVersion',
    'formatVersion',
    'identities',
    'passwordIdentifierMode',
    'schemaVersion',
    'scopeBases',
    'users',
  ]);
  assert.equal(artifact.authCatalogVersion, 4);
  assert(artifact.identities.some(({ provider, subject }) => (
    provider === 'local-password' && subject === email
  )));
  for (const forbidden of [
    'credentials',
    'passwordCredentials',
    'passwordAttempts',
    'recoveryCodes',
    'sessions',
    'tokens',
  ]) assert.equal(Object.hasOwn(artifact, forbidden), false, `logical export carried ${forbidden}`);

  const targetDirectory = join(scratch.root, 'target-instance');
  const targetDb = join(targetDirectory, 'snapback.sqlite3');
  await mkdir(targetDirectory, { mode: 0o700 });
  server = await startRbacServer({ scratch, db: targetDb });
  await server.stop();
  server = null;
  const imported = await cliJson(['auth', 'import', '--from', artifactPath, '--db', targetDb]);
  assert.equal(imported.ok, true);
  assert.equal(imported.mintedSessions, 0);
  assert.equal(imported.mintedCredentials, 0);

  server = await startRbacServer({ scratch, db: targetDb });
  const absentAttemptLedger = await rawPasswordRequest(
    server.baseUrl,
    '/_snapback/api/auth/password/unlock',
    { email },
    { 'x-snapback-admin-token': server.adminToken },
  );
  assert.equal(absentAttemptLedger.status, 200);
  assert.equal(absentAttemptLedger.body.unlocked, false, 'logical import carried attempt history');
  const target = publicClient(server.baseUrl, 'password-logical-target');
  clients.push(target);
  await expectRefusal(
    () => target.client.authPasswordSignIn({ email, password }),
    ['SNAPBACK_AUTH_CREDENTIAL_INVALID'],
    'credential-free logical import signin',
  );

  process.stdout.write(`${JSON.stringify({
    ok: true,
    row: 9,
    portion: 'catalog-v4-logical-transfer',
    authCatalogVersion: artifact.authCatalogVersion,
    passwordIdentifierMode: artifact.passwordIdentifierMode,
    usersImported: imported.usersImported,
    identitiesImported: imported.identitiesImported,
    credentialsImported: imported.mintedCredentials,
    sessionsMinted: imported.mintedSessions,
    attemptLedgerImported: false,
    originalPasswordSignsInAfterImport: false,
  })}\n`);
} finally {
  await closeClients(clients);
  if (server) await server.stop();
  await removeScratch(scratch);
}

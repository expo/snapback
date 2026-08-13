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
const scratch = await createScratch('snapback-password-transfer-');
const clients = [];
let server = null;

// @ref LLP 0057#consistent-backup — physical backup carries credential and
// attempt state; declared restore revokes backed-up sessions before serving.

async function cliJson(args) {
  const { stdout, stderr } = await execFileAsync(runtimeBinary, args, {
    cwd: process.cwd(),
    env: process.env,
    maxBuffer: 4 * 1024 * 1024,
  });
  assert.equal(stderr, '');
  return JSON.parse(stdout);
}

try {
  const sourceDirectory = join(scratch.root, 'source-instance');
  const sourceDb = join(sourceDirectory, 'snapback.sqlite3');
  await mkdir(sourceDirectory, { mode: 0o700 });
  server = await startRbacServer({ scratch, db: sourceDb });
  const source = publicClient(server.baseUrl, 'password-transfer-source');
  clients.push(source);
  const email = 'password-transfer@example.com';
  const password = 'password-transfer-password-123!';
  const wrong = 'password-transfer-password-wrong-456!';
  const signup = await source.client.authPasswordSignup({ email, password });
  assertCredentialProjection(signup, { recovery: true });
  await source.client.authLogout();

  for (let ordinal = 1; ordinal <= 9; ordinal += 1) {
    const failure = await rawPasswordRequest(server.baseUrl, '/auth/password/signin', {
      email,
      password: wrong,
    });
    assert.equal(failure.status, 401, `source failure ${ordinal}`);
    assert.equal(failure.body.diagnostic?.code, 'SNAPBACK_AUTH_CREDENTIAL_INVALID');
  }
  await closeClients([source]);
  await server.stop();
  server = null;

  const backupDirectory = join(scratch.root, 'auth-backup');
  const logicalArtifactPath = join(scratch.root, 'auth-logical.json');
  const backup = await cliJson(['auth', 'backup', '--db', sourceDb, '--output', backupDirectory]);
  assert.equal(backup.ok, true);
  assert.equal(backup.publicationState, 'Published');
  const backupManifest = JSON.parse(await readFile(join(backupDirectory, 'backup.json'), 'utf8'));
  assert.equal(backupManifest.formatVersion, 2);
  assert.equal(backupManifest.catalogVersion, 4);
  assert.equal(backupManifest.catalogState, 'ReadyV4');

  const logicalExport = await cliJson([
    'auth', 'export', '--db', sourceDb, '--output', logicalArtifactPath,
  ]);
  assert.equal(logicalExport.ok, true);
  assert.equal(logicalExport.authCatalogVersion, 4);
  assert.equal(logicalExport.carriesSpendableAuthority, false);
  const logicalArtifact = JSON.parse(await readFile(logicalArtifactPath, 'utf8'));
  assert.deepEqual(Object.keys(logicalArtifact).sort(), [
    'authCatalogVersion',
    'formatVersion',
    'identities',
    'passwordIdentifierMode',
    'schemaVersion',
    'scopeBases',
    'users',
  ]);
  assert.equal(logicalArtifact.authCatalogVersion, 4);
  assert.equal(logicalArtifact.passwordIdentifierMode, backupManifest.passwordIdentifierMode);
  assert(logicalArtifact.identities.some(({ provider, subject }) => (
    provider === 'local-password' && subject === email
  )));
  for (const forbidden of [
    'credentials',
    'passwordCredentials',
    'passwordAttempts',
    'recoveryCodes',
    'sessions',
    'tokens',
  ]) assert.equal(Object.hasOwn(logicalArtifact, forbidden), false, `logical export carried ${forbidden}`);

  const restoredDb = join(scratch.root, 'restored-instance', 'snapback.sqlite3');
  const restore = await cliJson([
    'auth', 'restore', '--from', backupDirectory, '--db', restoredDb,
  ]);
  assert.equal(restore.ok, true);
  assert.equal(typeof restore.declarationId, 'string');
  server = await startRbacServer({
    scratch,
    db: restoredDb,
    restoredFromBackup: restore.declarationId,
  });

  const tenth = await rawPasswordRequest(server.baseUrl, '/auth/password/signin', {
    email,
    password: wrong,
  });
  assert.equal(tenth.status, 401);
  const lockedCorrect = await rawPasswordRequest(server.baseUrl, '/auth/password/signin', {
    email,
    password,
  });
  assert.equal(lockedCorrect.status, tenth.status);
  // `Date` is a dynamic per-response timestamp. These two requests are Argon2-padded
  // and land seconds apart, so byte-equal `Date` would be false HTTP metadata rather
  // than evidence of uniformity. Validate it is a well-formed HTTP date and compare
  // every OTHER header byte-for-byte — the same treatment password-auth-uniformity.mjs
  // applies. The uniformity claim lives in the static headers and the body.
  for (const observation of [tenth, lockedCorrect]) {
    const date = new Map(observation.headers).get('date');
    assert(Number.isFinite(Date.parse(date)), 'response carried an invalid HTTP Date header');
  }
  const staticHeaders = ({ headers }) => headers.filter(([name]) => name !== 'date');
  assert.deepEqual(staticHeaders(lockedCorrect), staticHeaders(tenth));
  assert.deepEqual(lockedCorrect.bytes, tenth.bytes);
  const unlock = await rawPasswordRequest(
    server.baseUrl,
    '/_snapback/api/auth/password/unlock',
    { email },
    { 'x-snapback-admin-token': server.adminToken },
  );
  assert.equal(unlock.status, 200);
  assert.equal(unlock.body.unlocked, true);
  const restored = publicClient(server.baseUrl, 'password-transfer-restored');
  clients.push(restored);
  const restoredSignin = await restored.client.authPasswordSignIn({ email, password });
  assertCredentialProjection(restoredSignin);
  assert.equal(restoredSignin.session.userId, signup.session.userId);
  await closeClients([restored]);
  await server.stop();
  server = null;

  const logicalDirectory = join(scratch.root, 'logical-instance');
  const logicalDb = join(logicalDirectory, 'snapback.sqlite3');
  await mkdir(logicalDirectory, { mode: 0o700 });
  server = await startRbacServer({ scratch, db: logicalDb });
  await server.stop();
  server = null;
  const logicalImport = await cliJson(['auth', 'import', '--from', logicalArtifactPath, '--db', logicalDb]);
  assert.equal(logicalImport.ok, true);
  assert.equal(logicalImport.mintedSessions, 0);
  assert.equal(logicalImport.mintedCredentials, 0);
  server = await startRbacServer({ scratch, db: logicalDb });
  const absentLedger = await rawPasswordRequest(
    server.baseUrl,
    '/_snapback/api/auth/password/unlock',
    { email },
    { 'x-snapback-admin-token': server.adminToken },
  );
  assert.equal(absentLedger.status, 200);
  assert.equal(absentLedger.body.unlocked, false, 'logical import carried the password attempt ledger');
  const logicalSignin = publicClient(server.baseUrl, 'password-transfer-logical');
  clients.push(logicalSignin);
  await expectRefusal(
    () => logicalSignin.client.authPasswordSignIn({ email, password }),
    ['SNAPBACK_AUTH_CREDENTIAL_INVALID'],
    'credential-free logical import signin',
  );

  process.stdout.write(`${JSON.stringify({
    ok: true,
    row: 9,
    backup: {
      formatVersion: backupManifest.formatVersion,
      catalogVersion: backupManifest.catalogVersion,
      identifierMode: backupManifest.passwordIdentifierMode,
      credentialSigninAfterRestore: true,
      nineFailureLedgerCarriedIntoTenthFailureLock: true,
    },
    logical: {
      catalogVersion: logicalArtifact.authCatalogVersion,
      identifierMode: logicalArtifact.passwordIdentifierMode,
      usersImported: logicalImport.usersImported,
      identitiesImported: logicalImport.identitiesImported,
      attemptLedgerImported: false,
      credentialsImported: false,
      sessionsMinted: logicalImport.mintedSessions,
    },
  })}\n`);
} finally {
  await closeClients(clients);
  if (server) await server.stop();
  await removeScratch(scratch);
}

#!/usr/bin/env node

import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';

import {
  assertCredentialProjection,
  closeClients,
  createScratch,
  publicClient,
  rawPasswordRequest,
  removeScratch,
  runtimeBinary,
  startRbacServer,
} from './password-auth-kit.mjs';

const scratch = await createScratch('snapback-password-lockout-');
const clients = [];
let server = null;
const staticHeaders = ({ headers }) => headers.filter(([name]) => name !== 'date');

// @ref LLP 0227#lockout-and-rate-posture-a-declared-testable-contract — lock
// state is invisible on the public wire and cleared only by AdminWrite.

function runUnlock(baseUrl, adminToken, email) {
  return new Promise((resolve, reject) => {
    const child = spawn(runtimeBinary, [
      'auth', 'password', 'unlock', '--url', baseUrl, '--email', email,
    ], {
      env: { ...process.env, SNAPBACK_ADMIN_TOKEN: adminToken },
      stdio: ['ignore', 'pipe', 'pipe'],
    });
    let stdout = '';
    let stderr = '';
    child.stdout.setEncoding('utf8');
    child.stderr.setEncoding('utf8');
    child.stdout.on('data', (chunk) => { stdout += chunk; });
    child.stderr.on('data', (chunk) => { stderr += chunk; });
    child.once('error', reject);
    child.once('exit', (code, signal) => {
      if (code !== 0) {
        reject(new Error(`admin unlock exited ${code ?? signal}: ${stderr}`));
        return;
      }
      resolve(JSON.parse(stdout));
    });
  });
}

try {
  server = await startRbacServer({ scratch });
  const email = 'password-lockout-existing@example.com';
  const missing = 'password-lockout-missing@example.com';
  const password = 'password-lockout-password-123!';
  const wrong = 'password-lockout-password-wrong-456!';
  const owner = publicClient(server.baseUrl, 'password-lockout-owner');
  clients.push(owner);
  assertCredentialProjection(await owner.client.authPasswordSignup({ email, password }), { recovery: true });
  await owner.client.authLogout();

  const rounds = [];
  for (let ordinal = 1; ordinal <= 12; ordinal += 1) {
    const [existing, unknown] = await Promise.all([
      rawPasswordRequest(server.baseUrl, '/auth/password/signin', { email, password: wrong }),
      rawPasswordRequest(server.baseUrl, '/auth/password/signin', { email: missing, password: wrong }),
    ]);
    assert.equal(existing.status, 401, `existing round ${ordinal} status`);
    assert.equal(unknown.status, existing.status, `round ${ordinal} status diverged`);
    assert.deepEqual(staticHeaders(unknown), staticHeaders(existing), `round ${ordinal} headers diverged`);
    assert.deepEqual(
      unknown.headers.map(([name]) => name),
      existing.headers.map(([name]) => name),
      `round ${ordinal} header names diverged`,
    );
    for (const observation of [existing, unknown]) {
      const date = new Map(observation.headers).get('date');
      assert(Number.isFinite(Date.parse(date)), `round ${ordinal} carried an invalid HTTP Date header`);
    }
    assert.deepEqual(unknown.bytes, existing.bytes, `round ${ordinal} body diverged`);
    assert.equal(existing.body.diagnostic?.code, 'SNAPBACK_AUTH_CREDENTIAL_INVALID');
    assert.equal(existing.bytes.includes(Buffer.from('lock')), false, 'public response exposed lock state');
    rounds.push({
      ordinal,
      existingMs: Number(existing.elapsedMs.toFixed(2)),
      missingMs: Number(unknown.elapsedMs.toFixed(2)),
    });
  }

  const lockedCorrect = await rawPasswordRequest(server.baseUrl, '/auth/password/signin', {
    email,
    password,
  });
  const stillMissing = await rawPasswordRequest(server.baseUrl, '/auth/password/signin', {
    email: missing,
    password: wrong,
  });
  assert.equal(lockedCorrect.status, stillMissing.status);
  assert.deepEqual(staticHeaders(lockedCorrect), staticHeaders(stillMissing));
  assert.deepEqual(
    lockedCorrect.headers.map(([name]) => name),
    stillMissing.headers.map(([name]) => name),
  );
  for (const observation of [lockedCorrect, stillMissing]) {
    assert(Number.isFinite(Date.parse(new Map(observation.headers).get('date'))));
  }
  assert.deepEqual(lockedCorrect.bytes, stillMissing.bytes);

  const lockedProjection = await rawPasswordRequest(
    server.baseUrl,
    '/_snapback/api/auth/password/attempt',
    { email },
    { 'x-snapback-admin-token': server.adminToken },
  );
  assert.equal(lockedProjection.status, 200);
  assert.equal(lockedProjection.body.failureThreshold, 10);
  assert.equal(lockedProjection.body.failureWindowMs, 15 * 60 * 1_000);
  assert.equal(lockedProjection.body.lockDurationMs, 15 * 60 * 1_000);
  assert.equal(lockedProjection.body.attempt.canonicalIdentifier, email);
  assert.equal(lockedProjection.body.attempt.failedCount, lockedProjection.body.failureThreshold);
  assert.equal(lockedProjection.body.attempt.locked, true);
  assert(Number.isSafeInteger(lockedProjection.body.attempt.windowStartMs));
  assert(Number.isSafeInteger(lockedProjection.body.attempt.lockedUntilMs));
  assert(
    lockedProjection.body.attempt.lockedUntilMs > lockedProjection.body.attempt.windowStartMs,
  );

  const existingUnlock = await runUnlock(server.baseUrl, server.adminToken, email);
  const missingUnlock = await runUnlock(server.baseUrl, server.adminToken, missing);
  assert.equal(existingUnlock.unlocked, true);
  assert.equal(missingUnlock.unlocked, true);
  const clearedProjection = await rawPasswordRequest(
    server.baseUrl,
    '/_snapback/api/auth/password/attempt',
    { email },
    { 'x-snapback-admin-token': server.adminToken },
  );
  assert.equal(clearedProjection.status, 200);
  assert.equal(clearedProjection.body.attempt, null);
  const afterUnlock = publicClient(server.baseUrl, 'password-lockout-after-unlock');
  clients.push(afterUnlock);
  assertCredentialProjection(await afterUnlock.client.authPasswordSignIn({ email, password }));

  process.stdout.write(`${JSON.stringify({
    ok: true,
    row: 10,
    acceptanceComplete: true,
    witness: 'public-wire-admin-projection-and-unlock',
    failuresPerIdentifier: 12,
    publicRoundsUniform: true,
    dynamicDateHeaderValidatedButNotByteCompared: true,
    correctPasswordWhileLockedUniform: true,
    adminAttemptProjection: lockedProjection.body,
    adminUnlockVerb: { existing: existingUnlock, missing: missingUnlock },
    adminProjectionClearedAfterUnlock: true,
    signinAfterUnlock: true,
    timingsMs: rounds,
  })}\n`);
} finally {
  await closeClients(clients);
  if (server) await server.stop();
  await removeScratch(scratch);
}

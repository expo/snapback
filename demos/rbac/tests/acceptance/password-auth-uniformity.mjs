#!/usr/bin/env node

import assert from 'node:assert/strict';

import {
  assertCredentialProjection,
  closeClients,
  createScratch,
  publicClient,
  rawPasswordRequest,
  removeScratch,
  startRbacServer,
} from './password-auth-kit.mjs';

const email = 'uniform-known@example.com';
const missing = 'uniform-missing@example.com';
const password = 'uniform-password-123!';
const wrong = 'uniform-password-wrong-456!';
const samples = 5;
const declaredEnvelopeMs = 250;
const scratch = await createScratch('snapback-password-uniformity-');
const clients = [];
let server = null;

const median = (values) => [...values].sort((a, b) => a - b)[Math.floor(values.length / 2)];
const staticHeaders = ({ headers }) => headers.filter(([name]) => name !== 'date');

// @ref LLP 0227#lockout-and-rate-posture-a-declared-testable-contract — the
// unknown-identity branch must pay dummy-KDF cost and return the same wire
// refusal as a real credential with the wrong password.

try {
  server = await startRbacServer({ scratch });
  const owner = publicClient(server.baseUrl, 'password-uniformity-owner');
  clients.push(owner);
  const signup = await owner.client.authPasswordSignup({ email, password });
  assertCredentialProjection(signup, { recovery: true });
  await owner.client.authLogout();

  const known = [];
  const unknown = [];
  for (let index = 0; index < samples; index += 1) {
    const [knownResult, unknownResult] = await Promise.all([
      rawPasswordRequest(server.baseUrl, '/auth/password/signin', {
        email,
        password: wrong,
      }),
      rawPasswordRequest(server.baseUrl, '/auth/password/signin', {
        email: missing,
        password: wrong,
      }),
    ]);
    known.push(knownResult);
    unknown.push(unknownResult);
  }

  for (let index = 0; index < samples; index += 1) {
    assert.equal(unknown[index].status, known[index].status, `sample ${index} status diverged`);
    assert.deepEqual(staticHeaders(unknown[index]), staticHeaders(known[index]), `sample ${index} headers diverged`);
    assert.deepEqual(
      unknown[index].headers.map(([name]) => name),
      known[index].headers.map(([name]) => name),
      `sample ${index} header names diverged`,
    );
    for (const observation of [known[index], unknown[index]]) {
      const date = new Map(observation.headers).get('date');
      assert(Number.isFinite(Date.parse(date)), `sample ${index} carried an invalid HTTP Date header`);
    }
    assert.deepEqual(unknown[index].bytes, known[index].bytes, `sample ${index} body diverged`);
    assert.equal(known[index].status, 401);
    assert.equal(known[index].body.diagnostic?.code, 'SNAPBACK_AUTH_CREDENTIAL_INVALID');
  }

  const knownMedianMs = median(known.map(({ elapsedMs }) => elapsedMs));
  const unknownMedianMs = median(unknown.map(({ elapsedMs }) => elapsedMs));
  const ratio = unknownMedianMs / knownMedianMs;
  assert(
    Math.abs(knownMedianMs - unknownMedianMs) <= declaredEnvelopeMs,
    `median KDF observations exceeded the declared ${declaredEnvelopeMs}ms envelope: wrong=${knownMedianMs.toFixed(2)}ms unknown=${unknownMedianMs.toFixed(2)}ms`,
  );
  assert(
    ratio >= 0.5 && ratio <= 2,
    `unknown-identity median ${unknownMedianMs.toFixed(2)}ms is not comparable to wrong-password median ${knownMedianMs.toFixed(2)}ms`,
  );
  assert(
    unknownMedianMs >= 5,
    `unknown-identity median ${unknownMedianMs.toFixed(2)}ms is an implausible no-KDF fast path`,
  );

  process.stdout.write(`${JSON.stringify({
    ok: true,
    row: 2,
    samples,
    status: known[0].status,
    body: known[0].body,
    headers: staticHeaders(known[0]),
    dynamicDateHeaderValidatedButNotByteCompared: true,
    declaredEnvelopeMs,
    knownMedianMs: Number(knownMedianMs.toFixed(2)),
    unknownMedianMs: Number(unknownMedianMs.toFixed(2)),
    medianRatio: Number(ratio.toFixed(3)),
  })}\n`);
} finally {
  await closeClients(clients);
  if (server) await server.stop();
  await removeScratch(scratch);
}

#!/usr/bin/env node

import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { fileURLToPath } from 'node:url';

import { jcsCanonical } from '../packages/snapback-codegen/api-envelope-members.mjs';
import { startServer } from '../demos/_kit/server-process.mjs';

const repositoryRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const backendRoot = join(
  repositoryRoot,
  'packages/snapback-cli/templates/expo-chat/snapback',
);
const generatedRoot = join(backendRoot, 'generated');
const binary = resolve(
  process.env.SNAPBACK_SERVER_BINARY ?? join(repositoryRoot, 'target/debug/snapback'),
);
const scratch = await mkdtemp(join(tmpdir(), 'snapback-guest-entry-server-'));
const carrier = join(scratch, 'startup-artifacts.json');
const persistentDatabase = join(scratch, 'guest-entry-occupied.sqlite');
const schema = JSON.parse(await readFile(join(generatedRoot, 'schema.manifest.json'), 'utf8'));
const functions = JSON.parse(await readFile(join(generatedRoot, 'functions.manifest.json'), 'utf8'));
const abuseBudgets = schema.authProgram.abuseBudgets;
for (const budgetName of ['auth.enumeration', 'auth.hash-cpu']) {
  for (const profile of ['test', 'prod']) {
    abuseBudgets.budgets[budgetName].profiles[profile].windowMs = 60_000;
  }
}
const abuseBudgetPolicy = {
  version: abuseBudgets.version,
  preset: abuseBudgets.preset,
  budgets: abuseBudgets.budgets,
  effectBindings: abuseBudgets.effectBindings,
};
abuseBudgets.policyDigest = `sha256:${createHash('sha256')
  .update('snapback.auth-abuse-budget-policy.v1')
  .update(jcsCanonical(abuseBudgetPolicy))
  .digest('hex')}`;
await writeFile(carrier, `${JSON.stringify({ formatVersion: 1, schema, functions })}\n`, {
  mode: 0o600,
});

const request = async (server, path, { bearer = null, body = {}, idempotencyKey = null } = {}) => {
  const headers = {
    'content-type': 'application/json',
    'x-snapback-auth-client-protocol': '1',
  };
  if (bearer !== null) headers.authorization = `Bearer ${bearer}`;
  if (idempotencyKey !== null) headers['idempotency-key'] = idempotencyKey;
  const response = await fetch(`${server.baseUrl}${path}`, {
    method: 'POST',
    headers,
    body: JSON.stringify(body),
  });
  const payload = await response.json();
  return { response, payload };
};

const code = ({ payload }) => payload?.diagnostic?.code;
const sessionIdentity = ({ payload }) => ({
  sessionId: payload.session.id,
  authorityInstanceId: payload.authorityDescriptor.authorityInstanceId,
});
const attemptLedger = () => {
  const database = new DatabaseSync(persistentDatabase, { readOnly: true });
  const rows = database
    .prepare(
      `SELECT budget_name AS budgetName, hex(axis_digest) AS axisDigest, COUNT(*) AS count
         FROM _snapback_auth_attempt_charges
        GROUP BY budget_name, axis_digest
        ORDER BY budget_name, axis_digest`,
    )
    .all()
    .map((row) => ({ ...row, count: Number(row.count) }));
  database.close();
  return rows;
};
const budgetChargeCount = (ledger, budgetName) => ledger
  .filter((row) => row.budgetName === budgetName)
  .reduce((total, row) => total + row.count, 0);

let server = null;
try {
  server = await startServer({
    port: 0,
    db: persistentDatabase,
    cwd: repositoryRoot,
    startupArtifacts: carrier,
    governanceBackendRoot: backendRoot,
    serverBinary: binary,
    env: { SNAPBACK_PROFILE: 'test' },
  });

  const occupiedEmail = 'guest-entry-occupied@example.com';
  const passwordSession = await request(server, '/auth/password/signup', {
    body: { email: occupiedEmail, password: 'guest-entry-owner-password-123!' },
  });
  assert.equal(passwordSession.response.status, 200, JSON.stringify(passwordSession.payload));

  const entryKey = 'guest-entry-server-lost-response-v1';
  const entered = await request(server, '/auth/guest', { idempotencyKey: entryKey });
  assert.equal(entered.response.status, 200, JSON.stringify(entered.payload));
  const replay = await request(server, '/auth/guest', { idempotencyKey: entryKey });
  assert.equal(replay.response.status, 200, JSON.stringify(replay.payload));
  assert.deepEqual(replay.payload, entered.payload, 'lost-response replay must be byte-semantic exact');

  const collision = await request(server, '/auth/guest/claim/password', {
    bearer: entered.payload.token,
    body: { email: occupiedEmail, password: 'guest-entry-collision-password-123!' },
  });
  assert.equal(collision.response.status, 409, JSON.stringify(collision.payload));
  assert.equal(code(collision), 'SNAPBACK_AUTH_GUEST_CLAIM_COLLISION');

  const downgrade = await request(server, '/auth/guest/claim/password', {
    bearer: passwordSession.payload.token,
    body: { email: 'guest-entry-downgrade@example.com', password: 'guest-entry-downgrade-123!' },
  });
  assert.equal(downgrade.response.status, 401, JSON.stringify(downgrade.payload));
  assert.equal(code(downgrade), 'SNAPBACK_AUTH_GUEST_SESSION_INVALID');

  const claimed = await request(server, '/auth/guest/claim/password', {
    bearer: entered.payload.token,
    body: { email: 'guest-entry-claimed@example.com', password: 'guest-entry-claimed-password-123!' },
  });
  assert.equal(claimed.response.status, 200, JSON.stringify(claimed.payload));
  assert.deepEqual(
    sessionIdentity(claimed),
    sessionIdentity(entered),
    'claim must rotate the acting bearer in place',
  );
  assert.notEqual(claimed.payload.token, entered.payload.token);
  assert.equal(claimed.payload.recoveryCodes.length, 8);

  const oldBearer = await fetch(`${server.baseUrl}/auth/session`, {
    headers: {
      authorization: `Bearer ${entered.payload.token}`,
      'x-snapback-auth-client-protocol': '1',
    },
  });
  assert.equal(oldBearer.status, 200, 'the LLP 0057 supersession grace remains in force');
  await new Promise((resolve) => setTimeout(resolve, 10_050));
  const expiredOldBearer = await fetch(`${server.baseUrl}/auth/session`, {
    headers: {
      authorization: `Bearer ${entered.payload.token}`,
      'x-snapback-auth-client-protocol': '1',
    },
  });
  assert.equal(expiredOldBearer.status, 401, 'the superseded guest bearer dies after grace');
  const currentBearer = await fetch(`${server.baseUrl}/auth/session`, {
    headers: {
      authorization: `Bearer ${claimed.payload.token}`,
      'x-snapback-auth-client-protocol': '1',
    },
  });
  assert.equal(currentBearer.status, 200);

  const unoccupiedEmail = 'guest-entry-unoccupied-prod@example.com';
  const beforePreexhaustion = attemptLedger();
  const preexhaustions = [];
  for (let attempt = 0; attempt < 12; attempt += 1) {
    for (const email of [occupiedEmail, unoccupiedEmail]) {
      preexhaustions.push(request(server, '/auth/guest/claim/password', {
        bearer: passwordSession.payload.token,
        body: { email, password: 'test-profile-preexhaustion-password-123!' },
      }));
    }
  }
  for (const refusal of await Promise.all(preexhaustions)) {
    assert.equal(refusal.response.status, 401, JSON.stringify(refusal.payload));
    assert.equal(code(refusal), 'SNAPBACK_AUTH_GUEST_SESSION_INVALID');
  }
  const preexhaustedLedger = attemptLedger();
  for (const budgetName of ['auth.enumeration', 'auth.hash-cpu']) {
    assert.equal(
      budgetChargeCount(preexhaustedLedger, budgetName),
      budgetChargeCount(beforePreexhaustion, budgetName) + 24,
      `${budgetName} must record every enabled-Test pre-exhaustion request`,
    );
  }
  assert.equal(
    preexhaustedLedger.filter((row) => row.budgetName === 'auth.hash-cpu').length,
    1,
    'all rotating recipients on one local deployment share one hash-CPU resource axis',
  );
  await server.stop();
  server = null;

  server = await startServer({
    port: 0,
    // Reopen the exact database in which the Test-profile signup above
    // durably occupied occupiedEmail. A fresh :memory: database makes the
    // production occupancy assertion vacuous.
    db: persistentDatabase,
    cwd: repositoryRoot,
    startupArtifacts: carrier,
    governanceBackendRoot: backendRoot,
    serverBinary: binary,
    env: { SNAPBACK_PROFILE: 'prod' },
  });
  const occupiedStore = new DatabaseSync(persistentDatabase, { readOnly: true });
  const occupiedRow = occupiedStore
    .prepare(
      "SELECT COUNT(*) AS count FROM _auth_identities WHERE provider='local-password' AND subject=?",
    )
    .get(occupiedEmail);
  occupiedStore.close();
  assert.equal(
    Number(occupiedRow?.count),
    1,
    'the production server database must contain the occupied password subject',
  );
  assert.deepEqual(
    attemptLedger(),
    preexhaustedLedger,
    'reopening the same database and deployment in Prod preserves the exhausted ledger',
  );
  const prodGuest = await request(server, '/auth/guest', {
    idempotencyKey: 'guest-entry-production-refusal-v1',
  });
  assert.equal(prodGuest.response.status, 200, JSON.stringify(prodGuest.payload));
  let canonicalProductionRefusal = null;
  // The exact durable attempt buckets are already beyond the production limit.
  // Occupied and unoccupied subjects must still converge on availability
  // before either the ledger or identity catalog can preempt that fixed result.
  for (let attempt = 0; attempt < 12; attempt += 1) {
    for (const email of [occupiedEmail, unoccupiedEmail]) {
      const prodClaim = await request(server, '/auth/guest/claim/password', {
        bearer: prodGuest.payload.token,
        body: { email, password: 'production-must-not-create-password-123!' },
      });
      assert.equal(prodClaim.response.status, 503, JSON.stringify(prodClaim.payload));
      assert.equal(code(prodClaim), 'SNAPBACK_AUTH_PASSWORD_SIGNUP_UNAVAILABLE');
      canonicalProductionRefusal ??= prodClaim.payload;
      assert.deepEqual(
        prodClaim.payload,
        canonicalProductionRefusal,
        'occupied and unoccupied production subjects must converge through budget exhaustion',
      );
    }
  }
  assert.deepEqual(
    attemptLedger(),
    preexhaustedLedger,
    'fixed production availability refusals must not charge the exhausted ledger',
  );
  const preservedStore = new DatabaseSync(persistentDatabase, { readOnly: true });
  const preservedOccupiedRow = preservedStore
    .prepare(
      "SELECT COUNT(*) AS count FROM _auth_identities WHERE provider='local-password' AND subject=?",
    )
    .get(occupiedEmail);
  preservedStore.close();
  assert.equal(
    Number(preservedOccupiedRow?.count),
    1,
    'the occupied password identity must remain unchanged after fixed production refusals',
  );
  await server.stop();
  server = null;

  // These HTTP-router fixtures own the injected seams that an external process
  // cannot safely expose: concurrent final-slot settlement, CSPRNG failure,
  // foreign bearers, email-code collisions, disabled policy, and reaping races.
  for (const filter of [
    'guest_entry_http_',
    'guest_claim_http_denial_matrix_is_fail_closed_and_non_linking',
  ]) {
    const fixture = spawnSync(
      'cargo',
      ['test', '-p', 'snapback-server', filter, '--', '--nocapture'],
      { cwd: repositoryRoot, encoding: 'utf8' },
    );
    assert.equal(
      fixture.status,
      0,
      `server HTTP fixture ${filter} failed\n${fixture.stdout}\n${fixture.stderr}`,
    );
  }

  const vocabularyPin = spawnSync(
    'cargo',
    [
      'test',
      '-p',
      'snapback-kernel',
      '--lib',
      'auth::throttle::tests::compatibility_budget_vocabulary_pins_names_harms_axes_classes_and_timing',
      '--',
      '--nocapture',
    ],
    { cwd: repositoryRoot, encoding: 'utf8' },
  );
  assert.equal(
    vocabularyPin.status,
    0,
    `authentication budget vocabulary pin failed\n${vocabularyPin.stdout}\n${vocabularyPin.stderr}`,
  );

  process.stdout.write(`${JSON.stringify({
    ok: true,
    qualifiedBinary: binary,
    realServer: {
      guestEntry: true,
      exactLostResponseReplay: true,
      collisionPreservedGuest: true,
      inPlaceClaimRotation: true,
      oldBearerRejectedAfterGrace: true,
      passwordDowngradeRefused: true,
      productionClaimRefusedBeforeOccupancy: true,
      productionOccupiedRowPreserved: true,
      productionAttemptBucketsPreexhausted: true,
      productionOccupiedAndUnoccupiedConvergePastBudgetLimit: true,
    },
    injectedHttpFixtures: {
      concurrentLastBudgetSlot: true,
      refusalReplay: true,
      csprngFailure: true,
      emailCodeCollision: true,
      foreignBearer: true,
      unavailablePolicy: true,
      predecessorRace: true,
      budgetVocabularyPinned: true,
    },
  })}\n`);
} finally {
  if (server !== null) await server.stop().catch(() => {});
  await rm(scratch, { recursive: true, force: true });
}

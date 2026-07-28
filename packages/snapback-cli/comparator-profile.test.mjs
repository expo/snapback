import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import Ajv2020 from 'ajv/dist/2020.js';

import {
  COMPARATOR_CHECKS,
  readComparatorReceipt,
  runComparatorAcceptance,
  validateComparatorReceipt,
  writeComparatorReceipt,
} from './comparator-profile.mjs';
import profile from './fixtures/comparator/green.config.mjs';
import { createComparatorFixtureTarget } from './fixtures/comparator/fixture-target.mjs';
import { runCli } from './index.mjs';

const root = mkdtempSync(join(tmpdir(), 'snapback-comparator-test-'));
const start = (fault = null) => async () => createComparatorFixtureTarget(fault);
const run = (fault = null, options = {}) => runComparatorAcceptance(profile, {
  startTarget: start(fault),
  timeoutMs: 100,
  ...options,
});

try {
  const green = await run();
  assert.equal(green.status, 'passed');
  assert.equal(green.exitCode, 0);
  assert.deepEqual(green.checks.map(({ id }) => id), COMPARATOR_CHECKS.map(({ id }) => id));
  assert.ok(green.checks.every(({ status }) => status === 'passed'));
  assert.deepEqual(green.checks[0].details.identitySources, {
    observer: 'fixture-asserted',
    actor: 'fixture-asserted',
  });
  assert.ok(green.nonclaims.includes(
    'dev-asserted identity labels are behavioral witnesses, not authenticated-principal evidence',
  ));
  assert.deepEqual(green.cleanup, {
    attempted: true,
    ok: true,
    managed: true,
    leaderExited: true,
    temporaryStateRemoved: true,
    errors: [],
  });
  assert.equal(validateComparatorReceipt(green), green);

  const actualPrincipals = await runComparatorAcceptance(profile, {
    timeoutMs: 100,
    async startTarget() {
      const target = createComparatorFixtureTarget();
      return {
        ...target,
        createClient(options) {
          return {
            ...target.createClient(options),
            principalId: options.role === 'observer'
              ? 'actual_observer_principal'
              : 'actual_actor_principal',
          };
        },
      };
    },
  });
  assert.equal(actualPrincipals.status, 'passed');
  assert.deepEqual(actualPrincipals.checks[0].details, {
    observerIdentity: 'actual_observer_principal',
    actorIdentity: 'actual_actor_principal',
    identitySources: {
      observer: 'fixture-asserted',
      actor: 'fixture-asserted',
    },
    transport: 'push',
    subscriptionId: 'fixture-subscription',
    deliveredVersion: 2,
  });

  const missingPrincipal = await runComparatorAcceptance(profile, {
    timeoutMs: 100,
    async startTarget() {
      const target = createComparatorFixtureTarget();
      return {
        ...target,
        createClient(options) {
          const { principalId: _omitted, ...client } = target.createClient(options);
          return client;
        },
      };
    },
  });
  assert.equal(missingPrincipal.status, 'infrastructure-error');
  assert.equal(missingPrincipal.diagnostic.code, 'SNAPBACK_COMPARATOR_IDENTITY_MISMATCH');

  const propertyFailures = new Map([
    ['live-delivery', 'SNAPBACK_COMPARATOR_CHECK_TIMEOUT'],
    ['live-preexisting', 'SNAPBACK_COMPARATOR_LIVE_WITNESS_PREEXISTING'],
    ['atomic-write-set', 'SNAPBACK_COMPARATOR_ATOMIC_WRITE_SET_FAILED'],
    ['rejection-rollback', 'SNAPBACK_COMPARATOR_REJECTION_ROLLBACK_FAILED'],
    ['presence-ttl', 'SNAPBACK_COMPARATOR_PRESENCE_TTL_FAILED'],
    ['presence-disconnect', 'SNAPBACK_COMPARATOR_PRESENCE_DISCONNECT_FAILED'],
    ['ephemeral-version', 'SNAPBACK_COMPARATOR_EPHEMERAL_VERSION_ADVANCED'],
    ['polling-as-push', 'SNAPBACK_COMPARATOR_POLLING_AS_PUSH'],
  ]);
  let productFailure = null;
  for (const [fault, code] of propertyFailures) {
    const receipt = await run(fault, {
      timeoutMs: fault === 'live-delivery' ? 20 : 100,
    });
    if (fault === 'atomic-write-set') productFailure = receipt;
    assert.notEqual(receipt.status, 'passed', `${fault} unexpectedly passed`);
    assert.ok(
      receipt.checks.some((check) => check.diagnostic?.code === code),
      `${fault} did not produce ${code}: ${JSON.stringify(receipt.checks)}`,
    );
  }

  const unsupported = await run('missing-capability');
  assert.equal(unsupported.status, 'unsupported');
  assert.equal(unsupported.exitCode, 1);
  assert.equal(unsupported.checks.length, 0);
  assert.equal(unsupported.diagnostic.code, 'SNAPBACK_COMPARATOR_CAPABILITY_GAP');
  assert.deepEqual(unsupported.capabilityGaps.map(({ id }) => id), ['websocket_push_transport']);

  const dead = await run('dead-server');
  assert.equal(dead.status, 'infrastructure-error');
  assert.equal(dead.exitCode, 2);
  assert.equal(dead.diagnostic.code, 'SNAPBACK_COMPARATOR_SERVER_DEAD');

  const startupFailure = await runComparatorAcceptance(profile, {
    timeoutMs: 100,
    async startTarget() {
      throw new Error('fixture target refused startup');
    },
  });
  assert.equal(startupFailure.status, 'infrastructure-error');
  assert.equal(startupFailure.exitCode, 2);
  assert.equal(startupFailure.diagnostic.code, 'SNAPBACK_COMPARATOR_SETUP_FAILED');
  assert.equal(startupFailure.identity.target.available, false);
  assert.equal(startupFailure.identity.artifact.available, true);
  assert.equal(startupFailure.identity.binary.available, false);

  const timeout = await run('timeout', { timeoutMs: 10 });
  assert.equal(timeout.status, 'infrastructure-error');
  assert.equal(timeout.exitCode, 2);
  assert.equal(timeout.diagnostic.code, 'SNAPBACK_COMPARATOR_CHECK_TIMEOUT');

  const cleanup = await run('cleanup');
  assert.equal(cleanup.status, 'infrastructure-error');
  assert.equal(cleanup.exitCode, 2);
  assert.equal(cleanup.diagnostic.code, 'SNAPBACK_COMPARATOR_CLEANUP_FAILED');

  let lateClosed = false;
  const lateStartup = await runComparatorAcceptance(profile, {
    timeoutMs: 10,
    async startTarget() {
      await new Promise((resolveWait) => setTimeout(resolveWait, 40));
      return {
        async close() {
          lateClosed = true;
          return {
            ok: true,
            managed: true,
            leaderExited: true,
            temporaryStateRemoved: true,
            errors: [],
          };
        },
      };
    },
  });
  assert.equal(lateStartup.status, 'infrastructure-error');
  assert.equal(lateStartup.diagnostic.code, 'SNAPBACK_COMPARATOR_CHECK_TIMEOUT');
  await new Promise((resolveWait) => setTimeout(resolveWait, 75));
  assert.equal(lateClosed, true, 'a target resolving after startup timeout must still be closed');

  const cleanupStartedAt = Date.now();
  const hangingCleanup = await runComparatorAcceptance(profile, {
    timeoutMs: 20,
    async startTarget() {
      const target = createComparatorFixtureTarget();
      return {
        ...target,
        async close() {
          return await new Promise(() => {});
        },
      };
    },
  });
  assert.equal(hangingCleanup.status, 'infrastructure-error');
  assert.equal(hangingCleanup.diagnostic.code, 'SNAPBACK_COMPARATOR_CLEANUP_FAILED');
  assert.ok(Date.now() - cleanupStartedAt < 500, 'cleanup must remain bounded');

  assert.throws(
    () => validateComparatorReceipt({
      ...green,
      checks: [],
    }),
    /passing receipt is vacuous/,
  );
  assert.throws(
    () => validateComparatorReceipt({
      ...green,
      checks: green.checks.slice(0, -1),
    }),
    /passing receipt is vacuous/,
  );
  assert.throws(
    () => validateComparatorReceipt({
      ...green,
      status: 'failed',
      exitCode: 1,
    }),
    /failed receipt must contain/,
  );
  assert.throws(
    () => validateComparatorReceipt({
      ...unsupported,
      capabilityGaps: [],
    }),
    /unsupported receipt must identify/,
  );
  assert.throws(
    () => validateComparatorReceipt({
      ...green,
      executorPackages: {
        ...green.executorPackages,
        client: {
          ...green.executorPackages.client,
          sha256: `sha256:${'0'.repeat(64)}`,
        },
      },
    }),
    /executing-package identity does not match/,
  );

  const receiptPath = join(root, 'green-receipt.json');
  writeComparatorReceipt(receiptPath, green);
  assert.equal(readComparatorReceipt(receiptPath).profileId, profile.id);
  assert.throws(
    () => readComparatorReceipt(receiptPath, {
      nowMs: green.finishedAtMs + 1_001,
      maxAgeMs: 1_000,
    }),
    /SNAPBACK_COMPARATOR_RECEIPT_STALE/,
  );
  assert.throws(
    () => validateComparatorReceipt(green, {
      expectedIdentity: {
        ...green.identity,
        artifact: { ...green.identity.artifact, bundleHash: 'sha256:stale' },
      },
    }),
    /SNAPBACK_COMPARATOR_IDENTITY_MISMATCH/,
  );

  const cliReceiptPath = join(root, 'cli-receipt.json');
  const cliExit = await runCli([
    'accept',
    'comparator',
    '--config',
    new URL('./fixtures/comparator/green.config.mjs', import.meta.url).pathname,
    '--receipt',
    cliReceiptPath,
    '--json',
  ], {
    comparatorStartTarget: start(),
  });
  assert.equal(cliExit, 0);
  assert.equal(readComparatorReceipt(cliReceiptPath).status, 'passed');
  assert.equal(await runCli([
    'accept',
    'comparator',
    '--verify-receipt',
    cliReceiptPath,
    '--max-age-ms',
    '60000',
    '--json',
  ]), 0);
  const failedReceiptPath = join(root, 'failed-receipt.json');
  writeComparatorReceipt(failedReceiptPath, productFailure);
  assert.equal(await runCli([
    'accept',
    'comparator',
    '--verify-receipt',
    failedReceiptPath,
    '--max-age-ms',
    '60000',
    '--json',
  ]), 1, 'receipt verification must preserve the recorded comparator outcome');

  // Exercise the same no-injected-target path used by an installed
  // `snapback accept comparator` command. The packaged example is
  // intentionally a dev-auth application; this catches attempts to use the
  // unavailable session provider instead of dev body impersonation.
  const packagedDevSchema = JSON.parse(readFileSync(
    new URL('./fixtures/comparator/app/snapback/generated/schema.manifest.json', import.meta.url),
    'utf8',
  ));
  assert.equal(packagedDevSchema.schemaVersion, 'snapback.v0');
  assert.equal(packagedDevSchema.auth ?? null, null);
  const packagedDevReceiptPath = join(root, 'packaged-dev-receipt.json');
  const packagedDevExit = await runCli([
    'accept',
    'comparator',
    '--config',
    new URL('./fixtures/comparator/green.config.mjs', import.meta.url).pathname,
    '--receipt',
    packagedDevReceiptPath,
    '--timeout-ms',
    '15000',
    '--json',
  ]);
  assert.equal(packagedDevExit, 0);
  const packagedDevReceipt = readComparatorReceipt(packagedDevReceiptPath);
  assert.equal(packagedDevReceipt.status, 'passed');
  assert.equal(packagedDevReceipt.identity.target.available, true);
  assert.equal(packagedDevReceipt.identity.binary.available, true);
  assert.deepEqual(packagedDevReceipt.checks[0].details.identitySources, {
    observer: 'dev-asserted',
    actor: 'dev-asserted',
  });
  assert.deepEqual(
    packagedDevReceipt.checks.map(({ id, status }) => ({ id, status })),
    COMPARATOR_CHECKS.map(({ id }) => ({ id, status: 'passed' })),
  );
  assert.equal(packagedDevReceipt.cleanup.ok, true);

  const packageManifest = JSON.parse(readFileSync(new URL('./package.json', import.meta.url), 'utf8'));
  assert.equal(packageManifest.exports['./comparator'], './comparator-profile.mjs');
  assert.equal(
    packageManifest.exports['./comparator-receipt.schema.json'],
    './comparator-receipt.schema.json',
  );
  const source = readFileSync(new URL('./comparator-profile.mjs', import.meta.url), 'utf8');
  assert.doesNotMatch(source, /demos\//, 'published comparator must not import repository-private demo code');

  const pack = spawnSync('npm', ['pack', '--dry-run', '--json', '--ignore-scripts'], {
    cwd: new URL('.', import.meta.url),
    encoding: 'utf8',
  });
  assert.equal(pack.status, 0, pack.stderr);
  const packedFiles = JSON.parse(pack.stdout)[0].files.map(({ path }) => path);
  for (const path of [
    'comparator-profile.mjs',
    'comparator-receipt.schema.json',
    'fixtures/comparator/green.config.mjs',
  ]) {
    assert.ok(packedFiles.includes(path), `${path} missing from packed package`);
  }

  // Schema and code own the same closed top-level shape.
  const schema = JSON.parse(
    readFileSync(new URL('./comparator-receipt.schema.json', import.meta.url), 'utf8'),
  );
  assert.equal(schema.additionalProperties, false);
  assert.deepEqual(schema.required.sort(), Object.keys(green).sort());
  const validateSchema = new Ajv2020({ allErrors: true }).compile(schema);
  assert.equal(validateSchema(green), true, JSON.stringify(validateSchema.errors));
  assert.equal(validateSchema(dead), true, JSON.stringify(validateSchema.errors));
  assert.equal(validateSchema(startupFailure), true, JSON.stringify(validateSchema.errors));
  assert.equal(validateSchema({ ...green, status: 'failed', exitCode: 1 }), false);
  assert.equal(validateSchema({ ...unsupported, capabilityGaps: [] }), false);

  // A malformed receipt must not be created by a later fixture rewrite.
  const malformed = join(root, 'malformed.json');
  writeFileSync(malformed, '{}\n');
  assert.throws(() => readComparatorReceipt(malformed), /SNAPBACK_COMPARATOR_RECEIPT_INVALID/);

  console.log('snapback comparator profile package tests: ok');
} finally {
  rmSync(root, { recursive: true, force: true });
}

import assert from 'node:assert/strict';
import {
  existsSync,
  mkdtempSync,
  readFileSync,
  rmSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';

import {
  BARRIER_STABILITY_RESERVE_MS,
  CURRENT_LEASE_SCHEMA_VERSION,
  LEASE_ISSUED_AT_SKEW_ALLOWANCE_MS,
  LEASE_LIFETIME_MS,
  MODELED_TAG_MOVE_PHASE_MS,
  PROMOTION_ROLLBACK_RESERVE_MS,
  canonicalJcs,
  leaseSha256,
  sha256Hex,
  validateClosedLatestProofPlan,
} from './snapback-promotion-core.mjs';
import {
  PACKAGE_INVENTORY,
  PROMOTION_PACKAGE_NAMES,
} from './snapback-publish-core.mjs';
import {
  buildLatestProofPlan,
  writeLatestProofPlan,
} from './snapback-generate-latest-proof-plan.mjs';

const repositoryRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const historicalLedgerFile = resolve(
  repositoryRoot,
  'demos/partiful-matrix/acceptance/evidence/terminal-package-publication-0.1.7-fdd49db8.json',
);
const ledgerFile = resolve(repositoryRoot, 'test-fixtures/current-candidate-ledger.json');
const historicalLedger = JSON.parse(readFileSync(historicalLedgerFile, 'utf8'));
const rowsByName = new Map(historicalLedger.packages.map((row) => [row.name, row]));
const ledger = structuredClone(historicalLedger);
ledger.packages = PACKAGE_INVENTORY.map(([sourceName, name], publicationOrder) => {
  const existing = rowsByName.get(name);
  if (existing) return { ...existing, publicationOrder };
  const sha256 = '5'.repeat(64);
  return {
    publicationOrder,
    sourceName,
    name,
    version: ledger.version,
    dependencies: { '@expo/snapback-react': ledger.version },
    optionalDependencies: {},
    peerDependencies: {},
    devDependencies: {},
    tarball: 'expo-snapback-expo-0.1.7.tgz',
    sha256,
    runtimeBinarySha256: null,
    runtimeSupportSha256: null,
    files: 1,
    unpackedSize: 1,
    status: 'published',
    candidateTagVerified: true,
    registrySha256: sha256,
    registryIntegrity: 'sha512-test-fixture-integrity',
    registryShasum: '6'.repeat(40),
  };
});
delete ledger.candidateLedgerSha256;
ledger.candidateLedgerSha256 = sha256Hex(canonicalJcs(ledger));
const expectedHeadSha = '1'.repeat(40);
const helperSha256 = '2'.repeat(64);

function leaseFixture() {
  return {
    schemaVersion: CURRENT_LEASE_SCHEMA_VERSION,
    authorityInstallationId: 'latest-plan-test-authority',
    authorityOrigin: 'https://publication-authority.example',
    signingKeyId: '3'.repeat(64),
    operationId: 'latest-plan-generator-test',
    publisherInstanceId: 'latest-plan-test-publisher',
    publicationEpoch: 23,
    candidateLedgerSha256: ledger.candidateLedgerSha256,
    candidateTag: ledger.tag,
    defaultTag: 'latest',
    priorDefaultClosureReceiptSha256: '4'.repeat(64),
    issuedAt: '2026-08-07T12:00:00.000Z',
    expiresAt: '2026-08-07T12:15:00.000Z',
    packages: PROMOTION_PACKAGE_NAMES.map((name) => ({
      name,
      expectedPriorVersion: '0.1.6',
      newVersion: ledger.version,
    })),
    signature: 'fixture-signature',
  };
}

function inputs(overrides = {}) {
  return {
    lease: leaseFixture(),
    ledger,
    ledgerFile,
    repositoryRoot,
    expectedHeadSha,
    helperSha256,
    now: Date.parse('2026-08-07T12:05:00.000Z'),
    ...overrides,
  };
}

test('generated latest proof plan round-trips through the promoter validator', () => {
  const lease = leaseFixture();
  const plan = buildLatestProofPlan(inputs({ lease }));
  const expectedLedgerPath = 'test-fixtures/current-candidate-ledger.json';
  assert.equal(plan.ledgerPath, expectedLedgerPath);
  assert.equal(plan.expectedPriorRootVersion, '0.1.6');
  assert.equal(
    validateClosedLatestProofPlan({
      plan,
      expectedOperationId: lease.operationId,
      expectedHelperSha256: helperSha256,
      expectedLedgerPath,
      expectedHeadSha,
      expectedPriorRootVersion: '0.1.6',
      expectedAuthorizedLeaseSha256: leaseSha256(lease),
      expectedPublicationEpoch: lease.publicationEpoch,
    }),
    plan,
  );
});

test('default latest proof plan closes its modeled 900-second lease budget', () => {
  const plan = buildLatestProofPlan(inputs());
  const totalMs =
    plan.dispatchTimeoutMs
    + plan.verifyTimeoutMs
    + PROMOTION_ROLLBACK_RESERVE_MS
    + BARRIER_STABILITY_RESERVE_MS
    + MODELED_TAG_MOVE_PHASE_MS;
  assert.equal(plan.dispatchTimeoutMs, 400_000);
  assert.equal(BARRIER_STABILITY_RESERVE_MS, 120_000);
  assert.equal(totalMs, 790_000);
  assert.ok(totalMs <= LEASE_LIFETIME_MS);
});

test('latest proof plan refuses the old 540-second dispatch default', () => {
  assert.throws(
    () => buildLatestProofPlan(inputs({ dispatchTimeoutMs: 540_000 })),
    (error) => {
      assert.match(error.message, /modeled publication lease budget cannot close/u);
      assert.match(error.message, /dispatchTimeoutMs=540000/u);
      assert.match(error.message, /verifyTimeoutMs=30000/u);
      assert.match(error.message, /PROMOTION_ROLLBACK_RESERVE_MS=120000/u);
      assert.match(error.message, /BARRIER_STABILITY_RESERVE_MS=120000/u);
      assert.match(error.message, /MODELED_TAG_MOVE_PHASE_MS=120000/u);
      assert.match(error.message, /= 930000 > LEASE_LIFETIME_MS=900000/u);
      return true;
    },
  );
});

test('latest proof plan accepts the largest dispatch budget that still closes', () => {
  const verifyTimeoutMs = 30_000;
  const largestDispatchTimeoutMs =
    LEASE_LIFETIME_MS
    - verifyTimeoutMs
    - PROMOTION_ROLLBACK_RESERVE_MS
    - BARRIER_STABILITY_RESERVE_MS
    - MODELED_TAG_MOVE_PHASE_MS;
  const plan = buildLatestProofPlan(inputs({
    dispatchTimeoutMs: largestDispatchTimeoutMs,
    verifyTimeoutMs,
  }));
  assert.equal(plan.dispatchTimeoutMs, 510_000);
  assert.throws(
    () => buildLatestProofPlan(inputs({
      dispatchTimeoutMs: largestDispatchTimeoutMs + 1,
      verifyTimeoutMs,
    })),
    /modeled publication lease budget cannot close/u,
  );
});

test('latest proof plan refuses missing or unusable prior CLI roots before writing', () => {
  const root = mkdtempSync(join(tmpdir(), 'snapback-latest-plan-cli-test-'));
  try {
    const mutations = [
      {
        message: /no @expo\/snapback-cli lease row/u,
        mutate(lease) {
          lease.packages = lease.packages.filter(
            (row) => row.name !== '@expo/snapback-cli',
          );
        },
      },
      {
        message: /no signed prior CLI root version/u,
        mutate(lease) {
          lease.packages.find(
            (row) => row.name === '@expo/snapback-cli',
          ).expectedPriorVersion = null;
        },
      },
      {
        message: /prior CLI root distinct from the new version/u,
        mutate(lease) {
          const row = lease.packages.find(
            (candidate) => candidate.name === '@expo/snapback-cli',
          );
          row.expectedPriorVersion = row.newVersion;
        },
      },
    ];
    for (const [index, { message, mutate }] of mutations.entries()) {
      const lease = leaseFixture();
      mutate(lease);
      const out = join(root, `${index}.json`);
      assert.throws(
        () => writeLatestProofPlan({ out, ...inputs({ lease }) }),
        message,
      );
      assert.equal(existsSync(out), false);
    }
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test('latest proof plan refuses a candidate ledger path outside the repository', () => {
  const root = mkdtempSync(join(tmpdir(), 'snapback-latest-plan-ledger-test-'));
  try {
    const out = join(root, 'plan.json');
    assert.throws(
      () => writeLatestProofPlan({
        out,
        ...inputs({ ledgerFile: join(root, 'candidate-ledger.json') }),
      }),
      /ledger path must be inside the repository root/u,
    );
    assert.equal(existsSync(out), false);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test('latest proof plan refuses absolute and parent-traversing output paths', () => {
  const root = mkdtempSync(join(tmpdir(), 'snapback-latest-plan-path-test-'));
  try {
    const invalidPaths = [
      { field: 'darwinReceipt', value: '/tmp/darwin.json' },
      { field: 'linuxReceipt', value: 'proof/../linux.json' },
      { field: 'collection', value: '../collection.json' },
    ];
    for (const [index, { field, value }] of invalidPaths.entries()) {
      const out = join(root, `${index}.json`);
      assert.throws(
        () => writeLatestProofPlan({
          out,
          ...inputs({ [field]: value }),
        }),
        /must be a normalized relative POSIX path/u,
      );
      assert.equal(existsSync(out), false);
    }
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test('latest proof plan refuses a lease bound to a different candidate ledger', () => {
  const lease = leaseFixture();
  lease.candidateLedgerSha256 = 'f'.repeat(64);
  assert.throws(
    () => buildLatestProofPlan(inputs({ lease })),
    /lease is not bound to the candidate ledger/u,
  );
});

test('latest proof plan tolerates bounded authority-ahead skew but not more', () => {
  const issuedAt = Date.parse(leaseFixture().issuedAt);
  // Plan generation moments after issuance with the local clock trailing the
  // authority's issuedAt stamp by less than the allowance must build.
  buildLatestProofPlan(inputs({ now: issuedAt - 100 }));
  buildLatestProofPlan(inputs({ now: issuedAt - LEASE_ISSUED_AT_SKEW_ALLOWANCE_MS }));
  assert.throws(
    () => buildLatestProofPlan(
      inputs({ now: issuedAt - LEASE_ISSUED_AT_SKEW_ALLOWANCE_MS - 1 }),
    ),
    /authorized lease is not current/u,
  );
});

test('latest proof plan refuses a stale lease before writing', () => {
  const root = mkdtempSync(join(tmpdir(), 'snapback-latest-plan-stale-test-'));
  try {
    const out = join(root, 'plan.json');
    assert.throws(
      () => writeLatestProofPlan({
        out,
        ...inputs({ now: Date.parse('2026-08-07T12:15:00.000Z') }),
      }),
      /authorized lease is not current/u,
    );
    assert.equal(existsSync(out), false);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

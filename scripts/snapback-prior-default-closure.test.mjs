import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import {
  appendFileSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  renameSync,
  rmSync,
  symlinkSync,
  truncateSync,
  writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';

import {
  canonicalJcs,
  sha256Hex,
} from '../packages/snapback-publication-authority/protocol.mjs';
import {
  PUBLIC_NPM_REGISTRY,
  LEGACY_PROMOTION_PACKAGE_NAMES,
  PROMOTION_PACKAGE_NAMES,
} from './snapback-publish-core.mjs';
import {
  observeDefaultTagVector,
  validatePriorDefaultClosureReceipt,
} from './snapback-prior-default-closure.mjs';

const ledger = JSON.parse(readFileSync(
  new URL(
    '../demos/partiful-matrix/acceptance/evidence/step5-package-publication.json',
    import.meta.url,
  ),
  'utf8',
));
const helperBytes = readFileSync(
  new URL('./snapback-prior-default-closure.mjs', import.meta.url),
);

function sha(bytes, algorithm, encoding = 'hex') {
  return createHash(algorithm).update(bytes).digest(encoding);
}

function fixture(root, dependencies = {}) {
  const receiptPath = join(root, 'prior-default-closure.json');
  const artifactRoot = `${receiptPath}.artifacts`;
  const packageRoot = join(root, 'package-source', 'package');
  mkdirSync(packageRoot, { recursive: true });
  mkdirSync(artifactRoot, { recursive: true });
  const firstName = LEGACY_PROMOTION_PACKAGE_NAMES[0];
  const manifestBytes = Buffer.from(JSON.stringify({
    name: firstName,
    version: '0.1.0',
    dependencies,
    optionalDependencies: {},
    peerDependencies: {},
    devDependencies: {},
  }));
  writeFileSync(join(packageRoot, 'package.json'), manifestBytes);
  const tarball = join(artifactRoot, '00.tgz');
  execFileSync('tar', ['-czf', tarball, '-C', join(root, 'package-source'), 'package']);
  const tarballBytes = readFileSync(tarball);
  const priorVector = Object.fromEntries(
    LEGACY_PROMOTION_PACKAGE_NAMES.map((name, index) => [
      name,
      index === 0 ? '0.1.0' : null,
    ]),
  );
  const dependencySections = {
    dependencies,
    optionalDependencies: {},
    peerDependencies: {},
    devDependencies: {},
  };
  const packages = LEGACY_PROMOTION_PACKAGE_NAMES.map((name, index) => (
    index === 0
      ? {
        name,
        version: '0.1.0',
        status: 'verified',
        rollbackAction: 'restore',
        tarballFile: '00.tgz',
        tarballSha256: sha(tarballBytes, 'sha256'),
        registryIntegrity: `sha512-${sha(tarballBytes, 'sha512', 'base64')}`,
        registryShasum: sha(tarballBytes, 'sha1'),
        manifestSha256: sha256Hex(manifestBytes),
        dependencySections,
        dependencyAliases: [],
      }
      : {
        name,
        version: null,
        status: 'absent',
        rollbackAction: 'remove',
        tarballFile: null,
        tarballSha256: null,
        registryIntegrity: null,
        registryShasum: null,
        manifestSha256: null,
        dependencySections: null,
        dependencyAliases: [],
      }
  ));
  const receipt = {
    schemaVersion: 'snapback.prior-default-closure.v2',
    policyVersion: 'snapback.prior-default-closure-policy.v2',
    registry: PUBLIC_NPM_REGISTRY,
    defaultTag: 'latest',
    candidateLedgerSha256: ledger.candidateLedgerSha256,
    candidateTag: ledger.tag,
    sourceRevision: ledger.revision,
    producerRevision: ledger.revision,
    helperSha256: sha256Hex(helperBytes),
    operationId: 'prior-closure-test-operation',
    publisherInstanceId: 'prior-closure-test-publisher',
    startedAt: '2026-07-29T20:00:00.000Z',
    completedAt: '2026-07-29T20:00:01.000Z',
    initialVector: priorVector,
    finalVector: priorVector,
    packages,
  };
  receipt.receiptSha256 = sha256Hex(canonicalJcs(receipt));
  return { receipt, receiptPath, priorVector, tarball };
}

test('prior closure brackets an E404 umbrella as an absent package', () => {
  const vector = observeDefaultTagVector(PROMOTION_PACKAGE_NAMES, (args) => (
    args[1] === '@expo/snapback'
      ? null
      : JSON.stringify({ latest: '0.1.20' })
  ));
  assert.deepEqual(Object.keys(vector), [...PROMOTION_PACKAGE_NAMES]);
  assert.equal(vector['@expo/snapback'], null);
  assert.equal(vector['@expo/snapback-cli'], '0.1.20');
});

test('prior closure brackets an E404 Expo custody package as absent', () => {
  const vector = observeDefaultTagVector(PROMOTION_PACKAGE_NAMES, (args) => (
    args[1] === '@expo/snapback-expo-custody'
      ? null
      : JSON.stringify({ latest: '0.1.23' })
  ));
  assert.deepEqual(Object.keys(vector), [...PROMOTION_PACKAGE_NAMES]);
  assert.equal(vector['@expo/snapback-expo-custody'], null);
  assert.equal(vector['@expo/snapback-cli'], '0.1.23');
});

test('prior closure independently reopens complete retained tarball evidence', () => {
  const root = mkdtempSync(join(tmpdir(), 'snapback-prior-closure-test-'));
  try {
    const value = fixture(root);
    const validated = validatePriorDefaultClosureReceipt({
      receipt: value.receipt,
      receiptPath: value.receiptPath,
      ledger,
      expectedPriorVector: value.priorVector,
      operationId: value.receipt.operationId,
      publisherInstanceId: value.receipt.publisherInstanceId,
      issuedAt: '2026-07-29T20:00:02.000Z',
    });
    assert.equal(validated, value.receipt);

    const incomplete = structuredClone(value.receipt);
    incomplete.packages[0].dependencySections.dependencies.injected = '1.0.0';
    const unsigned = structuredClone(incomplete);
    delete unsigned.receiptSha256;
    incomplete.receiptSha256 = sha256Hex(canonicalJcs(unsigned));
    assert.throws(
      () => validatePriorDefaultClosureReceipt({
        receipt: incomplete,
        receiptPath: value.receiptPath,
        ledger,
        expectedPriorVector: value.priorVector,
        operationId: value.receipt.operationId,
        publisherInstanceId: value.receipt.publisherInstanceId,
        issuedAt: '2026-07-29T20:00:02.000Z',
      }),
      /dependency evidence is incomplete/u,
    );

    appendFileSync(value.tarball, 'tamper');
    assert.throws(
      () => validatePriorDefaultClosureReceipt({
        receipt: value.receipt,
        receiptPath: value.receiptPath,
        ledger,
        expectedPriorVector: value.priorVector,
        operationId: value.receipt.operationId,
        publisherInstanceId: value.receipt.publisherInstanceId,
        issuedAt: '2026-07-29T20:00:02.000Z',
      }),
      /tarball digest drifted/u,
    );
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test('prior closure freshness and signed operation identity fail closed', () => {
  const root = mkdtempSync(join(tmpdir(), 'snapback-prior-closure-time-test-'));
  try {
    const value = fixture(root);
    assert.throws(
      () => validatePriorDefaultClosureReceipt({
        receipt: value.receipt,
        receiptPath: value.receiptPath,
        ledger,
        expectedPriorVector: value.priorVector,
        operationId: 'different-prior-closure-operation',
        publisherInstanceId: value.receipt.publisherInstanceId,
        issuedAt: '2026-07-29T20:00:02.000Z',
      }),
      /identity, vector, timing, producer, or digest drifted/u,
    );
    assert.throws(
      () => validatePriorDefaultClosureReceipt({
        receipt: value.receipt,
        receiptPath: value.receiptPath,
        ledger,
        expectedPriorVector: value.priorVector,
        operationId: value.receipt.operationId,
        publisherInstanceId: value.receipt.publisherInstanceId,
        issuedAt: '2026-07-29T20:03:00.000Z',
      }),
      /not completed immediately before lease issue/u,
    );
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test('retained tarballs reject a source-package alias hidden under another key', () => {
  const root = mkdtempSync(join(tmpdir(), 'snapback-prior-closure-alias-test-'));
  try {
    const value = fixture(root, {
      hidden: 'npm:@snapback/client@0.1.0',
    });
    assert.throws(
      () => validatePriorDefaultClosureReceipt({
        receipt: value.receipt,
        receiptPath: value.receiptPath,
        ledger,
        expectedPriorVector: value.priorVector,
        operationId: value.receipt.operationId,
        publisherInstanceId: value.receipt.publisherInstanceId,
        issuedAt: '2026-07-29T20:00:02.000Z',
      }),
      /non-exact Snapback alias/u,
    );
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test('retained tarball admission refuses oversized files and symlinks before hashing', () => {
  const oversizedRoot = mkdtempSync(join(tmpdir(), 'snapback-prior-closure-size-test-'));
  try {
    const oversized = fixture(oversizedRoot);
    truncateSync(oversized.tarball, 256 * 1024 * 1024 + 1);
    assert.throws(
      () => validatePriorDefaultClosureReceipt({
        receipt: oversized.receipt,
        receiptPath: oversized.receiptPath,
        ledger,
        expectedPriorVector: oversized.priorVector,
        operationId: oversized.receipt.operationId,
        publisherInstanceId: oversized.receipt.publisherInstanceId,
        issuedAt: '2026-07-29T20:00:02.000Z',
      }),
      /size is outside the closure bound/u,
    );
  } finally {
    rmSync(oversizedRoot, { recursive: true, force: true });
  }

  const symlinkRoot = mkdtempSync(join(tmpdir(), 'snapback-prior-closure-link-test-'));
  try {
    const linked = fixture(symlinkRoot);
    const target = `${linked.tarball}.real`;
    renameSync(linked.tarball, target);
    symlinkSync(target, linked.tarball);
    assert.throws(
      () => validatePriorDefaultClosureReceipt({
        receipt: linked.receipt,
        receiptPath: linked.receiptPath,
        ledger,
        expectedPriorVector: linked.priorVector,
        operationId: linked.receipt.operationId,
        publisherInstanceId: linked.receipt.publisherInstanceId,
        issuedAt: '2026-07-29T20:00:02.000Z',
      }),
      /tarball must be a real file/u,
    );
  } finally {
    rmSync(symlinkRoot, { recursive: true, force: true });
  }
});

test('request and promoter preserve the no-lease qualification sequence', () => {
  const requestSource = readFileSync(
    new URL('./snapback-request-publication-lease.mjs', import.meta.url),
    'utf8',
  );
  assert.ok(
    requestSource.indexOf('materializePriorDefaultClosure({')
      < requestSource.indexOf('`${options.authorityUrl}/v1/head`'),
  );
  assert.ok(
    requestSource.indexOf('`${options.authorityUrl}/v1/head`')
      < requestSource.indexOf('`${options.authorityUrl}/v1/leases/issue`'),
  );
  const promoterSource = readFileSync(
    new URL('./snapback-promote.mjs', import.meta.url),
    'utf8',
  );
  assert.doesNotMatch(promoterSource, /['"]pack['"]/u);
  assert.ok(
    promoterSource.indexOf('const preAcquireVector = await readVector(')
      < promoterSource.indexOf("'/v1/leases/acquire'"),
  );
  assert.ok(
    promoterSource.indexOf('const reopenedPlan = loadLatestProofPlan();')
      < promoterSource.indexOf(
        'requireLatestProofDispatchBudget(reopenedPlan, mode);',
      ),
  );
  assert.ok(
    promoterSource.indexOf('requireLatestProofDispatchBudget(reopenedPlan, mode);')
      < promoterSource.indexOf('const result = spawnSync(process.execPath'),
  );
});

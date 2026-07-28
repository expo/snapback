import { createHash } from 'node:crypto';
import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';

import { canonicalJcs, sha256Hex } from './snapback-promotion-core.mjs';

// @ref LLP 0041#nine-package-candidate-promotion--2026-07-28 — the public
// closure is an exact source/public-name vector whose qualified bytes are
// consumed unchanged by candidate publication.
// @ref LLP 0041#unreviewed-post-round-correction-publication-lease-and-rollback
// — closed ledgers and complete platform receipts prevent local credentials
// from silently becoming publication authority.
export const PUBLIC_NPM_REGISTRY = 'https://registry.npmjs.org';

export const PACKAGE_INVENTORY = Object.freeze([
  ['@snapback/runtime-darwin-arm64', '@ccheever/snapback-runtime-darwin-arm64'],
  ['@snapback/runtime-linux-x64', '@ccheever/snapback-runtime-linux-x64'],
  ['@snapback/contract', '@ccheever/snapback-contract'],
  ['@snapback/client', '@ccheever/snapback-client'],
  ['@snapback/codegen', '@ccheever/snapback-codegen'],
  ['@snapback/react', '@ccheever/snapback-react'],
  ['@snapback/app-cli', '@ccheever/snapback-app-cli'],
  ['@snapback/cli', '@ccheever/snapback-cli'],
  ['@snapback/vite', '@ccheever/snapback-vite'],
]);

export const PROMOTION_PACKAGE_NAMES = Object.freeze([
  '@ccheever/snapback-runtime-darwin-arm64',
  '@ccheever/snapback-runtime-linux-x64',
  '@ccheever/snapback-contract',
  '@ccheever/snapback-client',
  '@ccheever/snapback-codegen',
  '@ccheever/snapback-vite',
  '@ccheever/snapback-react',
  '@ccheever/snapback-app-cli',
  '@ccheever/snapback-cli',
]);

const QUALIFIED_LEDGER_KEYS = [
  'mode',
  'packages',
  'registry',
  'revision',
  'runtimePlatforms',
  'schemaVersion',
  'scopePreset',
  'sourceDirty',
  'stagedLedgerSha256',
  'tag',
  'version',
];
const CANDIDATE_LEDGER_KEYS = [
  'candidateLedgerSha256',
  'mode',
  'packages',
  'qualifiedLedgerSha256',
  'qualifiedPlatformReceipts',
  'registry',
  'revision',
  'runtimePlatforms',
  'schemaVersion',
  'scopePreset',
  'sourceDirty',
  'tag',
  'version',
];
const QUALIFIED_PACKAGE_KEYS = [
  'dependencies',
  'files',
  'name',
  'optionalDependencies',
  'publicationOrder',
  'runtimeBinarySha256',
  'runtimeSupportSha256',
  'sha256',
  'sourceName',
  'status',
  'tarball',
  'unpackedSize',
  'version',
];
const CANDIDATE_PACKAGE_KEYS = [
  'candidateTagVerified',
  'dependencies',
  'files',
  'name',
  'optionalDependencies',
  'publicationOrder',
  'registryIntegrity',
  'registrySha256',
  'registryShasum',
  'runtimeBinarySha256',
  'runtimeSupportSha256',
  'sha256',
  'sourceName',
  'status',
  'tarball',
  'unpackedSize',
  'version',
];
const PLATFORM_RECEIPT_KEYS = ['platform', 'sha256'];

function requireExactKeys(value, keys, field) {
  if (value === null || typeof value !== 'object' || Array.isArray(value)) {
    throw new TypeError(`${field} must be an object`);
  }
  const actual = Object.keys(value).sort();
  const expected = [...keys].sort();
  if (
    actual.length !== expected.length
    || actual.some((key, index) => key !== expected[index])
  ) {
    throw new TypeError(`${field} has unknown or missing members`);
  }
}

function assertSha256(value, field) {
  if (!/^[0-9a-f]{64}$/u.test(value ?? '')) {
    throw new TypeError(`${field} must be a lowercase SHA-256`);
  }
}

function assertSemver(value, field) {
  if (!/^\d+\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?$/u.test(value ?? '')) {
    throw new TypeError(`${field} must be an exact semver`);
  }
}

function withoutField(value, field) {
  const clone = { ...value };
  delete clone[field];
  return clone;
}

function assertInternalDependencyClosure(row, version) {
  const publicNames = new Set(PACKAGE_INVENTORY.map(([, name]) => name));
  const publicBySource = new Map(PACKAGE_INVENTORY);
  for (const [section, entries] of [
    ['dependencies', row.dependencies],
    ['optionalDependencies', row.optionalDependencies],
  ]) {
    if (entries === null || typeof entries !== 'object' || Array.isArray(entries)) {
      throw new TypeError(`${row.name}.${section} must be an object`);
    }
    for (const [dependency, value] of Object.entries(entries)) {
      if (/^(?:workspace:|file:|link:)/u.test(String(value))) {
        throw new TypeError(`${row.name}.${section}.${dependency} is not registry-closed`);
      }
      const alias = String(value).match(
        /^npm:(@ccheever\/snapback-[a-z0-9-]+)@(\d+\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?)$/u,
      );
      if (String(value).includes('@ccheever/snapback-') && !alias) {
        throw new TypeError(`${row.name}.${section}.${dependency} is not an exact alias`);
      }
      if (publicBySource.has(dependency)
          && (!alias || alias[1] !== publicBySource.get(dependency))) {
        throw new TypeError(`${row.name}.${section}.${dependency} is not the decided public alias`);
      }
      if (dependency.startsWith('@snapback/') && !publicBySource.has(dependency)) {
        throw new TypeError(`${row.name}.${section}.${dependency} is outside the package inventory`);
      }
      if (alias && (!publicNames.has(alias[1]) || alias[2] !== version)) {
        throw new TypeError(`${row.name}.${section}.${dependency} escapes the candidate vector`);
      }
    }
  }
}

function validatePackageRows(ledger, keys, statuses) {
  if (!Array.isArray(ledger.packages) || ledger.packages.length !== PACKAGE_INVENTORY.length) {
    throw new TypeError('ledger is not the exact nine-package closure');
  }
  for (const [index, [sourceName, name]] of PACKAGE_INVENTORY.entries()) {
    const row = ledger.packages[index];
    requireExactKeys(row, keys, `package row ${index}`);
    if (
      row.publicationOrder !== index
      || row.sourceName !== sourceName
      || row.name !== name
      || row.version !== ledger.version
    ) {
      throw new TypeError(`package row ${index} is outside the closed inventory/order`);
    }
    if (!statuses.has(row.status)) {
      throw new TypeError(`package row ${index} has an ineligible status`);
    }
    assertSha256(row.sha256, `${row.name}.sha256`);
    if (!Number.isSafeInteger(row.files) || row.files <= 0
        || !Number.isSafeInteger(row.unpackedSize) || row.unpackedSize <= 0) {
      throw new TypeError(`${row.name} has invalid pack measurements`);
    }
    if (typeof row.tarball !== 'string' || !/^[A-Za-z0-9._-]+\.tgz$/u.test(row.tarball)) {
      throw new TypeError(`${row.name}.tarball is invalid`);
    }
    const runtime = sourceName.startsWith('@snapback/runtime-');
    for (const [field, value] of [
      ['runtimeBinarySha256', row.runtimeBinarySha256],
      ['runtimeSupportSha256', row.runtimeSupportSha256],
    ]) {
      if (runtime) assertSha256(value, `${row.name}.${field}`);
      else if (value !== null) throw new TypeError(`${row.name}.${field} must be null`);
    }
    assertInternalDependencyClosure(row, ledger.version);
  }
}

function validateCommonLedger(ledger) {
  if (
    ledger.registry !== PUBLIC_NPM_REGISTRY
    || ledger.scopePreset !== 'ccheever'
    || ledger.sourceDirty !== false
    || !/^[0-9a-f]{40}$/u.test(ledger.revision ?? '')
  ) {
    throw new TypeError('ledger source/registry identity is not release eligible');
  }
  assertSemver(ledger.version, 'ledger.version');
  const expectedTag = `bakeoff-${ledger.version.replaceAll('.', '-')}-${ledger.revision.slice(0, 12)}`;
  if (ledger.tag !== expectedTag) throw new TypeError('ledger candidate tag is not source-bound');
  if (
    !Array.isArray(ledger.runtimePlatforms)
    || ledger.runtimePlatforms.length !== 2
    || ledger.runtimePlatforms[0] !== 'darwin-arm64'
    || ledger.runtimePlatforms[1] !== 'linux-x64'
  ) {
    throw new TypeError('ledger runtime platform matrix is not closed');
  }
}

export function validateQualifiedStagingLedger(ledger) {
  requireExactKeys(ledger, QUALIFIED_LEDGER_KEYS, 'qualified staging ledger');
  if (
    ledger.schemaVersion !== 'snapback.package-qualified-staging-ledger.v1'
    || ledger.mode !== 'dry-run'
  ) {
    throw new TypeError('unsupported qualified staging ledger');
  }
  validateCommonLedger(ledger);
  validatePackageRows(ledger, QUALIFIED_PACKAGE_KEYS, new Set(['dry-run-ok']));
  assertSha256(ledger.stagedLedgerSha256, 'stagedLedgerSha256');
  if (ledger.stagedLedgerSha256 !== sha256Hex(canonicalJcs(withoutField(
    ledger,
    'stagedLedgerSha256',
  )))) {
    throw new TypeError('qualified staging ledger self-digest mismatch');
  }
  return ledger;
}

export function validateCandidateLedger(ledger) {
  requireExactKeys(ledger, CANDIDATE_LEDGER_KEYS, 'candidate ledger');
  if (
    ledger.schemaVersion !== 'snapback.package-candidate-ledger.v1'
    || ledger.mode !== 'publish'
  ) {
    throw new TypeError('unsupported candidate ledger');
  }
  validateCommonLedger(ledger);
  validatePackageRows(
    ledger,
    CANDIDATE_PACKAGE_KEYS,
    new Set(['published', 'skipped-already-published']),
  );
  assertSha256(ledger.qualifiedLedgerSha256, 'qualifiedLedgerSha256');
  if (
    !Array.isArray(ledger.qualifiedPlatformReceipts)
    || ledger.qualifiedPlatformReceipts.length !== 2
  ) {
    throw new TypeError('candidate ledger must retain two qualified platform receipts');
  }
  for (const [index, platform] of ['darwin-arm64', 'linux-x64'].entries()) {
    const row = ledger.qualifiedPlatformReceipts[index];
    requireExactKeys(row, PLATFORM_RECEIPT_KEYS, `qualified platform receipt ${index}`);
    if (row.platform !== platform) {
      throw new TypeError('qualified platform receipt order/identity drifted');
    }
    assertSha256(row.sha256, `${platform} receipt sha256`);
  }
  for (const row of ledger.packages) {
    if (row.candidateTagVerified !== true) {
      throw new TypeError(`${row.name} candidate tag was not verified`);
    }
    assertSha256(row.registrySha256, `${row.name}.registrySha256`);
    if (row.registrySha256 !== row.sha256) {
      throw new TypeError(`${row.name} registry bytes differ from qualified bytes`);
    }
    if (typeof row.registryIntegrity !== 'string' || row.registryIntegrity.length < 16
        || typeof row.registryShasum !== 'string' || !/^[0-9a-f]{40}$/u.test(row.registryShasum)) {
      throw new TypeError(`${row.name} registry integrity is incomplete`);
    }
  }
  assertSha256(ledger.candidateLedgerSha256, 'candidateLedgerSha256');
  if (ledger.candidateLedgerSha256 !== sha256Hex(canonicalJcs(withoutField(
    ledger,
    'candidateLedgerSha256',
  )))) {
    throw new TypeError('candidate ledger self-digest mismatch');
  }
  return ledger;
}

export function validateQualifiedPlatformReceipts({ ledger, records }) {
  validateQualifiedStagingLedger(ledger);
  if (!Array.isArray(records) || records.length !== 2) {
    throw new TypeError('real publication requires exactly two staged platform receipts');
  }
  const byPlatform = new Map();
  for (const record of records) {
    const receipt = record.receipt;
    if (
      receipt?.schemaVersion !== 'snapback.package-cold-install.v1'
      || receipt.ok !== true
      || receipt.installSource !== 'staged'
      || receipt.rootSelector !== 'exact'
      || receipt.publicationLedgerSchema !== ledger.schemaVersion
      || receipt.sourceRevision !== ledger.revision
      || receipt.sourceDirty !== false
      || receipt.version !== ledger.version
      || receipt.scopePreset !== ledger.scopePreset
      || receipt.machine?.separatelyProvisionedCleanMachine !== true
      || receipt.checks?.stagedRegistryAliasResolution !== true
      || receipt.checks?.noSiblingSourceCheckout !== true
    ) {
      throw new TypeError('staged platform receipt is not a clean qualified proof');
    }
    const platform = `${receipt.machine.platform}-${receipt.machine.architecture}`;
    if (!['darwin-arm64', 'linux-x64'].includes(platform) || byPlatform.has(platform)) {
      throw new TypeError(`duplicate or unsupported staged platform receipt: ${platform}`);
    }
    const receiptRows = new Map((receipt.packages ?? []).map((row) => [row.sourceName, row]));
    if (receiptRows.size !== PACKAGE_INVENTORY.length) {
      throw new TypeError(`${platform} staged receipt package closure drifted`);
    }
    for (const row of ledger.packages) {
      const observed = receiptRows.get(row.sourceName);
      if (
        observed?.publishedName !== row.name
        || observed.version !== row.version
        || observed.sha256 !== row.sha256
      ) {
        throw new TypeError(`${platform} staged receipt bytes drifted for ${row.sourceName}`);
      }
    }
    assertSha256(record.sha256, `${platform} receipt file sha256`);
    byPlatform.set(platform, record.sha256);
  }
  return ['darwin-arm64', 'linux-x64'].map((platform) => ({
    platform,
    sha256: byPlatform.get(platform),
  }));
}

export function validateQualifiedTarballs({ ledger, root }) {
  validateQualifiedStagingLedger(ledger);
  for (const row of ledger.packages) {
    const path = join(root, row.tarball);
    if (!existsSync(path) || sha256File(path) !== row.sha256) {
      throw new TypeError(`qualified tarball bytes changed: ${row.tarball}`);
    }
  }
  return ledger.packages.map((row) => ({
    sourceName: row.sourceName,
    tarball: row.tarball,
    sha256: row.sha256,
  }));
}

export function sha256File(path) {
  return createHash('sha256').update(readFileSync(path)).digest('hex');
}

#!/usr/bin/env node

// @ref LLP 0110#single-table-public-package-advertisement-amendment--2026-08-06
// — the capability may cross the public-package boundary only when the exact
// serialized runtime package carries its closure-bound qualification receipt.

import { createHash } from 'node:crypto';
import { spawnSync } from 'node:child_process';
import { lstatSync, mkdtempSync, readFileSync, rmSync, statSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

import { validateAdminConsoleSnapshot } from '../packages/snapback-cli/admin-snapshot.mjs';
import { codegenRequiredTargetCapabilityIdsCanonicalJson } from '../packages/snapback-codegen/index.mjs';

export const STORE_RECEIPT_ENTRY =
  'package/bin/packaged-store-qualification.receipt.json';
export const RUNTIME_PACKAGE_PREFIX = '@expo/snapback-runtime-';
export const PUBLICATION_CAPABILITY_QUALIFICATION_FIELD =
  'publicationCapabilityQualification';
export const PUBLICATION_CAPABILITY_QUALIFICATION_SCHEMA_VERSION =
  'snapback.publication-capability-qualification.v1';
export const CAPABILITY_QUALIFICATION_ENV_BY_PLATFORM = Object.freeze({
  'darwin-arm64': 'SNAPBACK_PACKAGED_STORE_QUALIFICATION_RECEIPT_FILE',
  'linux-x64': 'SNAPBACK_RUNTIME_LINUX_X64_QUALIFICATION_RECEIPT',
});

const RECEIPT_SCHEMA_VERSION = 'snapback.packaged-store-qualification.v1';
const RECEIPT_CAPABILITY_ID = 'single_table_v1';
const MAX_RECEIPT_BYTES = 2 * 1024 * 1024;
const MAX_LEDGER_BYTES = 8 * 1024 * 1024;
const CAPABILITY_QUALIFICATION_KEYS = Object.freeze([
  'codegenPackage',
  'codegenRequiredCapabilities',
  'codegenVersion',
  'experimentalPolicy',
  'platform',
  'runtimeBinarySha256',
  'runtimeCapabilityGaps',
  'runtimePackage',
  'runtimeSupportedCapabilities',
  'schemaVersion',
  'sourceRevision',
  'targetProfileId',
]);

function codedError(code, message) {
  const error = new Error(message);
  error.code = code;
  return error;
}

function capabilityComparisonError(platform, side, message, capability = null) {
  const subject = capability === null ? '' : ` capability '${capability}'`;
  return codedError(
    capability === null
      ? 'SNAPBACK_PUBLICATION_CAPABILITY_SET_UNCOMPARABLE'
      : 'SNAPBACK_PUBLICATION_CAPABILITY_REQUIRED_MISSING',
    `publication capability comparison for platform ${platform}${subject} failed: ${message} (missing side: ${side})`,
  );
}

function closedSortedStrings(value, { label, platform, side }) {
  if (
    !Array.isArray(value)
    || value.some((entry) => typeof entry !== 'string' || entry.length === 0)
    || new Set(value).size !== value.length
    || value.some((entry, index) => index > 0 && value[index - 1] >= entry)
  ) {
    throw capabilityComparisonError(
      platform,
      side,
      `${label} must be a sorted, unique, non-empty string array`,
    );
  }
  return value;
}

export function publicationCodegenRequiredCapabilities() {
  let capabilities;
  try {
    capabilities = JSON.parse(codegenRequiredTargetCapabilityIdsCanonicalJson());
  } catch (error) {
    throw capabilityComparisonError(
      'all',
      'codegen',
      `the authoritative codegen requirement set could not be read: ${error.message}`,
    );
  }
  return closedSortedStrings(capabilities, {
    label: 'authoritative codegen requirements',
    platform: 'all',
    side: 'codegen',
  });
}

// @ref LLP 0058#capability-maturity — experimental acknowledgment is not
// runtime support. Every required id, stable or experimental, must be a
// positive runtime advertisement and must not simultaneously be a gap.
export function assertCodegenRuntimeCapabilityCoherence({
  codegenRequiredCapabilities,
  runtimeManifest,
  platform,
}) {
  if (!Array.isArray(codegenRequiredCapabilities)) {
    throw capabilityComparisonError(
      platform,
      'codegen',
      'codegen requirements are absent or not an array',
    );
  }
  if (!Array.isArray(runtimeManifest?.supportedCapabilities)) {
    throw capabilityComparisonError(
      platform,
      'runtime',
      'runtime supported capabilities are absent or not an array',
    );
  }
  if (!Array.isArray(runtimeManifest?.capabilityGaps)) {
    throw capabilityComparisonError(
      platform,
      'runtime',
      'runtime capability gaps are absent or not an array',
    );
  }
  const required = closedSortedStrings([...codegenRequiredCapabilities].sort(), {
    label: 'codegen requirements',
    platform,
    side: 'codegen',
  });
  const supported = closedSortedStrings(
    [...(runtimeManifest?.supportedCapabilities ?? [])].sort(),
    {
      label: 'runtime supported capabilities',
      platform,
      side: 'runtime',
    },
  );
  const gaps = closedSortedStrings(
    [...(runtimeManifest?.capabilityGaps ?? [])].sort(),
    {
      label: 'runtime capability gaps',
      platform,
      side: 'runtime',
    },
  );
  if (runtimeManifest?.targetProfileId !== 'local-dev-sqlite-ibex') {
    throw capabilityComparisonError(
      platform,
      'runtime',
      `runtime target profile is ${runtimeManifest?.targetProfileId ?? 'absent'}, expected local-dev-sqlite-ibex`,
    );
  }
  const supportedSet = new Set(supported);
  const gapSet = new Set(gaps);
  const contradictory = supported.find((capability) => gapSet.has(capability));
  if (contradictory !== undefined) {
    throw capabilityComparisonError(
      platform,
      'runtime',
      'runtime advertisement reports it as both supported and a gap',
      contradictory,
    );
  }
  for (const capability of required) {
    if (!supportedSet.has(capability)) {
      throw capabilityComparisonError(
        platform,
        'runtime',
        'codegen requires it but the platform runtime advertisement does not support it',
        capability,
      );
    }
    if (gapSet.has(capability)) {
      throw capabilityComparisonError(
        platform,
        'runtime',
        'codegen requires it but the platform runtime advertisement also reports it as a gap',
        capability,
      );
    }
  }
  return { required, supported, gaps };
}

export function createPublicationCapabilityQualification({
  platform,
  sourceRevision,
  runtimePackage,
  runtimeBinarySha256,
  codegenPackage,
  codegenVersion,
  codegenRequiredCapabilities,
  runtimeManifest,
}) {
  const { required, supported, gaps } = assertCodegenRuntimeCapabilityCoherence({
    codegenRequiredCapabilities,
    runtimeManifest,
    platform,
  });
  return {
    schemaVersion: PUBLICATION_CAPABILITY_QUALIFICATION_SCHEMA_VERSION,
    platform,
    sourceRevision,
    runtimePackage,
    runtimeBinarySha256,
    codegenPackage,
    codegenVersion,
    targetProfileId: runtimeManifest.targetProfileId,
    experimentalPolicy: 'included-no-exemption',
    codegenRequiredCapabilities: required,
    runtimeSupportedCapabilities: supported,
    runtimeCapabilityGaps: gaps,
  };
}

function requireExactKeys(value, expected, platform) {
  if (value === null || typeof value !== 'object' || Array.isArray(value)) {
    throw capabilityComparisonError(platform, 'comparison evidence', 'qualification is not an object');
  }
  const actual = Object.keys(value).sort();
  const wanted = [...expected].sort();
  if (
    actual.length !== wanted.length
    || actual.some((key, index) => key !== wanted[index])
  ) {
    throw capabilityComparisonError(
      platform,
      'comparison evidence',
      'qualification has unknown or missing members',
    );
  }
}

function runtimeRowForPlatform(ledger, platform) {
  return (ledger?.packages ?? []).find((row) => (
    row?.name === `@expo/snapback-runtime-${platform}`
    || row?.sourceName === `@expo/snapback-runtime-${platform}`
  ));
}

function codegenRowForLedger(ledger) {
  return (ledger?.packages ?? []).find((row) => (
    row?.name === '@expo/snapback-codegen'
    || row?.sourceName === '@expo/snapback-codegen'
  ));
}

export function assertPublicationCapabilityQualification({
  qualification,
  ledger,
  platform,
  expectedCodegenRequiredCapabilities = publicationCodegenRequiredCapabilities(),
}) {
  requireExactKeys(qualification, CAPABILITY_QUALIFICATION_KEYS, platform);
  const runtimeRow = runtimeRowForPlatform(ledger, platform);
  const codegenRow = codegenRowForLedger(ledger);
  if (runtimeRow === undefined) {
    throw capabilityComparisonError(platform, 'runtime', 'publication ledger has no runtime row');
  }
  if (codegenRow === undefined) {
    throw capabilityComparisonError(platform, 'codegen', 'publication ledger has no codegen row');
  }
  if (
    qualification.schemaVersion !== PUBLICATION_CAPABILITY_QUALIFICATION_SCHEMA_VERSION
    || qualification.platform !== platform
    || qualification.sourceRevision !== ledger.revision
    || qualification.runtimePackage !== runtimeRow.name
    || qualification.runtimeBinarySha256 !== runtimeRow.runtimeBinarySha256
    || qualification.codegenPackage !== codegenRow.name
    || qualification.codegenVersion !== ledger.version
    || qualification.targetProfileId !== 'local-dev-sqlite-ibex'
    || qualification.experimentalPolicy !== 'included-no-exemption'
    || !/^[0-9a-f]{64}$/u.test(qualification.runtimeBinarySha256 ?? '')
  ) {
    throw capabilityComparisonError(
      platform,
      'comparison evidence',
      'qualification identity does not bind the ledger codegen and platform runtime',
    );
  }
  const expected = closedSortedStrings(
    [...expectedCodegenRequiredCapabilities].sort(),
    { label: 'authoritative codegen requirements', platform, side: 'codegen' },
  );
  const observed = closedSortedStrings(qualification.codegenRequiredCapabilities, {
    label: 'qualified codegen requirements',
    platform,
    side: 'codegen qualification evidence',
  });
  const expectedSet = new Set(expected);
  const observedSet = new Set(observed);
  for (const capability of expected) {
    if (!observedSet.has(capability)) {
      throw capabilityComparisonError(
        platform,
        'codegen qualification evidence',
        'the authoritative codegen side requires it but the retained codegen set omits it',
        capability,
      );
    }
  }
  for (const capability of observed) {
    if (!expectedSet.has(capability)) {
      throw capabilityComparisonError(
        platform,
        'authoritative codegen set',
        'the retained codegen set requires it but the current authoritative codegen side omits it',
        capability,
      );
    }
  }
  assertCodegenRuntimeCapabilityCoherence({
    codegenRequiredCapabilities: observed,
    runtimeManifest: {
      targetProfileId: qualification.targetProfileId,
      supportedCapabilities: qualification.runtimeSupportedCapabilities,
      capabilityGaps: qualification.runtimeCapabilityGaps,
    },
    platform,
  });
  return qualification;
}

// @ref LLP 0317.000#the-waves — O26 is a serial publication gate: the closed
// two-platform runtime matrix must each carry a comparison against the same
// authoritative codegen requirement set.
export function assertPublicationCapabilityQualificationMatrix({
  ledger,
  qualifications,
  expectedCodegenRequiredCapabilities = publicationCodegenRequiredCapabilities(),
}) {
  if (!Array.isArray(ledger?.runtimePlatforms)
      || ledger.runtimePlatforms.length !== 2
      || ledger.runtimePlatforms[0] !== 'darwin-arm64'
      || ledger.runtimePlatforms[1] !== 'linux-x64') {
    throw capabilityComparisonError('all', 'runtime', 'publication platform matrix is not closed');
  }
  if (!Array.isArray(qualifications)) {
    throw capabilityComparisonError(
      'all',
      'comparison evidence',
      'platform qualifications are absent',
    );
  }
  const byPlatform = new Map();
  for (const qualification of qualifications) {
    const platform = qualification?.platform ?? 'unknown';
    if (!ledger.runtimePlatforms.includes(platform)) {
      throw capabilityComparisonError(
        platform,
        'comparison evidence',
        'qualification names a platform outside the publication matrix',
      );
    }
    if (byPlatform.has(platform)) {
      throw capabilityComparisonError(platform, 'comparison evidence', 'duplicate platform qualification');
    }
    byPlatform.set(platform, qualification);
  }
  return ledger.runtimePlatforms.map((platform) => {
    const qualification = byPlatform.get(platform);
    if (qualification === undefined) {
      throw capabilityComparisonError(platform, 'comparison evidence', 'platform qualification is absent');
    }
    return assertPublicationCapabilityQualification({
      qualification,
      ledger,
      platform,
      expectedCodegenRequiredCapabilities,
    });
  });
}

export function readPublicationCapabilityQualificationFile(path, platform) {
  let bytes;
  try {
    const metadata = lstatSync(path);
    if (!metadata.isFile() || metadata.isSymbolicLink() || metadata.size > MAX_RECEIPT_BYTES) {
      throw new TypeError('path is not a bounded regular file');
    }
    bytes = readFileSync(path);
  } catch (error) {
    throw capabilityComparisonError(
      platform,
      'comparison evidence',
      `qualification receipt could not be read from ${path}: ${error.message}`,
    );
  }
  let receipt;
  try {
    receipt = JSON.parse(bytes.toString('utf8'));
  } catch (error) {
    throw capabilityComparisonError(
      platform,
      'comparison evidence',
      `qualification receipt is not valid JSON: ${error.message}`,
    );
  }
  const qualification = receipt?.[PUBLICATION_CAPABILITY_QUALIFICATION_FIELD];
  if (qualification === undefined) {
    throw capabilityComparisonError(
      platform,
      'comparison evidence',
      `${PUBLICATION_CAPABILITY_QUALIFICATION_FIELD} is absent`,
    );
  }
  return qualification;
}

export function readPublicationCapabilityQualificationsFromEnvironment(
  environment = process.env,
) {
  return Object.entries(CAPABILITY_QUALIFICATION_ENV_BY_PLATFORM).map(
    ([platform, name]) => {
      const path = environment[name];
      if (typeof path !== 'string' || path.length === 0) {
        throw capabilityComparisonError(
          platform,
          'comparison evidence',
          `${name} is absent`,
        );
      }
      return readPublicationCapabilityQualificationFile(resolve(path), platform);
    },
  );
}

function extractReceipt(tarballPath, packageName) {
  const extracted = spawnSync('tar', ['-xzOf', tarballPath, STORE_RECEIPT_ENTRY], {
    encoding: null,
    maxBuffer: MAX_RECEIPT_BYTES,
  });
  if (extracted.error?.code === 'ENOBUFS') {
    throw codedError(
      'SNAPBACK_PUBLICATION_STORE_RECEIPT_INVALID',
      `staged runtime package ${packageName} store qualification receipt exceeds ${MAX_RECEIPT_BYTES} bytes`,
    );
  }
  if (extracted.error || extracted.status !== 0) {
    throw codedError(
      'SNAPBACK_PUBLICATION_STORE_RECEIPT_MISSING',
      `staged runtime package ${packageName} is missing ${STORE_RECEIPT_ENTRY}`,
    );
  }
  return extracted.stdout;
}

function parseReceipt(bytes, packageName) {
  let receipt;
  try {
    receipt = JSON.parse(bytes.toString('utf8'));
  } catch (error) {
    throw codedError(
      'SNAPBACK_PUBLICATION_STORE_RECEIPT_INVALID',
      `staged runtime package ${packageName} has an invalid JSON store qualification receipt: ${error.message}`,
    );
  }
  if (receipt?.schemaVersion !== RECEIPT_SCHEMA_VERSION
      || receipt?.capabilityId !== RECEIPT_CAPABILITY_ID) {
    throw codedError(
      'SNAPBACK_PUBLICATION_STORE_RECEIPT_INVALID',
      `staged runtime package ${packageName} store qualification receipt must have schemaVersion '${RECEIPT_SCHEMA_VERSION}' and capabilityId '${RECEIPT_CAPABILITY_ID}'`,
    );
  }
  return receipt;
}

export function assertStagedRuntimeStoreQualification({ stagedDir, ledger }) {
  const runtimeRows = Array.isArray(ledger?.packages)
    ? ledger.packages.filter((row) => (
      typeof row?.name === 'string'
      && row.name.startsWith(RUNTIME_PACKAGE_PREFIX)
    ))
    : [];
  if (!Array.isArray(ledger?.runtimePlatforms)
      || runtimeRows.length === 0
      || runtimeRows.length !== ledger.runtimePlatforms.length) {
    throw codedError(
      'SNAPBACK_PUBLICATION_STORE_RECEIPT_PLATFORM_INCOMPLETE',
      `staged publication has ${runtimeRows.length} runtime package rows for ${Array.isArray(ledger?.runtimePlatforms) ? ledger.runtimePlatforms.length : 0} declared runtime platforms`,
    );
  }

  const summary = [];
  for (const row of runtimeRows) {
    if (typeof row.tarball !== 'string' || row.tarball.length === 0) {
      throw codedError(
        'SNAPBACK_PUBLICATION_STORE_RECEIPT_MISSING',
        `staged runtime package ${row.name} has no tarball path`,
      );
    }
    const bytes = extractReceipt(join(resolve(stagedDir), row.tarball), row.name);
    const receipt = parseReceipt(bytes, row.name);
    const identity = receipt.binaryIdentity;
    if (identity?.gitCommit !== ledger.revision
        || identity?.gitDirty !== false
        || identity?.buildProfile !== 'release'
        || identity?.buildDistribution !== 'public-package') {
      throw codedError(
        'SNAPBACK_PUBLICATION_STORE_RECEIPT_IDENTITY_DRIFTED',
        `staged runtime package ${row.name} store qualification receipt does not bind clean release public-package revision ${ledger.revision}`,
      );
    }
    if (!Array.isArray(receipt.packageClosure)
        || receipt.packageClosure.some((entry) => entry?.version !== ledger.version)) {
      throw codedError(
        'SNAPBACK_PUBLICATION_STORE_RECEIPT_CLOSURE_DRIFTED',
        `staged runtime package ${row.name} store qualification receipt does not bind closure version ${ledger.version}`,
      );
    }
    summary.push({
      name: row.name,
      version: row.version,
      receiptSha256: createHash('sha256').update(bytes).digest('hex'),
      gitCommit: identity.gitCommit,
    });
  }
  return summary;
}

// @ref LLP 0041#runtime-distribution — the publication gate opens the exact
// serialized runtime bytes and requires the console to share their clean
// source revision; a source checkout's ambient dist cannot satisfy this.
export function assertStagedRuntimeAdminConsole({ stagedDir, ledger }) {
  const runtimeRows = Array.isArray(ledger?.packages)
    ? ledger.packages.filter((row) => (
      typeof row?.name === 'string'
      && row.name.startsWith(RUNTIME_PACKAGE_PREFIX)
    ))
    : [];
  if (!Array.isArray(ledger?.runtimePlatforms)
      || runtimeRows.length === 0
      || runtimeRows.length !== ledger.runtimePlatforms.length) {
    throw codedError(
      'SNAPBACK_PUBLICATION_STORE_RECEIPT_PLATFORM_INCOMPLETE',
      `staged publication has ${runtimeRows.length} admin snapshots for ${Array.isArray(ledger?.runtimePlatforms) ? ledger.runtimePlatforms.length : 0} declared runtime platforms`,
    );
  }

  const summary = [];
  for (const row of runtimeRows) {
    const extractionRoot = mkdtempSync(join(tmpdir(), 'snapback-admin-publication-'));
    try {
      const tarballPath = join(resolve(stagedDir), row.tarball);
      const extracted = spawnSync('tar', ['-xzf', tarballPath, '-C', extractionRoot], {
        encoding: 'utf8',
      });
      if (extracted.error || extracted.status !== 0) {
        throw codedError(
          'SNAPBACK_PUBLICATION_STORE_RECEIPT_INVALID',
          `staged runtime package ${row.name} could not be opened for admin snapshot qualification`,
        );
      }
      const runtimeRoot = join(extractionRoot, 'package');
      const runtimeReceipt = JSON.parse(
        readFileSync(join(runtimeRoot, 'runtime-readiness.json'), 'utf8'),
      );
      const snapshot = validateAdminConsoleSnapshot({
        root: join(runtimeRoot, 'admin'),
        expectedSourceRevision: ledger.revision,
        requireClean: true,
      });
      if (runtimeReceipt.sourceRevision !== snapshot.manifest.sourceRevision) {
        throw codedError(
          'SNAPBACK_PUBLICATION_STORE_RECEIPT_IDENTITY_DRIFTED',
          `staged runtime package ${row.name} admin snapshot does not match its sealed runtime revision`,
        );
      }
      summary.push({
        name: row.name,
        version: row.version,
        sourceRevision: snapshot.manifest.sourceRevision,
        snapshotSha256: snapshot.manifest.snapshotSha256,
        files: snapshot.manifest.files.length,
      });
    } catch (error) {
      if (error?.code?.startsWith('SNAPBACK_PUBLICATION_')) throw error;
      throw codedError(
        'SNAPBACK_PUBLICATION_STORE_RECEIPT_INVALID',
        `staged runtime package ${row.name} has no valid build-matched admin snapshot: ${error.message}`,
      );
    } finally {
      rmSync(extractionRoot, { recursive: true, force: true });
    }
  }
  return summary;
}

function parseArguments(argv) {
  if (argv.length !== 2 || argv[0] !== '--staged-dir' || argv[1].startsWith('-')) {
    throw codedError(
      'SNAPBACK_PUBLISH_ARGUMENT_INVALID',
      'usage: node scripts/publication-store-qualification-gate.mjs --staged-dir <dir>',
    );
  }
  return { stagedDir: resolve(argv[1]) };
}

function readBoundedLedger(stagedDir) {
  const path = join(stagedDir, 'publish-ledger.json');
  const size = statSync(path).size;
  if (size > MAX_LEDGER_BYTES) {
    throw codedError(
      'SNAPBACK_PUBLICATION_STORE_RECEIPT_INVALID',
      `publish ledger exceeds ${MAX_LEDGER_BYTES} bytes`,
    );
  }
  return JSON.parse(readFileSync(path, 'utf8'));
}

const invoked = process.argv[1]
  && resolve(process.argv[1]) === fileURLToPath(import.meta.url);
if (invoked) {
  try {
    const { stagedDir } = parseArguments(process.argv.slice(2));
    const ledger = readBoundedLedger(stagedDir);
    const storeQualification = assertStagedRuntimeStoreQualification({ stagedDir, ledger });
    const adminConsole = assertStagedRuntimeAdminConsole({ stagedDir, ledger });
    console.log(JSON.stringify({ ok: true, storeQualification, adminConsole }));
  } catch (error) {
    console.error(JSON.stringify({
      ok: false,
      diagnostics: [{
        code: error?.code ?? 'SNAPBACK_PUBLICATION_STORE_RECEIPT_INVALID',
        severity: 'error',
        subsystem: 'publish',
        message: error?.message ?? String(error),
      }],
    }));
    process.exitCode = 1;
  }
}

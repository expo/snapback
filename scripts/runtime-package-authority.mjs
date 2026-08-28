import { spawnSync } from 'node:child_process';
import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';

export const PUBLIC_PACKAGE_BUILD_DISTRIBUTION = 'public-package';
const CONTRIBUTOR_SOURCE_BUILD_DISTRIBUTION = 'contributor-source';
export const PACKAGED_STORE_QUALIFICATION_RECEIPT_FILE =
  'packaged-store-qualification.receipt.json';
export const PACKAGED_STORE_QUALIFICATION_SCHEMA_VERSION =
  'snapback.packaged-store-qualification.v1';
export const RUNTIME_CATALOG_BUILD_IDENTITY_MISMATCH_CODE =
  'SNAPBACK_RUNTIME_CATALOG_BUILD_IDENTITY_MISMATCH';
export const RUNTIME_CATALOG_INSPECTION_FAILED_CODE =
  'SNAPBACK_RUNTIME_CATALOG_INSPECTION_FAILED';
export const RUNTIME_CATALOG_BUILD_IDENTITY_PROOF_SCHEMA_VERSION =
  'snapback.runtime-catalog-build-identity-proof.v1';
const PUBLICATION_CAPABILITY_QUALIFICATION_FIELD =
  'publicationCapabilityQualification';
const PUBLICATION_CAPABILITY_QUALIFICATION_SCHEMA_VERSION =
  'snapback.publication-capability-qualification.v1';

const RUNTIME_CATALOG_BUILD_IDENTITY_PROOF_SOURCES = new Set([
  'native-inspection',
  'snapback.runtime-artifact-attestation.v4',
]);

function receiptError(code, message) {
  const error = new Error(message);
  error.code = code;
  return error;
}

// @ref LLP 0166#public-package-advertisement-amendment--2026-08-06 — release
// staging installs the qualification receipt beside the exact packaged binary;
// runtime admission remains responsible for validating its substantive binds.
export function installPackagedStoreQualificationReceipt({
  sourceBinary,
  binDirectory,
  receiptEnvironmentName,
  environment = process.env,
}) {
  const explicit = Object.hasOwn(environment, receiptEnvironmentName);
  const sibling = join(
    dirname(sourceBinary),
    PACKAGED_STORE_QUALIFICATION_RECEIPT_FILE,
  );
  const source = explicit
    ? resolve(String(environment[receiptEnvironmentName] ?? ''))
    : sibling;
  if (!explicit && !existsSync(source)) {
    return { installed: false, reason: 'absent' };
  }

  let bytes;
  try {
    bytes = readFileSync(source);
  } catch (error) {
    throw receiptError(
      'SNAPBACK_PACKAGED_STORE_QUALIFICATION_RECEIPT_UNREADABLE',
      `${explicit ? `${receiptEnvironmentName} points to` : 'qualification receipt is unreadable at'} ${source}: ${error.message}`,
    );
  }

  let receipt;
  try {
    receipt = JSON.parse(bytes.toString('utf8'));
  } catch (error) {
    throw receiptError(
      'SNAPBACK_PACKAGED_STORE_QUALIFICATION_RECEIPT_INVALID',
      `qualification receipt at ${source} is not valid JSON: ${error.message}`,
    );
  }
  if (Object.hasOwn(receipt ?? {}, PUBLICATION_CAPABILITY_QUALIFICATION_FIELD)) {
    const qualification = receipt[PUBLICATION_CAPABILITY_QUALIFICATION_FIELD];
    if (
      qualification === null
      || typeof qualification !== 'object'
      || Array.isArray(qualification)
      || qualification.schemaVersion !== PUBLICATION_CAPABILITY_QUALIFICATION_SCHEMA_VERSION
    ) {
      throw receiptError(
        'SNAPBACK_PACKAGED_STORE_QUALIFICATION_RECEIPT_INVALID',
        `qualification receipt at ${source} has an invalid ${PUBLICATION_CAPABILITY_QUALIFICATION_FIELD}`,
      );
    }
    const {
      [PUBLICATION_CAPABILITY_QUALIFICATION_FIELD]: _qualification,
      ...runtimeReceipt
    } = receipt;
    receipt = runtimeReceipt;
    bytes = Buffer.from(`${JSON.stringify(runtimeReceipt, null, 2)}\n`);
  }
  if (receipt?.schemaVersion !== PACKAGED_STORE_QUALIFICATION_SCHEMA_VERSION) {
    throw receiptError(
      'SNAPBACK_PACKAGED_STORE_QUALIFICATION_RECEIPT_INVALID',
      `qualification receipt at ${source} must have schemaVersion '${PACKAGED_STORE_QUALIFICATION_SCHEMA_VERSION}'`,
    );
  }

  const destination = join(
    binDirectory,
    PACKAGED_STORE_QUALIFICATION_RECEIPT_FILE,
  );
  try {
    // Install the bytes that were validated, rather than reopening a mutable
    // source path between validation and copy.
    writeFileSync(destination, bytes);
  } catch (error) {
    throw receiptError(
      'SNAPBACK_PACKAGED_STORE_QUALIFICATION_RECEIPT_INSTALL_FAILED',
      `could not install qualification receipt at ${destination}: ${error.message}`,
    );
  }
  return { installed: true, source, destination };
}

function packageIdentityError(message) {
  const error = new Error(message);
  error.code = 'SNAPBACK_PACKAGE_CAPABILITY_ATTESTATION_REQUIRED';
  return error;
}

function catalogBuildIdentityError(message) {
  const error = new Error(message);
  error.code = RUNTIME_CATALOG_BUILD_IDENTITY_MISMATCH_CODE;
  return error;
}

function catalogInspectionError(message, cause = undefined) {
  const error = new Error(message, { cause });
  error.code = RUNTIME_CATALOG_INSPECTION_FAILED_CODE;
  return error;
}

export function assertRuntimeCatalogBuildIdentity(binaryIdentity, catalog) {
  assertRuntimePackageSourceIdentity(binaryIdentity);
  const catalogIdentity = catalog?.buildIdentity;
  const binaryCommit = binaryIdentity.binary.gitCommit;
  const binaryDirty = binaryIdentity.binary.gitDirty;
  if (
    catalog?.schemaVersion !== 'snapback.control-catalog.v1'
    || !/^[0-9a-f]{40}$/u.test(catalogIdentity?.sourceCommit ?? '')
    || typeof catalogIdentity?.dirty !== 'boolean'
    || catalogIdentity.sourceCommit !== binaryCommit
    || catalogIdentity.dirty !== binaryDirty
  ) {
    throw catalogBuildIdentityError(
      'runtime control catalog build identity does not match the enclosing binary: '
      + `binary=${binaryCommit}/${binaryDirty}, `
      + `catalog=${catalogIdentity?.sourceCommit ?? 'unknown'}/${catalogIdentity?.dirty ?? 'unknown'}`,
    );
  }
  return catalogIdentity;
}

export function createRuntimeCatalogBuildIdentityProof({
  binaryIdentity,
  catalogBuildIdentity,
  source,
}) {
  assertRuntimeCatalogBuildIdentity(binaryIdentity, {
    schemaVersion: 'snapback.control-catalog.v1',
    buildIdentity: catalogBuildIdentity,
  });
  if (!RUNTIME_CATALOG_BUILD_IDENTITY_PROOF_SOURCES.has(source)) {
    throw catalogBuildIdentityError(
      `runtime control catalog build identity proof has an unsupported source: ${source ?? 'unknown'}`,
    );
  }
  return {
    schemaVersion: RUNTIME_CATALOG_BUILD_IDENTITY_PROOF_SCHEMA_VERSION,
    source,
    buildIdentity: structuredClone(catalogBuildIdentity),
  };
}

export function assertRuntimeCatalogBuildIdentityProof(binaryIdentity, proof) {
  if (
    proof === null
    || typeof proof !== 'object'
    || Array.isArray(proof)
    || Object.keys(proof).sort().join(',') !== 'buildIdentity,schemaVersion,source'
    || proof.schemaVersion !== RUNTIME_CATALOG_BUILD_IDENTITY_PROOF_SCHEMA_VERSION
  ) {
    throw catalogBuildIdentityError(
      'runtime package does not carry a closed catalog build identity proof',
    );
  }
  return createRuntimeCatalogBuildIdentityProof({
    binaryIdentity,
    catalogBuildIdentity: proof.buildIdentity,
    source: proof.source,
  });
}

// @ref LLP 0041#runtime-distribution — package manufacture must inspect the
// exact embedded catalog before it can seal or publish the enclosing binary.
export function inspectRuntimeCatalogBuildIdentity({
  binaryPath,
  binaryIdentity,
  environment = process.env,
  runBinary = spawnSync,
}) {
  let result;
  try {
    result = runBinary(binaryPath, ['controls', 'list', '--json'], {
      encoding: 'utf8',
      env: environment,
      timeout: 15_000,
    });
  } catch (error) {
    throw catalogInspectionError(
      `could not inspect the runtime control catalog: ${error.message}`,
      error,
    );
  }
  if (result.status !== 0) {
    throw catalogInspectionError(
      'could not inspect the runtime control catalog: '
      + (
        result.error?.message
        ?? result.stderr?.trim()
        ?? result.signal
        ?? result.status
        ?? 'unknown failure'
      ),
    );
  }
  let catalog;
  try {
    catalog = JSON.parse(result.stdout);
  } catch (error) {
    throw catalogInspectionError(
      `runtime control catalog output was not valid JSON: ${error.message}`,
      error,
    );
  }
  return assertRuntimeCatalogBuildIdentity(binaryIdentity, catalog);
}

export function assertRuntimePackageSourceIdentity(identity) {
  if (identity?.schemaVersion !== 'snapback.binary-identity.v1'
      || ![
        CONTRIBUTOR_SOURCE_BUILD_DISTRIBUTION,
        PUBLIC_PACKAGE_BUILD_DISTRIBUTION,
      ].includes(identity?.buildDistribution)
      || typeof identity?.binary?.gitCommit !== 'string'
      || identity.binary.gitCommit === 'unknown'
      || identity.binary.gitCommit.length === 0
      || typeof identity.binary.gitDirty !== 'boolean'
      || typeof identity.binary.buildProfile !== 'string'
      || identity.binary.buildProfile.length === 0) {
    throw packageIdentityError(
      'native runtime does not carry a usable source identity; '
      + 'runtime package staging requires a known source revision',
    );
  }
  return identity;
}

export function assertRuntimePackageBuildIdentity(identity) {
  assertRuntimePackageSourceIdentity(identity);
  if (identity.binary.gitDirty !== false
      || identity.binary.buildProfile !== 'release') {
    throw packageIdentityError(
      'native runtime was not built with a sealable clean release identity; '
      + 'runtime package assembly requires a known source revision and proven-clean inputs',
    );
  }
  return identity;
}

export function assertPublicPackageBuildIdentity(identity) {
  assertRuntimePackageBuildIdentity(identity);
  if (identity.buildDistribution !== PUBLIC_PACKAGE_BUILD_DISTRIBUTION) {
    throw packageIdentityError(
      'native runtime was not built as a clean release public-package artifact; '
      + 'without PackageCapabilityAttestationV1 the package must retain relation/activity GAPs',
    );
  }
  return identity;
}

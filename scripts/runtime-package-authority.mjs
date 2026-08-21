import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';

export const PUBLIC_PACKAGE_BUILD_DISTRIBUTION = 'public-package';
const CONTRIBUTOR_SOURCE_BUILD_DISTRIBUTION = 'contributor-source';
export const PACKAGED_STORE_QUALIFICATION_RECEIPT_FILE =
  'packaged-store-qualification.receipt.json';
export const PACKAGED_STORE_QUALIFICATION_SCHEMA_VERSION =
  'snapback.packaged-store-qualification.v1';

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

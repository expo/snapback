import { createHash } from 'node:crypto';
import {
  closeSync,
  constants as fsConstants,
  fstatSync,
  openSync,
  readSync,
} from 'node:fs';
import { join } from 'node:path';

import {
  assertPublicPackageBuildIdentity,
  assertRuntimeCatalogBuildIdentity,
} from '../../scripts/runtime-package-authority.mjs';

const ATTESTATION_KEYS = [
  'binarySha256',
  'buildIdentity',
  'bundledLibrariesSha256',
  'catalogBuildIdentity',
  'hermesHeaderSha256',
  'hermesSha256',
  'platform',
  'qualificationVerdict',
  'schemaVersion',
  'sourceRevision',
];
const BUILD_IDENTITY_KEYS = [
  'binary',
  'buildDistribution',
  'schemaVersion',
];
const BINARY_IDENTITY_KEYS = [
  'buildProfile',
  'crateVersion',
  'gitCommit',
  'gitDirty',
  'startupNonce',
];
const MAX_ATTESTATION_BYTES = 64 * 1024;
const MAX_ARTIFACT_BYTES = 512 * 1024 * 1024;
const HASH_CHUNK_BYTES = 1024 * 1024;
const SONAME_PATTERN = /^[A-Za-z0-9][A-Za-z0-9._+-]*$/u;

function exactKeys(value, keys, label) {
  if (value === null || typeof value !== 'object' || Array.isArray(value)) {
    throw new TypeError(`${label} must be an object`);
  }
  const actual = Object.keys(value).sort();
  const expected = [...keys].sort();
  if (
    actual.length !== expected.length
    || actual.some((key, index) => key !== expected[index])
  ) {
    throw new TypeError(`${label} has unknown or missing members`);
  }
}

function readRegularFile(path, label, maxBytes) {
  let descriptor;
  try {
    descriptor = openSync(
      path,
      fsConstants.O_RDONLY | (fsConstants.O_NOFOLLOW ?? 0),
    );
    const metadata = fstatSync(descriptor);
    if (!metadata.isFile()) throw new TypeError(`${label} must be a regular file`);
    if (metadata.size < 1 || metadata.size > maxBytes) {
      throw new RangeError(`${label} exceeded its ${maxBytes}-byte bound`);
    }
    const bytes = Buffer.alloc(metadata.size);
    let offset = 0;
    while (offset < bytes.byteLength) {
      const count = readSync(
        descriptor,
        bytes,
        offset,
        bytes.byteLength - offset,
        null,
      );
      if (count === 0) break;
      offset += count;
    }
    const growthProbe = Buffer.alloc(1);
    if (
      offset !== bytes.byteLength
      || readSync(descriptor, growthProbe, 0, 1, null) !== 0
    ) {
      throw new TypeError(`${label} changed while it was being read`);
    }
    return bytes;
  } finally {
    if (descriptor !== undefined) closeSync(descriptor);
  }
}

function sha256RegularFile(path, label) {
  let descriptor;
  try {
    descriptor = openSync(
      path,
      fsConstants.O_RDONLY | (fsConstants.O_NOFOLLOW ?? 0),
    );
    const metadata = fstatSync(descriptor);
    if (!metadata.isFile()) throw new TypeError(`${label} must be a regular file`);
    if (metadata.size < 1 || metadata.size > MAX_ARTIFACT_BYTES) {
      throw new RangeError(`${label} exceeded its ${MAX_ARTIFACT_BYTES}-byte bound`);
    }
    const hash = createHash('sha256');
    const chunk = Buffer.allocUnsafe(Math.min(HASH_CHUNK_BYTES, metadata.size));
    let consumed = 0;
    while (consumed < metadata.size) {
      const count = readSync(
        descriptor,
        chunk,
        0,
        Math.min(chunk.byteLength, metadata.size - consumed),
        null,
      );
      if (count === 0) break;
      hash.update(chunk.subarray(0, count));
      consumed += count;
    }
    const growthProbe = Buffer.alloc(1);
    if (
      consumed !== metadata.size
      || readSync(descriptor, growthProbe, 0, 1, null) !== 0
    ) {
      throw new TypeError(`${label} changed while it was being hashed`);
    }
    return hash.digest('hex');
  } finally {
    if (descriptor !== undefined) closeSync(descriptor);
  }
}

function validateBuildIdentity(identity, sourceRevision) {
  exactKeys(identity, BUILD_IDENTITY_KEYS, 'runtime build identity');
  exactKeys(identity.binary, BINARY_IDENTITY_KEYS, 'runtime binary identity');
  assertPublicPackageBuildIdentity(identity);
  if (
    !/^[0-9a-f]{40}$/u.test(sourceRevision ?? '')
    || identity.binary.gitCommit !== sourceRevision
    || typeof identity.binary.crateVersion !== 'string'
    || identity.binary.crateVersion.length === 0
    || typeof identity.binary.startupNonce !== 'string'
    || identity.binary.startupNonce.length === 0
  ) {
    throw new TypeError('runtime build identity source revision drifted');
  }
  return identity;
}

function stableBinaryIdentity(identity) {
  return {
    crateVersion: identity?.crateVersion ?? null,
    gitCommit: identity?.gitCommit ?? null,
    gitDirty: identity?.gitDirty ?? null,
    buildProfile: identity?.buildProfile ?? null,
  };
}

function validateQualificationVerdict(verdict, buildIdentity, sourceRevision) {
  if (
    verdict?.schemaVersion !== 'snapback.runtime-qualify.v1'
    || verdict.probe !== 'restricted-no-eval-handler-vm'
    || verdict.ok !== true
    || JSON.stringify(stableBinaryIdentity(verdict.binary))
      !== JSON.stringify(stableBinaryIdentity(buildIdentity.binary))
    || verdict.binary?.gitCommit !== sourceRevision
  ) {
    throw new TypeError('Linux runtime artifact qualification verdict drifted');
  }
  return verdict;
}

/**
 * Build the closed cross-host descriptor on the native Linux builder.
 *
 * @ref LLP 0041#nine-package-candidate-promotion--2026-07-28 — one
 * source-bound assembly may transport a foreign native runtime only with its
 * executing-host identity and exact binary/support-artifact digests.
 * `scripts/snapback-create-runtime-artifact-attestation.mjs` is the only
 * sanctioned production caller: it executes the runtime catalog inspection
 * immediately before invoking this ceremony primitive. Direct construction is
 * reserved for fixtures, so the production attestation cannot rely on a
 * caller-supplied catalog identity that was not observed from the binary.
 */
export function createLinuxRuntimeArtifactAttestation({
  binaryPath,
  hermesPath,
  hermesHeaderPath,
  buildIdentity,
  catalogBuildIdentity,
  qualificationVerdict,
  sourceRevision,
  bundledLibraries = [],
}) {
  validateBuildIdentity(buildIdentity, sourceRevision);
  assertRuntimeCatalogBuildIdentity(buildIdentity, {
    schemaVersion: 'snapback.control-catalog.v1',
    buildIdentity: catalogBuildIdentity,
  });
  validateQualificationVerdict(qualificationVerdict, buildIdentity, sourceRevision);
  if (!Array.isArray(bundledLibraries)) {
    throw new TypeError('Linux runtime bundled libraries must be an array');
  }
  const bundledLibrariesSha256 = {};
  for (const entry of [...bundledLibraries].sort((left, right) => (
    String(left?.soname).localeCompare(String(right?.soname))
  ))) {
    if (
      entry === null
      || typeof entry !== 'object'
      || Array.isArray(entry)
      || Object.keys(entry).sort().join(',') !== 'path,soname'
      || !SONAME_PATTERN.test(entry.soname ?? '')
    ) {
      throw new TypeError('Linux runtime bundled library entries must carry a valid soname and path');
    }
    if (Object.hasOwn(bundledLibrariesSha256, entry.soname)) {
      throw new TypeError(`Linux runtime bundled library soname is duplicated: ${entry.soname}`);
    }
    bundledLibrariesSha256[entry.soname] = sha256RegularFile(
      entry.path,
      `Linux bundled library ${entry.soname}`,
    );
  }
  return {
    schemaVersion: 'snapback.runtime-artifact-attestation.v4',
    platform: 'linux-x64',
    sourceRevision,
    binarySha256: sha256RegularFile(binaryPath, 'Linux runtime binary'),
    hermesSha256: sha256RegularFile(hermesPath, 'Linux Hermes library'),
    hermesHeaderSha256: sha256RegularFile(hermesHeaderPath, 'Linux Hermes header'),
    bundledLibrariesSha256,
    buildIdentity: structuredClone(buildIdentity),
    catalogBuildIdentity: structuredClone(catalogBuildIdentity),
    qualificationVerdict: structuredClone(qualificationVerdict),
  };
}

export function validateLinuxRuntimeArtifactAttestation({
  attestation,
  binaryPath,
  hermesPath,
  hermesHeaderPath,
  sourceRevision,
  bundledLibsDirectory = null,
}) {
  exactKeys(attestation, ATTESTATION_KEYS, 'Linux runtime artifact attestation');
  if (
    attestation.schemaVersion !== 'snapback.runtime-artifact-attestation.v4'
    || attestation.platform !== 'linux-x64'
    || attestation.sourceRevision !== sourceRevision
    || !/^[0-9a-f]{64}$/u.test(attestation.binarySha256 ?? '')
    || !/^[0-9a-f]{64}$/u.test(attestation.hermesSha256 ?? '')
    || !/^[0-9a-f]{64}$/u.test(attestation.hermesHeaderSha256 ?? '')
  ) {
    throw new TypeError('Linux runtime artifact attestation identity drifted');
  }
  if (
    attestation.bundledLibrariesSha256 === null
    || typeof attestation.bundledLibrariesSha256 !== 'object'
    || Array.isArray(attestation.bundledLibrariesSha256)
    || ![Object.prototype, null].includes(
      Object.getPrototypeOf(attestation.bundledLibrariesSha256),
    )
    || Object.entries(attestation.bundledLibrariesSha256).some(
      ([soname, digest]) => !SONAME_PATTERN.test(soname)
        || !/^[0-9a-f]{64}$/u.test(digest),
    )
  ) {
    throw new TypeError('Linux runtime artifact attestation bundled-library shape drifted');
  }
  validateBuildIdentity(attestation.buildIdentity, sourceRevision);
  assertRuntimeCatalogBuildIdentity(attestation.buildIdentity, {
    schemaVersion: 'snapback.control-catalog.v1',
    buildIdentity: attestation.catalogBuildIdentity,
  });
  validateQualificationVerdict(
    attestation.qualificationVerdict,
    attestation.buildIdentity,
    sourceRevision,
  );
  if (
    attestation.binarySha256
      !== sha256RegularFile(binaryPath, 'Linux runtime binary')
    || attestation.hermesSha256
      !== sha256RegularFile(hermesPath, 'Linux Hermes library')
    || attestation.hermesHeaderSha256
      !== sha256RegularFile(hermesHeaderPath, 'Linux Hermes header')
  ) {
    throw new TypeError('Linux runtime artifact attestation digest drifted');
  }
  const bundledEntries = Object.entries(attestation.bundledLibrariesSha256);
  if (bundledEntries.length > 0 && typeof bundledLibsDirectory !== 'string') {
    throw new TypeError(
      'Linux runtime artifact attestation requires a bundled libraries directory',
    );
  }
  try {
    if (bundledEntries.some(([soname, digest]) => (
      digest !== sha256RegularFile(
        join(bundledLibsDirectory, soname),
        `Linux bundled library ${soname}`,
      )
    ))) {
      throw new TypeError('Linux runtime artifact attestation digest drifted');
    }
  } catch (error) {
    if (error instanceof TypeError && /attestation digest drifted/u.test(error.message)) {
      throw error;
    }
    throw new TypeError('Linux runtime artifact attestation digest drifted', {
      cause: error,
    });
  }
  return attestation;
}

export function readLinuxRuntimeArtifactAttestation(path) {
  const bytes = readRegularFile(
    path,
    'Linux runtime artifact attestation',
    MAX_ATTESTATION_BYTES,
  );
  try {
    return JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(bytes));
  } catch (error) {
    throw new TypeError(`Linux runtime artifact attestation is not valid JSON: ${error.message}`);
  }
}

export function readLinuxRuntimeBuildIdentity(path, sourceRevision) {
  const bytes = readRegularFile(
    path,
    'Linux runtime build identity',
    MAX_ATTESTATION_BYTES,
  );
  let identity;
  try {
    identity = JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(bytes));
  } catch (error) {
    throw new TypeError(`Linux runtime build identity is not valid JSON: ${error.message}`);
  }
  return validateBuildIdentity(identity, sourceRevision);
}

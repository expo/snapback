import { execFileSync, spawnSync } from 'node:child_process';
import { createHash, randomUUID } from 'node:crypto';
import {
  existsSync,
  lstatSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  realpathSync,
  renameSync,
  rmSync,
} from 'node:fs';
import { basename, dirname, join, resolve, sep } from 'node:path';
import { fileURLToPath } from 'node:url';

import {
  canonicalJcs,
  parseTimestamp,
  requireExactKeys,
  sha256Hex,
} from '../packages/snapback-publication-authority/protocol.mjs';
import {
  PUBLIC_NPM_REGISTRY,
  npmResultIsPackageNotFound,
  promotionNamesForScopePreset,
  validateCandidateLedger,
} from './snapback-publish-core.mjs';
import {
  validatePriorDependencyAlias,
} from './snapback-promotion-core.mjs';
import {
  validateObservedPriorVector,
} from '../packages/snapback-publication-authority/request.mjs';

const RECEIPT_KEYS = [
  'candidateLedgerSha256',
  'candidateTag',
  'completedAt',
  'defaultTag',
  'finalVector',
  'helperSha256',
  'initialVector',
  'operationId',
  'packages',
  'policyVersion',
  'producerRevision',
  'publisherInstanceId',
  'receiptSha256',
  'registry',
  'schemaVersion',
  'sourceRevision',
  'startedAt',
];
const PACKAGE_KEYS = [
  'dependencyAliases',
  'dependencySections',
  'manifestSha256',
  'name',
  'registryIntegrity',
  'registryShasum',
  'rollbackAction',
  'status',
  'tarballFile',
  'tarballSha256',
  'version',
];
const ALIAS_KEYS = [
  'dependency',
  'section',
  'sectionVector',
  'target',
  'version',
];
const DEPENDENCY_SECTIONS = [
  'dependencies',
  'optionalDependencies',
  'peerDependencies',
  'devDependencies',
];
const VERSION_PATTERN = /^\d+\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?$/u;
const SHA256_PATTERN = /^[0-9a-f]{64}$/u;
const SHA1_PATTERN = /^[0-9a-f]{40}$/u;
const INTEGRITY_PATTERN = /^sha512-[A-Za-z0-9+/]+={0,2}$/u;
const RECEIPT_MAX_AGE_MS = 120_000;
const HELPER_PATH = fileURLToPath(import.meta.url);

function fail(message) {
  throw new Error(`prior default closure: ${message}`);
}

function leaseShape(ledger, priorVector) {
  const candidates = new Map(ledger.packages.map((row) => [row.name, row]));
  return {
    packages: promotionNamesForScopePreset(ledger.scopePreset).map((name) => ({
      name,
      expectedPriorVersion: priorVector[name],
      newVersion: candidates.get(name)?.version,
    })),
  };
}

function unsignedReceipt(receipt) {
  const value = structuredClone(receipt);
  delete value.receiptSha256;
  return value;
}

function normalizedDependencySections(manifest) {
  return Object.fromEntries(DEPENDENCY_SECTIONS.map((section) => {
    const value = manifest[section] ?? {};
    if (value === null || typeof value !== 'object' || Array.isArray(value)) {
      fail(`manifest ${section} must be an object`);
    }
    const entries = Object.entries(value).sort(([left], [right]) => (
      left.localeCompare(right)
    ));
    for (const [dependency, specifier] of entries) {
      if (
        typeof dependency !== 'string'
        || dependency.length < 1
        || dependency.length > 214
        || typeof specifier !== 'string'
        || specifier.length < 1
        || specifier.length > 512
      ) {
        fail(`manifest ${section} contains an invalid dependency entry`);
      }
    }
    return [section, Object.fromEntries(entries)];
  }));
}

function dependencyAliases({ manifest, lease, ownerName }) {
  // The lease shape carries exactly one name generation. Terminal
  // @expo/snapback-* artifacts key internal edges directly by the registry
  // identity at an exact version; legacy @ccheever artifacts keyed them by
  // the @snapback source alias (decision-9 lineage).
  const leaseNames = new Set(lease.packages.map((row) => row.name));
  // Terminal identity means the closure carries no pre-migration names; the
  // unscoped create-snapback-app (LLP 0115 decision 9) is terminal too, so
  // detection keys on the absence of legacy scopes rather than one prefix.
  const terminal = [...leaseNames].every(
    (name) => !name.startsWith('@ccheever/') && !name.startsWith('@snapback/'),
  );
  const aliases = [];
  const sections = normalizedDependencySections(manifest);
  for (const section of DEPENDENCY_SECTIONS) {
    for (const [dependency, value] of Object.entries(sections[section])) {
      if (/^(?:workspace:|file:|link:)/u.test(value)) {
        fail(`${ownerName} contains non-registry ${section}.${dependency}`);
      }
      if (terminal) {
        if (
          dependency.startsWith('@snapback/')
          || dependency.startsWith('@ccheever/snapback-')
          || value.includes('@snapback/')
          || value.includes('@ccheever/snapback-')
          || value.startsWith('npm:')
        ) {
          fail(`${ownerName} contains a pre-migration key or alias ${section}.${dependency}`);
        }
        if (!leaseNames.has(dependency)) {
          if (dependency.startsWith('@expo/snapback-')) {
            fail(`${ownerName} contains an internal key outside the lease ${section}.${dependency}`);
          }
          continue;
        }
        if (!/^\d+\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?$/u.test(value)) {
          fail(`${ownerName} contains non-exact Snapback dependency ${section}.${dependency}`);
        }
        const binding = validatePriorDependencyAlias({
          lease,
          ownerName,
          dependency,
          target: dependency,
          version: value,
        });
        aliases.push({
          section,
          dependency,
          target: dependency,
          version: value,
          sectionVector: binding.sectionVector,
        });
        continue;
      }
      if (leaseNames.has(dependency) || dependency.startsWith('@ccheever/snapback-')) {
        fail(`${ownerName} contains direct public internal key ${section}.${dependency}`);
      }
      const match = value.match(
        /^npm:(@ccheever\/snapback-[a-z0-9-]+)@(\d+\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?)$/u,
      );
      if (
        (
          value.includes('@ccheever/snapback-')
          || value.includes('@snapback/')
          || dependency.startsWith('@snapback/')
        )
        && !match
      ) {
        fail(`${ownerName} contains non-exact Snapback alias ${section}.${dependency}`);
      }
      if (!match) continue;
      const [, target, version] = match;
      const binding = validatePriorDependencyAlias({
        lease,
        ownerName,
        dependency,
        target,
        version,
      });
      aliases.push({
        section,
        dependency,
        target,
        version,
        sectionVector: binding.sectionVector,
      });
    }
  }
  aliases.sort((left, right) => [
    left.section,
    left.dependency,
    left.target,
    left.version,
  ].join('\0').localeCompare([
    right.section,
    right.dependency,
    right.target,
    right.version,
  ].join('\0')));
  return { aliases, sections };
}

function extractManifest(tarball) {
  let bytes;
  try {
    const names = execFileSync(
      'tar',
      ['-tzf', tarball, 'package/package.json'],
      {
        encoding: 'utf8',
        maxBuffer: 64 * 1024,
        timeout: 30_000,
      },
    );
    const metadata = execFileSync(
      'tar',
      ['-tvzf', tarball, 'package/package.json'],
      {
        encoding: 'utf8',
        maxBuffer: 64 * 1024,
        timeout: 30_000,
      },
    );
    if (
      names !== 'package/package.json\n'
      || !metadata.startsWith('-')
      || !metadata.endsWith(' package/package.json\n')
      || metadata.split('\n').filter(Boolean).length !== 1
    ) {
      fail('package manifest must be one exact regular tar entry');
    }
    bytes = execFileSync('tar', ['-xzOf', tarball, 'package/package.json'], {
      maxBuffer: 2 * 1024 * 1024,
      timeout: 30_000,
    });
  } catch {
    fail(`could not extract the bounded package manifest from ${basename(tarball)}`);
  }
  if (bytes.byteLength > 1024 * 1024) fail('package manifest exceeded 1 MiB');
  let manifest;
  try {
    manifest = JSON.parse(bytes.toString('utf8'));
  } catch {
    fail(`package manifest in ${basename(tarball)} is not JSON`);
  }
  return { bytes, manifest };
}

function safeTarballPath(receiptPath, row, artifactRootOverride) {
  if (
    !/^\d{2}\.tgz$/u.test(row.tarballFile ?? '')
    || basename(row.tarballFile) !== row.tarballFile
  ) {
    fail(`package ${row.name} tarball filename is invalid`);
  }
  const artifactRoot = resolve(
    artifactRootOverride ?? priorClosureArtifactsPath(receiptPath),
  );
  const metadata = lstatSync(artifactRoot);
  if (!metadata.isDirectory() || metadata.isSymbolicLink()) {
    fail('artifact root must be a real directory');
  }
  const canonicalRoot = realpathSync(artifactRoot);
  const path = resolve(canonicalRoot, row.tarballFile);
  if (!path.startsWith(`${canonicalRoot}${sep}`)) {
    fail(`package ${row.name} tarball escaped its artifact root`);
  }
  const tarballMetadata = lstatSync(path);
  if (!tarballMetadata.isFile() || tarballMetadata.isSymbolicLink()) {
    fail(`package ${row.name} tarball must be a real file`);
  }
  if (tarballMetadata.size < 1 || tarballMetadata.size > 256 * 1024 * 1024) {
    fail(`package ${row.name} tarball size is outside the closure bound`);
  }
  return path;
}

function validatePackageEvidence({
  row,
  index,
  name,
  expectedPriorVector,
  lease,
  receiptPath,
  artifactRootOverride,
  revalidateArtifacts,
}) {
  requireExactKeys(row, PACKAGE_KEYS, `prior closure package ${index}`);
  if (
    row.name !== name
    || row.version !== expectedPriorVector[name]
    || !Array.isArray(row.dependencyAliases)
  ) {
    fail(`package ${name} identity drifted`);
  }
  if (row.version === null) {
    if (
      row.status !== 'absent'
      || row.rollbackAction !== 'remove'
      || row.tarballFile !== null
      || row.tarballSha256 !== null
      || row.registryIntegrity !== null
      || row.registryShasum !== null
      || row.manifestSha256 !== null
      || row.dependencySections !== null
      || row.dependencyAliases.length !== 0
    ) {
      fail(`absent package ${name} retained impossible evidence`);
    }
    return;
  }
  if (
    !VERSION_PATTERN.test(row.version ?? '')
    || row.status !== 'verified'
    || row.rollbackAction !== 'restore'
    || !SHA256_PATTERN.test(row.tarballSha256 ?? '')
    || !SHA256_PATTERN.test(row.manifestSha256 ?? '')
    || !SHA1_PATTERN.test(row.registryShasum ?? '')
    || !INTEGRITY_PATTERN.test(row.registryIntegrity ?? '')
  ) {
    fail(`verified package ${name} evidence drifted`);
  }
  requireExactKeys(
    row.dependencySections,
    DEPENDENCY_SECTIONS,
    `prior closure package ${name} dependency sections`,
  );
  const identities = new Set();
  let previousIdentity = null;
  for (const [aliasIndex, alias] of row.dependencyAliases.entries()) {
    requireExactKeys(alias, ALIAS_KEYS, `prior closure package ${name} alias ${aliasIndex}`);
    if (!DEPENDENCY_SECTIONS.includes(alias.section)) {
      fail(`package ${name} retained an unknown dependency section`);
    }
    const binding = validatePriorDependencyAlias({
      lease,
      ownerName: name,
      dependency: alias.dependency,
      target: alias.target,
      version: alias.version,
    });
    if (binding.sectionVector !== alias.sectionVector) {
      fail(`package ${name} alias vector drifted`);
    }
    const identity = [
      alias.section,
      alias.dependency,
      alias.target,
      alias.version,
    ].join('\0');
    if (
      identities.has(identity)
      || (previousIdentity !== null && identity.localeCompare(previousIdentity) <= 0)
    ) {
      fail(`package ${name} aliases are duplicated or unordered`);
    }
    identities.add(identity);
    previousIdentity = identity;
  }
  if (!revalidateArtifacts) return;
  const tarball = safeTarballPath(receiptPath, row, artifactRootOverride);
  const tarballBytes = readFileSync(tarball);
  if (
    sha256Hex(tarballBytes) !== row.tarballSha256
    || createHash('sha1').update(tarballBytes).digest('hex') !== row.registryShasum
    || `sha512-${createHash('sha512').update(tarballBytes).digest('base64')}`
      !== row.registryIntegrity
  ) {
    fail(`package ${name} retained tarball digest drifted`);
  }
  const { bytes, manifest } = extractManifest(tarball);
  if (
    manifest.name !== name
    || manifest.version !== row.version
    || sha256Hex(bytes) !== row.manifestSha256
  ) {
    fail(`package ${name} retained manifest identity drifted`);
  }
  const rescanned = dependencyAliases({ manifest, lease, ownerName: name });
  if (
    canonicalJcs(rescanned.sections) !== canonicalJcs(row.dependencySections)
    || canonicalJcs(rescanned.aliases) !== canonicalJcs(row.dependencyAliases)
  ) {
    fail(`package ${name} retained dependency evidence is incomplete`);
  }
}

export function validatePriorDefaultClosureReceipt({
  receipt,
  receiptPath,
  ledger,
  expectedPriorVector,
  operationId,
  publisherInstanceId,
  expectedProducerRevision,
  issuedAt,
  artifactRootOverride,
  revalidateArtifacts = true,
}) {
  // @ref LLP 0041#nine-package-candidate-promotion--2026-07-28
  // — promotion independently reopens retained prior tarballs and their full
  // dependency closure instead of trusting a requester-reported alias list.
  validateCandidateLedger(ledger);
  const promotionNames = promotionNamesForScopePreset(ledger.scopePreset);
  validateObservedPriorVector(expectedPriorVector, { packageNames: promotionNames });
  requireExactKeys(receipt, RECEIPT_KEYS, 'prior default closure receipt');
  const startedAt = parseTimestamp(receipt.startedAt, 'prior closure startedAt');
  const completedAt = parseTimestamp(receipt.completedAt, 'prior closure completedAt');
  if (
    receipt.schemaVersion !== 'snapback.prior-default-closure.v2'
    || receipt.policyVersion !== 'snapback.prior-default-closure-policy.v2'
    || receipt.registry !== PUBLIC_NPM_REGISTRY
    || receipt.defaultTag !== 'latest'
    || receipt.candidateLedgerSha256 !== ledger.candidateLedgerSha256
    || receipt.candidateTag !== ledger.tag
    || receipt.sourceRevision !== ledger.revision
    || receipt.operationId !== operationId
    || receipt.publisherInstanceId !== publisherInstanceId
    || !/^[0-9a-f]{40,64}$/u.test(receipt.producerRevision ?? '')
    || (
      expectedProducerRevision !== undefined
      && receipt.producerRevision !== expectedProducerRevision
    )
    || !SHA256_PATTERN.test(receipt.helperSha256 ?? '')
    || receipt.helperSha256 !== sha256Hex(readFileSync(HELPER_PATH))
    || completedAt < startedAt
    || completedAt - startedAt > 10 * 60_000
    || !SHA256_PATTERN.test(receipt.receiptSha256 ?? '')
    || canonicalJcs(receipt.initialVector) !== canonicalJcs(expectedPriorVector)
    || canonicalJcs(receipt.finalVector) !== canonicalJcs(expectedPriorVector)
    || receipt.receiptSha256 !== sha256Hex(canonicalJcs(unsignedReceipt(receipt)))
  ) {
    fail('receipt identity, vector, timing, producer, or digest drifted');
  }
  if (issuedAt !== undefined) {
    const issued = parseTimestamp(issuedAt, 'publication lease issuedAt');
    if (issued < completedAt || issued - completedAt > RECEIPT_MAX_AGE_MS) {
      fail('receipt was not completed immediately before lease issue');
    }
  }
  validateObservedPriorVector(receipt.initialVector, { packageNames: promotionNames });
  validateObservedPriorVector(receipt.finalVector, { packageNames: promotionNames });
  if (
    !Array.isArray(receipt.packages)
    || receipt.packages.length !== promotionNames.length
  ) {
    fail('receipt package inventory is incomplete');
  }
  if (revalidateArtifacts && !receiptPath) {
    fail('receipt path is required to reopen retained tarballs');
  }
  const lease = leaseShape(ledger, expectedPriorVector);
  for (const [index, name] of promotionNames.entries()) {
    validatePackageEvidence({
      row: receipt.packages[index],
      index,
      name,
      expectedPriorVector,
      lease,
      receiptPath,
      artifactRootOverride,
      revalidateArtifacts,
    });
  }
  return receipt;
}

function runNpm(args, { cacheRoot, cwd }) {
  const result = spawnSync('npm', [
    ...args,
    '--registry', PUBLIC_NPM_REGISTRY,
    '--cache', cacheRoot,
    '--prefer-online',
  ], {
    cwd,
    encoding: 'utf8',
    maxBuffer: 8 * 1024 * 1024,
    timeout: 120_000,
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  if (result.status !== 0) {
    if (args[0] === 'view' && npmResultIsPackageNotFound(result)) return null;
    fail(`npm ${args[0]} failed with ${result.status ?? result.signal ?? 'unknown'}`);
  }
  return result.stdout;
}

export function observeDefaultTagVector(promotionNames, npmRunner) {
  return Object.fromEntries(promotionNames.map((name) => {
    const output = npmRunner(['view', name, 'dist-tags', '--json']);
    if (output === null) return [name, null];
    const tags = output.trim() ? JSON.parse(output) : {};
    return [name, Object.hasOwn(tags, 'latest') ? tags.latest : null];
  }));
}

function observeVector(cacheRoot, cwd, promotionNames) {
  return observeDefaultTagVector(
    promotionNames,
    (args) => runNpm(args, { cacheRoot, cwd }),
  );
}

export function materializePriorDefaultClosure({
  ledger,
  priorVector,
  receiptPath,
  operationId,
  publisherInstanceId,
  producerRevision,
}) {
  // @ref LLP 0041#unreviewed-post-round-correction-publication-lease-and-rollback
  // — expensive prior qualification is bracketed and completed before the
  // authority allocates the fixed mutation/proof/rollback lease.
  validateCandidateLedger(ledger);
  const promotionNames = promotionNamesForScopePreset(ledger.scopePreset);
  validateObservedPriorVector(priorVector, { packageNames: promotionNames });
  if (!/^[0-9a-f]{40,64}$/u.test(producerRevision ?? '')) {
    fail('producer revision must be a lowercase Git object identity');
  }
  const outputParent = dirname(receiptPath);
  const artifactPath = priorClosureArtifactsPath(receiptPath);
  mkdirSync(outputParent, { recursive: true, mode: 0o700 });
  if (existsSync(receiptPath) || existsSync(artifactPath)) {
    fail('receipt or artifact output already exists');
  }
  const temporaryRoot = mkdtempSync(join(outputParent, '.snapback-prior-'));
  const cacheRoot = join(temporaryRoot, `npm-cache-${randomUUID()}`);
  const packRoot = join(temporaryRoot, 'packs');
  const stagedArtifactRoot = join(temporaryRoot, 'artifacts');
  mkdirSync(packRoot, { recursive: true, mode: 0o700 });
  mkdirSync(stagedArtifactRoot, { recursive: true, mode: 0o700 });
  const lease = leaseShape(ledger, priorVector);
  const startedAt = new Date().toISOString();
  let artifactsCommitted = false;
  try {
    const initialVector = observeVector(cacheRoot, temporaryRoot, promotionNames);
    if (canonicalJcs(initialVector) !== canonicalJcs(priorVector)) {
      fail('initial official default-tag vector differs from the proposed lease');
    }
    const packages = [];
    for (const [index, row] of lease.packages.entries()) {
      if (row.expectedPriorVersion === null) {
        packages.push({
          name: row.name,
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
        });
        continue;
      }
      const packedRows = JSON.parse(runNpm([
        'pack',
        `${row.name}@${row.expectedPriorVersion}`,
        '--pack-destination',
        packRoot,
        '--json',
        '--ignore-scripts',
      ], { cacheRoot, cwd: temporaryRoot }));
      if (!Array.isArray(packedRows) || packedRows.length !== 1) {
        fail(`npm pack returned an invalid result for ${row.name}`);
      }
      const packed = packedRows[0];
      const sourceTarball = join(packRoot, basename(packed.filename ?? ''));
      const tarballFile = `${String(index).padStart(2, '0')}.tgz`;
      const tarball = join(stagedArtifactRoot, tarballFile);
      renameSync(sourceTarball, tarball);
      safeTarballPath(receiptPath, {
        name: row.name,
        tarballFile,
      }, stagedArtifactRoot);
      const tarballBytes = readFileSync(tarball);
      const tarballSha256 = sha256Hex(tarballBytes);
      const registryShasum = createHash('sha1')
        .update(tarballBytes)
        .digest('hex');
      const registryIntegrity = `sha512-${createHash('sha512')
        .update(tarballBytes)
        .digest('base64')}`;
      if (
        packed.shasum !== registryShasum
        || packed.integrity !== registryIntegrity
      ) {
        fail(`npm pack integrity output drifted for ${row.name}`);
      }
      const { bytes, manifest } = extractManifest(tarball);
      if (manifest.name !== row.name || manifest.version !== row.expectedPriorVersion) {
        fail(`registry identity drift for ${row.name}`);
      }
      const scanned = dependencyAliases({
        manifest,
        lease,
        ownerName: row.name,
      });
      packages.push({
        name: row.name,
        version: row.expectedPriorVersion,
        status: 'verified',
        rollbackAction: 'restore',
        tarballFile,
        tarballSha256,
        registryIntegrity,
        registryShasum,
        manifestSha256: sha256Hex(bytes),
        dependencySections: scanned.sections,
        dependencyAliases: scanned.aliases,
      });
    }
    const finalVector = observeVector(cacheRoot, temporaryRoot, promotionNames);
    if (
      canonicalJcs(finalVector) !== canonicalJcs(initialVector)
      || canonicalJcs(finalVector) !== canonicalJcs(priorVector)
    ) {
      fail('official default-tag vector drifted while closure was collected');
    }
    const receipt = {
      schemaVersion: 'snapback.prior-default-closure.v2',
      policyVersion: 'snapback.prior-default-closure-policy.v2',
      registry: PUBLIC_NPM_REGISTRY,
      defaultTag: 'latest',
      candidateLedgerSha256: ledger.candidateLedgerSha256,
      candidateTag: ledger.tag,
      sourceRevision: ledger.revision,
      producerRevision,
      helperSha256: sha256Hex(readFileSync(HELPER_PATH)),
      operationId,
      publisherInstanceId,
      startedAt,
      completedAt: new Date().toISOString(),
      initialVector,
      finalVector,
      packages,
    };
    receipt.receiptSha256 = sha256Hex(canonicalJcs(receipt));
    validatePriorDefaultClosureReceipt({
      receipt,
      receiptPath,
      ledger,
      expectedPriorVector: priorVector,
      operationId,
      publisherInstanceId,
      artifactRootOverride: stagedArtifactRoot,
    });
    renameSync(stagedArtifactRoot, artifactPath);
    artifactsCommitted = true;
    return receipt;
  } finally {
    rmSync(temporaryRoot, { recursive: true, force: true });
    if (!artifactsCommitted && existsSync(artifactPath)) {
      rmSync(artifactPath, { recursive: true, force: true });
    }
  }
}

export function priorClosureArtifactsPath(outputPath) {
  return `${resolve(outputPath)}.artifacts`;
}

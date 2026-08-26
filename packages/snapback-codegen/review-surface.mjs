// Generated-artifact custody and resolution.
//
// This is a client/tool-owned protocol. The Snapback server never parses this
// manifest, so its schema authority intentionally lives beside codegen rather
// than in the Rust-owned shared schema set.
//
// @ref LLP 0010#generated-artifacts — a complete generated graph is published
// atomically and every consumed byte is bound to the complete input hash.
// @ref LLP 0037#revisit-triggers — client-only artifacts choose an explicit
// JavaScript authority instead of silently entering the Rust schema set.

import { createHash } from 'node:crypto';
import {
  cpSync,
  existsSync,
  lstatSync,
  mkdirSync,
  readFileSync,
  readdirSync,
  renameSync,
  rmSync,
  writeFileSync,
} from 'node:fs';
import { basename, dirname, isAbsolute, join, relative, resolve, sep } from 'node:path';

export const REVIEW_MANIFEST_VERSION = 2;
export const REVIEW_MANIFEST_FILE = 'artifacts.json';
export const CUSTODY = Object.freeze({
  reviewManifest: 'review-manifest',
  consumerCommitted: 'consumer-committed',
  regenerableCache: 'regenerable-cache',
});

const SHA256 = /^sha256:[0-9a-f]{64}$/u;
const INPUTS_HASH = /^(?:[0-9a-f]{16,64}|snapback\.v[0-9]+:[a-z0-9][a-z0-9-]*:inputs:sha256:[0-9a-f]{64})$/u;

export function stableArtifactJson(value) {
  const sort = (entry) => {
    if (Array.isArray(entry)) return entry.map(sort);
    if (entry && typeof entry === 'object') {
      const output = Object.create(null);
      for (const key of Object.keys(entry).sort()) output[key] = sort(entry[key]);
      return output;
    }
    return entry;
  };
  return JSON.stringify(sort(value), null, 2);
}

export function artifactSha256(bytes) {
  return `sha256:${createHash('sha256').update(bytes).digest('hex')}`;
}

export function codegenProjectRoot(backendRoot) {
  const canonical = resolve(backendRoot);
  return basename(canonical) === 'snapback' ? dirname(canonical) : canonical;
}

export function codegenCacheGraphRoot(backendRoot, inputsHash) {
  if (typeof inputsHash !== 'string' || !INPUTS_HASH.test(inputsHash)) {
    throw reviewError(
      'SNAPBACK_CODEGEN_INPUTS_HASH_INVALID',
      'inputsHash is not a canonical content identity',
      { inputsHash },
    );
  }
  const cacheRoot = join(
    codegenProjectRoot(backendRoot),
    '.snapback',
    'codegen-cache',
  );
  const graphRoot = resolve(cacheRoot, encodeURIComponent(inputsHash));
  const graphRelative = relative(cacheRoot, graphRoot);
  if (graphRelative === '..' || graphRelative.startsWith(`..${sep}`) || isAbsolute(graphRelative)) {
    throw reviewError(
      'SNAPBACK_CODEGEN_INPUTS_HASH_INVALID',
      'inputsHash resolves outside the codegen cache',
      { inputsHash },
    );
  }
  return graphRoot;
}

export function logicalArtifactKind(path) {
  if (path === 'authorization-review.json') return 'authorization-review';
  if (path === 'schema.manifest.json') return 'schema-manifest';
  if (path === 'functions.manifest.json') return 'function-manifest';
  if (path === 'normalized-definition.v1.json') return 'normalized-application-definition';
  if (path === 'handler-runtime-profile.v1.json') return 'handler-runtime-profile';
  if (path === 'client-lifecycle.v1.json') return 'client-lifecycle';
  if (path === 'capability.manifest.json') return 'capability-manifest';
  if (path === 'contract-data.manifest.json') return 'contract-data-manifest';
  if (path === 'provider-introspection.json') return 'provider-introspection';
  if (path === 'provider-bindings.json' || path === 'provider-bindings.d.ts') return 'provider-binding';
  if (path === 'app.descriptor.json' || /^app\.descriptor\.[0-9a-f]{64}\.json$/u.test(path)) return 'app-descriptor';
  if (path === 'app.binding.mjs' || /^app\.binding\.[0-9a-f]{64}\.mjs$/u.test(path) || path === 'app.mjs' || path === 'app.d.ts' || path === 'app.d.mts') return 'typed-app-descriptor';
  if (path === 'api.mjs' || path === 'api.d.ts' || path === 'api.d.mts') return 'typed-api';
  if (path === 'package.json') return 'package-metadata';
  if (path === 'routes.manifest.json') return 'route-manifest';
  if (path.startsWith('operations/')) return 'operation-schema';
  if (path.startsWith('contract/')) return 'contract-projection';
  if (path.includes('remote-')) return 'remote-service-projection';
  return 'generated-projection';
}

export function artifactConsumer(path) {
  if (path === 'authorization-review.json') return 'authorization-reviewers';
  if (path === 'handler-runtime-profile.v1.json') return 'developer-tooling';
  if (path === 'client-lifecycle.v1.json') return 'developer-tooling';
  if (path === 'normalized-definition.v1.json') return 'migration-tooling';
  if (path === 'schema.manifest.json' || path === 'functions.manifest.json' || path === 'capability.manifest.json') {
    return 'snapback-runtime';
  }
  if (path === 'contract-data.manifest.json' || path.startsWith('contract/')) return 'contract';
  if (path === 'app.descriptor.json') return 'inspection';
  if (/^app\.descriptor\.[0-9a-f]{64}\.json$/u.test(path) || path === 'app.binding.mjs' || /^app\.binding\.[0-9a-f]{64}\.mjs$/u.test(path) || path === 'app.mjs' || path === 'app.d.ts' || path === 'app.d.mts' || path === 'api.mjs' || path === 'api.d.ts' || path === 'api.d.mts' || path === 'package.json') return 'client-bundler';
  if (path.startsWith('operations/')) return 'app-cli';
  if (path.startsWith('remote-')) return 'release';
  return 'tooling';
}

export function createArtifactFileRecords(
  graphRoot,
  artifactPaths,
  { committedProjectionPaths = [], targetProfile = 'local-dev-sqlite-ibex' } = {},
) {
  // @ref LLP 0173#1-artifact-and-custody — the authorization projection is
  // always consumer-committed; app policy cannot demote this review surface.
  const committed = withDeclarationPairCustody(new Set([...committedProjectionPaths, 'authorization-review.json']));
  const expectedPaths = [...artifactPaths].sort(compareCodeUnits);
  const actualPaths = listArtifactPaths(graphRoot);
  if (
    expectedPaths.length !== actualPaths.length
    || expectedPaths.some((path, index) => path !== actualPaths[index])
  ) {
    throw reviewError(
      'SNAPBACK_CODEGEN_ARTIFACT_INVENTORY_MISMATCH',
      'generated files differ from the declared complete artifact inventory',
      { expectedPaths, actualPaths },
    );
  }
  const unknownCommitted = [...committed].filter((path) => !actualPaths.includes(path));
  if (unknownCommitted.length > 0) {
    throw reviewError(
      'SNAPBACK_CODEGEN_COMMITTED_PROJECTION_UNKNOWN',
      'consumer-committed policy names files codegen did not produce',
      { paths: unknownCommitted.sort(compareCodeUnits) },
    );
  }
  return actualPaths.map((path) => {
    assertPortableRelativePath(path, 'artifact path');
    const absolute = join(graphRoot, ...path.split('/'));
    const stat = lstatSync(absolute);
    if (!stat.isFile() || stat.isSymbolicLink()) {
      throw reviewError('SNAPBACK_CODEGEN_ARTIFACT_INVALID', `generated artifact is not a regular file: ${path}`, { path });
    }
    const bytes = readFileSync(absolute);
    return {
      path,
      sha256: artifactSha256(bytes),
      bytes: bytes.byteLength,
      logicalKind: logicalArtifactKind(path),
      custody: committed.has(path) ? CUSTODY.consumerCommitted : CUSTODY.regenerableCache,
      consumer: artifactConsumer(path),
      ...(path === 'authorization-review.json'
        ? { authority: '@expo/snapback-codegen/authorization-review.schema.json' }
        : {}),
      regeneration: {
        rule: 'complete-inputs-hash',
        command: `snapback generate snapback --target-profile ${targetProfile}`,
      },
    };
  });
}

function listArtifactPaths(root) {
  const paths = [];
  const visit = (directory, prefix) => {
    for (const entry of readdirSync(directory, { withFileTypes: true }).sort(({ name: left }, { name: right }) => compareCodeUnits(left, right))) {
      const childPrefix = prefix ? `${prefix}/${entry.name}` : entry.name;
      const absolute = join(directory, entry.name);
      if (entry.isSymbolicLink()) {
        throw reviewError('SNAPBACK_CODEGEN_ARTIFACT_INVALID', `generated graph contains a symlink: ${childPrefix}`, { path: childPrefix });
      }
      if (entry.isDirectory()) visit(absolute, childPrefix);
      else if (entry.isFile() && childPrefix !== REVIEW_MANIFEST_FILE) paths.push(childPrefix);
      else if (!entry.isFile()) {
        throw reviewError('SNAPBACK_CODEGEN_ARTIFACT_INVALID', `generated graph contains a non-file entry: ${childPrefix}`, { path: childPrefix });
      }
    }
  };
  visit(root, '');
  return paths.sort(compareCodeUnits);
}

export function createReviewManifest({
  legacyIndex,
  backendRoot,
  outputDirectory,
  files,
  summary,
}) {
  const cacheRoot = codegenCacheGraphRoot(backendRoot, legacyIndex.inputsHash);
  const generatedRoot = join(backendRoot, outputDirectory);
  const custodyCounts = {
    [CUSTODY.reviewManifest]: 1,
    [CUSTODY.consumerCommitted]: files.filter(({ custody }) => custody === CUSTODY.consumerCommitted).length,
    [CUSTODY.regenerableCache]: files.filter(({ custody }) => custody === CUSTODY.regenerableCache).length,
  };
  return {
    ...legacyIndex,
    manifestVersion: REVIEW_MANIFEST_VERSION,
    reviewManifest: {
      path: REVIEW_MANIFEST_FILE,
      custody: CUSTODY.reviewManifest,
      authority: '@expo/snapback-codegen/review-manifest.schema.json',
    },
    cache: {
      key: encodeURIComponent(legacyIndex.inputsHash),
      graphPath: normalizePath(relative(generatedRoot, cacheRoot)),
      regenerationRule: 'regenerate-or-fail-closed',
    },
    custody: custodyCounts,
    files,
    summary,
  };
}

export function validateReviewManifest(manifest) {
  const problems = [];
  if (!manifest || typeof manifest !== 'object' || Array.isArray(manifest)) {
    return ['manifest must be an object'];
  }
  if (manifest.artifactKind !== 'artifactIndex') problems.push('artifactKind must be "artifactIndex"');
  if (manifest.manifestVersion !== REVIEW_MANIFEST_VERSION) problems.push(`manifestVersion must be ${REVIEW_MANIFEST_VERSION}`);
  const inputsHashValid = typeof manifest.inputsHash === 'string'
    && INPUTS_HASH.test(manifest.inputsHash);
  if (!inputsHashValid) problems.push('inputsHash must be a canonical content identity');
  if (
    manifest.reviewManifest?.path !== REVIEW_MANIFEST_FILE
    || manifest.reviewManifest?.custody !== CUSTODY.reviewManifest
    || manifest.reviewManifest?.authority !== '@expo/snapback-codegen/review-manifest.schema.json'
  ) {
    problems.push('reviewManifest must name the committed artifacts.json authority');
  }
  if (
    !inputsHashValid
    || manifest.cache?.key !== encodeURIComponent(manifest.inputsHash)
    || manifest.cache?.regenerationRule !== 'regenerate-or-fail-closed'
  ) {
    problems.push('cache identity must be derived from the complete inputsHash');
  }
  if (!Array.isArray(manifest.files) || manifest.files.length === 0) {
    problems.push('files must be a non-empty array');
  } else {
    const seen = new Set();
    let prior = null;
    for (const file of manifest.files) {
      if (typeof file?.path !== 'string') {
        problems.push('every file must have a path');
        continue;
      }
      try {
        assertPortableRelativePath(file.path, 'file path');
      } catch (error) {
        problems.push(error.message);
      }
      if (seen.has(file.path)) problems.push(`duplicate file ${file.path}`);
      if (prior !== null && compareCodeUnits(prior, file.path) >= 0) problems.push('files must be strictly code-unit sorted');
      seen.add(file.path);
      prior = file.path;
      if (!SHA256.test(file.sha256 ?? '')) problems.push(`${file.path} has an invalid sha256`);
      if (!Number.isSafeInteger(file.bytes) || file.bytes < 0) problems.push(`${file.path} has invalid bytes`);
      if (!Object.values(CUSTODY).includes(file.custody) || file.custody === CUSTODY.reviewManifest) {
        problems.push(`${file.path} has invalid custody`);
      }
      if (typeof file.logicalKind !== 'string' || typeof file.consumer !== 'string') {
        problems.push(`${file.path} must name logicalKind and consumer`);
      }
      if (
        file.path === 'authorization-review.json'
        && (
          file.custody !== CUSTODY.consumerCommitted
          || file.logicalKind !== 'authorization-review'
          || file.consumer !== 'authorization-reviewers'
          || file.authority !== '@expo/snapback-codegen/authorization-review.schema.json'
        )
      ) {
        problems.push('authorization-review.json must name its consumer-committed schema authority');
      }
      if (
        file.regeneration?.rule !== 'complete-inputs-hash'
        || typeof file.regeneration?.command !== 'string'
      ) {
        problems.push(`${file.path} must name its regeneration rule`);
      }
    }
    const legacy = Array.isArray(manifest.artifacts) ? [...manifest.artifacts].sort(compareCodeUnits) : [];
    if (legacy.length !== seen.size || legacy.some((path) => !seen.has(path))) {
      problems.push('legacy artifacts and digested files inventory must match');
    }
    const expectedCustody = {
      [CUSTODY.reviewManifest]: 1,
      [CUSTODY.consumerCommitted]: manifest.files.filter(({ custody }) => custody === CUSTODY.consumerCommitted).length,
      [CUSTODY.regenerableCache]: manifest.files.filter(({ custody }) => custody === CUSTODY.regenerableCache).length,
    };
    if (
      !manifest.custody
      || Object.keys(expectedCustody).some((key) => manifest.custody[key] !== expectedCustody[key])
      || Object.keys(manifest.custody).length !== Object.keys(expectedCustody).length
    ) {
      problems.push('custody counts must match the file inventory');
    }
    if (
      manifest.summary?.schemaVersion !== 'snapback.codegen-summary.v1'
      || manifest.summary?.appId !== manifest.appId
      || manifest.summary?.inputsHash !== manifest.inputsHash
      || manifest.summary?.counts?.custody?.reviewManifest !== 1
      || manifest.summary?.counts?.custody?.consumerCommitted !== expectedCustody[CUSTODY.consumerCommitted]
      || manifest.summary?.counts?.custody?.regenerableCache !== expectedCustody[CUSTODY.regenerableCache]
      || manifest.summary?.counts?.custody?.total !== manifest.files.length + 1
    ) {
      problems.push('summary identity and custody counts must match the manifest');
    }
  }
  return problems;
}

export function readReviewManifest(generatedRoot) {
  const path = join(resolve(generatedRoot), REVIEW_MANIFEST_FILE);
  let value;
  try {
    value = JSON.parse(readFileSync(path, 'utf8'));
  } catch (cause) {
    throw reviewError('SNAPBACK_CODEGEN_REVIEW_MANIFEST_INVALID', `could not read review manifest ${path}`, { path }, cause);
  }
  return { path, value };
}

export function verifyGeneratedGraph(generatedRoot) {
  const materializedRoot = resolve(generatedRoot);
  const { path: reviewPath, value: manifest } = readReviewManifest(materializedRoot);
  if (manifest?.manifestVersion !== REVIEW_MANIFEST_VERSION) {
    verifyLegacyGraph(materializedRoot, manifest);
    return { layout: 'legacy', graphRoot: materializedRoot, materializedRoot, reviewPath, manifest };
  }
  const problems = validateReviewManifest(manifest);
  if (problems.length > 0) {
    throw reviewError('SNAPBACK_CODEGEN_REVIEW_MANIFEST_INVALID', `invalid codegen review manifest: ${problems.join('; ')}`, { path: reviewPath, problems });
  }
  const backendRoot = dirname(materializedRoot);
  const graphRoot = codegenCacheGraphRoot(backendRoot, manifest.inputsHash);
  const expectedRelative = normalizePath(relative(materializedRoot, graphRoot));
  if (manifest.cache.graphPath !== expectedRelative) {
    throw reviewError('SNAPBACK_CODEGEN_REVIEW_MANIFEST_INVALID', 'review manifest cache path does not match its complete input hash', {
      expected: expectedRelative,
      observed: manifest.cache.graphPath,
    });
  }
  const cachedReview = join(graphRoot, REVIEW_MANIFEST_FILE);
  try {
    const stat = lstatSync(cachedReview);
    if (!stat.isFile() || stat.isSymbolicLink()) throw new Error('not a regular nonsymlink file');
    if (!readFileSync(cachedReview).equals(readFileSync(reviewPath))) throw new Error('cache review manifest differs from committed review manifest');
  } catch (cause) {
    throw cacheInvalid(graphRoot, cause.message);
  }
  verifyClosedInventory(graphRoot, manifest.files, 'SNAPBACK_CODEGEN_CACHE_INVALID');
  verifyClosedInventory(materializedRoot, manifest.files, 'SNAPBACK_CODEGEN_MATERIALIZATION_INVALID');
  for (const file of manifest.files) {
    verifyFile(graphRoot, file, 'SNAPBACK_CODEGEN_CACHE_INVALID');
    verifyFile(materializedRoot, file, 'SNAPBACK_CODEGEN_MATERIALIZATION_INVALID');
  }
  return { layout: 'review-cache', graphRoot, materializedRoot, reviewPath, manifest };
}

export function resolveGeneratedArtifact(generatedRoot, artifactPath) {
  assertPortableRelativePath(artifactPath, 'artifact path');
  if (artifactPath === REVIEW_MANIFEST_FILE) return join(resolve(generatedRoot), REVIEW_MANIFEST_FILE);
  let resolved;
  try {
    resolved = verifyGeneratedGraph(generatedRoot);
  } catch (error) {
    // Migration compatibility for the oldest generated layouts, which
    // predate artifacts.json entirely. Once a review manifest exists it is
    // authoritative and all failures remain fail-closed.
    if (
      error.code === 'SNAPBACK_CODEGEN_REVIEW_MANIFEST_INVALID'
      && !existsSync(join(resolve(generatedRoot), REVIEW_MANIFEST_FILE))
    ) {
      const legacyPath = join(resolve(generatedRoot), ...artifactPath.split('/'));
      // The legacy caller remains responsible for opening the path; its
      // existing read/load boundary supplies the missing-file diagnostic.
      return legacyPath;
    }
    if (error.code !== 'SNAPBACK_CODEGEN_CACHE_INVALID') throw error;
    const { value: manifest } = readReviewManifest(generatedRoot);
    const record = manifest.files?.find(({ path }) => path === artifactPath);
    if (record?.custody !== CUSTODY.consumerCommitted) throw error;
    verifyFile(resolve(generatedRoot), record, 'SNAPBACK_CODEGEN_MATERIALIZATION_INVALID');
    return join(resolve(generatedRoot), ...artifactPath.split('/'));
  }
  const record = resolved.manifest.manifestVersion === REVIEW_MANIFEST_VERSION
    ? resolved.manifest.files.find(({ path }) => path === artifactPath)
    : null;
  if (resolved.layout === 'review-cache' && !record) {
    throw reviewError('SNAPBACK_CODEGEN_ARTIFACT_NOT_IN_MANIFEST', `artifact is not in review manifest: ${artifactPath}`, { artifact: artifactPath });
  }
  return join(resolved.graphRoot, ...artifactPath.split('/'));
}

export function publishGeneratedGraph({
  temporaryGraphRoot,
  cacheGraphRoot,
  materializedRoot,
  reviewManifest,
  testHooks = undefined,
}) {
  const stagingRoot = dirname(resolve(temporaryGraphRoot));
  const projectRoot = codegenProjectRoot(dirname(resolve(materializedRoot)));
  const stagingRelativeToProject = relative(projectRoot, stagingRoot);
  const candidateRelativeToStaging = relative(stagingRoot, resolve(temporaryGraphRoot));
  if (
    stagingRelativeToProject === ''
    || (!stagingRelativeToProject.startsWith(`..${sep}`) && stagingRelativeToProject !== '..')
    || candidateRelativeToStaging === '..'
    || candidateRelativeToStaging.startsWith(`..${sep}`)
    || isAbsolute(candidateRelativeToStaging)
  ) {
    throw new TypeError('codegen publication staging must contain the candidate outside the project root');
  }
  const cacheParent = dirname(cacheGraphRoot);
  mkdirSync(cacheParent, { recursive: true });
  writeFileSync(join(temporaryGraphRoot, REVIEW_MANIFEST_FILE), `${stableArtifactJson(reviewManifest)}\n`);
  atomicReplaceDirectory(temporaryGraphRoot, cacheGraphRoot, {
    backupDir: join(stagingRoot, 'cache-backup'),
  });
  verifyGeneratedGraphFromManifest(cacheGraphRoot, reviewManifest);

  const materializedTmp = join(stagingRoot, 'materialized-graph');
  rmSync(materializedTmp, { recursive: true, force: true });
  cpSync(cacheGraphRoot, materializedTmp, { recursive: true, errorOnExist: true });
  atomicReplaceDirectory(
    materializedTmp,
    materializedRoot,
    {
      backupDir: join(stagingRoot, 'materialized-backup'),
      afterBackup: testHooks?.afterMaterializedBackup,
    },
  );
  return verifyGeneratedGraph(materializedRoot);
}

function verifyGeneratedGraphFromManifest(graphRoot, manifest) {
  verifyClosedInventory(graphRoot, manifest.files, 'SNAPBACK_CODEGEN_CACHE_INVALID');
  for (const file of manifest.files) verifyFile(graphRoot, file, 'SNAPBACK_CODEGEN_CACHE_INVALID');
}

function verifyClosedInventory(root, records, code) {
  let actual;
  try {
    actual = listArtifactPaths(root);
  } catch (cause) {
    if (code === 'SNAPBACK_CODEGEN_CACHE_INVALID') throw cacheInvalid(root, cause.message);
    throw reviewError(code, `generated materialization inventory is invalid: ${cause.message}`, {
      materializedRoot: root,
      remediation: 'Run `snapback generate snapback` and retry.',
    });
  }
  const expected = records.map(({ path }) => path);
  if (
    actual.length !== expected.length
    || actual.some((path, index) => path !== expected[index])
  ) {
    const reason = `closed inventory differs (expected ${expected.length} files, found ${actual.length})`;
    if (code === 'SNAPBACK_CODEGEN_CACHE_INVALID') throw cacheInvalid(root, reason);
    throw reviewError(code, `generated materialization is missing, stale, or contains unreviewed files: ${reason}`, {
      materializedRoot: root,
      expected,
      actual,
      remediation: 'Run `snapback generate snapback` and retry.',
    });
  }
}

function verifyLegacyGraph(root, manifest) {
  if (manifest?.artifactKind !== 'artifactIndex') {
    throw reviewError('SNAPBACK_CODEGEN_REVIEW_MANIFEST_INVALID', 'legacy artifact index is invalid', { root });
  }
  for (const path of manifest.artifacts ?? []) {
    assertPortableRelativePath(path, 'legacy artifact path');
    const absolute = join(root, ...path.split('/'));
    try {
      const stat = lstatSync(absolute);
      if (!stat.isFile() || stat.isSymbolicLink()) throw new Error('not a regular file');
    } catch (cause) {
      throw reviewError('SNAPBACK_CODEGEN_LEGACY_GRAPH_INCOMPLETE', `legacy generated graph is missing ${path}`, { path }, cause);
    }
  }
}

function verifyFile(root, record, code) {
  const absolute = join(root, ...record.path.split('/'));
  try {
    const stat = lstatSync(absolute);
    if (!stat.isFile() || stat.isSymbolicLink()) throw new Error('not a regular nonsymlink file');
    const bytes = readFileSync(absolute);
    if (bytes.byteLength !== record.bytes || artifactSha256(bytes) !== record.sha256) {
      throw new Error('content digest or byte count differs');
    }
  } catch (cause) {
    if (code === 'SNAPBACK_CODEGEN_CACHE_INVALID') throw cacheInvalid(root, `${record.path}: ${cause.message}`);
    throw reviewError(
      code,
      `generated materialization is missing or tampered; regenerate before bundling it: ${record.path}: ${cause.message}`,
      { materializedRoot: root, remediation: 'Run `snapback generate snapback` and retry.' },
    );
  }
}

function cacheInvalid(root, reason) {
  return reviewError(
    'SNAPBACK_CODEGEN_CACHE_INVALID',
    `generated cache is missing or tampered; regenerate before consuming it: ${reason}`,
    { cacheRoot: root, remediation: 'Run `snapback generate snapback` and retry.' },
  );
}

function reviewError(code, message, details = {}, cause = undefined) {
  const error = new Error(`${code}: ${message}`);
  error.code = code;
  error.details = details;
  error.diagnostic = {
    code,
    severity: 'error',
    subsystem: 'codegen',
    message,
    details,
  };
  if (cause) error.cause = cause;
  return error;
}

function assertPortableRelativePath(path, label) {
  if (
    typeof path !== 'string'
    || path.length === 0
    || isAbsolute(path)
    || path.includes('\\')
    || path.split('/').some((segment) => segment === '' || segment === '.' || segment === '..')
  ) {
    throw reviewError('SNAPBACK_CODEGEN_PATH_INVALID', `${label} must be a portable relative path`, { path });
  }
}

function atomicReplaceDirectory(tmpDir, outDir, { backupDir, afterBackup = undefined }) {
  rmSync(backupDir, { recursive: true, force: true });
  const hadExisting = existsSync(outDir);
  if (hadExisting) renameSync(outDir, backupDir);
  try {
    if (hadExisting) afterBackup?.({ backupDir, outDir, tmpDir });
    renameSync(tmpDir, outDir);
    rmSync(backupDir, { recursive: true, force: true });
  } catch (error) {
    if (hadExisting && !existsSync(outDir) && existsSync(backupDir)) renameSync(backupDir, outDir);
    throw error;
  }
}

function normalizePath(path) {
  return path.split(sep).join('/');
}

function compareCodeUnits(left, right) {
  return left < right ? -1 : left > right ? 1 : 0;
}

// @ref LLP 0277#f11-small-clientcodegen-papercuts--single-run-each — a
// relative `.mjs` consumer needs the `.d.mts` leaf, so declaration custody
// follows the compatibility `.d.ts` leaf (and vice versa) as one unit.
function withDeclarationPairCustody(committed) {
  for (const stem of ['app', 'api']) {
    const legacyDeclaration = `${stem}.d.ts`;
    const moduleDeclaration = `${stem}.d.mts`;
    if (committed.has(legacyDeclaration) || committed.has(moduleDeclaration)) {
      committed.add(legacyDeclaration);
      committed.add(moduleDeclaration);
    }
  }
  return committed;
}

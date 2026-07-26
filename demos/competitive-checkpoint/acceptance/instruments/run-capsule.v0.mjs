import { createHash } from 'node:crypto';
import { lstat, readFile, readdir } from 'node:fs/promises';
import { join, resolve, sep } from 'node:path';

const SHA256 = /^[a-f0-9]{64}$/;
const PACKAGE_NAME = /^(?:@[a-z0-9][a-z0-9._-]*\/)?[a-z0-9][a-z0-9._-]*$/;
const EXACT_SEMVER = /^(?:0|[1-9]\d*)\.(?:0|[1-9]\d*)\.(?:0|[1-9]\d*)(?:-[0-9A-Za-z-]+(?:\.[0-9A-Za-z-]+)*)?(?:\+[0-9A-Za-z-]+(?:\.[0-9A-Za-z-]+)*)?$/;
const PORTABLE_ID = /^[A-Za-z0-9][A-Za-z0-9._-]{0,127}$/;
const PUBLIC_NPM_REGISTRY = 'https://registry.npmjs.org';
const MAX_ARTIFACT_BYTES = 256 * 1024 * 1024;
const MAX_TREE_FILES = 100_000;
const ALLOWED_AUTHORIZATION = new Set([
  'candidate-unratified-blocks-timed-runs',
  'ratified-by-dated-amendment',
]);
const SECRET_VALUE_KEYS = new Set([
  'token',
  'accesstoken',
  'refreshtoken',
  'secret',
  'clientsecret',
  'password',
  'apikey',
  'privatekey',
  'credentialvalue',
  'keymaterial',
]);

// @ref LLP 0075#package-and-initial-state-freeze — capsule identity must use one host-independent path order
function compareCodeUnits(left, right) {
  return left < right ? -1 : left > right ? 1 : 0;
}

function assertKeys(value, required, optional, label) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    throw new Error(`${label} must be an object`);
  }
  for (const key of required) {
    if (!(key in value)) throw new Error(`${label} is missing ${key}`);
  }
  const allowed = new Set([...required, ...optional]);
  for (const key of Object.keys(value)) {
    if (!allowed.has(key)) throw new Error(`${label} has unknown field ${key}`);
  }
}

function assertText(value, label) {
  if (
    typeof value !== 'string'
    || value.trim() === ''
    || value.length > 1_024
    || /^(?:todo|tbd|unpinned|unknown|placeholder)$/i.test(value.trim())
  ) {
    throw new Error(`${label} must be exact and cannot be a placeholder`);
  }
}

function assertPortableId(value, label) {
  if (typeof value !== 'string' || !PORTABLE_ID.test(value)) {
    throw new Error(`${label} must be a portable identifier`);
  }
}

function assertSha256(value, label) {
  if (!SHA256.test(value ?? '')) throw new Error(`${label} must be a lowercase sha256`);
}

function assertRelativePath(value, label) {
  if (
    typeof value !== 'string'
    || value.length === 0
    || value.length > 1_024
    || value.startsWith('/')
    || value.endsWith('/')
    || value.includes('\\')
    || value.includes('\0')
    || value.split('/').some((segment) => segment === '' || segment === '.' || segment === '..')
  ) {
    throw new Error(`${label} must be a normalized relative path`);
  }
}

function assertSortedUnique(values, label) {
  if (new Set(values).size !== values.length) throw new Error(`${label} repeats a value`);
  if (values.some((value, index) => index > 0 && compareCodeUnits(values[index - 1], value) >= 0)) {
    throw new Error(`${label} must be strictly sorted`);
  }
}

function rejectSecretShapedKeys(value, path = 'content') {
  if (!value || typeof value !== 'object') return;
  for (const [key, child] of Object.entries(value)) {
    const normalized = key.replaceAll(/[^A-Za-z0-9]/g, '').toLowerCase();
    if (SECRET_VALUE_KEYS.has(normalized)) {
      throw new Error(`${path}.${key} may not contain a credential value`);
    }
    rejectSecretShapedKeys(child, `${path}.${key}`);
  }
}

export function canonicalJson(value) {
  if (value === null || typeof value !== 'object') return JSON.stringify(value);
  if (Array.isArray(value)) return `[${value.map(canonicalJson).join(',')}]`;
  return `{${Object.keys(value)
    .sort(compareCodeUnits)
    .map((key) => `${JSON.stringify(key)}:${canonicalJson(value[key])}`)
    .join(',')}}`;
}

export function sha256(value) {
  return createHash('sha256').update(value).digest('hex');
}

export function treeDigest(files) {
  return sha256(canonicalJson(files.map(({ path, sha256: digest }) => ({ path, sha256: digest }))));
}

function validateArtifact(artifact, label) {
  assertKeys(artifact, ['path', 'sha256'], [], label);
  assertRelativePath(artifact.path, `${label}.path`);
  assertSha256(artifact.sha256, `${label}.sha256`);
}

function artifactIdentity(artifact) {
  return `${artifact.path}\0${artifact.sha256}`;
}

function validateArtifactList(artifacts, label) {
  if (!Array.isArray(artifacts) || artifacts.length === 0) {
    throw new Error(`${label} cannot be empty`);
  }
  const paths = [];
  for (const [index, artifact] of artifacts.entries()) {
    validateArtifact(artifact, `${label}[${index}]`);
    paths.push(artifact.path);
  }
  assertSortedUnique(paths, label);
}

function validateTree(tree, label) {
  assertKeys(tree, ['root', 'treeSha256', 'files'], [], label);
  assertRelativePath(tree.root, `${label}.root`);
  assertSha256(tree.treeSha256, `${label}.treeSha256`);
  if (!Array.isArray(tree.files) || tree.files.length === 0) {
    throw new Error(`${label}.files cannot be empty`);
  }
  if (tree.files.length > MAX_TREE_FILES) throw new Error(`${label}.files exceeds the file-count bound`);
  const paths = [];
  for (const [index, file] of tree.files.entries()) {
    validateArtifact(file, `${label}.files[${index}]`);
    paths.push(file.path);
  }
  assertSortedUnique(paths, `${label}.files`);
  if (treeDigest(tree.files) !== tree.treeSha256) {
    throw new Error(`${label}.treeSha256 does not match its file list`);
  }
}

function validateCredentialChecks(checks, label) {
  if (!Array.isArray(checks) || checks.length === 0) throw new Error(`${label} cannot be empty`);
  const ids = [];
  for (const [index, check] of checks.entries()) {
    const checkLabel = `${label}[${index}]`;
    assertKeys(check, ['id', 'artifact'], [], checkLabel);
    assertPortableId(check.id, `${checkLabel}.id`);
    validateArtifact(check.artifact, `${checkLabel}.artifact`);
    ids.push(check.id);
  }
  assertSortedUnique(ids, label);
}

function validatePackageIntegrity(integrity, label) {
  if (typeof integrity !== 'string' || !integrity.startsWith('sha512-')) {
    throw new Error(`${label} must be sha512 SRI`);
  }
  const encoded = integrity.slice('sha512-'.length);
  const bytes = Buffer.from(encoded, 'base64');
  if (bytes.byteLength !== 64 || bytes.toString('base64') !== encoded) {
    throw new Error(`${label} must be canonical sha512 SRI`);
  }
}

function validatePackageClosure(closure, scaffold, label) {
  assertKeys(closure, ['lockfile', 'entries'], [], label);
  validateArtifact(closure.lockfile, `${label}.lockfile`);
  const expectedLockfilePath = `${scaffold.root}/package-lock.json`;
  if (closure.lockfile.path !== expectedLockfilePath) {
    throw new Error(`${label}.lockfile must be the starting scaffold package-lock.json`);
  }
  const scaffoldLockfile = scaffold.files.find(({ path }) => path === 'package-lock.json');
  if (!scaffoldLockfile || scaffoldLockfile.sha256 !== closure.lockfile.sha256) {
    throw new Error(`${label}.lockfile must exact-match the scaffold tree entry`);
  }
  if (!Array.isArray(closure.entries) || closure.entries.length === 0) {
    throw new Error(`${label}.entries cannot be empty`);
  }
  const paths = [];
  for (const [index, pkg] of closure.entries.entries()) {
    const entryLabel = `${label}.entries[${index}]`;
    assertKeys(pkg, ['path', 'name', 'version', 'registry', 'integrity'], [], entryLabel);
    assertRelativePath(pkg.path, `${entryLabel}.path`);
    if (!pkg.path.startsWith('node_modules/')) {
      throw new Error(`${entryLabel}.path must identify an installed node_modules package`);
    }
    if (typeof pkg.name !== 'string' || !PACKAGE_NAME.test(pkg.name)) {
      throw new Error(`${entryLabel}.name must be an exact npm package name`);
    }
    if (typeof pkg.version !== 'string' || !EXACT_SEMVER.test(pkg.version)) {
      throw new Error(`${entryLabel}.version must be an exact semantic version`);
    }
    if (pkg.registry !== PUBLIC_NPM_REGISTRY) {
      throw new Error(`${entryLabel}.registry must be the canonical public npm registry`);
    }
    validatePackageIntegrity(pkg.integrity, `${entryLabel}.integrity`);
    paths.push(pkg.path);
  }
  assertSortedUnique(paths, `${label}.entries`);
}

function validateContent(content) {
  assertKeys(
    content,
    [
      'neutralPrompt',
      'startingScaffolds',
      'normativeArtifacts',
      'machine',
      'networkPolicy',
      'packages',
      'providers',
      'credentials',
      'assistance',
    ],
    [],
    'content',
  );
  rejectSecretShapedKeys(content);
  validateArtifact(content.neutralPrompt, 'content.neutralPrompt');
  assertKeys(content.startingScaffolds, ['snapback', 'convex'], [], 'content.startingScaffolds');
  validateTree(content.startingScaffolds.snapback, 'content.startingScaffolds.snapback');
  validateTree(content.startingScaffolds.convex, 'content.startingScaffolds.convex');
  validateArtifactList(content.normativeArtifacts, 'content.normativeArtifacts');
  const normativeArtifacts = new Set(content.normativeArtifacts.map(artifactIdentity));
  const requireNormativeArtifact = (artifact, label) => {
    if (!normativeArtifacts.has(artifactIdentity(artifact))) {
      throw new Error(`${label} must be retained in content.normativeArtifacts`);
    }
  };

  assertKeys(
    content.machine,
    ['image', 'imageDigest', 'os', 'architecture', 'cpu', 'memoryBytes'],
    [],
    'content.machine',
  );
  for (const key of ['image', 'os', 'architecture', 'cpu']) {
    assertText(content.machine[key], `content.machine.${key}`);
  }
  if (!/^sha256:[a-f0-9]{64}$/.test(content.machine.imageDigest ?? '')) {
    throw new Error('content.machine.imageDigest must be an immutable sha256 image digest');
  }
  if (!Number.isSafeInteger(content.machine.memoryBytes) || content.machine.memoryBytes <= 0) {
    throw new Error('content.machine.memoryBytes must be a positive safe integer');
  }

  assertKeys(content.networkPolicy, ['name', 'artifact', 'description'], [], 'content.networkPolicy');
  assertPortableId(content.networkPolicy.name, 'content.networkPolicy.name');
  assertText(content.networkPolicy.description, 'content.networkPolicy.description');
  validateArtifact(content.networkPolicy.artifact, 'content.networkPolicy.artifact');
  requireNormativeArtifact(content.networkPolicy.artifact, 'content.networkPolicy.artifact');

  assertKeys(content.packages, ['snapback', 'convex'], [], 'content.packages');
  for (const arm of ['snapback', 'convex']) {
    validatePackageClosure(
      content.packages[arm],
      content.startingScaffolds[arm],
      `content.packages.${arm}`,
    );
  }

  assertKeys(content.providers, ['snapback', 'convex'], [], 'content.providers');
  for (const arm of ['snapback', 'convex']) {
    const provider = content.providers[arm];
    const label = `content.providers.${arm}`;
    assertKeys(
      provider,
      ['backend', 'region', 'plan', 'localTopology', 'frontendHost', 'provisioningPlan'],
      [],
      label,
    );
    for (const key of ['backend', 'region', 'plan', 'localTopology', 'frontendHost']) {
      assertText(provider[key], `${label}.${key}`);
    }
    validateArtifact(provider.provisioningPlan, `${label}.provisioningPlan`);
    requireNormativeArtifact(provider.provisioningPlan, `${label}.provisioningPlan`);
  }

  assertKeys(content.credentials, ['snapback', 'convex'], [], 'content.credentials');
  for (const arm of ['snapback', 'convex']) {
    const credential = content.credentials[arm];
    const label = `content.credentials.${arm}`;
    assertKeys(credential, ['preconditions', 'provisioningBoundary', 'healthChecks'], [], label);
    validateCredentialChecks(credential.preconditions, `${label}.preconditions`);
    validateCredentialChecks(credential.healthChecks, `${label}.healthChecks`);
    assertText(credential.provisioningBoundary, `${label}.provisioningBoundary`);
    for (const check of [...credential.preconditions, ...credential.healthChecks]) {
      requireNormativeArtifact(check.artifact, `${label}.${check.id}.artifact`);
    }
  }

  assertKeys(content.assistance, ['agentConfig', 'policy', 'documentationCorpora'], [], 'content.assistance');
  validateArtifact(content.assistance.agentConfig, 'content.assistance.agentConfig');
  validateArtifact(content.assistance.policy, 'content.assistance.policy');
  requireNormativeArtifact(content.assistance.agentConfig, 'content.assistance.agentConfig');
  requireNormativeArtifact(content.assistance.policy, 'content.assistance.policy');
  assertKeys(
    content.assistance.documentationCorpora,
    ['snapback', 'convex'],
    [],
    'content.assistance.documentationCorpora',
  );
  validateTree(
    content.assistance.documentationCorpora.snapback,
    'content.assistance.documentationCorpora.snapback',
  );
  validateTree(
    content.assistance.documentationCorpora.convex,
    'content.assistance.documentationCorpora.convex',
  );
}

function confinedPath(baseDir, relativePath) {
  const base = resolve(baseDir);
  const target = resolve(base, ...relativePath.split('/'));
  if (target !== base && !target.startsWith(`${base}${sep}`)) {
    throw new Error(`path escapes capsule root: ${relativePath}`);
  }
  return target;
}

async function requireSafeBaseDirectory(baseDir) {
  const base = resolve(baseDir);
  const info = await lstat(base);
  if (!info.isDirectory() || info.isSymbolicLink()) {
    throw new Error('capsule baseDir must be a non-symlink directory');
  }
  return base;
}

async function resolveSafePath(baseDir, relativePath, expectedKind, label) {
  assertRelativePath(relativePath, `${label}.path`);
  const base = resolve(baseDir);
  let current = base;
  const segments = relativePath.split('/');
  for (const [index, segment] of segments.entries()) {
    current = join(current, segment);
    const info = await lstat(current);
    if (info.isSymbolicLink()) throw new Error(`${label} crosses a symbolic link`);
    const leaf = index === segments.length - 1;
    if (!leaf && !info.isDirectory()) throw new Error(`${label} has a non-directory parent`);
    if (leaf && expectedKind === 'file' && (!info.isFile() || info.nlink !== 1)) {
      throw new Error(`${label} must resolve to a single-link regular file`);
    }
    if (leaf && expectedKind === 'directory' && !info.isDirectory()) {
      throw new Error(`${label} must resolve to a directory`);
    }
  }
  return current;
}

async function readVerifiedArtifact(baseDir, artifact, label) {
  const path = await resolveSafePath(baseDir, artifact.path, 'file', label);
  const info = await lstat(path);
  if (info.size > MAX_ARTIFACT_BYTES) throw new Error(`${label} exceeds the artifact byte bound`);
  const bytes = await readFile(path);
  if (sha256(bytes) !== artifact.sha256) throw new Error(`${label} bytes do not match sha256`);
  return bytes;
}

async function walkClosedTree(root) {
  const files = [];

  async function collect(directory, prefix = '') {
    const entries = await readdir(directory, { withFileTypes: true });
    entries.sort((left, right) => compareCodeUnits(left.name, right.name));
    for (const entry of entries) {
      const path = join(directory, entry.name);
      const relativePath = prefix === '' ? entry.name : `${prefix}/${entry.name}`;
      const info = await lstat(path);
      if (info.isSymbolicLink()) throw new Error(`tree crosses a symbolic link: ${relativePath}`);
      if (info.isDirectory()) {
        await collect(path, relativePath);
      } else if (info.isFile() && info.nlink === 1) {
        files.push(relativePath);
      } else {
        throw new Error(`tree contains a non-regular or multiply-linked entry: ${relativePath}`);
      }
      if (files.length > MAX_TREE_FILES) throw new Error('tree exceeds the file-count bound');
    }
  }

  await collect(root);
  return files.sort(compareCodeUnits);
}

async function verifyTreeBytes(baseDir, tree, label) {
  const root = await resolveSafePath(baseDir, tree.root, 'directory', label);
  const actualPaths = await walkClosedTree(root);
  const declaredPaths = tree.files.map(({ path }) => path);
  if (
    actualPaths.length !== declaredPaths.length
    || actualPaths.some((path, index) => path !== declaredPaths[index])
  ) {
    throw new Error(`${label} file closure differs from its manifest`);
  }
  for (const [index, file] of tree.files.entries()) {
    await readVerifiedArtifact(root, file, `${label}.files[${index}]`);
  }
}

function packageNameFromLockPath(path) {
  const marker = 'node_modules/';
  const index = path.lastIndexOf(marker);
  if (index < 0) throw new Error(`package lock path is not under node_modules: ${path}`);
  const leaf = path.slice(index + marker.length);
  const segments = leaf.split('/');
  if (segments[0]?.startsWith('@')) {
    if (segments.length !== 2) throw new Error(`scoped package lock path is malformed: ${path}`);
    return `${segments[0]}/${segments[1]}`;
  }
  if (segments.length !== 1) throw new Error(`package lock path is malformed: ${path}`);
  return segments[0];
}

function packageRegistry(resolved, label, expectedName) {
  let url;
  try {
    url = new URL(resolved);
  } catch {
    throw new Error(`${label}.resolved must be a canonical public npm tarball URL`);
  }
  if (
    url.origin !== PUBLIC_NPM_REGISTRY
    || url.username !== ''
    || url.password !== ''
    || url.search !== ''
    || url.hash !== ''
    || !url.pathname.endsWith('.tgz')
  ) {
    throw new Error(`${label}.resolved must be a canonical public npm tarball URL`);
  }
  const separator = url.pathname.indexOf('/-/');
  let resolvedName;
  try {
    resolvedName = decodeURIComponent(url.pathname.slice(1, separator));
  } catch {
    throw new Error(`${label}.resolved has a malformed package identity`);
  }
  if (separator < 2 || resolvedName !== expectedName) {
    throw new Error(`${label}.resolved does not identify package ${expectedName}`);
  }
  return url.origin;
}

async function verifyPackageClosure(baseDir, closure, label) {
  const bytes = await readVerifiedArtifact(baseDir, closure.lockfile, `${label}.lockfile`);
  let lockfile;
  try {
    lockfile = JSON.parse(bytes.toString('utf8'));
  } catch {
    throw new Error(`${label}.lockfile must be JSON`);
  }
  if (
    lockfile?.lockfileVersion !== 3
    || !lockfile.packages
    || typeof lockfile.packages !== 'object'
    || Array.isArray(lockfile.packages)
    || !lockfile.packages['']
  ) {
    throw new Error(`${label}.lockfile must be one npm package-lock v3 install closure`);
  }
  const entries = [];
  for (const path of Object.keys(lockfile.packages)
    .filter((path) => path !== '')
    .sort(compareCodeUnits)) {
    assertRelativePath(path, `${label}.lockfile.packages path`);
    const pkg = lockfile.packages[path];
    if (
      !pkg
      || typeof pkg !== 'object'
      || Array.isArray(pkg)
      || pkg.link === true
      || typeof pkg.version !== 'string'
      || !EXACT_SEMVER.test(pkg.version)
    ) {
      throw new Error(`${label}.lockfile contains a linked, local, or inexact package at ${path}`);
    }
    const installedName = packageNameFromLockPath(path);
    const name = pkg.name ?? installedName;
    if (typeof name !== 'string' || !PACKAGE_NAME.test(name)) {
      throw new Error(`${label}.lockfile package name is malformed at ${path}`);
    }
    validatePackageIntegrity(pkg.integrity, `${label}.lockfile.packages[${path}].integrity`);
    entries.push({
      path,
      name,
      version: pkg.version,
      registry: packageRegistry(pkg.resolved, `${label}.lockfile.packages[${path}]`, name),
      integrity: pkg.integrity,
    });
  }
  if (entries.length === 0 || canonicalJson(entries) !== canonicalJson(closure.entries)) {
    throw new Error(`${label}.entries do not exact-match the complete npm lockfile closure`);
  }
}

function validateProtocol(protocol) {
  assertKeys(protocol, ['path', 'sha256', 'id', 'version'], [], 'capsule.protocol');
  assertRelativePath(protocol.path, 'capsule.protocol.path');
  assertSha256(protocol.sha256, 'capsule.protocol.sha256');
  assertPortableId(protocol.id, 'capsule.protocol.id');
  if (typeof protocol.version !== 'string' || !/^v\d+(?:\.\d+)+$/.test(protocol.version)) {
    throw new Error('capsule.protocol.version must be an exact version');
  }
}

async function verifyProtocol(baseDir, protocol) {
  const bytes = await readVerifiedArtifact(baseDir, protocol, 'capsule.protocol');
  let parsed;
  try {
    parsed = JSON.parse(bytes.toString('utf8'));
  } catch {
    throw new Error('capsule.protocol bytes must be JSON');
  }
  if (parsed.protocolId !== protocol.id || parsed.protocolVersion !== protocol.version) {
    throw new Error('capsule.protocol identity does not match its bytes');
  }
  if (!Array.isArray(parsed.amendments)) throw new Error('capsule.protocol amendments must be explicit');
  return parsed;
}

function validateAuthorization(authorization, protocol, contentSha256) {
  assertKeys(
    authorization,
    ['status'],
    ['author', 'date', 'amendmentVersion'],
    'capsule.authorization',
  );
  if (!ALLOWED_AUTHORIZATION.has(authorization.status)) {
    throw new Error('capsule.authorization.status is invalid');
  }
  if (authorization.status !== 'ratified-by-dated-amendment') return;
  for (const key of ['author', 'date', 'amendmentVersion']) {
    assertText(authorization[key], `capsule.authorization.${key}`);
  }
  if (!/^\d{4}-\d{2}-\d{2}$/.test(authorization.date)) {
    throw new Error('capsule.authorization.date must be YYYY-MM-DD');
  }
  const amendment = protocol.amendments.find(
    (candidate) => candidate?.version === authorization.amendmentVersion,
  );
  if (
    !amendment
    || amendment.date !== authorization.date
    || amendment.ratifier !== authorization.author
    || amendment.runCapsuleContentSha256 !== contentSha256
    || amendment.timedRunsAuthorized !== true
  ) {
    throw new Error('capsule authorization is not backed by the named protocol amendment');
  }
}

export async function verifyRunCapsule(envelope, { baseDir }) {
  assertKeys(
    envelope,
    ['schemaVersion', 'protocol', 'contentSha256', 'content', 'authorization'],
    [],
    'capsule',
  );
  if (envelope.schemaVersion !== 'snapback.convex-checkpoint-run-capsule.candidate.v0') {
    throw new Error('unsupported capsule schemaVersion');
  }
  validateProtocol(envelope.protocol);
  assertSha256(envelope.contentSha256, 'capsule.contentSha256');
  validateContent(envelope.content);
  const computedContentSha256 = sha256(canonicalJson(envelope.content));
  if (computedContentSha256 !== envelope.contentSha256) {
    throw new Error('capsule contentSha256 does not match content');
  }

  const base = await requireSafeBaseDirectory(baseDir);
  const protocol = await verifyProtocol(base, envelope.protocol);
  validateAuthorization(envelope.authorization, protocol, computedContentSha256);
  await readVerifiedArtifact(base, envelope.content.neutralPrompt, 'content.neutralPrompt');
  for (const [index, artifact] of envelope.content.normativeArtifacts.entries()) {
    await readVerifiedArtifact(base, artifact, `content.normativeArtifacts[${index}]`);
  }
  await verifyTreeBytes(
    base,
    envelope.content.startingScaffolds.snapback,
    'content.startingScaffolds.snapback',
  );
  await verifyTreeBytes(
    base,
    envelope.content.startingScaffolds.convex,
    'content.startingScaffolds.convex',
  );
  await verifyPackageClosure(base, envelope.content.packages.snapback, 'content.packages.snapback');
  await verifyPackageClosure(base, envelope.content.packages.convex, 'content.packages.convex');
  await verifyTreeBytes(
    base,
    envelope.content.assistance.documentationCorpora.snapback,
    'content.assistance.documentationCorpora.snapback',
  );
  await verifyTreeBytes(
    base,
    envelope.content.assistance.documentationCorpora.convex,
    'content.assistance.documentationCorpora.convex',
  );
  return {
    protocolId: envelope.protocol.id,
    protocolVersion: envelope.protocol.version,
    protocolSha256: envelope.protocol.sha256,
    contentSha256: computedContentSha256,
    authorization: envelope.authorization.status,
  };
}

export async function authorizeTimedRun(envelope, options) {
  const verified = await verifyRunCapsule(envelope, options);
  if (verified.authorization !== 'ratified-by-dated-amendment') {
    throw new Error('timed run refused: capsule is not ratified by a dated amendment');
  }
  return verified;
}

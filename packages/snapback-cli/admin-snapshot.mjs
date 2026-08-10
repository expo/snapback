// Build and consumption contract for the packaged admin-console snapshot.
//
// @ref LLP 0017#static-bundling-and-the-native-shell — ordinary inspection
// serves one immutable Contract/Exact snapshot from the Snapback runtime.
// @ref LLP 0041#runtime-distribution — the published runtime closure must bind
// every support artifact it needs outside a source checkout.

import { createHash, randomUUID } from 'node:crypto';
import {
  closeSync,
  cpSync,
  existsSync,
  fstatSync,
  lstatSync,
  mkdirSync,
  openSync,
  readFileSync,
  readSync,
  readdirSync,
  renameSync,
  rmSync,
  writeFileSync,
} from 'node:fs';
import { dirname, join, resolve } from 'node:path';

export const ADMIN_SNAPSHOT_SCHEMA_VERSION =
  'snapback.admin-console-snapshot.v1';
export const ADMIN_SNAPSHOT_MANIFEST = 'snapback-admin-snapshot.json';
export const ADMIN_SNAPSHOT_MOUNT_PATH = '/_snapback/admin/';

const INVALID_CODE = 'SNAPBACK_IBEX_RUNTIME_RECEIPT_INVALID';
const MAX_FILES = 10_000;
const MAX_FILE_BYTES = 32 * 1024 * 1024;
const MAX_TOTAL_BYTES = 128 * 1024 * 1024;
const MAX_MANIFEST_BYTES = 2 * 1024 * 1024;
const HASH_CHUNK_BYTES = 1024 * 1024;
const MANIFEST_KEYS = Object.freeze([
  'files',
  'mountPath',
  'schemaVersion',
  'snapshotSha256',
  'sourceDirty',
  'sourceRevision',
]);
const FILE_KEYS = Object.freeze(['bytes', 'path', 'sha256']);

function codedError(message, details = undefined) {
  const error = new Error(message);
  error.code = INVALID_CODE;
  if (details !== undefined) error.details = details;
  return error;
}

function sameKeys(value, keys) {
  return value !== null
    && typeof value === 'object'
    && !Array.isArray(value)
    && JSON.stringify(Object.keys(value).sort()) === JSON.stringify([...keys].sort());
}

function sha256File(path) {
  let descriptor;
  try {
    descriptor = openSync(path, 'r');
    const metadata = fstatSync(descriptor);
    if (!metadata.isFile() || metadata.size > MAX_FILE_BYTES) {
      throw codedError(`admin snapshot member is not a bounded regular file: ${path}`);
    }
    const hash = createHash('sha256');
    const chunk = Buffer.allocUnsafe(
      Math.min(HASH_CHUNK_BYTES, Math.max(metadata.size, 1)),
    );
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
    if (consumed !== metadata.size) {
      throw codedError(`admin snapshot member changed while it was read: ${path}`);
    }
    return { bytes: metadata.size, sha256: hash.digest('hex') };
  } finally {
    if (descriptor !== undefined) closeSync(descriptor);
  }
}

function collectRegularFiles(root, { includeManifest = false } = {}) {
  root = resolve(root);
  const files = [];
  let totalBytes = 0;

  function visit(directory, relativeDirectory) {
    const entries = readdirSync(directory, { withFileTypes: true })
      .sort((left, right) => left.name.localeCompare(right.name));
    for (const entry of entries) {
      const relativePath = relativeDirectory
        ? `${relativeDirectory}/${entry.name}`
        : entry.name;
      if (!includeManifest && relativePath === ADMIN_SNAPSHOT_MANIFEST) continue;
      const absolutePath = join(directory, entry.name);
      const metadata = lstatSync(absolutePath);
      if (metadata.isSymbolicLink()) {
        throw codedError(`admin snapshot may not contain a symbolic link: ${relativePath}`);
      }
      if (metadata.isDirectory()) {
        visit(absolutePath, relativePath);
        continue;
      }
      if (!metadata.isFile()) {
        throw codedError(`admin snapshot contains an unsupported entry: ${relativePath}`);
      }
      const digest = sha256File(absolutePath);
      totalBytes += digest.bytes;
      if (totalBytes > MAX_TOTAL_BYTES || files.length >= MAX_FILES) {
        throw codedError('admin snapshot exceeds its closed file or byte budget');
      }
      files.push({ path: relativePath, ...digest });
    }
  }

  visit(root, '');
  return files;
}

function manifestPayload({ sourceRevision, sourceDirty, files }) {
  return {
    schemaVersion: ADMIN_SNAPSHOT_SCHEMA_VERSION,
    sourceRevision,
    sourceDirty,
    mountPath: ADMIN_SNAPSHOT_MOUNT_PATH,
    files,
  };
}

function snapshotSha256(payload) {
  return createHash('sha256').update(JSON.stringify(payload)).digest('hex');
}

export function writeAdminConsoleSnapshotManifest({
  root,
  sourceRevision,
  sourceDirty,
}) {
  root = resolve(root);
  if (!/^[0-9a-f]{40}$/u.test(sourceRevision ?? '')) {
    throw codedError('admin snapshot source revision must be a full Git SHA');
  }
  if (typeof sourceDirty !== 'boolean') {
    throw codedError('admin snapshot sourceDirty must be boolean');
  }
  const files = collectRegularFiles(root);
  if (!files.some((file) => file.path === 'index.html')) {
    throw codedError('admin snapshot is missing index.html');
  }
  if (!files.some((file) => file.path === '__exact/platform-manifest.json')) {
    throw codedError('admin snapshot is missing __exact/platform-manifest.json');
  }
  const payload = manifestPayload({ sourceRevision, sourceDirty, files });
  const manifest = { ...payload, snapshotSha256: snapshotSha256(payload) };
  const manifestPath = join(root, ADMIN_SNAPSHOT_MANIFEST);
  const temporary = `${manifestPath}.${randomUUID()}.tmp`;
  writeFileSync(temporary, `${JSON.stringify(manifest, null, 2)}\n`);
  renameSync(temporary, manifestPath);
  return { manifest, manifestPath };
}

export function validateAdminConsoleSnapshot({
  root,
  expectedSourceRevision = null,
  requireClean = false,
}) {
  root = resolve(root);
  const manifestPath = join(root, ADMIN_SNAPSHOT_MANIFEST);
  let metadata;
  try {
    metadata = lstatSync(manifestPath);
  } catch (error) {
    throw codedError(`admin snapshot manifest is missing at ${manifestPath}: ${error.message}`);
  }
  if (!metadata.isFile() || metadata.isSymbolicLink()
      || metadata.size > MAX_MANIFEST_BYTES) {
    throw codedError(`admin snapshot manifest is not a bounded regular file: ${manifestPath}`);
  }
  let manifest;
  try {
    manifest = JSON.parse(readFileSync(manifestPath, 'utf8'));
  } catch (error) {
    throw codedError(`admin snapshot manifest is invalid JSON: ${error.message}`);
  }
  if (!sameKeys(manifest, MANIFEST_KEYS)
      || manifest.schemaVersion !== ADMIN_SNAPSHOT_SCHEMA_VERSION
      || !/^[0-9a-f]{40}$/u.test(manifest.sourceRevision ?? '')
      || typeof manifest.sourceDirty !== 'boolean'
      || manifest.mountPath !== ADMIN_SNAPSHOT_MOUNT_PATH
      || !Array.isArray(manifest.files)
      || !/^[0-9a-f]{64}$/u.test(manifest.snapshotSha256 ?? '')) {
    throw codedError('admin snapshot manifest has an invalid closed shape');
  }
  if (expectedSourceRevision !== null
      && manifest.sourceRevision !== expectedSourceRevision) {
    throw codedError(
      `admin snapshot revision ${manifest.sourceRevision} does not match runtime revision ${expectedSourceRevision}`,
    );
  }
  if (requireClean && manifest.sourceDirty !== false) {
    throw codedError('admin snapshot was built from a dirty source tree');
  }
  const recordedPaths = new Set();
  for (const file of manifest.files) {
    if (!sameKeys(file, FILE_KEYS)
        || typeof file.path !== 'string'
        || file.path.length === 0
        || file.path.startsWith('/')
        || file.path.includes('\\')
        || file.path.split('/').some((component) => (
          component.length === 0 || component === '.' || component === '..'
        ))
        || !Number.isSafeInteger(file.bytes)
        || file.bytes < 0
        || file.bytes > MAX_FILE_BYTES
        || !/^[0-9a-f]{64}$/u.test(file.sha256 ?? '')
        || recordedPaths.has(file.path)) {
      throw codedError('admin snapshot manifest contains an invalid file row');
    }
    recordedPaths.add(file.path);
  }
  const sortedFiles = [...manifest.files].sort((left, right) => (
    left.path.localeCompare(right.path)
  ));
  if (JSON.stringify(sortedFiles) !== JSON.stringify(manifest.files)) {
    throw codedError('admin snapshot manifest file rows are not sorted');
  }
  if (!recordedPaths.has('index.html')
      || !recordedPaths.has('__exact/platform-manifest.json')) {
    throw codedError('admin snapshot manifest omits a required console entry');
  }
  const payload = manifestPayload({
    sourceRevision: manifest.sourceRevision,
    sourceDirty: manifest.sourceDirty,
    files: manifest.files,
  });
  if (snapshotSha256(payload) !== manifest.snapshotSha256) {
    throw codedError('admin snapshot manifest digest is incoherent');
  }
  const currentFiles = collectRegularFiles(root);
  if (JSON.stringify(currentFiles) !== JSON.stringify(manifest.files)) {
    throw codedError('admin snapshot files do not match the closed manifest');
  }
  return { root, manifestPath, manifest };
}

export function installAdminConsoleSnapshot({
  sourceRoot,
  destinationRoot,
  expectedSourceRevision,
}) {
  const source = validateAdminConsoleSnapshot({
    root: sourceRoot,
    expectedSourceRevision,
  });
  destinationRoot = resolve(destinationRoot);
  rmSync(destinationRoot, { recursive: true, force: true });
  mkdirSync(dirname(destinationRoot), { recursive: true });
  cpSync(source.root, destinationRoot, {
    recursive: true,
    preserveTimestamps: true,
  });
  return validateAdminConsoleSnapshot({
    root: destinationRoot,
    expectedSourceRevision,
  });
}

export function adminConsoleArtifactCandidates(packageRoot) {
  const root = join(resolve(packageRoot), 'admin');
  if (!existsSync(root)) return [];
  return collectRegularFiles(root, { includeManifest: true })
    .map((file) => join(root, ...file.path.split('/')));
}

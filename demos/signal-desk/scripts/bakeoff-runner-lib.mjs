// @ref LLP 0010#ci-and-review-gates — the final comparison is a closed,
// non-vacuous inventory at one clean source revision, not a prose summary of
// commands run at different revisions.
// @ref LLP 0015#acceptance-rules — all three backend arms are required here;
// unavailable prerequisites and skips are red evidence, never optional green.
// @ref LLP 0114#exact-executable-gate — React evidence stays a separate,
// package-bound acceptance receipt and is reopened by this aggregate.

import { createHash } from 'node:crypto';
import { execFileSync, spawn } from 'node:child_process';
import {
  existsSync,
  lstatSync,
  mkdirSync,
  readFileSync,
  renameSync,
  statSync,
  writeFileSync,
} from 'node:fs';
import { homedir, tmpdir } from 'node:os';
import {
  dirname,
  join,
  relative,
  resolve,
  sep,
} from 'node:path';
import { fileURLToPath } from 'node:url';

import Ajv2020 from 'ajv/dist/2020.js';

export const RECEIPT_SCHEMA_VERSION = 'snapback.backend-bakeoff-run.v2';
export const MAX_LOG_BYTES = 1024 * 1024;
export const DEMO_CWD = 'demos/signal-desk';

export const REQUIRED_COMMANDS = Object.freeze([
  Object.freeze({
    id: 'contract',
    argv: Object.freeze(['bun', 'run', 'test:contract']),
    timeoutMs: 60_000,
  }),
  Object.freeze({
    id: 'snapback-comparator',
    argv: Object.freeze(['bun', 'run', 'test:snapback:comparator']),
    timeoutMs: 90_000,
  }),
  Object.freeze({
    id: 'snapback-extras',
    argv: Object.freeze(['bun', 'run', 'test:snapback:extras']),
    timeoutMs: 90_000,
  }),
  Object.freeze({
    id: 'react',
    argv: Object.freeze(['bun', 'run', 'test:react']),
    timeoutMs: 180_000,
  }),
  Object.freeze({
    id: 'convex',
    argv: Object.freeze(['bun', 'run', 'test:convex']),
    timeoutMs: 90_000,
  }),
  Object.freeze({
    id: 'supabase',
    argv: Object.freeze(['bun', 'run', 'test:supabase']),
    timeoutMs: 90_000,
  }),
  Object.freeze({
    id: 'typecheck',
    argv: Object.freeze(['bun', 'run', 'typecheck']),
    timeoutMs: 180_000,
  }),
  Object.freeze({
    id: 'build',
    argv: Object.freeze(['bun', 'run', 'build']),
    timeoutMs: 180_000,
  }),
]);

export const EVIDENCE_PATHS = Object.freeze({
  comparator: `${DEMO_CWD}/.snapback/comparator-receipt.json`,
  reactPresence: `${DEMO_CWD}/acceptance/results/react-presence.v1.json`,
  reactQueryGroup: `${DEMO_CWD}/acceptance/results/react-query-group.v1.json`,
});

const ALLOWED_RUN_MUTATIONS = Object.freeze([
  EVIDENCE_PATHS.comparator,
  EVIDENCE_PATHS.reactPresence,
  EVIDENCE_PATHS.reactQueryGroup,
  `${DEMO_CWD}/acceptance/logs/`,
  `${DEMO_CWD}/acceptance/evidence/`,
]);

const here = dirname(fileURLToPath(import.meta.url));
export const defaultDemoRoot = resolve(here, '..');
export const defaultRepoRoot = resolve(defaultDemoRoot, '..', '..');
export const defaultSchemaPath = join(
  defaultDemoRoot,
  'acceptance',
  'backend-bakeoff-run.schema.json',
);

function canonicalValue(value) {
  if (value === null || typeof value === 'string' || typeof value === 'boolean') return value;
  if (typeof value === 'number') {
    if (!Number.isFinite(value)) throw new Error('receipt contains a non-finite number');
    return value;
  }
  if (Array.isArray(value)) return value.map(canonicalValue);
  if (value && typeof value === 'object') {
    return Object.fromEntries(
      Object.keys(value).sort().map((key) => [key, canonicalValue(value[key])]),
    );
  }
  throw new Error(`receipt contains unsupported ${typeof value}`);
}

export function canonicalJson(value) {
  return JSON.stringify(canonicalValue(value));
}

export function sha256(value) {
  return `sha256:${createHash('sha256').update(value).digest('hex')}`;
}

function escapeRegExp(value) {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

function redactAssignmentValues(path, values) {
  if (!existsSync(path) || !statSync(path).isFile()) return;
  const text = readFileSync(path, 'utf8');
  for (const match of text.matchAll(/^(?:export\s+)?[A-Za-z_][A-Za-z0-9_]*\s*=\s*(.+)$/gm)) {
    const value = match[1].trim().replace(/^(['"])(.*)\1$/, '$2');
    if (value.length >= 8 && value !== '...') values.add(value);
  }
}

export function secretRedactions(repoRoot, env = process.env) {
  const values = new Set();
  for (const [name, value] of Object.entries(env)) {
    if (
      /(?:TOKEN|SECRET|PASSWORD|PASSWD|API_KEY|PRIVATE_KEY|CREDENTIAL|AUTHORIZATION)/i.test(name)
      && typeof value === 'string'
      && value.length >= 8
    ) {
      values.add(value);
    }
  }
  redactAssignmentValues(join(repoRoot, '.agent-local-secrets.md'), values);
  redactAssignmentValues(join(repoRoot, DEMO_CWD, '.env.local'), values);
  return [...values].sort((left, right) => right.length - left.length);
}

export function sanitizeLog(raw, {
  repoRoot,
  secrets = [],
  home = homedir(),
  temporary = tmpdir(),
} = {}) {
  let text = Buffer.isBuffer(raw) ? raw.toString('utf8') : String(raw);
  for (const value of secrets) {
    if (value.length >= 8) text = text.replaceAll(value, '<redacted>');
  }
  const replacements = [
    [repoRoot, '<workspace>'],
    [temporary, '<temp>'],
    ['/private/tmp', '<temp>'],
    ['/var/folders', '<temp>'],
    ['/tmp', '<temp>'],
    [home, '<home>'],
  ]
    .filter(([value]) => typeof value === 'string' && value.length > 1)
    .sort(([left], [right]) => right.length - left.length);
  for (const [value, replacement] of replacements) {
    text = text.replace(new RegExp(escapeRegExp(value), 'g'), replacement);
  }
  text = text
    .replace(/\bBearer\s+[A-Za-z0-9._~+/=-]+/gi, 'Bearer <redacted>')
    .replace(/\bnpm_[A-Za-z0-9_-]{16,}\b/g, '<redacted>')
    .replace(/\beyJ[A-Za-z0-9_-]{8,}\.[A-Za-z0-9_-]{8,}\.[A-Za-z0-9_-]{8,}\b/g, '<redacted>')
    .replace(/(https?:\/\/)[^/\s:@]+:[^/\s@]+@/gi, '$1<redacted>@')
    .replace(/(postgres(?:ql)?:\/\/)[^/\s:@]+:[^/\s@]+@/gi, '$1<redacted>@');
  return text;
}

function boundedSanitizedLog(raw, options) {
  const sanitized = Buffer.from(sanitizeLog(raw, options));
  if (sanitized.byteLength <= MAX_LOG_BYTES) {
    return { bytes: sanitized, truncatedAfterSanitization: false };
  }
  const marker = Buffer.from('\n<output truncated by backend-bakeoff runner>\n');
  return {
    bytes: Buffer.concat([
      sanitized.subarray(0, MAX_LOG_BYTES - marker.byteLength),
      marker,
    ]),
    truncatedAfterSanitization: true,
  };
}

function wait(ms) {
  return new Promise((resolveWait) => setTimeout(resolveWait, ms));
}

async function terminateTree(child) {
  if (child.exitCode !== null) return;
  if (process.platform === 'win32') {
    const killer = spawn('taskkill', ['/pid', String(child.pid), '/T', '/F'], {
      stdio: 'ignore',
      windowsHide: true,
    });
    await Promise.race([
      new Promise((resolveClose) => killer.once('close', resolveClose)),
      wait(5_000),
    ]);
    return;
  }
  try {
    process.kill(-child.pid, 'SIGTERM');
  } catch (error) {
    if (error.code !== 'ESRCH') throw error;
    return;
  }
  await Promise.race([
    new Promise((resolveClose) => child.once('close', resolveClose)),
    wait(1_000),
  ]);
  if (child.exitCode !== null) return;
  try {
    process.kill(-child.pid, 'SIGKILL');
  } catch (error) {
    if (error.code !== 'ESRCH') throw error;
  }
}

function collectBounded(stream) {
  const chunks = [];
  let keptBytes = 0;
  let sourceBytes = 0;
  stream.on('data', (chunk) => {
    sourceBytes += chunk.byteLength;
    if (keptBytes >= MAX_LOG_BYTES) return;
    const keep = chunk.subarray(0, MAX_LOG_BYTES - keptBytes);
    chunks.push(keep);
    keptBytes += keep.byteLength;
  });
  return {
    bytes: () => Buffer.concat(chunks),
    sourceBytes: () => sourceBytes,
    truncated: () => sourceBytes > keptBytes,
  };
}

export async function runBoundedProcess(argv, {
  cwd,
  env = process.env,
  timeoutMs,
} = {}) {
  if (!Array.isArray(argv) || argv.length === 0 || argv.some((part) => typeof part !== 'string')) {
    throw new Error('argv must be a non-empty string array');
  }
  const child = spawn(argv[0], argv.slice(1), {
    cwd,
    env,
    detached: process.platform !== 'win32',
    shell: false,
    stdio: ['ignore', 'pipe', 'pipe'],
    windowsHide: true,
  });
  const stdout = collectBounded(child.stdout);
  const stderr = collectBounded(child.stderr);
  let timedOut = false;
  let spawnError = null;
  const timer = setTimeout(() => {
    timedOut = true;
    void terminateTree(child);
  }, timeoutMs);
  const result = await new Promise((resolveClose) => {
    child.once('error', (error) => {
      spawnError = error;
    });
    child.once('close', (exitCode, signal) => resolveClose({ exitCode, signal }));
  });
  clearTimeout(timer);
  return {
    ...result,
    timedOut,
    spawnError,
    stdout: stdout.bytes(),
    stderr: stderr.bytes(),
    stdoutSourceBytes: stdout.sourceBytes(),
    stderrSourceBytes: stderr.sourceBytes(),
    stdoutTruncated: stdout.truncated(),
    stderrTruncated: stderr.truncated(),
  };
}

function atomicWrite(path, bytes) {
  mkdirSync(dirname(path), { recursive: true });
  const temporary = `${path}.tmp-${process.pid}`;
  writeFileSync(temporary, bytes, { mode: 0o644 });
  renameSync(temporary, path);
}

function writeLog(repoRoot, raw, sourceBytes, sourceTruncated, sanitization) {
  const sanitized = boundedSanitizedLog(raw, sanitization);
  const digest = sha256(sanitized.bytes);
  const relativePath = `${DEMO_CWD}/acceptance/logs/${digest.slice('sha256:'.length)}.log`;
  const absolutePath = join(repoRoot, relativePath);
  if (existsSync(absolutePath)) {
    const existing = readFileSync(absolutePath);
    if (!existing.equals(sanitized.bytes)) throw new Error(`log digest collision: ${relativePath}`);
  } else {
    atomicWrite(absolutePath, sanitized.bytes);
  }
  return {
    path: relativePath,
    sha256: digest,
    sourceBytes,
    storedBytes: sanitized.bytes.byteLength,
    truncated: sourceTruncated || sanitized.truncatedAfterSanitization,
  };
}

export async function executeRequiredCommand(command, {
  repoRoot = defaultRepoRoot,
  demoRoot = defaultDemoRoot,
  env = process.env,
  now = () => Date.now(),
  processRunner = runBoundedProcess,
  secrets = secretRedactions(repoRoot, env),
} = {}) {
  const startedAtMs = now();
  const result = await processRunner(command.argv, {
    cwd: demoRoot,
    env,
    timeoutMs: command.timeoutMs,
  });
  const finishedAtMs = now();
  const sanitization = { repoRoot, secrets };
  if (result.spawnError) {
    result.stderr = Buffer.concat([
      result.stderr,
      Buffer.from(`\nrunner spawn error: ${result.spawnError.message}\n`),
    ]);
    result.stderrSourceBytes += Buffer.byteLength(result.spawnError.message);
  }
  return {
    id: command.id,
    required: true,
    argv: [...command.argv],
    cwd: DEMO_CWD,
    timeoutMs: command.timeoutMs,
    startedAt: new Date(startedAtMs).toISOString(),
    finishedAt: new Date(finishedAtMs).toISOString(),
    durationMs: finishedAtMs - startedAtMs,
    exitCode: result.exitCode,
    signal: result.signal,
    status: result.timedOut
      ? 'timed-out'
      : result.exitCode === 0 && !result.spawnError
        ? 'passed'
        : 'failed',
    stdout: writeLog(
      repoRoot,
      result.stdout,
      result.stdoutSourceBytes,
      result.stdoutTruncated,
      sanitization,
    ),
    stderr: writeLog(
      repoRoot,
      result.stderr,
      result.stderrSourceBytes,
      result.stderrTruncated,
      sanitization,
    ),
  };
}

async function git(repoRoot, args) {
  const result = await runBoundedProcess(['git', ...args], {
    cwd: repoRoot,
    timeoutMs: 30_000,
  });
  if (result.exitCode !== 0 || result.timedOut) {
    throw new Error(
      `git ${args.join(' ')} failed: ${result.stderr.toString('utf8').trim()}`,
    );
  }
  return result.stdout;
}

function parsePorcelain(bytes) {
  const paths = [];
  const fields = bytes.toString('utf8').split('\0').filter(Boolean);
  for (let index = 0; index < fields.length; index += 1) {
    const line = fields[index];
    const status = line.slice(0, 2);
    const path = line.slice(3);
    paths.push(path.replaceAll('\\', '/'));
    if (status.includes('R') || status.includes('C')) index += 1;
  }
  return [...new Set(paths)].sort();
}

function allowedMutation(path) {
  return ALLOWED_RUN_MUTATIONS.some((allowed) => (
    allowed.endsWith('/') ? path.startsWith(allowed) : path === allowed
  ));
}

export async function sourcePreflight(repoRoot = defaultRepoRoot) {
  const [status, revision, tree, index] = await Promise.all([
    git(repoRoot, ['status', '--porcelain=v1', '-z', '--untracked-files=all']),
    git(repoRoot, ['rev-parse', 'HEAD']),
    git(repoRoot, ['rev-parse', 'HEAD^{tree}']),
    git(repoRoot, ['ls-files', '--stage', '-z']),
  ]);
  const dirtyPaths = parsePorcelain(status);
  if (dirtyPaths.length > 0) {
    throw new Error(
      `SNAPBACK_BAKEOFF_SOURCE_DIRTY: source must be clean before the run (${dirtyPaths.join(', ')})`,
    );
  }
  const entries = index.toString('utf8').split('\0').filter(Boolean).sort();
  return {
    revision: revision.toString('utf8').trim(),
    tree: tree.toString('utf8').trim(),
    cleanAtStart: true,
    trackedInputs: {
      algorithm: 'sha256-git-index-path-mode-object.v1',
      fileCount: entries.length,
      sha256: sha256(entries.join('\0')),
    },
  };
}

export async function sourcePostflight(repoRoot = defaultRepoRoot) {
  const paths = parsePorcelain(
    await git(repoRoot, ['status', '--porcelain=v1', '-z', '--untracked-files=all']),
  );
  const unexpectedPaths = paths.filter((path) => !allowedMutation(path));
  return {
    unchangedAfterCommands: unexpectedPaths.length === 0,
    unexpectedPaths,
  };
}

function parseJsonFile(repoRoot, relativePath) {
  const absolutePath = join(repoRoot, relativePath);
  if (!existsSync(absolutePath) || !statSync(absolutePath).isFile()) {
    throw new Error('receipt file is missing');
  }
  const bytes = readFileSync(absolutePath);
  return {
    bytes,
    parsed: JSON.parse(bytes.toString('utf8')),
    digest: sha256(bytes),
  };
}

function evidenceFailure(repoRoot, relativePath, error, available = true) {
  return {
    required: true,
    available,
    valid: false,
    sourcePath: available ? relativePath : null,
    sourceSha256: null,
    path: null,
    sha256: null,
    schemaVersion: null,
    verdict: available ? 'invalid' : 'missing',
    passed: null,
    total: null,
    diagnostic: sanitizeLog(String(error?.message ?? error), {
      repoRoot,
      secrets: secretRedactions(repoRoot),
    }).slice(0, 500),
  };
}

function sanitizedValue(value, sanitization) {
  if (typeof value === 'string') return sanitizeLog(value, sanitization);
  if (Array.isArray(value)) return value.map((child) => sanitizedValue(child, sanitization));
  if (value && typeof value === 'object') {
    return Object.fromEntries(
      Object.entries(value).map(([key, child]) => [key, sanitizedValue(child, sanitization)]),
    );
  }
  return value;
}

function retainChildEvidence(repoRoot, relativePath, file, parsed) {
  const projection = {
    schemaVersion: 'snapback.backend-bakeoff-child-evidence.v1',
    sourcePath: relativePath,
    sourceSchemaVersion: parsed.schemaVersion,
    sourceSha256: file.digest,
    receipt: sanitizedValue(parsed, {
      repoRoot,
      secrets: secretRedactions(repoRoot),
    }),
  };
  const bytes = Buffer.from(safeReceiptText(
    projection,
    repoRoot,
    secretRedactions(repoRoot),
  ));
  const digest = sha256(bytes);
  const retainedPath = `${DEMO_CWD}/acceptance/evidence/${digest.slice('sha256:'.length)}.json`;
  const absolutePath = join(repoRoot, retainedPath);
  if (existsSync(absolutePath)) {
    if (!readFileSync(absolutePath).equals(bytes)) {
      throw new Error(`child evidence digest collision: ${retainedPath}`);
    }
  } else {
    atomicWrite(absolutePath, bytes);
  }
  return { path: retainedPath, sha256: digest };
}

function evidenceSuccess(repoRoot, relativePath, file, parsed, passed, total) {
  const retained = retainChildEvidence(repoRoot, relativePath, file, parsed);
  return {
    required: true,
    available: true,
    valid: true,
    sourcePath: relativePath,
    sourceSha256: file.digest,
    path: retained.path,
    sha256: retained.sha256,
    schemaVersion: parsed.schemaVersion,
    verdict: 'passed',
    passed,
    total,
    diagnostic: null,
  };
}

function assertAcceptanceReport(receipt, schemaVersion, expectedChecks) {
  if (
    receipt?.schemaVersion !== schemaVersion
    || receipt.ok !== true
    || receipt.skipped !== 0
    || receipt.failed !== 0
    || receipt.total !== expectedChecks
    || receipt.expectedChecks !== expectedChecks
    || receipt.passed !== expectedChecks
    || receipt.cleanupErrorCount !== 0
    || !Array.isArray(receipt.results)
    || receipt.results.length !== expectedChecks
    || receipt.results.some((result) => result?.ok !== true)
  ) {
    throw new Error(`${schemaVersion} is failed, skipped, short, or malformed`);
  }
}

function normalizeReactPackageIdentity(repoRoot, key, receiptIdentity) {
  const packageDirectory = {
    client: 'snapback-client',
    react: 'snapback-react',
    contract: 'snapback-contract',
    codegen: 'snapback-codegen',
  }[key];
  const packageRoot = join(repoRoot, 'packages', packageDirectory);
  const manifest = JSON.parse(readFileSync(join(packageRoot, 'package.json'), 'utf8'));
  const packagePath = relative(repoRoot, packageRoot).replaceAll(sep, '/');
  const actualFiles = execFileSync(
    'git',
    ['ls-files', '-z', '--', packagePath],
    { cwd: repoRoot },
  )
    .toString('utf8')
    .split('\0')
    .filter(Boolean)
    .map((path) => relative(packageRoot, join(repoRoot, path)).replaceAll(sep, '/'))
    .sort();
  if (canonicalJson(actualFiles) !== canonicalJson([...receiptIdentity.files].sort())) {
    throw new Error(`React package evidence file inventory drifted for ${manifest.name}`);
  }
  const hash = createHash('sha256');
  for (const path of actualFiles) {
    if (
      path.startsWith('/')
      || /^[A-Za-z]:/.test(path)
      || path.split('/').includes('..')
      || path.includes('\\')
    ) {
      throw new Error(`unsafe React package evidence path: ${path}`);
    }
    const absolutePath = join(packageRoot, path);
    const metadata = lstatSync(absolutePath);
    if (!metadata.isFile() || metadata.isSymbolicLink()) {
      throw new Error(`React package evidence is not a regular file: ${path}`);
    }
    const bytes = readFileSync(absolutePath);
    hash.update(`${path}\0${bytes.byteLength}\0`);
    hash.update(bytes);
  }
  const digest = `sha256:${hash.digest('hex')}`;
  if (
    receiptIdentity.algorithm !== 'sha256-git-tracked-package-tree.v1'
    || receiptIdentity.digest !== digest
  ) {
    throw new Error(`React package evidence drifted for ${manifest.name}`);
  }
  return {
    name: manifest.name,
    version: manifest.version,
    algorithm: receiptIdentity.algorithm,
    files: actualFiles,
    sha256: digest,
  };
}

function emptyIdentities() {
  return {
    target: { available: false, profileId: null },
    artifact: {
      available: false,
      appId: null,
      schemaHash: null,
      bundleHash: null,
      inputsHash: null,
    },
    runtime: {
      available: false,
      sha256: null,
      crateVersion: null,
      gitCommit: null,
      gitDirty: null,
      buildProfile: null,
    },
    packages: {
      comparator: { cli: null, client: null },
      react: { client: null, react: null, contract: null, codegen: null },
    },
    generatedQueryGroup: {
      available: false,
      id: null,
      definitionHash: null,
      adapterSourceSha256: null,
      compiledBundleSha256: null,
    },
  };
}

export async function collectEvidence(repoRoot = defaultRepoRoot, sourceRevision = null) {
  const evidence = {};
  const identities = emptyIdentities();

  try {
    const { readComparatorReceipt } = await import('@expo/snapback-cli/comparator');
    const file = parseJsonFile(repoRoot, EVIDENCE_PATHS.comparator);
    const receipt = readComparatorReceipt(join(repoRoot, EVIDENCE_PATHS.comparator));
    if (receipt.status !== 'passed') throw new Error(`comparator status is ${receipt.status}`);
    evidence.comparator = evidenceSuccess(
      repoRoot,
      EVIDENCE_PATHS.comparator,
      file,
      receipt,
      receipt.checks.length,
      receipt.expectedChecks.length,
    );
    identities.target = {
      available: receipt.identity.target.available,
      profileId: receipt.identity.target.profileId,
    };
    identities.artifact = {
      available: receipt.identity.artifact.available,
      appId: receipt.identity.artifact.appId,
      schemaHash: receipt.identity.artifact.schemaHash,
      bundleHash: receipt.identity.artifact.bundleHash,
      inputsHash: receipt.identity.artifact.inputsHash,
    };
    identities.runtime = {
      available: receipt.identity.binary.available,
      sha256: receipt.identity.binary.sha256,
      crateVersion: receipt.identity.binary.crateVersion,
      gitCommit: receipt.identity.binary.gitCommit,
      gitDirty: receipt.identity.binary.gitDirty,
      buildProfile: receipt.identity.binary.buildProfile,
    };
    if (
      sourceRevision !== null
      && (
        receipt.identity.binary.gitCommit !== sourceRevision
        || receipt.identity.binary.gitDirty !== false
      )
    ) {
      throw new Error('comparator runtime is not the clean current source revision');
    }
    identities.packages.comparator = structuredClone(receipt.executorPackages);
  } catch (error) {
    const available = existsSync(join(repoRoot, EVIDENCE_PATHS.comparator));
    evidence.comparator = evidenceFailure(
      repoRoot,
      EVIDENCE_PATHS.comparator,
      error,
      available,
    );
  }

  try {
    const file = parseJsonFile(repoRoot, EVIDENCE_PATHS.reactPresence);
    const receipt = file.parsed;
    assertAcceptanceReport(receipt, 'snapback.react-presence-receipt.v1', 10);
    if (sourceRevision !== null && receipt.sourceRevision !== sourceRevision) {
      throw new Error('React presence receipt does not bind the current source revision');
    }
    evidence.reactPresence = evidenceSuccess(
      repoRoot,
      EVIDENCE_PATHS.reactPresence,
      file,
      receipt,
      receipt.passed,
      receipt.total,
    );
    identities.packages.react = Object.fromEntries(
      Object.entries(receipt.packages).map(([key, identity]) => [
        key,
        normalizeReactPackageIdentity(repoRoot, key, identity),
      ]),
    );
  } catch (error) {
    const available = existsSync(join(repoRoot, EVIDENCE_PATHS.reactPresence));
    evidence.reactPresence = evidenceFailure(
      repoRoot,
      EVIDENCE_PATHS.reactPresence,
      error,
      available,
    );
  }

  try {
    const file = parseJsonFile(repoRoot, EVIDENCE_PATHS.reactQueryGroup);
    const receipt = file.parsed;
    assertAcceptanceReport(
      receipt,
      'snapback.real-adapter-query-group-receipt.v1',
      3,
    );
    for (const owned of [
      receipt.generated.artifactManifest,
      receipt.generated.routeSource,
      receipt.generated.runtime,
      receipt.generated.declarations,
      receipt.adapter.source,
    ]) {
      const path = `${DEMO_CWD}/${owned.path}`;
      const actual = sha256(readFileSync(join(repoRoot, path)));
      if (actual !== owned.sha256) throw new Error(`query-group source drifted: ${owned.path}`);
    }
    evidence.reactQueryGroup = evidenceSuccess(
      repoRoot,
      EVIDENCE_PATHS.reactQueryGroup,
      file,
      receipt,
      receipt.passed,
      receipt.total,
    );
    identities.generatedQueryGroup = {
      available: true,
      id: receipt.generated.group.id,
      definitionHash: receipt.generated.group.definitionHash,
      adapterSourceSha256: receipt.adapter.source.sha256,
      compiledBundleSha256: receipt.adapter.compiledBundleSha256,
    };
  } catch (error) {
    const available = existsSync(join(repoRoot, EVIDENCE_PATHS.reactQueryGroup));
    evidence.reactQueryGroup = evidenceFailure(
      repoRoot,
      EVIDENCE_PATHS.reactQueryGroup,
      error,
      available,
    );
  }

  return { evidence, identities };
}

function schemaValidator(schemaPath = defaultSchemaPath) {
  const schema = JSON.parse(readFileSync(schemaPath, 'utf8'));
  const validate = new Ajv2020({
    allErrors: true,
    strict: true,
  }).compile(schema);
  return { schema, validate };
}

export function validateReceiptEnvelope(envelope, {
  schemaPath = defaultSchemaPath,
} = {}) {
  const { validate } = schemaValidator(schemaPath);
  if (!validate(envelope)) {
    throw new Error(`SNAPBACK_BAKEOFF_RECEIPT_SCHEMA_INVALID: ${JSON.stringify(validate.errors)}`);
  }
  const expected = sha256(canonicalJson(envelope.content));
  if (envelope.contentSha256 !== expected) {
    throw new Error('SNAPBACK_BAKEOFF_RECEIPT_CONTENT_DIGEST_MISMATCH');
  }
  const { content } = envelope;
  if (
    Date.parse(content.finishedAt) < Date.parse(content.startedAt)
    || content.durationMs !== Date.parse(content.finishedAt) - Date.parse(content.startedAt)
  ) {
    throw new Error('SNAPBACK_BAKEOFF_RECEIPT_TIME_INVALID');
  }
  for (let index = 0; index < REQUIRED_COMMANDS.length; index += 1) {
    const expectedCommand = REQUIRED_COMMANDS[index];
    const actual = content.commands[index];
    if (
      actual.id !== expectedCommand.id
      || canonicalJson(actual.argv) !== canonicalJson(expectedCommand.argv)
      || actual.timeoutMs !== expectedCommand.timeoutMs
      || actual.durationMs !== Date.parse(actual.finishedAt) - Date.parse(actual.startedAt)
      || (actual.status === 'passed' && actual.exitCode !== 0)
      || (actual.status === 'failed' && actual.exitCode === 0)
    ) {
      throw new Error(`SNAPBACK_BAKEOFF_RECEIPT_COMMAND_INVALID: ${expectedCommand.id}`);
    }
  }
  if (
    content.source.unchangedAfterCommands
      !== (content.source.unexpectedPaths.length === 0)
    || canonicalJson(content.summary)
      !== canonicalJson(summarize(content.commands, content.evidence, content.source))
  ) {
    throw new Error('SNAPBACK_BAKEOFF_RECEIPT_SUMMARY_INVALID');
  }
  for (const [name, item] of Object.entries(content.evidence)) {
    const passing = (
      item.available === true
      && item.valid === true
      && item.verdict === 'passed'
      && item.sourcePath !== null
      && item.sourceSha256 !== null
      && item.path !== null
      && item.sha256 !== null
      && item.diagnostic === null
      && Number.isSafeInteger(item.passed)
      && item.passed > 0
      && item.passed === item.total
    );
    if (item.valid !== passing) {
      throw new Error(`SNAPBACK_BAKEOFF_RECEIPT_EVIDENCE_INVALID: ${name}`);
    }
  }
  return envelope;
}

function safeReceiptText(envelope, repoRoot, secrets) {
  const text = `${canonicalJson(envelope)}\n`;
  const forbidden = [
    repoRoot,
    tmpdir(),
    '/private/tmp/',
    '/var/folders/',
    `${homedir()}/`,
    ...secrets,
  ].filter((value) => typeof value === 'string' && value.length >= 8);
  for (const value of forbidden) {
    if (text.includes(value)) {
      throw new Error('SNAPBACK_BAKEOFF_RECEIPT_UNSANITIZED');
    }
  }
  return text;
}

async function commandEnvironment(repoRoot, env) {
  const result = await runBoundedProcess(['bun', '--version'], {
    cwd: repoRoot,
    env,
    timeoutMs: 30_000,
  });
  if (result.exitCode !== 0 || result.timedOut) throw new Error('bun --version failed');
  return {
    node: process.version,
    bun: result.stdout.toString('utf8').trim(),
    platform: process.platform,
    architecture: process.arch,
  };
}

function runnerIdentity(repoRoot, schemaPath) {
  const libraryRelative = `${DEMO_CWD}/scripts/bakeoff-runner-lib.mjs`;
  const commandBytes = canonicalJson(REQUIRED_COMMANDS);
  return {
    package: 'snapback-backend-bakeoff',
    path: libraryRelative,
    sha256: sha256(readFileSync(join(repoRoot, libraryRelative))),
    commandSetSha256: sha256(commandBytes),
    schemaPath: relative(repoRoot, schemaPath).replaceAll(sep, '/'),
    schemaSha256: sha256(readFileSync(schemaPath)),
  };
}

export function summarize(commands, evidence, source) {
  const passed = commands.filter((command) => command.status === 'passed').length;
  const timedOut = commands.filter((command) => command.status === 'timed-out').length;
  const failed = commands.length - passed;
  const evidenceValid = Object.values(evidence).every((item) => (
    item.required === true && item.available === true && item.valid === true
      && item.verdict === 'passed'
      && item.sourcePath !== null
      && item.sourceSha256 !== null
      && item.path !== null
      && item.sha256 !== null
      && item.diagnostic === null
      && Number.isSafeInteger(item.passed)
      && item.passed > 0
      && item.passed === item.total
  ));
  const status = (
    commands.length === REQUIRED_COMMANDS.length
    && passed === REQUIRED_COMMANDS.length
    && evidenceValid
    && source.unchangedAfterCommands
  ) ? 'passed' : 'failed';
  return {
    status,
    required: REQUIRED_COMMANDS.length,
    passed,
    failed,
    timedOut,
    evidenceValid,
  };
}

export async function runBakeoff({
  repoRoot = defaultRepoRoot,
  demoRoot = join(repoRoot, DEMO_CWD),
  schemaPath = join(demoRoot, 'acceptance', 'backend-bakeoff-run.schema.json'),
  env = process.env,
  now = () => Date.now(),
  executeCommand = executeRequiredCommand,
  evidenceCollector = collectEvidence,
  environmentCollector = commandEnvironment,
} = {}) {
  const source = await sourcePreflight(repoRoot);
  const secrets = secretRedactions(repoRoot, env);
  const startedAtMs = now();
  const commands = [];
  for (const command of REQUIRED_COMMANDS) {
    commands.push(await executeCommand(command, {
      repoRoot,
      demoRoot,
      env,
      now,
      secrets,
    }));
  }
  const { evidence, identities } = await evidenceCollector(repoRoot, source.revision);
  const postflight = await sourcePostflight(repoRoot);
  Object.assign(source, postflight);
  const finishedAtMs = now();
  const content = {
    runKind: 'required-three-backend-local-matrix',
    source,
    runner: runnerIdentity(repoRoot, schemaPath),
    environment: await environmentCollector(repoRoot, env),
    startedAt: new Date(startedAtMs).toISOString(),
    finishedAt: new Date(finishedAtMs).toISOString(),
    durationMs: finishedAtMs - startedAtMs,
    commands,
    evidence,
    identities,
    summary: summarize(commands, evidence, source),
    nonclaims: [
      'This is functional acceptance, not a throughput, latency, scale, cost, or visual-quality benchmark.',
      'This local matrix does not claim hosted-target parity or public-package qualification.',
      'This local matrix does not include the staged clean-install browser evidence required for public-package qualification.',
      'Configured Convex and Supabase services are prerequisites; this receipt does not attest their provisioning history.',
    ],
  };
  const envelope = {
    schemaVersion: RECEIPT_SCHEMA_VERSION,
    contentSha256: sha256(canonicalJson(content)),
    content,
  };
  validateReceiptEnvelope(envelope, { schemaPath });
  const relativePath = `${DEMO_CWD}/acceptance/results/backend-bakeoff-run.${envelope.contentSha256.slice('sha256:'.length)}.v2.json`;
  const absolutePath = join(repoRoot, relativePath);
  const text = safeReceiptText(envelope, repoRoot, secrets);
  if (existsSync(absolutePath) && readFileSync(absolutePath, 'utf8') !== text) {
    throw new Error(`receipt content-address collision: ${relativePath}`);
  }
  atomicWrite(absolutePath, text);
  return { envelope, path: relativePath };
}

function assertUnder(path, parent) {
  const resolvedPath = resolve(path);
  const resolvedParent = resolve(parent);
  if (
    resolvedPath !== resolvedParent
    && !resolvedPath.startsWith(`${resolvedParent}${sep}`)
  ) {
    throw new Error('SNAPBACK_BAKEOFF_RECEIPT_PATH_OUTSIDE_ACCEPTANCE');
  }
}

export function verifyReceipt(path, {
  repoRoot = defaultRepoRoot,
  schemaPath = join(repoRoot, DEMO_CWD, 'acceptance', 'backend-bakeoff-run.schema.json'),
} = {}) {
  const absolutePath = resolve(path);
  assertUnder(absolutePath, join(repoRoot, DEMO_CWD, 'acceptance', 'results'));
  const envelope = validateReceiptEnvelope(
    JSON.parse(readFileSync(absolutePath, 'utf8')),
    { schemaPath },
  );
  safeReceiptText(envelope, repoRoot, secretRedactions(repoRoot));
  const expectedName = `backend-bakeoff-run.${envelope.contentSha256.slice('sha256:'.length)}.v2.json`;
  if (absolutePath.split(sep).at(-1) !== expectedName) {
    throw new Error('SNAPBACK_BAKEOFF_RECEIPT_FILENAME_MISMATCH');
  }
  for (const command of envelope.content.commands) {
    for (const stream of ['stdout', 'stderr']) {
      const log = command[stream];
      const logPath = join(repoRoot, log.path);
      assertUnder(logPath, join(repoRoot, DEMO_CWD, 'acceptance', 'logs'));
      const bytes = readFileSync(logPath);
      if (bytes.byteLength !== log.storedBytes || sha256(bytes) !== log.sha256) {
        throw new Error(`SNAPBACK_BAKEOFF_LOG_DIGEST_MISMATCH: ${log.path}`);
      }
    }
  }
  for (const item of Object.values(envelope.content.evidence)) {
    if (!item.available || item.path === null) continue;
    const evidencePath = join(repoRoot, item.path);
    assertUnder(evidencePath, join(repoRoot, DEMO_CWD, 'acceptance', 'evidence'));
    const bytes = readFileSync(evidencePath);
    if (sha256(bytes) !== item.sha256) {
      throw new Error(`SNAPBACK_BAKEOFF_EVIDENCE_DIGEST_MISMATCH: ${item.path}`);
    }
    const projection = JSON.parse(bytes.toString('utf8'));
    safeReceiptText(projection, repoRoot, secretRedactions(repoRoot));
    if (
      canonicalJson(Object.keys(projection).sort())
        !== canonicalJson([
          'receipt',
          'schemaVersion',
          'sourcePath',
          'sourceSchemaVersion',
          'sourceSha256',
        ].sort())
      || projection.schemaVersion !== 'snapback.backend-bakeoff-child-evidence.v1'
      || projection.sourcePath !== item.sourcePath
      || projection.sourceSchemaVersion !== item.schemaVersion
      || projection.sourceSha256 !== item.sourceSha256
      || projection.receipt?.schemaVersion !== item.schemaVersion
    ) {
      throw new Error(`SNAPBACK_BAKEOFF_EVIDENCE_PROJECTION_INVALID: ${item.path}`);
    }
  }
  return envelope;
}

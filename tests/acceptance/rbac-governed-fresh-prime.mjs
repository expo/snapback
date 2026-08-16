import assert from 'node:assert/strict';
import { execFile, spawn } from 'node:child_process';
import { cp, lstat, mkdtemp, readdir, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { promisify } from 'node:util';

const execFileAsync = promisify(execFile);
const here = dirname(fileURLToPath(import.meta.url));
const repoRoot = resolve(here, '..', '..');
const backendRoot = join(repoRoot, 'demos', 'rbac', 'snapback');
const generatedRoot = join(backendRoot, 'generated');
const codegenCache = join(repoRoot, 'demos', 'rbac', '.snapback', 'codegen-cache');
let preservedRoot = null;

// @ref LLP 0031#server-binary-identity-on-health — the rung must compare an
// independently stamped child to the checkout, not accept a caller-stamped or
// explicitly configured mismatch.
// This rung must select a checkout-bound binary. An ambient configured binary
// bypasses the kit's mismatch refusal, while the build stamp overrides turn a
// cargo child's identity into a caller assertion instead of an independent
// measurement. Keep all three escape hatches outside this proof process.
const proofEnvironment = { ...process.env };
for (const key of [
  'SNAPBACK_SERVER_BINARY',
  'SNAPBACK_BUILD_GIT_COMMIT',
  'SNAPBACK_BUILD_GIT_DIRTY',
]) {
  delete proofEnvironment[key];
}

async function trackedGeneratedPaths() {
  const { stdout } = await execFileAsync(
    'git',
    ['ls-files', '--', 'demos/rbac/snapback/generated'],
    { cwd: repoRoot, encoding: 'utf8' },
  );
  return new Set(stdout.trim().split(/\r?\n/u).filter(Boolean).map((path) => resolve(repoRoot, path)));
}

async function clearRegenerableGenerated(path, tracked, { keepRoot = false } = {}) {
  let entries;
  try {
    entries = await readdir(path, { withFileTypes: true });
  } catch (error) {
    if (error?.code === 'ENOENT') return;
    throw error;
  }
  for (const entry of entries) {
    const child = join(path, entry.name);
    const retained = tracked.has(child)
      || [...tracked].some((trackedPath) => trackedPath.startsWith(`${child}/`));
    if (!retained) {
      await rm(child, { recursive: true, force: true });
    } else if (entry.isDirectory()) {
      await clearRegenerableGenerated(child, tracked);
    }
  }
  if (!keepRoot && ![...tracked].some((trackedPath) => trackedPath.startsWith(`${path}/`))) {
    await rm(path, { recursive: true, force: true });
  }
}

async function preservePath(path, name) {
  const backup = join(preservedRoot, name);
  try {
    await lstat(path);
  } catch (error) {
    if (error?.code === 'ENOENT') return { path, backup, existed: false };
    throw error;
  }
  await cp(path, backup, { recursive: true, preserveTimestamps: true });
  return { path, backup, existed: true };
}

async function restorePaths(snapshots) {
  const failures = [];
  for (const snapshot of snapshots) {
    try {
      await rm(snapshot.path, { recursive: true, force: true });
      if (snapshot.existed) {
        await cp(snapshot.backup, snapshot.path, {
          recursive: true,
          preserveTimestamps: true,
        });
      }
    } catch (error) {
      failures.push(error);
    }
  }
  if (failures.length > 0) {
    throw new AggregateError(
      failures,
      `failed to restore RBAC generated state; recovery snapshot retained at ${preservedRoot}`,
    );
  }
  await rm(preservedRoot, { recursive: true, force: true });
}

async function run(label, command, args) {
  const output = { stdout: '', stderr: '' };
  const child = spawn(command, args, {
    cwd: repoRoot,
    env: proofEnvironment,
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  child.stdout.on('data', (chunk) => {
    output.stdout += chunk;
    process.stdout.write(chunk);
  });
  child.stderr.on('data', (chunk) => {
    output.stderr += chunk;
    process.stderr.write(chunk);
  });
  const exit = await new Promise((resolveExit, reject) => {
    let spawnError = null;
    child.once('error', (error) => { spawnError = error; });
    child.once('close', (code, signal) => {
      if (spawnError !== null) reject(spawnError);
      else resolveExit({ code, signal });
    });
  });
  assert.deepEqual(exit, { code: 0, signal: null }, `${label} failed`);
  return output;
}

const tracked = await trackedGeneratedPaths();
assert(tracked.size > 0, 'the RBAC clean-checkout prime requires tracked governance records');
preservedRoot = await mkdtemp(join(tmpdir(), 'snapback-rbac-fresh-prime-'));
const snapshots = [
  await preservePath(generatedRoot, 'generated'),
  await preservePath(codegenCache, 'codegen-cache'),
];
let acceptance = null;
let primaryFailure = null;
try {
  await clearRegenerableGenerated(generatedRoot, tracked, { keepRoot: true });
  await rm(codegenCache, { recursive: true, force: true });

  await run(
    'fresh RBAC codegen',
    process.execPath,
    ['packages/snapback-codegen/index.mjs', 'demos/rbac/snapback'],
  );
  acceptance = await run(
    'governed RBAC acceptance',
    process.execPath,
    ['demos/rbac/tests/acceptance/rbac.mjs'],
  );
} catch (error) {
  primaryFailure = error;
}

try {
  await restorePaths(snapshots);
} catch (restoreFailure) {
  if (primaryFailure !== null) {
    throw new AggregateError(
      [primaryFailure, restoreFailure],
      'RBAC fresh-prime proof and generated-state restoration both failed',
    );
  }
  throw restoreFailure;
}
if (primaryFailure !== null) throw primaryFailure;

assert.match(acceptance.stdout, /^BOUND demo-kit rbac http:\/\/127\.0\.0\.1:\d+$/mu);
assert.match(
  acceptance.stdout,
  /^MINTED demo-kit rbac governance target config \/.*\/visibility-governance-dev-target-config\.json$/mu,
);
assert.match(
  acceptance.stdout,
  /^EXACT snapback child build [0-9a-f]{40} \S+ \S+$/mu,
);
assert.match(
  acceptance.stdout,
  /^REFUSED snapback child missing governance target config SNAPBACK_TABLE_VISIBILITY_GOVERNANCE_REMOTE_CUSTODY_UNAVAILABLE$/mu,
);
assert.match(acceptance.stdout, /^rbac generated authoring and enforcement proof: ok$/mu);
console.log('rbac governed fresh-prime acceptance rung: ok');

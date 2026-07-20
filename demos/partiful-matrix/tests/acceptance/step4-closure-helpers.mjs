import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { extname, join, relative, resolve } from 'node:path';
import { spawnSync } from 'node:child_process';
import { gzipSync } from 'node:zlib';

import { writeMachineReport } from '../../../_kit/harness.mjs';

export const repoRoot = resolve(import.meta.dirname, '../../../..');
export const demoRoot = resolve(repoRoot, 'demos/partiful-matrix');
export const acceptanceRoot = resolve(demoRoot, 'acceptance');
export const exactRoot = resolve(process.env.EXACT_ROOT ?? resolve(repoRoot, '../exact'));

export const sha256 = (value) => createHash('sha256').update(value).digest('hex');

export function readBytes(path) {
  return readFileSync(resolve(repoRoot, path));
}

export function readText(path) {
  return readBytes(path).toString('utf8');
}

export function readJson(path) {
  return JSON.parse(readText(path));
}

export function identity(path) {
  const absolute = resolve(repoRoot, path);
  return {
    path: relative(repoRoot, absolute),
    sha256: sha256(readFileSync(absolute)),
  };
}

export function readCommittedJson(path, revision = 'HEAD') {
  const normalized = relative(repoRoot, resolve(repoRoot, path));
  const child = spawnSync('git', ['show', `${revision}:${normalized}`], {
    cwd: repoRoot,
    encoding: null,
  });
  assert.equal(child.status, 0, `git show ${revision}:${normalized} failed: ${child.stderr?.toString('utf8')}`);
  return {
    value: JSON.parse(child.stdout.toString('utf8')),
    identity: {
      path: normalized,
      revision,
      sha256: sha256(child.stdout),
    },
  };
}

export function measureSourceInventory(paths) {
  const files = paths.map((path) => {
    const bytes = readBytes(path);
    const text = bytes.toString('utf8');
    return {
      path,
      lines: text.length === 0 ? 0 : text.split('\n').length - (text.endsWith('\n') ? 1 : 0),
      bytes: bytes.length,
      sha256: sha256(bytes),
    };
  });
  return { files, totalLines: files.reduce((sum, file) => sum + file.lines, 0) };
}

export function measureJavaScriptBundle(root) {
  const absoluteRoot = resolve(repoRoot, root);
  const walk = (directory) => readdirSync(directory).flatMap((name) => {
    const path = join(directory, name);
    return statSync(path).isDirectory() ? walk(path) : [path];
  });
  const assets = walk(absoluteRoot)
    .filter((path) => extname(path) === '.js')
    .sort()
    .map((path) => {
      const bytes = readFileSync(path);
      return {
        path: relative(repoRoot, path),
        minifiedBytes: bytes.length,
        deterministicGzipBytes: gzipSync(bytes, { level: 9, mtime: 0 }).length,
        sha256: sha256(bytes),
      };
    });
  assert(assets.length > 0, `${root} emitted no JavaScript assets`);
  return {
    assets,
    minifiedBytes: assets.reduce((sum, asset) => sum + asset.minifiedBytes, 0),
    deterministicGzipBytes: assets.reduce((sum, asset) => sum + asset.deterministicGzipBytes, 0),
  };
}

export function exactIdentity(path) {
  const absolute = resolve(exactRoot, path);
  return {
    path: relative(repoRoot, absolute),
    sha256: sha256(readFileSync(absolute)),
  };
}

export function gitRevision(root = repoRoot) {
  const child = spawnSync('git', ['rev-parse', 'HEAD'], { cwd: root, encoding: 'utf8' });
  assert.equal(child.status, 0, `git revision lookup failed under ${root}: ${child.stderr}`);
  return child.stdout.trim();
}

export function validateRetainedWebReceipt(receipt) {
  assert.equal(receipt.ok, true, 'retained Step 0 web receipt is not green');
  assert.equal(receipt.passed, 43, 'retained Step 0 web receipt pass count drifted');
  assert.equal(receipt.failed, 0, 'retained Step 0 web receipt contains failures');
  assert.equal(receipt.skipped, 0, 'retained Step 0 web receipt contains skips');
  assert.equal(receipt.total, 43, 'retained Step 0 web receipt check count drifted');
  for (const entry of receipt.testInventory ?? []) {
    assert.deepEqual(identity(entry.path), entry, `retained Step 0 input drifted: ${entry.path}`);
  }
}

export function retainedResult(receipt, name) {
  const result = receipt.results.find((entry) => entry.name === name);
  assert(result, `retained Step 0 result is missing: ${name}`);
  assert.equal(result.ok, true, `retained Step 0 result is not green: ${name}`);
  return result;
}

export function requirement(id, status, reasonCode, evidence, claimTreatment = undefined) {
  assert(['pass', 'red'].includes(status), `invalid Step 4 requirement status: ${status}`);
  return {
    id,
    status,
    reasonCode,
    ...(claimTreatment === undefined ? {} : { claimTreatment }),
    evidence,
  };
}

export function finalizeReport({ schemaVersion, claimId, requirements, inputs, details = {} }) {
  assert(requirements.length > 0, `${claimId} produced a vacuous requirement inventory`);
  assert.equal(new Set(requirements.map(({ id }) => id)).size, requirements.length, `${claimId} has duplicate requirement ids`);
  assert(requirements.every(({ status }) => status !== 'skip'), `${claimId} contains a forbidden skip`);
  const passed = requirements.filter(({ status }) => status === 'pass').length;
  const red = requirements.filter(({ status }) => status === 'red').length;
  const nonclaims = requirements.filter(({ claimTreatment }) => claimTreatment === 'nonclaim').length;
  const claimSatisfied = red === 0;
  return {
    schemaVersion,
    claimId,
    auditCompleted: true,
    ok: claimSatisfied,
    claimSatisfied,
    outcome: claimSatisfied ? 'pass' : 'red',
    skipPolicy: 'forbidden',
    skipped: 0,
    recordedAt: new Date().toISOString(),
    repository: {
      snapbackRevision: gitRevision(),
      exactRevision: gitRevision(exactRoot),
    },
    inputs,
    summary: { passed, red, nonclaims, total: requirements.length },
    requirements,
    ...details,
  };
}

export function writeStep4Report(path, report) {
  writeMachineReport(relative(repoRoot, resolve(repoRoot, path)), report);
  console.log(JSON.stringify(report));
  if (process.argv.includes('--require-pass') && !report.claimSatisfied) process.exitCode = 1;
}

export function run(command, args, cwd = repoRoot) {
  const child = spawnSync(command, args, {
    cwd,
    encoding: 'utf8',
    stdio: ['ignore', 'pipe', 'pipe'],
    env: process.env,
  });
  return {
    command: [command, ...args],
    cwd: relative(repoRoot, cwd),
    status: child.status,
    signal: child.signal,
    stdoutSha256: sha256(child.stdout ?? ''),
    stderrSha256: sha256(child.stderr ?? ''),
    stdoutTail: (child.stdout ?? '').trim().split('\n').slice(-12),
    stderrTail: (child.stderr ?? '').trim().split('\n').slice(-12),
  };
}

#!/usr/bin/env node

import { createHash } from 'node:crypto';
import {
  accessSync,
  constants,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawnSync } from 'node:child_process';

import { readCheckoutRuntimeIdentity } from '../../packages/snapback-cli/runtime-recovery.mjs';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '../..');
// @ref LLP 0109#166-the-manifest-is-an-executable-advertisement-gate —
// conformance evidence is meaningful only when the exercised binary is bound
// to the exact source revision and runtime-input dirtiness fact that invoked
// the closed dispatcher. Use the shared scoped definition that stamps the
// binary; whole-tree authoring dirt cannot change the executable's bytes.
const sourceIdentity = readCheckoutRuntimeIdentity(root);
const sourceGitCommit = sourceIdentity.gitCommit;
const sourceGitDirty = sourceIdentity.gitDirty;
if (
  !/^[0-9a-f]{40}$/u.test(sourceGitCommit ?? '')
  || typeof sourceGitDirty !== 'boolean'
) {
  throw new Error('SNAPBACK_SEED_CONFORMANCE_REVISION_UNAVAILABLE');
}
const receiptAt = process.argv.indexOf('--receipt');
const quiet = process.argv.includes('--quiet');
const receiptPath = receiptAt >= 0 ? resolve(process.argv[receiptAt + 1]) : null;
if (receiptAt >= 0 && !process.argv[receiptAt + 1]) {
  throw new Error('SNAPBACK_SEED_CONFORMANCE_RECEIPT_PATH_REQUIRED');
}
const manifestPath = resolve(root, 'tests/conformance/versioned-seed-v1.manifest.json');
const bytes = readFileSync(manifestPath);
const manifest = JSON.parse(bytes);
const knownRunners = new Set([
  'http', 'cli', 'host-op', 'vite', 'package', 'restore', 'migration',
  'predecessor', 'fault', 'storage', 'auth', 'hosted-gap',
]);
const expectedCaseIds = new Set([
  'http-install-state-matrix',
  'http-preview-byte-identity',
  'http-reset-install-clear',
  'cli-install-matched-drift',
  'cli-no-legacy-fallback',
  'host-op-ensure-v1',
  'host-op-preview-v1',
  'host-op-reset-install-v1',
  'host-op-clear-v1',
  'vite-managed-versioned-seed',
  'package-cold-install',
  'restore-leaves-identity-absent',
  'migration-refuses-identity-advance',
  'predecessor-legacy-reset-rotates-away',
  'crash-before-commit-zero-effects',
  'response-loss-replay-one-effect',
  'empty-array-target-occupancy',
  'sessions-membership-fixture-lane',
  'effect-bound-1024',
  'effect-bound-1025-refusal',
  'hosted-compiled-seed',
]);
const ids = new Set();

if (manifest.artifactKind !== 'snapback.versioned-seed-conformance.v1'
  || manifest.schemaVersion !== 'snapback.versioned-seed-conformance-manifest.v1'
  || manifest.formatVersion !== 1
  || !Array.isArray(manifest.cases)
  || manifest.cases.length === 0) {
  throw new Error('SNAPBACK_SEED_CONFORMANCE_MANIFEST_INVALID: invalid closed header');
}

for (const entry of manifest.cases) {
  const keys = Object.keys(entry).sort();
  const expectedKeys = entry.status === 'gap'
    ? ['capabilityPredicate', 'entrypoint', 'expectedAssertions', 'gap', 'id', 'runner', 'status']
    : ['capabilityPredicate', 'entrypoint', 'expectedAssertions', 'id', 'runner', 'status'];
  if (JSON.stringify(keys) !== JSON.stringify(expectedKeys.sort())
    || ids.has(entry.id)
    || !knownRunners.has(entry.runner)
    || !['required', 'gap'].includes(entry.status)
    || !Number.isSafeInteger(entry.expectedAssertions)
    || (entry.status === 'required' && entry.expectedAssertions < 1)
    || !Array.isArray(entry.capabilityPredicate)) {
    throw new Error(`SNAPBACK_SEED_CONFORMANCE_MANIFEST_INVALID: malformed case ${entry.id}`);
  }
  ids.add(entry.id);
  const executable = resolve(root, entry.entrypoint);
  accessSync(executable, constants.X_OK);
}
if (
  ids.size !== expectedCaseIds.size
  || [...ids].some((id) => !expectedCaseIds.has(id))
) {
  throw new Error('SNAPBACK_SEED_CONFORMANCE_MANIFEST_INVALID: missing or unknown case id');
}

const evidenceRoot = mkdtempSync(resolve(tmpdir(), 'snapback-versioned-seed-evidence-'));
const suite = spawnSync(
  resolve(root, 'tests/conformance/versioned-seed-v1-suite.mjs'),
  ['--out', evidenceRoot],
  {
    cwd: root,
    encoding: 'utf8',
    env: {
      ...process.env,
      SNAPBACK_BUILD_GIT_COMMIT: sourceGitCommit,
      SNAPBACK_BUILD_GIT_DIRTY: String(sourceGitDirty),
    },
    maxBuffer: 64 * 1024 * 1024,
  },
);
function suiteFailureDiagnostic(result) {
  const raw = result.error?.message
    ?? result.stderr
    ?? result.stdout
    ?? result.signal
    ?? result.status
    ?? 'unknown failure';
  const lines = String(raw).split(/\r?\n/u).map((line) => line.trim()).filter(Boolean);
  const errorLine = lines.find((line) => /^[A-Za-z]*Error: /u.test(line));
  return `suite failed: ${errorLine ?? lines[0] ?? 'unknown failure'}`;
}
const suiteDiagnostic = suite.status === 0 ? null : suiteFailureDiagnostic(suite);
const outcomes = [];
try {
  for (const entry of manifest.cases) {
    if (entry.status === 'gap') {
      outcomes.push({
        id: entry.id,
        outcome: 'gap',
        assertionCount: 0,
        gap: entry.gap,
      });
      continue;
    }
    const child = spawnSync(resolve(root, entry.entrypoint), ['--case', entry.id], {
      cwd: root,
      encoding: 'utf8',
      env: {
        ...process.env,
        SNAPBACK_VERSIONED_SEED_CASE_EVIDENCE_DIR: evidenceRoot,
      },
    });
    let result = null;
    try {
      result = JSON.parse(child.stdout);
    } catch {
      // Closed failure below: runner output is evidence, not a log convention.
    }
    const assertionCount = result?.assertionCount;
    const outcome = suite.status === 0
      && child.status === 0
      && result?.id === entry.id
      && result?.outcome === 'passed'
      && assertionCount === entry.expectedAssertions
      ? 'passed'
      : 'failed';
    outcomes.push({
      id: entry.id,
      outcome,
      assertionCount: Number.isSafeInteger(assertionCount) ? assertionCount : 0,
      ...(Array.isArray(result?.assertions) ? { assertions: result.assertions } : {}),
      ...(result?.predecessor ? { predecessor: result.predecessor } : {}),
      ...(outcome === 'failed'
        ? {
            // A producer failure invalidates every case file. Preserve that
            // root diagnostic instead of letting each runner's missing/invalid
            // evidence fallback mask it twenty times.
            diagnostic: suite.status === 0
              ? (result?.diagnostic ?? 'runner failed or assertion count mismatched')
              : suiteDiagnostic,
          }
        : {}),
    });
  }
} finally {
  rmSync(evidenceRoot, { recursive: true, force: true });
}

const admitted = manifest.capabilities.filter((capability) => {
  const relevant = manifest.cases.filter((entry) =>
    entry.capabilityPredicate.includes(capability) && entry.status === 'required');
  return relevant.length > 0
    && relevant.every((entry) =>
      outcomes.find((outcome) => outcome.id === entry.id)?.outcome === 'passed');
});
const currentBinaryPath = process.env.SNAPBACK_BINARY
  ? resolve(process.env.SNAPBACK_BINARY)
  : resolve(root, 'target/debug/snapback');
let currentBinary;
try {
  const identity = spawnSync(currentBinaryPath, ['build-identity'], {
    cwd: root,
    encoding: 'utf8',
  });
  currentBinary = {
    sha256: createHash('sha256').update(readFileSync(currentBinaryPath)).digest('hex'),
    buildIdentity: JSON.parse(identity.stdout),
  };
} catch {
  currentBinary = { unavailable: true };
}
const binaryIdentity = currentBinary?.buildIdentity?.binary ?? null;
const revisionBinding = {
  sourceGitCommit,
  sourceGitDirty,
  binaryGitCommit: binaryIdentity?.gitCommit ?? null,
  binaryGitDirty: binaryIdentity?.gitDirty ?? null,
  matched: binaryIdentity?.gitCommit === sourceGitCommit
    && binaryIdentity?.gitDirty === sourceGitDirty,
};
const receipt = {
  artifactKind: 'snapback.versioned-seed-conformance-receipt.v1',
  formatVersion: 1,
  manifestDigest: createHash('sha256').update(bytes).digest('hex'),
  revisionBinding,
  currentBinary,
  outcomes,
  capabilitiesAdmitted: admitted,
  gaps: outcomes.filter(({ outcome }) => outcome === 'gap'),
};
const encodedReceipt = `${JSON.stringify(receipt, null, 2)}\n`;
if (receiptPath) {
  mkdirSync(dirname(receiptPath), { recursive: true });
  writeFileSync(receiptPath, encodedReceipt, { mode: 0o600 });
}
if (quiet) {
  const passed = outcomes.filter(({ outcome }) => outcome === 'passed').length;
  const failed = outcomes.filter(({ outcome }) => outcome === 'failed').map(({ id }) => id);
  const gaps = outcomes.filter(({ outcome }) => outcome === 'gap').length;
  const totalFailureCause = passed === 0 && failed.length > 0
    ? outcomes.find(({ outcome, diagnostic }) => outcome === 'failed' && diagnostic)?.diagnostic
    : null;
  process.stdout.write(
    `[versioned-seed-conformance] ${passed} passed, ${failed.length} failed, `
      + `${gaps} GAP; revision=${revisionBinding.matched ? 'matched' : 'mismatched'}`
      + `${failed.length ? `; failed=${failed.join(',')}` : ''}`
      + `${totalFailureCause ? `; cause=${totalFailureCause}` : ''}\n`,
  );
} else {
  process.stdout.write(encodedReceipt);
}
if (!revisionBinding.matched || outcomes.some(({ outcome }) => outcome === 'failed')) {
  process.exitCode = 1;
}

import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';

import {
  assessReceiptCurrentness,
  digestSourceInputs,
  digestSourceInputsAtRevision,
  validateReceipt,
  validateSourceInputs,
} from './telemetry-phase1-evidence.mjs';

const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..');

test('transitive harness and evidence-policy bytes are in the freshness closure', () => {
  const sourceInputs = digestSourceInputs();
  const closureFiles = [
    'demos/_kit/provenance.mjs',
    'packages/snapback-cli/runtime-readiness.mjs',
    'packages/snapback-cli/runtime-recovery.mjs',
    'scripts/lib/process-tree.mjs',
    'scripts/runtime-link-smoke.mjs',
    'tests/acceptance/telemetry-phase1-evidence-policy.v1.json',
  ];
  for (const file of closureFiles) {
    assert(sourceInputs.files.includes(file), `${file} must invalidate retained evidence`);
  }

  assert.throws(
    () => validateSourceInputs(sourceInputs, (file) => {
      const original = readFileSync(join(repoRoot, file));
      return file === 'scripts/lib/process-tree.mjs'
        ? Buffer.concat([original, Buffer.from('\n// simulated transitive harness mutation\n')])
        : original;
    }),
    /proof-source digest freshness/,
    'the validator must stale the receipt after a transitive harness mutation',
  );
});

test('retained evidence validates against its measured Git tree after main drifts', () => {
  const receipt = JSON.parse(readFileSync(
    join(repoRoot, 'tests', 'acceptance', 'telemetry-phase1-evidence.v1.json'),
    'utf8',
  ));
  assert.doesNotThrow(() => validateReceipt(receipt));

  const tampered = structuredClone(receipt);
  tampered.sourceInputs.digest = '0'.repeat(64);
  assert.throws(
    () => validateReceipt(tampered),
    /proof-source digest freshness/,
    'historical validation must recompute the measured tree, not trust receipt bytes',
  );

  const incomplete = structuredClone(receipt);
  incomplete.sourceInputs.files = incomplete.sourceInputs.files.slice(0, -1);
  assert.throws(
    () => validateReceipt(incomplete),
    /measured input file set/,
    'historical validation must reject an omitted measured source path',
  );
});

test('revision-scoped source digest reproduces the retained measured closure', () => {
  const receipt = JSON.parse(readFileSync(
    join(repoRoot, 'tests', 'acceptance', 'telemetry-phase1-evidence.v1.json'),
    'utf8',
  ));
  const measured = digestSourceInputsAtRevision(receipt.sourceRevision);
  assert.deepEqual(measured.files, receipt.sourceInputs.files);
  assert.equal(measured.algorithm, receipt.sourceInputs.algorithm);
  assert.equal(measured.digest, receipt.sourceInputs.digest);
});

test('rolling assessment separates current, lagging, overdue, and diverged evidence', () => {
  const sourceRevision = '1'.repeat(40);
  const headRevision = '2'.repeat(40);
  const createdAt = '2026-08-06T00:00:00.000Z';
  const receipt = {
    createdAt,
    sourceRevision,
    sourceInputs: {
      algorithm: 'sha256-length-framed-v1',
      files: ['src/example.rs'],
      digest: 'a'.repeat(64),
    },
  };
  const common = {
    headRevision,
    now: Date.parse(createdAt) + 2 * 3_600_000,
    maxAgeHours: 24,
    ancestor: true,
    changedFiles: ['src/example.rs'],
  };

  const current = assessReceiptCurrentness(receipt, {
    ...common,
    currentInputs: receipt.sourceInputs,
    changedFiles: [],
  });
  assert.equal(current.state, 'CURRENT');
  assert.equal(current.acceptedForReleaseOrCapabilityPromotion, true);

  const lagging = assessReceiptCurrentness(receipt, {
    ...common,
    currentInputs: { ...receipt.sourceInputs, digest: 'b'.repeat(64) },
  });
  assert.equal(lagging.state, 'LAGGING');
  assert.equal(lagging.acceptedForOrdinaryMerge, true);
  assert.equal(lagging.acceptedForReleaseOrCapabilityPromotion, false);

  const overdue = assessReceiptCurrentness(receipt, {
    ...common,
    currentInputs: { ...receipt.sourceInputs, digest: 'b'.repeat(64) },
    now: Date.parse(createdAt) + 25 * 3_600_000,
  });
  assert.equal(overdue.state, 'OVERDUE');
  assert.equal(overdue.acceptedForOrdinaryMerge, true);
  assert.equal(overdue.rollingFullProofRequested, true);

  const diverged = assessReceiptCurrentness(receipt, {
    ...common,
    ancestor: false,
    currentInputs: { ...receipt.sourceInputs, digest: 'b'.repeat(64) },
    changedFiles: [],
  });
  assert.equal(diverged.state, 'DIVERGED');
  assert.equal(diverged.acceptedForOrdinaryMerge, false);
});

import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';

import { enforceTelemetryCurrentGate } from './telemetry-release-gate.mjs';

const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const receiptPath = join(
  repoRoot,
  'tests',
  'acceptance',
  'telemetry-phase1-evidence.v1.json',
);
function isRefusal(error) {
  return /^SNAPBACK_TELEMETRY_RELEASE_GATE_REFUSED:/u.test(error?.message ?? '');
}

function assessment(candidateRevision, state, overrides = {}) {
  return {
    schemaVersion: 'snapback.telemetry-phase1-evidence-assessment.v1',
    valid: true,
    evidenceState: 'HISTORICAL_VALID',
    state,
    sourceRevision: '1'.repeat(40),
    headRevision: candidateRevision,
    sourceDigest: 'a'.repeat(64),
    currentDigest: state === 'CURRENT' ? 'a'.repeat(64) : 'b'.repeat(64),
    ageHours: 1,
    maxAgeHours: 24,
    changedSourceFileCount: state === 'CURRENT' ? 0 : 1,
    changedSourceFiles: state === 'CURRENT' ? [] : ['src/example.rs'],
    changedSourceFilesTruncated: false,
    acceptedForOrdinaryMerge: state !== 'DIVERGED',
    acceptedForReleaseOrCapabilityPromotion: state === 'CURRENT',
    rollingFullProofRequested: state !== 'CURRENT',
    ...overrides,
  };
}

function verifierResult(value, status = 0) {
  return {
    status,
    signal: null,
    stdout: `${JSON.stringify(value)}\n`,
    stderr: '',
  };
}

function runBeforeEffect({ candidateRevision, runVerifier, effect }) {
  const result = enforceTelemetryCurrentGate({ candidateRevision, runVerifier });
  effect(result);
  return result;
}

test('CURRENT proceeds before the irreversible effect', () => {
  const candidateRevision = '2'.repeat(40);
  const current = assessment(candidateRevision, 'CURRENT');
  const effects = [];
  const result = runBeforeEffect({
    candidateRevision,
    runVerifier: () => verifierResult(current),
    effect(value) {
      effects.push(value);
    },
  });
  assert.deepEqual(result, current);
  assert.deepEqual(effects, [current]);
});

for (const state of ['LAGGING', 'OVERDUE', 'DIVERGED']) {
  test(`${state} refuses before the irreversible effect`, () => {
    const candidateRevision = '2'.repeat(40);
    let effectInvoked = false;
    assert.throws(
      () => runBeforeEffect({
        candidateRevision,
        // require-current prints its assessment, then asserts and exits nonzero.
        runVerifier: () => verifierResult(assessment(candidateRevision, state), 1),
        effect() {
          effectInvoked = true;
        },
      }),
      isRefusal,
    );
    assert.equal(effectInvoked, false);
  });
}

test('invalid verifier output refuses closed', () => {
  assert.throws(
    () => enforceTelemetryCurrentGate({
      candidateRevision: '2'.repeat(40),
      runVerifier: () => ({ status: 1, stdout: 'not-json\n', stderr: 'crash' }),
    }),
    isRefusal,
  );
});

test('assessment for a different head revision refuses', () => {
  const candidateRevision = '2'.repeat(40);
  assert.throws(
    () => enforceTelemetryCurrentGate({
      candidateRevision,
      runVerifier: () => verifierResult(assessment('3'.repeat(40), 'CURRENT')),
    }),
    isRefusal,
  );
});

test('actual verifier accepts the retained receipt at its measured revision', () => {
  const receipt = JSON.parse(readFileSync(receiptPath, 'utf8'));
  const result = enforceTelemetryCurrentGate({
    repoRoot,
    candidateRevision: receipt.sourceRevision,
    receiptPath,
  });
  assert.equal(result.state, 'CURRENT');
  assert.equal(result.headRevision, receipt.sourceRevision);
  assert.equal(result.acceptedForReleaseOrCapabilityPromotion, true);
});

test('ordinary rolling assessment never authorizes a non-CURRENT receipt', () => {
  const result = spawnSync(process.execPath, [
    join(repoRoot, 'scripts', 'telemetry-phase1-evidence.mjs'),
    'assess',
    receiptPath,
  ], {
    cwd: repoRoot,
    encoding: 'utf8',
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  assert.equal(result.status, 0, result.stderr);
  const rolling = JSON.parse(result.stdout.trim());
  if (rolling.state !== 'CURRENT') {
    assert.equal(rolling.acceptedForReleaseOrCapabilityPromotion, false);
  }
});

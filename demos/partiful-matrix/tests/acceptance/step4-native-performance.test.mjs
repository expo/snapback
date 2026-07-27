import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import test from 'node:test';

import { validateNativePerformanceCollectionResult } from './native-performance-collection-result.mjs';

const here = dirname(fileURLToPath(import.meta.url));
const collector = resolve(here, 'step4-native-performance.mjs');
const repoRoot = resolve(here, '../../../..');

const releaseLane = {
  laneId: 'partitime.native-ios-release-simulator-hbc-agent-off.v1',
  buildConfiguration: 'Release',
  simulatorBuild: true,
  artifactMode: 'hermes-hbc',
  agentLoadedBeforeFirstFrame: false,
  debugOverlayEnabled: false,
  firstFrameObserver: 'native-host',
  authoritativeDataObserver: 'structured-product-marker',
};
const candidateObserver = {
  id: 'capsec-simulator-performance-observer-v1',
  targetAdvertisementSubstituted: true,
  rootLoopbackFetchSubstituted: true,
  ordinaryAbiPreserved: true,
  runtimeMarkers: {
    ibexAuthenticatedSubstitution: true,
    ibexLoopbackFetchSubstituted: true,
    ibexPostureVerified: true,
    exactObserverEnabled: true,
    exactObserverRuntimeCreated: true,
    exactCarrierDispatchInstalled: true,
  },
  diagnosticRuntimeObserved: false,
  agentObservedBeforeFirstFrame: false,
};

function writeFixture(root, reactSample, exactSample) {
  const hostIdentity = { os: 'darwin-test', machine: 'fixture' };
  writeFileSync(resolve(root, 'react.json'), `${JSON.stringify({
    ok: true,
    profileId: 'react-expo/ios',
    repository: { sourceDirty: false },
    environment: hostIdentity,
    performance: { sample: reactSample },
  })}\n`);
  writeFileSync(resolve(root, 'exact.json'), `${JSON.stringify({
    ok: true,
    environment: hostIdentity,
    source: { snapback: { dirty: false }, exact: { dirty: false } },
    observer: {
      id: candidateObserver.id,
      build: { featureBound: true },
    },
    performance: { sample: exactSample },
  })}\n`);
  writeFileSync(resolve(root, 'inputs.json'), `${JSON.stringify({
    schemaVersion: 'partitime.native-performance-inputs.v1',
    platform: 'ios',
    hostIdentity,
    react: { hostIdentity, receipts: ['react.json'] },
    exact: { hostIdentity, receipts: ['exact.json'] },
  })}\n`);
}

test('native performance validator checks authority without inputs or a receipt', () => {
  const root = mkdtempSync(resolve(tmpdir(), 'partitime-native-performance-validator-test-'));
  try {
    const output = resolve(root, 'must-not-exist.json');
    const child = spawnSync(process.execPath, [
      collector,
      '--validate-only',
      '--out', output,
    ], { encoding: 'utf8' });
    assert.equal(child.status, 0, child.stderr);
    assert.equal(existsSync(output), false);
    const result = JSON.parse(child.stdout);
    assert.deepEqual(result, {
      schemaVersion: 'partitime.step4-native-performance-validator.v1',
      ok: true,
      amendmentId: 'partitime-ws8-prospective-2026-07-21',
      amendmentStatus: 'ratified',
      invalidationId: 'partitime-ws8-native-lane-invalidation-2026-07-22',
      invalidationStatus: 'ratified',
      observerAmendmentId: 'partitime-ws8-native-observer-v3-2026-07-23',
      observerAmendmentStatus: 'ratified',
      methodId: 'partitime.native-launch-stage.v2',
      thresholdSetId: 'partitime-ws8-native-performance-thresholds-v2',
      laneId: 'partitime.native-ios-release-simulator-hbc-agent-off.v1',
      observerId: 'capsec-simulator-performance-observer-v1',
    });
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test('invalidated native evidence remains digest-closed and claim-ineligible', () => {
  const dispositionPath = resolve(
    repoRoot,
    'demos/partiful-matrix/acceptance/results/native-remediation-20260727c/evidence-disposition.json',
  );
  const disposition = JSON.parse(readFileSync(dispositionPath, 'utf8'));
  assert.equal(disposition.valid, false);
  assert.equal(disposition.claimEligible, false);
  assert.equal(disposition.outcome, 'invalidated-diagnostic');
  assert.equal(disposition.disposition.preserveOriginalBytes, true);
  assert.equal(disposition.disposition.excludeFromClaimPromotion, true);
  const artifacts = [
    disposition.preservedArtifacts.inputs,
    disposition.preservedArtifacts.aggregate,
    ...disposition.preservedArtifacts.rawReceipts,
  ];
  assert.equal(artifacts.length, 20);
  for (const artifact of artifacts) {
    const bytes = readFileSync(resolve(repoRoot, artifact.path));
    assert.equal(
      createHash('sha256').update(bytes).digest('hex'),
      artifact.sha256,
      `${artifact.path} drifted after invalidation`,
    );
  }
});

test('native performance collection accepts a complete red holdout', () => {
  assert.doesNotThrow(() => validateNativePerformanceCollectionResult({
    cohort: 'holdout',
    claimEligible: true,
    ok: false,
    outcome: 'red',
    holdoutValidation: {
      ok: false,
      rows: [
        { pass: false },
        { pass: true },
        { pass: false },
        { pass: false },
      ],
    },
  }, {
    cohort: 'holdout',
    quick: false,
  }));
});

test('native performance collection rejects an inconsistent red holdout', () => {
  assert.throws(() => validateNativePerformanceCollectionResult({
    cohort: 'holdout',
    claimEligible: true,
    ok: false,
    outcome: 'red',
    holdoutValidation: {
      ok: true,
      rows: [{}, {}, {}, {}],
    },
  }, {
    cohort: 'holdout',
    quick: false,
  }), /verdict disagrees/);
});

test('native performance collector aggregates only comparable structured samples', () => {
  const root = mkdtempSync(resolve(tmpdir(), 'partitime-native-performance-test-'));
  try {
    const sample = {
      definitionVersion: 'partitime.native-launch-stage.v2',
      lane: releaseLane,
      hermesEvaluationMs: 10,
      startupAssetWeightBytes: 100,
      coldLaunchMs: 20,
      firstAuthoritativeDataMs: 30,
    };
    writeFixture(root, sample, {
      ...sample,
      hermesEvaluationMs: 11,
      candidateObserver,
    });
    const output = resolve(root, 'report.json');
    const child = spawnSync(process.execPath, [collector, '--quick', '--inputs', resolve(root, 'inputs.json'), '--out', output], {
      encoding: 'utf8',
    });
    assert.equal(child.status, 0, child.stderr);
    const report = JSON.parse(readFileSync(output, 'utf8'));
    assert.equal(report.claimEligible, false);
    assert.equal(report.cells['react-expo:ios:snapback'].aggregate.hermesEvaluationMs.p95, 10);
    assert.equal(report.cells['exact-contract:ios:snapback'].aggregate.hermesEvaluationMs.p95, 11);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test('native performance collector rejects a v2 sample from the wrong lane', () => {
  const root = mkdtempSync(resolve(tmpdir(), 'partitime-native-performance-lane-test-'));
  try {
    const sample = {
      definitionVersion: 'partitime.native-launch-stage.v2',
      lane: releaseLane,
      hermesEvaluationMs: 10,
      startupAssetWeightBytes: 100,
      coldLaunchMs: 20,
      firstAuthoritativeDataMs: 30,
    };
    writeFixture(root, sample, {
      ...sample,
      lane: { ...releaseLane, buildConfiguration: 'Debug' },
      candidateObserver,
    });
    const child = spawnSync(process.execPath, [
      collector,
      '--quick',
      '--inputs', resolve(root, 'inputs.json'),
      '--out', resolve(root, 'report.json'),
    ], { encoding: 'utf8' });
    assert.notEqual(child.status, 0);
    assert.match(child.stderr, /did not attest the paired release lane/);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test('native performance collector rejects receipts from a different host', () => {
  const root = mkdtempSync(resolve(tmpdir(), 'partitime-native-performance-host-test-'));
  try {
    const sample = {
      definitionVersion: 'partitime.native-launch-stage.v2',
      lane: releaseLane,
      hermesEvaluationMs: 10,
      startupAssetWeightBytes: 100,
      coldLaunchMs: 20,
      firstAuthoritativeDataMs: 30,
    };
    writeFixture(root, sample, { ...sample, candidateObserver });
    const exactPath = resolve(root, 'exact.json');
    const exact = JSON.parse(readFileSync(exactPath, 'utf8'));
    exact.environment = { os: 'darwin-test', machine: 'other-fixture' };
    writeFileSync(exactPath, `${JSON.stringify(exact)}\n`);
    const child = spawnSync(process.execPath, [
      collector,
      '--quick',
      '--inputs', resolve(root, 'inputs.json'),
      '--out', resolve(root, 'report.json'),
    ], { encoding: 'utf8' });
    assert.notEqual(child.status, 0);
    assert.match(child.stderr, /Exact receipt host identity differs/);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

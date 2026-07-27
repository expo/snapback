#!/usr/bin/env node

import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { dirname, relative, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

import { writeMachineReport } from '../../../_kit/harness.mjs';

// @ref LLP 0063#workstream-8--performance-and-packaging-budgets — Native
// costs remain nonclaims until same-host React Expo and Exact + Contract iOS
// sample receipts satisfy the dated amendment and an independent holdout.

const here = dirname(fileURLToPath(import.meta.url));
const repoRoot = resolve(here, '../../../..');
const demoRoot = resolve(here, '../..');
const amendmentPath = resolve(demoRoot, 'acceptance/performance-amendment.2026-07-21.json');
const amendment = JSON.parse(readFileSync(amendmentPath, 'utf8'));
const invalidationPath = resolve(
  demoRoot,
  'acceptance/native-performance-invalidation-amendment.2026-07-22.json',
);
const invalidation = JSON.parse(readFileSync(invalidationPath, 'utf8'));
const observerAmendmentPath = resolve(
  demoRoot,
  'acceptance/native-performance-observer-amendment.2026-07-23.json',
);
const observerAmendment = JSON.parse(readFileSync(observerAmendmentPath, 'utf8'));
const option = (name) => {
  const at = process.argv.indexOf(`--${name}`);
  return at < 0 ? null : process.argv[at + 1];
};
const flag = (name) => process.argv.includes(`--${name}`);
const quick = flag('quick');
const validateOnly = flag('validate-only');
const cohort = option('cohort') ?? 'calibration';
assert(['calibration', 'holdout'].includes(cohort), '--cohort must be calibration or holdout');
const output = resolve(option('out') ?? resolve(
  demoRoot,
  `acceptance/results/step4-native-performance-${cohort}.json`,
));
const calibrationRevision = option('calibration-revision');
if (cohort === 'holdout' && !quick) {
  assert.match(calibrationRevision ?? '', /^[a-f0-9]{40}$/, 'holdout requires --calibration-revision <committed sha>');
}
if (!quick || validateOnly) {
  assert.equal(amendment.status, 'ratified', 'performance amendment must be ratified before claim-eligible sampling');
  assert.equal(
    invalidation.status,
    'ratified',
    'native lane invalidation amendment must be ratified before claim-eligible sampling',
  );
  assert.equal(
    observerAmendment.status,
    'ratified',
    'native performance observer amendment must be ratified before claim-eligible sampling',
  );
}
if (validateOnly) {
  process.stdout.write(`${JSON.stringify({
    schemaVersion: 'partitime.step4-native-performance-validator.v1',
    ok: true,
    amendmentId: amendment.amendmentId,
    amendmentStatus: amendment.status,
    invalidationId: invalidation.amendmentId,
    invalidationStatus: invalidation.status,
    observerAmendmentId: observerAmendment.amendmentId,
    observerAmendmentStatus: observerAmendment.status,
    methodId: invalidation.replacement.methodId,
    thresholdSetId: invalidation.replacement.thresholdSetId,
    laneId: invalidation.replacement.laneId,
    observerId: observerAmendment.observer.id,
  })}\n`);
  process.exit(0);
}

const inputPath = resolve(option('inputs') ?? '');
assert(option('inputs'), '--inputs <native sample manifest> is required');
const input = JSON.parse(readFileSync(inputPath, 'utf8'));
assert.equal(input.schemaVersion, 'partitime.native-performance-inputs.v1');
assert.equal(input.platform, 'ios');
assert.deepEqual(input.hostIdentity, input.react.hostIdentity, 'React samples were not captured on the declared host');
assert.deepEqual(input.hostIdentity, input.exact.hostIdentity, 'Exact samples were not captured on the declared host');
const warmups = quick ? 0 : amendment.sampling.warmups;
const sampleCount = quick ? 1 : amendment.sampling[`${cohort}Samples`];
const requiredReceipts = warmups + sampleCount;

const reactRaw = loadReceipts(input.react.receipts, 'react-expo:ios:snapback');
const exactRaw = loadReceipts(input.exact.receipts, 'exact-contract:ios:snapback');
assert.equal(reactRaw.length, requiredReceipts, `React receipt count must be ${requiredReceipts}`);
assert.equal(exactRaw.length, requiredReceipts, `Exact receipt count must be ${requiredReceipts}`);
for (const { receipt } of reactRaw) {
  assert.deepEqual(
    receipt.environment,
    input.hostIdentity,
    'React receipt host identity differs from the declared paired host',
  );
}
for (const { receipt } of exactRaw) {
  assert.deepEqual(
    receipt.environment,
    input.hostIdentity,
    'Exact receipt host identity differs from the declared paired host',
  );
}
const reactSamples = reactRaw.map(extractReactSample).slice(warmups);
const exactSamples = exactRaw.map(extractExactSample).slice(warmups);
const cells = {
  'react-expo:ios:snapback': summarizeSamples(reactSamples),
  'exact-contract:ios:snapback': summarizeSamples(exactSamples),
};
const thresholds = cohort === 'calibration'
  ? Object.fromEntries(Object.entries(cells['react-expo:ios:snapback'].aggregate).map(([metric, value]) => [
      metric,
      Math.floor(value.p95 * 1.10),
    ]))
  : null;
const holdoutValidation = cohort === 'holdout' && !quick
  ? validateHoldout(calibrationRevision, cells['exact-contract:ios:snapback'].aggregate)
  : null;
const sourceReceipts = {
  react: identities(input.react.receipts),
  exact: identities(input.exact.receipts),
};
const claimEligible = !quick
  && reactSamples.length === sampleCount
  && exactSamples.length === sampleCount
  && sourceReceipts.react.every(({ repositoryClean }) => repositoryClean)
  && sourceReceipts.exact.every(({ repositoryClean }) => repositoryClean);

const report = {
  schemaVersion: 'partitime.step4-native-performance.v1',
  claimId: 'STEP4.BUDGETS.NATIVE_PERFORMANCE',
  methodId: invalidation.replacement.methodId,
  thresholdSetId: invalidation.replacement.thresholdSetId,
  laneId: invalidation.replacement.laneId,
  cohort,
  quick,
  claimEligible,
  recordedAt: new Date().toISOString(),
  amendment: identity(amendmentPath),
  sampling: { warmups, samples: sampleCount, outlierPolicy: amendment.sampling.outlierPolicy },
  invalidation: identity(invalidationPath),
  observerAmendment: identity(observerAmendmentPath),
  platform: 'ios',
  hostIdentity: input.hostIdentity,
  sourceReceipts,
  cells,
  thresholds,
  holdoutValidation,
};
report.ok = claimEligible && (cohort === 'calibration' ? Object.keys(thresholds).length === 4 : holdoutValidation?.ok === true);
report.outcome = report.ok ? 'pass' : 'red';
writeMachineReport(relative(repoRoot, output), report);
console.log(JSON.stringify(report));

function loadReceipts(paths, expectedCell) {
  assert(Array.isArray(paths), `${expectedCell} receipt list is missing`);
  return paths.map((path) => {
    const absolute = resolve(dirname(inputPath), path);
    const receipt = JSON.parse(readFileSync(absolute, 'utf8'));
    return { path: absolute, receipt, expectedCell };
  });
}

function extractReactSample({ receipt, expectedCell }) {
  assert.equal(receipt.profileId, 'react-expo/ios', `${expectedCell} profile drifted`);
  assert.equal(receipt.ok, true, `${expectedCell} raw receipt is not green`);
  const measured = receipt.performance?.sample;
  assert(measured, `${expectedCell} lacks performance.sample; rerun native-react-expo.mjs with --performance-only`);
  validateLane(measured, expectedCell, 'react');
  return finiteMetrics(measured, expectedCell);
}

function extractExactSample({ receipt, expectedCell }) {
  assert.equal(receipt.ok, true, `${expectedCell} raw receipt is not green`);
  assert.equal(
    receipt.observer?.id,
    observerAmendment.observer.id,
    `${expectedCell} raw receipt omitted the registered observer`,
  );
  assert.equal(
    receipt.observer?.build?.featureBound,
    true,
    `${expectedCell} runtime archive stamp did not bind the observer feature`,
  );
  const direct = receipt.performance?.sample;
  if (direct) {
    validateLane(direct, expectedCell, 'exact');
    return finiteMetrics(direct, expectedCell);
  }
  assert.equal(
    quick,
    true,
    `${expectedCell} claim sampling requires a direct v2 release-lane performance sample`,
  );
  const cell = receipt.cells?.find(({ cell: id }) => id === 'exact-contract:ios:snapback');
  const load = cell?.acto?.receipt?.target?.hostStatus?.load;
  const launchRequestedAtMs = cell?.launch?.requestedAtMs;
  assert(load && Number.isFinite(launchRequestedAtMs), `${expectedCell} lacks launch/load stages`);
  const firstFrameAtMs = Date.parse(load.firstAppFrameAt ?? load.finishedAt);
  assert(Number.isFinite(firstFrameAtMs), `${expectedCell} lacks a first-frame timestamp`);
  return finiteMetrics({
    hermesEvaluationMs: load.stages?.evaluateMs,
    startupAssetWeightBytes: load.scriptBytes,
    coldLaunchMs: firstFrameAtMs - launchRequestedAtMs,
    firstAuthoritativeDataMs: Date.parse(load.finishedAt) - launchRequestedAtMs,
  }, expectedCell);
}

function validateLane(sample, label, framework) {
  if (quick && sample.definitionVersion === 'partitime.native-launch-stage.v1') {
    return;
  }
  assert.equal(sample.definitionVersion, invalidation.replacement.methodId, `${label} method drifted`);
  assert.deepEqual(sample.lane, {
    laneId: invalidation.replacement.laneId,
    buildConfiguration: 'Release',
    simulatorBuild: true,
    artifactMode: 'hermes-hbc',
    agentLoadedBeforeFirstFrame: false,
    debugOverlayEnabled: false,
    firstFrameObserver: 'native-host',
    authoritativeDataObserver: 'structured-product-marker',
  }, `${label} did not attest the paired release lane`);
  if (framework === 'react') {
    assert.equal(
      sample.candidateObserver,
      undefined,
      `${label} control unexpectedly claimed the Exact-only observer`,
    );
    return;
  }
  assert.equal(
    sample.candidateObserver?.id,
    observerAmendment.observer.id,
    `${label} did not identify the registered observer`,
  );
  assert.equal(
    sample.candidateObserver?.targetAdvertisementSubstituted,
    true,
    `${label} hid the target-advertisement substitution`,
  );
  assert.equal(
    sample.candidateObserver?.rootLoopbackFetchSubstituted,
    true,
    `${label} hid the root loopback-fetch substitution`,
  );
  assert.equal(
    sample.candidateObserver?.ordinaryAbiPreserved,
    true,
    `${label} used an unregistered construction ABI`,
  );
  assert.deepEqual(sample.candidateObserver?.runtimeMarkers, {
    ibexAuthenticatedSubstitution: true,
    ibexLoopbackFetchSubstituted: true,
    ibexPostureVerified: true,
    exactObserverEnabled: true,
    exactObserverRuntimeCreated: true,
    exactCarrierDispatchInstalled: true,
  }, `${label} omitted an observer runtime marker`);
  assert.equal(
    sample.candidateObserver?.diagnosticRuntimeObserved,
    false,
    `${label} used the diagnostic runtime`,
  );
  assert.equal(
    sample.candidateObserver?.agentObservedBeforeFirstFrame,
    false,
    `${label} loaded the agent before first frame`,
  );
}

function finiteMetrics(value, label) {
  const names = ['hermesEvaluationMs', 'startupAssetWeightBytes', 'coldLaunchMs', 'firstAuthoritativeDataMs'];
  const result = {};
  for (const name of names) {
    assert(Number.isFinite(value[name]) && value[name] >= 0, `${label} has invalid ${name}: ${value[name]}`);
    result[name] = value[name];
  }
  return result;
}

function summarizeSamples(samples) {
  assert.equal(samples.length, sampleCount);
  return {
    samples,
    aggregate: Object.fromEntries(Object.keys(samples[0]).map((metric) => [
      metric,
      aggregate(samples.map((sample) => sample[metric])),
    ])),
  };
}

function aggregate(values) {
  const ordered = [...values].sort((left, right) => left - right);
  return {
    samples: values,
    median: ordered[Math.ceil(ordered.length * 0.5) - 1],
    p95: ordered[Math.ceil(ordered.length * 0.95) - 1],
  };
}

function validateHoldout(revision, aggregateValues) {
  const calibrationPath = amendment.holdoutValidation.nativeCalibrationArtifact;
  const shown = spawnSync('git', ['show', `${revision}:${calibrationPath}`], {
    cwd: repoRoot,
    encoding: 'utf8',
  });
  assert.equal(shown.status, 0, `cannot read committed native calibration ${revision}:${calibrationPath}`);
  const calibration = JSON.parse(shown.stdout);
  assert.equal(calibration.cohort, 'calibration');
  assert.equal(calibration.claimEligible, true);
  assert.deepEqual(calibration.amendment, identity(amendmentPath));
  assert.deepEqual(calibration.invalidation, identity(invalidationPath));
  assert.deepEqual(calibration.observerAmendment, identity(observerAmendmentPath));
  assert.equal(calibration.methodId, invalidation.replacement.methodId);
  assert.equal(calibration.thresholdSetId, invalidation.replacement.thresholdSetId);
  assert.equal(calibration.laneId, invalidation.replacement.laneId);
  const rows = Object.entries(calibration.thresholds).map(([metricName, threshold]) => {
    const actualP95 = aggregateValues[metricName]?.p95;
    return {
      cell: 'exact-contract:ios:snapback',
      metricName,
      actualP95: actualP95 ?? null,
      threshold,
      pass: Number.isFinite(actualP95) && actualP95 <= threshold,
    };
  });
  return {
    calibration: { revision, path: calibrationPath, sha256: sha256(shown.stdout) },
    rows,
    ok: rows.length === 4 && rows.every(({ pass }) => pass),
  };
}

function identities(paths) {
  return paths.map((path) => {
    const absolute = resolve(dirname(inputPath), path);
    const receipt = JSON.parse(readFileSync(absolute, 'utf8'));
    const clean = receipt.repository?.sourceDirty === false
      || receipt.source?.snapback?.dirty === false && receipt.source?.exact?.dirty === false;
    return { ...identity(absolute), repositoryClean: clean };
  });
}

function identity(path) {
  return { path: relative(repoRoot, path), sha256: sha256(readFileSync(path)) };
}

function sha256(value) {
  return createHash('sha256').update(value).digest('hex');
}

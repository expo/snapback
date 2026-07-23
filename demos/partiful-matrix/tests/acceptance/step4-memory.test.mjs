import assert from 'node:assert/strict';
import test from 'node:test';

import {
  deriveMemoryCalibrationThresholds,
  fitMarginalHeap,
  validateMemoryHoldout,
} from './step4-memory.mjs';

test('fits an intercept-bearing marginal heap slope and upper bound', () => {
  const observations = [];
  for (let round = 0; round < 7; round += 1) {
    for (const count of [1, 8, 32, 64]) {
      observations.push({
        count,
        usedSizeBytes: 1_000_000 + (count * 2048) + (round - 3) * 10,
      });
    }
  }
  const fit = fitMarginalHeap(observations);
  assert.equal(fit.observationCount, 28);
  assert.equal(fit.degreesOfFreedom, 26);
  assert(Math.abs(fit.interceptBytes - 1_000_000) < 1);
  assert(Math.abs(fit.slopeBytesPerLogicalSubscription - 2048) < 1);
  assert(fit.upper95BytesPerLogicalSubscription >= fit.slopeBytesPerLogicalSubscription);
});

test('derives Contract targets only from same-backend React cells', () => {
  const cells = {};
  for (const [index, backend] of ['snapback', 'supabase', 'convex', 'sqlite'].entries()) {
    cells[`react:${backend}`] = {
      total: { p95: 1_000_000 + index },
      marginal: { fit: { upper95BytesPerLogicalSubscription: 2000 + index } },
    };
    cells[`contract:${backend}`] = {
      total: { p95: 99_000_000 },
      marginal: { fit: { upper95BytesPerLogicalSubscription: 99_000_000 } },
    };
  }
  const thresholds = deriveMemoryCalibrationThresholds(cells);
  assert.deepEqual(thresholds['contract:snapback'], {
    sourceCell: 'react:snapback',
    warmHeapTotalBytesP95: 1_100_000,
    marginalHeapBytesPerLogicalSubscriptionUpper95: 4096,
  });
});

test('holdout requires both memory dimensions in every Contract cell', () => {
  const cells = {};
  const thresholds = {};
  for (const backend of ['snapback', 'supabase', 'convex', 'sqlite']) {
    cells[`contract:${backend}`] = {
      total: { p95: 1000 },
      marginal: { fit: { upper95BytesPerLogicalSubscription: 100 } },
    };
    thresholds[`contract:${backend}`] = {
      warmHeapTotalBytesP95: 1100,
      marginalHeapBytesPerLogicalSubscriptionUpper95: 110,
    };
  }
  const amendment = { path: 'authority.json', sha256: 'a'.repeat(64) };
  const calibration = {
    schemaVersion: 'partitime.step4-memory-v2.v1',
    cohort: 'calibration',
    claimEligible: true,
    quick: false,
    amendment,
    methodId: 'partitime-ws8-memory-v2',
    workloadVersion: 'partitime.web-memory-fit.v2',
    thresholdSetId: `partitime-ws8-memory-thresholds-v2-sha256-${'c'.repeat(16)}`,
    sampling: {
      counts: [1, 8, 32, 64],
      samplesPerCount: 7,
    },
    thresholds,
  };
  const result = validateMemoryHoldout({
    repoRoot: '.',
    calibrationRevision: 'b'.repeat(40),
    calibrationPath: 'calibration.json',
    amendmentIdentity: amendment,
    cells,
    readCommitted: () => `${JSON.stringify(calibration)}\n`,
  });
  assert.equal(result.rows.length, 8);
  assert.equal(result.ok, true);

  cells['contract:sqlite'].marginal.fit.upper95BytesPerLogicalSubscription = 111;
  const failed = validateMemoryHoldout({
    repoRoot: '.',
    calibrationRevision: 'b'.repeat(40),
    calibrationPath: 'calibration.json',
    amendmentIdentity: amendment,
    cells,
    readCommitted: () => `${JSON.stringify(calibration)}\n`,
  });
  assert.equal(failed.ok, false);
  assert.equal(
    failed.rows.find(({ cell, metricName }) =>
      cell === 'contract:sqlite'
      && metricName === 'marginalHeapBytesPerLogicalSubscriptionUpper95')?.pass,
    false,
  );
});

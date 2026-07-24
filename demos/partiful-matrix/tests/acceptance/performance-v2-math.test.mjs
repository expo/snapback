import { describe, expect, test } from 'bun:test';

import {
  aggregateMetricValues,
  canonicalizeJson,
  cycleMetricValues,
  deriveTargets,
  fitNonnegativeLeastSquares,
  metricVerdicts,
  nearestRankP95,
  thresholdIdentityPayload,
  thresholdSetId,
} from './performance-v2-math.mjs';

const observations = (intercept = 1000, slope = 25) => [0, 1, 2, 4, 8, 16, 32].map(
  (activeSubscriptions) => ({
    activeSubscriptions,
    usedSizeBytes: intercept + slope * activeSubscriptions,
    ...(activeSubscriptions === 8 ? { deliveryCallbacks: 8, domPatchRecords: 6 } : {}),
  }),
);

describe('Partitime performance v2 frozen arithmetic', () => {
  test('nearest-rank p95 over seven samples is the retained maximum', () => {
    expect(nearestRankP95([5, 1, 7, 2, 6, 3, 4])).toBe(7);
  });

  test('nonnegative regression recovers an ordinary positive line', () => {
    const fit = fitNonnegativeLeastSquares(observations());
    expect(fit.selectedCandidate).toBe('unconstrained');
    expect(fit.interceptBytes).toBeCloseTo(1000);
    expect(fit.slopeBytesPerSubscription).toBeCloseTo(25);
    expect(fit.sse).toBeCloseTo(0);
  });

  test('nonnegative regression chooses a boundary when OLS has a negative slope', () => {
    const fit = fitNonnegativeLeastSquares(observations(2000, -10));
    expect(fit.selectedCandidate).toBe('slope-zero');
    expect(fit.slopeBytesPerSubscription).toBe(0);
    expect(fit.interceptBytes).toBeGreaterThan(0);
  });

  test('cycle metrics use canonical count and ceil fitted coefficients', () => {
    const noisy = observations(1000.1, 25.1).map((observation) => ({
      ...observation,
      usedSizeBytes: Math.round(observation.usedSizeBytes),
    }));
    noisy.find(({ activeSubscriptions }) => activeSubscriptions === 8).deliveryCallbacks = 9;
    const result = cycleMetricValues(noisy);
    expect(result.metrics).toEqual({
      totalWarmJsHeapBytesP95: noisy.find(({ activeSubscriptions }) => activeSubscriptions === 8).usedSizeBytes,
      fixedWarmJsHeapBytesP95: 1001,
      memoryPerActiveSubscriptionBytesP95: 26,
      updateFanoutCountP95: 9,
      domPatchCountP95: 6,
    });
  });

  test('aggregate rejects warmups and computes all five p95 values', () => {
    const cycles = Array.from({ length: 7 }, (_, index) => ({
      valid: true,
      cycle: {
        warmup: false,
        metrics: {
          totalWarmJsHeapBytesP95: 100 + index,
          fixedWarmJsHeapBytesP95: 90 + index,
          memoryPerActiveSubscriptionBytesP95: 10 + index,
          updateFanoutCountP95: 8,
          domPatchCountP95: 6 + index,
        },
      },
    }));
    expect(aggregateMetricValues(cycles)).toEqual({
      totalWarmJsHeapBytesP95: 106,
      fixedWarmJsHeapBytesP95: 96,
      memoryPerActiveSubscriptionBytesP95: 16,
      updateFanoutCountP95: 8,
      domPatchCountP95: 12,
    });
    cycles[0].cycle.warmup = true;
    expect(() => aggregateMetricValues(cycles)).toThrow('warmup cannot enter aggregation');
  });

  test('targets are floored at the frozen 110/100 comparator margin', () => {
    expect(deriveTargets({
      totalWarmJsHeapBytesP95: 101,
      fixedWarmJsHeapBytesP95: 201,
      memoryPerActiveSubscriptionBytesP95: 11,
      updateFanoutCountP95: 8,
      domPatchCountP95: 9,
    })).toEqual({
      totalWarmJsHeapBytesP95: 111,
      fixedWarmJsHeapBytesP95: 221,
      memoryPerActiveSubscriptionBytesP95: 12,
      updateFanoutCountP95: 8,
      domPatchCountP95: 9,
    });
  });

  test('canonical threshold identity is order-independent and excludes judged inputs', () => {
    const dependency = {
      kind: 'react-comparator',
      path: 'results/react-cycle-1.json',
      sha256: 'a'.repeat(64),
      arm: 'react:snapback',
    };
    const comparatorMetrics = {
      totalWarmJsHeapBytesP95: 100,
      fixedWarmJsHeapBytesP95: 90,
      memoryPerActiveSubscriptionBytesP95: 10,
      updateFanoutCountP95: 8,
      domPatchCountP95: 6,
    };
    const payload = thresholdIdentityPayload({
      protocolId: 'partitime-method-rubric-v2',
      workloadVersion: 'partitime.web-3x4+apple-native-2x2x4.v2',
      thresholdFormulaSetId: 'partitime-threshold-formulas-v2',
      comparatorReceiptDependencies: [dependency],
      comparatorMetrics,
      targets: deriveTargets(comparatorMetrics),
    });
    expect(canonicalizeJson({ b: 2, a: 1 })).toBe('{"a":1,"b":2}');
    expect(thresholdSetId(payload)).toMatch(/^partitime-thresholds-v2-sha256-[a-f0-9]{16}$/);
    expect(() => thresholdIdentityPayload({
      ...payload,
      comparatorReceiptDependencies: [{
        ...dependency,
        kind: 'contract-holdout',
        arm: 'contract:snapback',
      }],
    })).toThrow('threshold dependencies must all be React comparator receipts');
  });

  test('verdicts remain conjunctive', () => {
    const targets = {
      totalWarmJsHeapBytesP95: 100,
      fixedWarmJsHeapBytesP95: 100,
      memoryPerActiveSubscriptionBytesP95: 10,
      updateFanoutCountP95: 8,
      domPatchCountP95: 8,
    };
    const verdicts = metricVerdicts({ ...targets, domPatchCountP95: 9 }, targets);
    expect(verdicts.filter(({ pass }) => !pass).map(({ id }) => id)).toEqual(['domPatchCountP95']);
  });
});

import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';

// @ref LLP 0063#amendment-a1-2026-07-24--prospective-partitime-v2-correctness-baseline-reset
// — deterministic, shared arithmetic for the frozen v2 collector, threshold
// derivation, and aggregate. This module performs no measurement.

export const METRIC_IDS = Object.freeze([
  'totalWarmJsHeapBytesP95',
  'fixedWarmJsHeapBytesP95',
  'memoryPerActiveSubscriptionBytesP95',
  'updateFanoutCountP95',
  'domPatchCountP95',
]);

const finiteNonnegative = (value, label) => {
  assert.ok(Number.isFinite(value) && value >= 0, `${label} must be finite and nonnegative`);
  return value;
};

export function nearestRankP95(values) {
  assert.ok(Array.isArray(values) && values.length > 0, 'p95 requires at least one value');
  const sorted = values.map((value, index) => finiteNonnegative(value, `p95 value ${index}`))
    .sort((left, right) => left - right);
  return sorted[Math.ceil(0.95 * sorted.length) - 1];
}

const squaredError = (points, intercept, slope) => points.reduce((sum, { x, y }) => {
  const residual = y - (intercept + slope * x);
  return sum + residual * residual;
}, 0);

/**
 * Exact protocol algorithm: solve y = intercept + slope*x with both
 * coefficients nonnegative by enumerating the unconstrained solution and the
 * two boundary solutions. Minimum SSE wins; ties prefer lower slope, then
 * lower intercept.
 */
export function fitNonnegativeLeastSquares(observations) {
  assert.ok(Array.isArray(observations) && observations.length >= 2, 'regression requires observations');
  const points = observations.map(({ activeSubscriptions, usedSizeBytes }, index) => ({
    x: finiteNonnegative(activeSubscriptions, `observation ${index} activeSubscriptions`),
    y: finiteNonnegative(usedSizeBytes, `observation ${index} usedSizeBytes`),
  }));
  const meanX = points.reduce((sum, { x }) => sum + x, 0) / points.length;
  const meanY = points.reduce((sum, { y }) => sum + y, 0) / points.length;
  const centeredXX = points.reduce((sum, { x }) => sum + (x - meanX) ** 2, 0);
  assert.ok(centeredXX > 0, 'regression subscription counts must vary');
  const centeredXY = points.reduce((sum, { x, y }) => sum + (x - meanX) * (y - meanY), 0);

  const candidates = [];
  const unconstrainedSlope = centeredXY / centeredXX;
  const unconstrainedIntercept = meanY - unconstrainedSlope * meanX;
  if (unconstrainedSlope >= 0 && unconstrainedIntercept >= 0) {
    candidates.push({
      selectedCandidate: 'unconstrained',
      interceptBytes: unconstrainedIntercept,
      slopeBytesPerSubscription: unconstrainedSlope,
    });
  }

  const sumXX = points.reduce((sum, { x }) => sum + x * x, 0);
  const sumXY = points.reduce((sum, { x, y }) => sum + x * y, 0);
  candidates.push({
    selectedCandidate: 'intercept-zero',
    interceptBytes: 0,
    slopeBytesPerSubscription: sumXX === 0 ? 0 : Math.max(0, sumXY / sumXX),
  });
  candidates.push({
    selectedCandidate: 'slope-zero',
    interceptBytes: Math.max(0, meanY),
    slopeBytesPerSubscription: 0,
  });

  for (const candidate of candidates) {
    candidate.sse = squaredError(
      points,
      candidate.interceptBytes,
      candidate.slopeBytesPerSubscription,
    );
  }
  candidates.sort((left, right) => left.sse - right.sse
    || left.slopeBytesPerSubscription - right.slopeBytesPerSubscription
    || left.interceptBytes - right.interceptBytes);
  return candidates[0];
}

export function cycleMetricValues(observations) {
  assert.equal(observations.length, 7, 'a valid cycle contains seven observations');
  const canonical = observations.filter(({ activeSubscriptions }) => activeSubscriptions === 8);
  assert.equal(canonical.length, 1, 'a valid cycle contains exactly one canonical-count observation');
  const canonicalObservation = canonical[0];
  for (const field of ['usedSizeBytes', 'deliveryCallbacks', 'domPatchRecords']) {
    assert.ok(
      Number.isInteger(canonicalObservation[field]) && canonicalObservation[field] >= 0,
      `canonical observation ${field} must be a nonnegative integer`,
    );
  }
  const regression = fitNonnegativeLeastSquares(observations);
  return {
    regression,
    metrics: {
      totalWarmJsHeapBytesP95: canonicalObservation.usedSizeBytes,
      fixedWarmJsHeapBytesP95: Math.ceil(regression.interceptBytes),
      memoryPerActiveSubscriptionBytesP95: Math.ceil(regression.slopeBytesPerSubscription),
      updateFanoutCountP95: canonicalObservation.deliveryCallbacks,
      domPatchCountP95: canonicalObservation.domPatchRecords,
    },
  };
}

export function aggregateMetricValues(cycles) {
  assert.equal(cycles.length, 7, 'aggregate requires seven retained valid sample cycles');
  return Object.fromEntries(METRIC_IDS.map((id) => [
    id,
    nearestRankP95(cycles.map((cycle) => {
      assert.equal(cycle.valid, true, 'invalid cycle cannot enter aggregation');
      assert.equal(cycle.cycle.warmup, false, 'warmup cannot enter aggregation');
      return cycle.cycle.metrics[id];
    })),
  ]));
}

export function deriveTargets(comparatorMetrics, numerator = 110, denominator = 100) {
  assert.equal(numerator, 110);
  assert.equal(denominator, 100);
  return Object.fromEntries(METRIC_IDS.map((id) => {
    const value = comparatorMetrics[id];
    assert.ok(Number.isInteger(value) && value >= 0, `${id} comparator must be a nonnegative integer`);
    return [id, Math.floor(value * numerator / denominator)];
  }));
}

/**
 * RFC 8785's JSON data model uses ECMAScript number serialization and
 * recursively sorted object property names. The receipt payload excludes
 * undefined/non-finite values before reaching this function.
 */
export function canonicalizeJson(value) {
  if (value === null || typeof value === 'boolean' || typeof value === 'string') {
    return JSON.stringify(value);
  }
  if (typeof value === 'number') {
    assert.ok(Number.isFinite(value), 'canonical JSON forbids non-finite numbers');
    return JSON.stringify(value);
  }
  if (Array.isArray(value)) {
    return `[${value.map(canonicalizeJson).join(',')}]`;
  }
  assert.equal(typeof value, 'object', 'canonical JSON accepts only JSON values');
  const keys = Object.keys(value).sort();
  return `{${keys.map((key) => `${JSON.stringify(key)}:${canonicalizeJson(value[key])}`).join(',')}}`;
}

export function thresholdIdentityPayload({
  protocolId,
  workloadVersion,
  thresholdFormulaSetId,
  comparatorReceiptDependencies,
  comparatorMetrics,
  targets,
}) {
  assert.ok(
    comparatorReceiptDependencies.every(({ kind }) => kind === 'react-comparator'),
    'threshold dependencies must all be React comparator receipts',
  );
  for (const dependency of comparatorReceiptDependencies) {
    assert.equal(dependency.arm, 'react:snapback');
    assert.match(dependency.sha256, /^[a-f0-9]{64}$/);
  }
  return {
    protocolId,
    workloadVersion,
    thresholdFormulaSetId,
    comparatorReceiptDependencies,
    comparatorMetrics,
    targets,
  };
}

export function thresholdSetId(payload) {
  const digest = createHash('sha256').update(canonicalizeJson(payload), 'utf8').digest('hex');
  return `partitime-thresholds-v2-sha256-${digest.slice(0, 16)}`;
}

export function metricVerdicts(actual, targets) {
  return METRIC_IDS.map((id) => ({
    id,
    actual: actual[id],
    target: targets[id],
    pass: actual[id] <= targets[id],
  }));
}

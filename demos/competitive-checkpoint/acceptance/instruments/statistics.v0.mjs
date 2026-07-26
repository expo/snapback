// Candidate LLP 0075 statistics implementation. Its digest must be ratified
// by a dated protocol amendment before any timed sample may use it.

export const STATISTICS_IMPLEMENTATION_ID =
  'snapback.convex-checkpoint-statistics.candidate.v0';
export const DEFAULT_BOOTSTRAP_RESAMPLES = 10_000;
export const DEFAULT_BOOTSTRAP_SEED = 0x0075_0003;

function samples(values, label, { strictlyPositive = false } = {}) {
  if (!Array.isArray(values) || values.length === 0) {
    throw new TypeError(`${label} must be a non-empty array`);
  }
  return values.map((value, index) => {
    if (
      typeof value !== 'number'
      || !Number.isFinite(value)
      || value < 0
      || (strictlyPositive && value === 0)
    ) {
      throw new TypeError(
        `${label}[${index}] must be a finite ${strictlyPositive ? 'positive' : 'non-negative'} number`,
      );
    }
    return value;
  });
}

export function median(values) {
  const ordered = samples(values, 'median values').toSorted((left, right) => left - right);
  const middle = Math.floor(ordered.length / 2);
  return ordered.length % 2 === 1
    ? ordered[middle]
    : (ordered[middle - 1] + ordered[middle]) / 2;
}

export function nearestRankPercentile(values, probability) {
  const ordered = samples(values, 'percentile values').toSorted((left, right) => left - right);
  if (
    typeof probability !== 'number'
    || !Number.isFinite(probability)
    || probability <= 0
    || probability > 1
  ) {
    throw new TypeError('nearest-rank probability must be in (0, 1]');
  }
  return ordered[Math.ceil(probability * ordered.length) - 1];
}

function type7Percentile(ordered, probability) {
  if (ordered.length === 1) return ordered[0];
  const position = (ordered.length - 1) * probability;
  const lower = Math.floor(position);
  const upper = Math.ceil(position);
  if (lower === upper) return ordered[lower];
  const weight = position - lower;
  return ordered[lower] + (ordered[upper] - ordered[lower]) * weight;
}

class XorShift32 {
  constructor(seed) {
    if (!Number.isSafeInteger(seed) || seed < 1 || seed > 0xffff_ffff) {
      throw new TypeError('bootstrap seed must be an integer in [1, 2^32-1]');
    }
    this.state = seed >>> 0;
  }

  nextUint32() {
    let value = this.state;
    value ^= value << 13;
    value ^= value >>> 17;
    value ^= value << 5;
    this.state = value >>> 0;
    return this.state;
  }

  index(bound) {
    if (!Number.isSafeInteger(bound) || bound < 1 || bound > 0x1_0000_0000) {
      throw new TypeError('bootstrap sample bound must be in [1, 2^32]');
    }
    const range = 0x1_0000_0000;
    const limit = Math.floor(range / bound) * bound;
    let draw;
    do {
      draw = this.nextUint32();
    } while (draw >= limit);
    return draw % bound;
  }
}

function resampledMedian(values, random) {
  const draw = new Array(values.length);
  for (let index = 0; index < values.length; index += 1) {
    draw[index] = values[random.index(values.length)];
  }
  return median(draw);
}

function confidenceInterval(draws) {
  const ordered = draws.toSorted((left, right) => left - right);
  return {
    lower: type7Percentile(ordered, 0.025),
    upper: type7Percentile(ordered, 0.975),
    percentileMethod: 'type-7-linear',
    confidence: 0.95,
  };
}

export function summarizeArm(values) {
  const checked = samples(values, 'arm samples');
  return {
    count: checked.length,
    median: median(checked),
    p95: nearestRankPercentile(checked, 0.95),
  };
}

export function summarizeTwoArmMetric({
  convex,
  snapback,
  seed = DEFAULT_BOOTSTRAP_SEED,
  resamples = DEFAULT_BOOTSTRAP_RESAMPLES,
  ratio = false,
}) {
  const convexValues = samples(convex, 'convex samples', { strictlyPositive: ratio });
  const snapbackValues = samples(snapback, 'snapback samples');
  if (convexValues.length !== snapbackValues.length) {
    throw new TypeError('the two arms must retain the same number of valid samples');
  }
  if (!Number.isSafeInteger(resamples) || resamples < 1 || resamples > 1_000_000) {
    throw new TypeError('bootstrap resamples must be an integer in [1, 1000000]');
  }

  const random = new XorShift32(seed);
  const convexMedians = new Array(resamples);
  const snapbackMedians = new Array(resamples);
  const differences = new Array(resamples);
  const ratios = ratio ? new Array(resamples) : null;
  for (let iteration = 0; iteration < resamples; iteration += 1) {
    // Draw each arm independently. Alternating execution order does not make
    // observations paired, so no same-index bootstrap pairing is inferred.
    const convexMedian = resampledMedian(convexValues, random);
    const snapbackMedian = resampledMedian(snapbackValues, random);
    convexMedians[iteration] = convexMedian;
    snapbackMedians[iteration] = snapbackMedian;
    differences[iteration] = snapbackMedian - convexMedian;
    if (ratios) ratios[iteration] = snapbackMedian / convexMedian;
  }

  const convexSummary = summarizeArm(convexValues);
  const snapbackSummary = summarizeArm(snapbackValues);
  return {
    implementation: STATISTICS_IMPLEMENTATION_ID,
    seed,
    resamples,
    estimator: 'sample-median',
    p95Estimator: 'nearest-rank',
    convex: {
      ...convexSummary,
      medianBootstrap95Ci: confidenceInterval(convexMedians),
    },
    snapback: {
      ...snapbackSummary,
      medianBootstrap95Ci: confidenceInterval(snapbackMedians),
    },
    snapbackMinusConvex: {
      estimate: snapbackSummary.median - convexSummary.median,
      bootstrap95Ci: confidenceInterval(differences),
    },
    ...(ratios
      ? {
        snapbackDividedByConvex: {
          estimate: snapbackSummary.median / convexSummary.median,
          bootstrap95Ci: confidenceInterval(ratios),
        },
      }
      : {}),
  };
}

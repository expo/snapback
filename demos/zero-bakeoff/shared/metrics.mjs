import {performance} from 'node:perf_hooks';

export async function sample(label, fn, {warmups = 2, samples = 7} = {}) {
  for (let index = 0; index < warmups; index += 1) await fn();
  const values = [];
  for (let index = 0; index < samples; index += 1) {
    const started = performance.now();
    await fn();
    values.push(performance.now() - started);
  }
  const sorted = [...values].sort((a, b) => a - b);
  return {
    label,
    unit: 'ms',
    warmups,
    samples: values,
    median: sorted[Math.floor(sorted.length / 2)],
    p95NearestRank: sorted[Math.max(0, Math.ceil(sorted.length * 0.95) - 1)]
  };
}


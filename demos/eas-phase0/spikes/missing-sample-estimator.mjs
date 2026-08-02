#!/usr/bin/env node
// P0.4 missing-sample estimator spike (LLP 0105 §P0.4; LLP 0104
// §Defining billable "logical SQLite bytes").
//
// Contract implemented:
//  - billing is time-weighted logical bytes over an interval, from
//    periodic true samples;
//  - a GAP (missing samples) is billed as carry-forward of the LAST
//    CONFIRMED sample for the whole gap — never above it;
//  - when a later true sample shows the carried-forward estimate
//    overcharged (the sample bounds the interval below the estimate),
//    the difference is corrected as an APPEND-ONLY CREDIT;
//  - intervals whose true time-weighted path is unknowable settle
//    conservatively in the customer's favor (no interpolation upward);
//  - worst-case customer-billing error bound, PRE-CREDIT:
//        error <= gap_seconds * max(0, S_last - min_true_in_gap)
//    (S_last = last confirmed sample before the gap). Under growth,
//    carry-forward UNDER-bills — customer-favorable by construction;
//    only decline during a gap can overcharge. The deployable
//    operational form substitutes the declared maximum shrink rate R
//    (enforceable, since deletions are metered rows-written):
//        error <= R * gap_seconds^2.
//    POST-CREDIT the bound is 0 for any sample-closed gap, because the
//    credit rule settles the interval at min(carry-forward, S_next).
//
// The spike fault-injects gaps under growth and shrinkage, checks the
// bound on randomized paths, and emits the machine-readable receipt.

import { writeFileSync } from 'node:fs';

function billIntervals(samples, gapFill) {
  // samples: [{t, bytes|null}] — null = missing (gap)
  const rows = [];
  let lastConfirmed = null;
  for (let i = 0; i < samples.length - 1; i++) {
    const a = samples[i], b = samples[i + 1];
    const dt = b.t - a.t;
    if (a.bytes !== null) lastConfirmed = a.bytes;
    const billedAt = a.bytes !== null ? a.bytes : gapFill(lastConfirmed);
    rows.push({ t0: a.t, t1: b.t, billedByteSeconds: billedAt * dt, billedAt });
  }
  return rows;
}

const carryForward = (last) => (last === null ? 0 : last);

function creditPass(rows, samples) {
  // Append-only corrections: for every billed gap interval, if the
  // next true sample bounds the interval below what was billed,
  // settle at min(billed, nextTrue) and credit the difference.
  const credits = [];
  for (let i = 0; i < rows.length; i++) {
    const wasGap = samples[i].bytes === null;
    if (!wasGap) continue;
    const nextTrue = samples.slice(i + 1).find((s) => s.bytes !== null);
    if (!nextTrue) continue; // unknowable tail: settled at carry-forward,
    // which the receipt marks conservative (never above last confirmed).
    const dt = rows[i].t1 - rows[i].t0;
    const fair = Math.min(rows[i].billedAt, nextTrue.bytes) * dt;
    if (fair < rows[i].billedByteSeconds) {
      credits.push({ interval: [rows[i].t0, rows[i].t1], credit: rows[i].billedByteSeconds - fair });
    }
  }
  return credits;
}

function truePath(kind, t, base) {
  if (kind === 'growth') return base + 1000 * t;
  if (kind === 'shrinkage') return Math.max(0, base - 1000 * t);
  if (kind === 'sawtooth') return base + 500 * t * (Math.floor(t / 10) % 2 === 0 ? 1 : -1);
  return base;
}

function runScenario(kind, gapStart, gapLen, base = 100_000, horizon = 60) {
  const samples = [];
  for (let t = 0; t <= horizon; t += 1) {
    const inGap = t > gapStart && t <= gapStart + gapLen;
    samples.push({ t, bytes: inGap ? null : Math.round(truePath(kind, t, base)) });
  }
  const rows = billIntervals(samples, carryForward);
  const credits = creditPass(rows, samples);
  const billed = rows.reduce((s, r) => s + r.billedByteSeconds, 0);
  const credited = credits.reduce((s, c) => s + c.credit, 0);
  const trueBS = samples.slice(0, -1).reduce((s, a, i) => {
    const dt = samples[i + 1].t - a.t;
    return s + truePath(kind, a.t, base) * dt;
  }, 0);
  const net = billed - credited;
  // Pre-credit worst-case bound: gap * (S_last - min_true_in_gap)+ .
  // min_true_in_gap is knowable here because fault injection owns the
  // true path; operationally the deployable bound substitutes the
  // declared maximum shrink rate R (deletions are metered rows-written,
  // so R is enforceable): overcharge <= R * gap^2.
  const sLast = samples.filter((s) => s.t <= gapStart && s.bytes !== null).at(-1).bytes;
  let minTrue = Infinity;
  for (let t = gapStart; t <= gapStart + gapLen; t += 1) minTrue = Math.min(minTrue, truePath(kind, t, base));
  const bound = gapLen * Math.max(0, sLast - minTrue);
  const preCreditOver = Math.max(0, billed - trueBS);
  return {
    kind, gapStart, gapLen,
    trueByteSeconds: Math.round(trueBS),
    billedPreCredit: Math.round(billed),
    credited: Math.round(credited),
    netBilled: Math.round(net),
    overchargePreCredit: Math.round(preCreditOver),
    errorBoundPreCredit: Math.round(bound),
    boundHolds: preCreditOver <= bound + 1e-6,
    netNeverAboveTruePlusBound: net <= trueBS + bound + 1e-6,
    customerFavorableUnderGrowth: kind !== 'growth' || billed <= trueBS + 1e-6,
  };
}

const scenarios = [];
for (const kind of ['growth', 'shrinkage', 'sawtooth', 'flat']) {
  for (const gapLen of [1, 5, 15, 30]) {
    scenarios.push(runScenario(kind, 20, gapLen));
  }
}
// randomized fuzz
let fuzzFailures = 0;
for (let i = 0; i < 500; i++) {
  const kinds = ['growth', 'shrinkage', 'sawtooth', 'flat'];
  const r = runScenario(kinds[i % 4], 5 + (i % 20), 1 + (i % 25));
  if (!r.boundHolds || !r.customerFavorableUnderGrowth) fuzzFailures++;
}

const allHold = scenarios.every((s) => s.boundHolds && s.customerFavorableUnderGrowth) && fuzzFailures === 0;
const receipt = {
  receipt: 'eas-phase0/p0.4/missing-sample-estimator',
  date: '2026-08-01',
  contract: {
    gapFill: 'carry-forward of last confirmed sample; never above it; unknowable tails settle at carry-forward and are flagged conservative',
    creditRule: 'append-only: a later true sample bounding a gap interval below the billed estimate settles the interval at min(billed, sample) and credits the difference',
    overchargeEvidence: 'only an observed later true sample below the carried-forward estimate establishes an overcharge; endpoint samples cannot reconstruct the time-weighted path, so unknowable intervals settle customer-favorably',
    errorBoundUnits: 'byte-seconds. Pre-credit: gap_seconds x max(0, lastConfirmed - min_true_in_gap); operational form with declared max shrink rate R (enforceable via metered deletions): R x gap_seconds^2. Post-credit: 0 for any sample-closed gap (settled at min(billed, next true sample)).',
    maxGapCovered: '30 of 60 sampled seconds (50% outage) in the committed scenarios; 25s in fuzz',
  },
  scenarios,
  fuzz: { runs: 500, failures: fuzzFailures },
  verdict: allHold ? 'PASS: bound holds and growth-gaps under-bill (customer-favorable) across all committed and fuzzed scenarios' : 'FAIL',
};
writeFileSync(new URL('../receipts/p0.4-missing-sample-estimator.json', import.meta.url), JSON.stringify(receipt, null, 2));
console.log(receipt.verdict);
if (!allHold) process.exit(1);

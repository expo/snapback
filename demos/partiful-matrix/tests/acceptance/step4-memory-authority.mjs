#!/usr/bin/env node

// @ref LLP 0063#workstream-8--performance-and-packaging-budgets
// Fail-closed authority check for the Exact LLP 0381 two-part memory construct.

import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
const demoRoot = resolve(here, '../..');
const defaultAmendmentPath = resolve(
  demoRoot,
  'acceptance/memory-construct-amendment.2026-07-23.json',
);
const defaultProtocolPath = resolve(
  demoRoot,
  'acceptance/comparison-protocol.v1.json',
);

const EXPECTED_COUNTS = [1, 8, 32, 64];
const EXPECTED_CELLS = [
  'react:snapback',
  'react:supabase',
  'react:convex',
  'react:sqlite',
  'contract:snapback',
  'contract:supabase',
  'contract:convex',
  'contract:sqlite',
];
const REQUIRED_RATIFICATION_STATEMENT =
  'I ratify partitime-ws8-memory-construct-v2-2026-07-23.';

function readJson(path) {
  return JSON.parse(readFileSync(path, 'utf8'));
}

export function validateMemoryConstructAmendment(amendment) {
  assert.equal(
    amendment.schemaVersion,
    'partitime.memory-construct-amendment.v1',
    'memory amendment schema drifted',
  );
  assert.equal(
    amendment.amendmentId,
    'partitime-ws8-memory-construct-v2-2026-07-23',
    'memory amendment identity drifted',
  );
  assert(
    amendment.status === 'proposed' || amendment.status === 'ratified',
    'memory amendment status must be proposed or ratified',
  );
  assert.equal(
    amendment.requiredRatificationStatement,
    REQUIRED_RATIFICATION_STATEMENT,
    'memory amendment ratification statement drifted',
  );
  if (amendment.status === 'ratified') {
    assert.equal(amendment.ratifier, 'Charlie Cheever, as named by partitime.comparison-protocol.v1');
    assert.match(amendment.ratifiedAt ?? '', /^2026-\d\d-\d\d(?:T.*Z)?$/);
    assert.equal(
      amendment.ratificationStatement,
      REQUIRED_RATIFICATION_STATEMENT,
      'memory amendment must record the exact required ratification statement',
    );
  } else {
    assert.equal(amendment.ratifiedAt, null);
    assert.equal(amendment.ratificationStatement, null);
  }

  assert.equal(amendment.replacement.methodId, 'partitime-ws8-memory-v2');
  assert.equal(amendment.replacement.workloadVersion, 'partitime.web-memory-fit.v2');
  assert.equal(amendment.replacement.thresholdSetId, 'derived-at-calibration');
  assert.equal(amendment.replacement.claimId, 'STEP4.MEMORY_V2');
  assert.equal(amendment.construct.conjunctionRequired, true);
  assert.match(amendment.construct.total.definition, /ordinary product feed entry/);
  assert.equal(amendment.construct.total.judgedCellFeedsOwnThreshold, false);
  assert.equal(amendment.construct.marginal.judgedCellFeedsOwnThreshold, false);
  assert.deepEqual(amendment.construct.marginal.counts, EXPECTED_COUNTS);
  assert.equal(amendment.construct.marginal.absoluteFloorBytes, 4096);
  assert.equal(
    amendment.construct.total.thresholdFormula,
    'floor(react_same_cell_calibration_p95 * 1.10)',
  );
  assert.equal(
    amendment.construct.marginal.thresholdFormula,
    'floor(max(react_same_cell_calibration_upper95 * 1.10, 4096))',
  );
  assert.match(amendment.construct.marginal.regression.estimator, /intercept/);
  assert.match(amendment.construct.marginal.regression.upperBound, /df=26/);
  assert.equal(amendment.sampling.warmupsPerCount, 2);
  assert.equal(amendment.sampling.calibrationSamplesPerCount, 7);
  assert.equal(amendment.sampling.holdoutSamplesPerCount, 7);
  assert.notEqual(
    amendment.sampling.calibrationSeed,
    amendment.sampling.holdoutSeed,
    'calibration and holdout seeds must remain distinct',
  );
  assert.equal(amendment.sampling.calibrationSeed, 381202607);
  assert.equal(amendment.sampling.holdoutSeed, 381202608);
  assert.match(
    amendment.sampling.preSubscriptionBaseline,
    /one unreported canonical logical subscriber/,
  );
  assert.match(
    amendment.sampling.preSubscriptionBaseline,
    /zero-active-subscriber heap/,
  );
  assert.match(amendment.sampling.outlierPolicy, /retain every valid observation/);
  assert.match(amendment.sampling.countOrder, /pre-frozen calibrationSeed or holdoutSeed/);
  assert.match(amendment.sampling.cohortIsolation, /Commit calibration thresholds before holdout/);
  assert.match(amendment.sampling.cleanup, /zero active and zero ready subscribers/);
  assert.match(amendment.sampling.cleanup, /target no longer exists/);
  assert.match(amendment.sampling.cleanup, /diagnostic high-water-cache evidence only/);
  assert.deepEqual(amendment.cells, EXPECTED_CELLS);
  assert.deepEqual(amendment.targetDerivationInputs.allowed, [
    'same-backend React calibration measurements',
    'the pre-frozen 1.10 multiplier',
    'the pre-frozen 4096-byte slope-resolution floor',
  ]);
  assert(
    amendment.targetDerivationInputs.forbidden.some((value) =>
      value.includes("judged Contract cell's")),
    'judged Contract values must be forbidden threshold inputs',
  );
  assert.equal(
    amendment.artifacts.calibration,
    'demos/partiful-matrix/acceptance/results/step4-memory-v2-calibration.json',
  );
  assert.equal(
    amendment.artifacts.holdout,
    'demos/partiful-matrix/acceptance/results/step4-memory-v2-holdout.json',
  );
  assert.match(amendment.changeControl.beforeRatification, /No threshold derivation/);
  assert.match(amendment.changeControl.afterRatification, /Run calibration once/);

  return {
    amendmentId: amendment.amendmentId,
    status: amendment.status,
    metricNames: [
      amendment.construct.total.name,
      amendment.construct.marginal.name,
    ],
  };
}

export function validateMemoryConstructRegistration(protocol, amendment) {
  assert.equal(protocol.schemaVersion, 'partitime.comparison-protocol.v1');
  assert(Array.isArray(protocol.amendments), 'comparison protocol has no amendment registry');
  const registrations = protocol.amendments.filter(
    ({ id }) => id === amendment.amendmentId,
  );
  assert.equal(
    registrations.length,
    1,
    `comparison protocol must register ${amendment.amendmentId} exactly once`,
  );
  const [registration] = registrations;
  assert.equal(registration.date, amendment.date);
  assert.equal(
    registration.status,
    amendment.status,
    `registry status ${registration.status} differs from authority status ${amendment.status}`,
  );
  assert.equal(
    registration.path,
    'demos/partiful-matrix/acceptance/memory-construct-amendment.2026-07-23.json',
  );
  return registration;
}

const isMain = process.argv[1]
  && resolve(process.argv[1]) === fileURLToPath(import.meta.url);
if (isMain) {
  try {
    const amendment = readJson(
      process.env.PARTITIME_MEMORY_AMENDMENT ?? defaultAmendmentPath,
    );
    const result = validateMemoryConstructAmendment(amendment);
    validateMemoryConstructRegistration(
      readJson(process.env.PARTITIME_COMPARISON_PROTOCOL ?? defaultProtocolPath),
      amendment,
    );
    console.log(JSON.stringify({
      schemaVersion: 'partitime.memory-authority-check.v1',
      ok: true,
      ...result,
    }));
  } catch (error) {
    console.error(error instanceof Error ? error.message : String(error));
    process.exitCode = 1;
  }
}

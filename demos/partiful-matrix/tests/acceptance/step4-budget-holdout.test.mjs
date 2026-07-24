import assert from 'node:assert/strict';

import { evaluateHoldoutMetric } from './step4-budget-holdout.mjs';

const expectedCells = ['contract:snapback', 'contract:sqlite'];
const calibration = { claimEligible: true };
const holdout = {
  claimEligible: true,
  holdoutValidation: {
    ok: false,
    rows: [
      { cell: 'contract:snapback', metricName: 'coldStartupMs', pass: true },
      { cell: 'contract:sqlite', metricName: 'coldStartupMs', pass: true },
      { cell: 'contract:snapback', metricName: 'memoryBytes', pass: false },
      { cell: 'contract:sqlite', metricName: 'memoryBytes', pass: false },
    ],
  },
};

assert.deepEqual(evaluateHoldoutMetric({
  amendmentStatus: 'ratified', calibration, holdout, metricName: 'coldStartupMs', expectedCells,
}), {
  pass: true,
  rows: holdout.holdoutValidation.rows.slice(0, 2),
  perCellMeasurementsPresent: true,
});

assert.equal(evaluateHoldoutMetric({
  amendmentStatus: 'ratified', calibration, holdout, metricName: 'memoryBytes', expectedCells,
}).pass, false);

assert.equal(evaluateHoldoutMetric({
  amendmentStatus: 'ratified', calibration, holdout, metricName: 'coldStartupMs', expectedCells: [...expectedCells, 'contract:convex'],
}).pass, false);

assert.equal(evaluateHoldoutMetric({
  amendmentStatus: 'pending-ratifier-confirmation', calibration, holdout, metricName: 'coldStartupMs', expectedCells,
}).pass, false);

console.log('step4 budget holdout tests passed');

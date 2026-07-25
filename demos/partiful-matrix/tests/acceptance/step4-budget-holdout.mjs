// @ref LLP 0063#workstream-8--performance-and-packaging-budgets — a red
// sibling metric must not erase a passing per-category holdout result. The
// aggregate remains conjunctive; each category reports its own admitted rows.

export function evaluateHoldoutMetric({
  amendmentStatus,
  calibration,
  holdout,
  metricName,
  expectedCells,
}) {
  const rows = holdout?.holdoutValidation?.rows
    ?.filter((row) => row.metricName === metricName) ?? [];
  const pass = amendmentStatus === 'ratified'
    && calibration?.claimEligible === true
    && holdout?.claimEligible === true
    && rows.length === expectedCells.length
    && expectedCells.every((cell) => rows.some((row) => row.cell === cell && row.pass === true));
  return { pass, rows, perCellMeasurementsPresent: rows.length === expectedCells.length };
}

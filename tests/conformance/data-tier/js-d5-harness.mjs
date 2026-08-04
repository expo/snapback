// Thin D5 adapter over the SHIPPING browser-safe evaluator. The corpus owns
// normalization/comparison policy here; whole-plan execution lives in the
// published @expo/snapback-client/ir-evaluator subpath.
//
// @ref LLP 0051#d5-conformance-the-corpus-becomes-the-data-tier-contract —
//   replay pins return values, changed counts, resulting rows, ledgers, and
//   typed rejections across runtimes.

import {
  evaluateBrowserIrPlanV1,
} from '../../../packages/snapback-client/ir-evaluator.mjs';

const own = (value, key) => Object.prototype.hasOwnProperty.call(value, key);

const canonicalValue = (value) => {
  if (Array.isArray(value)) return value.map(canonicalValue);
  if (value !== null && typeof value === 'object') {
    const out = Object.create(null);
    for (const key of Object.keys(value).sort()) out[key] = canonicalValue(value[key]);
    return out;
  }
  return Object.is(value, -0) ? 0 : value;
};

const canonicalText = (value) => JSON.stringify(canonicalValue(value));

/** Execute one D5 case through the shipping browser evaluator. */
export function replayDataTierCaseInJs(testCase) {
  return evaluateBrowserIrPlanV1({
    name: testCase.name,
    schema: testCase.schema,
    initialRows: testCase.seed,
    plan: testCase.plan,
    args: testCase.args,
    ctxLedger: testCase.ctxLedger,
    authUserId: testCase.authUserId,
  });
}

export function d5ValuesEqual(left, right) {
  return canonicalText(left) === canonicalText(right);
}

// Complete row-set comparison with the corpus's documented row projection:
// count-exact, distinct-row matching, and exact expected fields. Runtime-owned
// system columns are outside the case projection and are stripped by the
// shipping evaluator.
export function d5RowsMatch(expectedRows, actualRows) {
  if (expectedRows.length !== actualRows.length) return false;
  const unmatched = [...actualRows];
  for (const expected of expectedRows) {
    const index = unmatched.findIndex((actual) => Object.entries(expected).every(
      ([key, value]) => own(actual, key) && d5ValuesEqual(value, actual[key]),
    ));
    if (index === -1) return false;
    unmatched.splice(index, 1);
  }
  return true;
}

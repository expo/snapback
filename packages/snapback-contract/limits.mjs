// Canonical relational-query ceilings shared by authoring and validation.
//
// @ref LLP 0080#1-closed-relational-plan — every relational query has an
// explicit take in 0..=1024.
// @ref LLP 0110#11-closed-plan — bounded-children plans use the same closed
// per-node take range.
// @ref LLP 0135#21-composite-plan-shape — one snapshot batch may sum at most
// 1,024 rows across its nodes.

export const RELATIONAL_TAKE_CEILING = 1_024;
export const SNAPSHOT_BATCH_SUMMED_TAKE_CEILING = 1_024;

// @ref LLP 0317-clique-0129-correction-loop-disposition.research.md#implementation-charter-wave-3
// — one public, typed budget vocabulary lets generated declarations and
// client arms explain the causal limit before an author reaches it.
export const SNAPBACK_PUBLIC_BUDGETS_V1 = Object.freeze({
  query: Object.freeze({
    implicitResultRows: 1_024,
    takeRows: 1_024,
    dynamicTake: 'supported-with-runtime-ceiling',
    repair: 'fixed-bound-then-slice',
  }),
  result: Object.freeze({ maxBytes: 4 * 1_024 * 1_024, maxArrayItems: 1_024 }),
  retainedMutationOutput: Object.freeze({
    maxBytes: 65_536,
    diagnostic: 'SNAPBACK_CLIENT_MUTATION_RESULT_TOO_LARGE',
  }),
  react: Object.freeze({
    queryStores: 256,
    queryConsumers: 1_024,
    viewSubscriptionWarning: 16,
    serverSubscriptions: 64,
    warningDiagnostic: 'SNAPBACK_REACT_SUBSCRIPTION_VIEW_BUDGET_EXCEEDED',
  }),
});

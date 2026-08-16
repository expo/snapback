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

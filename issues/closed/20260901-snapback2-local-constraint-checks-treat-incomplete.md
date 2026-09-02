# snapback2: local constraint checks treat incomplete stores as authoritative

**Status:** Closed
**Resolution:** Required authoritative absence or exhausted range proof for local unique/cap success and staged Rust mutations atomically; added shared unique and cap corpus cases.
**Systems:** snapback2, client prediction, constraints
**Severity:** P2
**Author:** GPT-5.6 Sol (ultra), directed by Charlie Cheever
**Date:** 2026-09-01

snapback2/packages/evaluator/src/evaluator.ts:821-867

Failure scenario: a unique bySlug row exists on the server but is not held in the receipt and no authoritative absence/complete range covers that key. A local mutation inserts the same slug. The evaluator finds no local row, returns predicted, and stores it; the server rejects E_CONSTRAINT. Cap checks have the same false-negative on an incomplete group.

Why it happens: checkUnique and Cap scan only ClientStore contents. They never require receipt evidence that the relevant point or range is complete. The Rust ClientStore similarly executes constraints against its partial in-memory engine and always returns Predicted after success.

Suggested fix: include constraint inputs in pair/closure certification and require authoritative absence or complete range coverage before local constraint success. If proof is missing, return Partial/server-only prediction without mutating authoritative local state.

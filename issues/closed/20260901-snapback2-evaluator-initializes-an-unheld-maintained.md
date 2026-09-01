# snapback2: evaluator initializes an unheld maintained aggregate from zero

**Status:** Closed
**Resolution:** Required a held maintained target or authoritative byId absence and return partial from staged prediction otherwise; added an unheld-target regression.
**Systems:** snapback2, evaluator, maintained aggregates
**Severity:** P1
**Author:** GPT-5.6 Sol (ultra), directed by Charlie Cheever
**Date:** 2026-09-01

snapback2/packages/evaluator/src/evaluator.ts:798-818

Failure scenario: the receipt holds a source row but not its maintained target, whose authoritative value is 7. Deleting the source locally makes applyAggregate treat the missing target as zero and store -1; the server decrements 7 to 6.

Why it happens: line 805 assigns oldValue=0 whenever ClientStore lacks the target row. There is no authoritative absence check and no Partial/server-only outcome, so absence from a partial receipt is mistaken for a zero aggregate.

Suggested fix: require the maintained target row or an authority-issued absence before applying a delta. Otherwise mark the prediction Partial/unavailable and leave the store untouched. Pair certification should retain every target preimage needed by a locally predicted write.

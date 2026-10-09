# Quarry difftest: the named prediction outcome cannot attribute a refusal across `if` branches

**Status:** Open
**Impact:** 2
**Urgency:** 2
**Ease:** 3
**Confidence:** 4
**Systems:** Snapback 4, differential testing (device write oracle)
**Date:** 2026-10-08
**Related:** LLP 3000.035 §5.1; issues/closed/20261008-snapback4-device-predicts-insert-over-a-hidden-secondary-unique-clash.md

A harness defect, not an engine defect.

The named outcome `predicted-then-refused-unheld-unique-key` applies the
2026-10-08 ruling: keep predicting, document the rollback. It needs every path's
first write to be the clashing insert. When an `if` has a predicted insert in
one branch and an `upsert` in the other, the condition cannot tell which branch
the server refused. So the case stays a `write-predicted-refused` disagreement:
one per store in 20,000 seeds.

**Fix.** Record which branch the server took, or evaluate the condition per
branch. Then the named outcome applies exactly.

The nightly runner matches these lines, so recurrences append here rather than
open a new ticket:

**Failure signature:** `device-sqlite--write-predicted-refused--admitted`  
**Failure signature:** `device-memory--write-predicted-refused--admitted`  

Recurrences:

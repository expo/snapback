# Snapback 2 negative-rule test uses stale range authority

Status: Open
Date: 2026-09-12
Scope: Snapback 2 evaluator regression quality
Author: Codex / GPT-6 Astra

The negative-write control in
`snapback2/packages/evaluator/src/test-maintained-address.ts` changes the insert
rule in `guarded`, but builds `guardedReceipt` using `range.rule_hash` from the
original schema. `scopedRuleHash` includes the schema digest. Consequently, that
range is not valid coverage under the guarded schema, and the mutation can remain
partial because a uniqueness check lacks coverage. The existing assertion does
not isolate the intended distinction between complete read coverage and negative
write authority. No production authorization defect is established here.

This was found while reviewing the S2 0.0.31 repair port into Snapback 3. The S3
control now recomputes the guarded range hash, asserts `hasCompleteRange` and a
fresh public point read on that same store, then checks that the write is partial
and inserts nothing. A positive control supplies explicit `byTarget` absence
authority and requires the same write to predict successfully and insert its row.
That focused test passed locally and in an independent review.

Apply the same precondition and positive-control correction to the S2 test, then
run its affected evaluator checks. The corrected independent example is
`snapback3/tests/public-empty-read.test.ts`; reuse its assertions deliberately,
without introducing a runtime dependency between the sibling implementations.

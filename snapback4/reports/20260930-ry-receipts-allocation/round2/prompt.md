You are lane RY of Snapback 4, round 2, in `~/sb4-intent/lane-ry` (branch `sb4-intent/ry-receipts-allocation`). Rounds 0 and 1 are your own work: read their prompts and reports, whose rules still bind you.

**Reviews of rounds 0–1.** Astra: READY WITH CHANGES (`~/sb4-intent/reviews/ry-r1.astra.md`). Grok: READY WITH CHANGES (the same defect class, rated High) (`~/sb4-intent/reviews/ry-r1.grok.md`). Read both in full. Astra confirmed:
- atomic allocation and replay (80 contiguous positions; removing counter commitment fails);
- floors and recipient snapshots (the payload-independent meter);
- prediction with settled accounting for ordinary sends, creation, joins, replay, refusal withdrawal and delivery collection;
- the starter, suite and wasm figures; the 2,882 B wasm increase is proportionate.

Fix these, each with a test that fails on round 1 (Astra's reproductions are at `/tmp/ry-review-astra-PKp4Sh/snapback4/crates/snapback4-lang/tests/declarative_receipts/review.rs`):

1. **(Astra P2) Rule and postcondition reads miss receipt-ordinal dependencies.** `SequenceProbe` (`engine/sequences.rs:309`) and the final-exists checks (`engine/write.rs:617`) recognise only `sequence by` fields. Repro:
   1. a device holds counter 0, and another writer commits ordinal 1;
   2. the device inserts and updates a message under `update <- .ordinal = 2`.

   Prediction returns `E_RULE`, while the identical server mutation succeeds at ordinal 2. An `after insert` lookup keyed by `.ordinal` fails with a terminal constraint error in the same way. Both happen on memory and SQLite. A read that depends on a provisional receipt ordinal must make the write queue without prediction, never fail admission.
2. **(Astra P2) Pending receipt nulls can terminally reject valid mutations.** `ReceiptSettled` (`engine/runner.rs:925`) checks provenance without recording a provisional dependency. Inserting a message and then running `require receipt(m) != null else NEED_RECEIPT` is rejected on both device stores, while the server succeeds. Record the dependency so the refusal defers to settlement.

Audit every other place the engine reads a clause-owned field (ordinal, floor, recipient count, receipt state) during prediction for the same class of defect, and list what you checked.
3. **(Grok High, the same class; covered by the audit above) A follow-up that consults a pending receipt is dropped, not queued.** `admit` keeps a refusal only when prediction set `provisional_sequence_read`, or when the error is already `Prediction`; otherwise it returns before the outbox insert, so the write is lost offline. Grok executed two triggers:
   - `require receipt(m) != null` on a pending message returns a terminal `NOT_SETTLED`. `progress()` and `receiptMember()` have the same short-circuit for a pending membership.
   - An update rule `next.recipients > 0` returns a terminal `Rule`, because `SequenceProbe::field` treats only `table.sequences` as provisional.

   The maintained-aggregate predicate scan (`row_views.rs`) looks only at sequence columns too; it was not executed, but fix it the same way. Route `ReceiptSettled`, `SequenceProbe::field` and that scan through the provisional-receipt check the direct field reader already uses (`sequence_field_is_provisional`). Every one of these cases must queue with `predictable: false`, keep the follow-up in the outbox, and succeed at the server once the send settles. Test each trigger.
`main` has moved: merge `origin/main` first, keeping both sides. Run your affected tests, the whole guide, and `scripts/test.sh` once. Report its exact summary line and every failure, marking each as yours, baseline or environmental. Report the wasm size. Write the report under `round2/`, append one journal entry, and commit with the co-author trailer. Push and publish nothing.

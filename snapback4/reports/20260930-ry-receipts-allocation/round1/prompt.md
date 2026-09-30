You are lane RY of Snapback 4, round 1, in `~/sb4-intent/lane-ry` (branch `sb4-intent/ry-receipts-allocation`). Round 0 is your own work: read its prompt and report, whose rules still bind you.

**A design correction before review.** Round 0 made sends, scope creation and joins "queue offline without predicted rows". That regresses the product. In any app using the receipts clause, including the social starter, a message sent offline no longer appears in its conversation until the server settles it. The builder must then merge pending writes into history by hand. That is the replacement-outbox glue calibration #27's builder praised Snapback for not needing ("durable SDK custody without a replacement outbox"), and it is what the M6 offline milestone exercises: queued sends visible in compose order. Keep your allocation, floor and recipient-snapshot work, and restore prediction:

1. **Sends predict with a provisional position.** An offline or unsettled send shows at once in its group's history as a predicted row (`pending: true`), placed after the highest ordinal the device holds for that group and in submission order among its own pending sends. Settlement replaces the provisional position with the server's allocated ordinal. The row may then move if another member's message committed first, which is the ordinary optimistic tradeoff; the SDK's existing replacement rules apply. Pending rows never count as delivered or seen, never enter runs, watermarks or recipient counts, and are never collected as delivery for anyone. Guarantee this structurally, in the receipts accounting, not just by convention.
2. **Joins and scope creation predict where they safely can.** For example, a created conversation shows at once with the creator's membership. Where a prediction cannot be honest, keep queueing without a row, and say which cases and why.
3. **Readers see an honest answer.** A history page that contains provisional rows is marked with the existing pending metadata, and the existence classifier (LLP 3000.031) treats it the same as other predictions. Nothing that reads settled receipts (progress, `receiptMember`, projections) ever reflects a pending row.

Keep everything else from round 0: atomic allocation, floors on join and rejoin, recipient snapshots from membership index counts, retries through the write-id ledger, and the removal of the starter's hand-written code. Report the starter's line count again.

## Tests

- Two-device offline sends on memory and SQLite: each device shows its own sends at once, in submission order. After reconnecting, history converges to the server's order exactly once and receipts are correct.
- A send that the server refuses (a membership revoked while offline) disappears on settlement and leaves no receipt trace.
- A model test interleaving provisional rows with deliveries and seen reports, asserting that no pending row ever affects accounting.
- The social starter's offline send scenario, end to end on the wasm device: the message appears pending, then settles.

`main` has moved: merge `origin/main` first, keeping both sides. Run your affected tests, the whole guide, and `scripts/test.sh` once. Report its exact summary line and every failure, marking each as yours, baseline or environmental. Report the wasm size (the budget is a ratchet; raise it only with a reason). Write the report under `round1/`, update LLP 3000.022 §14 with the prediction rule, append one journal entry, and commit with the co-author trailer. Push and publish nothing.

# Wave-1 remainder: implement LLP 0135 — sequence allocation + snapshot-batch composition

**Status:** Open
**Systems:** Runtime, Storage, API, Wire Protocol
**Related:** LLP 0135 (Accepted 2026-07-31, unbuilt — demos annotate
"primitive unshipped"), LLP 0120 (option 3a), LLP 0155 Move 1 (same
option-3a family)

Two halves with different readiness:

- **Sequence half — start any time.** `ctx.sequence.allocate` gapless/
  monotonic allocation (`sequence_allocation_v1`): declared sequences,
  order-field bounds, per-scope serialization named in the API (the scope is
  part of the API, not a footnote — LLP 0128 guardrail 2). The A6 demo's
  hand-rolled read-increment-write is the motivating case and the natural
  acceptance fixture.
- **Snapshot-batch half — check first.** `snapshot_batch_v1` (multiple query
  nodes in one cursored batch, `sbsb1`/`sbbc1` cursors) is the same LLP 0120
  option-3a family the 0155 Move-1 composition-algebra Spec was recast into.
  Before building, check that Spec's state: whichever lands first pins the
  shared cursor grammar; if the Move-1 Spec is in flight, coordinate or hold
  this half with a dated note.

Also due at landing: apply LLP 0135 §4's fold-on amendments ("drafted, not
applied") to their downstream docs if the hygiene ticket has not already.

**Exit:** the spec's §5 executable acceptance implemented; capability ids
registered in the manifest enum; demo workaround in the A6 arm replaceable;
dated implementation-record amendment on the LLP; LLP 0115 board row updated.

## Coordination log

- **2026-08-02 — owner folds taken by corpus hygiene.** The
  `20260802-corpus-hygiene-fold-on-amendments` lane applied LLP 0135 §4's
  dated owner amendments at `d7eef3c65db5ab39abcefdebc0c642b247c02623`
  and marked §4 folded. This implementation ticket
  must not repeat them; it still owns code, executable acceptance, capability
  registration, demo replacement, and the implementation record.

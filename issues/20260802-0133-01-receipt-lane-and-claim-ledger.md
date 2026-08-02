# 0133-01: Settlement receipts carry the lane label and the disposition-labeled claim ledger

**Status:** Open
**Program:** 20260802-0133-00-settlement-substrate-program.md
**Systems:** Wire Protocol, Storage, Sync
**Related:** LLP 0133 §The two settlement lanes (rule 4), §Receipts; LLP 0043
(replay ledger), LLP 0034 (receipts closure), LLP 0093/0094 (wire projection)

## Task

Every settlement receipt gains:

1. **The lane label** — `"replay-accept"` (lane Q, the shipped path) or
   `"re-derive"` (lane L). Working spelling; final spelling is OQ1's, with the
   row-4 owners. All currently-shipped settlements are lane Q and must label
   `replay-accept`.
2. **The disposition-labeled claim ledger** — one entry per
   application-visible client-captured value:
   `{field-or-slot, claimed, authoritative, disposition, skewMs?}` with
   dispositions `accepted` / `accepted-bounded-skew` / `re-derived`.
   Divergence is computable from the pair, not a separate disposition. For
   lane Q today, entries are `accepted` with claimed == authoritative.
3. **The privacy rule** — the full claim ledger and id-map ride only the
   submitting authority's own mutation response / stored settlement (the
   LLP 0043 auth-bound replay ledger). Fan-out receipts to other subscribers
   carry the lane label and shipped write-surface facts only ("the diagnostic
   CODE only" rule). This must be enforced at the fan-out boundary, not by
   client politeness.

The committed `snapshotVersion` binding is already shipped
(`Receipt::Mutation`, `Option<u64>`, confirmed ⇒ non-null per LLP 0034);
don't disturb it.

## Exit

- Lane-Q settlements observably label `replay-accept` with an `accepted`
  claim ledger on local and served surfaces (acceptance sketch 1's receipt
  half).
- An adversarial test proves a second subscriber's fan-out receipt contains
  no claim-ledger values or id-map.
- Wire additions follow the additive wire-version rules; a dated coordination
  note is filed for the row-4 owners (LLP 0043/0034/0093) recording the
  working spellings as provisional.

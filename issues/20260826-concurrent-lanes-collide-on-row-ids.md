# Concurrent lanes allocate the same row ID

**Status:** open — blocks landing either lane until renumbered
**Found:** 2026-08-26, by comparing two lanes that ran in parallel from the same base.

## The collision

Two unrelated lanes each allocated **F313**:

| Lane | F313 means | Verdict |
|---|---|---|
| `rawsql` (`9dcb5f512`) | "the former `services/remainder-tests` crate re-export is absent in every feature cell" | CLOSED |
| `pending` (in flight) | "a dependent can ask the public resolver for anonymous ownership, independently supply the complete…" | OPEN |

Both started from the same `origin/main`, both scanned the ledger for the next free identifier, and
both picked F313. Neither did anything wrong.

## Why it matters more than a rename

A row ID is the join key between the executable ledger, the security-boundary inventory, the seam map,
the blocker graph, and every issue that cites a row. Two meanings for one ID does not merely confuse a
reader — it corrupts the instrument, and this programme has already been burned three times by
instruments that were confidently wrong (the corpus reporting F170 closed while a second handle reached
the effect; the corpus omitting the feature cell that exposed raw SQL; a lane sweep reporting live lanes
as dead).

It would also survive review: each lane's own verification passes, because each is internally
consistent. Only a cross-lane comparison catches it.

## Resolution for this instance

`rawsql` keeps F313 — it finished first and is already under review at that ID. `pending` renumbers its
creation row **F313 → F318**, leaving its family as F318 (creation), F314 (refusal), F315 (approval),
F316 (denial), F317 (settlement). Non-contiguous but correct; renumbering the whole family would create
more churn than it removes.

## The systemic fix

Row-ID allocation is currently "read the ledger, take the next free number", which is safe only when one
lane allocates at a time. With lanes running in parallel from a shared base it is a race.

Options worth weighing:
1. **Reserve ranges per lane at dispatch.** Cheap, no tooling; the orchestrator hands each lane a block
   (`F313–F317`, `F318–F322`) in the brief. Costs nothing and solves the common case.
2. **Make the ledger check reject duplicates.** `tests/row_attacks_v1.mjs` and
   `scripts/run-row-attacks.mjs` should fail on a repeated `row` value. That catches the collision at
   the first landing rather than the second, which is where it becomes expensive.
3. **Derive the ID from content** rather than allocating sequentially — the largest change and probably
   not worth it.

(1) and (2) together are sufficient, and (2) should be done regardless: a duplicate row ID is exactly
the kind of thing an executable contract exists to refuse.

## Related

- `issues/20260826-authorization-denominator-and-seam-map.md` — the row inventory as join key.
- `llp/0313-authority-creation-chokepoint.spec.md` §10 — the rows become an acceptance ledger, which
  makes ID integrity more load-bearing, not less.

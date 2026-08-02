# G-04: The register cliff — one ordinary query must not degrade a whole register group

**Status:** Open
**Program:** 20260802-convex-erg-00-program.md
**Systems:** Live queries, Client integration, Codegen
**Related:** LLP 0127 (reactivity-fee finding), LLP 0090 (resumable query
snapshots — register/rung-2 tails recorded open at its execution close),
LLP 0114 (client seam), LLP 0155 Move 1/2 (the strategic successor surface)

## Task

The parity research records a reactivity cliff: mixing one ordinary
(non-analyzable / opaque) query into a register group degrades the whole
group's delivery class, so authors pay a classification fee Convex never
charges. The 2026-08-02 synthesis lists it as an un-programmed gap.

**Verify first:** reproduce the cliff on current main (the delta-lane
conservatism just changed in eda8f231 — behavior may have moved). Record: what
exactly degrades (delivery lane? retainability? the whole group vs the one
query?), which doc owns the current behavior, and whether LLP 0090's open
register/rung-2 tail tickets cover it.

**Then either:** (a) implement per-query classification so an opaque query
degrades only itself, under the existing capability-classification vocabulary
— if the fix is within decided design; or (b) if it needs new design, write
the finding into the owning LLP (0090 or the 0155 Move-1 Spec) as a dated
amendment proposal and re-scope this ticket to that path. Do not silently
widen delivery guarantees for opaque queries; the fix is isolation of the
degradation, never upgrade of the unanalyzable.

## Exit

- The dated reproduction/ownership note.
- Path (a): a test proving one opaque query in a group leaves sibling
  analyzable queries' delivery class untouched, plus the inspector/diagnostic
  naming the per-query class. Path (b): the amendment proposal landed and
  this ticket re-scoped or closed onto the successor.

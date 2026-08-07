# Implement LLP 0189 claim-snapshot and battery mechanics

**Status:** Open
**Opened:** 2026-08-07
**Systems:** Testing, CI, Packaging, Publication
**Related:** LLP 0189, LLP 0175,
`issues/20260807-derived-fork-publication-wave-drift-requalification.md`

LLP 0189 (Accepted 2026-08-07) rules that claims are snapshots with scoped
qualification digests, the scheduled complete battery is the authoritative
verdict, and landing/promotion gates reference the battery rather than
complete proofs at exact commits. Three mechanical pieces implement it:

1. **Digest scoping in the publication oracle (D-4).**
   `scripts/check-agent-safe-publication.mjs` (and the v2 digest machinery it
   verifies) must support a claim-scoped `IMPLEMENTATION_ROOTS`: the claimed
   capability's runtime/CLI plus the checkers defining the claim's semantics.
   Each wave-shared proof/checker/metrology file leaving a digest must, in the
   same change, gain (or name) a frozen-record drift gate in the LLP 0175
   `driftProneGates` registry. Verify with a fixture that a departing file
   without its gate refuses.

2. **Snapshot/withdrawal semantics (D-3).** The oracle's combined-tree check
   distinguishes "scoped surface changed without requalification" (claim
   invalid → withdraw or requalify) from "only out-of-scope files changed"
   (claim stands). The 2026-08-07 fork withdrawal is the motivating case: nine
   changed wave-shared files should not have invalidated the claim once
   scoping lands.

3. **Battery-red ticket automation (D-1).** Extend the
   `scripts/drift-prone-gates.mjs backstop` pattern to the scheduled complete
   proof: each root failure files one idempotent
   `issues/YYYYMMDD-battery-<gate>.md` ticket (open-ticket marker as the
   idempotency key), so scheduled reds become owned fix-forward work instead
   of ambient state. Dependent `BLOCKED` results do not file tickets.

The derived-fork requalification consumes piece 1+2 (its digest re-scope) and
should be the first user; do not close this ticket until that requalification
has landed on the scoped digest and survived at least one subsequent wave
landing without rotation.

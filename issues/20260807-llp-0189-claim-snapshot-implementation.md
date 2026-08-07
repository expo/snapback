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
   Scoping is by semantic role, not file category: a semantics-defining
   checker stays in the digest even when wave-shared, the digest closes over
   the semantics-affecting inputs of in-digest checkers (pinned by content in
   the claim record), and the scope classification itself is part of the
   named-author-accepted claim record. Each wave-shared
   proof/checker/metrology file leaving a digest must, in the same change,
   gain (or name) a frozen-record drift gate in the LLP 0175
   `driftProneGates` registry that meets the admission bar — a recomputed
   value against a committed record; a content-hash pin regenerated alongside
   any edit does not qualify. Fixtures: a departing file without its gate
   refuses; an in-scope change invalidates; an out-of-scope change leaves the
   claim standing; a scope-manifest edit without requalification or fresh
   acceptance refuses; a semantics-defining checker cannot leave via a
   generic gate.

2. **Snapshot/withdrawal semantics (D-3).** The oracle's combined-tree check
   distinguishes "scoped surface changed without requalification" (claim
   invalid → mandatory demotion to the prior honest tier, or an explicit
   requalification-pending marker naming an owned ticket, within one battery
   period) from "only out-of-scope files changed" (claim stands). Editing a
   published claim's digest scope is itself a scoped-surface change. The
   2026-08-07 fork withdrawal is the motivating case: nine changed
   wave-shared files should not have invalidated the claim once scoping
   lands.

3. **Battery-red ticket automation (D-1).** Extend the
   `scripts/drift-prone-gates.mjs backstop` pattern to the scheduled complete
   proof: each root failure files one idempotent
   `issues/YYYYMMDD-battery-<gate>-<signature-slug>.md` ticket, keyed on the
   root-failure signature (same gate + same signature = update the existing
   open ticket; a new distinct signature files its own ticket — never
   silently coalesces, and each ticket carries independent open/closed and
   consecutive-run escalation state). Tickets
   cross-reference any standing published claim whose D-4 scoped surface the
   failing gate is claim-relevant to, and the claim record names the open
   ticket while it stands. A red persisting across four consecutive scheduled
   runs escalates to the author. Dependent `BLOCKED` results do not file
   tickets.

The derived-fork requalification consumes piece 1+2 (its digest re-scope) and
should be the first user; do not close this ticket until that requalification
has landed on the scoped digest and survived at least one subsequent wave
landing without rotation.

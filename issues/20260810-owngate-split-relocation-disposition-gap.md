# owngate: frozen-edge dispositions cannot express an edge-key split at a god-file extraction

**Status:** Open
**Systems:** Proof/gates, LLP governance
**Date:** 2026-08-10
**Found during:** the owner-#5 writer-gate slice (LLP 0225 §4), first
extraction landed after the hardened analyzer (6f7cd728d).

`scripts/check-module-ownership.mjs`'s `relocation` disposition requires the
predecessor fingerprint to be fully removed from the current graph
(`removed.includes(priorFingerprint)`). That models a whole-edge move, but
god-file extractions routinely SPLIT an edge key: the moved code carries the
coupling to a new `from` module while the source file retains other
references to the same target, so both keys exist and `relocation` is
refused. `analyzer-upgrade` requires the fingerprint to exist at the
predecessor (it cannot — the new module did not exist), leaving
`time-bounded-waiver` as the only accepted disposition even though the
coupling is pre-existing, not new — which overloads the waiver vocabulary
LLP 0225 §2 reserves for genuinely new coupling.

Live example: `src/server/writer_gate.rs → src/local.rs` at the owner-#5
slice (predecessor `src/server.rs → src/local.rs` retained; recorded as a
waiver with explanatory provenance in
`issues/20260809-0199-ownership-ratchet-worklist.md`, deadline 2026-09-15).

Proposed fix (owngate lane's call): a fourth disposition — e.g.
`split-relocation` — validating that the predecessor fingerprint exists in
the predecessor baseline's frozen set AND in the current graph, with the same
predecessorFingerprint provenance as `relocation`; or relax `relocation` to
accept a retained predecessor when explicitly declared
(`predecessorRetained: true`). Routing: the ownership-gate lane
(owngate-20260810) owns the arm; this ticket is the coordination record —
not self-served per LLP 0225 §5 / the routing-closed claim.

# owngate: frozen-edge dispositions cannot express an edge-key split at a god-file extraction

**Status:** Superseded 2026-08-19
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

Live example: `crates/snapback/src/server/writer_gate.rs → crates/snapback/src/local.rs` at the owner-#5
slice (predecessor `crates/snapback/src/server.rs → crates/snapback/src/local.rs` retained; recorded as a
waiver with explanatory provenance in
`issues/20260809-0199-ownership-ratchet-worklist.md`, deadline 2026-09-15).

The original lane proposed a fourth `split-relocation` disposition (or a
retained-predecessor mode on `relocation`). Three adversarial review rounds
showed that the attempted evidence and waiver-discharge designs were unsound,
so that disposition is not shipping. Splits continue to use the existing
time-bounded-waiver behavior.

Design work continues in
`issues/20260816-split-relocation-disposition-needs-sound-evidence.md`. This
gap remains open until that follow-up produces a sound, reviewed design and
implementation.

## Resolution

LLP 0276 Phase 3 retires the fingerprint-disposition protocol. Crate
membership and dependency legality are now derived directly from the checked
workspace and exact exception matrix, so a split-relocation vocabulary is no
longer part of the live enforcement surface.

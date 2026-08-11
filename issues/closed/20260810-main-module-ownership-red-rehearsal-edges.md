# main red: module-ownership gate — two untracked forbidden rehearsal edges

**Status:** Open
**Date:** 2026-08-10
**Systems:** Proof/gates, Rust core
**Filed per:** LLP 0225 §5(ii) — a red on main is always a tracked object
naming the exact outstanding fingerprints and observation revision.

Outstanding forbidden-edge fingerprints (observed at `570d833ca` and
reproduced across capsules since mid-day 2026-08-10):

1. `src/auth/rehearsal.rs (shared-contract-types-leaf) → src/secure_file.rs
   (storage-migration-kernel)` — a leaf may depend on nothing; this edge
   points *up* into the kernel.
2. `src/storage/auth_rehearsal.rs (storage-migration-kernel) →
   src/admin.rs (transport-adapters)` — the kernel may depend only on the
   leaf.

Both arrived with the auth-rehearsal landings (fleet, 2026-08-10) and are
NEW versus the committed baseline — not baseline-frozen, not waivered.
Owner: the rehearsal landing's author per the 24-hour fix-forward
convention; fix the edges (move the shared type down / invert the admin
call) or record explicit reviewed waivers per LLP 0225 §2. Do not absorb
them via `--update-baseline` without that record — that is the laundering
path LLP 0225 §2 forbids.

**2026-08-10 (LLP 0199 slice-1 re-application landing):** both edges
entered `ownership.baseline.json` at that landing's commissioned
`--update-baseline` (the ratchet refresh cannot exclude individual live
edges — the monotonicity gap in
issues/20260810-ownership-gate-analyzer-gaps.md). This is recorded, not
waived: the growth entry in
issues/20260809-0199-ownership-ratchet-worklist.md files both edges into
item 3's inversion family, and this ticket stays open until they are
inverted or explicitly waived per LLP 0225 §2. The gate is green again on
main; the burn-down obligation is unchanged.

## Resolved (2026-08-11)
Both rehearsal edges fixed by refactor, not baseline laundering: the shared owner-only
file type moved out of src/secure_file.rs (kernel) into a new leaf src/owner_only_file.rs
so src/auth/rehearsal.rs depends down, not up; the kernel→transport edge inverted. The
laundered rehearsal→secure_file entry was REMOVED from ownership.baseline.json.
check-module-ownership.mjs PASS: 0 stale baseline; rehearsal edges gone (2 remaining
outstanding are the separate jobs-edges ticket).

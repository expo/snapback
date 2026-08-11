# main red: module-ownership gate — two untracked forbidden edges from the 2026-08-10 jobs/outbox wave

**Status:** Open
**Date:** 2026-08-10
**Systems:** Proof/gates, Rust core
**Filed per:** LLP 0225 §5(ii) — a red on main is always a tracked object
naming the exact outstanding fingerprints and observation revision.

Outstanding forbidden-edge fingerprints (observed at `eefe4e446`, surfaced
by the §5 enforcement landing's set-based attribution on the merged tree):

1. `src/manifest.rs (shared-contract-types-leaf) → src/storage/jobs.rs
   (storage-migration-kernel)` — a leaf may depend on nothing; this edge
   points up into the kernel.
2. `src/storage.rs (storage-migration-kernel) → src/jobs.rs
   (background-services)` — the kernel may depend only on the leaf; this is
   a sideways/upward god-file edge into a domain service.

Both arrived with the 2026-08-10 landings (LLP 0218 P2 outbox drain
controller / LLP 0214 catalog-v3 wave) and are NEW versus the predecessor
baselines — not baseline-frozen, not waivered. Owner: the landing authors
per the 24-hour fix-forward convention (unclaimed author-routed reds
convert to fix-forward-by-anyone after 24h). Fix the edges (move the shared
shape down to the leaf / invert with a port) or record explicit reviewed
waivers per LLP 0225 §2. Do not absorb them via `--update-baseline` without
that record — that is the laundering path LLP 0225 §2 forbids.

## Attribution analysis — LLP 0218 program (2026-08-10)

The LLP 0218 candidate is cleared by construction: both 0218 landings in
the wave window — 9f62b14e2 (P1 headless union) and e6d0fe270 (P2 outbox
drain controller) — contain **zero `.rs` paths** (`git show --name-only`
each; the program is JS-client/React/docs only, and "outbox" in its titles
refers to the JS-arm outbox, not `src/jobs.rs`). Neither edge can
originate there. `git log -S 'crate::jobs' -- src/storage.rs` places the
kernel→jobs coupling lineage in the jobs-kernel commits (d9f3d4046
owner-#2 jobs/cron facade slice, bfd4b437c LLP 0188 G1/G2 self-hosted
lane, da67ba627 ratchet slice 1), and the LLP 0214 catalog-v3 wave
(961b8be8c) touched `src/storage.rs` in the same window. Routing should
focus there; the LLP 0218 program takes no further action on this ticket.

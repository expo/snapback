# main red: module-ownership gate — three inherited forbidden edges

**Status:** Open
**Date:** 2026-08-10
**Systems:** Proof/gates, Rust core
**Filed per:** LLP 0225 §5(ii) — a red on main is always a tracked object
naming the exact outstanding fingerprints and observation revision.

Outstanding forbidden-edge fingerprints (re-observed at `245f23518`, after
the original jobs-wave pair first observed at `eefe4e446` was cleared):

1. `src/storage.rs (storage-migration-kernel) → src/runtime.rs
   (transport-adapters)` — the kernel points up into a transport adapter.
2. `src/storage/mutation_writes.rs (storage-migration-kernel) → src/runtime.rs
   (transport-adapters)` — a kernel mutation module points up into a transport
   adapter.
3. `src/storage/tests.rs (storage-migration-kernel) → src/runtime.rs
   (transport-adapters)` — the kernel test module points up into a transport
   adapter.

The three runtime edges are inherited and unfrozen at the current observation;
this ticket records them so LLP 0225's set-based gate can admit the inherited
state without laundering it into the baseline. Owner: the landing authors per
the 24-hour fix-forward convention (unclaimed author-routed reds convert to
fix-forward-by-anyone after 24h). Fix the edges (move shared shapes down or
invert with a port) or record explicit reviewed waivers per LLP 0225 §2. Do
not absorb them via `--update-baseline` without that record — that is the
laundering path LLP 0225 §2 forbids.

## Jobs-wave pair cleared — 2026-08-15

The two edges that gave this ticket its name are gone without a waiver or
direction change:

1. `JOBS_STATUS_TABLE` moved from kernel-owned `src/storage/jobs.rs` to the
   dependency-free `src/contract_types.rs`; `src/manifest.rs` now names the
   leaf directly while `src/storage/jobs.rs` re-exports the constant to
   preserve its public façade.
2. `src/storage.rs` now spells its kernel child re-export as
   `pub use self::jobs::{JobsKernel, JobsReadKernel};`, preventing the analyzer
   from resolving the bare `jobs` segment through the crate-level background
   service façade.

The predecessor-aware ownership check reports three inherited outstanding
fingerprints, exactly the runtime trio above.

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

## Re-observation — 2026-08-15

`node scripts/check-module-ownership.mjs` at `1c05bba66`:
`PASS: 239 modules (235 assigned, 4 unassigned); 1765 module edges; 1228
cross-owner; 18 new allowed; 0 stale baseline; 5 inherited outstanding
(this ticket); 0 unresolved module references`. The five inherited
fingerprints are unchanged and still the complete outstanding set; the gate
admits them as recorded inherited state without laundering. The fix remains
the kernel→transport edge inversions (or reviewed LLP 0225 §2 waivers).

After the jobs-wave pair was cleared and the baseline regenerated through the
sanctioned predecessor-aware path, the same gate reports:
`PASS: 239 modules (235 assigned, 4 unassigned); 1764 module edges; 1224
cross-owner; 0 new allowed; 0 stale baseline; 3 inherited outstanding (this
ticket); 0 unresolved module references`. The remaining set is exactly the
three runtime fingerprints listed above; no waiver was added.

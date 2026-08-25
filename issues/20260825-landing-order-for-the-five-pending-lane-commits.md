# Landing order for the five pending lane commits

Status: open
Date: 2026-08-25
Systems: snapback-auth, snapback-engine, snapback-kernel, snapback-server, snapback-sync
Related: issues/20260824-lane-staleness-is-a-second-gate.md,
  issues/20260825-lane-work-must-survive-a-build-host-reboot.md

## Why decide this before the verdicts arrive

Five lane commits carrying **nine rows** plus a 24-item surface reduction are at review gates
simultaneously. Landing four row lanes in one session means resolving their conflicts under time
pressure, which is exactly when a merge gets resolved by picking a side rather than by understanding
it. Measuring the collisions first is cheap; discovering them mid-landing is not.

Tested by independent cherry-pick onto `origin/main` at `484021b09`.

## Merge state

| Lane | Commit | Rows | vs `main` |
|---|---|---|---|
| tsdemote | `4d141de83` | 24 items | **CLEAN** — 18 files |
| q12 | `2e62af7f5` | F240, C013 | conflicts |
| q03r4 | `f22e9507d` | F100, F101, F102 | conflicts |
| q14 | `50f62a07d` | F305, F306, F312 | conflicts |
| q43 | `7da9567da` | F084 | conflicts |

Most conflicting paths are **generated artifacts** — `guide-flat.generated.md`,
`diagnostics-registry.json`, `guide-manifest.generated.json`, `diagnostics.md`, `registry.json`.
Those are resolved by **regenerating**, never by hand-editing, and the generators chain so
`check-inventories` must confirm the whole chain after each landing. The genuine source conflicts are
3–5 files per lane.

## Pairwise source overlap

Every pair overlaps. `crates/snapback-engine/src/local/engine.rs` is touched by **all five** and is
the universal contention point; `packages/snapback-client/diagnostic-codes.d.mts` is touched by four
and is generated-adjacent.

| Pair | Shared source files |
|---|---:|
| **q12 ↔ q43** | **10** |
| q03r4 ↔ q12 | 6 |
| q03r4 ↔ q43 | 5 |
| q03r4 ↔ tsdemote | 5 |
| q12 ↔ tsdemote | 4 |
| q03r4 ↔ q14 | 4 |
| q12 ↔ q14 | 3 |
| q14 ↔ q43 | 3 |
| q43 ↔ tsdemote | 3 |
| q14 ↔ tsdemote | 2 |

## The one that is not merely a merge problem

**q12 ↔ q43 share ten files, and they are semantically adjacent.** q12 derives the authorization
interlock from durable storage by reusing `auth_invalidation_boot_sequence_v1`; q43 adds point-of-use
revalidation over `auth_invalidation`. Both touch `authorized_lease.rs`, `auth_invalidation.rs`,
`room_authority.rs`, `storage.rs` and `ephemeral.rs`.

Two lanes may have independently solved overlapping problems in ways that do not compose. That is
the same shape as the Q05/Q06 coordinator collision, which was correctly diagnosed as *a clash, not
a defect* — resolved semantically, with neither side reverted. Whoever lands second here must read
both changes rather than resolve hunks.

## Order

1. **tsdemote** — clean against main, largely subtractive, and removes surface the others might
   otherwise re-touch. Lands first for that reason, not because it is easiest.
2. **q12** — largest (22 source files), heaviest overlap, and the biggest ratchet movement in flight.
   Land the hardest change first so the rest rebase onto it; rebasing 16 files onto a landed 22-file
   change is cheaper than the reverse.
3. **q43** — 10 shared with q12. Requires the semantic read described above, not a hunk resolution.
4. **q03r4** — 6 with q12, 5 with q43.
5. **q14** — fewest overlaps (3/3/4/2), so it absorbs whatever the others leave.

After each landing: regenerate artifacts, run `node scripts/check-inventories.mjs` (the only check
that sees the whole generated chain), `./ref-check --verbose`, the affected crate tests, and
`node scripts/check-kernel-raw-sql-api.mjs` diffed against `main` with line numbers normalised.

This order is provisional on the verdicts. A lane that returns DO NOT LAND drops out and the rest
shift up.

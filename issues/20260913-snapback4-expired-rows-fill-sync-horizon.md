# Snapback 4: expired rows occupy the sync horizon; live rows are never acquired

Status: Open
Priority: P1
Date: 2026-09-13
Systems: partition snapshot / join expansion, expiry, replica
Author: Grok 4.6 (comprehensive review of origin/main `f9bf18f0e`)
Related: Clique M5, [LLP 3000](../llp/3000-snapback4.explainer.md) §7 (expire as a lifetime), NOT-DOING (no exact horizon backfill)

## Problem and reproduction

Queries skip rows past `expire at .col`. Snapshot and join expansion do not. `group_rows` / `group_rows_from` walk `last N` newest-first with no expiry filter, and count expired rows toward `horizon.last`.

Probe: `sync public last 2 by byTime`, rows `live@t=1` (null expire) + `x1@t=2` / `x2@t=3` (expire 10). At t=20 the **query** returns `[live]`. The **snapshot ids are `[x1, x2]`**. After `sweep_expired`, a fresh snapshot has `live`; a device that already acquired `x1,x2` receives two `del`s and is left empty. Exact horizon maintenance is NOT-DOING, so there is no backfill of `live`.

An offline device, or one that snapshotted in the window between logical expiry and the sweep, permanently misses still-alive rows that sat just outside a horizon full of corpses. Clique M5 uses `last 500` and two messages, so the existing scenario cannot see this.

Expiry is only a read filter. Until the sweep (2_000 rows/tick), the stored image is still live for:

- Maintains (a public count discloses a row that queries already hide).
- Unique indexes (a second row with the same code after expiry is `E_CONSTRAINT`).
- Caps (a live insert is refused while the only occupant is already expired).
- `after insert <- exists` (an expired target still satisfies the constraint).
- `asset_access` for the uploader (owner branch runs before the expiry check).
- `groups_now` (an expired membership still looks like a current group holder).

## Implementation locations

- [snapback4/crates/snapback4-core/src/partition.rs](../snapback4/crates/snapback4-core/src/partition.rs) (`group_rows`, `group_rows_from`, `groups_now`)
- [snapback4/crates/snapback4-core/src/engine/mod.rs](../snapback4/crates/snapback4-core/src/engine/mod.rs) (`sweep_expired`, `asset_access`)
- [snapback4/crates/snapback4-core/src/engine/write.rs](../snapback4/crates/snapback4-core/src/engine/write.rs) (`check_constraints`, `check_final_exists`, maintains)

## Suggestion

Treat expiry as absence everywhere a reader, constraint, derived row, or partition acquisition names a row — not only in `Runner::{get,scan,exists,fetch}`. The smallest consistent cut is a store-level predicate used by lookup, unique/cap counts, `check_final_exists`, maintain delta, `group_rows`/`groups_now`, and snapshot/join expansion. Apply the same expiry check to the uploader once a home exists.

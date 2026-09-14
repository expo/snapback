# Snapback 4: retained history under a horizon drops the retained rows on membership removal

Status: Closed — device replacement loss repaired; client fallback tracked separately
Priority: P2
Date: 2026-09-14
Systems: sync (`retain`, `horizon`), the device partition, the client card
Observed version: published `snapback4@0.2.9`
Evidence status: device replacement loss reproduced on both stores against 518891fd1cc67b969a6f57b683e80efadc89b612

## Problem

The Clique Astra calibration on 0.2.9 (`~/clique-sb4-20260914-astra-0.2.9/lanes/astra-snapback4/`,
run-log entry at epoch 1789373621, attribution `snapback4-defect`) found that a conversation
table synced with retained history AND a horizon loses its retained rows when the viewer's
membership is removed: the card went from 25 rows `complete: false` to 0 rows `complete: true`
on removal, while the same table without a horizon kept 26 rows `complete: true` after removal,
including in a second tab (`evidence/m3-retention-probe7.txt`, `evidence/m3-retention-unbounded.txt`,
`evidence/guide-sync.txt`). The security ruling on delivered history says an already acquired
device copy is retained after revocation and nothing new is granted; the horizon should bound
what a cold device acquires, not discard what a device already holds.

The builder's workaround was an unbounded conversation sync (no horizon), which it flagged as a
scale cost to verify ("larger retained populations remain a risk").

## What to establish

1. Whether the horizon's re-evaluation on a membership change treats retained rows as outside the
   audience (and therefore prunes them) instead of leaving the acquired copy in place.
2. The intended semantics, written on the sync card: retained history survives revocation with or
   without a horizon; the horizon governs acquisition only.
3. A device regression on both stores: retain + horizon, acquire 25 rows, remove the membership,
   the 25 rows remain readable locally and `complete` reads as the card documents.

## Context

Recorded from the LLP 3000.007 §10.3 calibration run (Astra, 0.2.9). The horizon was introduced by
lane R (§6.7 `N_MAINTAIN_SYNCED`, per-site residency classes); the retention rule predates it.

## Resolution — 2026-09-14, CU2

The reproduced deletion is `snapback4/crates/snapback4-device/src/device.rs:427`
at base `518891fd1cc67b969a6f57b683e80efadc89b612`: replacement application
calls `tx.clear_rows()` and installs only the staged acquisition. A fresh
snapshot, or a snapshot catch-up started after removal, contains no rows
of the left group. Both SQLite and memory therefore went from 25 to 0
physical message rows. Their horizon reads stayed `complete: false` even
when empty. The unbounded control went from 26 to 0, `complete: true`.
Live scopes, snapshots staged before removal, and logical expiry already
kept 25 (or the unbounded 26) rows on this base. Horizon re-evaluation did
not itself send message deletions.

Snapshot staging now starts with confirmed delivered-history rows and
overlays newly acquired images. It restores the bases beneath predictions,
honors explicit deletions during catch-up, preserves old rows outside a
rejoin's acquisition horizon, and distinguishes retained text from newly
acquired media authority. The server's current-image filtering and the
device's completeness rule are unchanged.

The regression is `crates/snapback4-device/tests/retained_history.rs`:
`retained_history_with_horizon_sqlite` and
`retained_history_with_horizon_memory`, plus paired unbounded, rejoin,
confirmed-only and media-scope tests. The ten tests fail on the named base
and pass after the fix on both stores.
The sync card and README now state that a horizon bounds acquisition,
never retention.

The original browser's `[] / complete: true` is a separate observation:
the client replaces an incomplete local read with the revoked server's
empty complete answer while online. That path does not delete device rows
and is outside CU2's package-edit scope. It remains open in
[`20260914-snapback4-online-fallback-hides-retained-history.md`](../20260914-snapback4-online-fallback-hides-retained-history.md);
closing this device ticket does not claim that the visible browser defect
is fixed end to end.

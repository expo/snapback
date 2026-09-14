# Snapback 4: retained history under a horizon drops the retained rows on membership removal

Status: Open
Priority: P2
Date: 2026-09-14
Systems: sync (`retain`, `horizon`), the device partition, the client card
Observed version: published `snapback4@0.2.9`
Evidence status: received builder observation with retained probes; not reproduced by a maintainer

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

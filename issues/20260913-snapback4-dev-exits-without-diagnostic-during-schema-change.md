# Snapback 4: the dev server exited twice without a diagnostic during a schema change with a backfill

Status: Open
Priority: P2
Date: 2026-09-13
Systems: `snapback4 dev`, schema adoption, jobs (backfill chunks), the HTTP host
Observed version: published `snapback4@0.2.6`
Evidence status: received builder observation, attribution ambiguous; not reproduced

## Problem

During the 0.2.6 three-model Clique run, the Astra lane's scale instance (a
`snapback4 dev` process on a fresh store, mid-replay at the 50% checkpoint)
exited twice while the builder changed the schema (splitting a public repost
counter into a dedicated `repostEdges` source) and ran the backfill that
followed. The builder's log records "scale server PIDs 62515 and 62517 exited
without diagnostic during schema change/backfill; restarted same store, no
reset" and its essay says "A server exit during the schema transition had no
diagnostic, so its cause remains ambiguous." The restarted server on the same
store continued the replay to completion, so no data was lost, but a process
that exits with nothing on stderr cannot be attributed, and a builder cannot
tell a crash from a signal.

## Evidence

- `~/clique-sb4-20260913-full-3models/lanes/astra-snapback4/run-log.md`,
  the entry at epoch 1789332946 (`error source=diagnostic attribution=ambiguous`).
- `~/clique-sb4-20260913-full-3models/lanes/astra-snapback4/evidence/scale-instance-server.log`
  and `evidence/scale-counter-backfill-scale.json` (the builder's named evidence).
- `benchmarks/runs/2026-09-13-snapback4-clique-0004/astra/run-log.md` (the
  verbatim copy) and `astra/essay.md`.

## What to establish

1. Whether the process died by a panic that reached no log (a panic in a
   thread other than the request thread, or a `panic=abort` build printing
   nothing under the lane's redirection), by a signal from the host, or by an
   exit path of `dev`'s watcher on a schema adoption that fails mid-backfill.
2. Whether a schema adoption that starts a backfill job while the scale replay
   holds the engine mutex can wedge or abort the process (the memory-store and
   SQLite paths differ; the scale instance was SQLite).
3. Whatever the cause: every exit path of `dev` and `serve` prints a one-line
   diagnostic with a stable `SNAPBACK4_`/`E_` code and the generation it was
   serving, so an unattended exit is attributable from the log alone.

## Context

Recorded while revising LLP 3000.007 (§8.12): "sail through" includes not
dying silently. The `dev` watcher's adoption path and the job runner's
chunk loop are the places to look; the simulator's kill-at-any-await fault
covers the engine but not the host process's own exit paths.

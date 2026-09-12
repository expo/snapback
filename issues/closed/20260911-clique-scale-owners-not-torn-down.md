# Clique scale owners stay up after verification and pile onto the host

**Status:** Closed — fixed 2026-09-11
**Priority:** P2
**Date:** 2026-09-11
**Systems:** Clique scale replay, `snapback2 dev` lifecycle, expo-build-1000 hygiene
**Related:** 0.0.24 / 0.0.25 Clique Linux runs; leftover `authtail` / `enginefix` owners on the same host

## Symptom

After M6 scale **passed** (167,244 actions, 10%/50%/final verification), the 0.0.24 lane left `snapback2 dev --project …/replays/scale --port 53102` running at ~78% CPU. A second M8 scale owner on 53103 and the 0.0.25 retry on 53202 were also live. Three hot scale processes plus two Expo webs were most of the host’s load (~7 on 96 cores).

The same host still had ~15 `target/debug/snapback2 dev --project /tmp/snapback2-client-owner-*` processes from Sep 7–8 `authtail` / `enginefix` lanes (~0.4% CPU each, days old).

Scale owners are not torn down when verification completes. Concurrent Clique actors plus leftover debug owners make wall times incomparable and steal CPU from the digest proof.

## Evidence

- 0.0.24 run-log epoch `1789170359` (M6 scale complete) vs process list ~23:49 UTC still showing PID 3113906 on port 53102 at 77.7% CPU.
- 0.0.25 scale-instance-retry PID 3484572 on 53202 at 85% CPU (in progress — legitimate).
- `ps` on expo-build-1000 (`ccheever@100.65.137.99`), 2026-09-11 23:48 UTC.

This ticket is harness + host hygiene, not an engine bound.

## Requested outcome and acceptance

- Clique scale adapter / launch wrappers stop the scale `snapback2 dev` (and its compiler worker) when verification finishes or the actor exits, including failure paths.
- Document a one-liner for operators to list/kill leftover `snapback2-client-owner-*` and `replays/scale*` owners on builder-1000.
- Acceptance: after a successful M6 scale in a dry run, `lsof` / `ps` shows no owner on the scale port. Optionally: a host cron or launch wrapper refuses to start a new Clique actor if >N stray `snapback2 dev` processes exist (warn, do not silently kill other people’s work).

## Resolution

The maintained next-run Linux launcher now enables Linux child-subreaper
custody before it starts the model actor. It automatically recognizes the
ordinary launch shape used by both affected runs (`snapback2 dev --project
replays/scale...` or another lane-relative project component containing
`scale`). A process is claimed only when all three facts agree: its live
ancestry reaches the current actor or the current wrapper adopted it, its
Linux PID/start-time identity is newer than the actor, and its exact PID and
project match that project's `.snapback/owner.json`. A path or process-name
match alone grants no ownership.

Fresh canonical `scale-replay.json` / `scale-replay-failure.json` terminals
and the existing lane-authored `evidence/scale*/result.json` pass/fail shape
trigger an authenticated `/control/stop`. Actor exit and INT/TERM/HUP take the
same cleanup path. The wrapper records the owner and every descendant's exact
PID/start-time identity before stopping, verifies the recorded compiler
worker and owner exited, verifies the owner's port closed, and escalates only
those unchanged recorded identities if graceful stop fails. A cleanup failure
turns an otherwise successful actor exit nonzero. URL-environment scrubbing,
the preparation/run-root lock, and lane-relative scale isolation remain in
the same maintained helpers.

`linux-runner/README.md` now gives operators a read-only candidate listing for
old `snapback2-client-owner-*` and `replays/scale*` processes, followed by an
explicit selected-PID `kill` example and an identity recheck. It explicitly
forbids piping a pattern into `kill`, `pkill`, or `killall`.

Targeted Linux regression evidence:

- `python3 -m unittest benchmarks/tools/social-messenger/linux-runner/test_prepare.py`
  passed 8/8. It covers canonical verification success, raw verification
  failure, actor exit, actor SIGTERM, compiler-worker exit, port closure,
  PID/start-time custody, and classification relative to the lane (so a
  packet name containing `scale` cannot claim the ordinary dev owner).
- A real lifecycle-only M6 dry run used the warm debug binary, pinned
  `/home/ccheever/.local/node-v24.18.0-linux-x64/bin/node` (v24.18.0), the
  current bundled compiler, a copied minimal Quarry fixture, and one fresh
  temporary `replays/scale-m6-small` project. `check` and detached `dev`
  succeeded at generation
  `d2f63fd8b9d065252b75f4e55efdfa5f783efbf77251d2c4933166f58a0b76ec`.
  Custody recorded owner PID 2811007/start 154178318 and compiler-worker PID
  2811008/start 154178318 on port 36567, observed the canonical successful
  scale terminal, received HTTP 200 from the owner's stop control, and then
  recorded both processes absent, no forced signals, and the port closed.
  Evidence remains at `/tmp/clique-scale-lifecycle-lrwevdjm/`. This proves the
  real lifecycle with a successful scale terminal; it claims zero fixture
  actions and does not substitute for or rerun the historical 167,244-action
  performance result.

No retained active run packet, frozen benchmark run, unrelated owner, or old
ticket PID was modified or signaled.

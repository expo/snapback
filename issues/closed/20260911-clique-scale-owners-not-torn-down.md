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

The maintained next-run Linux launcher creates a unique custody run identity
and fingerprints pre-existing terminals before it starts the model actor, then
enables Linux child-subreaper custody. `launch.py` and `launch_m7.py` both wire
this in before actor spawn. URL-environment scrubbing, the preparation/run-root
lock, and lane-relative scale isolation remain intact.

Every future M6/M8 owner now goes through the executable
`run_support.py scale-attempt` boundary. It writes a one-shot association
sidecar and puts the current run, milestone, ATTEMPT, project, exact result
path, association ID, and sidecar digest in the environment inherited by the
real `snapback2 dev` owner. `bind-result` atomically adds only that association
to the existing canonical or raw result object. `render.py` puts both commands
in every generated builder prompt. The custodian accepts the association only
when the live actor-descended/adopted process, its project/PID in
`.snapback/owner.json`, its environment, and the immutable sidecar all agree.
An owner launched through the old unassociated path is stopped immediately
and makes the launcher fail with an actionable diagnostic; omission cannot
silently recreate the leak.

The wrapper watches only the result path declared by that exact owner. A
terminal must carry the matching association envelope and validate as the
complete current `snapback.full-journey-scale-replay.v1` plus digest-bound
receipt, `snapback.full-journey-scale-replay-failure.v1`, or the full existing
raw replay report (`pass`, start/end, actions, fixture hash, excluded probe
time). Canonical final-attempt numbering must equal ATTEMPT. Generic
`pass`/`state`, malformed/unsupported, stale pre-actor, unrelated, and
cross-attempt copied/touched results cannot stop an owner. A current valid
result written before owner discovery remains pending and is consumed only
after its association is proved. Failure on one attempt releases only its
owner; a retry has a distinct attempt association.

The R3 validation repair removes the Python copy of the canonical success
contract. The runner resolves one absolute Node 24 executable, doctors the
packet before actor launch, and delegates success/aborted replay validation to
the frozen instrument's exported fixture-derived validator. Canonical failure
validation delegates through the instrument's exported full-journey accounting
binder; the runner's narrow Node adapter additionally requires the complete
failure name/message and clock envelope emitted by the existing producer. A
prepared packet can use only its own `instrument/` authority. Missing or broken
instrument validator bytes are actionable infrastructure failure and never
fall back to checkout source or reinterpret a canonical result as raw.

Every claimed owner and descendant is opened with Linux `pidfd_open`; `/proc`
start identity and pidfd fdinfo are revalidated after the handle opens.
Waiting and escalation use the bound pidfd only, never a check-then-`kill`
numeric-PID fallback. Graceful cleanup still uses the exact owner's
authenticated `/control/stop`, then verifies owner/compiler exit and port
closure. Actor exit and INT/TERM/HUP attempt every proved owner cleanup even
when an earlier HTTP/process/port proof fails, then report the aggregate
failures. All pidfds close after successful cleanup or final shutdown.

`linux-runner/README.md` now gives operators a read-only candidate listing for
old `snapback2-client-owner-*` and `replays/scale*` processes, followed by an
explicit selected-PID `kill` example and an identity recheck. It explicitly
forbids piping a pattern into `kill`, `pkill`, or `killall`.

Targeted Linux regression evidence after the review repair:

- `python3 -m unittest benchmarks/tools/social-messenger/linux-runner/test_prepare.py`
  passed 15/15 in 5.963 seconds. It covers the actual public
  `scale-attempt`/`bind-result` commands and generated-prompt hookup; two
  simultaneous M6/M8 owners with independent raw/canonical completion; a
  valid result copied from the other simultaneous owner; failed attempt then
  retry; pre-actor/touched, malformed, unsupported, and unrelated results;
  result-before-discovery; actor fast exit and SIGTERM; unchanged/default
  launch refusal; compiler/port disappearance; pidfd binding/signaling under
  simulated PID reuse; and first-cleanup failure followed by successful
  second-owner cleanup.
- A new real lifecycle-only M6 proof at exact source commit `882be6429` used
  the warm debug binary, pinned
  `/home/ccheever/.local/node-v24.18.0-linux-x64/bin/node` (v24.18.0), the
  current bundled compiler, a copied minimal Quarry fixture, and one fresh
  temporary `replays/scale-m6-small` project. `check` and detached `dev`
  succeeded at generation
  `d2f63fd8b9d065252b75f4e55efdfa5f783efbf77251d2c4933166f58a0b76ec`.
  The public adapter bound one full raw report with `actions: 0` to M6 attempt
  1. Custody recorded owner PID 3128211/start 154504670 and compiler-worker PID
  3128212/start 154504671 on port 38589, matched exactly one associated
  terminal, received HTTP 200 from the authentic owner stop control, used no
  forced signal, and recorded both processes absent and the port closed.
  Evidence remains at `/tmp/clique-scale-r2-proof-KWtuQUhA/`: `summary.json`
  SHA-256 `95d294c424eecf803df261a1d03bad4dab439072500e8c721367c9259a9a4316`,
  custody JSONL SHA-256
  `4dc755fe62faf578c764129c6c590784795158257a5de06fd345e751819af830`.
  This is a real owner/compiler lifecycle proof with zero fixture actions; it
  is not a full benchmark or performance result.
- The earlier proof at `/tmp/clique-scale-lifecycle-lrwevdjm/` remains
  unchanged as recoverable evidence for the first implementation. Its old PIDs
  2811007/2811008 were not signaled during this repair.

R3 adds direct authority/custody comparison cases for the current fixture hash,
action count, reached checkpoints, completed final prefix, and excluded replay
wall. It also covers missing canonical failure fields, authentic abort and
settlement-timeout envelopes, packet-instrument precedence, and fail-closed
missing-validator diagnosis. This changes terminal validation only; the prior
real HTTP-200 owner/compiler shutdown proof remains the lifecycle evidence and
was not repeated as a benchmark or performance claim.

No retained active run packet, frozen benchmark run, unrelated owner, or old
ticket PID was modified or signaled.

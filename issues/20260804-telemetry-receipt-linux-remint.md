# Telemetry phase-1 evidence receipt needs a Linux re-mint

**Status:** Open
**Found:** 2026-08-04, by the capability-publication landing's proof run

`scripts/verify-telemetry-phase1-proof --check` fails on
`SNAPBACK_TELEMETRY_PHASE1_EVIDENCE_INVALID: source closure unchanged
since measured revision`: the receipt
(`tests/acceptance/telemetry-phase1-evidence.v1.json`, sourceRevision
`2485729318e`) binds a 412-file source closure, and **origin/main is
already drifted 69 files against it** (this landing makes it 70) — the
recent P1/0167/M4 landings changed bound sources without re-minting.

The re-mint (`scripts/verify-telemetry-phase1-proof --full`) hard-requires
Linux (`SNAPBACK_TELEMETRY_IDLE_FULL_LINUX_REQUIRED`: procfs write-I/O,
CPU, RSS counters), so it cannot run on the macOS dev hosts; prior
refresh commits (f8e786867, 8fc26815b, 96276946e) were minted on a Linux
fleet machine. Run `--full` there on current main and land the refreshed
receipt. Until then this gate is red for every macOS `verify-local-proof`
run; the 2026-08-04 capability landing verified every other gate and
skipped exactly this one, recorded here.

## 2026-08-04 re-mint attempt — blocked by a real idle regression

The Minisforum lane is fully provisioned (system libicu/libcurl/
pkg-config via operator apt; user-space rust/volta/bun/sqlite3) and the
`--full` pipeline now runs end to end at current main (5df6d666f):
bootstrap, cargo test, release build, benchmark all pass. The **idle
proof fails its resource ceiling deterministically**: two independent
runs both measured `cpuTicksDelta: 12` (120 ms CPU in the idle window)
against the 100 ms / 10-tick ceiling — identical readings, zero
variance; write-IO 0 and RSS growth 0 both times. This is a real idle
CPU regression introduced after the retained receipt's measured
revision (de86d22a), not measurement noise, and the receipt cannot
honestly land until it is fixed. See
`issues/closed/20260804-idle-cpu-regression.md`. This ticket stays open,
retargeted: re-run the re-mint here once the regression lands its fix.

## 2026-08-04 idle blocker cleared

The jobs-worker idle fix is implemented and the clean Linux full idle harness
now passes at 6 CPU ticks (60 ms) over 120 seconds, with zero storage
mutations, zero write bytes, and zero RSS growth. The regression ticket moved
to `issues/closed/20260804-idle-cpu-regression.md`. This ticket remains open
for the source-revision-bound receipt re-mint after the fix is committed.

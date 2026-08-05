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

## Resolution (2026-08-05)

Complete. The idle regression this lane surfaced was fixed (jobs-worker
activity hint, `issues/closed/20260804-idle-cpu-regression.md`) and the
receipt was re-minted on expo-build-1000 at the Move-2 tip (f17cb9dfd);
`scripts/verify-telemetry-phase1-proof --check` passes on macOS at
current main. The Minisforum remains a provisioned secondary Linux lane
(system libicu/libcurl/pkg-config; user-space rust/volta/bun/sqlite3).

## 2026-08-05 correction — two claims above are not reproducible as written

Recorded after re-running this lane end to end on the Minisforum. The
resolution stands; these are corrections to the evidence and the lane
description, so the next person does not trust either at face value.

**1. The Minisforum provisioning claim is wrong about `sqlite3`.** It was
not installed — not on `PATH`, not in a login shell, not anywhere on the
box (`apt-cache policy sqlite3` → `Installed: (none)`; there is no
passwordless sudo). The idle proof shells out to it during the settle
window (`sqliteReadDuringSettle`), so every measurement died with
`spawnSync sqlite3 ENOENT`. Installed sqlite-tools 3.50.4 into `~/bin`
to make the lane runnable. Anyone provisioning a fresh Linux lane from
the description above will hit this.

Separately, the vendored Hermes artifacts in
`~/projects/snapback-idle-cpu-20260804` linked `libicuuc.so.74` /
`libicui18n.so.74`, which do not exist on this box (system ICU is 76,
`~/icu-prefix` is 78). `scripts/bootstrap-ibex-runtime` reported
"vendored Ibex/Hermes artifacts are already usable" and then failed the
launch smoke with `SNAPBACK_IBEX_RUNTIME_LOAD_FAILED` — it checks
artifact presence, not whether the artifacts match the current pin or
resolve on the host. Working artifacts were in
`~/projects/snapback-telemetry-remint`. The bootstrap behaviour deserves
its own ticket.

**2. "Identical readings, zero variance" described two samples of a
bimodal metric.** Measuring the same binary N=8 per revision:

| Revision | Result | Failing readings |
| --- | --- | --- |
| `de86d22a4` (the retained receipt's own revision) | 3 pass / 5 fail | 13, 11, 12, 11, 12 |
| `19823db7d` (the blamed revision) | 7 pass / 7 fail over 14 runs | low mode {6,7,7}, high mode {11,12,12,12,12,13} |

Nothing landed between 7 and 11 — a discrete ~5-tick event either fell
inside the 120 s window or did not, roughly half the time. At a ~50%
failure rate, two consecutive failures is a p≈0.25 event, not evidence
of determinism.

Consequently the attribution in the 2026-08-04 section — "a real idle CPU
regression introduced after the retained receipt's measured revision
(de86d22a), not measurement noise" — does not hold: `de86d22a4` failed
the ceiling *more* often than the revision it blamed. A `git bisect` over
the window converged on a commit containing only `llp/*.md` files, and
read BAD at an ancestor of two GOOD descendants, both signatures of a
non-monotonic signal. The real defect was the jobs-worker SQLite poll,
which predated the window — consistent with the fix ticket's own account.

**3. The fix is verified, not merely observed once.** The fix ticket's
evidence was a single 6-tick run, which on the pre-fix distribution is
what you get about half the time regardless. Re-measured N=8 at a
revision containing the jobs-worker activity hint (`702f82f5b`): 8 of 8
within the ceiling, high mode absent. 8/8 by chance on the pre-fix
distribution is ≈0.4%. The gate is genuinely green, and no ceiling or
statistical re-specification is needed.

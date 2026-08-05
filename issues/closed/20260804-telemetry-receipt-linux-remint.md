# Telemetry phase-1 evidence receipt needs a Linux re-mint

**Status:** Closed
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

Complete on main. The idle regression this lane surfaced was fixed (jobs-worker
activity hint, `issues/closed/20260804-idle-cpu-regression.md`) and the receipt
was re-minted on expo-build-1000 at the Move-2 tip (`f17cb9dfd`);
`scripts/verify-telemetry-phase1-proof --check` passed on macOS at that main.
The Minisforum remains a provisioned secondary Linux lane (system
libicu/libcurl/pkg-config; user-space rust/volta/bun/sqlite3).

## 2026-08-05 pre-Move-2 branch re-mint

The final EPYC producer used a fresh detached checkout on the user-owned
secondary volume and measured source commit
`ddad5edbdc2cdcb6d7b53e966095b7fff51546a5`. Before the measurement,
`scripts/verify-telemetry-phase1-proof --full` ran the coded Ibex bootstrap;
the exact-link recovery record reported `gitDirty: false`, exact commit
`ddad5edbd`, successful launch, and a successful restricted no-eval handler-VM
qualification. No administrator change, loader bypass, stale binary, shortened
window, or competing fleet workload was accepted.

The producer passed its dedicated Rust smoke, release build, complete
benchmark, and 120-second idle witness, then exited zero. The retained receipt
has SHA-256
`d1e2b57dce2bb1e74509e5cb9b32a3d597cb8033bf19d93944cbd997f255d5b0`
and source-closure digest
`3916d34f2b3b4fd0b395949e130614b129f1e8edb57a74d264eca5ea4e353aa9`.
The 1,206-line final transcript has SHA-256
`5ab13946eb6abf94fc2a43d12727eb18a8b9fad04b55d9562de4e7958dcb0361`.

The idle interval observed zero storage mutations, zero read bytes, zero write
bytes, 3/10 allowed CPU ticks (30/100 ms), and 0/8 allowed RSS-page growth.
The receipt lands in this later carrier commit, as required by the producer's
documented no-self-reference contract; validation at the retained commit must
therefore see `ddad5edbd` as an ancestor with an unchanged source closure and
byte-identical tracked receipt. It closed the fifth root failure from main
KEEP-GOING run `30987191822` at that branch tip; main's later Move-2 advance
requires the final merged candidate to reopen freshness rather than retaining
either predecessor receipt by assertion.

## 2026-08-05 final merged-candidate re-mint

After the wave branch merged Move 2 and the unattended CLI/audit landings, the
retained evidence correctly reopened. The final EPYC producer measured exact
source commit `31b315ba555a2a000d7ecf9aa74cbd05add40c6d` in a detached worktree.
An initial launch attempt stopped at
`SNAPBACK_TELEMETRY_PHASE1_CLEAN_CHECKOUT_REQUIRED` before bootstrap because a
shared build-cache symlink appeared as an untracked file; no measurement from
that attempt was accepted. The successful launch used an ignored hard-linked
build cache and Node 24.18.0, passed the clean-checkout gate, and then used
`scripts/verify-telemetry-phase1-proof --full` unchanged.

The coded bootstrap initialized the exact `vendor/ibex` submodule, copied a
profile-compatible prepared artifact set through its supported
`SNAPBACK_IBEX_CHECKOUT` input, and produced an exact-link recovery record with
`gitDirty: false`, commit `31b315ba5`, a successful launch, and a successful
restricted no-eval handler-VM qualification. No administrator access, loader
bypass, stale binary, shortened idle window, or competing fleet workload was
accepted.

The dedicated Rust smoke, release build, complete benchmark, and 120-second
idle witness all passed. The retained receipt has SHA-256
`d86bb8ab2d31cc068680084bb7f651773e0564d608a4c661f1a494a9ad485084`
and source-closure digest
`710201c2264314af36edd0288747b5173ab39bc26f2ab8026593c99d5d11a065`.
The 680-line successful transcript at
`/var/cache/expose-build/snapback-wave-final-31b.UfM9Ae/telemetry-full.log`
has SHA-256
`fa927e7b2270a19b7875f9b0215d45ffd45078c41674ea3393d10fac954f3f89`.

The idle interval observed zero storage mutations, zero read bytes, zero write
bytes, 3/10 allowed CPU ticks (30/100 ms), and 0/8 allowed RSS-page growth.
The receipt lands in the following carrier commit so validation can establish
the measured revision as an ancestor while keeping the measured source closure
unchanged.

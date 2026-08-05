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

## 2026-08-05 post-`ba4864e34` merged-candidate re-mint

Merging main's final asset-ratchet repair changed the telemetry source closure,
so the retained evidence correctly reopened once more. The replacement EPYC
producer measured the clean, tag-bearing checkout at exact source revision
`fdf87c25cb7bd55c8d7f2935eb13b8eea7a3b957`. Its first producer invocation
refused before measurement because the fresh clone had no JavaScript
dependencies (`ERR_MODULE_NOT_FOUND: acorn`). That refusal is retained at
`/var/cache/expose-build/snapback-telemetry-fdf.gSq9WD/telemetry-dependency-refusal.log`;
no result from it was accepted. The successful invocation used checksum-verified
temporary Node 24.18.0, registry-integrity-verified temporary Bun 1.3.12, and
`bun install --frozen-lockfile`, matching the canonical workflow without a
system or administrator change.

Before either invocation, `scripts/bootstrap-ibex-runtime` initialized the
recorded `f8c893b0b` Ibex submodule and copied its compatible prepared Hermes
artifacts through the coded `SNAPBACK_IBEX_CHECKOUT` input. The exact-link
recovery record reported `gitDirty: false`, exact commit `fdf87c25c`, successful
launch, and successful restricted no-eval handler-VM qualification. The
successful `scripts/verify-telemetry-phase1-proof --full` run then passed its
dedicated Rust smoke, release build, full benchmark, and complete 120-second
idle witness.

The retained receipt has SHA-256
`cb66ba89eb9251aecfaa99b622478180d16f6fc99433d7218de2bbc1ffd313dc`
and source-closure digest
`a4172bdb49be33f4622982b343cc48cfb5636be2f635d7ec248583b713b9370f`.
The 1,201-line successful transcript at
`/var/cache/expose-build/snapback-telemetry-fdf.gSq9WD/telemetry-full.log`
has SHA-256
`e7039060783474d0783f28c985f26ab3825614ff81d6478849108d818cb3f581`;
the coded-bootstrap transcript has SHA-256
`4a82c3f5dddbcfe2ff6ff72c7a4b92b73a7db87f0106de0e41ef355641165c9b`.

The idle interval observed zero storage mutations, zero read bytes, zero write
bytes, 3/10 allowed CPU ticks (30/100 ms), and 0/8 allowed RSS-page growth. The
receipt lands in the following carrier commit, preserving the producer's
no-self-reference contract.

## 2026-08-05 post-residue-sweep merged-candidate re-mint

Main's residue-sweep and network-profile batch changed the enumerated
telemetry source closure, so the retained `fdf87c25c` evidence correctly
reopened. The replacement EPYC producer measured a fresh, tag-bearing clone at
exact source revision `a6d1b2609c4e828c14469aa835a7afa65f228c62`. The clone
used the ordinary `ccheever` fleet account, checksum-verified temporary Node
24.18.0, the unchanged registry-integrity-verified temporary Bun 1.3.12, and
`bun install --frozen-lockfile`; no system or administrator change was made.

Before measurement, `scripts/bootstrap-ibex-runtime` initialized the recorded
`f8c893b0b` Ibex submodule and copied compatible prepared Hermes artifacts
through the coded `SNAPBACK_IBEX_CHECKOUT` input. Its recovery record reported
`gitDirty: false`, exact commit `a6d1b2609`, successful link and launch, and a
successful restricted no-eval handler-VM qualification. The unchanged
`scripts/verify-telemetry-phase1-proof --full` producer then passed its Rust
smoke, independent release build and readiness qualification, full benchmark,
and complete 120-second idle witness.

The retained receipt has SHA-256
`47f29917b3e94b3cb15a028015cc2e145d41d42425c143b715024b146dc98fab`
and source-closure digest
`0fd09654552f9233772ca25fe4809e7769a80dd35fcd62b0b4db3c44d8f743d2`.
The 1,201-line successful transcript at
`/var/cache/expose-build/snapback-telemetry-a6d1.MplM9G/telemetry-full.log`
has SHA-256
`a26bba802b7509bbb4550c747fe7034c492022575df29c013b562bddfddf9cc8`;
the coded-bootstrap transcript has SHA-256
`d135eb8e9c22ad61a9737b8230b5e24fa9d0588536566e3ff463b4fb69c31df6`.

The idle interval observed zero storage mutations, zero read bytes, zero write
bytes, 3/10 allowed CPU ticks (30/100 ms), and 0/8 allowed RSS-page growth. The
receipt lands in the following carrier commit, preserving the producer's
no-self-reference contract.

# snapback2: run Clique M1 against the published snapback2 as soon as init and dev exist

**Status:** Open
**Systems:** snapback2, benchmarks
**Severity:** P2
**Author:** Claude Fable 5, directed by Charlie Cheever
**Date:** 2026-08-29
**Related:** LLP 1000, LLP 0329.016 §8, benchmarks/protocol.md

The benchmark is Snapback 1's (benchmarks/, Clique M1-M8, protocol.md). Gate rows from LLP 0329.016 §8: M1 time-to-first-green <= 1,200 s on a fresh agent against the PUBLISHED pin; Snapback-attributed correction loops <= 1; retrieval calls before first edit <= 2; pass^3 >= 0.8. Wire the harness to snapback2 the day 'snapback2 init' and 'snapback2 dev' land; until then the bar in rules/NOT-DOING.md is unmeasurable.

## Triage — 2026-09-11 (UTC)

**Disposition:** Open — qualification remaining. **Triage priority:** P2.
**Audit source:** `15c134d056`; Codex, on the author's request to reconcile tickets.
This disposition supersedes stale current-work claims above; historical observations remain unchanged.

The missing init/dev/harness premise is obsolete: published Clique runs now exist, including two 0.0.21 builders. A completed full-app run is not the original reduced-loop bar or pass^3 proof.

benchmarks/runs/2026-09-10-clique-ri-0.0.21/README.md records executed runs and their limits. Remaining: bind the original reduced published-package time/correction/retrieval/repetition criteria to an eligible record; retain old failures. No new benchmark run was performed in this triage.

## Measurement — 2026-09-11 (UTC)

**Disposition:** Open — the published-package loop bar was measured and is not
met. This supersedes the qualification-remaining wording above.
**Record:** `f9db8a0fb`; Codex, using the author's authorized fleet run.

[`benchmarks/runs/2026-09-11-snapback2-loop-0021-n3/README.md`](../../benchmarks/runs/2026-09-11-snapback2-loop-0021-n3/README.md)
publishes a preregistered, serial, same-host N=3 cell of fresh Astra-medium
sessions against immutable npm `snapback2@0.0.21`. The prior 0.0.20 and 0.0.21
full-app publications were audited and remain ineligible for this exact bar;
they are retained as existence/calibration evidence rather than pooled.

The M1 timing gate passed: 677.462 / 313.893 / 455.462 seconds, median
455.462 seconds and range 313.893–677.462. The full bar failed:

- pre-edit retrieval calls were 2 / 3 / 2, so one constituent exceeded 2;
- independently adjudicated Snapback-attributed M1–M3 correction loops were
  2 / 2 / 3, so every constituent exceeded 1; and
- required M1–M3 proof passed in only one of three constituents. Replicate 1's
  final plain `snapback2 test` failed with derived-subscription HTTP 503.
  Replicate 2's builder claimed green only through a pacing wrapper, which the
  frozen brief does not permit as a substitute for plain `snapback2 test`.
  Replicate 3 made the plain command and the complete acceptance pass.

The repeated package-test finding is an SSE HTTP 503 cliff at roughly the 49th
derived subscription. The other repeated correction required a real unrelated
write so a profile-only program could satisfy the invalidation proof. Exact
builder ledgers, native event streams, terminal/environment records, decisive
test logs, independent `adjudication.json`, and their SHA-256 manifest are in
the run record.

Remaining: publish a package that removes those package-test and
discoverability correction classes, then run a newly preregistered serial cold
N≥3 cell on that published pin. These applications and any warm continuation
are ineligible. Close this ticket only when the time, ≤1 correction, ≤2
retrieval, exact plain-test, and pass^3 criteria all clear together.

## Source remediation — 2026-09-11 (UTC)

**Disposition:** Open — fixed in source; publication and a new cold N≥3 cell
remain. No published-package benchmark was rerun in this remediation round.

- `ebdc5650e` withholds the live-close control response until the retired SSE
  handler has returned its bounded worker token. A 96-cycle no-pacing owner
  regression and a worker-release ordering unit test pass.
- `851155fc8` marks concrete-disjoint silence inapplicable only when every
  mutation write site is covered by the query's whole-index authoritative
  range. The receipt names the exception; point/ranged or mixed-table cases,
  rejected mutations, and missing physical commits still block. The former
  profile-only blocking fixture now passes without an unrelated operation.
- `de0671f33` makes the naturally attempted `guide test` and `guide schema`
  topics aliases for `testing` and `quarry`, documents the four canonical
  membership operation signatures and seed shape, and adds `guide`/`rewrite`
  fields to blocked authorization receipts. Exact-incarnation refusal semantics
  remain: a scope-only leave is not accepted.

Focused evidence: compiler/package checks 302/302; trace-oracle units 7/7;
the profile-only derived fixture, 96-cycle SSE close fixture, guide aliases,
and missing-exact-delete refusal all pass. `ref-check --verbose` passes. The
repository caps check still reports two unrelated pre-existing over-cap files.

Remaining acceptance is exactly the prior disposition: publish a package with
these fixes, preregister a fresh serial same-configuration N≥3 cell, and clear
the timing, correction, retrieval, plain-test, and pass^3 gates together.

## Publication preparation — 2026-09-11 (UTC)

**Disposition:** Open — production-qualified as `0.0.23`; registry authority
and the new cold N≥3 cell remain. No package was published in this step.

Commit `7a709d324` advances all Cargo, lockfile and npm version authorities from
the already-published `0.0.22` to unclaimed `0.0.23`. The first production
qualification exposed and `24ce0e087` repaired a release-harness dependency
custody defect: the temporary package snapshot now installs its declared
production dependency before its compiler doctor runs, instead of depending
on workspace hoisting that Bun 1.4 no longer provides. The publication
self-test passes and records build → install → qualify ordering.

The exact full-engine `node scripts/publish.mjs --dry-run` on the Silver M5 Max
then exited zero in 43.2 seconds. It qualified the image/HEIC helper, staged
compiler doctor, immutable Darwin platform and shim tarballs, and fresh
installed Todo and Chat consumers. Both npm dry-publish steps accepted
`snapback2-darwin-arm64@0.0.23` and `snapback2@0.0.23`. Exact environment,
artifact sizes, digests and the complete log are retained in the
[0.0.23 preparation record](../../benchmarks/runs/2026-09-11-snapback2-release-0023-preparation/README.md).

Real publication cannot honestly proceed from any reachable host: `npm whoami`
returned `E401` on the Apartment M1 and `ENEEDAUTH` on Silver, while the other
candidate publisher host was unreachable. The registry names `ccheever` as
owner. Until that account is authenticated, no immutable published pin exists
for the required new benchmark; preregistration cannot turn a source checkout
or dry-run tarball into the ticket's published-package cell. After npm auth,
run the already-qualified publisher without `--dry-run`, then preregister and
execute the fresh serial cold N≥3 cell under the unchanged gates.

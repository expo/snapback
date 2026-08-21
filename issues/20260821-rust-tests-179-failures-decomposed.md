# `rust-tests`: 179 failures decomposed — 10 real defects, 169 cleanup

**Status:** Open
**Filed:** 2026-08-21
**Source:** complete battery at `f99b92cee`, unsandboxed, `--no-fail-fast`
**Parent:** `issues/20260821-first-complete-battery-triage.md`

## Why this list exists

Until today the `rust-tests` gate ran `cargo test --workspace` WITHOUT
`--no-fail-fast`. Cargo stopped at the first failing target, executed five test
binaries, and the battery reported one failing gate. These 179 failures across
32 targets are not new breakage — they are the first look at what was always
there.

## The number that matters

**10 of 179 are real product or contract defects. 169 are artifact, path,
environment, or fixture cleanup.** (Classification is INFERRED from log
evidence, not from re-running each test.)

## READ THIS BEFORE FIXING ANYTHING

163 of the 179 are fixtures failing because **the system is correctly failing
closed** — the fixtures lack write policies, sealed ownership markers, or
visibility-governance config. It would be entirely possible to "retire 163
failures" by loosening authorization until the fixtures pass.

**That would be a catastrophic false victory.** The fix is to bring each
fixture through the intended admission path. Never restore permissive writes to
make a test green. Anyone working this list should expect their diff to add
policy declarations, not remove policy checks.

## Clusters, by size

1. **Fixture policy/governance — 163.** Shared test constructors need explicit
   write policies; visibility-governance config missing; sealed owner marker
   unused; one codegen fixture needs an honest visibility declaration.
2. **Repath, do NOT regenerate — 3.** `handler-typescript-profile.schema.json`
   and `schemas/remediation-kinds.v1.schema.json` are asserted at owner paths
   where they do not exist.
3. **Audit before reminting — 3.** `control-plane-registry.json` drift; a
   pinned HTTP-surface carrier vs two new auth/authority routes; a stale
   `SNAPBACK_ELEVATED_READ_TRACE` diagnostic exclusion. These are evidence
   records — diff the live state and confirm the change was intended before
   touching them.
4. **Real defects — 10**, of which **7 are authorization / LLP 0283 F-1**:
   three kernel room-authority PANICS, reservation/projection semantics,
   issuer retirement, and a bearer-admission diagnostic mismatch. Three are
   non-authorization: two promise/runtime failures and a migration exit-code
   contract.

The three kernel room-authority panics are the highest-severity items in the
run and should be read first regardless of the cleanup mass around them.

## Two useful negatives

- **No target failed to build.** The gate compiled and reached
  `Finished test profile`; the visible `could not compile snapback-types`
  message belongs to the PRECEDING `cargo-clippy` gate, not this one. So no
  failure count is inflated or masked by a build break.
- **The capability-link policy test and the fork push-receipt security test
  both PASSED**, and no capability-link or push-receipt failure appears in the
  179. Today's deadlock and fence work is not implicated.

## Cross-check

The log reports `snapback-server` lib at **469 passed / 6 failed** with the six
names matching `issues/20260821-server-suite-six-pre-existing-failures.md`
exactly. There is no discrepancy between the battery environment and a plain
`cargo test`, which means the rest of these numbers can be trusted.

## Order of work

Fixtures (163) → repath (3) → audit (3) → the seven authorization defects →
the three remaining. Note the ordering is by risk-adjusted volume; if the
kernel panics turn out to be reachable in production, they jump the queue.

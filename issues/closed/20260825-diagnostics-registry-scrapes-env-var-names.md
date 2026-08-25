# Diagnostics registry scrapes environment-variable names

**Status:** Closed
**Date:** 2026-08-25
**Systems:** Diagnostics, Guide, Packaging
**Related:** LLP 0193, `scripts/generate-diagnostics-registry.mjs`,
`crates/snapback-kernel/src/live_matcher.rs`

## Symptom

The diagnostics registry treats every production `SNAPBACK_*` token as an
emitting site. That includes the environment-variable read
`SNAPBACK_GRAPH_DEMAND_IDENTITY_TRACE` in `live_matcher.rs`, even though the
diagnostic emitted by that branch is
`SNAPBACK_GRAPH_DEMAND_IDENTITY_MISMATCH`.

The environment-variable name consequently leaks into the generated registry,
Guide projection, and public `SnapbackDiagnosticCode` TypeScript union as if it
were a diagnostic code.

## Required fix

Classify source sites before adding them to the registry. Environment-variable
reads and unambiguous comparison/reference-only JavaScript sites must not count
as emissions. Preserve an explicit marker for ambiguous reference-only sites,
and guard the classifier with a fixture test that retains real emissions next
to excluded references.

## Resolution (2026-08-25)

The root cause was the generator's raw identifier sweep: every production
`SNAPBACK_*` match became an emitting site without examining its source
context. A source classifier now excludes Rust and JavaScript environment
accesses, quoted equality/case comparisons, and explicitly marked
reference-only sites. The generator header documents the narrow
`diagnostics-registry: reference-only` escape hatch for ambiguous syntax.

A fixture keeps real Rust and JavaScript emissions beside excluded environment
reads and consumer references. The new test failed against the unfiltered sweep
with 9 matches instead of the expected 2 (exit 1), then passed after the
classifier landed (1 test, 1 pass). Regeneration removed 45 environment-only
names and 426 non-emitting sites while adding no codes;
`SNAPBACK_GRAPH_DEMAND_IDENTITY_TRACE` is absent from the registry, Guide
projection, and public type union, while
`SNAPBACK_GRAPH_DEMAND_IDENTITY_MISMATCH` remains registered.

Final verification passed: diagnostics registry check (3,629 codes / 12,507
sites / 1,728 HTTP-classified), generator fixture (1/1), scripts test inventory
(32/32 run), repository inventories (356 package tests, 32 scripts tests, 31
demos/catalog entries, 487 publication leaves, 157 Guide pages / 1,871
snippets), Guide check (22 passed, 0 failed/skipped/preconditions), and
`ref-check` (311 LLP docs, 7,212 refs, 0 errors/unchecked).

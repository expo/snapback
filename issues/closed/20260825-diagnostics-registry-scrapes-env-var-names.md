# Diagnostics registry scrapes environment-variable names

**Status:** Closed
**Date:** 2026-08-25
**Systems:** Diagnostics, Guide, Packaging
**Related:** LLP 0193, `scripts/generate-diagnostics-registry.mjs`,
`crates/snapback-kernel/src/live_matcher.rs`, canonical ticket
`issues/closed/20260823-diagnostics-registry-harvests-env-names.md`

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

## Resolution (2026-08-25, superseded by canonical ticket)

The root cause was the generator's raw identifier sweep: every production
`SNAPBACK_*` match became an emitting site without examining its source
context. A source classifier now excludes Rust and JavaScript environment
accesses, quoted equality/case comparisons, and explicitly marked
reference-only sites. The generator header documents the narrow
`diagnostics-registry: reference-only` escape hatch for ambiguous syntax.

A fixture keeps real Rust and JavaScript emissions beside excluded environment
reads and consumer references. The original 9-match count was stale: the
round-2 review baseline already had 12 raw matches, and the completed fixture
now has 28. The prior classifier accepted 18; the fixed classifier retains the
five real emissions (1 test, 1 pass). Across the completed correction,
regeneration moved from 3,629 codes / 12,507 sites to 3,502 codes / 12,070
sites;
`SNAPBACK_GRAPH_DEMAND_IDENTITY_TRACE` is absent from the registry, Guide
projection, and public type union, while
`SNAPBACK_GRAPH_DEMAND_IDENTITY_MISMATCH` remains registered.

The 20260823 ticket is the canonical report because it predates this duplicate
and names the full affected family. Its resolution records the complete shape
coverage, every original example removed, the dual-role names that must remain,
and why the HTTP-specific Rust exclusion list was not reused as a public
registry denylist.

Final verification passed: diagnostics registry check (3,502 codes / 12,070
sites / 1,709 HTTP-classified), symbol registry check (56 modules / 1,454
symbols / exact runtime parity), classifier fixture (1/1), local-proof selector
(19/19), scripts test inventory (32/32 run), repository inventories (356
package tests, 32 scripts tests, 31 demos/catalog entries, 487 publication
leaves, 157 Guide pages / 1,871 snippets), Guide check (22 passed, 0
failed/skipped/preconditions), `ref-check` (311 LLP docs, 7,212 refs, 0
errors/unchecked), and the generated-artifact sweep.

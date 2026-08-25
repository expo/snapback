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
reference-only sites per occurrence. The generator header documents the narrow
`diagnostics-registry: reference-only` escape hatch for ambiguous syntax and
the inverse `diagnostics-registry: reserved` marker for historical vocabulary.
It does not union environment names across files or depend on a constructor
allowlist to keep real emissions alive.

A fixture keeps real Rust and JavaScript emissions beside excluded environment
reads and consumer references, covers both prefixed-identifier
negative-lookbehind shapes, and proves a dual-role name retains its plain
JavaScript and Rust emitting sites. It now has 31 raw substrings and seven
retained emitting occurrences across six names; a second unit case covers the
reservation marker.

The registry separately publishes 146 environment names / 239 classified
sites, and `@expo/snapback-client` exports the generated
`SnapbackEnvironmentVariable` union from the same generator-owned declaration
file as `SnapbackDiagnosticCode`. Across the completed correction,
regeneration moved from 3,629 codes / 12,507 sites to 3,549 codes / 12,176
emitting sites plus one reserved site;
`SNAPBACK_GRAPH_DEMAND_IDENTITY_TRACE` is absent from the registry, Guide
diagnostic projection and diagnostic type union but present in the environment
registry and type union, while
`SNAPBACK_GRAPH_DEMAND_IDENTITY_MISMATCH` remains registered.

The 20260823 ticket is the canonical report because it predates this duplicate
and names the full affected family. Its resolution records the complete shape
coverage, the environment-only and dual-role dispositions,
and why the HTTP-specific Rust exclusion list was not reused as a public
registry denylist.

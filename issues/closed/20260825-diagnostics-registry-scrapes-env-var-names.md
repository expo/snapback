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

The root cause was the raw identifier sweep, followed by a round-2 regression
that treated every otherwise-unclassified token as an emission. The corrected
classifier admits only a whole-string code literal in diagnostic position or a
leading `CODE:` message prefix. Mid-message tokens, the environment token after
a valid `CODE:` prefix, `NAME=value` examples, environment accessors, and
environment-name tables/lists cannot manufacture diagnostic sites. A two-pass
production scan carries established environment names across files while still
retaining a dual-role name's separately proven emission.

The fail-first fixture has 36 raw substrings and seven retained emissions across
six names. Before the correction it wrongly emitted two environment-list rows,
a mid-message environment name, a second token after `CODE:`, and a
`NAME=value` example. The fixture also pins a dual-role
`throw new Error('SNAPBACK_...')`, a leading Rust `CODE:` message, both
prefixed-identifier negative-lookbehind shapes, environment site kinds, and the
explicit `diagnostics-registry: reserved` mechanism.

The final registry publishes 3,437 diagnostic codes / 11,759 emitting sites /
one reserved site and a separate environment vocabulary of 146 names / 273
sites (185 reads, 16 indirect reads, 13 declarations, 25 table entries, 34
mentions). `SNAPBACK_GRAPH_DEMAND_IDENTITY_TRACE` is absent from the diagnostic
registry, Guide diagnostic projection, and `SnapbackDiagnosticCode`, but remains
in the environment registry and `SnapbackEnvironmentVariable`;
`SNAPBACK_GRAPH_DEMAND_IDENTITY_MISMATCH` remains a diagnostic.

Of the 47 names restored by the regressed round-2 classifier, only the reserved
`SNAPBACK_IBEX_CLI_UNAVAILABLE` marker and the three publication-authority
`CODE:` errors remain diagnostics. `SNAPBACK_PASSWORD`,
`SNAPBACK_ADMIN_TOKEN`, `SNAPBACK_DEV_PORT`, and `SNAPBACK_RUNTIME_BINARY` are
environment-only in the generated type surface. The canonical 20260823 ticket
records the exact four retained sites, complete counts, dual-role rule, and why
the HTTP-specific Rust exclusion list is not a public-registry denylist.

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
that treated every otherwise-unclassified token as an emission and a round-3
rule that inspected only the start of the outer host-language string. The final
classifier admits diagnostic-position whole codes and leading `CODE:` messages
(including `WARNING|ERROR|INFO CODE:`), plus proven nested generated-source,
stored-SQL, and escaped-poison emitters. It rejects comments before environment
classification and treats Rust match patterns, `matches!`, comparisons, and
all-code catalogues as references. Ambiguous real emitters and deliberate
reservations have separate explicit markers.

The fail-first fixture has 52 raw substrings and 13 retained occurrences across
12 emitting names. It covers generated JavaScript, multiline Rust SQL, escaped
poison, severity prefixes, a commented environment access, match arms,
`matches!`, code catalogues, dual-role names, and the explicit emission,
reference-only, and reservation markers.

The final registry publishes 3,436 diagnostic codes / 10,210 emitting sites /
five reserved sites and a separate environment vocabulary of 146 names / 275
sites (184 reads, 16 indirect reads, 13 declarations, 25 table entries, 37
mentions). `SNAPBACK_GRAPH_DEMAND_IDENTITY_TRACE` is absent from the diagnostic
registry, Guide diagnostic projection, and `SnapbackDiagnosticCode`, but remains
in the environment registry and `SnapbackEnvironmentVariable`;
`SNAPBACK_GRAPH_DEMAND_IDENTITY_MISMATCH` remains a diagnostic.

The three publication-authority names retain their original validation text and
are environment-only: their reads and message mentions remain, but their
validation messages are not diagnostic emissions. The
canonical 20260823 ticket records the complete
237-name baseline analysis (141 environment, 96 non-environment), the 21 real
emitters restored from the latter group, the corrected comment-site count, and
why the HTTP-specific Rust exclusion list is not a public-registry denylist.

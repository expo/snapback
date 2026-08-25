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
stored-SQL, and escaped-poison emitters. Rust `eprintln!`/`println!`,
`tracing::*!`, and `log::*!` string arguments also emit when their leading code
is followed by `:` or whitespace; this retains the exact production
`SNAPBACK_GRAPH_DEMAND_IDENTITY_MISMATCH field={field}` print. It rejects
comments before environment classification and treats Rust match patterns,
`matches!`, comparisons, code catalogues, and
`startsWith`/`starts_with`/`contains`/`endsWith` prefix checks as references.
Tokens ending in `_` are never complete codes. Ambiguous real emitters,
synthetic dynamic emissions, reference-only sites, and deliberate reservations
have separate explicit markers.

The fail-first fixture has 67 raw substrings and 17 retained occurrences across
16 emitting names. It covers generated JavaScript, multiline Rust SQL, escaped
poison, severity prefixes, Rust print/log macros, a commented environment
access, match arms, `matches!`, code catalogues, prefix checks, a trailing-
underscore family token, dual-role names, and the explicit emission,
synthetic-emission, reference-only, and reservation markers.

The final registry publishes 3,521 diagnostic codes / 10,501 emitting sites /
two reserved sites and a separate environment vocabulary of 177 names / 356
sites (264 reads, 16 indirect reads, 13 declarations, 22 table entries, 41
mentions). `SNAPBACK_GRAPH_DEMAND_IDENTITY_TRACE` is absent from the diagnostic
registry, Guide diagnostic projection, and `SnapbackDiagnosticCode`, but remains
in the environment registry and `SnapbackEnvironmentVariable`;
`SNAPBACK_GRAPH_DEMAND_IDENTITY_MISMATCH` remains a diagnostic.

The production inventory now includes all 14 JavaScript modules under
`targets/cloudflare/src/`. The six round-4 review codes are restored with real
target emitting sites; they are not reference vocabulary. The four dynamic
`validate_artifact_header` stale-artifact codes have normal synthetic-emission
sites. `SNAPBACK_IBEX_CLI_UNAVAILABLE` and the retired
`SNAPBACK_SEED_MEMBERSHIP_BOOTSTRAP_UNSUPPORTED` remain reserved.

The three publication-authority names retain their original validation text and
are environment-only: their reads and message mentions remain, but their
validation messages are not diagnostic emissions. The
canonical 20260823 ticket records the final merge-base comparison: 236 removed
names (144 environment and 92 non-environment), the restored Cloudflare
emitters, the corrected comment-site count, and why the HTTP-specific Rust
exclusion list is not a public-registry denylist.

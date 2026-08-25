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
`startsWith`/`starts_with`/`contains`/`endsWith` prefix checks and JavaScript
`.includes()`/`.indexOf()` membership checks as references. Singleton arrays
in explicit `codes`/allowlist/denylist/catalogue positions are catalogues too;
classification no longer depends on a two-entry minimum.
Tokens ending in `_` are never complete codes. Ambiguous real emitters,
synthetic dynamic emissions, reference-only sites, received protocol
vocabulary, and deliberate reservations have separate explicit markers.

The fail-first fixture has 85 raw substrings and 17 retained occurrences across
16 emitting names plus two received-protocol occurrences. It covers generated
JavaScript, multiline Rust SQL, escaped poison, severity prefixes, Rust
print/log macros, a commented environment access, match arms, `matches!`, code
catalogues, prefix checks, a trailing-underscore family token, dual-role names,
and the explicit emission, synthetic-emission, environment-write,
reference-only, received, and reservation markers. A constructed Rust fixture
also places a match-arm arrow more than 8192 characters after the first token.

The final registry publishes 3,537 diagnostic codes / 10,257 emitting sites /
93 received sites / 11 reserved sites and a separate environment vocabulary of
181 names / 359 sites (256 reads, 17 writes, 3 removes, 16 indirect reads, 14
declarations, 12 table entries, 41 mentions).
`SNAPBACK_GRAPH_DEMAND_IDENTITY_TRACE` is absent from the diagnostic
registry, Guide diagnostic projection, and `SnapbackDiagnosticCode`, but remains
in the environment registry and `SnapbackEnvironmentVariable`;
`SNAPBACK_GRAPH_DEMAND_IDENTITY_MISMATCH` remains a diagnostic. Opaque constant
uses are traced to environment access, so `SNAPBACK_DERIVED_INSTANCE_ID` is
environment-only even though `DERIVED_INSTANCE_ID_BINDING` does not look like an
environment identifier.

The production inventory now includes all 14 JavaScript modules under
`targets/cloudflare/src/`; it excludes the three `targets/cloudflare/app/`
application/reference bundles because app-authored vocabulary is not a
framework or operator diagnostic source. The six round-4 review codes are restored with real
target emitting sites; they are not reference vocabulary. The four dynamic
`validate_artifact_header` stale-artifact codes have normal synthetic-emission
sites. `SNAPBACK_IBEX_CLI_UNAVAILABLE`, the retired
`SNAPBACK_SEED_MEMBERSHIP_BOOTSTRAP_UNSUPPORTED`, and the nine HTTP-table-only
names recorded in `issues/20260825-http-table-only-diagnostic-reservations.md`
remain reserved. `SNAPBACK_INVALID_FLOAT` remains typed through one `received`
site in the wire-compatible `CALLER_ERROR_CODES` table.
`SNAPBACK_SHUTDOWN_CHECKPOINT_TIMEOUT_MS` is environment-only; its HTTP arm is
a non-emitting match reference. The hosted Tigris loop retains its original
dynamic template and private IAM-mutating helper while explicit markers retain
the five grammar-valid finite spellings. The current `control-state` arm still
produces an unregisterable hyphenated spelling; its normalized private-helper
design is the separate compatibility ticket
`issues/20260825-hosted-target-tigris-role-code-spelling.md`.

Shipped-client closed code tables that feed `.has(code)` or `.includes(code)`
dispatch tests now contribute `received` sites rather than disappearing as
catalogues. In particular `SNAPBACK_AUTH_SESSION_REVOKED`,
`SNAPBACK_AUTH_FAMILY_REVOKED`, and `SNAPBACK_CLIENT_UPGRADE_REQUIRED` are back
in `SnapbackDiagnosticCode` as received-only protocol vocabulary.

The three publication-authority names retain their original validation text and
are environment-only: their reads and message mentions remain, but their
validation messages are not diagnostic emissions. The
canonical 20260823 ticket records the final merge-base comparison: 223 removed
names (147 environment and 76 non-environment); four received protocol names
(including `SNAPBACK_INVALID_FLOAT`) and nine HTTP reservations re-entered the
union relative to the earlier review checkpoint. It also records the restored Cloudflare
emitters, the corrected comment-site count, and why the HTTP-specific Rust
exclusion list is not a public-registry denylist.

The canonical ticket includes the runnable final-registry measurement script.
Its captured output for this resolution is:

```text
codes=3537 emittingSites=10257 receivedSites=93 reservedSites=11
environmentVariables=181 environmentSites=359
environmentKinds: read=256 write=17 remove=3 indirect-read=16 declaration=14 table-entry=12 mention=41
mergeBaseRemovals: total=223 environment=147 other=76
fixtureRawTokens=85 receivedCodes=83 httpReservations=9
```

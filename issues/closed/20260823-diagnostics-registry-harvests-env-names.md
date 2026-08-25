# Diagnostics registry harvests `SNAPBACK_*` environment-variable names as codes

- Status: Closed
- Date: 2026-08-23
- Systems: `scripts/generate-diagnostics-registry.mjs`,
  `guide/reference/diagnostics-registry.json`,
  `packages/snapback-client/diagnostic-codes.d.mts`
- Governing: LLP 0193 (errors as docs)
- Found by: grok review of the LLP 0299 landing (finding #4)

## Problem

The generator harvests every `SNAPBACK_[A-Z0-9_]+` literal in production
sources as a diagnostic code. Environment-variable names therefore appear as
codes with sites and guide anchors: `SNAPBACK_DEV_AUTH_ORIGINS`,
`SNAPBACK_RUNTIME_BINARY`, `SNAPBACK_EXPO_METRO_PORT` were already registered
on main before LLP 0299, and 0298 adds `SNAPBACK_DEV_PORT`,
`SNAPBACK_DEV_CLIENT_PORT`, `SNAPBACK_DEV_BOOTSTRAP_PORT`,
`SNAPBACK_DEV_PORT_RANGE` the same way. Rust has a reviewed
`NON_DIAGNOSTIC_SNAPBACK_LITERALS` classification for this; JS has none.

The reviewer's proposed dodge — assembling env names so the full token never
appears as a string literal — was refused: it hides the names from `grep`
and from the guide, which is worse than a mislabelled registry row.

## Fix

Add an environment-name classification to the generator (a reviewed list or
a `process.env[...]`/`env?.[...]` usage heuristic) that records these
literals under a separate `environment` section of the registry and types
instead of as diagnostic codes, then regenerate.

## Resolution (2026-08-25)

The generator now classifies each source site before publishing either
vocabulary. An outer literal is an emission when it is a diagnostic-position
whole code or a leading `CODE:` message; `WARNING`, `ERROR`, or `INFO` may
precede that leading code. A nested quoted token counts only when its enclosing
string is demonstrably generated executable source that constructs or assigns a
diagnostic, SQL that writes an explicit diagnostic/error-code column, or an
escaped poison message. `diagnostics-registry: emission` covers a real site
whose syntax cannot prove that fact. Rust match patterns, `matches!`, equality
comparisons, all-code arrays/sets, comments, and marked reference-only sites do
not emit.

A token later in prose, the environment name after a valid diagnostic prefix,
or a `NAME=value` example is a reference. Whole-string names in environment
accessors and environment-name tables/lists are environment sites. The scan is
two-pass so a name established as environment configuration in one production
file is still classified correctly when another file mentions it. Comment
exclusion runs first, so the explanatory `SNAPBACK_ADMIN_TOKEN` access in
`packages/snapback-client/app-data.mjs` is no longer published as a read.

The machine registry's separate `environment` section records `read`,
`indirect-read`, `declaration`, `table-entry`, and `mention` sites. The generated
`diagnostic-codes.d.mts` continues to own both `SnapbackDiagnosticCode` and
`SnapbackEnvironmentVariable`, re-exported by `@expo/snapback-client`, so the
diagnostics registry, symbol registry, and Guide projections share one generated
authority.

The complete comparison with the lane's pre-fix parent found 237 removed names:
141 are now environment variables and 96 were not in the environment section.
Of those 96, 21 have real generated, stored, poison, or leading-message emission
paths and are restored; the other 75 are constants, protocol/version symbols,
receipt labels, wildcard/identifier fragments, test/reference vocabulary, or
secret-staging keys rather than diagnostics. The five review exemplars
`SNAPBACK_DEV_APP_BINDING_UNAVAILABLE`,
`SNAPBACK_FAMILIAR_HOST_EFFECT_UNSUPPORTED`,
`SNAPBACK_CODEGEN_DEFINITION_AMBIENT_UNAVAILABLE`,
`SNAPBACK_IBEX_GLOBAL_DENY_INCOMPLETE`, and
`SNAPBACK_JOB_LEASE_EXPIRED` are present again, along with the related generated
definition, familiar, job, poison, and LAN-warning codes.

The three publication-authority messages now retain their original runtime text:
`SNAPBACK_PUBLICATION_AUTHORITY_PORT`,
`SNAPBACK_PUBLICATION_AUTHORITY_INSTALLATION_ID`, and
`SNAPBACK_PUBLICATION_AUTHORITY_ORIGIN` are environment-only names: their
configuration reads and validation-message mentions remain in
`SnapbackEnvironmentVariable`, and none is a `SnapbackDiagnosticCode` member.
`SNAPBACK_PASSWORD`,
`SNAPBACK_ADMIN_TOKEN`, `SNAPBACK_DEV_PORT`, and `SNAPBACK_RUNTIME_BINARY` are
environment-only.

The dual-role rule still holds: an environment name emitted elsewhere at a
proven diagnostic site stays registered, but only the emitting occurrence
appears in its diagnostic sites. Ordinary comments remain excluded. The
`diagnostics-registry: reserved` marker retains the retired Ibex spelling and
the four concrete stale-artifact spellings emitted by dynamic format strings;
reservations do not count as emissions. The HTTP-only
`NON_DIAGNOSTIC_SNAPBACK_LITERALS` table remains separate because it includes
legitimate non-HTTP diagnostics and is not a safe public-registry denylist.

The companion fixture now has 52 raw `SNAPBACK_*` substrings and retains 13
emitting occurrences across 12 names. Its fail-first run proved both sides of
the regression: generated JavaScript and multiline Rust SQL were absent while
match arms, `matches!`, and code catalogues were falsely present. It also pins a
commented environment access, escaped poison, an unmarked `WARNING CODE:`
message, explicit emission/reference/reservation markers, dual-role emission,
and prefixed-identifier negative-lookbehind shapes.

Final regeneration produces 3,436 diagnostic codes, 10,210 emitting sites, and
five reserved sites from 615 production source files. The environment section
contains 146 variables across 275 sites: 184 reads, 16 indirect reads, 13
declarations, 25 table entries, and 37 message mentions. Excluding the
comment-only `SNAPBACK_ADMIN_TOKEN` pseudo-read removes one bad read; restoring
the three original publication-authority validation strings contributes three
real message mentions.

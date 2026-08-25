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

The generator now applies a literal-position rule before publishing either
vocabulary. A `SNAPBACK_*` token is an emission only when it is the complete
code literal at a diagnostic site or the first token of a `CODE: message`
literal. A token later in a message, the second token in
`CODE: ... ENVIRONMENT_NAME ...`, or the name in a `NAME=value` example is a
reference, not another diagnostic emission. Whole-string names in environment
accessors and environment-name tables/lists are environment sites. The scan is
two-pass so a name established as environment configuration in one production
file is still classified correctly when another file mentions or tables it.

The machine registry's separate `environment` section records `read`,
`indirect-read`, `declaration`, `table-entry`, and `mention` sites. The generated
`diagnostic-codes.d.mts` continues to own both `SnapbackDiagnosticCode` and
`SnapbackEnvironmentVariable`, re-exported by `@expo/snapback-client`, so the
diagnostics registry, symbol registry, and Guide projections share one generated
authority.

The round-2 implementation had restored 47 diagnostic names. Exactly four now
remain, each for a real site: reserved
`SNAPBACK_IBEX_CLI_UNAVAILABLE` at
`crates/snapback-runtime/src/runtime.rs:99`, plus the three publication-authority
`CODE:` errors at `packages/snapback-publication-authority/service.mjs:27`
(`SNAPBACK_PUBLICATION_AUTHORITY_PORT`), `:30`
(`SNAPBACK_PUBLICATION_AUTHORITY_INSTALLATION_ID`), and `:33`
(`SNAPBACK_PUBLICATION_AUTHORITY_ORIGIN`). The other 43 restored names were
message/environment references and are no longer diagnostics. In particular,
`SNAPBACK_PASSWORD`, `SNAPBACK_ADMIN_TOKEN`, `SNAPBACK_DEV_PORT`, and
`SNAPBACK_RUNTIME_BINARY` occur only in `SnapbackEnvironmentVariable`, not
`SnapbackDiagnosticCode`.

The earlier dual-role rule still holds: an environment name emitted elsewhere
as a whole diagnostic code or `CODE:` prefix stays registered, but only the
emitting occurrence appears in its diagnostic sites. Ordinary comment-only
spellings remain excluded. The explicit `diagnostics-registry: reserved` marker
is the deliberate exception for a retired stable spelling and does not count as
an emission. The HTTP-only `NON_DIAGNOSTIC_SNAPBACK_LITERALS` table remains
separate because it includes legitimate non-HTTP diagnostics and is not a safe
public-registry denylist.

The companion fixture now has 36 raw `SNAPBACK_*` substrings and retains seven
emitting occurrences across six names. Its fail-first run showed the old
classifier wrongly emitting both environment-list entries, a mid-message
environment name, the environment token after a valid `CODE:` prefix, and a
`NAME=value` example. It also pins the dual-role `throw new Error` case,
Rust/JavaScript code positions, negative-lookbehind spellings, environment site
kinds, and the explicit reservation marker.

Final regeneration produces 3,437 diagnostic codes, 11,759 emitting sites, and
one reserved site. The environment section contains 146 variables across 273
sites: 185 reads, 16 indirect reads, 13 declarations, 25 table entries, and 34
message mentions. The original pre-classification registry had 3,629 codes and
12,507 sites; the round-2 regressed registry had 3,549 codes, 12,176 emitting
sites, one reserved site, and 239 environment sites.

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

The generator now classifies each source occurrence before publishing either
vocabulary. It recognizes direct and injected JavaScript/Swift environment
objects, helper calls and helper-indirected reads, environment object keys and
name tables, Rust `var`/`var_os`/`option_env!` access, and const-indirected
reads. Environment classification is per site, not unioned by name across the
production corpus. There is no constructor-name allowlist: any occurrence that
is not itself an environment read/declaration, comparison, comment, or marked
reference stays registered as an emission, including plain `throw new Error`,
Rust `eprintln!`/`format!`, and arbitrary constructors.

The machine registry now has a separate `environment` section with source
locations and `read`, `indirect-read`, `declaration`, or `table-entry` site
kinds. The existing generated `diagnostic-codes.d.mts` also owns the
`SnapbackEnvironmentVariable` union, re-exported by `@expo/snapback-client`.
Keeping both unions in that file gives the one generator and already-published
package file a single lifecycle; the symbol registry discovers the new export
without adding another generated-file inventory.

Of the original examples, `SNAPBACK_EXPO_METRO_PORT`,
`SNAPBACK_DEV_CLIENT_PORT`, `SNAPBACK_DEV_BOOTSTRAP_PORT`, and
`SNAPBACK_DEV_PORT_RANGE` are environment-only. `SNAPBACK_DEV_AUTH_ORIGINS`,
`SNAPBACK_RUNTIME_BINARY`, and `SNAPBACK_DEV_PORT` are dual-role names: their
environment sites live under `environment`, while their separately emitted
message/detail sites remain diagnostics. The same boundary retains
`SNAPBACK_GRAPH_EXEC_DISABLED` and `SNAPBACK_VERIFY_PROFILE_TIMEOUT` as real
diagnostics while recording their reads separately.

Ordinary comment-only spellings are not harvested. One deliberate exception is
the retired `SNAPBACK_IBEX_CLI_UNAVAILABLE` compatibility spelling: its runtime
comment carries `diagnostics-registry: reserved`, and the registry retains that
exact occurrence with site kind `reserved` without counting it as an emission.

The generator deliberately does not consume
`NON_DIAGNOSTIC_SNAPBACK_LITERALS`: that list governs HTTP projection and
contains legitimate non-HTTP diagnostics, so treating it as a public-registry
denylist would erase real emissions. No hand-maintained environment allowlist
was added.

The companion fixture now contains 31 raw `SNAPBACK_*` substrings. It covers
the negative-lookbehind cases `__SNAPBACK_FIXTURE_NESTED__` and
`PUBLIC_SNAPBACK_FIXTURE_ORIGIN`, and a dual-role name with one environment
read plus plain JavaScript and Rust emissions. The classifier retains seven
emitting occurrences across six names and only the emitting occurrences of the
dual-role name. A separate unit case pins the explicit reservation behavior.

Across the complete correction, regeneration moved from 3,629 codes / 12,507
sites to 3,549 codes / 12,176 emitting sites plus one reserved site, while the
separate environment vocabulary contains 146 names / 239 classified sites.
The round-2 fixes restored 47 registered codes — 46 emission names plus one
reserved spelling — and 106 emitting sites over the over-suppressing
3,502-code / 12,070-site intermediate registry.

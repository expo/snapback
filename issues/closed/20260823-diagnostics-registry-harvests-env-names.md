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

The generator now classifies source sites before publishing the diagnostic
vocabulary. It recognizes direct and injected JavaScript/Swift environment
objects, helper calls and helper-indirected reads, environment object keys and
name tables, Rust `var`/`var_os`/`option_env!` access, const-indirected reads,
and environment names mentioned in comments or messages. Classification is
site-specific: a name read from the environment and emitted as a diagnostic
elsewhere retains only the emitting site.

All examples from this ticket left the public union:
`SNAPBACK_DEV_AUTH_ORIGINS`, `SNAPBACK_RUNTIME_BINARY`,
`SNAPBACK_EXPO_METRO_PORT`, `SNAPBACK_DEV_PORT`,
`SNAPBACK_DEV_CLIENT_PORT`, `SNAPBACK_DEV_BOOTSTRAP_PORT`, and
`SNAPBACK_DEV_PORT_RANGE`. The broader audit found no remaining code whose
only sites are environment reads, comparisons, tables, comments, or message
references. `SNAPBACK_GRAPH_EXEC_DISABLED` and
`SNAPBACK_VERIFY_PROFILE_TIMEOUT` honestly remain because each is also emitted
as a real diagnostic; their registry entries now contain only that constructor
site.

The generator deliberately does not consume
`NON_DIAGNOSTIC_SNAPBACK_LITERALS`: that list governs HTTP projection and
contains legitimate non-HTTP diagnostics, so treating it as a public-registry
denylist would erase real emissions. No hand-maintained environment allowlist
was added.

The companion fixture expanded from the 12 raw matches present at round-2
review to 28 shapes. The prior classifier accepted 18 of those matches; the
fixed classifier retains the five real emissions. Regeneration changed the
registry from 3,629 codes / 12,507 sites to 3,502 codes / 12,070 sites.

# Diagnostics registry harvests `SNAPBACK_*` environment-variable names as codes

- Status: Open
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

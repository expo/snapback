# Presence/live-query `skip` sentinel type widens under memoization

**Opened:** 2026-08-17
**Source:** Clique 0.1.21 Explicit lane (Diary 0083, M3); LLP 0277 F11

## Symptom

Memoizing presence options (`useMemo`) widened Snapback's unique `skip`
sentinel type to a generic `symbol`, so the memoized options no longer
satisfied the hook signature. The workaround was constraining the memo's
type from the exact ephemeral reference signature — discoverable only by
reading generated types.

## Ask

Make the sentinel survive ordinary React memoization idioms: export the
sentinel with a named unique-symbol type (and a type-level helper such as
`SkipOr<T>`), and add a type-test that a `useMemo`-wrapped options object
containing `skip` typechecks against the hook signatures without explicit
annotation. Document the sentinel in the React hooks guide page where
options memoization is recommended.

## Resolution (2026-08-21)

Resolved in the React declaration surface without changing runtime exports:

- `skip` now has the named nominal unique-symbol type `SkipSentinel`, whose
  private brand survives generic object inference, and `SkipOr<T>` names the
  shared hook union.
- Query, query-group, presence, surface, observer, core, Familiar, and Expo
  declaration projections carry the named types.
- `skip-sentinel-types.fixture.ts` proves `useMemo`-inferred presence options
  and query entries containing `skip` satisfy the hooks without an annotation
  or explicit generic argument.
- The React guide documents the memoization idiom and the two type helpers;
  generated reference pages, registries, manifest, and flat projections were
  refreshed.

Verification: focused and complete React type-fixture compiles pass;
`./ref-check --verbose`, `node scripts/check-inventories.mjs`, and
`node scripts/check-guide.mjs` pass. The repository-wide export-types command
still stops on the pre-existing declarationless
`@expo/snapback-codegen/visibility-governance{,-dev-config}` subpaths; generated
symbol-registry runtime parity passes exactly.

**Landing SHA:** TBD

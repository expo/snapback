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

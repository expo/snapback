# codegen package suite: two tests still expect `structured_stored_value_v1` refusal after the capability landed

**Status:** Open
**Date:** 2026-08-10
**Systems:** Codegen, Testing
**Detected during:** Lane L1 (fresh-clone hermeticity fix,
`issues/closed/20260806-data-tier-corpus-fresh-clone-nonhermetic.md`)

`bun run --cwd packages/snapback-codegen test` exits 1 on current main —
independent of clone freshness — because two tests pin the old
capability-refusal behavior while the base revision now supports
`structured_stored_value_v1`:

1. `packages/snapback-codegen/schema-reference-type-flow.test.mjs:304` —
   expects `ok === false`, generation now returns `ok === true`.
2. `packages/snapback-codegen/structured-stored-values.test.mjs:104` — same
   stale capability-refusal expectation.

Both reproduce with repository-supported Node 24.18.0 and pre-exist the L1
lane (verified at the lane's `origin/main` base). Owner: whoever landed the
`structured_stored_value_v1` support should flip these expectations to pin
the new supported behavior (and whatever refusal remains for genuinely
unsupported shapes), not merely delete them.

## Resolution — 2026-08-15 (backlog sweep)

The two codegen tests no longer pin the old `structured_stored_value_v1`
refusal. `packages/snapback-codegen/schema-reference-type-flow.test.mjs` and
`structured-stored-values.test.mjs` now expect successful generation and an
explicit capability requirement, matching the landed LLP 0211 support flip.
The stale `ok === false` expectations that failed the codegen suite on
2026-08-10 are gone.

# snapback2: a Quarry table named after a builtin (`words`, `tokens`, `range`, `min`, `max`, `count`, `divmod`, `share`) collides with the builtin's ambient declaration in generated code

**Status:** Resolved 2026-09-08

**Date:** 2026-09-06 · **Area:** Quarry front end / `lower/schema.ts` · **Source:** the Clique wave-2 integration (lane L9's `words` builtin meeting lane L8a's compiler fixture table `words`)

## What happened

The generated program module declares each table as `export var <name> = table(...)` and the
ambient library declares the pure builtins as functions (`packages/compiler/lib.d.ts`:
`export function words(value: string): string[]`, and the same for the other builtins). A schema
with `table words:` therefore fails inside the generated code — `E_OPAQUE … Duplicate identifier
'words'` followed by nonsense follow-ons (`Property 'byConversationTermTime' does not exist on type
'(value: string) => string[]'`) — instead of a schema-site refusal that names the collision and
proposes a rename. Lane L8a's compiler visibility fixture hit it and was renamed to `terms`
(`bde68aff6`); any app author who names a table `words`, `tokens`, `range`, `min`, `max`, `count`,
`divmod`, or `share` will hit the same wall with no useful rewrite.

## Proposed

1. Reserve the builtin names for tables (and probably columns used as bare identifiers) in the
   Quarry catalog: refuse at the declaration with `E_SCHEMA_RESERVED`, a site, and a rewrite
   (`table words:` → `table searchWords:`), the way the `_` prefix and `connected` are refused.
2. A compiler test per reserved name, plus one asserting the generated module never shadows an
   ambient builtin.
3. Guide: one clause on the grammar page's table line listing the reserved names.

Related: LLP 1001 (pure builtins), LLP 1004 §"names", `issues/20260905-snapback2-clique-findings-review-residuals.md` (wave 2/3 residue, L9).

## Remaining scope — reconciled 2026-09-08

Direct Quarry binding removed the generated-TypeScript data/schema collision mechanism (`090bb82bc`). The current keyword-naming regression tests query class(default: int), not the ticket's eight builtin-named tables. Before closing, add a focused direct-compiler witness for words, tokens, range, min, max, count, divmod and share as table names, including valid reads and builtin calls. Do not carry the obsolete emitter reservation proposal into Quarry. The successful 214-test compiler suite does not establish this exact acceptance matrix.

Read-only source and recorded-execution audit against main `2ac15dc2c`; no new test execution or publication is claimed by this update.

## Resolution — published-package acceptance, 2026-09-08

A fresh registry install of `snapback2@0.0.19` and
`snapback2-darwin-arm64@0.0.19`, with no source override, compiled one matrix
containing all eight table names. All eight seeded reads executed against the
real owner and returned the expected value. Calls to the seven supported
same-named builtins also returned the expected values.

`words` remains a valid table name. `words()` is intentionally not a public
direct-Quarry value builtin: the separate call-site control returns the
documented `E_QUARRY_UNSUPPORTED` refusal and directs authors to a
`wordPrefixes` index. That is distinct from the original generated-code name
collision. No blanket table-name reservation is needed.

[Exact fixture, result matrix and retained outputs](../../benchmarks/runs/2026-09-08-release-cold-headroom/builtin-name-witness/RESULTS.md)
close the specific acceptance gap left by the read-only audit. The evidence
retains two setup-only harness mistakes separately; it does not claim a new
broad compiler-suite execution. Both owned backend processes were stopped and
the assigned port was verified free afterward.

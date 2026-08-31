# snapback2: a Bytes `exists` rule literal against a later-declared table is refused (incomplete two-pass typing)

**Status:** Open
**Systems:** snapback2, compiler
**Severity:** P3
**Author:** Claude Fable 5, directed by Charlie Cheever
**Date:** 2026-08-30
**Related:** `issues/20260830-snapback2-bytes-and-interval-column-types-deferred.md` (Bytes half, landed), `snapback2/packages/compiler/src/lower/schema.ts`

Found by the grok-4.6 delta review of the Bytes fix round (READY verdict; this was the residual MINOR). The expected-type threading for `exists()` key literals reads the target table's index types from `TableInfo`, but index types are recorded only when that table is lowered. Table *names* are pre-registered for forward `t.ref`/`exists`, so a rule on an earlier-declared table whose `exists()` targets a later-declared table finds no index types: a canonical `{ Bytes: "..." }` key literal hits the untyped refusal (`E_RULE_INVALID`, "requires a Bytes schema position") and the rule lowers to `Deny`. Self-`exists` and later-on-earlier work. Loud (diagnostic + Deny), not silent, and no corpus fixture uses the shape — but it is an order-dependence the surface should not have.

Adjacent note from the same review: `and`/`or` filter out a failed child term (e.g. `and(exists(badKey), allow())` becomes `{ And: ["Allow"] }` plus a diagnostic); `lowerProject` still refuses on any schema diagnostic, so this is not reachable as a certified program, but failing the whole composite like `eq`/`exists` now do would be more direct.

Fix shape: make index-type registration a true first pass (record index column types when table names are pre-registered), and fail the composite rule on any failed child.

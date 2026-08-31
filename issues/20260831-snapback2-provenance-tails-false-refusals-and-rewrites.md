# snapback2 compiler: provenance-lane tails — false refusals on row projections/collections and two rewrite-honesty gaps

**Status:** Open
**Systems:** snapback2, compiler, certificate
**Severity:** P2
**Author:** Claude Fable 5, directed by Charlie Cheever
**Date:** 2026-08-31
**Related:** LLP 1002 §2, `issues/closed/20260830-snapback2-compiler-provenance-and-site-are-authored-facts.md` (the landed lane), `snapback2/packages/compiler/src/lower/{provenance.ts,expr.ts}`

Residual findings from the provenance lane's final blind reviews, accepted as
tickets at landing (author ruling 2026-08-31: land with tickets; both
reviewers agreed none of these certifies a wrong origin — every one either
refuses or was already wrong on main in a worse, silent way).

**False refusals (agent-hostile, not unsound):**

1. `.slice` of a transforming map drops element origins: `scan.map(row =>
   ({inner:{key: row.key}})).slice(0,5)` → `E_PROVENANCE_AMBIGUOUS`, while the
   same projection through `filter` classifies `Shape`
   (`expr.ts:585-587`, `935-954`; `provenance.ts:219-262`). The matching-name
   rewrite (`[args.key]`) compiles — a wrong paste reachable only through the
   false refusal. Chained `scan.map(row => row).slice(0,5)` as a loop domain
   is `E_OPAQUE` (same family, different spelling).
2. Mixed array of ordinary elements + directly-mapped spread refuses although
   every element is unambiguously `Arg` (`provenance.ts:239`). Triaged
   IMPROVED-BUT-INCOMPLETE: main silently certified this shape with a WRONG
   `Shape` certificate; the refusal is safer but should classify.
3. Renamed-`args` loop domains: `({args: packed})` + `for (const key of
   packed.keys)` → `E_UNBOUND_LOOP` (`syntax.ts:304-308` still matches the
   spelling for loop cardinality; `staticBound` doesn't consult the composite
   binding). Aliasing first compiles. **Resolved in the type-analysis round-1
   fix:** loop cardinality now proves the operation composite through its
   lexical binding; a shadowing local of the same spelling lowers as a derived
   array instead of `ArgList`.
4. Nested literal collections lose per-element bounds: iterating `[[a],[b,c]]`
   then each group → `E_UNBOUND_LOOP` though the inner max is statically 2
   (`expr.ts:300`). INHERITED (identical on main).

**Rewrite honesty (refusals are correct; pastes are incomplete):**

5. Mutable multi-origin binding (`let selected = args.first; if (…) selected =
   args.second`) refuses but names/pastes only the initializer origin,
   deleting the second branch (`compiler.ts:349`, `operation-context.ts:6`).
   Main silently certified this shape as `Arg` — the refusal is a strict
   improvement; the paste must enumerate all assignment origins or use the
   non-compiling candidates sentinel.

**Scoping-adjacent residuals (from the surgical block-scope review):**

6. Immutable-alias re-walk uses the USE-TIME environment
   (`provenance.ts:185`): `const packed = args; { const args = {key:
   "literal"}; db.get(beta.byKey, [packed.key]) }` certifies the in-block
   read `Const` while the IR reads the argument. Pre-existing for in-block
   uses; classify `immutableOrigin` in its BIND-TIME environment.
7. `assignedBindings` is whole-handler and name-based
   (`operation-context.ts:6-15`): an inner `let key` that is reassigned
   poisons an outer `const key`, false-refusing `E_PROVENANCE_AMBIGUOUS`.
   Safer than a leak, but scope-aware mutation tracking removes the false
   refusal.

8. Remaining downstream spelling/shape matches are safe refusals, not wrong
   lowerings: `syntax.ts:177` still recognizes `db` by spelling so a renamed
   handler `db` binding refuses, and local object literals do not yet carry
   Decimal field types through type analysis, so unsupported typed-object
   forms refuse instead of borrowing the operation argument's scale.

Fix direction: extend per-element/row-projection tracking through `slice`
(and audit `sort`/`flatMap` parity), route loop cardinality through the same
binding environment as provenance, thread assignment origins into
`honestRewrite`, give nested literal collections their static bounds, and
make alias classification and mutation tracking scope-/bind-time-aware.
Every fix keeps the invariant the lane established: classify or refuse — the
paste never names a field the author didn't select.

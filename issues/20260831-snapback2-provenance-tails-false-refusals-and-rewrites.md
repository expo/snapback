# snapback2 compiler: provenance-lane tails — false refusals on row projections/collections and two rewrite-honesty gaps

**Status:** Resolved
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

**Claimed:** 2026-08-31 by session snapback-8a [f8c2a2] — lane `s2/t2-tails` (worktree `~/projects/snapback-s2v`) takes this ticket together with the push-elementorigins ticket (same files); other sessions should skip both.

## Resolution (2026-08-31)

Resolved in `54e9a7968` (`fix(snapback2): close provenance lowering tails`):

1. `slice` and `sort` now lower their collection owner through the same
   statement-producing path as `map`/`flatMap`; element origins and row proof
   survive `slice`, `sort`, identity maps, transforming maps, and identity
   `flatMap`. Both inline slice scenarios now compile with the second read
   certified `Shape`.
2. Collection-element discovery walks directly mapped spreads and classifies
   each resulting alternative. Ordinary-plus-mapped `Arg` elements compile as
   `Arg`; a genuine `Arg`/`Viewer` disagreement still refuses.
3. Verify-only: the type-analysis lane's `operationArgumentList()` repair was
   already present. The exact `({ args: packed })`, `keys: t.list(...,
   { max: 3 })`, `for (const key of packed.keys)` scenario lowers to
   `ArgList { name: "keys", max: 3 }` and certifies the read `Arg`; a regression
   now pins it. No second implementation was added.
4. Static bounds now recurse through alternative nested literal elements and
   immutable object members in their captured environments. The two-deep
   example lowers with maxima `2 × 2`; the three-deep probe lowers with
   maxima `2 × 1 × 2`; `packed.keys` lowers with max `1`.
5. Mutation analysis is binding-identity-aware, and assignment lowering
   accumulates every authored origin on that binding (including assignments
   inside loops and conditional branches). One distinct origin gets the direct
   rewrite; multiple origins get the non-lowerable sentinel naming them all.
6. Immutable origins retain a bind-time environment snapshot. Block-local,
   same-scope/TDZ-shaped, and alias-of-alias shadows therefore classify from
   the values actually emitted into IR, never from the use-time spelling.
7. Mutation preanalysis resolves assignments to lexical declaration nodes, so
   reassigned inner shadows no longer poison an outer stable binding; the
   two-depth shadow probe compiles and certifies `Arg`.
8. `db` recognition now follows the handler's lexical composite binding,
   including renames and pure-helper substitution, and rejects a shadowing
   ordinary local. The unrelated object-literal Decimal field-type remainder
   moved to
   `issues/20260831-snapback2-object-literal-decimal-field-types.md`.

Focused compiler proof: 108/108. Required corpus regeneration wrote 81 cases
with an empty diff. The complete lane verification and budget readings are
recorded with the accompanying metrics/ticket closeout commit.

### Round-2 closure (2026-08-31)

Commits `570fae871`, `4720b0339`, `cba1fd7cd`, and `6b21d11c0` close the four remaining
review blocks: loop and conditional-member origins now reach the candidate set
without a name guess; nested push deltas multiply and the 3 × 4 + seed program
certifies and executes at max 13; collection mutation requires a locally owned,
unaliased collection; and ternary-statement arms use the ordinary branch
fork/merge.

Residuals (left unfixed, verbatim): Set/Map initializer element origins
(compiles Computed, not a lie); unconditional-reassignment merge-vs-replace
conservative refusal; Arg/Arg branch reassignment refusal (correct-by-design: a
certificate names one origin); exotic mutators
(splice/unshift/concat/member-push) refusing safely; unequal-arm overcounts
(safe direction).

### Round-3 final closure (2026-08-31)

Commits `ab71e7441`, `3f3a0c9bc`, `0aedec5a9`, and `da750b5f2` close the final
structural gaps. Loop mutation analysis now settles against lowered body environments and
installs end-of-loop facts before nested domain IR is emitted. The certified
crash shape carries inner max 4 and executes 9 visits; the post-loop twin
returns 4; body-local spread copies and literal batches compile; and the
two-deep mutation probe carries max 7 and executes 11 visits. A collection
whose mutation count grows with its own domain refuses `E_UNBOUND_LOOP`.

Collection sharing now closes over call arguments, object/array members,
returns, and ternary/logical arms. Helper-return, object-wrapper, ternary,
two-helper, and branch-arm pre-mutation escapes refuse with the sited envelope
and spread-copy rewrite. Read-only escapes and mutation-before-final-return
remain green. Branch ambiguity rewrites union candidates retained by merged
element origins, so the `args.a` / `ctx.viewer` / `args.b` sentinel names all
three real origins.

Round-3 residual addition: escape detection deliberately false-refuses a
post-escape mutation even when a helper would copy or decline to retain the
collection; the explicit spread-copy rewrite is the admitted proof. No
body-local nested-loop residual was observed for the requested no-mutation
spread-copy or literal-batch forms. The round-2 residual list above otherwise
stands unchanged.

Focused compiler proof: 134/134. Required `scripts/test.sh`: Rust 19/19 +
22/22, evaluator 81/81, compiler 134/134, exit 0. Measurement passed every
budget (core test 23.87 s); corpus regeneration wrote 81 cases with an empty
corpus diff.

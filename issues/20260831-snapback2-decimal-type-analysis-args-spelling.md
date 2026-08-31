# snapback2 compiler: type analysis recognizes `args` by spelling, so renamed handlers and shadowing callbacks get wrong Decimal scaling

**Status:** Resolved in lane (awaiting landing)
**Systems:** snapback2, compiler, type-analysis
**Severity:** P1
**Author:** Claude Fable 5, directed by Charlie Cheever
**Date:** 2026-08-31
**Related:** LLP 1002 §2, `snapback2/packages/compiler/src/type-analysis.ts:123`

Found by the round-4 blind review of the provenance lane (`s2/t2-provenance`);
triaged INHERITED at `ca7fa28d8` (main was already wrong the same way — this is
not a provenance-lane regression; the lane fixed the *provenance* side of the
same spelling problem, not the *type* side).

`type-analysis.ts` matches the identifier text `"args"` instead of consulting
lexical bindings. Two silently-wrong compiling programs:

1. Handler rename: `({ db, args: packed })` with a `Decimal<2>` arg `price` —
   `packed.price + 1` emits literal multiplier `1`; the ordinary spelling
   `args.price + 1` emits `100`. Same program, different arithmetic.
2. Shadowing callback: a row callback parameter named `args`, where the row
   field is `Decimal<2>` and the operation argument is `Decimal<3>`, applies
   scale `1000` (the operation's) inside the callback; renaming the parameter
   to `row` applies `100`.

The provenance lane made *provenance* classification spelling-independent
(lexical bindings win); type analysis needs the same treatment: resolve
`args`/`ctx` through the binding environment, never by identifier text. Add
both scenarios above as tests, plus the renamed-`ctx` analogue.

Triage evidence and rerun scripts: the provenance-lane landing report
(session snapback-8a, 2026-08-31); probe harness pattern in
`snapback2/packages/compiler/src/provenance-site-checks.ts`.

**Claimed:** 2026-08-31 by session snapback-8a [f8c2a2] — one combined lane `s2/t2-typeanalysis` (worktree `~/projects/snapback-s2v`) fixes both P1 type-analysis tickets (same file); other sessions should skip both.

## Resolution (2026-08-31)

Commit `62b1bb774` makes the type-analysis environment carry operation-composite
identity on the handler's actual destructured bindings. Callback parameters,
locals, loops, and nested function parameters replace that identity lexically;
direct aliases and helper parameters preserve it. `ctx` and the handler's `db`
binding use the same mechanism, and helper/builtin lookup now defers to lexical
bindings.

Regression coverage includes the renamed `packed` handler, a Decimal<2> row
callback shadowing Decimal<3> operation `args`, plain `args.price + 1`, a
shadowed-then-unshadowed sequence (`100` then `1000`), and renamed `ctx` with a
callback shadow. The compiler suite passes 93/93 after the combined lane.

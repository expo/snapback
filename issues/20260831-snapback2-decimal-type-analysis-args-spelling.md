# snapback2 compiler: type analysis recognizes `args` by spelling, so renamed handlers and shadowing callbacks get wrong Decimal scaling

**Status:** Open
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

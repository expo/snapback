# snapback2: the compiler lowers arguments, locals, and loop bindings into one flat IR Variable namespace — runtime shadowing can contradict the certificate

**Status:** Open
**Systems:** snapback2, compiler, certificate
**Severity:** P2
**Author:** Claude Fable 5, directed by Charlie Cheever
**Date:** 2026-08-31
**Related:** LLP 1002 §3, `snapback2/packages/compiler/src/lower/expr.ts`, `snapback2/packages/compiler/src/compiler.ts`, the provenance lane (s2/t-prov)

Found by the codex-gpt-5.6-sol review of the provenance grammar lane and verified inherited: `args.<field>` lowers to `Variable(field)`, and locals, callback/loop bindings, and generated temporaries share that same namespace (both facts present at the lane base `ae31c9ac2` — the single `variables: Map<string, VariableInfo>` and flat `Variable` emission predate the lane). Reviewer repro:

```ts
mentionTokens(args.text).map(key =>
  db.get(records, args.key)
)
```

The read of `args.key` lowers to `Variable("key")`; at runtime the loop binding `key` overwrites the operation argument, so the actual lookup key is the computed token while the certificate stores the argument's classification (`Arg`, prediction mode Closed). Any local or binding whose name matches an argument field reproduces it; the `ArgList` domain has the equivalent collision. This is not a provenance-classifier defect — the closed grammar classifies the SOURCE correctly — it is lowering losing binding identity.

Fix shape (its own program, not a lane rider): hygienic identities for arguments, locals, callback bindings, and generated temporaries — e.g. lower `args.<field>` through an immutable argument namespace distinct from mutable locals — plus regressions for a computed-domain callback shadowing an argument field, a same-named local, and a transformed ArgList. The certificate side needs no change once names cannot collide.

**Note 2026-08-31:** the provenance lane that surfaced this (`s2/t-prov`, this
orchestration) was shelved unlanded after session snapback-8a's independent
implementation of the same ticket landed first (`8d491415c`); the collision is
in base lowering and applies equally to the landed implementation — see item 12
of the attack-set verification run against main.

**End-to-end confirmation 2026-08-31** (conformance run against `fa1528e1a`; 20/21
other probes CONFORM — the landed pinned-identity implementation is otherwise
sound under the shelved lane's full probe set): program
`mentionTokens(args.text).map(key => db.get(records.byKey, [args.key]))` lowers
the read key to `{"Variable":"key"}` inside `For{binding:"key"}` and certifies
`prefix_template: "Arg"` at `programs.value.0`; with args
`{"text":"@token","key":"arg-key"}` the live owner returns the row for the
computed token `"token"`, not the argument `"arg-key"`. LLP 1002 §2 rule (5)
requires Computed here; the certificate records rule (2). Note the raw project
certificate carries `prediction_sites: []` — prediction mode is derived by
`Checker::check_pair`, which would classify this non-Computed site Closed.

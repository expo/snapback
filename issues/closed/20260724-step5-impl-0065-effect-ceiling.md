# 0065: EffectCeilingV1 — computed, total, default-deny ceilings

**Status:** Done (2026-07-24)
**Severity:** P2
**Systems:** Codegen, Authorization, Diagnostics
**Author:** Claude (Fable 5), directed by Charlie Cheever
**Date:** 2026-07-24
**Related:** Accepted LLP 0065 §1
**Marker:** step5-impl

Record each closed HostPlan's conservative ceiling as a versioned
`EffectCeilingV1` fact (operations, tables, index ranges, host operations,
authorization dependencies). The traversal is total over the closed plan
vocabulary and default-deny: unknown nodes fail generation. Generation tests
assert each helper constructor's exact expected ceiling; runtime subset check
stays enforcement. Opaque handlers without a proven-complete ceiling remain
ineligible for live/retained capability under LLP 0053. M-sized.

**Resolution (2026-07-24):** `packages/snapback-codegen/effect-ceiling.mjs`
computes `EffectCeilingV1` by a total default-deny traversal of the closed
plan vocabulary (every MutationStep/ActionStep/QueryPlan field and every
ValueExpr node enumerated; unknown nodes abort generation — the walker
immediately caught the camel/snake plan-key duality, which is now an
explicitly closed both-spellings set). Emitted per function in
functions.manifest; opaque handlers keep author declarations with
`basis: 'declared'` and no static claim. Rust side: `EffectCeiling` types +
optional `effect_ceiling` on `FunctionDefinition` (manifest.rs), committed
schemas regenerated via snapback-schemagen. Witnesses: exact expected
ceilings asserted for the standard-pattern constructors
(standard-patterns.test.mjs) and walker unit tests incl. three default-deny
cases (effect-ceiling.test.mjs, added to the package suite). All demo
manifests regenerated; codegen suite, Rust manifest tests, and the
standard-patterns acceptance run are green. Runtime subset enforcement
(consuming the recorded fact) remains with the conformance-suite ticket.

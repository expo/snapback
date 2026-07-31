# Codegen marks `$param`-into-JS-live-query routes registerGroupEligible; the server refuses them at ensureApp

**Status:** Open
**Impact:** 2
**Urgency:** 2
**Ease:** 3
**Confidence:** 4
**Severity:** P2
**Systems:** Code generation, Runtime, Client integration
**Author:** Claude (Fable 5), move-4 rerun-arm prep lane
**Date:** 2026-07-31
**Related:** LLP 0112, LLP 0092, LLP 0114

Found while building the Campfire React query-group rerun arm
(`demos/campfire`, LLP 0115 §Sequencing 5 prep).

## The seam

LLP 0112 §Generated reference says a route is register-eligible when every
authored `$param` mapping targets a `string` function argument, and codegen
implements exactly that: `registerGroupEligible` checks
`fn.args?.[key]?.primitive === 'string'` (packages/snapback-codegen/index.mjs,
`compileRoutesManifest`). A `defineJsLiveQuery` child with a `v.id(...)` arg
(primitive `string`) therefore generates a typed group reference and
`registerGroupEligible: true`.

The served admission disagrees. `validate_routes_manifest_against`
(src/local.rs) types route params via `function_route_arg_types`
(src/bundle.rs), which derives types **only** from
`FunctionRuntime::HostPlan(HandlerPlan::Query(...))` — declarative plans
whose filters bind `ValueExpr::Arg` to schema-typed fields. For any JS-tier
function it returns an empty map, so `ensureApp` refuses the whole manifest:

```
SNAPBACK_ROUTES_MANIFEST_INVALID: route "/rooms/:roomId" query
"liveMessages" references param into arg "roomId", which has no
schema-derived string/number/boolean type
```

So codegen says eligible, the server says invalid, and the author only finds
out at provision time. The Campfire arm worked around it by making the
group's children declarative (`defineLiveQuery` with
`eq('roomId', arg('roomId'))`), which the server types happily; the workaround
is recorded in `demos/campfire/snapback/functions.mjs` and the demo README.

## What resolution needs to decide

Either side could move:

1. **Server learns JS args.** Derive route param types from the generated
   argument schema (the JS function's args validators carry `primitive`
   exactly like codegen's check) instead of only from HostPlan filters. This
   matches LLP 0112's stated rule and unlocks `$param` into JS live queries.
2. **Codegen narrows eligibility.** Mark `$param`-into-JS-child routes
   ineligible (mirroring the server), so authors get the honest signal at
   generation time instead of `ensureApp`. LLP 0112's "string function
   argument" text would need a dated narrowing note.

Either way, codegen and server should agree; today the client-side
conformance fixtures (fake clients) never cross the served admission, which
is why the seam survived LLP 0112's acceptance suite. A regression test that
runs a `$param` JS-child route through a real `ensureApp` would pin whichever
rule wins.

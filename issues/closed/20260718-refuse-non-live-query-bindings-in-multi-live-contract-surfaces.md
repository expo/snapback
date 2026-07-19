# Refuse non-live query bindings in multi-live Contract surfaces at boot, not as an error cell

**Status:** Resolved
**Severity:** P3
**Systems:** Clients, Contract Adapter, Codegen, DX
**Author:** Claude (Fable 5), directed by Charlie Cheever
**Date:** 2026-07-18
**Related:** packages/snapback-contract/index.mjs (createMultiLiveContractSurface provider.subscribe); LLP 0034 §10.4; guide/clients/contract-adapter.md; demos/shindig/surfaces/contract (diary 0015)
**Marker:** contract-adapter, multi-live, snapshot-query, fail-fast

In multi-live mode (`liveQueries: [...]`), every query binding a `.contract`
view reads must be a configured live query. A binding to anything else —
including an ordinary `defineJsQuery` snapshot read — compiles cleanly and
boots cleanly, then surfaces `SNAPBACK_CONTRACT_QUERY_UNCONFIGURED` at
runtime **as an error cell through the binding's `error` branch**. That is
failure masquerading as data: Shindig's locked-page check initially "passed"
while actually rendering the unconfigured-query diagnostic instead of the
membership denial it claimed to test.

Both facts needed to refuse earlier are statically known: the contract-data
manifest records each query's `livePush`/mode, and the surface knows its
configured set at construction. Nothing about this needs to wait for a
render.

**Done when:**

- `createSnapbackContractSurface` (multi-live mode) fails construction — or
  at minimum logs a loud structured diagnostic listing the offending
  bindings — when the compiled app's binding set references a manifest query
  that is not in `liveQueries`, rather than deferring to per-binding error
  cells. (If the compiled binding set is not visible to the adapter, a
  codegen/compile-time lint on the `.contract` side is an acceptable
  equivalent; either layer may own it, one of them must.)
- The unconfigured-query error cell remains as backstop but its message
  names the fix ("add { name, args } to liveQueries or make the query
  live").
- The Contract adapter guide states plainly that multi-live surfaces serve
  configured live queries only, and that UI-facing snapshot queries should
  generally be authored as live queries instead (the shindig `eventDetails`
  lesson).

## Resolution (2026-07-18)

Implemented in `packages/snapback-contract/index.mjs`
(`createMultiLiveContractSurface`):

- **Construction-time refusal:** in live-push mode, a configured
  `liveQueries` entry whose manifest descriptor is not live
  (`livePush: false` or `mode: 'snapshot'`) fails surface construction with
  structured `SNAPBACK_CONTRACT_LIVEQUERY_NOT_LIVE` naming the offenders,
  before any subscription opens. `livePush: false` poll/reconcile surfaces
  still serve snapshot queries.
- **Loud backstop:** the `SNAPBACK_CONTRACT_QUERY_UNCONFIGURED` error cell
  now names the fix in its message and additionally emits a once-per-query
  `console.error`, so an error branch styled as product state can no longer
  swallow the misconfiguration silently.
- **Tests:** `multi-live-poll-reconcile.test.mjs` gained the refusal case
  (asserts the diagnostic and that no subscription was opened) and the
  poll-mode snapshot-still-served case; existing suites pass.
- **Guide:** `guide/clients/contract-adapter.md` (Live push bullet) now
  states the configured-live-queries-only rule, both diagnostics, and the
  denial-by-emptiness vs denial-by-diagnostic locked-page guidance;
  generated manifest/flat regenerated, `check-guide` green.

The Exact-compiler-side static lint (compile-time knowledge of the binding
set) remains possible future work and is noted in
`20260718-contract-block-claim-grammar-and-parse-error-location.md`'s
upstream scope; the adapter now owns the fail-fast on the layer it controls.

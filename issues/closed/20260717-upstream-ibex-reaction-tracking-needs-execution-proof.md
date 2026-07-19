# Upstream Ibex reaction tracking needs execution proof

**Status:** Closed
**Severity:** P1
**Systems:** Upstream Ibex, Promise rejection tracking
**Author:** Codex (GPT-5), directed by Charlie Cheever
**Date:** 2026-07-17
**Closed:** 2026-07-18
**Related:** `issues/20260717-require-canonical-promise-reaction-paths.md`; `vendor/ibex/packages/ibex-runtime-js/src/promise-rejection-tracking.ts`
**Marker:** upstream, ibex, promise, rejection-tracking

Ibex's generic Promise rejection wrapper marks a source handled after
`originalThen.call(...)` returns normally. Hermes permits a Promise instance to
carry an own constructor whose `new constructor(executor)` returns an object
without invoking the executor, so normal return is not proof that a reaction
attached. A constructor that invokes the executor with no-op child
capabilities also proves that reaction execution alone is not enough to trust
propagation. Snapback is protected by its sealed canonical-path gate and
provisional `_C` ledger, but other Ibex consumers may still rely on the generic
tracker alone.

This is an upstream submodule concern rather than an exploitable residual in
Snapback. The follow-up is being repaired in Ibex itself so downstream
consumers do not inherit a weaker handled-rejection oracle.

**Done when:**

- Upstream Ibex refuses non-canonical Promise constructor paths or otherwise
  proves both attachment and child rejection propagation before marking a
  source handled.
- Hermes regressions cover constructors that return a genuine fulfilled decoy,
  install no-op child capabilities, and arrive through own and inherited
  constructor paths.
- Generated runtime bundles are refreshed by the upstream process.
- Snapback advances its Ibex submodule after the upstream proof passes.

## Resolution

Ibex commit `bfbc6133af739ed2dabc2f44efa693d1412452e5` authenticates native
reaction execution with closure-private generations, rejects non-canonical
constructor/species paths, and routes observed adoption and `Promise.all`
through real intrinsic reactions rather than mutable public bookkeeping. The
focused engine, native-hook, fallback, and CLI adversarial regressions pass.

Snapback commit `a5ed6ebd05766b10607937a1c010352d79eea4b0` advances the vendored
runtime to that published compatibility branch. GitHub Actions local-proof run
`29674515103` passed the complete canonical Linux proof on 2026-07-18.

# Upstream Ibex reaction tracking needs execution proof

**Status:** In Progress
**Severity:** P1
**Systems:** Upstream Ibex, Promise rejection tracking
**Author:** Codex (GPT-5), directed by Charlie Cheever
**Date:** 2026-07-17
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

## Implemented; remote verification pending

Ibex now refuses non-canonical direct prototypes, constructor descriptors, and
species resolution before invoking the captured reaction method. On native
observer paths, `catch` and `finally` dispatch directly through that intrinsic
rather than trusting dynamic `this.then`; the fallback rejects a hostile
dynamic path. The trusted runtime
also consumes patch 0009's native observer before application source, so
engine-created async-function and original-constructor Promises join the same
fail-loud tracker. It closure-privately multiplexes Snapback's downstream
one-shot bridge; the generic and downstream paths are independently isolated,
and opaque generation tokens cannot rewrite the engine's private reason.
Isolated engine-observer, native-hook, and fallback regressions cover fulfilled
decoys, no-op child capabilities, own/inherited/accessor constructors, mutated
species paths, hostile `then` dispatch, consumer failure, and one-shot replay.
CLI regressions cover detached native async functions, direct original-
constructor rejections, hostile reason getters, erased pending reactions,
handled async rejection, and token mutation. Public wrapper return no longer
marks a Promise handled at any settlement phase: an engine reaction clears the
generic record only through authenticated completion, while an erased queue or
poisoned public state reports fail-loud. Generic classification runs in a host
task captured before application source so an immediate catch's reaction job
can complete first; missing task support fails readiness. The engine-to-tracker
clearing signal is execution-proven, while the generic event/exit diagnostic
remains application-controllable through event prevention, exit mutation, and
the public timer namespace. Snapback security uses the separate strict ledger.
Keep this ticket open until the vendored bundle, published Ibex
branch, and canonical `origin/main` proof are green.

Patch 0009 also disables state-3 alias adoption while observation is active:
each exact-Promise adopter settles through a real intrinsic reaction and gets
its own rejection generation. This closes detached outer/`.then()` child
rejections after the inner Promise was already handled.
The same observer-mode rule now bypasses `Promise.all`'s public settled-field
shortcut, so aggregate rejection identity comes from the authenticated private
reason rather than mutable compatibility bookkeeping.

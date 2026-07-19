# Authenticate native Promise reaction completion

**Status:** In Progress
**Severity:** P0
**Systems:** Runtime, Security, Auth/RBAC, Upstream Ibex, Hermes
**Author:** Codex (GPT-5), directed by Charlie Cheever
**Date:** 2026-07-18
**Related:** LLP 0009 §Harness control-plane boundary; LLP 0013 §Embedding lifecycle proof; `issues/20260717-observe-propagated-harness-rejection-promises.md`; `issues/20260717-upstream-ibex-reaction-tracking-needs-execution-proof.md`
**Marker:** hermes, promise, native-await, rejection-ledger, transaction-integrity

The canonical Linux proof showed that caught native `await` and awaited
`Promise.all` rejections can bypass Snapback's public `Promise.prototype.then`
mediator. The engine reports the rejection through `_C`, but no wrapped public
reaction runs to clear it, so the post-drain ledger falsely classifies handled
work as detached and can replace the handler's intended diagnostic.

Trusting Hermes's reachable `_B` attachment callback is not a safe repair.
Promise bookkeeping fields are mutable: handler code can attach a reaction,
erase its pending queue, and reject afterward. Attachment then exists only as
an assertion; the callback never executes. A stale queued reaction can also be
redirected to re-reject its source and must not clear the newer generation.

**Done when:**

- The pinned Hermes patch stack exposes a one-shot pre-application observer
  whose callbacks and rejection generations remain closure-private.
- Rejections report the actual reason and a fresh generation; completion is
  emitted only after the matching reaction executes or propagates through its
  closure-selected immediate child capability.
- Snapback requires and seals the observer registrar, stores generations
  separately from reasons, and clears only an exact completion match.
- `_B`/`_C` remain inert and direct calls or registrar replay cannot forge
  handling; private rejection state is stored before any public bookkeeping.
- Proxy receivers cannot spoof the canonical prototype/constructor gate:
  observer-authenticated completion requires an engine-private native-Promise
  brand and the canonical constructor branch.
- Cached pre-registration promises retain compatibility, while direct-call and
  custom-`newTarget` objects cannot enroll in the private brand or reinitialize
  a branded Promise. Canonical Handler authorization uses lexical inputs,
  remains unenrolled during alias traversal, then binds to its effective source
  only from the trusted initial handle call rather than mutable `_A`; fabricated
  or mismatched Handler-shaped records cannot invoke internal settlement.
- Snapback seals Ibex's already-authenticated generic `then` wrapper in place;
  native-observer `catch`/`finally` dispatch through the captured intrinsic so
  trusted compatibility wrappers cannot create a false non-canonical path.
- Generic reporting waits for the current microtask checkpoint using a host
  task function captured before application code, so immediate catches do not
  race authenticated completion and missing startup task support fails closed.
- Native await, adoption, all standard combinators, warm/fresh/action paths,
  erased reactions, stale generations, and the existing constructor-poisoning
  corpus pass.
- The canonical Linux proof runs against an exact-identity Hermes artifact and
  passes remotely.

## Implemented; remote verification pending

Ibex patch 0009 adds the one-shot closure-private lifecycle observer and exact
generation matching. The trusted Ibex bundle consumes the engine registrar,
feeds generic native-Promise rejection tracking, and publishes a distinct
closure-owned one-shot downstream bridge. The Snapback bootstrap refuses stale
runtimes without that seam, consumes and seals the bridge before application
source, and delegates all Hermes handling authority to its authenticated
callbacks. The actual reason remains in engine-private state while callbacks
receive an opaque identity token. Private state is stored before public fields,
and enrollment is guaranteed by a `finally` enclosing those fields, legacy
`_C`, and reaction scheduling. Generic/downstream consumers are isolated with
the strict ledger first. Regression coverage
includes native await, adoption, `all`/`race`/`allSettled`/`any`, erased pending
queues, stale same-object generations, direct legacy-hook calls, and registrar
replay. A final adversarial review found that a Proxy could make a JavaScript
descriptor check appear canonical and then steer Hermes into its
custom-constructor bridge. Follow-up review also found that registration-time
branding broke cached primitive promises; public Handler state could be
mutated, inherited through accessors, transplanted across Promises, or rebound
through pre-bind reentrancy; frozen public bookkeeping could throw before
enrollment; and direct constructor reentry could overwrite a live generation.
Patch 0009 now brands only exact
`newTarget` Promises from engine initialization, rejects unbranded receivers
before constructor access, rejects direct reentry before public writes, and
stores lexical canonical reaction snapshots in a second closure-private map,
binding only after effective-source traversal. The Proxy, pending-mutation,
inherited-accessor, transplant, reentrancy, fabricated-resettlement,
frozen-field, reinitialization, and
primitive-cache cases all have regressions. An integrated regression also pins ordinary `.catch()` and
`.finally()` after the harness seals the tracker, hostile generic reason
inspection, throwing public finale bookkeeping, and downstream token mutation.
Generic reporting now uses a host task function captured before application
source, so `Promise.reject(...).catch(...)` and rejected async functions can
execute their authenticated reactions before classification; the old
first-microtask check could leave a false nonzero exit status before the
reaction job ran. Missing startup task support fails readiness. This generic
event/exit diagnostic remains intentionally application-controllable (events,
exit status, and public timer cancellation); Snapback's separate downstream
ledger is the hostile-code transaction-integrity boundary.
Observed exact-Promise adoption now uses a real intrinsic reaction instead of
state-3 aliasing, so detached adopters of an already-handled rejected Promise
receive their own generation; handled and `.then()`-child adoption have
regressions. Observer-mode `Promise.all` also bypasses its public settled-field
shortcut, and a regression proves that mutating the public reason cannot replace
the closure-private actual reason delivered to the aggregate.
Keep this ticket open until
the updated submodule and canonical Linux proof are green on `origin/main`.

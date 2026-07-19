# Authenticate native Promise reaction completion

**Status:** Closed
**Severity:** P0
**Systems:** Runtime, Security, Auth/RBAC, Upstream Ibex, Hermes
**Author:** Codex (GPT-5), directed by Charlie Cheever
**Date:** 2026-07-18
**Closed:** 2026-07-18
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

## Resolution

Ibex patch 0009, published in commit
`bfbc6133af739ed2dabc2f44efa693d1412452e5`, provides the one-shot
closure-private observer, exact generation matching, native-Promise branding,
lexical Handler snapshots, and authenticated adoption/combinator completion.
Snapback consumes and seals that bridge before application source and refuses a
runtime that lacks it. The native-await, constructor poisoning, erased-reaction,
stale-generation, registrar-replay, and combinator regressions pass.

Snapback commit `a5ed6ebd05766b10607937a1c010352d79eea4b0` points at the published
Ibex identity. GitHub Actions local-proof run `29674515103` passed the exact-
identity canonical Linux proof on 2026-07-18.

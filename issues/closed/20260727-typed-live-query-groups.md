# Typed live-query groups and aggregate external store

**Status:** Resolved
**Impact:** 4  
**Urgency:** 4  
**Ease:** 2  
**Confidence:** 4  
**Severity:** P1  
**Systems:** Realtime, Client integration, React, Code generation, Auth, Testing  
**Author:** Codex, directed by Charlie Cheever  
**Date:** 2026-07-27  
**Related:** LLP 0012, LLP 0053, LLP 0064, LLP 0090; `packages/snapback-client/external-store.mjs`

## Resolution

`useSnapbackQueries` and `observeSnapbackQueries` now provide an exact typed
aggregate over canonical child stores, with transactional admission,
same-store sharing, per-child state, deterministic aggregate connection/error
state, replacement isolation, and cleanup. Signal Desk no longer hand-builds
four subscriptions or its disposal logic.

Code generation now projects each declared route into an exact generated group
reference whose closed child refs, route parameters, argument mapping, and
result types are all represented in the generated TypeScript API. The prepared
binding admits those refs and can acquire an LLP 0090 register-mode bundle
before mount. It validates the complete returned child set and one-commit
provenance, then hands each registered subscription to the existing canonical
child store. This preserves one cache seam and closes the prime/subscribe
window.

Targets that explicitly refuse bundle acquisition with a stable
`SNAPBACK_BUNDLE_*` diagnostic may opt into live fallback. Fallback retains the
same generated group identity and child stores but reports `boot: null`, so it
does not counterfeit one-commit provenance.

The package proof covers exact generated identity and parameter rejection,
registered adoption with two children from commit 41 and no ordinary starts,
fallback with ordinary starts and no registered starts, typed child result
inference, sharing/isolation/update/error/authority behavior, and final
cleanup. Signal Desk now declares a route group and prepares that generated
group before mounting its provider instead of maintaining a custom four-feed
aggregator or disposal path.

## Desired resolution

- Generate a typed query-group/route reference with closed child query refs and
  argument mapping.
- Prime eligible children from one LLP 0090 bundle cut and register live
  subscriptions without a prime/subscribe race; use a capability-gated
  fallback when the target cannot bundle.
- Project the existing child external stores into one immutable aggregate
  snapshot. Do not create another normalized entity cache.
- Bind group identity to refs, canonical args, authority, artifact generation,
  and bundle identity. Authority change blanks/fences the complete group.
- Define aggregate and per-child pending/ready/refreshing/error, connection,
  freshness, partial-error, settlement, and teardown semantics.
- Add `useSnapbackQueries` plus framework-neutral construction/inspection.

## Acceptance

- The initial grouped answer comes from one commit; no update between prime and
  registration can be missed.
- Generated tuples/objects infer each child's args and result without casts.
- Strict Mode, sibling group sharing, different-key isolation, one-child
  updates, mixed connection states, error isolation, late delivery, authority
  replacement, fallback, and final cleanup are deterministic.
- The Signal Desk adapter replaces four hand-built subscriptions with one
  group and deletes its custom aggregation/disposal code.
- Client/bundle/protocol tests prove one cache seam, stable identity refusal,
  and unchanged individual-query behavior.

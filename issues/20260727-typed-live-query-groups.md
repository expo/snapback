# Typed live-query groups and aggregate external store

**Status:** Open  
**Impact:** 4  
**Urgency:** 4  
**Ease:** 2  
**Confidence:** 4  
**Severity:** P1  
**Systems:** Realtime, Client integration, React, Code generation, Auth, Testing  
**Author:** Codex, directed by Charlie Cheever  
**Date:** 2026-07-27  
**Related:** LLP 0012, LLP 0053, LLP 0064, LLP 0090; `packages/snapback-client/external-store.mjs`

The external store deduplicates identical query identities, and LLP 0090's app
bundle can prime multiple route queries at one commit. There is no generated
query-group reference or aggregate store, so a four-feed workspace still owns
manual snapshot assembly, partial readiness, errors, and cleanup.

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

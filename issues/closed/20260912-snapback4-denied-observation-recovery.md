# Snapback 4: Keep read dependencies when a local query refuses

Status: Closed
Resolved: 2026-09-13
Priority: P1
Observed: 2026-09-12
Review finding: R13
Evidence: Reproduced end to end
Baseline: `d6c803878a5432cce5f045777786a049972d3d70` / Snapback 4 0.0.16
Related: [LLP 3000.003](../../llp/3000.003-one-semantics-and-credible-verification.research.md), [comprehensive review](../../llp/reviews/3000-architecture-code-review-20260912.md)

## Problem and reproduction

`runLocal` catches a `Refused` error and returns an empty dependency set.
A query that refuses after reading a prerequisite can then never be
invalidated by a change to that prerequisite.

Reproduction: observe a query that requires `exists members[viewer]` before
reading items. It initially returns `NO_MEMBERSHIP`. Add the membership on the
server, explicitly sync, and wait for notifications. The observation remains
denied, while a direct call of the same query succeeds.

Preserve the interpreter's read dependencies through refusal, or use a
conservative invalidation set for failed evaluations. Include negative point
reads and failed requires. On generation changes, also invalidate observations
whose operation changed even if their previous dependency set was empty.
Acceptance: the mounted observation recovers after the prerequisite arrives,
and a later removal produces the current result/refusal without a remount.

## Implementation locations

- [packages/snapback4/src/local.ts](../../snapback4/packages/snapback4/src/local.ts)
- [packages/snapback4/src/replica/interpreter.ts](../../snapback4/packages/snapback4/src/replica/interpreter.ts)

## Resolution — 2026-09-13

Denied local observations retain conservative operation/rule dependencies and rerun when missing memberships or target rows arrive. Unknown coverage survives a query refusal and can route to authority.

Verification and independent review are recorded in the [correction qualification](../../llp/reviews/3000-review-corrections-20260913.md). Relevant regression or artifact locations:

- [packages/snapback4/test/client-lifecycle.test.mjs](../../snapback4/packages/snapback4/test/client-lifecycle.test.mjs)

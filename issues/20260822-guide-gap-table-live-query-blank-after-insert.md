# guide-gap: table live queries can go empty after a same-table insert

**Status:** Open
**Impact:** 4
**Urgency:** 4
**Ease:** 3
**Confidence:** 4
**Systems:** Guide, Live queries, React/Expo, Codegen
**Date:** 2026-08-22
**Governing:** LLP 0008; LLP 0061
**Evidence:** Diary 0106 M2/M3; Clique local-main Grok Explicit on
`b70caf19ea`

## Problem

A handwritten table live query filtered by `eq('_id', …)` or by parent id
can publish **no rows** immediately after a successful insert into the same
table. The mutation settles, related counters can increment, and the
subscribed point/list query then renders empty (Clique: thread screen
stuck on “Loading thread…”; later, DM bubbles missing until the query
became JS).

JS live queries that re-run the handler on writes restored the rows. The
start packet and live-query Guide page do not say that table incremental
deltas and JS replace semantics diverge this way, or when to pick JS.

This is distinct from Familiar six-subscription contention
(`issues/20260820-familiar-live-subscription-contention.md`) and from the
closed owner-visibility-exit delta leak
(`issues/closed/20260812-live-delta-owner-visibility-exit-skipped.md`).

## Required change

- Capture a faithful React/JS `writePost` reproduction and probe trace across
  `postById` / `repliesForPost`, including the identities, subscription and
  settlement versions, raw durable frames, authorization events, and component
  mount state. A product test that actually reproduces the blank is equivalent
  evidence.
- If that evidence reproduces a matcher/delta defect, fix the incrementalizer
  and retain the failing-then-fixed product test. If it identifies a
  non-matcher cause, document and test that boundary instead.
- Keep the residual warning, workaround, selection rule, and `snapback guide`
  aliases (`blank after insert`, `Loading thread`, `live_delta empty`) until
  the faithful trace or genuinely blanking product test lands and the cause is
  fixed or documented.

## Acceptance

- A cold agent following the Guide for a point live query plus insert does
  not have to discover JS live queries by watching the UI go blank.
- A minimized reproduction either fails a product test (if defect) or is
  cited as the documented JS-vs-table recipe (if intended).

## Investigation note (2026-08-25)

HostPlan point/parent matching-insert cases pass at the engine and kit layers;
the Clique blank remains unexplained pending a faithful trace of the React
thread (`postById` / `repliesForPost`), the JS `writePost` insert plus parent
`replyCount` patch, provisional/outbox identities, or the original probe dump.
The characterization coverage establishes the matcher contract for the cases
it runs, but does not rule the matcher out for the observed product path.

Until that trace exists, mutation-delivery timing, canonical-versus-provisional
identity, authorization blanking, remount/HMR, and optimistic-create projection
are diagnostic hypotheses rather than an established fix. The observed
`defineJsLiveQuery` plus local-cache change remains the documented application
workaround for Clique; its success does not establish which boundary caused the
blank.

## Investigation note (2026-08-28)

Shape `(e)` in `demos/_kit/tests/live-query-invalidation-e2e.mjs` now retains
the closest source-client React reproduction available in this repository. A
generated sessions backend exposes declarative `postById` and
`repliesForPost` table live queries plus a generated JS `writePost`; the
mutation inserts a reply into `posts` and patches the subscribed parent's
`replyCount` in the same commit. A StrictMode component opens both generated
hooks before the write, dispatches the mutation through
`useSnapbackMutation`, changes the point query to the settled canonical child
id, and then forces a remount.

The report retains canonical/public mutation identity observations,
client-side mutation identity pseudonyms, query arguments, subscription ids
and versions, mutation settlement/version, complete raw durable frames,
authorization events, connection state, and every component mount and render.
The public mutation outcome in this recipe exposes the canonical row id but no
provisional/outbox id or id map.

Ten fresh-server development-smoke runs on macOS arm64 did not reproduce the
blank. In every run both original subscriptions began at version 1 and
converged at settlement version 2; the parent remained present with
`replyCount: 1`, the reply list contained the canonical child, and a canonical
id transition plus StrictMode remount both snapshotted the child. There were no
empty `ready`/`refreshing` parent renders. Each run also observed three
`SNAPBACK_AUTH_INVALIDATION_SCOPE_INVALID` callbacks when a sibling
subscription's invalidation reached the other scoped handle; the exact scoped
authorization snapshots still followed and no result blanked. That repeated
diagnostic is retained evidence, not an established cause.

This is not checkout-bound negative evidence: the explicitly supplied debug
binary reported dirty commit `e9b5195858dd3b19b95ff53b0507f93e3ee319bb`
while the lane checkout was `ed8aad5e6a90b39a2dc996a6232bd315433ce475`, so
the harness's ordinary evidence mode correctly refused it and only the
explicit `--development-smoke` mode ran. The result narrows the provided
runtime/source-client React-renderer path; it does not reproduce Clique's
original browser/Metro/HMR lifecycle, its published client bundle, its Linux
host, or the missing original probe dump. The cause therefore remains open,
and the Guide warning, workaround, selection rule, and search aliases remain.

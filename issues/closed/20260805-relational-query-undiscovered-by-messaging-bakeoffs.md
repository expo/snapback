# `defineRelationalQuery`/`defineMaintainedProjection` were never discovered by three independent messaging bakeoffs

**Status:** Resolved
**Impact:** 3
**Urgency:** 2
**Ease:** 3
**Confidence:** 4
**Systems:** Guide, Discoverability, Relational queries
**Date:** 2026-08-05
**Governing:** LLP 0080 (portable relational queries and maintained projections)
**Related:** LLP 0176; LLP 0177; `guide/backend/relational-queries.md`; Diaries
0058 (`messaging-snapback`), 0058 (`relay-room-expo-backend-bakeoff`), 0059
(`tandem-expo-messaging-bakeoff`)

## Problem

`defineRelationalQuery` (a bounded, closed two-source equi-join with a
declared projection) and `defineMaintainedProjection` (the same join
maintained as a durable output table, updated transactionally with its
sources) have been `Implemented`/stable (`relational_query_v1`) since
2026-07-26. `guide/backend/relational-queries.md` documents both with a
worked example that is structurally almost identical to a chat app's
"conversation joined to its members" or "message joined to its sender" shape.

All three independent 2026-08-05 messaging bakeoffs needed exactly this shape
— `myConversations` (conversationMembers joined to conversations) is a
textbook `defineRelationalQuery`/`defineMaintainedProjection` case — and none
of them used it. All three dropped straight to a JS handler
(`defineJsLiveQuery`) with a hand-written join, which is a legitimate and
guide-endorsed choice for logic the declarative vocabulary can't express, but
in this case the declarative relational-query vocabulary already could
express (at least) the pure-join half of what they needed. This is the same
discoverability pattern as
`issues/closed/20260805-admin-console-undiscovered-by-expo-bakeoffs.md`: a real,
shipped capability that a workload it fits well never found.

This is distinct from the aggregation gap tracked separately in LLP 0177 —
`defineRelationalQuery` genuinely cannot express a grouped reaction count or a
reply-preview self-join today (aggregation is an explicit v1 non-goal, and
whether self-join is admitted at all is unconfirmed — see LLP 0177's open
questions). This ticket is only about the plain-join portion of the workload
that the existing capability already covers but that no builder found.

## Fix shape

- Add a chat/messaging-shaped example to `guide/backend/relational-queries.md`
  or cross-link it from wherever the guide discusses membership/join patterns,
  since "conversation list joined to membership" is a closer match to a
  builder's mental model than the current books/authors example.
- Cross-reference `defineRelationalQuery`/`defineMaintainedProjection` from
  the JS-handler / `defineJsLiveQuery` guide content at the point where an
  author is about to reach for a JS handler specifically to do a join, so the
  declarative option is considered first for the cases it actually covers.
- Confirm (and document) whether a self-join (root and joined table the same)
  is admitted — needed to know whether the reply-preview "first related row"
  case is in scope for the existing capability or belongs entirely to LLP
  0177's proposed aggregation profile.

## Acceptance

- The relational-queries guide page includes or links an example recognizable
  as a chat/membership join, not only the books/authors domain.
- An author who reaches for a JS handler to express a plain bounded two-source
  join is pointed at `defineRelationalQuery`/`defineMaintainedProjection`
  before writing one.

## Resolution — 2026-08-05

`guide/index.md` and the capability index now name both shipped declarations
and messaging aliases. `guide/backend/queries.md` points an author away from a
hand-written `defineJsLiveQuery` before a plain conversation-membership or
message-sender join, and `guide/backend/relational-queries.md` maps those
workloads onto the root/joined model.

The same page now states the boundary found in source: v1 refuses the same
table as both `root` and `joined`, and grouping/aggregation also remains
outside the shipped profile. Those cases stay with bounded JS handlers or
their owning follow-on design; the guide does not imply they already ship.

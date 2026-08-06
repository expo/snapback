# guide-gap: what does a legitimate non-user-scoped maintenance scan look like?

**Status:** Open
**Impact:** 2
**Urgency:** 2
**Ease:** 4
**Confidence:** 4
**Progress:** Not started
**Severity:** P3
**Systems:** API, Developer experience
**Author:** Claude (Opus 5), building demos/eas-payments
**Date:** 2026-08-06
**Related:** guide/backend/queries.md, guide/backend/cron.md, diaries/0066-eas-payments-engine-slice.diary.md

The EAS Payments expiry sweep runs from cron under system authority, so it has
no user to scope by. It needs "every grant that is still active", then filters
on `activeUntil` in the handler.

[queries](../guide/backend/queries.md) documents the builder verbs as valid
"in any order after `.withIndex(name)`", which reads as "an index is required".
The guide's only warning about unbounded reads is the pagination one ("do not
collect the whole partition and slice it in JavaScript"), which is about page
cost, not about whether an unscoped scan is legal at all.

To get a partition I added `by_active` on a boolean column. Codegen accepted
it. But a boolean index is a two-value partition — it satisfies the builder
without doing any real narrowing, which suggests I am satisfying a syntax rule
rather than expressing an access path.

## What would close this

A short section — probably on [queries](../guide/backend/queries.md),
cross-referenced from [cron](../guide/backend/cron.md) since sweeps are where
this comes up — answering:

1. Is `ctx.db.query(table).collect()` without `.withIndex(...)` sanctioned, and
   if so under what bound?
2. If an index is always required, what is the recommended shape for a
   maintenance sweep with no natural partition — a low-cardinality status index
   like the `by_active` above, a time-bucketed index, or something else?
3. What upper bound should an author assume for a sweep's result set before it
   needs to page?

An acceptance-backed example of a cron sweep would be better than prose. The
`demos/eas-payments` `applyGrantExpiry` handler is a candidate source.

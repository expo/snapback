# guide-gap: does a captured equality predicate refresh a subscription when a matching row stops matching?

**Status:** Open
**Impact:** 3
**Urgency:** 2
**Ease:** 4
**Confidence:** 4
**Progress:** Not started
**Severity:** P3
**Systems:** Realtime, Developer experience
**Author:** Claude (Opus 5), building demos/eas-payments
**Date:** 2026-08-06
**Related:** guide/realtime/live-queries.md, guide/backend/queries.md, diaries/0066-eas-payments-engine-slice.diary.md

Building the EAS Payments slice I needed a live query over "this user's
**active** entitlement grants". The natural spelling captures the predicate so
the matcher can skip irrelevant mutations:

```js
ctx.db.query('entitlementGrants')
  .withIndex('by_user').eq('userId', ctx.auth.userId)
  .eq('active', true)
  .collect()
```

The expiry cron flips a grant `active: true -> false`. Whether that refreshes
the subscription depends on the matcher evaluating the row's **pre-image**, not
only its post-image. I could not determine the answer from the guide.

`demos/todo/tests/acceptance/headless.mjs` covers only the *entering*
direction: an insert with `completed=false` does not refresh a `completed=true`
subscription, and a patch to `completed=true` does. Nothing in the corpus
covers the *leaving* direction.

I worked around it by scoping on `by_user` in the builder and filtering
`active` in JavaScript, so the captured read set stays "this user's grants" and
every change refreshes. That is correct but strictly less selective, and I
chose it from absence of evidence rather than from documentation.

## What would close this

One sentence in [live queries](../guide/realtime/live-queries.md) stating
whether a captured equality/`in` predicate refreshes a subscription when a
previously matching row stops matching, plus a `demos/todo` acceptance check in
the leaving direction so the answer is CI-pinned rather than prose.

If the answer is "yes, pre-image is evaluated", the guide should say so and the
narrower predicate becomes the recommended spelling. If the answer is "no", the
guide should name the filter-in-JS pattern as the correct one for any predicate
a row can leave.

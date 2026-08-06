# guide-gap: writing and clearing optional fields from a handler

**Status:** Open
**Impact:** 2
**Urgency:** 2
**Ease:** 5
**Confidence:** 5
**Progress:** Not started
**Severity:** P3
**Systems:** API, Developer experience
**Author:** Claude (Opus 5), building demos/eas-payments
**Date:** 2026-08-06
**Related:** guide/getting-started/your-first-backend.md, guide/backend/mutations.md, diaries/0066-eas-payments-engine-slice.diary.md

`v.optional(inner)` is listed in the core validator inventory on
[your first backend](../guide/getting-started/your-first-backend.md), but no
guide page shows what a handler writes for an absent optional value.

Concretely, in the EAS Payments slice a subscription grant carries
`activeUntil` and a non-consumable grant has none:

```js
const expiresAt = args.expiresAt === undefined ? null : args.expiresAt;
await ctx.db.insert('entitlementGrants', { /* ... */ activeUntil: expiresAt });
```

I could not confirm from the guide whether `null` means "absent", whether
omitting the key entirely is equivalent, or whether either is rejected. I
inferred `null` from `demos/all-aboard/snapback/handlers.mjs`, which clears an
optional integer with `lastUpstreamPollAt: null` in a patch. It works.

Inferring a write-path semantic by reading another demo's handler is the exact
failure the guide exists to prevent.

## What would close this

Three sentences, probably on [mutations](../guide/backend/mutations.md), stating
for both `insert` and `patch`:

- what value writes "absent" for an optional field (`null`, omission, or both);
- whether omitting a key in `patch` leaves the stored value untouched (assumed
  yes, unstated);
- what a handler reads back for an absent optional — `null`, `undefined`, or
  key-not-present — since a handler filtering on one of these has to know.

The third is not hypothetical: `applyGrantExpiry` guards with
`until !== null && until !== undefined` precisely because the guide does not
say which it will be.

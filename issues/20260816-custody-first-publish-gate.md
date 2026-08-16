# Custody first-publish gate blocks the thirteen-package ceremony

**Status:** Open

**Filed:** 2026-08-16 (custody publication admission review)
**Blocks:** the first qualified publication of
`@expo/snapback-expo-custody` and completion of LLP 0041's 0.1.24 ceremony

## Finding

`@expo/snapback-expo-custody` is a brand-new npm name joining LLP 0041's
qualified closure as the thirteenth package. npm assigns `latest` on a first
publication even when the publish uses a holding tag. A failure later in the
multi-package publish, byte verification, or post-publish smoke can therefore
leave custody publicly selected before the full closure qualifies.

## Gate

Follow the repository's `@expo/snapback` first-publication precedent from
`issues/closed/20260814-umbrella-first-publish-gate.md`:

1. Repository-side admission must cover the thirteen-name authority and
   schemas, historical-prefix replay, staging, packing, cold-install,
   byte-verification, and receipt paths before any outward mutation.
2. The admission change does not publish custody. Its first publish happens
   only in a separately authorized qualified ceremony.
3. Keep this ticket open through that ceremony. Close it only after all
   thirteen exact package bytes verify, all thirteen `latest` tags converge,
   and the post-publish smoke passes, with the completed record retained in
   LLP 0041.

The umbrella precedent did not add package-specific tag or cleanup machinery,
and this gate does not invent any. The existing generic first-publish
reconciliation treats npm's auto-selected exact custody candidate as an
already-promoted prior member and a verified no-op during promotion. If the
complete ceremony does not close, no qualified-publication claim advances;
the retained ceremony evidence and this still-open gate require explicit
reconciliation before another attempt.

## Ceremony addendum (2026-08-16, after the Android flip 7f3607781)

The LLP 0258 Phase-2 Android arm landed source-current-but-unpublished
(Android-only ordinary-path admission, exact android+single-runtime tuple;
evidence bundles 75ffc7733; iOS remains refused per
issues/20260816-ios-extension-refusal-probe.md). Whoever runs this ceremony
must, in the same publication change, add the Android grade row to
`packages/snapback-expo-custody/README.md` consistently with the package's
Experimental / adapter-reported-grades description wording, so the published
README and the shipped Android capability row agree at first publish.

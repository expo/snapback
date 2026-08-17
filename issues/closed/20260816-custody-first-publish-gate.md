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

## Historical ceremony addendum (2026-08-16, after the Android flip 7f3607781)

The LLP 0258 Phase-2 Android arm landed source-current-but-unpublished
(Android-only ordinary-path admission, exact android+single-runtime tuple;
evidence bundles 75ffc7733; iOS remains refused per
issues/20260816-ios-extension-refusal-probe.md). Whoever runs this ceremony
must, in the same publication change, add the Android grade row to
`packages/snapback-expo-custody/README.md` consistently with the package's
Experimental / adapter-reported-grades description wording, so the published
README and the shipped Android capability row agree at first publish.
This interim one-OS state is superseded by the both-OS addendum below.

## Ceremony addendum (2026-08-16, after the iOS flip 7942b3b43)

Both exact provider tuples are now source-current and **UNPUBLISHED**:
Android + `single-runtime` is supported by
`demos/native-custody-probes/evidence/20260816T214639Z-0a6c91ed-phase2-android`,
and iOS + `single-runtime` is supported by
`demos/native-custody-probes/evidence/20260817T023429Z-1c2624fb-phase2-ios`.
The closure records are
`issues/closed/20260815-llp-0258-phase-2-native-custody-evidence.md` and
`issues/closed/20260816-ios-extension-refusal-probe.md`.

The separately authorized ceremony must publish a README grade table naming
**both** OS rows and their `single-runtime` grades, while preserving the
package's Experimental / adapter-reported posture. The iOS row must retain the
share-sheet-kind-only evidence boundary and the NSE/`simctl push` nonclaim.
This addendum performs no publication, changes no npm tag, and does not close
this gate.

## Resolution — 2026-08-17 (0.1.24 ceremony complete)

The separately authorized qualified ceremony (author-triggered 2026-08-17)
published the thirteen-package closure from clean revision
`f8cbf3d253b59d747572ec166750efc208709686` under holding tag
`fastpath-0-1-24-f8cbf3d253b5`. `@expo/snapback-expo-custody@0.1.24` was
first-published in this cut with the both-OS `single-runtime` grade table and
preserved iOS evidence boundary/nonclaims in its README (rider `9fc2e5580`).
All thirteen registry tarballs re-downloaded byte-identical to the retained
candidate ledger
(`~/snapback-release-ledgers/fastpath-ledger-0.1.24-f8cbf3d253b5.json`,
SHA-256 `d5254fd820c88cb67af3cc4be361cb5cfb00f1d82e49e15d0c0dae039b88fb8b`),
the external registry-installed boot smoke passed all eleven checks, and all
thirteen `latest` tags converge on 0.1.24
(readback retained as `~/snapback-release-ledgers/latest-readback-0.1.24.json`).
npm's first-publish read-path lag reproduced on the custody name exactly as
the umbrella precedent predicted; the idempotent resume closed it. The full
ceremony record, including the recorded smoke-harness deviation, is in
LLP 0041 §0.1.24. Gate closed.

# Video location policy is declared under a block named `image`

**Status:** OPEN — RULED 2026-08-03, now implementable (was an
author-facing naming question from the round-2 clip-locker rebuild,
diary 0048-clip-locker, round-2 entry)

A fresh builder declaring a video upload intent hit
`SNAPBACK_ASSET_INTENT_LOCATION_POLICY_REQUIRED … declare
image.location ('strip' or 'retain')` — for `video/mp4`. The mandatory
location policy (LLP 0044's location-bearing-media rule) lives under the
intent's `image:` block even when the accepted media types are video;
the diagnostic faithfully names the confusing spelling. This is a
naming wart, not a behavior bug: the policy applies per media type
correctly once declared.

Options (author call — the `image:` spelling is part of the frozen
L1-03 authoring surface and the 0044 v6.1 text): (a) rename the block
to `media:` with `image:` kept as a deprecated alias for existing
apps' policy hashes; (b) admit `video: { location }` as a sibling
spelling; (c) keep `image:` and document the historical naming. The
intentPolicyHash implications of any rename need the same care as any
policy-identity change (existing hashes must not silently move).

Evidence: demos/upload-bakeoff/clip-locker/snapback-r2/build-log.md
stumble 1.

## Ruling (2026-08-03)

Ruled by Charlie at author decision sitting #2
(`issues/20260803-author-decision-sitting-2.md`): **option (b)** — admit
a `video: { location }` sibling block. The `image:` block is untouched:
its frozen `intentPolicyHash` spellings are preserved, and the
image/video split is documented rather than aliased away. The dated
decision note is landed in LLP 0044's amendment collection (§Video
location policy: the `video: { location }` sibling block). The ticket is
now implementable; policy-identity care applies as stated above
(existing hashes must not silently move).

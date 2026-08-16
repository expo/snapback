# Media-bearing row changes do not push live updates

**Filed:** 2026-08-16 · **Status:** Open · **Systems:** Server, Live
queries, Assets

**Related:** issues/20260815-finish-media-happy-path.md (device pass);
issues/closed/20260816-media-livequery-retained-row-staleness.md (the
client-side half, already fixed)

## Repro (headless, deterministic, ~10s)

`demos/media-happy-post/tests/probe-live-push.mjs` against the demo server:
a live `listProfiles` subscription receives its baseline emission; a second
client then commits `changeAvatar` (task `succeeded`; the profiles row's
`avatar` column updates); **no second emission arrives within 8 seconds**.
On the device the avatar therefore only appears after an app-state cycle
forces reconnect + fresh baseline.

Corroboration from server telemetry: after a live avatar commit, no
`listProfiles` re-evaluation fires until the next (re)subscribe; separately
`postMediaList` evaluations appear on a ~5s cadence (poll-shaped), which is
why post/collection updates seem to arrive while profile media changes
never do.

## Suspected shape

The mutation writes `profiles` (declared `writes: ['profiles']`) via the
LLP 0180 command's attach path; ordinary table-change invalidation should
re-evaluate subscribed live queries over `profiles`. Either the
asset-attach commit path bypasses the table-change notification, or
media-bearing live queries (which are excluded from the single-table RQS
resume class) are also unintentionally excluded from change-driven
re-evaluation and survive only on a poll fallback that does not cover this
query. Root-cause before fixing; do not paper over with a poll.

## Wanted

Media-bearing live queries re-evaluate and push on the same table-change
invalidation as ordinary rows. Regression at the real-route level: live
subscribe → out-of-band media-field commit → emission arrives.

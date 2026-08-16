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

## Resolution (2026-08-16, Phase L)

Root cause was one seam past the original localization: mutation commit,
scheduler dispatch, and subscription matching all worked (spike-traced),
but the DK-3 single-table delta eligibility admitted media-bearing queries
because the physical row matches the schema-derived shape — so `live_delta`
published the RAW stored row (avatar as a plain asset-id string), bypassing
the LLP 0244 exact `{ assetId, kind }` projection. Typed clients correctly
could not apply it; the UI caught up only when a reconnect served a fresh
projected baseline. (The original headless probe compounded the picture by
defaulting to manual-poll transport — it never received anything; it now
uses transport: 'stream'.) Fix: media-bearing result contracts are excluded
from the raw single-table delta lane and push through the authoritative
re-query/`live_replace` lane until a typed media-aware delta projection
exists. Real-route regression: live subscribe → out-of-band media commit →
typed emission. Verified 42/42 media tests and the streamed probe 3/3.

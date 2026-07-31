# 0044 L1 follow-up: asset metadata live projection over the WS channel

**Status:** OPEN — deferred from L1-08 (2026-07-31); blocks the
"no polling" acceptance rows and L1-14's live hook path

L1-08 landed the invalidation-correct substrate: `asset_read_authorized`,
the complete captured-dependency set (reverse-edge range with pinned
empty capture, sharing-row and membership dependencies),
`asset_read_dependencies_moved`, and the `GET /assets/records/{id}`
metadata read. Asset metadata is not yet projected into the WS
live-query channel.

Needed: a live projection that establishes asset-metadata subscriptions
in the protected-query profile, re-runs `asset_read_authorized` at
governed boundaries, and republishes on `asset_read_dependencies_moved`
— so availability/rendition transitions reach subscribers with no
polling and revocation blanks live state. Belongs with L1-14's client
work or immediately before it; the lifecycle-v1 capability claim's
liveness acceptance rows gate on it.

---

**RESOLVED 2026-07-31** (commit d10f6c49 on `0044-lifecycle-v1`): the
reserved system live query `_snapback.assetRecord` rides the ordinary
subscribe/notify machinery with native execution — publish, wake-on-first-
attachment (the pinned empty-range capture moving through an app commit),
edge-removal revocation, and deletion all deliver `live_replace` frames
with no polling; unrelated commits recompute and stay quiet (fingerprint
dedup). Client establishment: `SnapbackAssetClient.watch()` (9e289e78).
Evidence: `asset_record_live_projection_publishes_wakes_and_blanks_with_no_polling`,
`asset_record_live_projection_refuses_bad_input_and_unrelated_commit_stays_quiet`.

Recorded remainder (does not gate the local dev-lane claim): sessions-mode
establishment fails closed (`SNAPBACK_ASSET_LIVE_SESSIONS_UNSUPPORTED`)
until the projection's auth-invalidation classification under LLP 0053's
protected-query profile is written; the React store integration consumes
the frames in L1-14's remainder.

**W2e annotation (2026-07-31, later same day):** the recorded remainder
above is closed. Sessions-mode establishment is admitted under the
sealed session identity through the ordinary auth-scoped admission (the
blanket refusal and its diagnostic are retired); re-runs execute the
projection natively inside the witnessed obligation/snapshot lane at
all three seams (drain, frame fan-out, resume resnapshot); no new LLP
0053 classification was needed (llp/0044 §Status W2e note records why).
Evidence: `asset_record_live_projection_sessions_mode_rides_the_witnessed_lane`.
Sessions callback execution authority remains open as
issues/20260731-0044-sessions-callback-authority.md.

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

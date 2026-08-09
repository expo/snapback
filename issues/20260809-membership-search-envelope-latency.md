# Membership-visible message search slow at scale envelope (806ms p95)

Clique pilot, Snapback lane scale probes (166k-action envelope):
search.busyChat p50 582ms / p95 806ms on a 10k-message chat while
every other probe sat at 31-77ms p95 (paging flat, feed fan-in 1.8x).
The one slow surface; Convex's equivalent global search probe: 82ms
p95 (posture differs — signal, not a claim). Likely the
membership-visibility filter composing badly with the search index at
volume. Worth a look before any scored wave since O5 ceilings will be
calibrated near these numbers. Evidence: p2-pilot snapback-lane
scale-report.json.

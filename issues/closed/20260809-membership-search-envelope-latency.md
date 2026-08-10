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

## Resolution — 2026-08-10

Fixed under LLP 0221 Phase 0(b) (an LLP 0073 implementation fix; public
semantics unchanged). Two bottlenecks in `src/search/sqlite.rs`:

1. Both prefix predicates (the `COUNT(DISTINCT token)` vocabulary-ceiling
   probe and candidate traversal) used `substr(token,1,length(?))=?`,
   which is non-sargable and forced a full token scan of the partition's
   posting vocabulary twice per query. Replaced with the half-open
   successor range `token>=? AND token<?` (open-ended when no successor
   exists), which seeks on the `_snapback_search_terms_anchor` covering
   index. Byte-order equivalence and ceiling thresholds preserved
   exactly.
2. Candidate release ran two point queries per candidate (retained
   source + authoritative row). Now fetched in deterministic IN-list
   chunks (400 ids); the per-candidate authoritative re-derivation,
   digest tamper/drift rechecks, and all-or-nothing release are
   unchanged.

Proof landed with the fix: a deterministic `EXPLAIN QUERY PLAN`
regression gate (anchor-index token-range SEARCH, no terms SCAN),
`prefix_upper_bound` unit vectors, a selective-prefix membership fixture
(4,000 rows / ~21k-term partition; best-of-5 56.4 ms debug, equal within
noise to pre-fix at this deliberately CI-sized fixture where release
re-derivation dominates), and a broad-match 2,000-row release-path
budget test; full `search::sqlite` module green. Residual
follow-through, tracked in LLP 0221 §Execution log: an envelope-scale
measured before/after, and the Clique 10k-message/166k-action pilot
probe rerun at the next Clique run (O5 ceilings calibrate near these
numbers).

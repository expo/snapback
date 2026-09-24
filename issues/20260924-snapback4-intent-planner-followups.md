# Snapback 4 intent planner: known limits and test-strength follow-ups (LLP 3000.013)

**Opened:** 2026-09-24. **Owner:** Snapback 4. **Source:** Lane A's final reports and the final delta reviews (Astra, Grok) recorded in LLP 3000.013 §10.

The planner is READY by both families. These are recorded limits and test gaps, not open defects:

1. **One lane-producing conjunct per read.** Only the first `in` or `exists` conjunct of a source read expands into lanes. Further such conjuncts, helpers, and non-query programs keep residual scans (correct, but not lane-planned).
2. **Calendar-name collisions fall back to a residual scan** instead of bucket lanes.
3. **A declared index with extra components after `id` is not reused** by the planner; it synthesizes its own.
4. **Test strength (Grok, final delta):** `aggregate_range_choice_is_canonical_and_prefers_finite_windows` passes even if the two-sided preference is deleted, because its window column `at` also sorts first alphabetically. Add `.score >= 0 and .score < 10 and .at > 0` asserting that the seek is on `score`.
5. **Notes still emitted on the paved path (Lane F):** `N_NO_HORIZON` for full-history search, and `N_MAINTAINED_COLUMN_STREAM` in Following. Decide whether each is advisory noise, or should be restated.

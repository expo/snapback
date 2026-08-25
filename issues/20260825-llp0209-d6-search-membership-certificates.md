# LLP 0183 D6 / LLP 0209 — ship graph search-membership certificates and corpus rows

**Opened:** 2026-08-25 (P-C publication-readiness record)

Implement the D6 owner-issued provider identity, authority class, completeness, version, scope, and invalidation certificate consumed by `search-membership` (today the corpus freezes `SNAPBACK_GRAPH_SEARCH_UNADMITTED` and proves defense-in-depth refusal only — GAP by design). Add positive, negative, visibility-sensitive, combined-filter, rebuild/version-transition, and refusal rows, then run them through evaluator, matcher, and the claimed production target. Cross-link `issues/20260802-wave1-0136-live-search.md`, but do not close this ticket merely because `live_full_text_search_v1` ships or the current refusal remains stable.

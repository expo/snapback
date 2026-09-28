# PF context pack

Scope: SQLite search heads, maintained point reads, HTTP query latency and calibration #25 replay.

Governing documents (in llp/current, except 3000.014):
- LLP 3000 §4 and §7: independent workspace and measured compiler/cache policy.
- LLP 3000.024 §3 and Decision: one membership opening, compact heads, selected fields, repeated work priced, no retained search session.
- LLP 3000.028 §3.3: current/Left composition, bounded point overlap inside the same server invocation, current authorization and shared allowance.
- LLP 3000.015 §2: one physical authorization allowance; no disclosure through pricing.
- LLP 3000.014 §5: authorize aggregates before live computation.
- LLP 3000.019 §3.7: doctor owns server percentiles; Server-Timing is dev-only.

Paved surface: guide/search.rs, search_all.md, maintains.md and bounds card. Insights already reads six maintained views plus follower/following counts; seven daily entries use full group-key points. Search uses the explicitly scoped current-membership query, not an ordinary composed query. Measure that exact operation first; evaluate ordinary search and overlap separately.

Risks: shared-host scheduling noise; ten samples make the builder p95 identical to the maximum; fixed overhead can dominate a shape comparison. Preserve all batch results and use complexity regressions independently of timing.

Design update: LLP 3000.007 §20.24.1, read before the storage edit, governs ordered byte-length preflights and payload allocation. Skip the payload statement only after a successful empty preflight in the same snapshot; retain every reservation and preflight charge. No authoring or search-plan change. Hand-off: none.

Evidence: the supplied instrument symlink is broken. Repository fixtures/scale.log matches b26bf1ae8ccf2d64c8ca34bca6562b63a5174956a40c33c123aff8050b6abba9 exactly. All runtime files are copies under target/pf. The original SQLite and WAL are never opened for writing.

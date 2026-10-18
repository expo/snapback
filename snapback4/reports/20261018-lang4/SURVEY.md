# LANG4 100-schema survey

Read-only evidence copies: all 100 schema source SHA256 values match before/after. Each lane compiles its complete flat `snapback/*.q` module set in a private temporary app. Fixtures are intentionally not copied in either run, so these readiness totals differ from the wave analysis census. All 100 exit 0 before and after; no error changes.

Total notes: 452 → 458. Full findings are compressed alongside this report.

| Code | Before | After |
|---|---:|---:|
| N_CASCADE_DORMANT | 7 | 7 |
| N_CONDITIONAL_COMPLETE | 3 | 3 |
| N_DELETE_RESTRICTED | 3 | 3 |
| N_IMMUTABLE_PATCH | 14 | 13 |
| N_MAINTAINED_COLUMN_DISCLOSURE | 2 | 2 |
| N_MAINTAIN_AUTHORIZATION | 3 | 3 |
| N_MAINTAIN_DELTA | 14 | 14 |
| N_MAINTAIN_SYNCED | 2 | 2 |
| N_NEVER_COMPLETE | 16 | 16 |
| N_NO_CURSOR | 257 | 250 |
| N_NO_HORIZON | 14 | 14 |
| N_NO_PRODUCTION_WRITER | 51 | 51 |
| N_PATCH_CLEARS | 2 | 2 |
| N_PROBE_ONLY_READ | 2 | 2 |
| N_QUERY_FILTERED | 0 | 14 |
| N_REFERENCE_UNCHECKED | 8 | 7 |
| N_REQUIRE_REFUSED | 0 | 1 |
| N_SPARSE_FILTER | 31 | 31 |
| N_SYNC_ORDER | 7 | 7 |
| N_UNREADABLE_PROBE | 16 | 16 |

Every changed finding follows; the JSON retains exact before/after messages, rewrites, and details.

- `003-tile-dye-lot-holds` schema.q:89 `N_REFERENCE_UNCHECKED` (removed): Mandatory same-argument lookup later in the same atomic path discharges the finding; remaining wording states lookup must be mandatory.
- `011-school-vision-screens` schema.q:106 `N_UNREADABLE_PROBE` (wording): Name the physical backing unique index without granting visibility.
- `012-day2-pet-addendum-approvals` schema.q:148 `N_UNREADABLE_PROBE` (wording): Name the physical backing unique index without granting visibility.
- `012-day2-pet-addendum-approvals` schema.q:150 `N_UNREADABLE_PROBE` (wording): Name the physical backing unique index without granting visibility.
- `012-day2-pet-addendum-approvals` schema.q:194 `N_UNREADABLE_PROBE` (wording): Name the physical backing unique index without granting visibility.
- `012-day2-pet-addendum-approvals` schema.q:196 `N_UNREADABLE_PROBE` (wording): Name the physical backing unique index without granting visibility.
- `013-stroke-rehab-contracts` schema.q:138 `N_UNREADABLE_PROBE` (wording): Name the physical backing unique index without granting visibility.
- `017-peer-grading-calibration` schema.q:134 `N_QUERY_FILTERED` (added): Explicit caller branch/filter does not prove the returned table read rule; advisory about possible filtering, never disjoint roles.
- `017-peer-grading-calibration` schema.q:139 `N_QUERY_FILTERED` (added): Explicit caller branch/filter does not prove the returned table read rule; advisory about possible filtering, never disjoint roles.
- `020-day2-four-h-project-records` schema.q:158 `N_REFERENCE_UNCHECKED` (wording): Mandatory same-argument lookup later in the same atomic path discharges the finding; remaining wording states lookup must be mandatory.
- `020-day2-four-h-project-records` schema.q:162 `N_REFERENCE_UNCHECKED` (wording): Mandatory same-argument lookup later in the same atomic path discharges the finding; remaining wording states lookup must be mandatory.
- `021-block-party-closures` schema.q:85 `N_QUERY_FILTERED` (added): Explicit caller branch/filter does not prove the returned table read rule; advisory about possible filtering, never disjoint roles.
- `023-hydrant-adoption` schema.q:118 `N_UNREADABLE_PROBE` (wording): Name the physical backing unique index without granting visibility.
- `027-agility-trial-run-order` schema.q:109 `N_QUERY_FILTERED` (added): Explicit caller branch/filter does not prove the returned table read rule; advisory about possible filtering, never disjoint roles.
- `030-day2-color-formula-cards` schema.q:160 `N_REFERENCE_UNCHECKED` (wording): Mandatory same-argument lookup later in the same atomic path discharges the finding; remaining wording states lookup must be mandatory.
- `034-day2-cla-signature-ledger` schema.q:107 `N_UNREADABLE_PROBE` (wording): Name the physical backing unique index without granting visibility.
- `039-photo-booth-galleries` schema.q:112 `N_QUERY_FILTERED` (added): Explicit caller branch/filter does not prove the returned table read rule; advisory about possible filtering, never disjoint roles.
- `039-photo-booth-galleries` schema.q:122 `N_QUERY_FILTERED` (added): Explicit caller branch/filter does not prove the returned table read rule; advisory about possible filtering, never disjoint roles.
- `045-memory-care-playlists` schema.q:98 `N_IMMUTABLE_PATCH` (removed): Computed local equals the pinned immutable unique key.
- `051-wildlife-crossing-reports` schema.q:52 `N_QUERY_FILTERED` (added): Explicit caller branch/filter does not prove the returned table read rule; advisory about possible filtering, never disjoint roles.
- `052-day2-furniture-bank-pickups` schema.q:195 `N_UNREADABLE_PROBE` (wording): Name the physical backing unique index without granting visibility.
- `053-effort-certification` schema.q:113 `N_QUERY_FILTERED` (added): Explicit caller branch/filter does not prove the returned table read rule; advisory about possible filtering, never disjoint roles.
- `053-effort-certification` schema.q:147 `N_UNREADABLE_PROBE` (wording): Name the physical backing unique index without granting visibility.
- `053-effort-certification` schema.q:154 `N_UNREADABLE_PROBE` (wording): Name the physical backing unique index without granting visibility.
- `054-day2-ballot-drop-box-sweeps` schema.q:82 `N_SYNC_ORDER` (wording): State online-only ordinary offline read and incomplete held-local behavior.
- `054-day2-ballot-drop-box-sweeps` schema.q:85 `N_SYNC_ORDER` (wording): State online-only ordinary offline read and incomplete held-local behavior.
- `054-day2-ballot-drop-box-sweeps` schema.q:109 `N_UNREADABLE_PROBE` (wording): Name the physical backing unique index without granting visibility.
- `055-tryout-blind-scoring` schema.q:115 `N_QUERY_FILTERED` (added): Explicit caller branch/filter does not prove the returned table read rule; advisory about possible filtering, never disjoint roles.
- `061-sled-dog-checkpoints` schema.q:95 `N_SYNC_ORDER` (wording): State online-only ordinary offline read and incomplete held-local behavior.
- `061-sled-dog-checkpoints` schema.q:98 `N_SYNC_ORDER` (wording): State online-only ordinary offline read and incomplete held-local behavior.
- `061-sled-dog-checkpoints` schema.q:101 `N_SYNC_ORDER` (wording): State online-only ordinary offline read and incomplete held-local behavior.
- `061-sled-dog-checkpoints` schema.q:108 `N_SYNC_ORDER` (wording): State online-only ordinary offline read and incomplete held-local behavior.
- `065-medicine-cabinet-expiry` schema.q:70 `N_NO_CURSOR` (removed): Declared cursor preserved through planner authority fallback; continuations execute.
- `065-medicine-cabinet-expiry` schema.q:76 `N_NO_CURSOR` (removed): Declared cursor preserved through planner authority fallback; continuations execute.
- `065-medicine-cabinet-expiry` schema.q:79 `N_NO_CURSOR` (removed): Declared cursor preserved through planner authority fallback; continuations execute.
- `067-curfew-extension-requests` schema.q:96 `N_UNREADABLE_PROBE` (wording): Name the physical backing unique index without granting visibility.
- `067-curfew-extension-requests` schema.q:107 `N_UNREADABLE_PROBE` (wording): Name the physical backing unique index without granting visibility.
- `071-instrument-lockout-leases` schema.q:90 `N_REFERENCE_UNCHECKED` (wording): Mandatory same-argument lookup later in the same atomic path discharges the finding; remaining wording states lookup must be mandatory.
- `077-rfp-response-desk` schema.q:105 `N_QUERY_FILTERED` (added): Explicit caller branch/filter does not prove the returned table read rule; advisory about possible filtering, never disjoint roles.
- `078-day2-practicum-placements` schema.q:147 `N_REFERENCE_UNCHECKED` (wording): Mandatory same-argument lookup later in the same atomic path discharges the finding; remaining wording states lookup must be mandatory.
- `080-day2-stop-headcount-tally` schema.q:149 `N_NO_CURSOR` (removed): Declared cursor preserved through planner authority fallback; continuations execute.
- `080-day2-stop-headcount-tally` schema.q:152 `N_NO_CURSOR` (removed): Declared cursor preserved through planner authority fallback; continuations execute.
- `080-day2-stop-headcount-tally` schema.q:155 `N_NO_CURSOR` (removed): Declared cursor preserved through planner authority fallback; continuations execute.
- `080-day2-stop-headcount-tally` schema.q:159 `N_NO_CURSOR` (removed): Declared cursor preserved through planner authority fallback; continuations execute.
- `080-day2-stop-headcount-tally` schema.q:249 `N_REFERENCE_UNCHECKED` (wording): Mandatory same-argument lookup later in the same atomic path discharges the finding; remaining wording states lookup must be mandatory.
- `080-day2-stop-headcount-tally` schema.q:228 `N_REQUIRE_REFUSED` (added): Service OR branch does not discharge the human branch; table authority remains enforced.
- `080-day2-stop-headcount-tally` schema.q:227 `N_UNREADABLE_PROBE` (wording): Name the physical backing unique index without granting visibility.
- `092-day2-summit-register-book` schema.q:138 `N_QUERY_FILTERED` (added): Explicit caller branch/filter does not prove the returned table read rule; advisory about possible filtering, never disjoint roles.
- `092-day2-summit-register-book` schema.q:85 `N_SYNC_ORDER` (wording): State online-only ordinary offline read and incomplete held-local behavior.
- `096-day2-litter-pick-order` schema.q:131 `N_QUERY_FILTERED` (added): Explicit caller branch/filter does not prove the returned table read rule; advisory about possible filtering, never disjoint roles.
- `097-friendly-call-circle` schema.q:88 `N_QUERY_FILTERED` (added): Explicit caller branch/filter does not prove the returned table read rule; advisory about possible filtering, never disjoint roles.
- `097-friendly-call-circle` schema.q:93 `N_QUERY_FILTERED` (added): Explicit caller branch/filter does not prove the returned table read rule; advisory about possible filtering, never disjoint roles.

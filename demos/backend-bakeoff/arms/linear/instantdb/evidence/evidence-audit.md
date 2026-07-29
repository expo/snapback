# Linear / InstantDB evidence audit

Frozen protocol: `llp-0102-backend-bakeoff-v1`

Freeze: `ab95cd3099b7dde29810046ba495884e3bc641a3bdfb811ab828db10c6b7f72a`

Snapback comparison commit: `5f31cb6174daaefa04a1e05242acbbc22c725040`

| Scenario | Result | Direct evidence |
| --- | --- | --- |
| LINEAR-01-SEED | PASS | evidence/acceptance-results.json<br>receipts/seed-receipt.json |
| LINEAR-02-AUTHORITY | PASS | evidence/acceptance-results.json |
| LINEAR-03-FILTERS | PASS | evidence/acceptance-results.json |
| LINEAR-04-PAGINATION | PASS | evidence/acceptance-results.json |
| LINEAR-05-DETAIL | PASS | evidence/acceptance-results.json |
| LINEAR-06-OPTIMISTIC | PASS | evidence/acceptance-results.json |
| LINEAR-07-CONFLICT | PASS | evidence/acceptance-results.json |
| LINEAR-08-LIVE | PASS | evidence/acceptance-results.json |
| LINEAR-09-SEARCH | GAP | evidence/acceptance-results.json |
| LINEAR-10-OFFLINE | PASS | evidence/acceptance-results.json<br>evidence/offline-smoke.json |
| LINEAR-11-MIGRATION | PASS | evidence/acceptance-results.json<br>receipts/migration.json |
| LINEAR-12-DEPLOY | GAP | evidence/acceptance-results.json<br>receipts/operations.json |
| LINEAR-13-PERFORMANCE | PASS | evidence/acceptance-results.json<br>evidence/performance.json<br>evidence/performance-build.json |
| LINEAR-14-CLEANUP | PASS | evidence/acceptance-results.json<br>receipts/cleanup-plan.json<br>receipts/cleanup-final.json |

## Audit findings

- 14/14 scenarios are classified: 12 PASS, 2 explicit GAP, 0 unclassified, 0 Stop defects.
- Search is GAP because indexed pattern matching is not relabeled as full-text search.
- Deploy is GAP because the temporary app token exposes target identity/config/export posture but not logs or rollback.
- Every target-bearing receipt uses the same SHA-256 target identity; raw app ID, admin token, and actor tokens are absent.
- Cleanup was exact-target only. Product data and users are zero; schema/permissions remain only until the provider's documented temporary-app expiry.
- All runtime and build paths retain two warmups and seven raw samples.

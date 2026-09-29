# Round-3 review disposition

Both complete reviews are saved alongside this file; original byte hashes are
in review-inputs.json. Both were present and read at the start and are checked
again before commit; their hashes are unchanged. Both verdicts were NOT READY for round 3; no independent
READY verdict is claimed for round 4.

| Finding | Repair and detecting evidence |
| --- | --- |
| Grok/Astra: busy COMMIT rolls back a completed provider action | Retain transaction and retry only COMMIT. Two actual processes plus a held reader reproduce two calls before repair; repaired ordinary/cancelled cases each call once and replay after exit. `commit-before-final.log.gz`, `commit-fixed.log.gz`. |
| Grok: serve omits schema-local packages | Private scope links the nearest ancestor containing snapback/node_modules before root packages. Both schema-only and shadowed serve tests fail before and pass after. |
| Grok: ledger initialization leaves doctor saying running | Supervised runWorker stops the process even with an unrelated timer, status 78 becomes ledger-unavailable, polling never starts. Dev and serve detecting tests. Standalone done resolves. |
| Grok: NODE_OPTIONS reaches credentialed worker | Explicit environment removes it. Dev/serve tests supply a harmless preload marker and require it to remain absent, and check the entire key set. |
| Grok: serve failed rotation has no revision fence | Failed retirement CAS advances the child's original revision once. Real production-mode named/conventional rotation holds SQLite deletion while stored expiry stands; query/mutation/refresh refuse immediately, manual seat stays live, new credential works after unlock. Removing CAS fails the test. Peers also renew after a held deletion. |
| Grok: deleting synchronous=FULL survives | Test starts the actual connection at OFF before setup, then reads settings at both commits. Removing the FULL pragma now fails; no reliance on Node's default. |
| Grok/Astra: deleting run-path throwIfAborted survives | Hold BEGIN IMMEDIATE, observe actual SQLITE_BUSY, abort waiter, then release; handler and receipt must remain absent. Removing only that abort check fails. |

The old intermittent-duplicate ticket is a resolved record in issues/closed.
Its original silent run cannot be attributed conclusively; the same symptom
now has a deterministic mechanism and detecting repair. The earlier Low
watchdog fallback group-ID concern remains in its existing open ticket; neither
review claims it was repaired. Historical doctor records remain last reports,
not live OS process probes. This round corrects the live ledger-failure state.

The required full run also exposed inherited automatic-snapshot import and
fixture-path regressions. These were repaired and qualified separately; the
red full snapshot and all 19 individual failures remain in FAILURES.md.

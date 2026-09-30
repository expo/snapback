# Copied publication failures

The four raw logs and their `.summary.json` extracts preserve every available
failure block, including cancelled children. They are snapshots copied for
diagnosis; the fourth stops before client output and has no final summary.

| Attempt | Failure | Cause/disposition on this branch |
|---|---|---|
| 1 | `per-row-liveness`, `per-row-retry` file processes hung for about an hour | Already fixed by `a5e690077a`: mocked timers also held macOS undici zero-delay work. The fixtures now pump only zero-delay timers while awaiting I/O. |
| 1 | `dev` and `serve` named-worker ledger path assertion | Already fixed by `a5e690077a`: compare the canonical path on macOS, where `/var` aliases `/private/var`. |
| 1 | automatic snapshot `entry-copy` and `linked-helper` | Already fixed by `a5e690077a`: canonicalize the checked import's parent, still refuse a symlink at the final component. This was a product path-resolution defect, not a timeout to relax. |
| 2 | Clique celebrity write ratio 23.1158 > 3 | Batched wall-time samples charge host scheduling to different populations. Lane SL also reproduced the corresponding reader ratio in the idle Linux suite. |
| 2 | typing expiry, row aged 3000 ms, 30-second test timeout | The expiry diagnostic was emitted successfully before the 30-second timeout: this record also implicates cleanup, and does not establish a failed expiry deadline. The controlled-clock fixture retains pre-expiry visibility and deadline assertions; the historical real-clock cleanup stall remains [open](../../../issues/20260929-snapback4-browser-close-stalls-under-publication-load.md). |
| 2 | web admission review, session authority and startup parents; their subsequent child failures | Parent deadlines close the page during admission/cleanup; later children fail against that closed page. The reported evaluation sites include `app.close()` and cleanup after a held session turn. These records alone do **not** establish that a larger parent budget fixes the close. The [cleanup investigation ticket](../../../issues/20260929-snapback4-browser-close-stalls-under-publication-load.md) preserves these traces; the cascade does not establish independent product defects. |
| 2, 3 | local session model, 5000 histories, 240-second timeout | A fixed throughput allowance for a deterministic full-count model; fair-recovery and coverage assertions are independent of host speed. |
| 3 | mixed-evidence process oracle, 300 histories, 240-second timeout | Already fixed by `77bbb5c4ff`: two seconds per history, keeping all histories. |
| 3 | published 0.2.33 capability-free byte comparison | Already fixed by `77bbb5c4ff`: serving store identity is random and was incorrectly part of the canonical byte pin; identity remains required and behavioral compatibility checks remain. This conditional publication case is not silently counted as run on Linux. |
| 3 | `R5 history wasm: retained history and independent held coverage` transient empty delivery | Existing product issue [retained-history transient empty](../../../issues/20260929-snapback4-retained-history-transient-empty.md). No assertion or timeout adjustment can repair this user-visible interleaving. |
| 4 | `release_token_owns_the_resolved_database_before_sqlite_open`, `E_STORE: database is locked` | Fixture retains SQLite's writer lock while four competitors start; that can exceed the owner's five-second SQLite busy budget. Hold the owner at its output boundary instead, after observing ownership with SQLite still blocked. |
| 4 | `production_accept_loop_waits_for_complete_worker_readiness` | Ten-second setup guard expired before the Node worker opened its token file. Startup is distinct from the later two-second response assertions. |
| 4 | 19 macOS `driver::*` witness failures | Fake Python `xcrun` did not start within the fixture's five-second per-step budget; tests failed at simulator preparation before reaching their intended positive or negative premise. Use the published per-step guard and keep both preparation-timeout and receipt-timeout assertions. |

Attempt 1 exact footer: `== 1 failure(s) in 5759 s`.
Attempt 2: `== 3 failure(s) in 11298 s`.
Attempt 3: `== 2 failure(s) in 3014 s`.
Attempt 4: no completion footer in the copied record; three failing Rust targets.

All are inherited observations, not changes introduced by Lane SL. Local
reproductions and unsuccessful correction candidates are accounted separately.

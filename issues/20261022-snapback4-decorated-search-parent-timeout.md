# Snapback 4: decorated search parent timed out in a full client pool

Status: Open
Date: 2026-10-22
Scope: `packages/snapback4/test/decorated-search.test.mjs`

Integration23 diagnostic full pool R2, with 24 file workers, timed out the
270-second process parent while seed2 was pending. Later subtests were cancelled
by the parent; they are not independent failed oracle comparisons. The same
source and seed configuration passed the complete file alone (57 tests,
71.50 seconds), without changing an assertion, deadline or seed count. The first
full diagnostic pool had also passed this file. Cause is not established.
Native builds and other shared-host workloads overlapped the failing pool.

Final qualification repeats all 430 files with eight file workers and an
immutable merged binary beside a physical copy of the matching client helpers.
Record the final full-pool result in the integration report; a passing isolated
run alone does not qualify the pool. Logs: `client-pool-repeat.log`,
`decorated-search-alone.log`, and `client-pool-r3.log` in Integration23 evidence.

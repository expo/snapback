# snapback2: derived rule checks fail falsely above 500 visible rows

**Status:** Open
**Systems:** snapback2, test runner, authorization
**Severity:** P2
**Author:** GPT-5.6 Sol (ultra), directed by Charlie Cheever
**Date:** 2026-09-01

snapback2/crates/snapback2/src/test_policy.rs:40-110

Failure scenario: seed 501 rows in a rule-restricted table and make all visible to Alice. /control/data is called once with limit 500, while /control/verdicts returns all 501; set equality fails and snapback2 test reports a policy defect although runtime admission is correct.

Why it happens: the actual side hardcodes a single 500-row bounded scan with no pagination, while the expected engine primitive at snapback2/crates/snapback2-core/src/registry.rs:676-702 intentionally evaluates every stored row. The 501st admitted row can never appear in actual.

Suggested fix: paginate the actual wire read to exhaustion without changing its admission semantics, or expose an exact in-process proof primitive for the comparison. Add 500- and 501-visible-row cases.

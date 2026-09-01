# snapback2: client range coverage ignores scan identity across successors

**Status:** Closed
**Resolution:** Bound receipt ranges to full evaluated scan and read-rule identity in both client twins; added scenario-range-scan-identity corpus coverage.
**Systems:** snapback2, client prediction, successors
**Severity:** P1
**Author:** GPT-5.6 Sol (ultra), directed by Charlie Cheever
**Date:** 2026-09-01

snapback2/packages/evaluator/src/evaluator.ts:179-190

Failure scenario: hydrate the named-thread receipt, then install a valid additive successor whose program keeps site programs.thread.0 and prefix c1 but changes the scan from messages.byConvTime to users.byId. Reexecution returns an empty result marked fresh by reusing the predecessor range proof, although that proof says nothing about the successor scan.

Why it happens: the TypeScript trace records only site, prefix, and stop, and freshness matches only site plus prefix. The Rust twin repeats the same match at snapback2/crates/snapback2-core/src/client.rs:81-91. Neither binds retained coverage to generation/certificate identity or to table, index, order, bounds, cursor, and take.

Suggested fix: persist and compare the complete scan identity plus plan/schema generation for every coverage proof, invalidating or revalidating predecessor receipts on successor installation. Add a same-site/same-prefix changed-index corpus case for both twins.

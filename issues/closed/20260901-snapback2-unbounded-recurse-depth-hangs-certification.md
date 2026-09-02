# snapback2: unbounded Recurse depth hangs certification before budget checks

**Status:** Closed
**Resolution:** Bounded recurse depth and replaced iterative estimators with saturating closed-form arithmetic, with a deadline regression test.
**Systems:** snapback2, core engine, certification, performance
**Severity:** P2
**Author:** GPT-5.6 Sol (ultra), directed by Charlie Cheever
**Date:** 2026-09-01

snapback2/crates/snapback2-core/src/certificate.rs:839-846

Failure scenario: submit raw ProjectJson with a valid Recurse, fanout 1, and depth 4294967295 through check --ir. Generation::certify performs billions of loop iterations and does not reach the later ceiling refusal in practical time.

Why it happens: output analysis here, call analysis at lines 1039-1045, and retention analysis at snapback2/crates/snapback2-core/src/retention.rs:477-483 all iterate once per declared depth. No structural bound is checked first, even though depth is project input.

Suggested fix: reject an unreasonable depth before all analysis and replace iterative geometric-size calculations with checked/saturating closed-form arithmetic. Add a huge-depth check with a short process deadline.

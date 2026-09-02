# snapback2: certification undercounts maintained writes for updates

**Status:** Closed
**Resolution:** Added per-target two-delta update maintenance bounds in certificate.rs and runner_ops.rs, with exact-ceiling runtime regression coverage.
**Systems:** snapback2, core engine, certification, budgets
**Severity:** P2
**Author:** GPT-5.6 Sol (ultra), directed by Charlie Cheever
**Date:** 2026-09-01

snapback2/crates/snapback2-core/src/certificate.rs:212-225

Failure scenario: a mutation loops over 1024 inputs and updates one source row per item under one maintain. Certification counts 1024 source plus 1024 maintained writes and admits the 2048 ceiling. Runtime applies old -1 and new +1 for every update, performing 3072 writes, and commits.

Why it happens: maintained_amplification charges one target write per source write without distinguishing update/replace from insert/delete. Runtime assert_bounds at snapback2/crates/snapback2-core/src/engine/runner_ops.rs:784-805 then exempts any maintained target table from an overrun, so the undercount is suppressed.

Suggested fix: charge two maintained deltas for update/replace/upsert-existing in the worst case, emit per-target bounds, and remove the blanket maintained-target assertion exemption. Add an exact-ceiling update loop.

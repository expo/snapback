# 0081: durable executor, admission fence, lifecycle (local SQLite profile)

**Status:** Deferred (phase B)
**Severity:** P2
**Systems:** Migrations, Storage
**Author:** Claude (Fable 5), directed by Charlie Cheever
**Date:** 2026-07-24
**Related:** Accepted LLP 0081 §§1, 4
**Marker:** step5-impl

The exclusive-single-writer executor as a durable state machine: closed
schema-enumerated state set + transition relation (published-held,
cleanup-pending tail, cancellation states), fencing-token validation, the
capability-derived all-lane admission fence surviving crash between reopen
and resume, batch atomicity (shadow writes + cursor + digest accumulator +
journal in one transaction), pre-publication-only cancellation, the enforced
downtime ceiling with safe abort, and the published-held release/rollback
exits. Local SQLite is the Step 5 admission profile; hosted DO executor is a
separate deferred ticket. L-sized.

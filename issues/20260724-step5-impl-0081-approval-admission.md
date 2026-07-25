# 0081: approval/admission records + migrate CLI surface

**Status:** Deferred (phase B)
**Severity:** P2
**Systems:** Migrations, CLI, Authorization
**Author:** Claude (Fable 5), directed by Charlie Cheever
**Date:** 2026-07-24
**Related:** Accepted LLP 0081 §2, LLP 0072 (identities)
**Marker:** step5-impl

Typed authenticated MigrationApprovalV1 (plan/observation/policy digests,
complete 0072 target audience incl. releaseId, approver, issue/expiry, fresh
operationId) and barrier-time MigrationAdmissionV1; operationId+audience
keying for admission, journal lookup, replay, cancellation, and receipts;
local authenticated operator record vs hosted control-plane operation;
`snapback migrate preview|approve|apply|cancel|verify|rollback` with the
shared result envelope and machine-readable dry run; stale/mismatch/expiry
refusals. M/L-sized.

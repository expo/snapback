# 125 diagnostics await HTTP-family review (recorded at fail-safe 500)

**Date:** 2026-08-04
**Status:** Resolved
**Area:** `src/server.rs` reviewed HTTP diagnostic table

## Problem

The s5_d10 drift oracle was red on main: recent landings registered 137
production diagnostics without HTTP-family review. Reconciled
2026-08-04: the 12 `SNAPBACK_RESULT_TRANSFORM_*` codes were classified
properly (400, authoring refusals, dormant feature — LLP 0166 §D7);
the remaining **125** are recorded in
`FAIL_SAFE_PENDING_FAMILY_REVIEW_DIAGNOSTICS` at their actual fail-safe
500. That list is an honest record of "defaulted, not reviewed" — it is
NOT a judgment that 500 fits each code.

## Owed, by owning lane

- `SNAPBACK_BRANCH_*`, `SNAPBACK_CHECKPOINT_*`, `SNAPBACK_FORK_*`,
  `SNAPBACK_HISTORY_*` — the instance-forking track (LLP 0158 family):
  many are plainly not server faults (`*_NOT_FOUND` → 404,
  `*_AUTHORITY_DENIED`/`*_AUTHORIZATION_DENIED` → 403, `*_INVALID`
  request shapes → 400, `*_BASE_NOT_CURRENT`/`*_HEAD_CHANGED` → 409).
- `SNAPBACK_OPERATION_*`, `SNAPBACK_PROMOTION_*`, `SNAPBACK_PROOF_*`,
  `SNAPBACK_HOST_INCARNATION_*`, `SNAPBACK_HOST_OPERATION_*` — the
  write-lane/settlement landings.

Each owning lane should move its codes from the fail-safe list into the
proper family (mapper arm + reviewed list together), with tests. Do not
add new codes to the fail-safe list — classify at landing.

## Resolution

All 125 diagnostics now have an explicit HTTP-family judgment in both the
mapper and its cross-checked reviewed family. The pending-review list and debt
comment are deleted. These surfaces are experimental/support-false, so the
status changes are admissible before publication; this resolution does not
claim that the underlying capabilities are supported.

| HTTP status | Count |
| --- | ---: |
| 400 Bad Request | 21 |
| 403 Forbidden | 9 |
| 404 Not Found | 4 |
| 409 Conflict | 31 |
| 410 Gone | 6 |
| 413 Payload Too Large | 5 |
| 429 Too Many Requests | 5 |
| 500 Internal Server Error | 38 |
| 503 Service Unavailable | 3 |
| 504 Gateway Timeout | 3 |
| **Total** | **125** |

## Full classification

| Diagnostic code | Status | Rationale | Owning document |
| --- | ---: | --- | --- |
| `SNAPBACK_BRANCH_ARTIFACT_INVALID` | 500 | The server could not encode or decode its own durable branch artifact. | LLP 0164 §Owned artifacts |
| `SNAPBACK_BRANCH_AUTHORITY_DENIED` | 403 | The live branch-scoped grant does not authorize the operation or lane. | LLP 0164 §Contract summary — Identity/authority |
| `SNAPBACK_BRANCH_BASE_NOT_CURRENT` | 409 | Branch creation lost its current-head optimistic-concurrency precondition. | LLP 0164 §Contract summary — Promotion |
| `SNAPBACK_BRANCH_BYTE_LIMIT_EXCEEDED` | 413 | Retained operation bytes exceed the branch's declared payload bound. | LLP 0164 §Contract summary — Resources |
| `SNAPBACK_BRANCH_CAPTURE_ONLY_MISSING` | 400 | The request selected the unimplemented `CaptureOnly` policy instead of the admitted `DenyAll` profile. | LLP 0164 §Contract summary — Egress |
| `SNAPBACK_BRANCH_DIFF_DUPLICATE_ROW` | 500 | The trusted snapshot scanner emitted a duplicate row identity. | LLP 0164 §Contract summary — Diff |
| `SNAPBACK_BRANCH_DIFF_LIMIT_EXCEEDED` | 413 | The exact diff exceeds its declared row-sized response bound. | LLP 0164 §Contract summary — Resources |
| `SNAPBACK_BRANCH_EGRESS_DENIED` | 403 | `DenyAll` deliberately forbids host egress from the branch. | LLP 0164 §Contract summary — Egress |
| `SNAPBACK_BRANCH_EXPIRED` | 410 | The finite-TTL branch no longer admits operations. | LLP 0164 §Contract summary — Resources |
| `SNAPBACK_BRANCH_GRANT_STALE` | 410 | The branch grant was already expired when used. | LLP 0164 §Contract summary — Identity/authority |
| `SNAPBACK_BRANCH_LIMIT_INVALID` | 400 | The caller supplied non-positive or overflowing branch bounds. | LLP 0164 §Contract summary — Resources |
| `SNAPBACK_BRANCH_LIVE_LIMIT_EXCEEDED` | 429 | The principal or app has exhausted its live-branch capacity. | LLP 0164 §Contract summary — Resources |
| `SNAPBACK_BRANCH_NOT_ACTIVE` | 409 | Work conflicts with a branch already tearing down. | LLP 0164 §Contract summary — Resources |
| `SNAPBACK_BRANCH_NOT_FOUND` | 404 | No registered branch exists for the requested id. | LLP 0164 §Owned artifacts |
| `SNAPBACK_BRANCH_NOT_PROMOTABLE` | 409 | Current branch state or effect history forecloses promotion. | LLP 0164 §Contract summary — Egress/Promotion |
| `SNAPBACK_BRANCH_NO_COMMON_BASE` | 409 | The sibling comparison conflicts because the branches do not share a stream-qualified base. | LLP 0164 §Contract summary — Diff |
| `SNAPBACK_BRANCH_OPERATION_INVALID` | 400 | The submitted operation identity or schema version is malformed. | LLP 0164 §Owned artifacts |
| `SNAPBACK_BRANCH_OPERATION_LIMIT_EXCEEDED` | 429 | The branch exhausted its finite retained-operation capacity. | LLP 0164 §Contract summary — Resources |
| `SNAPBACK_BRANCH_PROFILE_MISSING` | 500 | A registered branch lost its server-owned durable profile row. | LLP 0164 §Owned artifacts |
| `SNAPBACK_BRANCH_SCHEMA_VERSION_UNSUPPORTED` | 400 | The request uses an unsupported branch artifact version. | LLP 0164 §Owned artifacts |
| `SNAPBACK_BRANCH_STREAM_MISMATCH` | 400 | The supplied operation identity names the wrong child stream. | LLP 0164 §Contract summary — Identity/authority |
| `SNAPBACK_BRANCH_STREAM_MISSING` | 500 | A registered branch's server-owned child stream disappeared. | LLP 0164 §Owned artifacts |
| `SNAPBACK_CHECKPOINT_COPY_BUDGET_EXCEEDED` | 413 | The source database is larger than the declared copy-byte budget. | LLP 0165 §Checkpoints |
| `SNAPBACK_CHECKPOINT_COPY_FAILED` | 500 | The server's SQLite backup operation returned an impossible disposition. | LLP 0165 §Checkpoints |
| `SNAPBACK_CHECKPOINT_COPY_FIDELITY_FAILED` | 500 | The copied database failed the server's independent source/copy equality proof. | LLP 0165 §Proof discipline/Checkpoints |
| `SNAPBACK_CHECKPOINT_DESTINATION_EXISTS` | 409 | Publication conflicts with an already-existing destination. | LLP 0165 §Publication and erasure |
| `SNAPBACK_CHECKPOINT_DESTINATION_INVALID` | 400 | The requested substrate/destination combination or path shape is invalid. | LLP 0165 §Checkpoints |
| `SNAPBACK_CHECKPOINT_DIGEST_BUDGET_EXCEEDED` | 413 | Receipt-only digest work exceeds the declared byte budget. | LLP 0165 §Checkpoints |
| `SNAPBACK_CHECKPOINT_EVIDENCE_MISMATCH` | 500 | Durable recovery evidence diverges from the server-owned creation intent. | LLP 0165 §Publication and erasure |
| `SNAPBACK_CHECKPOINT_INCOMPLETE` | 500 | A materialized checkpoint is missing required publication evidence. | LLP 0165 §Publication and erasure |
| `SNAPBACK_CHECKPOINT_INVALID` | 410 | Registry authority says the checkpoint is expired, erased, or otherwise no longer valid. | LLP 0165 §Publication and erasure |
| `SNAPBACK_CHECKPOINT_IO_FAILED` | 500 | Filesystem I/O prevented checkpoint publication or recovery. | LLP 0165 §Publication and erasure |
| `SNAPBACK_CHECKPOINT_NOT_FOUND` | 404 | No checkpoint registry record exists for the id. | LLP 0165 §Named-checkpoint substrate |
| `SNAPBACK_CHECKPOINT_RECEIPT_INVALID` | 500 | The server could not encode or decode its own checkpoint receipt. | LLP 0165 §Owned artifacts |
| `SNAPBACK_CHECKPOINT_REGISTRY_CORRUPT` | 500 | The durable checkpoint registry is malformed or internally inconsistent. | LLP 0165 §Publication and erasure |
| `SNAPBACK_CHECKPOINT_REQUEST_INVALID` | 400 | The request omits identity or exceeds a fixed v1 admission bound. | LLP 0165 §Checkpoints |
| `SNAPBACK_CHECKPOINT_SCAN_CORRUPT` | 500 | A trusted managed-row scan found corrupt server state. | LLP 0165 §Proof discipline |
| `SNAPBACK_CHECKPOINT_SCHEMA_IDENTITY_MISSING` | 500 | The server cannot form a proof because its loaded schema lacks required identity. | LLP 0165 §Promotion digest domain/Checkpoints |
| `SNAPBACK_CHECKPOINT_SOURCE_ADVANCED` | 409 | The source changed before the requested stream-qualified snapshot was pinned. | LLP 0165 §Checkpoints |
| `SNAPBACK_CHECKPOINT_SOURCE_INVALID` | 500 | The server-owned source database path cannot be represented safely. | LLP 0165 §Checkpoints |
| `SNAPBACK_CHECKPOINT_SOURCE_UNSUPPORTED` | 503 | Named checkpoints are unavailable on the configured in-memory storage profile. | LLP 0165 §Checkpoints |
| `SNAPBACK_CHECKPOINT_STREAM_MISSING` | 500 | The checkpoint source lacks the server-owned initialized data stream required for proof. | LLP 0165 §Checkpoints |
| `SNAPBACK_CHECKPOINT_TEST_CRASH_CUT` | 500 | A test-only injected crash follows the established test-crash internal-error convention. | LLP 0165 §Publication and erasure |
| `SNAPBACK_CHECKPOINT_WAL_BUDGET_EXCEEDED` | 429 | Concurrent retained-WAL pressure exhausted the operation's finite capacity budget. | LLP 0165 §Checkpoints |
| `SNAPBACK_FORK_APP_ID_REQUIRED` | 400 | The selected source is not a usable Snapback app database with stored schema identity. | LLP 0158 §F0b — the local fork verb |
| `SNAPBACK_FORK_APP_ROOT_INVALID` | 400 | The supplied app-root path cannot be resolved. | LLP 0158 §F0b — the local fork verb |
| `SNAPBACK_FORK_BOOT_FAILED` | 500 | The managed fork server failed to spawn or exited during boot. | LLP 0158 §F0b — the local fork verb |
| `SNAPBACK_FORK_BOOT_TIMEOUT` | 504 | The fork orchestrator timed out waiting for the managed child server. | LLP 0158 §F0b — the local fork verb |
| `SNAPBACK_FORK_DIFF_INVALID` | 500 | The copied server-owned change journal contains malformed post-images. | LLP 0158 §The diff surface |
| `SNAPBACK_FORK_DIFF_RETENTION_GAP` | 410 | Journal retention permanently passed the fork point needed for an exact diff. | LLP 0158 §The diff surface |
| `SNAPBACK_FORK_ID_INVALID` | 400 | The supplied fork id is not a UUID. | LLP 0158 §F0b — the local fork verb |
| `SNAPBACK_FORK_LOAD_FAILED` | 500 | Managed fork setup failed while loading its schema/functions into the child server. | LLP 0158 §F0b — the local fork verb |
| `SNAPBACK_FORK_NOT_FOUND` | 404 | The requested fork is absent from the lifecycle registry. | LLP 0158 §Lifecycle and GC |
| `SNAPBACK_FORK_READY_INVALID` | 500 | The managed child readiness evidence fails its server-owned path or identity checks. | LLP 0158 §F0b — the local fork verb |
| `SNAPBACK_FORK_REAP_CLOCK_INVALID` | 400 | The injected reap clock is outside the portable timestamp range. | LLP 0158 §Lifecycle and GC |
| `SNAPBACK_FORK_REGISTRY_INVALID` | 500 | The durable fork registry or its filesystem binding is malformed or unsafe. | LLP 0158 §Lifecycle and GC |
| `SNAPBACK_FORK_SOURCE_INVALID` | 400 | The selected fork source is in-memory, missing, or not a file. | LLP 0158 §The copy, per target |
| `SNAPBACK_FORK_STOP_FAILED` | 500 | The managed child process did not accept the server's stop signal. | LLP 0158 §Lifecycle and GC |
| `SNAPBACK_FORK_STOP_TIMEOUT` | 504 | The orchestrator timed out waiting for the managed child to exit. | LLP 0158 §Lifecycle and GC |
| `SNAPBACK_FORK_STOP_UNVERIFIED` | 500 | The server cannot safely prove the possibly-live child is gone before deletion. | LLP 0158 §Lifecycle and GC |
| `SNAPBACK_FORK_TTL_INVALID` | 400 | The requested fork expiry is non-finite, non-positive, or outside the portable clock. | LLP 0158 §Lifecycle and GC |
| `SNAPBACK_HISTORY_AUTHORIZATION_DENIED` | 403 | Current-record authorization denies access to all retained history. | LLP 0165 §Named-checkpoint and history substrate |
| `SNAPBACK_HISTORY_CORRUPT` | 500 | A server-retained historical post-image is malformed. | LLP 0165 §Named-checkpoint and history substrate |
| `SNAPBACK_HISTORY_NOT_ENABLED` | 409 | The read conflicts with the table's current history-retention policy. | LLP 0165 §Named-checkpoint and history substrate |
| `SNAPBACK_HISTORY_PAGE_INVALID` | 400 | The requested history page size is outside the finite v1 bound. | LLP 0165 §Named-checkpoint and history substrate |
| `SNAPBACK_HISTORY_POLICY_INVALID` | 400 | The supplied retention policy exceeds fixed v1 duration or row bounds. | LLP 0165 §Named-checkpoint and history substrate |
| `SNAPBACK_HISTORY_TABLE_UNKNOWN` | 404 | The requested history table is not declared by the application schema. | LLP 0165 §Named-checkpoint and history substrate |
| `SNAPBACK_HOST_INCARNATION_ROTATION_INVALID` | 409 | Rotation conflicts with the predecessor epoch's current durable state or sequence. | LLP 0163 §Epochs and ranges |
| `SNAPBACK_HOST_OPERATION_IDENTITY_INVALID` | 400 | The supplied host identity is structurally invalid or fails deterministic derivation. | LLP 0163 §Identity |
| `SNAPBACK_HOST_OPERATION_IDENTITY_REUSED` | 409 | A host identity was reused with divergent durable lease facts. | LLP 0163 §Identity/Suppression lifecycle |
| `SNAPBACK_HOST_OPERATION_LEASE_INVALID` | 409 | Lease completion conflicts with a missing, divergent, or already-completed lease. | LLP 0163 §Epochs and ranges |
| `SNAPBACK_OPERATION_ALREADY_RECORDED` | 409 | Execution reached the writer after the exact operation had already been durably recorded. | LLP 0163 §Suppression lifecycle |
| `SNAPBACK_OPERATION_COVERAGE_MISMATCH` | 500 | A server-authored envelope disagrees with the active coverage manifest. | LLP 0163 §Envelope |
| `SNAPBACK_OPERATION_COVERAGE_UNAVAILABLE` | 503 | The configured stream has no active coverage manifest for this covered lane. | LLP 0163 §Envelope |
| `SNAPBACK_OPERATION_EPOCH_CLOSED` | 410 | The issuance epoch is permanently closed to first attempts. | LLP 0163 §Epochs and ranges |
| `SNAPBACK_OPERATION_EPOCH_STATE_INVALID` | 409 | The requested epoch transition conflicts with its non-open durable state. | LLP 0163 §Epochs and ranges |
| `SNAPBACK_OPERATION_EPOCH_UNAVAILABLE` | 409 | The supplied identity/range cannot be reconciled with a current server-recorded epoch. | LLP 0163 §Epochs and ranges |
| `SNAPBACK_OPERATION_EXPLANATION_LIMIT_INVALID` | 400 | The explanation result limit is outside the declared bound. | LLP 0163 §Retention and explanation |
| `SNAPBACK_OPERATION_EXPLANATION_QUERY_UNBOUNDED` | 400 | Enumeration omits every required principal, session, or time bound. | LLP 0163 §Retention and explanation |
| `SNAPBACK_OPERATION_ISSUANCE_AUTH_INVALID` | 403 | Issuance does not authenticate against the server-recorded authority. | LLP 0163 §Epochs and ranges |
| `SNAPBACK_OPERATION_JOURNAL_INCOMPLETE` | 500 | The covered commit's server-owned journal does not match its envelope writes. | LLP 0163 §Envelope |
| `SNAPBACK_OPERATION_LEDGER_INVALID` | 500 | The server could not encode or bound its own operation-ledger facts. | LLP 0163 §Owned artifacts |
| `SNAPBACK_OPERATION_RANGE_AUTH_INVALID` | 403 | The finite range does not authenticate against its recorded epoch. | LLP 0163 §Epochs and ranges |
| `SNAPBACK_OPERATION_RANGE_EXHAUSTED` | 429 | The operation counter exhausted its finite authenticated range capacity. | LLP 0163 §Epochs and ranges |
| `SNAPBACK_OPERATION_RANGE_OVERLAP` | 409 | The new finite identity range overlaps durable allocated state. | LLP 0163 §Epochs and ranges |
| `SNAPBACK_OPERATION_STREAM_UNAVAILABLE` | 503 | The configured covered writer lacks an initialized data-version stream. | LLP 0163 §Envelope |
| `SNAPBACK_PROMOTION_APPROVAL_INVALID` | 403 | The approval does not match the live branch grant or has expired. | LLP 0164 §Contract summary — Promotion |
| `SNAPBACK_PROMOTION_APPROVED_FACTS_CONFLICT` | 409 | Approved writes conflict with the retained base or staged canonical state. | LLP 0164 §Contract summary — Promotion |
| `SNAPBACK_PROMOTION_APPROVED_FACTS_INVALID` | 500 | Server-retained approved write facts violate the promotion artifact contract. | LLP 0164 §Owned artifacts |
| `SNAPBACK_PROMOTION_AUTHORITY_DENIED` | 403 | Current promotion authority could not be revalidated. | LLP 0164 §Contract summary — Promotion |
| `SNAPBACK_PROMOTION_BASE_ADVANCED` | 409 | Strict CAS lost because the canonical head advanced. | LLP 0164 §Contract summary — Promotion |
| `SNAPBACK_PROMOTION_BASE_DUPLICATE_ROW` | 500 | The trusted immutable-base scan emitted a duplicate row identity. | LLP 0165 §Promotion digest domain |
| `SNAPBACK_PROMOTION_BASE_PRECONDITION_FAILED` | 409 | An approved insert/update/delete conflicts with row presence in the immutable base. | LLP 0165 §Promotion digest domain |
| `SNAPBACK_PROMOTION_BOUNDARY_MISMATCH` | 500 | Staged state failed the independently derived server-side boundary proof. | LLP 0165 §Promotion integration |
| `SNAPBACK_PROMOTION_COMMIT_TIMEOUT` | 504 | Staged promotion exceeded its declared commit-duration deadline. | LLP 0164 §Contract summary — Contention |
| `SNAPBACK_PROMOTION_CONTENTION_EXHAUSTED` | 429 | Rebase or reservation capacity was exhausted under contention. | LLP 0164 §Contract summary — Contention |
| `SNAPBACK_PROMOTION_CONTENTION_POLICY_INVALID` | 400 | The supplied contention terms are non-positive or internally inconsistent. | LLP 0164 §Contract summary — Contention |
| `SNAPBACK_PROMOTION_DIFF_FACTS_MISMATCH` | 409 | The supplied sealed diff conflicts with independently folded approved facts. | LLP 0164 §Contract summary — Diff/Promotion |
| `SNAPBACK_PROMOTION_DIFF_STALE` | 409 | The branch advanced after the reviewed diff. | LLP 0164 §Contract summary — Promotion |
| `SNAPBACK_PROMOTION_ENVELOPE_INVALID` | 500 | The server-built aggregate commit envelope failed its own contract validation. | LLP 0164 §Contract summary — Promotion |
| `SNAPBACK_PROMOTION_HEAD_CHANGED` | 409 | The branch head changed after approval. | LLP 0164 §Contract summary — Promotion |
| `SNAPBACK_PROMOTION_IDENTITY_REUSED` | 409 | The aggregate promotion identity was reused with divergent durable request facts. | LLP 0164 §Contract summary — Promotion |
| `SNAPBACK_PROMOTION_NOT_FIFO_HEAD` | 409 | Admission conflicts with another ticket at the canonical FIFO head. | LLP 0164 §Contract summary — Contention |
| `SNAPBACK_PROMOTION_REBASE_DIVERGED` | 409 | Rebase changed schema or approved facts and therefore requires fresh approval. | LLP 0164 §Contract summary — Promotion |
| `SNAPBACK_PROMOTION_REBASE_LOG_EMPTY` | 409 | Current branch state has no replay-sufficient operation to rebase. | LLP 0164 §Contract summary — Promotion |
| `SNAPBACK_PROMOTION_REPLAY_DIVERGED` | 409 | Re-execution no longer reproduces the sealed approved facts. | LLP 0164 §Contract summary — Promotion |
| `SNAPBACK_PROMOTION_REQUEST_FACTS_DIVERGED` | 409 | Current log, diff, manifest, or approved facts diverge from the sealed request. | LLP 0164 §Contract summary — Promotion |
| `SNAPBACK_PROMOTION_REQUEST_SEAL_INVALID` | 403 | The request lacks a valid server seal and therefore has no promotion authority. | LLP 0164 §Contract summary — Promotion |
| `SNAPBACK_PROMOTION_RESERVATION_NOT_ELIGIBLE` | 409 | The ticket has not reached or no longer satisfies the durable reservation state. | LLP 0164 §Contract summary — Contention |
| `SNAPBACK_PROMOTION_SCHEMA_DIVERGED` | 409 | Canonical and immutable-base table shapes no longer agree. | LLP 0164 §Contract summary — Promotion |
| `SNAPBACK_PROMOTION_SCHEMA_IDENTITY_MISSING` | 500 | The server cannot form or verify the sealed canonical schema identity. | LLP 0165 §Promotion digest domain |
| `SNAPBACK_PROMOTION_SEAL_KEY_INVALID` | 500 | The server's promotion sealing secret is below the required strength. | LLP 0164 §Owned artifacts |
| `SNAPBACK_PROMOTION_TICKET_EXPIRED` | 410 | The finite admission ticket expired before promotion. | LLP 0164 §Contract summary — Contention |
| `SNAPBACK_PROMOTION_TICKET_IDENTITY_INVALID` | 400 | The submitted ticket identity is not a valid host identity on the canonical stream. | LLP 0164 §Contract summary — Promotion |
| `SNAPBACK_PROMOTION_TICKET_IDENTITY_REUSED` | 409 | A ticket identity collides with divergent durable admission facts. | LLP 0164 §Contract summary — Contention |
| `SNAPBACK_PROMOTION_TICKET_MISMATCH` | 403 | The supplied ticket does not match durable admission authority. | LLP 0164 §Contract summary — Promotion |
| `SNAPBACK_PROMOTION_TICKET_TTL_INSUFFICIENT` | 400 | The requested ticket lifetime cannot cover its queue-position service bound. | LLP 0164 §Contract summary — Contention |
| `SNAPBACK_PROMOTION_WRITES_NOT_CANONICAL` | 500 | Server-approved proof writes are not unique and canonically ordered. | LLP 0165 §Promotion digest domain |
| `SNAPBACK_PROMOTION_WRITE_COVERAGE_INCOMPLETE` | 409 | The branch's current writes include lanes the declared promotion profile cannot prove. | LLP 0164 §Contract summary — Promotion |
| `SNAPBACK_PROMOTION_WRITE_PATH_UNCOVERED` | 409 | The current schema/write path falls outside the closed promotion writer seam. | LLP 0164 §Implementation record — strict promotion |
| `SNAPBACK_PROOF_BUDGET_EXCEEDED` | 413 | Canonical proof bytes exceed the declared bounded-work budget. | LLP 0165 §Proof discipline |
| `SNAPBACK_PROOF_CANONICAL_VALUE_REFUSED` | 500 | A server-authored proof preimage contains a value the canonicalizer cannot represent. | LLP 0165 §Proof discipline |
| `SNAPBACK_PROOF_DOMAIN_MISMATCH` | 500 | Server proof assembly mixed expected and actual digests from different domains. | LLP 0165 §Proof discipline |
| `SNAPBACK_PROOF_EXPECTED_DERIVATION_MISSING` | 500 | Server proof assembly omitted the required independent expected-value derivation. | LLP 0165 §Proof discipline |
| `SNAPBACK_PROOF_ROWS_NOT_CANONICAL` | 500 | Server proof rows are duplicated or out of canonical order. | LLP 0165 §Proof discipline |

## Remainder

None. Every code's semantics was established from the owning LLP and emit site;
no diagnostic required the reviewed-as-500 fallback for unresolved semantics.

## Verification

- `DYLD_FRAMEWORK_PATH=$PWD/vendor/ibex/ios/Frameworks cargo test --lib s5_d10`:
  4 passed, 0 failed, 0 ignored, 2,002 filtered out. Both HTTP-status oracles
  passed, as did the two adjacent s5_d10 vector/artifact tests.
- `DYLD_FRAMEWORK_PATH=$PWD/vendor/ibex/ios/Frameworks cargo test --lib`:
  1,847 passed, 157 failed, 2 ignored. The target compiled and the failures
  were sandbox-only permission failures: the known auth-backup filesystem
  cluster plus loopback/socket-dependent CLI, embed, push, server, local, and
  storage fixtures that cannot bind or perform their protected filesystem
  operations in this managed sandbox. No failure implicated the diagnostic
  mapper or either s5_d10 oracle.
- `./ref-check --verbose`: 168 LLP documents, 3,277 references in 7,314 files,
  0 errors, 0 unchecked.
- `git diff --check`: passed.

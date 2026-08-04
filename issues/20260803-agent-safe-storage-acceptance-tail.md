# Agent-safe storage acceptance tail

**Status:** Open
**Opened:** 2026-08-03 (Track B integrated implementation pass)
**Updated:** 2026-08-04 (managed branch execution carrier, crash-safe
outcome-unknown reservation, scoped-principal and real-handler DenyAll
negatives, and independent clocks added; residual rows remain open)
**Systems:** Storage, Sync, Auth, Effects, Migrations, Testing, Performance,
Agent experience
**Related:** LLP 0158, LLP 0162, LLP 0163, LLP 0164, LLP 0165;
`issues/20260803-0163-public-operation-identity-carrier.md`;
`issues/20260803-guide-gap-instance-forks.md`

Track B now has the step-0 baseline and OQ13 gate artifacts, the first
integrated implementation slices for LLP 0163-0165, F0b fleet dogfood, a clean
comparable candidate run, and historical plus final-integrated dated
fork/promotion absolute runs. This ticket is the honest remainder against LLP
0162's single acceptance corpus. It does not reopen implemented work and does
not authorize capability publication.

## Remaining acceptance work

| LLP 0162 row | State through 2026-08-04 | Required closure |
| --- | --- | --- |
| 1 — atomic envelope | Partial | Carry authenticated issuance on the public ordinary-mutation path, activate a complete target manifest, and run its full crash-cut matrix. |
| 2 — retry settlement | Partial | Ship range issue/refresh plus atomic client range custody and finish restored-client, recreated-branch, delayed-delivery, host-retry, and exhaustion transport legs. |
| 3 — provenance/explanation | Partial | Expose authorized public/admin explanation, wire real policy evaluators and protected secret custody, and complete aggregate/non-row authorization-change corpus. |
| 4 — coverage honesty | Partial | Inventory every target writer and enforce the generated writer-token facade plus SQLite authorizer; finish specialized-lane and asymmetric-retention coverage fixtures. |
| 5 — fork isolation | Partial | F0b and the derived post-fork-parent-write fixture cover the copied-instance leg; managed custody and `branch.execute.v1` run real mutations/actions only on the server-derived current-head workspace. Finish the per-class credential matrix and the multi-operation/atomic-retention carrier. |
| 6 — effect quarantine | Partial | The managed boot path routes all twelve inventoried local host-egress families through durable payload-free `DenyAll` markers; real branch handlers cover fetch, stream-open, push-send, and transactional job-enqueue initiation. Add the unreachable-after-initiation and remaining maintenance/bypass corpus; implement and prove `CaptureOnly` separately with its intent/settlement ledger. |
| 7 — identity/authority | Partial | Branch execution revalidates a digest-bound finite grant and uses a dedicated branch-principal invocation source that cannot admit `AdminBypass`; an admin-row guard negative proves the projection. Finish the per-class revoked/stale plus later-effect-settlement corpus. |
| 8 — resource containment | Partial | Digest-work and exact TTL/grant expiry bounds are active; executable corpus now proves compact-envelope pruning cannot reap a live branch and branch reaping cannot advance replay floor or prune an envelope. Finish the remaining declared resource-limit corpus. |
| 9 — exact fork diff | Partial | The randomized multi-commit corpus compares journal-derived net state with an independent immutable-base/head oracle and verifies the attributed sequence separately. Add schema/system-field and full generated-writer/SQLite-authorizer journal-completeness coverage. |
| 10 — strict promotion | Partial | The non-atomic execution carrier durably reserves exact request facts and forecloses before the handler: terminal retries replay, outcome-unknown retries refuse, divergent reuse collides, and a second operation refuses. Move operation retention into the app commit, then complete the remaining fairness/crash/re-seal/effect-chain corpus and production contention constants. |
| 11 — history/checkpoint | Partial | Project finite history policy from schema declarations; complete per-version auth/pagination/horizon corpus and protected-copy erasure obligations. |
| 12 — boundary proof | Partial | Promotion and checkpoint proof paths are integrated; add migration boundary integration and the remaining concurrent-writer/publication/receipt-only negative corpus. |
| 13 — performance | Partial | The final-integrated absolute rerun is recorded, and the successor recorder now refuses unless it binds the accepted baseline digest, exact clean revision, fixed hardware, toolchain, and release executable. Run that dated successor plus a genuinely paired/interleaved active-covered-lane comparison; obtain dated RFC-author absolute-bound ratification; record p99 contention and every applicable crash/reopen gate. |
| 14 — identity lifecycle | Partial | Wire first-party host job/cron/migration callers and transport-level client exclusion, then finish capacity/purge/current-authority negative fixtures beyond the landed promotion-ticket lease. |

The detailed LLP 0163 public-carrier work remains in its existing focused
ticket. F1's operating guide and fork-aware acceptance-harness work remains in
the guide-gap ticket rather than being conflated with this implementation tail.

## Dated implementation evidence — 2026-08-04

- `fork_promotion::tests::exact_diff_model_corpus_covers_add_update_delete_and_folding`
  executes 32 deterministic seeds × 48 journalized commits, compares the
  journal-derived head with an independent model and base/head scanner, and
  verifies the emitted attribution sequence separately.
- `fork_promotion::tests::exact_diff_refuses_unjournaled_writes_and_exhausted_digest_work`
  proves a direct-SQL bypass cannot publish a diff and a one-byte work budget
  refuses with `SNAPBACK_BRANCH_DIGEST_WORK_LIMIT_EXCEEDED` without canonical
  mutation. The receipt records the admitted byte count and the generated
  branch receipt/diff schemas require both the budget and accounting fields.
- `instance_fork::tests::derived_fork_keeps_its_pinned_copy_when_parent_writes_after_publication`
  proves updates and inserts committed by the parent after publication are
  invisible to the copied derived deployment.
- `snapback-fork-promotion-bench` v2 requires the exact expected clean revision,
  the accepted step-0 artifact and its SHA-256 digest, the Mac17,3/M5/32-GiB
  hardware/OS class, matching toolchain versions, and the release executable
  digest. It creates a new dated record and refuses overwriting an old one.

The managed in-app branch slice is recorded in LLP 0164's dated implementation
record. Focused operation-registry and HTTP negatives prove the five lifecycle
operations are `SystemApi`/`AdminWrite`/admin-credential/operator operations and
that unauthenticated requests cannot reach dispatch. Callers cannot provide a
workspace path, branch identity, child stream, grant, or authority fingerprint.
The canonical `creating` row precedes filesystem materialization and is
reconciled after the profile-commit crash cut before a later mutable create can
publish. The exact SQLite main-file binding, isolation matrix, executable-head
credential scrub, twelve-family `DenyAll` persistence, exact-expiry reaping,
and strict-promotion stale/revoked negatives are executable Rust tests.

The same dated slice now includes closed `branch.execute.v1`. A caller must
retain a replay-valid `requestId`; the server derives its operation identity,
revalidates the branch grant and artifact binding, and runs the served handler
under a branch-scoped ordinary principal. Before any handler byte runs, one
transaction records the exact draft and forecloses the branch. A crash with no
terminal record therefore produces stable `SNAPBACK_BRANCH_OPERATION_OUTCOME_UNKNOWN`
instead of duplicate execution; divergent reuse and any second operation also
refuse. Mutation retention is still after the app commit, so this is a safe
one-operation Partial carrier, not row-10 acceptance. Real handlers exercise
fetch, stream-open, push-send, and transactional job-enqueue initiation through
the durable DenyAll choke, and an admin-owned-row guard proves the branch
principal is not an administrative bypass. Independent-clock corpus separately
varies compact-envelope pruning, branch TTL reaping, and replay floor.

This evidence intentionally does not close rows 5-8 or 10. `CaptureOnly` has no
intent/settlement ledger, later-effect settlement is unbuilt, retention is not
atomic with the app commit, only one operation is admitted per foreclosed
branch, and the remaining actual-handler/per-class/resource matrix has not
passed. No capability state changes follow from this record.

## Review and publication gates

- LLP 0163, LLP 0164, and LLP 0165 remain `Draft`. Their existing extraction
  reviews predate the final integrated implementation and are not fabricated
  into final implementation reviews.
- Independent review and the documents' named acceptance authority must be
  obtained before changing their status.
- A capability may move above `Missing` only for a named target/component whose
  applicable rows, including row 13, pass. Partial aggregate progress is not a
  substitute for per-component evidence.
- The closing pass must run `llp-maintain` reconciliation, `ref-check`, guide
  validation, generated-artifact/schema drift checks, and proportional
  own-correctness after the last `origin/main` reconciliation.

## Close when

Every applicable row above is either green with a dated artifact or explicitly
re-scoped by the LLP 0162 author in a dated revision; the extracted Specs have
completed their real review/acceptance loop; the target capability manifest is
updated only to the proved component states; and the Track B closing audit is
green.

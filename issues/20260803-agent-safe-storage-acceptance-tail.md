# Agent-safe storage acceptance tail

**Status:** Open
**Opened:** 2026-08-03 (Track B integrated implementation pass)
**Updated:** 2026-08-04 (journal-derived in-app diff, independent oracle,
digest-work bound, derived parent-write isolation, and measurement-recorder
binding landed; residual rows remain open)
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
| 5 — fork isolation | Partial | F0b and the derived post-fork-parent-write fixture cover the copied-instance leg; managed in-app custody adds an AdminWrite lifecycle carrier, crash reconciliation, current-head canonical/sibling/post-fork isolation, and scrubbed executable heads over immutable proof bases. Add the public branch-operation execution carrier and finish the per-class credential matrix. |
| 6 — effect quarantine | Partial | The managed boot path routes all twelve inventoried local host-egress families, including the unclassified fallback, through durable payload-free `DenyAll` markers. Add actual branch-handler bypass negatives; implement and prove `CaptureOnly` separately with its intent/settlement ledger. |
| 7 — identity/authority | Partial | Managed custody server-derives grants/paths, scrubs copied canonical credentials, and proves denied, divergent-fingerprint, and expired strict-promotion authority refuse before replay. Wire production branch-operation auth and finish the per-class revoked/stale plus later-effect-settlement corpus. |
| 8 — resource containment | Partial | The in-app diff enforces a streaming digest-work byte limit, while managed reap enforces TTL/grant expiry exactly at the boundary with durable `tearing_down`, exact-file deletion, and crash/reopen reconciliation. Finish the replay-floor/envelope-window independent-clock corpus and remaining declared resource limits. |
| 9 — exact fork diff | Partial | The randomized multi-commit corpus compares journal-derived net state with an independent immutable-base/head oracle and verifies the attributed sequence separately. Add schema/system-field and full generated-writer/SQLite-authorizer journal-completeness coverage. |
| 10 — strict promotion | Partial | Complete concurrent-writer fairness/crash cuts, exhausted-budget and identical-write/divergent-read-or-result re-seal negatives, conditional-progress terms, provisional/transitive effect chains, and production contention constants. |
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

Focused local results: all 18 pre-runtime `fork_promotion::tests`, all 17
`instance_fork::tests`, and the 18-test managed-runtime filter pass. This
evidence intentionally does not close rows 5-8. The product branch has no
public operation-execution carrier yet, `CaptureOnly` has no intent/settlement
ledger, later-effect settlement is unbuilt, digest-work/independent-clock
coverage is incomplete, and the remaining per-class matrix has not passed. No
capability state changes follow from this record.

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

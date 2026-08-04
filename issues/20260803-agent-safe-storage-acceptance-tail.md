# Agent-safe storage acceptance tail

**Status:** Open
**Opened:** 2026-08-03 (Track B integrated implementation pass)
**Updated:** 2026-08-04 (strict-promotion contention/rebase negatives,
schema-declared v2 per-record history with v1 compatibility, checkpoint
no-upcast negatives, and honest migration verification metadata landed;
residual rows remain open)
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
| 10 — strict promotion | Partial | Frozen v1 contention terms, quota/defer/release behavior, exhausted-budget refusal, and identical-write/divergent-read-or-result re-seal negatives are covered. Complete the real concurrent-writer fairness/crash matrix, prove the conditional-progress claim, and cover provisional/transitive effect chains. |
| 11 — history/checkpoint | Partial | Schema publication now atomically projects finite v2 per-record policy, removal erases retained detail, and current/per-version auth plus visible-only pagination/horizon and per-record pruning are covered without changing legacy v1 `maxRows`. The registered-copy sweep invalidates the complete materialized inventory before deletion and preserves crash/unreachable obligations, but it is not yet atomic with canonical protected-record deletion; close that new-checkpoint race and the remaining lifecycle corpus. |
| 12 — boundary proof | Partial | Promotion and full migration verification are independently derived; migration's separate evaluator has explicit-value/equivalence plus executor-drift and staged-corruption negatives. Checkpoint concurrent-writer/publication/receipt-only no-upcast negatives are covered. Finish the remaining row-wide boundary integrations/coverage before an aggregate claim. |
| 13 — performance | Partial | The final-integrated absolute rerun is recorded. The successor absolute recorder includes a 128-sample/8-writer request-to-commit p99 behind a production promotion reservation. A second recorder now pairs the exactly reconstructed pre-profile tree with the active issuance-bearing covered lane in 11 AB/BA observations: registered point/range/query-plan and single-writer thresholds, active allocation/retention observations, and five-second CPU/RSS/disk gates. Run both exact clean recorders on the fixed Air; obtain dated RFC-author absolute-bound ratification; pass every applicable crash/reopen gate. |
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
- `snapback-fork-promotion-bench` v3 retains those bindings and adds 128 raw
  benchmark-SQL request-to-commit samples across eight real SQLite writer
  connections behind the production `canonical_mutation_admission` gate and
  an active production promotion reservation. The timed commit after that gate
  is a benchmark transaction, not the full envelope mutation path. It records
  nearest-rank p50/p95/p99/max plus a per-worker initial-defer count and refuses
  unless all eight initial samples were actually deferred. This is recorder
  readiness, not a dated Air result or complete writer-path proof.
- `snapback-agent-safe-paired` reconstructs the pre-profile tree from
  revision `2ab36e28c74c450213b65f17ef81c0d6652ba33a` plus the exact three
  instrumentation blobs from `3109a3b4f5068595a71448b10788b56b4fa358f5`.
  A separate external wrapper links by exact path to that tree without becoming
  a fourth accepted product instrumentation path. Measurement-time provenance
  must independently bind the wrapper source/path dependency, the exact
  baseline root lock, the wrapper lock derived from that baseline resolution,
  those three blob digests, toolchain/profile, and wrapper executable digest.
  The runner compares every shared package name/version/source/checksum tuple,
  permits only the wrapper package as an addition, and also binds the accepted
  baseline artifact digest, exact clean candidate revision, and candidate
  executable digest. It performs one warm-up per
  executable then 11 time-local AB/BA pairs. The candidate activates the actual
  ordinary-mutation manifest, carries a server-issued range through the
  production envelope seam, measures allocated/retained file-family bytes for
  one such mutation after setup, and holds active coverage/range state across
  each five-second CPU/RSS/disk idle observation. Byte observations remain
  unbounded because LLP 0162 registers no numeric byte threshold. The output
  forces `fullRow13ProtocolQualified: false`: no fixed-Air artifact exists, and
  the p99, author-bound, and applicable correctness gates remain independent.
- `fork_promotion::tests::production_contention_terms_bound_reservation_quota_and_writer_admission`,
  `exhausted_rebase_budget_refuses_before_canonical_mutation`, and
  `rebase_reexecutes_into_fresh_branch_and_reseals_only_equal_facts` bind the
  frozen R=2 / 1,000-ms / quota=1 / 500-ms v1 terms, prove ordinary-writer
  defer/release and quota exhaustion, refuse an exhausted promotion before
  canonical mutation, and refuse identical writes when read or result facts
  diverge.
- `proof_checkpoint::tests::history_prunes_per_record_and_schema_removal_erases_retained_detail`
  and `history_survives_reopen_elides_per_version_and_never_moves_sync_floor`
  cover schema projection/removal, per-record caps, current plus per-version
  authorization, visible-only pagination/horizon facts, reopen, and the
  independent history clock. `legacy_v1_max_rows_remains_table_wide_and_wire_compatible`
  proves the committed v1 `maxRows` spelling and table-wide behavior did not
  silently change.
- `proof_checkpoint::tests::receipt_only_checkpoint_stays_inventory_and_cannot_be_upcast`
  adds the explicit receipt-only negative beside the existing eight-cut
  publication and concurrent-writer corpus. Migration full verification now
  records expected/actual logical and system digests, `boundaryDomain:
  migration`, and `expectedEvaluatorIndependence: separateImplementation`.
  `migration_expected_oracle_covers_the_closed_expression_profile`,
  `independent_oracle_detects_executor_semantic_drift_before_publication`, and
  `verification_failure_blocks_publication` bind the separately implemented
  expected path to explicit values and prove drift/corruption refuse before
  publication.
- `proof_checkpoint::tests::protected_record_erasure_enumerates_all_copies_and_closes_obligations`
  and `protected_record_erasure_crash_reopens_with_registry_obligation` prove
  transactional invalidation of every registered materialized copy, honest
  unreachable-copy receipts, retry closure, and crash/reopen reconciliation.
  The sweep is not atomic with canonical protected-row deletion, so the
  possible intervening new checkpoint remains an explicit row-11 gap.
- A 2026-08-04 deletion-authority audit found no canonical product operation
  that classifies a generic row as protected and owns canonical deletion,
  retained-history erasure, checkpoint fencing, and copy obligations. Generic
  `BufferedWrite::Delete`/mutation deletes and specialized asset/auth deletion
  paths do not have that authority. Row 11 therefore remains Partial until a
  real protected-erasure command installs one retry-bound durable fence with
  canonical deletion/history erasure/inventory invalidation, blocks checkpoint
  admission and publication while open, and passes the crash/reopen,
  reachable/unreachable, exact/divergent retry, concurrency, pin, lease, and
  expiry corpus. No test-only or benchmark-only deletion semantic was added.

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

Focused local results: all 21 `fork_promotion::tests`, all 17
`proof_checkpoint::tests`, all 17 `instance_fork::tests`, and the 18-test
managed-runtime filter pass. This
evidence intentionally does not close rows 5-8. The product branch has no
public operation-execution carrier yet, `CaptureOnly` has no intent/settlement
ledger, later-effect settlement is unbuilt, digest-work/independent-clock
coverage is incomplete, and the remaining per-class matrix has not passed. No
capability state changes follow from this record.
It also does not establish the global writer-token/SQLite-authorizer choke
point, a dated fixed-Air p99 or active-covered paired record, author bounds, or
any capability claim; every related capability remains `Missing`.

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

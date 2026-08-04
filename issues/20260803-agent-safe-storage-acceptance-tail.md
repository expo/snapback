# Agent-safe storage acceptance tail

**Status:** Open
**Opened:** 2026-08-03 (Track B integrated implementation pass)
**Updated:** 2026-08-04 (atomic multi-operation public branch carrier,
server-owned causal predecessors, payload-free ordered CaptureOnly intents,
atomic canonical pending-effect publication, transitive provisional refusal,
and fenced reopen-safe settlement added; capabilities remain Missing pending
the integrated performance/review/publication gates); 2026-08-04 (real k=2–4 strict-promotion concurrency,
conditional FIFO progress, and reservation/admission/commit/release crash cuts;
strict-promotion contention/rebase negatives,
schema-declared v2 per-record history with v1 compatibility, checkpoint
no-upcast negatives, honest migration verification metadata, managed branch
execution carrier, crash-safe
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
| 3 — provenance/explanation | Partial | Public/admin transport and protected custody are wired. The public lane now revalidates the active artifact, current function/grant/profile policy, derived audience, current and retained historical owners, and every closed fact for exact generated owner-create/update envelopes. Create's private mint observation is exact-site-bound and stripped before projection; generated delete is recognized but remains a current-row-absent refusal. Complete positive evaluators, if justified, for aggregate/non-row, hand-written/opaque, predicate, membership, effect-bearing, and remaining policy classes. |
| 4 — coverage honesty | Partial | The local target now names 23 physical writer families with no grouped row. Exactly four ordinary/host adapters are envelope-mapped; every other family has an executable exclusion reason, and non-envelope app writers refuse after arming. Raw/cached/trigger/system-field/DDL bypass, exact four-writer publication, target-vs-app-effective, crash/reopen, retry, and ordinary/host asymmetry fixtures are green. The production activation cut remains uninvoked pending migration/cross-lane retention, fixed-Air, review, and acceptance gates. |
| 5 — fork isolation | Partial | F0b and the derived post-fork-parent-write fixture cover the copied-instance leg; managed custody and `branch.execute.v1` run real mutations/actions only on the server-derived current-head workspace. The carrier now admits exact multiple operations and retains mutation facts atomically with app rows/journal/version. Final integrated correctness/review remains. |
| 6 — effect quarantine | Partial | All inventoried local host-egress families route through branch mediation. `DenyAll` retains only bounded refusal markers; `CaptureOnly` retains server-ordered payload-free per-attempt intents and never initiates provider work, including a caught repeated-family handler fixture. Final integrated bypass/review evidence remains. |
| 7 — identity/authority | Partial | Branch execution revalidates a digest-bound finite grant and uses a dedicated non-admin branch principal. Promotion copies authority-bound intents; every settlement attempt revalidates principal/grant/fingerprint/expiry/revocation, with revoked and expired negatives. Final integrated per-class review remains. |
| 8 — resource containment | Partial | Digest work, branch/grant TTL, intent count, retained operation bytes, and independent envelope/replay-floor/branch clocks have executable bounds. Final integrated resource/performance evidence remains. |
| 9 — exact fork diff | Partial | The randomized multi-commit corpus compares journal-derived net state with an independent immutable-base/head oracle and verifies the attributed sequence separately. Exact ordinary HostPlan/Buffered postimages now match stored system fields under the SQLite authorizer, hidden trigger writes refuse, and all other physical writers are individually classified. Finish schema-transition coverage; excluded migration/seed/admin/projection/promotion writers still prevent a wider journal-completeness claim. |
| 10 — strict promotion | Partial | Frozen v1 contention/fairness/crash evidence is joined by atomic multi-operation retention and CaptureOnly promotion: staged data, ordered canonical pending intents, joins, receipt, effect-bearing envelope, version, and ticket completion share one transaction. Server-owned causal predecessors enforce transitive provisional refusal; fenced settlement survives reopen and refuses stale authority or divergent terminal retry. Global writer coverage and applicable performance/review remain independent gates. |
| 11 — history/checkpoint | Partial | Schema publication now atomically projects finite v2 per-record policy, removal erases retained detail, and current/per-version auth plus visible-only pagination/horizon and per-record pruning are covered without changing legacy v1 `maxRows`. The registered-copy sweep invalidates the complete materialized inventory before deletion and preserves crash/unreachable obligations, but it is not yet atomic with canonical protected-record deletion; close that new-checkpoint race and the remaining lifecycle corpus. |
| 12 — boundary proof | Partial | Promotion and full migration verification are independently derived; migration's separate evaluator has explicit-value/equivalence plus executor-drift and staged-corruption negatives. Checkpoint concurrent-writer/publication/receipt-only no-upcast negatives are covered. Finish the remaining row-wide boundary integrations/coverage before an aggregate claim. |
| 13 — performance | Partial | The final-integrated absolute rerun is recorded. The successor absolute recorder includes a 128-sample/8-writer request-to-commit p99 behind a production promotion reservation. A second recorder now pairs the exactly reconstructed pre-profile tree with the active issuance-bearing covered lane in 11 AB/BA observations: registered point/range/query-plan and single-writer thresholds, active allocation/retention observations, and five-second CPU/RSS/disk gates. Run both exact clean recorders on the fixed Air; obtain dated RFC-author absolute-bound ratification; pass every applicable crash/reopen gate. |
| 14 — identity lifecycle | Partial | Wire first-party host job/cron/migration callers and transport-level client exclusion, then finish capacity/purge/current-authority negative fixtures beyond the landed promotion-ticket lease. |

The detailed LLP 0163 public-carrier work remains in its existing focused
ticket. F1's operating guide and fork-aware acceptance-harness work remains in
the guide-gap ticket rather than being conflated with this implementation tail.

## Dated implementation evidence — 2026-08-04

- Public explanation now has two deliberately narrow positive profiles: exact
  generated `owned-crud.v1` / `owner.v1` create/update HostPlans. A request
  must present the current `clientAudienceId`; the server derives the audience
  from it and the live authority incarnation, re-runs current function and
  grant policy, compares the exact active artifact digest, and checks current
  plus captured historical ownership where applicable. Generated create also
  binds its one private mint observation to the active plan's exact site,
  occurrence, and inserted id, then strips that private ledger before public
  projection; it never supplies authority. Generated delete is recognized but
  refuses because no current row can satisfy owner policy. The protected
  read/write/context/receipt set must have the exact expected cardinality and
  shape, effects must be empty, and the receipt must agree with the postimage,
  snapshot, result, changed row, and context ledger. Focused negatives cover
  artifact drift, current and historical owner change, unsupported
  missing/predicate/aggregate-result/membership permission facts, widened
  context/effects, divergent receipts, wrong/extra/reordered private mint
  observations, truncation, and expiry. Any constituent failure returns one
  metadata-free `authorization-unprovable`; unsupported classes remain open
  and every related capability remains `Missing`.
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
- `fork_promotion::tests::concurrent_ticket_issuance_serializes_into_one_durable_fifo`
  runs four file-backed issuers against one canonical stream; host identity,
  idempotent reuse, FIFO allocation, and lease custody now share one immediate
  transaction, and reopen observes one contiguous queue. A durable loss floor
  prevents expiry alone from minting repeated writer deferrals.
- `fork_promotion::tests::concurrent_reviewed_forks_make_bounded_fifo_progress_with_ordinary_writers`
  runs k=2, 3, and 4 populations. Approvals are issued in the population loop;
  two independently opened ordinary canonical writer transactions run during
  every success cycle through the production reservation gate; fresh-fork
  replay inherits FIFO ticket and original approval only after equal full-fact
  re-seal. Under the fixture's declared finite replay, below-capacity arrival,
  sufficient TTL, and sufficient quota, all k complete in FIFO order within k
  success cycles and later heads automatically consume the bounded reservation
  after R real advanced-head losses.
- `fork_promotion::tests::promotion_crash_reopen_matrix_retains_admission_then_replays_committed_release`,
  `reservation_expiry_mid_attempt_rolls_back_and_retains_the_fifo_ticket`, and
  `expired_reservation_needs_fresh_losses_before_the_ticket_can_defer_again`
  cover reservation reopen, process death during transactional admission,
  commit-before-response retry, atomic writer release, mid-attempt expiry
  rollback, and the repeated-deferral negative. This closes row 10's real
  contention/fairness/crash leg only. `CaptureOnly` settlement and its
  provisional/transitive effect chain are still absent; this ticket, LLP 0164,
  and every related capability therefore remain Open/Draft/`Missing`.
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
managed-runtime filter pass at the preceding checkpoint.
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

At that preceding checkpoint, this evidence intentionally did not close rows
5-8 or 10. `CaptureOnly` had no intent/settlement ledger, later-effect
settlement was unbuilt, retention was not atomic with the app commit, only one
operation was admitted per foreclosed
branch, and the remaining actual-handler/per-class/resource matrix has not
passed. It also does not establish the global writer-token/SQLite-authorizer
choke point, a dated fixed-Air p99 or active-covered paired record, author
bounds, or any capability claim; every related capability remains `Missing`.

The same 2026-08-04 record now includes the LLP 0163 lifecycle tail for rows 1,
2, and 14. File-backed production HostPlan and Buffered writers pass all three
settlement/envelope/COMMIT crash cuts and reopen as none-or-complete. Missing
predecessor replay rows fall through to the operation ledger: protected exact
receipts reopen from digest-bound custody without plaintext in suppression,
ACK/purge preserves result-expired duplicate prevention, and closed-floor
committed retries plus delayed first delivery surface outcome unknown before
dispatch. Retention-full preserves the unacknowledged result. Operator purge is
payload-free audited and partition-scoped against same-text cross-stream/client
and host/divergent-principal collisions. The client keeps result-expired and
identity-horizon heads pending, reports known/unknown operation outcome, and
blocks ordered successors instead of mark-failing a committed operation.

Rows 1, 2, and 14 remain Partial: recreated-branch end-to-end lifecycle,
migration host identity, a distinct durable result-gone client state, complete
target writer/bypass inventory, production activation, and row 13 are still
open. No capability state changes in this record.

### Fork carrier and CaptureOnly evidence — 2026-08-04

The production `branch.execute.v1` carrier no longer uses pre-handler branch
foreclosure. A new request receives a conservative server-owned predecessor
set containing every retained earlier child version; callers cannot submit or
narrow dependency facts. Exact retries recover their original predecessor set
before the complete collision check. HostPlan and Ibex mutation commits retain
the branch operation inside the application SQLite transaction, alongside app
rows, the change journal, storage-version publication, retained-byte accounting,
and captured-intent version bindings. Multiple later operations remain
admissible, and a forced retention-limit failure rolls the staged application
write back with no operation residue.

CaptureOnly now persists one bounded payload-free intent per attempted host
effect before returning a fail-loud captured diagnostic. A handler that catches
the first fetch refusal and attempts the same family again produces distinct
server ordinals 0 and 1 and one final operation binding both ordered intents;
the target sentinel is absent from the reopened database bytes. Intent-count
and exact-TTL negatives refuse before further custody.

Strict promotion validates the operation facts against the complete intent
ledger and copies each intent as `canonicalPending` in the same canonical
transaction as staged writes, the journal proof, source joins, receipt,
aggregate envelope, version advance, and ticket completion. The envelope
includes the effect facts and settlement classes while still declaring
`promotionCoverageManifest` uncovered. Conservative public predecessors feed
transitive enforcement: a later ordinary write downstream of a captured effect
refuses promotion unless the application supplied an explicit provisional
representation; the runtime never invents pending semantics for a plain row.

The post-promotion seam durably fences initiation before provider work,
revalidates current principal/grant/fingerprint/expiry/revocation on every
attempt, and retains a stable provider idempotency key. Corpus covers revoked
and exact-expiry refusals, valid initiation, canonical-store reopen, exact
initiation retry, digest-only terminal success, exact terminal retry, and
divergent-outcome refusal. No provider payload or terminal detail is retained.
The inherited fork suite also repairs its strict-reexecution source locator and
uses a valid compact envelope in the independent-clock test; the
compile-disabled post-image `branches::promote` code is unchanged.

These rows remain `Partial` only because the separate integrated
writer-coverage, fixed-Air performance/p99, final own-correctness, independent
review, author acceptance, and publication gates have not all completed in
this lane. LLP 0164 remains `Draft`; no capability state changes above
`Missing` are made here.

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

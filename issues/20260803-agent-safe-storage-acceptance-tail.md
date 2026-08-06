# Agent-safe storage acceptance tail

**Status:** Open
**Opened:** 2026-08-03 (Track B integrated implementation pass)
**Reconciled:** 2026-08-05 (LLP 0185 Phase 0 — assigned each remaining proof
leg to its contract owner without changing any row state); 2026-08-05 (LLP
0185 Phase 3 — dated derived-deployment evidence recorded below, row states
unchanged)
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

“Owner” below means the one document accountable for defining and closing that
proof leg. This ticket remains the consolidated status ledger; it does not
become a competing contract owner, and the assignments do not change any row
from `Partial`.

| LLP 0162 row | State on 2026-08-03 | Required closure | Contract owner / focused tracker |
| --- | --- | --- | --- |
| 1 — atomic envelope | Partial | Carry authenticated issuance on the public ordinary-mutation path, activate a complete target manifest, and run its full crash-cut matrix. | LLP 0163; public carrier/activation work stays in `issues/20260803-0163-public-operation-identity-carrier.md`. |
| 2 — retry settlement | Partial | Ship range issue/refresh plus atomic client range custody and finish restored-client, recreated-branch, delayed-delivery, host-retry, and exhaustion transport legs. | LLP 0163; the same focused public-carrier ticket owns execution. |
| 3 — provenance/explanation | Partial | Expose authorized public/admin explanation, wire real policy evaluators and protected secret custody, and complete aggregate/non-row authorization-change corpus. | LLP 0163; the same focused public-carrier ticket owns execution. |
| 4 — coverage honesty | Partial | Inventory every target writer and activate the complete per-target manifest; separately enforce the global generated writer-token facade plus SQLite authorizer; finish specialized-lane and asymmetric-retention fixtures. | Split by already-declared contract: LLP 0163 owns writer inventory, envelope-hook routing, manifest activation, and retention joins; LLP 0165 owns the generated facade + SQLite-authorizer journal-completeness choke point. Each owner closes only its named leg. |
| 5 — fork isolation | Partial | F0b proves the first derived-deployment consumer; add the derived post-fork-parent-write invisibility fixture, then close the in-app product/runtime surface and full per-class isolation/credential matrix. | LLP 0164 owns both class-specific acceptance legs. In particular, the derived post-fork-parent-write fixture is LLP 0164 row-5 work, **not** LLP 0158 F1 guide/harness work; LLP 0158 remains the derived-deployment semantic/implementation authority. |
| 6 — effect quarantine | Partial | Mediate every product host-egress family with bypass negatives; implement and prove `CaptureOnly` separately. | LLP 0164 owns the row; LLP 0097/0158 supply the class contracts without becoming duplicate acceptance trackers. |
| 7 — identity/authority | Partial | Wire production auth and complete revoked/stale authority plus later-effect-settlement fixtures for both fork classes. | LLP 0164 owns the per-class row closure; LLP 0097 and LLP 0158 remain the underlying class authorities. |
| 8 — resource containment | Partial | Add a digest-work limit plus replay-floor/envelope-window independent-clock corpus across reap/expiry and all declared resource limits. | LLP 0164 owns fork/promotion resource closure; joins to LLP 0163 clocks are inputs, not a second owner. |
| 9 — exact fork diff | Partial | Compare journal-derived net diff against the independent oracle; add a separate attributed-sequence oracle plus schema/system-field and multiple-commit coverage; separately prove full journal completeness. | LLP 0164 owns both diff surfaces, folding/substrate naming, and the independent net/sequence oracles. LLP 0165 owns only the generated-writer/SQLite-authorizer completeness leg. LLP 0158's attributed F0b receipt is input evidence, not the owner of exact-diff closure. |
| 10 — strict promotion | Partial | Complete concurrent-writer fairness/crash cuts, exhausted-budget and identical-write/divergent-read-or-result re-seal negatives, conditional-progress terms, provisional/transitive effect chains, and production contention constants. | LLP 0164. |
| 11 — history/checkpoint | Partial | Project finite history policy from schema declarations; complete per-version auth/pagination/horizon corpus and protected-copy erasure obligations. | LLP 0162 retains the record-history per-version authorization rule and its schema/pagination/horizon corpus; LLP 0165 owns the checkpoint custody/erasure leg. |
| 12 — boundary proof | Partial | Promotion and checkpoint proof paths are integrated; add migration boundary integration and the remaining concurrent-writer/publication/receipt-only negative corpus. | LLP 0165 owns the domain-separated proof contracts and closure across callers; LLP 0081/0164 callers supply inputs, not parallel definitions. |
| 13 — performance | Partial | The final-integrated absolute rerun is recorded. Run a genuinely paired/interleaved, baseline-digest-bound comparison with the public covered lane active; obtain dated RFC-author absolute-bound ratification; record p99 contention and every applicable crash/reopen gate. | Per-component single ownership: LLP 0163 for envelope/explanation metrics, LLP 0164 for fork/diff/promotion/reap and p99 contention, LLP 0165 for history/checkpoint/proof metrics. LLP 0162's author alone ratifies shared bounds/exceptions. |
| 14 — identity lifecycle | Partial | Wire first-party host job/cron/migration callers and transport-level client exclusion, then finish capacity/purge/current-authority negative fixtures beyond the landed promotion-ticket lease. | LLP 0163; the public-carrier ticket owns execution. |

### Dated LLP 0185 Phase 3 evidence (2026-08-05, derived-deployment class only)

Recorded here as input evidence for the owners above; no row state changes,
and none of this closes a row on its own.

- **Row 5 (fork isolation):** the derived post-fork-parent-write invisibility
  fixture now exists at two levels —
  `instance_fork::tests::parent_commits_after_the_fork_point_are_invisible_to_the_published_fork`
  (module) and `live_parent_writes_after_fork_point_never_appear_in_the_fork`
  (`tests/instance_fork_cli_v1.rs`, live-server bidirectional with diff
  attribution). Concurrent-lifecycle determinism (drop races one-winner,
  stale-registry completion, distinct-port simultaneous forks, SIGKILL and
  missing-ready outcomes) has dated tests in the same files.
- **Row 6 (effect quarantine):** the shared host-op gate
  (`deny_derived_fork_host_op`) is behaviorally tested per family, including
  manual cron, provider-adapter selection, and the named-op unclassified
  fail-closed rule. Open bypass negatives: push-receipt maintenance on a
  ledger-bearing fork; a VM-level JS-action fetch negative; `CaptureOnly`
  remains unimplemented for this class.
- **Row 7 (identity/authority):** live, stale, and revoked parent grant
  authority proven absent post-mint; bidirectional live-HTTP bearer replay
  (parent↔fork) proven refused with data-level no-commit checks. Production
  wired-auth legs remain open.
- **Row 8 (resource containment):** create admission (fork-count, per-fork
  bytes, total bytes), diff-work bound, and renewal max-lifetime cap all
  refuse deterministically with observed usage
  (`SNAPBACK_FORK_RESOURCE_LIMIT_REFUSED`); bounded renewal has a 7-cut
  crash-recovery matrix. Open: author ratification of the provisional limit
  constants; a true ENOSPC/disk-pressure simulation (not portably
  automatable — interrupted-copy behavior is covered by the 20-cut
  publication crash matrix instead); digest-work/replay-floor legs stay with
  their owners above.

The detailed LLP 0163 public-carrier work remains in its existing focused
ticket. The first F1 operating-guide and single-consumer fork-aware harness
slice landed on 2026-08-05; its remaining guide-gap/productization work stays
with `issues/20260803-guide-gap-instance-forks.md` and LLP 0185 rather than
being conflated with this acceptance tail.

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

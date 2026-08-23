# The landed fences' tests do not prove non-substitutability

Status: Open — 13 ranked findings, 4 Critical. Latent; no production route exercises them.
Created: 2026-08-22
Related: issues/20260822-claims-versus-enforcement-is-endemic.md,
issues/20260822-authority-publication-binding-design.md

## Why this ran

The claimed-structural defect class has now been confirmed five times, and in every case it
survived review because a test with a structural name proved only the correlated case. **The
tests are the transmission mechanism.** So rather than audit more code, this swept the tests
introduced by the six landed fence commits (`138d24164`, `1b0d76425`, `b441f87b7`,
`65ab481ad`, `556d18e07`, `860c2c2fd`, `261e595ad`, `6f39b50c0`) and asked one falsifiable
question per test:

> Construct the shortest mutation to the PRODUCTION code that violates the property the test's
> name claims, while leaving the test GREEN. If no such mutation exists, the test is
> discriminating.

That turns "this test looks weak" into a claim that can be checked. Thirteen tests failed the
question. Four are Critical, and the top three need **zero lines** of production change — the
bad pairing is already expressible, and every fixture simply happens to avoid it.

## The headline

**The entire split-phase authorized-effect race suite — 38 macro-generated tests plus two
primitive regressions — is green under a zero-line mutation.** Every fixture obtains the
resolved authority and its publication from the same bearer and immediately recombines them, so
each test runs A-with-A. Guarded sinks accept independently sourced values
(`mint_capability_link_with_authorized_effect`, `asset_delete_with_authorized_effect`), so
passing request authority B with reservation A validates B's identity while acquiring A's commit
guard — and all 38 stay green.

The audit is careful about what this does and does not mean, and so is this ticket:

> "The literal two-ordering behavior of these tests is valid; they are non-discriminating only
> when used as proof of non-substitutability."

The logout-wins/reservation-wins orderings really are tested. What was never tested is the
claim the suite has been cited for.

## Root cause is already designed, not yet built

Findings 1-4 are one defect: sinks and the capsule accept authority, reservation, and
destination as **separate arguments**, so correctness rests on callers passing correlated
values. That is precisely what
`issues/20260822-authority-publication-binding-design.md` specifies away, and its remedy
applies here verbatim: an opaque operation capability binding resolved authority, publication
reservation, and destination identity, so a sink cannot accept them separately.

Fixing the tests without that binding would only move the discipline from callers to fixtures.

## Scope note

No production route exercises the bad pairings today; every finding is latent. This is
fix-forward work, and the ranked list below is the work queue.

## Ranked findings

| Rank | Test | File:line | Claimed structural property | Shortest green mutation | Risk |
|---:|---|---|---|---|---|
| 1 | Split-phase authorized-effect race suite: 38 macro-generated tests plus two primitive regressions | `crates/snapback-server/src/server/tests.rs:31787`, `:32342`, `:33421`, `:33496`, `:33615` | The exact caller/session reservation governs the durable effect. | **Zero lines:** pass authority B and `AuthorizedEffectReservation` A to an existing guarded sink; every fixture uses matching A/A, so all tests remain green. | **Critical** |
| 2 | `bounded_commit_capsule_post_staging_barrier_is_invisible_and_unwind_safe` | `crates/snapback-server/src/server/tests.rs:37223` | Nothing staged can become durable except through the capsule’s final cut. | **Zero lines:** the transaction closure already receives full `&mut LocalSnapback`; it can commit through another Local API and return caller-minted `CommitAttempt::Committed`. | **Critical (latent)** |
| 3 | `bounded_commit_capsule_final_guard_refusal_rolls_back_and_drains_logout` and all `run_commit_capsule_prototype` tests | `crates/snapback-server/src/server/tests.rs:37421` | The authority checked by the final guard governs the database being committed. | **Zero lines:** the fixture already pairs prototype database B with caller authority A and merely verifies that guard A was observed. | **Critical (latent)** |
| 4 | `bounded_commit_capsule_during_commit_never_times_out_and_reconciles_exact_rows_only` | `crates/snapback-server/src/server/tests.rs:37596` | Only a real exact-row reconciliation can convert an ambiguous commit to success. | **Zero lines:** a reconciliation closure can return `ExactReconciliation::IntendedRows(value)` without querying anything; the test helper always performs the honest query. | **Critical (latent)** |
| 5 | Six asset proof compile-fail doctests used to support carrier opacity | `crates/snapback-kernel/src/services_assets.rs:16`, `:43`, `:67`; `crates/snapback-services/src/assets.rs:862`, `:880`, `:1140` | A valid kernel proof cannot be combined with caller-authored publication, continuity, or finalize fields. | **Zero lines:** use a real proof with public `into_prepared_variant` or `from_current_attempt` and supply arbitrary accompanying fields. | **High** |
| 6 | `watch_creation_refuses_retired_epoch_and_holds_the_guard_through_commit` | `crates/snapback-engine/src/local/admission_fence_tests.rs:1301` | Watch creation is fenced against retirement of its publication authority through commit. | Replace the session-authorized path with its mode-only guard; the test retires only the correlated admission epoch and remains green. | **High** |
| 7 | `asset_http_finalize_revalidates_moved_witness_and_retries_under_fresh_reservation` | `crates/snapback-server/src/server/tests.rs:33378` | A witness retry performs Phase C/D under a newly reserved caller effect. | Change `Some(authorized_effect)` to `None` at `engine.rs:13875`; the no-logout success fixture still passes. | **High** |
| 8 | `watch_reaction_ctx_push_send_without_caller_publication_commits` | `crates/snapback-server/src/server/tests.rs:25742` | The test identifies the structural “no caller publication carrier” case. | **Zero lines:** attach only a service publication; `has_fenced_publication()` ignores it, and the tested carrier-free fixture still passes. | **High** |
| 9 | Three width-convergence tests | `crates/snapback-engine/src/local/tests/engine.rs:11070`, `:11153`, `:11763` | Concurrent/stale width plans converge only on the exact immutable rendition bytes. | Remove digest equality from `width_publication_has_ready_rendition`; every fixture prepares identical bytes and remains green. | **High** |
| 10 | `permission_epoch_capacity_preflights_every_mutation_commit_seam` | `crates/snapback-engine/src/local/tests/engine.rs:31221` | Every mutation seam performs a functioning capacity preflight before commit. | Make `ensure_permission_epoch_capacity` at `engine.rs:31487` return `Ok(())`; all source-text assertions remain green. | **High** |
| 11 | `bounded_commit_capsule_post_commit_response_loss_and_retry_cannot_duplicate_effect` | `crates/snapback-server/src/server/tests.rs:38120` | Reusing an operation ID is safe only for the exact immutable intent/result/proof. | Remove the payload/result/proof comparisons in prototype replay; the test retries the identical intent, so it remains green. | **High (latent)** |
| 12 | `bounded_commit_capsule_known_rollback_drops_reservation_and_terminal_gate` | `crates/snapback-server/src/server/tests.rs:37492` | A `RolledBack` result proves that no effect committed. | **Zero lines:** the closure can commit through full Local and then return caller-minted `CommitAttempt::RolledBack`. | **High (latent)** |
| 13 | `asset_tus_authorized_ack_expiry_cleans_staging_before_terminal_refusal` | `crates/snapback-engine/src/local/tests/engine.rs:5030` | Expiry cleanup performs store I/O after releasing the caller publication reservation. | Move `drop(authorized_effect)` at `engine.rs:13475` below `delete_staging_pair`; the Dev-authority fixture has no publication permit and stays green. | **Medium** |

Audit base: `origin/main@27e6ce4e403afacf107506da1a53f2af66f0b638`. All scoped commits are ancestors. `1b0d76425` introduced no tests.

## Detailed findings

### 1. Authorized-effect tests never cross the wires

1. **Name/claim.** The logout-wins and reservation-wins names imply that the exact caller authority reserved before Local is the authority governing the later durable effect.

2. **Body constraint.** Every helper obtains the resolved authority and publication from the same bearer and immediately recombines them; for example, `prepared_test_session_route_authority` does so at `server/tests.rs:31299-31321`. The immediate-push and asset fixtures likewise reserve and commit with the same authority.

3. **Green mutation.** No production change is required. Guarded sinks accept independently sourced values, for example:

   - `mint_capability_link_with_authorized_effect(authority, ..., authorized_effect)` at `engine.rs:5339-5372`.
   - `asset_delete_with_authorized_effect(authority, ..., authorized_effect)` at `engine.rs:15304-15317`.

   Passing request/authority B with reservation A validates B’s identity while acquiring A’s commit guard. Every existing A/A race test remains green.

4. **Discriminating change.** Add an adversarial A/B test for each shared sink shape: prepare authority B, reserve A, retire A or B independently, and require typed refusal before any write. The durable fix is an opaque operation capability that binds resolved authority, publication reservation, and destination identity so the sink cannot accept them separately.

The literal two-ordering behavior of these tests is valid; they are non-discriminating only when used as proof of non-substitutability.

### 2. Capsule staging is protected only by closure discipline

1. **Name/claim.** The post-staging barrier test claims staged work stays invisible and unwind-safe until the final cut.

2. **Body constraint.** Its cooperative prototype closure creates the intended pending transaction and calls `FinalCommitCut::commit`.

3. **Green mutation.** The capsule passes full `&mut LocalSnapback` to caller code at `commit_capsule.rs:564-570` and accepts free `CommitAttempt::Committed` at `:653-658`. A closure can use another Local commit API and return `Committed` without consuming the final cut. The existing cooperative test is unaffected.

4. **Discriminating change.** Give the closure a restricted staging capability rather than full Local, and make committed outcomes constructible only by `FinalCommitCut`. Add a malicious closure compile-fail test, or a runtime test proving a direct Local commit is unavailable.

### 3. Capsule authority and destination are already foreign

1. **Name/claim.** The “final guard” is implied to guard the transaction that follows it.

2. **Body constraint.** `CommitCapsulePrototypeDatabase` creates one independent `SharedSnapback` at `server/tests.rs:36468`; `CommitCapsuleCallerFixture` creates another `AppState` and authority at `:36513`. The test supplies database B and authority A, then checks only that the observed guard equals A.

3. **Green mutation.** Zero lines: the test body is itself the foreign pairing. `with_bounded_commit_capsule` independently accepts `state` and `authority` at `commit_capsule.rs:558-563` and never verifies a common owner.

4. **Discriminating change.** First make the ordinary fixture use authority and database from the same application. Then add an explicitly foreign A/B case that must refuse without staging. Structurally bind the destination/controller identity into the capsule authority or reservation.

### 4. Exact reconciliation trusts a named enum variant

1. **Name/claim.** Only exact intended rows may resolve an ambiguous commit as success.

2. **Body constraint.** The helper at `server/tests.rs:36858-36875` always executes the actual exact query before returning `IntendedRows`. The four cases test honest rows-present, rows-absent, and partial-row answers.

3. **Green mutation.** Zero lines: `ExactReconciliation::IntendedRows` is freely constructible at `commit_capsule.rs:45-49`, and the capsule trusts it at `:688-693`. A lying closure can return it unconditionally.

4. **Discriminating change.** Supply a deliberately lying reconciliation closure and require that it cannot produce success. The real fix is a sealed exact-reconciliation proof minted by the kernel query, not a caller-selected result enum.

### 5. Asset compile-fail tests reject the correlated forgery only

1. **Name/claim.** The accompanying documentation says opaque carriers prevent a higher adapter from combining a valid token with caller-authored fields.

2. **Body constraint.** The doctests try private struct literals, raw publication records, or a proof from the wrong nominal domain. Those cases correctly fail to compile.

3. **Green mutation.** Zero lines. `AssetWidthPublicationPlannedProof::into_prepared_variant` is public and accepts caller-supplied key, width, digest, length, content type, and recipe version at `services_assets.rs:86-104`. `AssetTusPatchTicketV1::from_current_attempt` accepts caller-supplied new offset/checksum/store at `assets.rs:1008-1023`; `FinalizePrepareTicketV1::from_current_attempt` accepts caller-supplied request, intent, store, flags, app, quota, and schema at `:1352-1378`.

4. **Discriminating change.** Add external-boundary tests that start with a genuine proof and try to alter one bound field. Constructors must derive those fields from the proof or be private to the component that performed the validating transaction.

The literal field-privacy doctests are sound; they do not discriminate the broader carrier claim.

### 6. Watch creation tests mode retirement, not publication retirement

1. **Name/claim.** The name says watch creation refuses a retired epoch and holds “the guard” through commit; in the fence program this is used as evidence for publication fencing.

2. **Body constraint.** The test retires only the admission epoch through the admission-effect hook, checks an unchanged database image on refusal, and checks a successful fresh mode-guard commit. It creates no real session publication and never starts logout.

3. **Green mutation.** Route session-backed watch creation through the mode-only sibling. The exact admission epoch still refuses at the same cut, so this test remains green while logout/publication fencing is absent.

4. **Discriminating change.** Use a real Sessions authority and bearer. Pause before reservation and after reservation in separate cases, start logout, and assert respectively: no watch commits, and logout cannot reach its terminal write until the watch commit releases its reservation.

### 7. Fresh witness-retry reservation is not observed

1. **Name/claim.** The finalize retry uses a fresh authorized-effect reservation after witness revalidation.

2. **Body constraint.** The test moves the witness, sends a still-authorized request, and asserts a successful ready asset. It does not retire the authority between revalidation and retry and does not observe a second reservation.

3. **Green mutation.** Change `Some(authorized_effect)` to `None` at `engine.rs:13875`. The retry becomes mode-only, but the success-only fixture remains green.

4. **Discriminating change.** Pause after witness revalidation and before the retry reservation, complete logout, then require refusal with no Phase C/D commit. Add the complementary reservation-first ordering and require logout to drain behind the retry commit.

### 8. “No caller publication” checks only one carrier field

1. **Name/claim.** The watch-reaction test claims its authority has no caller publication carrier and therefore follows the mode-only path.

2. **Body constraint.** It calls `has_fenced_publication()` and then verifies a zero-target push intent commits.

3. **Green mutation.** Zero lines: `has_fenced_publication` returns only `self.publication.is_some()` at `invocation.rs:1534-1540`; it ignores `service_publication`, which can be installed independently at `:1542-1544`.

4. **Discriminating change.** Replace the boolean with an exhaustive carrier classification, or inspect both carrier fields. Add a service-publication-only fixture, retire that service authority, and require the authorized branch to refuse.

### 9. Width convergence never introduces divergent bytes

1. **Name/claim.** Concurrent and stale plans converge on the exact winning rendition rather than merely something correlated by width or recipe.

2. **Body constraint.** All three tests render the same source, width, recipe, and bytes, so every prepared rendition has the same digest.

3. **Green mutation.** Remove prepared/publication/blob digest equality from `width_publication_has_ready_rendition` at `asset_attempts.rs:251-293`, retaining only width/recipe matching. All three fixtures still converge and remain green.

4. **Discriminating change.** Arrange two valid preparations for the same width with different digests. The loser must not be treated as converged, must not bypass quota, and must not publish the winner’s row as proof of its own bytes.

### 10. Capacity “preflight” is a source-shape assertion

1. **Name/claim.** Every named mutation seam executes a functioning permission-epoch capacity check before its commit.

2. **Body constraint.** The test reads `engine.rs` as text, finds four function bodies, and checks for the string `ensure_permission_epoch_capacity`; wrapper checks similarly look only for inner-function and enum names.

3. **Green mutation.** Make `ensure_permission_epoch_capacity` at `engine.rs:31487` return `Ok(())`. Every searched token remains present.

4. **Discriminating change.** Exhaust or fault-inject permission-epoch capacity at each seam and assert a typed refusal plus byte-identical durable state. The source-shape check can remain only as a secondary coverage inventory.

### 11. Replay tests only identical input

1. **Name/claim.** The retry is safe because a repeated operation ID denotes the exact immutable operation and cannot duplicate or substitute an effect.

2. **Body constraint.** The retry at `server/tests.rs:38199-38218` reuses an unchanged cloned intent.

3. **Green mutation.** Remove payload, response, or proof equality from replay validation at `commit_capsule_prototype.rs:95-117` while retaining operation-ID deduplication. The identical retry remains green.

4. **Discriminating change.** Retry the same operation ID with one changed payload field, then separately with changed response/proof identity. Each must return an idempotency conflict and leave the original rows unchanged.

### 12. Known rollback trusts the caller’s label

1. **Name/claim.** A `RolledBack` capsule outcome means the effect definitely did not commit, allowing permits and the terminal gate to reopen.

2. **Body constraint.** The injected helper honestly calls `pending.rollback()` and then returns `CommitAttempt::RolledBack`.

3. **Green mutation.** Zero lines: because the closure has full Local and constructs `CommitAttempt` itself, another closure can commit and then report `RolledBack`. The honest test remains green.

4. **Discriminating change.** Make `RolledBack` a sealed result of the kernel pending value or final cut. Add a lying closure case; it must be impossible to construct or must remain fail-closed/uncertain.

### 13. TUS cleanup uses Dev authority

1. **Name/claim.** Authorized acknowledgement expiry releases caller authority before slow physical cleanup and terminal refusal.

2. **Body constraint.** The test uses `asset_dev_authority`, whose reservation is the `DevMode` variant. It verifies expiration, refusal, and deleted staging bytes, but there is no session publication permit whose lifetime could be observed.

3. **Green mutation.** Move `drop(authorized_effect)` at `engine.rs:13475` after `delete_staging_pair` at `:13477`. With Dev authority, the test behaves identically.

4. **Discriminating change.** Use real session authority, block `delete_staging_pair`, and start logout. Logout must reach terminal state before the blocked cleanup is released.

## Unenforced production claims

- `crates/snapback-sync/src/auth/coordinator.rs:398-405` says resolved authority and publication form the final exact cut, yet `PreparedAuthority::with_fenced_publication` accepts any publication without identity validation at `invocation.rs:1527-1531`.

- `crates/snapback-engine/src/local/engine.rs:3258-3265` calls the service fence “exact” and non-substitutable, yet `with_service_publication` accepts an independently sourced publication at `invocation.rs:1542-1544`.

- `crates/snapback-sync/src/auth/invocation.rs:1225-1229` describes an owned complete authority bundle, but guarded sinks accept a second `PreparedAuthority` separately from the reservation; examples are `engine.rs:5339-5372` and `:15304-15317`.

- `crates/snapback-sync/src/auth/invocation.rs:1534-1537` documents the predicate used to decide whether an authorized-effect reservation is needed, while the implementation at `:1538-1540` ignores service publication.

- `crates/snapback-kernel/src/services_assets.rs:1-5` says a higher adapter cannot combine a valid token with caller-authored fields. The public conversion at `:86-104` and public factories at `crates/snapback-services/src/assets.rs:1008-1023` and `:1352-1378` directly permit that combination.

- `crates/snapback-server/src/server/commit_capsule.rs:8-14` says exact reconciliation and a kernel-supplied pending value are the only commit route. The capsule instead exposes free outcome enums at `:38-49`, full Local at `:564-570`, and trusts those outcomes at `:653-669` and `:688-693`.

- `crates/snapback-server/src/server/commit_capsule.rs:91-107` requires `PendingCommit::commit` not to validate, re-enter Local, or do anything except commit. Nothing in the trait enforces those behavioral restrictions.

- `crates/snapback-server/src/server/commit_capsule.rs:475-478` asserts that a final cut can be consumed only once. If rollback fails on deadline or guard refusal, `:484-505` returns without setting `disposition`, so a second call is accepted.

## Tests that are discriminating for their literal claims

- The ten mode-epoch tests at `admission_fence_tests.rs:784-1035` retire the exact captured epoch at the production guard hook and compare durable state. Removing the corresponding site guard makes each fail. They do not establish publication fencing, but their stated mode-retirement properties are sound.

- `durable_commit_observer_rejects_a_foreign_guard_when_the_target_guard_is_absent` at `admission_fence_tests.rs:1410` uses a genuinely foreign guard and directly observes the mismatch. It discriminates the stated destination-guard property.

- `client_mutation_acknowledgement_service_branch_stays_mode_only` at `server/tests.rs:31828` verifies both the resolved service branch and non-arrival at the authorized-reservation pause. Switching that branch to the authorized sibling makes it fail.

- `asset_finalize_grades_honestly_and_verifies_declared_digests` at `engine.rs:9451` discriminates the current route grader’s three literal outcomes. Mutating the actual checksumless, verified, or mismatch grading changes its assertions. It does not prove constructor opacity; that separate gap is finding 5.

- The asset lease and cleanup race tests that create real sibling publications, active PUT leases, expired plans, or torn rows are discriminating for their literal retention/deletion outcomes. In particular, removing the lease wait or exact sibling-row checks changes the observed blob/row state.

- The capsule timeout, cancellation, panic-retention, and guard-refusal tests not listed above use real barriers plus row, permit, retention, or commit-receipt observations. They discriminate their specific control-flow outcomes; they simply do not repair the capsule’s caller-trust and identity-binding gaps.
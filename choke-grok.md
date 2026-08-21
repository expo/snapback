I'll start by reading the design skill and the governing LLPs so the document answers the chokepoint decision, not a relocated assertion.I'll load the writer/reviewer personas and set up the scratch artifact paths, then launch the first writer.I'll start by reading the governing LLPs and locating the live authority-creation sites so the design is grounded in the actual code, not the prose.Writer subagent launched. Waiting on the first draft of the chokepoint design.Next I’ll locate the exact LLP files and related issues, then read them in full.The `lane/f1-forge` worktree is at `/Users/ccheever/projects/snapback-lanes/f1-forge`. I’ll read the required LLPs in full next.LLP 0291 and 0285 are in. Next I’ll read 0283, 0214, 0225, 0284 and inspect the in-flight `f1-forge` tree.I’ll now read the live kernel APIs, the `f1-forge` `ResolvedPrincipal` work, and the remaining governing LLP sections.I’ll verify the inventory’s cited insertion sites in the live tree and read the remaining LLP 0214/0225 sections.I’ll verify the live insertion and minting sites on the chokegrok tree so every line citation is exact.I’ll keep verifying the live writers, `ResolvedAppAuthority`, membership, and the `config.verify` System path.I have the inventory, the live writers, and the `f1-forge` delta. Next I’ll write the design and the summary to the two assigned paths.The writer is still researching the inventory and live code; I’ll wait for the draft to land.Design document and summary are written (no repo files changed, nothing compiled).

**Recommendation: chokepoint yes, modified.** Adopt LLP 0291’s `KernelVerifiedEvidence` / `commit_verified_authority_transition` *inside* the kernel; do not put evidence in a public signature. A public evidence parameter is the fifth “failure moved one API earlier” costume.

**Why a smaller change fails.** Session insertion is already private (`auth_identity.rs:990`, `auth_catalog_ops.rs:2112`) and the 30 no-feature families still compile. `lane/f1-forge`’s public `ResolvedPrincipal` is minted from a `TokenDigest` (digests already leak via `session_issuance_facts`) and would add surface rather than replace it. Keep f1-forge’s real fixes (step-up re-derivation, approver binding, clock floors, loaded policies); discard that public type.

**Chokepoint:**

```rust
pub(crate) fn commit_verified_authority_transition(
    tx: &rusqlite::Transaction<'_>,
    evidence: KernelVerifiedEvidence,
    mutation: AuthorityMutation,
) -> SnapbackResult<AuthorityTransitionOutcome>
```

Force is SQL confinement: AuthorityFacts `INSERT`/`UPDATE` live in one module. Higher crates get closed `ServingDatabase` ceremonies that take bearers/passwords/codes, not IDs. A second constructor chokepoint kills in-memory `ResolvedAppAuthority::System`.

**Biggest residual:** LLP 0284 cannot prove possession proofs or purpose correspondence (syn + metadata + rustc spans; no rustdoc JSON on 1.97.0). Publication still requires cutting digest-leaking readers, `auth_database_mut`, `test-support` inserts, and `System`.

**Honest cost:** ~15 PRs, test-rewrite dominated, larger than “convert four admissions”; schemas/ drift stays zero. `config.verify` must not mint `System` (already admin-gated, then thrown away). Protected erasure fails closed without an owner token-file anchor.Design document drafted. Starting review.I'll start by reading the design document, writer summary, and governing LLPs so I can verify claims against the live tree.Reviewer is running. I’ll read the draft now so I can count issues and check the PR plan as soon as the review lands.The design doc looks truncated at PR 11. I'll read the rest and start verifying the live-tree citations.Draft is ~1,045 lines. Waiting on the reviewer to finish verifying claims against the tree.I'll verify the design's file:line claims and crate graph against live code, then check the governing LLPs and f1-forge.I have enough live-tree evidence. Next I’ll write the structured review notes to the specified path.Review notes are at `/var/folders/4_/6m2cbnz54r34g_k18rxs7h800000gn/T/grok-501/grok-design-review-fb7767ce.md`.

**Verdict: needs revision.** Rejecting a public `KernelVerifiedEvidence` parameter is the right anti-relocation move, and a crate-private write gate plus a second in-memory constructor gate is the right shape. The draft is not implementable as a chokepoint. `AuthorityMutation` is unspecified, several live claimable roots stay public or are KEEP’d from `lane/f1-forge` (`admit_user_push`, `LoadedFunctionPolicyPublisher`, `PreparedPasswordVerification.verified`), Layer A is an INSERT-literal ratchet rather than a force, and the PR plan never converts protected erasure or pending-effect decision. Implemented as written, the failure would move to the weakest public ceremony, the generation publisher, and whatever exact-claim type engine can still construct.Reviewer found issues. I’ll read the notes, count severities, and send the writer back with every open finding.Reviewer found 13 issues (3 critical, 7 major, 3 minor). Resuming the writer to revise.I’ll read the review in full, then verify every cited live-code claim before revising the design.I’ll verify the reviewer’s citations and fill the unspecified mutation, ceremony, and claim-type details before editing.I have the live citations. I’ll revise the design so Layer B/C actually close the roots, drop S2, and specify the mutation matrix, ceremonies, and DAG placement.I’ll apply the critical structural fixes first, then fill in the mutation matrix, ceremonies, DAG choice, and PR-plan rewrite.All 13 review issues are **addressed** in the design (none wontfix). Recommended answer is unchanged: **modified crate-private chokepoint**.

What changed in r1:

- **Attacker C force is Layer B+C**, not an SQL scanner. Layer A is `pub(in crate::storage::authority_transition)` helpers plus an expanded I-17 (UPDATE / `INSERT OR IGNORE` / dynamic `format!("INSERT INTO`) and the full AuthorityFacts set).
- **S2 is gone** — no synthesized evidence for still-public callers.
- **Weaker roots cut:** all three `admit_*_push`; public `LoadedFunctionPolicyPublisher`; `PreparedPasswordVerification.verified`; constructible exact-claims; guest bearer vs grant/watch (class gate + kernel budget).
- **`AuthorityMutation` + purpose×mutation matrix** and **ceremony signatures** are specified.
- **DAG option (a)** picked (kernel opaque claims → sync `prepare_from_*`; `ResolvedAppAuthority` `pub(crate)` in sync). **Not compiled.** Fallback (b) if (a) fails.
- **Pending-effect and OwnerAnchor erasure are PR 9**, not positions without work.
- **PR plan is 13 PRs:** import after issuance; constructor after session+watch cuts; factory ids stay expected-red; does not claim the 0291 `exists e` formula.Revisions applied. Running re-review.I'll read the updated design, writer summary, and the review file with responses, then re-verify any claims against live code.The r1 draft is much longer. I'll read the mutation matrix, ceremony table, DAG, lanes, and PR plan next.I'll verify the new r1 citations and the `pub(in path)` visibility claim — that one looks like it may not be legal Rust.Re-review is at `/var/folders/4_/6m2cbnz54r34g_k18rxs7h800000gn/T/grok-501/grok-design-review-fb7767ce.md`.

**Verdict: needs revision.** r1 fixed the original thirteen issues (S2 gone, weaker roots in the cut list, erasure/pending-effect sequenced, PR 13 does not paint factory ids green, guest class+budget). Three holes remain:

1. `pub(in crate::storage::authority_transition)` is illegal Rust — `path` must be an ancestor, not a sibling.
2. The purpose×mutation tables disagree (missing enum variants; `!Clone` evidence vs `+` multi-mutations; id payloads).
3. System-class claims still wrap a boolean (`admin::authorize` → `Result<(), ApiError>` at `admin.rs:4079`) and public `claim_manual_cron_run` (`engine.rs:22106`).

Until those mints are real possession/durable-row proofs, this still moves WHERE System is obtained rather than removing the ability.Re-review (round 2) found 3 major issues. Resuming the writer.I’ll read the new review notes and verify the cited live APIs before revising the chokepoint, mutation matrix, and System-claim design.I’ll pick nested mods under `authority_transition` (legal Rust), make purpose and mutation 1:1, and stop treating `authorize()`’s `Ok(())` as a claim mint.All three remaining majors are **addressed**. Recommended answer is unchanged: crate-private chokepoint.

1. **`pub(in sibling)` is illegal.** SQL lives as nested modules under `storage/authority_transition/` with `pub(super)`. RFC 1422: `pub(in path)` needs an ancestor; `auth_identity` is a sibling (`storage.rs:153`). The other two visibilities are deleted from the spec.

2. **purpose×mutation is 1:1.** Same discriminants; one composite `commit` arm per purpose (`!Clone` evidence moved once). `StepUp` is a `ProofKind`, not a purpose. Principal/session ids come from evidence, not mutation payloads.

3. **System-class mints.** `admin::authorize` is `Result<(), ApiError>` (`admin.rs:4079`) — do not wrap `Ok(())`. `begin_config_verify` hashes the presented admin secret. No public `OwnerAnchor` (erase proves internally). No `CronWorkClaim`: jobs table is `_snapback_jobs_v1` (`jobs.rs:315`), cron is `LocalCronRuntime`; delete `claim_manual_cron_run` (`engine.rs:22106`) as System; remaining cron System is a publication blocker. Jobs use `claim_due_job` CAS on `current_claim_id`.Revisions applied. Re-review (round 3).I'll read the r2 design, summary, and writer responses, then verify the three claimed fixes against live code.I'll read the r2 mutation matrix, Layer A, ceremonies, DAG, and PR plan next.Re-review is at `/var/folders/4_/6m2cbnz54r34g_k18rxs7h800000gn/T/grok-501/grok-design-review-fb7767ce.md`.

**Verdict: approve (0 open issues).** r2 actually closed the three remaining majors: nested `authority_transition/**` with `pub(super)` is legal Rust; purpose and mutation are 1:1 composites with ids on evidence; System-class paths hash `AdminWriteSecret` or CAS `_snapback_jobs_v1.current_claim_id`, with no public `OwnerAnchor` / `CronWorkClaim` / wrap of `claim_manual_cron_run`. Cron System stays a named publication blocker, not a relocated mint. The class is closed up to the residuals the document already names.Review passed with 0 issues. Finalizing: I’ll confirm the review file, then extract Key Decisions, Open Questions, and the PR Plan.Review passed with 0 issues. The design is at the artifact path below. Three product questions remain; answering them will be written into the document.The design is written. Nothing in the repository was changed.

**File:** [`/var/folders/4_/6m2cbnz54r34g_k18rxs7h800000gn/T/grok-501/grok-design-doc-fb7767ce.md`](/var/folders/4_/6m2cbnz54r34g_k18rxs7h800000gn/T/grok-501/grok-design-doc-fb7767ce.md)

**Answer:** a chokepoint is the right class-level fix. A smaller change does not close it. Do **not** ship LLP 0291’s public `commit_verified_authority_transition(tx, evidence, mutation)` packaging — a public evidence parameter is the fifth “failure moved one API earlier” costume. Evidence and the commit function stay `pub(crate)`. Rank ≥ 2 crates see only closed `ServingDatabase` ceremonies that take secrets, mint evidence inside the kernel, and commit.

Trees analyzed: this workspace at `86d6a8554` and `lane/f1-forge` at `67cdb9a1e`. **Nothing in the design was compiled.**

---

## Key decisions

1. **Chokepoint, not a 46-row checklist.** Independent writers of indistinguishable authority rows plus independent in-memory constructors. Session insertion is already private (`auth_identity.rs:990`, `auth_catalog_ops.rs:2112`) and the 30 no-feature families still compile.

2. **UNNAMEABLE internally, POWERLESS publicly.** `KernelVerifiedEvidence` has private fields, no `Clone`/`Default`/`Deserialize`/`From`/`FromStr`, no public constructor, no `verified` boolean. Bound to database identity, predecessor, subject, purpose, clock floor, store version, and `ProofKind`.

3. **Attacker C is closed by Layer B + Layer C, not by an SQL scanner.** Layer B cuts public writers. Layer C cuts constructible in-memory authority. Layer A is a ratchet: SQL lives as nested modules under `storage/authority_transition/` with legal `pub(super)`. Sibling `pub(in crate::storage::authority_transition)` is illegal Rust (RFC 1422).

4. **No S2.** Moving SQL while public callers still mint evidence is an internal `from_plan`. SQL move + public cut + compile-fail fixture are one merge.

5. **Two chokepoints.** Durable writes go through `commit_verified_authority_transition`. `PreparedAuthority` is minted only from kernel-opaque session/job/watch claims (DAG option (a), **not compiled**). Closing only SQL leaves U30; closing only constructors leaves U03–U29.

6. **Purpose-bound evidence and subject-class gates.** Guest-create evidence cannot write grants. A guest *bearer* cannot satisfy grant/watch/capability/effect-approve. Purpose-lock without the second check is a relocated mint.

7. **Possession proofs are secrets.** `SessionBearer`, `PasswordSecret`, recovery plaintext, verification codes, admin secret, owner-only directory. Not `TokenDigest`, user id, `verified: bool`, or `PreparedPasswordVerification.verified` (`auth_identity.rs:168–170`).

8. **Every public fact-assertion type obeys the same privacy rules.** Delete all three `admit_*_push` methods (`storage.rs:1405–1416`). Discard public `LoadedFunctionPolicyPublisher` / `install_loaded_function_policies`. No public `CronWorkClaim`, `OwnerAnchor`, or `ConfigVerifyClaim`. Wrapping `admin::authorize`’s `Ok(())` (`admin.rs:4079`) is a renamed `verified: bool`.

9. **Keep f1-forge’s real fixes; discard its public types.** Keep step-up re-derivation, in-transaction approver revalidation, clock floors, generation-commit policy install as a side effect, `#[cfg(test)]` demotion of the one insert. Discard public `ResolvedPrincipal` and the public publisher. Do not merge those types to `main`.

10. **`config.verify` hashes the presented admin secret.** Do not mint `System`. Protected erasure proves owner internally and fails closed with no caller digest. Cron has no kernel due-row (`LocalCronRuntime` vs `_snapback_jobs_v1`); **no `CronWorkClaim`**; `claim_manual_cron_run` (`engine.rs:22106`) is deleted as System; remaining cron System is a **publication blocker**. Jobs CAS `_snapback_jobs_v1.current_claim_id`.

11. **Zero `schemas/` drift.** Evidence is in-memory. Guest budget maps onto existing `AuthBudgetName::SessionMint`.

12. **LLP 0284 cannot prove the 0291 invariant.** syn + `cargo metadata` + rustc span assertions can compile-fail unnameable evidence, gone plan structs, `System`, `MembershipWriter::Admin`, and I-17 stray SQL. They cannot prove that a mint hashed a secret or that `purpose(e) = purpose(w)` in the body. That residual is carried, not claimed as proof. Defect-2 factory ids stay expected-red.

Internal chokepoint:

```rust
pub(crate) fn commit_verified_authority_transition(
    tx: &rusqlite::Transaction<'_>,
    evidence: KernelVerifiedEvidence,  // moved, !Clone
    mutation: AuthorityMutation,       // 1:1 with AuthorityPurpose; composite writes
) -> SnapbackResult<AuthorityTransitionOutcome>
```

---

## Review

3 review–revise rounds, then 0 open issues.

| Severity | Count across rounds |
|---|---|
| critical | 3 |
| major | 10 |
| minor | 3 |

Round 1 killed public evidence-as-token leftovers, S2 synthesized evidence, unspecified `AuthorityMutation`, missing lanes, and PR-plan overclaim. Round 2 killed illegal `pub(in sibling)`, the non-1:1 purpose×mutation table, and System-class claims that wrapped a boolean or a job name.

---

## PR Plan (13 PRs)

Each stage: `cargo check --all-targets --workspace` green, `schemas/` drift zero. One worktree for PRs that touch `auth_identity.rs` / `auth_catalog_ops.rs`. Each table-family PR is SQL move + public cut + compile-fail fixture.

| PR | Title | Depends on |
|---|---|---|
| 1 | crate-private evidence, mutation, report-only I-17 | — |
| 2 | session-issuance cut (not a “security win”) | 1 |
| 3 | delete public `verified` booleans; server-generate challenges | 2 |
| 4 | budget and class-gate `guest_create`; proof on recovery rotate | 2 |
| 5 | bearer-seal pairing, grants, OAuth | 3, 4 |
| 6 | chokepoint watches/links; policies from generation commit | 4, 5 |
| 7 | operator-seal import/restore/leases; unname provisioning | 2 |
| 8 | opaque `PreparedAuthority`; delete public `prepare_admitted_authority` | 2 **and** 6, not 1 alone |
| 9 | bearer `decide_pending_effect`; internal-proof erasure; delete `admit_*_push` | 8 |
| 10 | derive `MembershipWriter`; stop caller-selected Admin | 8 |
| 11 | stop leaking live `TokenDigest`s; delete `auth_database_mut` | 2 |
| 12 | confine AuthorityFacts test inserts to `cfg(test)` | 2–7 |
| 13 | forgery-half attack ids fail; factory ids stay expected-red | 2–12 |

PR 13 does **not** claim the 0291 `exists e` formula is proved and does **not** paint `auth-commit-reservation-factory` / `auth-commit-prepared-factory` / `service-interlock-factory` green. npm stays blocked unless you later explicitly want LLP 0285 §6 “step 6 at the earliest” with defect 2 and cron System still open.

Honest cost: **three to six weeks** on continuously-moving `main`, test-rewrite dominated. Calendar is a guess; unverified.

---

## Open questions (no interactive answers; document defaults)

This session could not collect author choices. The document already encodes defaults; they are **not** confirmed rulings:

1. **Rehearsal** — default: **seal, do not delete** (`auth_rehearsal_mint` under operator/non-prod claim).
2. **Deref** — default: **demote leaking methods first**; leave Deref unless a follow-up proves it is required.
3. **config.verify / trust-anchor / publication** — default: hash the presented admin secret; erasure fail-closed; cron System is a publication blocker; defect-2 factory ids stay expected-red.

Say if you want different product wording; the engineering sequence for PR 9 does not wait on that to specify the chokepoint.

---

The class closes, up to those residuals, when rank ≥ 2 cannot compile an unverified AuthorityFacts write, cannot construct `System` / `AdminBypass` / `MembershipWriter::Admin`, cannot hold a generation publisher or `admit_user_push`, and cannot use a guest bearer as grant/watch proof. Until PR 13, F-1 and npm stay blocked. A wrong answer shipped cannot be withdrawn (LLP 0041).

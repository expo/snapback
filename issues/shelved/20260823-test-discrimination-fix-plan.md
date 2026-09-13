# Fix plan: the test-discrimination findings not blocked on authority binding

Status: Open — plan complete, implementation not dispatched
Created: 2026-08-23
Related: issues/shelved/20260822-landed-fence-tests-do-not-prove-non-substitutability.md (the audit),
issues/shelved/20260822-rustdoc-compile-fail-error-codes-are-not-enforced.md,
issues/shelved/20260822-authority-publication-binding-implementation-plan.md (Step 5 owns findings 1-4, 11-13)

## Status of the four findings, rechecked at `3b3eb826`

- **#5, #7, #9 remain fully real.** The green mutations still compile against current `main`.
- **#10 is partially refuted.** The named test is still weak, but its global no-op mutation is
  already caught behaviourally at **three of four** seams — so the remaining exposure is one seam,
  not the whole claim. Worth knowing before anyone spends a lane on it.

## The finding that changes the approach

**#5 cannot be repaired test-only.** The six asset compile-fail doctests claim a valid kernel proof
cannot be combined with caller-authored fields, and three public factories still accept exactly
that: `into_prepared_variant` takes caller-supplied key/width/digest/length/content-type/recipe,
and both `from_current_attempt` variants take a real proof plus caller-authored continuity, store,
request, policy, app, quota, and schema.

The fix is a production move: carrier construction for the TUS, width, and finalize families
relocates into a private engine asset-carrier module, because `LocalSnapback` is the only component
that jointly observes the kernel proof, validated request, configured store, app identity, quota,
and schema. The finalize family must move **as a unit** — later carriers embed
`FinalizePrepareTicketV1`, so leaving one public service constructor behind preserves the bypass.
Roughly **3-5 engineer-days**, which is worth knowing before it is mistaken for test cleanup.

## The better enforcement mechanism, which already exists

I told the planner that pinned rustdoc codes are not enforcement, since rustdoc ignores
`compile_fail,E####` entirely. Rather than inventing something, it found the repo already has the
right tool: `scripts/check-security-boundaries.mjs` compiles fixtures with rustc JSON output and
requires the expected code's **primary span to overlap `@attack`**.

So the six doctests migrate to inventoried external fixtures, three new fixtures take **genuine
proof types as parameters** and attempt the currently-valid raw constructions, and the
privilege-surface seed/factory registry is extended so that **adding the same bypass under a new
public method name also fails the gate**. That last part closes the "guards one spelling" weakness
found separately in the stream work. Doctests remain as documentation, not as cited structural
evidence.

**Fail-first requirement, carried from the plan:** before the production change, confirm the three
genuine-proof attack fixtures report `attack compiled`; only after sealing should their pinned
rustc diagnostics and spans pass.

## #7 — fresh finalize witness-retry reservation

The finding is still real; the audit’s line moved. The retry currently passes the reservation at [engine.rs:13924](crates/snapback-engine/src/local/engine.rs:13924). Changing that argument to `None` still selects all unguarded Phase C/D storage calls at [engine.rs:14355](crates/snapback-engine/src/local/engine.rs:14355), [engine.rs:14407](crates/snapback-engine/src/local/engine.rs:14407), and [engine.rs:14506](crates/snapback-engine/src/local/engine.rs:14506). The existing test at [server/tests.rs:33517](crates/snapback-server/src/server/tests.rs:33517) asserts only eventual HTTP success.

### Fix

Retain the success fixture, but stop treating it as reservation evidence. Add two targeted tests around the distinct retry reservation at [asset_routes.rs:314](crates/snapback-server/src/server/asset_routes.rs:314):

1. `...fresh_retry_guard_refusal_prevents_phase_d`

   Arm only `"asset finalize witness-retry reservation"` with a test-support commit-guard refusal. Move the witness, issue finalize, and require the typed refusal. Assert the asset remains non-ready and Phase-D rendition/quota/receipt state is unchanged; initial Phase-C staging is allowed.

2. `...fresh_retry_guard_lives_through_phase_d_commit`

   Give the retry reservation a unique test marker and scope probe. Add a one-shot kernel test hook inside `asset_attempts_transaction_guarded`, after `tx.commit()` but before `_commit_guard` drops—the relevant lifetime is visible at [asset_attempts.rs:353](crates/snapback-kernel/src/storage/asset_attempts.rs:353). Assert the marked retry guard is active at that point and inactive after return.

The existing reservation test-support hooks at [invocation.rs:1251](crates/snapback-sync/src/auth/invocation.rs:1251) are the right place to add the marker/scope probe. Configure it through the route’s test-only reservation helper at [asset_routes.rs:26](crates/snapback-server/src/server/asset_routes.rs:26).

Mutation audit:

- `Some(authorized_effect) → None` fails both tests.
- Acquiring a dummy guard and dropping it before the unguarded commit may satisfy the refusal test, but fails the post-COMMIT lifetime probe.
- Reusing an earlier reservation fails the retry-specific marker check.
- The shortest remaining green rewrite must hold the marked fresh retry guard across the same Phase-D commit, which satisfies the property.

Fail-first requirement: apply the exact `Some → None` mutation and watch both new tests fail.

Classification: **no release-path production change**, but test-support code is required in production crates under `cfg(test/test-support)`. Medium, 1–2 days.

## #9 — width convergence on exact bytes

The mutation remains real. All three fixtures render the same source and therefore produce the same digest at [engine.rs:11073](crates/snapback-engine/src/local/tests/engine.rs:11073), [engine.rs:11156](crates/snapback-engine/src/local/tests/engine.rs:11156), and [engine.rs:11766](crates/snapback-engine/src/local/tests/engine.rs:11766). Removing the publication/prepared/blob digest checks at [asset_attempts.rs:251](crates/snapback-kernel/src/storage/asset_attempts.rs:251) leaves their key, receipt-count, and quota assertions green.

### Fix

Keep the first two tests but narrow their claims to identical-plan/shared-publication idempotency. Replace the tight-quota fixture with a divergent-byte test:

- Take two width preflights before the rendition exists.
- Use the existing store replacement seam at [assets.rs:825](crates/snapback-services/src/assets.rs:825) so the second preparation reads a different valid JPEG while all width/recipe facts remain equal.
- Assert the two plan digests differ before moving either plan.
- Let the first plan publish and consume the last quota unit.
- Plan, PUT, and commit the second preparation.
- Require `SNAPBACK_ASSET_QUOTA_EXCEEDED`, unchanged accounting and winner rendition/blob identity, no second rendition receipt, and no successful convergence transition for the second publication.

This exercises the load-bearing blob-versus-publication equality at [asset_attempts.rs:278](crates/snapback-kernel/src/storage/asset_attempts.rs:278). Publication-versus-prepared mismatch at [asset_attempts.rs:263](crates/snapback-kernel/src/storage/asset_attempts.rs:263) becomes structurally inexpressible under #5’s bound width proof and should be enforced there rather than through an invalid runtime carrier.

Mutation audit: deleting blob/publication digest equality, or converging on width/recipe alone, changes the required quota refusal into success. Deleting only publication/prepared equality leaves this test green, but after #5 it no longer creates an expressible bad state; before #5, the #5 genuine-proof attack covers it.

Fail-first requirement: remove the blob/publication digest comparison and watch the divergent tight-quota test fail.

Classification: **test-only**; no new production seam. Small–medium, about one day.

## #10 — permission-epoch capacity preflight

The named test remains non-discriminating: it reads `engine.rs` and searches for a token at [engine tests:31223](crates/snapback-engine/src/local/tests/engine.rs:31223). The helper has moved to [engine.rs:31586](crates/snapback-engine/src/local/engine.rs:31586); returning `Ok(())` leaves the source test green.

However, the global mutation does **not** leave the existing engine suite green:

- Ordinary staged HostPlan behavior is covered at [engine tests:31119](crates/snapback-engine/src/local/tests/engine.rs:31119).
- Nested HostPlan and detached Ibex seams are covered at [engine tests:31162](crates/snapback-engine/src/local/tests/engine.rs:31162).

Thus this is worth fixing, but only one seam and two runtime-tier cases need new coverage.

### Fix

Delete the capacity source-grep loop. Replace/refactor the behavioral coverage into a table over the four named seams:

- Staged recorded mutation: test both HostPlan and Ibex. Stage while capacity remains, then set the exact scope to `PORTABLE_STORAGE_VERSION_MAX` before calling the staged commit. This proves the check occurs at the commit seam at [engine.rs:17399](crates/snapback-engine/src/local/engine.rs:17399), not merely during staging.
- Direct compatibility seam: run both HostPlan and Ibex through `run_function`, which enters `invoke_mutation_commit_with_id_and_authority` at [engine.rs:22394](crates/snapback-engine/src/local/engine.rs:22394).
- Retain the existing nested HostPlan case for [engine.rs:18081](crates/snapback-engine/src/local/engine.rs:18081).
- Retain the existing detached Ibex case for [engine.rs:18386](crates/snapback-engine/src/local/engine.rs:18386).

Every case must assert the typed exhaustion error plus unchanged storage version, rows, permission epoch, and live/resync output.

The wrapper-posture string assertions at [engine tests:31243](crates/snapback-engine/src/local/tests/engine.rs:31243) are outside the capacity property. Leave them out of this fix or rename them explicitly as static wiring inventory; do not cite them as behavioral evidence.

Mutation audit:

- Making `ensure_permission_epoch_capacity` return `Ok(())` makes every case commit or hit the postcommit overflow assertion at [engine.rs:31609](crates/snapback-engine/src/local/engine.rs:31609), so the tests fail.
- Checking only during staging fails the “stage, then exhaust, then commit” cases.
- Checking only one runtime tier fails the paired HostPlan/Ibex case.
- A bypass in a fifth, newly introduced commit seam is outside this four-seam matrix and must be added to the matrix when introduced.

Fail-first requirement: make the helper return `Ok(())` and watch every matrix member fail, especially the new direct HostPlan/Ibex cases.

Classification: **test-only** and behaviorally feasible without a new seam. Small, under one day.

## Landing order

Use four commits, one per finding. One combined commit is technically possible but would not be reviewable or independently revertible; #5 especially must remain separate.

Recommended order:

1. #10 — smallest, closes the misleading source-proof claim.
2. #9 — small asset test correction.
3. #7 — deterministic concurrency observability.
4. #5 — production carrier migration plus security-boundary inventory, rebased after the smaller asset changes.

Each commit must include its fail-first mutation witness in the review record. #5 additionally runs `node scripts/check-security-boundaries.mjs` and `node scripts/check-inventories.mjs`; the other commits run their crate-local targeted tests and affected inventory checks.
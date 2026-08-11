# Current-main lib reds: capability_maturity grammar test; auth_rescue stack-overflow abort

**Filed:** 2026-08-11 (ship run `llp0231-visibility-20260811`, Lane B verification)

Found while verifying the LLP 0231 Lane B landing; all reproduce at **bare
current main (`638326ff1`)** in a bootstrapped worktree, so none are caused by
the visibility work:

1. `manifest::membership_manifest_grammar_tests::capability_maturity_promotions_hold_and_admission_stays_fail_closed`
   — FAILED at `638326ff1` (0 passed / 1 failed focused run) and identically on
   the Lane B branch. Plausibly related to this morning's
   `4cc9aae58 fix(auth,fork): classify rehearsal + catalog-v3 tables for fork
   custody` (same family), but unbisected — that commit may also have FIXED the
   ~43 instance_fork failures observed on a pre-4cc9aae58 base, so triage
   should bisect 4cc9aae58's neighborhood specifically for this one test.
2. `server::tests::auth_rescue_host_op_returns_pinned_metadata_and_keeps_service_live`
   — **stack overflow, SIGABRT**, in isolation at `638326ff1`
   (`cargo test --lib auth_rescue_host_op_returns_pinned_metadata`). The abort
   kills the whole lib-test process when reached in a full run, hiding the
   suite summary; that makes every other red harder to see, so this one is the
   highest-leverage fix.
3. `server::tests::agent_token_route_accepts_exactly_one_target_and_returns_complete_receipts`
   — FAILED in the same full runs; not yet isolated (may be collateral of the
   abort or its own red). Classify during triage of (2).

Environment: macOS worktrees, cargo test without DYLD_FRAMEWORK_PATH, ibex
bootstrapped, todo/rbac manifests primed. Fix-forward per LLP 0189; not
retroactive invalidation of the fork-custody landing.

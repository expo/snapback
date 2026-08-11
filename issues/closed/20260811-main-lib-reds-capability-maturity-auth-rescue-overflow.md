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

## Resolved (2026-08-11) — LANDED `1dc0b1277`

All three items resolved.

**Item 2 (auth_rescue stack overflow)** and the sibling `auth_mint` abort shared
one root cause — an oversized async state machine in the auth host-op
dispatcher, not recursion. Heap-pinned; see
`issues/closed/20260811-server-auth-mint-projection-test-stack-overflow.md`.

**Item 1 (capability_maturity grammar)** — the ticket's suspicion of
`4cc9aae58` was wrong. A read-only ancestry bisect found first-bad
`2f8754e80b5c67a6de14f436c28589daba3ee386` (parent `8f98eebd7` good);
`4cc9aae58` is unrelated and 132 ancestry commits later. `2f8754e80` registered
`realtime.connected-client-predicate` as Experimental but omitted it from the
exhaustive expected map. The expectation was corrected rather than the value:
Experimental is right, because LLP 0222 is Implemented but no LLP 0134
evidence-bound stable-promotion act has landed. The stale
"LLP 0222 remains in Review" comment was replaced with an `@ref` to LLP 0134 §1.

**Item 3 (agent_token)** — passes unchanged once the abort is gone. It was
collateral of the aborting binary, not its own red.

**Correction to the environment note:** the reported "19 auth::backup failures"
were codex-sandbox artifacts. Outside the sandbox `auth::backup::` is
26 passed / 0 failed (serial). True full-lib baseline at merge-base
`13d72ba6d` is **2577 passed / 6 failed**, not 2551/32. The 6 remaining are
pre-existing and independently confirmed by stashing: three `local::tests::*`,
two `s5_d10_*` diagnostic-drift tests, and
`served_http_refusals_project_typed_candidates_and_argument_contracts`.

The two `s5_d10_*` reds are **in scope for the password-auth program**: the
LLP 0214 floor landed ~15 new `SNAPBACK_AUTH_*` codes (including
`SNAPBACK_AUTH_CREDENTIAL_INVALID`) without classifying them in the reviewed
HTTP status table. That classification is required work for the password routes
and is being folded into that program rather than tracked separately here.

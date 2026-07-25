# 0065: implementation-conformance suite (gates Implemented + STEP5.DECLARATION_REDUCTION)

**Status:** Open
**Severity:** P2
**Systems:** Testing, Authorization, Codegen
**Author:** Claude (Fable 5), directed by Charlie Cheever
**Date:** 2026-07-24
**Related:** Accepted LLP 0065 §6, LLP 0053, LLP 0058, LLP 0063 WS6
**Marker:** step5-impl

Build the §6 suite: byte-identical regeneration; named negative generation
cases; cross-user negatives with byte-indistinguishable missing-vs-other-owner
outcomes across every claimed adapter; unique-conflict fixtures (partitioned +
declared-disclosure); client-supplied owner-field rejection on create and
update; posture parity with a handwritten equivalent; trusted now/id replay;
principal negatives (SNAPBACK_AUTH_REQUIRED for anonymous; pattern code for
servicePrincipal/autonomous agents; delegated-agent resolution); conditional
guard races; duplicate-order-key cross-target determinism; pagination
no-skip/no-duplicate + cursor refusals; exact ceiling assertions + one
out-of-ceiling fault; live conservative resnapshot with the disabled-skip
capability record; same-subject two-app domain negative; no-Exact-core and
package gates rerun. Depends on every other 0065-lane ticket. The Step 5
Partitime receipt itself stays a separate LLP 0063 gate deliverable. L-sized.

## Suite index (2026-07-25) — §6 item → executable witness

Every 0065-lane dependency ticket is now closed; the suite is assembled
from the following witnesses (Rust lib tests unless noted):

1. **Byte-identical regeneration** — `scripts/check-generated-artifacts`
   (CI gate; regeneration is compared against the committed output).
2. **Named negative generation cases** —
   `packages/snapback-codegen/standard-patterns.test.mjs` (codegen suite).
3. **Cross-user negatives, byte-indistinguishable outcomes** — the
   real-server byte-indistinguishability witness (landed 2026-07-24 with
   the existence-secrecy collapse) plus
   `demos/competitive-checkpoint/tests/acceptance/local-streaming.mjs`
   (cross-user denials: list, uniqueLookup, keysetPage, update, delete).
   Claimed adapters today: local only.
4. **Unique-conflict fixtures** — `standard-patterns.test.mjs`
   (`discloseUniqueConflicts` positive/negative cases).
5. **Client-supplied owner-field rejection** — `standard-patterns.test.mjs`
   (owner fields are never argument-supplied; generation refuses).
6. **Posture parity with a handwritten equivalent** — the
   generated-vs-handwritten posture witness (landed through `05e4d456`).
7. **Trusted now/id replay** — the LLP 0051 D1 ctx-answer-ledger replay
   suite (record/replay of `now`/`id` through the mutation ledger).
8. **Principal negatives** —
   `standard_pattern_profile_class_admits_only_user_subjects`
   (delegated-agent admission, bare-principal refusal, non-pattern
   scoping) plus the existing `SNAPBACK_AUTH_REQUIRED` gate tests.
9. **Conditional guard races** —
   `conditional_owner_guard_reads_commit_state_not_preview_state`.
10. **Duplicate-order-key determinism** —
    `implicit_index_id_suffix_is_scan_order_only` and
    `keyset_lowering_totalizes_nulls_and_tiebreak`.
11. **Pagination no-skip/no-duplicate + cursor refusals** —
    `standard_pattern_keyset_cursor_pages_and_refuses_end_to_end`,
    `relational_keyset_pages_without_skip_or_duplicate`,
    `relational_keyset_bound_survives_concurrent_mutations`.
12. **Exact ceiling assertions + out-of-ceiling fault** —
    `effect-ceiling.test.mjs` (exact per-constructor ceilings, codegen) +
    the new runtime subset enforcement
    (`validate_effect_ceiling`, witnessed by
    `effect_ceiling_subset_check_fails_closed_on_mismatch` — the fault —
    and `generated_demo_manifests_pass_the_effect_ceiling_subset_check`,
    the walker/runtime mirror drift net).
13. **Live conservative resnapshot** — the standard live replace tests and
    `relational_live_replaces_on_both_tables_and_never_claims_delta`.
14. **Same-subject two-app domain negative** —
    `standard_pattern_cursor_never_crosses_the_app_domain` (cursors; live
    keys and capability artifacts are instance-bound by construction).
15. **No-Exact-core and package gates** — `scripts/verify-local-proof`
    (CI).

**Residuals before flipping LLP 0065 to Implemented:**

- ~~the *disabled disjointness-skip* capability record~~ — landed
  2026-07-25: the capability manifest carries a `standardPatterns` fact
  block (`liveDelivery: "conservative-resnapshot"`,
  `authScopeDisjointnessSkip: "disabled"`) on local + remote-service and
  deliberately nothing on the narrow Cloudflare proof; the runtime also
  now excludes pattern-identified functions from the live_delta lane
  (the unordered unique lookup would otherwise qualify), witnessed with
  a same-shape control in
  `standard_pattern_live_is_conservative_and_recorded`;
- ~~the Sessions-auth-mode matrix~~ — landed 2026-07-25:
  `cursor_negatives_hold_under_sessions_authorities` runs both cursor
  families under real `ResolvedAppAuthority::Session` identities and
  witnesses the session-axis authority transition (same user, re-minted
  session) refusing byte-identically with the cross-user class; the
  principal profile-class witness already ran under
  `AuthMode::Sessions`;
- the two-app negative for live-query keys and capability artifacts as
  explicit fixtures (currently instance-bound by construction);
- `STEP5.DECLARATION_REDUCTION` itself stays a Partitime/LLP 0063
  deliverable, and Step 0 remains the conjunctive prerequisite for
  claiming any Step 5 gate.

# The admission fences are correct but unproven — deleting one fails no test

**Status:** Open
**Filed:** 2026-08-21
**Related:** `issues/closed/20260821-capability-link-mint-revoke-deadlock.md`

## Finding

`AdmissionEffectGuard` is the atomic epoch-retirement fence: LLP 0058's gate
algorithm requires durable generation and admission epoch to be checked
atomically at commit, and that guard is what holds the admission mutex across
the commit.

Three sites now hold exactly one such guard across their durable write, after
the deadlock fixes: capability-link mint, capability-link revoke, and the push
reservation.

None of them is protected by a test.

Verified by mutation: deleting the push fence at
`crates/snapback-engine/src/local/engine.rs` (the
`effect_guard("push durable reservation")` binding) and re-running the push
tests gives **4 passed, 0 failed**. Nothing notices the fence is gone.

Independently, a reviewer found the same weakness on the capability-link side:
`capability_link_one_use_mint_without_function_approval_returns` would still
pass if BOTH guards were removed, because it only asserts 200, `approvalPerUse`
and `remainingUses`.

## Why this matters more than it looks

The deadlock fixes MOVED and DELETED guards. That work was reviewed and is
correct today. But the tests added alongside it prove only that the deadlock is
gone — they are hang regressions, not fence proofs. A future refactor that
removes a fence to "simplify" or to cure another lock-ordering problem would
land green.

That is exactly how this defect class arrived: `ed06d2b4b0` added an engine-side
validation and second guard, and nothing failed.

## Done when

Each of the three fences has a regression that FAILS when the guard is removed.
The test must observe the fence's actual effect — a durable write racing an
epoch retirement must be refused — rather than asserting the guard's presence
syntactically.

A shared helper is likely worth it, since the property is identical at all three
sites and will apply to any future guarded commit.

Also settle whether `consume_capability_link_use` and
`settle_capability_link_use` need a fence at all:
`issues/20260821-capability-link-consume-settle-unfenced.md`. If they do, they
inherit this same testing requirement.

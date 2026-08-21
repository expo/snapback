# The admission fences are correct but unproven — deleting one fails no test

**Status:** Resolved
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


## Resolution — 2026-08-21

All five durable-write fences now fail their own removal.

A `#[cfg(test)]` hook retires the active admission epoch after prevalidation
and immediately before the effect guard — the window that matters. Retiring
before the operation would have proven nothing, since the pre-guard
`validate_admission` already catches that, and such a test would pass with the
fence deleted while looking like coverage. Production builds contain neither
the hook nor any call to it.

Each test observes the fence's EFFECT: a durable write racing a retirement is
refused AND leaves no durable row, counter change, or outcome behind.

Verified independently, not taken on report: deleting the push fence takes the
focused suite to 4 passed / 1 failed, failing exactly its own proof. Before
this work the identical mutation left 4 passed / 0 failed.

Scope grew from three fences to five: capability-link consume and settle were
found to need fences too, and got the same treatment
(`issues/closed/20260821-capability-link-consume-settle-unfenced.md`).

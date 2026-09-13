# The privilege-surface scanner is the objective LLP 0303 progress metric

**Status:** Open
**Systems:** Kernel, Auth, Sync, Engine, Testing
**Date:** 2026-08-24
**Related:** LLP 0303, LLP 0284 §3.7, LLP 0189 D-1,
  `issues/shelved/20260824-liveness-row-bucket-assignment.md`,
  `issues/20260824-battery-kernel-raw-sql-api-6a90f49596586dfa.md`

## What this is

`node scripts/check-kernel-raw-sql-api.mjs` (battery gate `kernel-raw-sql-api`) is a
privilege-surface scanner. It reports, among other things, exactly the LLP 0303 defect
class:

    caller-discriminant caller-constructible MembershipWriter is named directly in a
    registered privilege-sink signature via snapback_kernel::storage::...

The gate is currently red and was auto-filed as a complete-battery ticket. It is worth
recording separately that this is not merely a red to fix forward — **it is a
machine-checkable ratchet over the surface this program exists to shrink.**

Until now the program's only progress measure was "rows landed" out of the 96 catalogued
surfaces. That number moves slowly, is judgement-laden, and says nothing about footprint.
The scanner count is objective, cheap to run (~26s), and directly proportional to remaining
caller-supplied privilege.

## Baseline, 2026-08-24, at `1cb5a2307`

**105 violations.** By privileged type:

| Type | Findings | Owning question |
|---|---:|---|
| `MembershipWriter` | 61 | Q04 |
| `PushStorageAuthority` | 8 | unassigned |
| `PromotionContentionReservation` | 8 | unassigned (bench surface) |
| `AskSpendReservation` | 6 | unassigned |
| `ServiceAuthorityCommitInterlock` | 4 | Q07 neighbourhood |
| `AuthorizationCommitReservation` | 4 | Q12 |
| `PreparedServiceAuthorityTerminal` | 3 | Q07 neighbourhood |
| `ProtectedRecordErasureRequestV1` | 2 | unassigned |
| re-exports and `sql-ingress` rows | remainder | LLP 0284 §3.2 follow-ups |

Finding categories: `caller-discriminant` (the caller names who is writing),
`seed-obtain returns privilege seed` / `... reachable privilege sink accepts obtainable`
(a privileged token is publicly obtainable and publicly consumable), `reexport publicly
re-exports`, and `sql-ingress public parameter names rusqlite`.

## Why this reprioritises the work

**61 of 105 findings — 58% — are `MembershipWriter`**, concentrated in
`crates/snapback-kernel/src/storage/membership_plans.rs` (the `plan_membership_*` family
and the `MembershipPlansKernel` / `MembershipPlansReadKernel` trait surfaces, ~343–2104)
and `crates/snapback-kernel/src/storage.rs` (:1443, :16571, :16692, :16696, :16876,
:18495, :18508, :18772).

Q04 was not staffed when this was measured. By footprint it is the single highest-leverage
row in the program, and it is kernel-only — it runs on Linux build hosts. It has since been
dispatched.

## The honest caveat

The scanner's own first output line reads:

> privilege-surface: this scanner is a ratchet, not a proof; residual evasions are
> documented in LLP 0284 §3.7.

So a falling count is evidence of progress and **not** a structural, fence, or closure
claim. Three PROPERTY claims in this program were already published and withdrawn as false.
No landing may cite this count as proof that a surface is closed. Known residual evasions
are tracked in `issues/shelved/20260819-privilege-scanner-residual-evasions.md`.

Two further limits worth stating, so the number is not over-read:

- Some findings are duplicates by path — the same site is reported once via the module path
  and once via the re-exported `snapback_kernel::storage::` path. The raw count therefore
  overstates distinct sites; it is still a valid ratchet because the duplication is stable.
- Some flagged surfaces are deliberately public bench or test scaffolding
  (`*_for_bench`, `test_support::*`). Those need a disposition, not necessarily a removal.

## What to do

1. Each LLP 0303 lane records the exact count before and after its change in its commit
   message. A lane that does not move the count should say why.
2. Do not chase findings outside your own row — they belong to other lanes.
3. When the count reaches zero, that closes the ratchet, not the defect class. The claim
   language stays scoped to the functions and routes each landing changed.

# Guide GAP review dates keep turning main red, and two point at closed issues

Status: Open — preventive; one row fires 2026-08-24
Created: 2026-08-22
Related: guide/capabilities.md, scripts/check-inventories.mjs, LLP 0061

## What happened

On 2026-08-22 `check-inventories` failed on `main` because the `backend.write-activity-v1` GAP
row's review date expired **that day**. Since the inventories check now runs in CI on every push
(`175732312`), this failed every push for every agent working in the repo until it was fixed
(`c22c12cb1`). The fix was a date extension, explicitly *not* a substantive re-review, because
the row is owned by someone else and the underlying product question was not mine to answer.

This will recur. It is not a one-off.

## Six more fire within a week

| Review date | Row | Owner |
|---|---|---|
| 2026-08-24 | `backend.notifications` | Charlie |
| 2026-08-25 | (interior queries) | LLP 0115 CV-4b |
| 2026-08-26 | (physical-device Expo + published-package rerun) | LLP 0239 R3 |
| 2026-08-26 | (real-process restart witness) | orchestrator |
| 2026-08-28 | (local capture/executor) | LLP 0155 Stage 2 |
| 2026-09-02 | (physical-device Expo rerun) | LLP 0239 R4 |

`backend.notifications` fires in two days and will red `main` for everyone again.

## Two rows point at issues that are already closed

- `backend.notifications` (line 66) → `issues/closed/20260728-guide-gap-assets-and-notifications-capability-rows.md`
- `clients.non-js` (line 109) → `issues/closed/20260808-swift-arm-not-consumable.md`

Either the gap is resolved and the **row should be deleted rather than renewed**, or the issue
was closed while the gap remained, in which case the row is correct and its issue pointer is
stale. Both are worth knowing, and neither is a date problem. I have not changed these rows:
whether these capabilities still have a gap is a product judgement belonging to their owner.

## The underlying design problem

A review date is meant to force periodic re-examination. But the enforcement lands on *whoever
pushes next*, not on the owner, and the cheapest way for that person to get unblocked is to
extend the date. That converts a re-review prompt into a rubber stamp, and the rubber stamp is
applied by exactly the person least equipped to judge the gap.

This is the same shape as the defect class the fence program has spent the week removing:
a control that looks like enforcement but actually runs on convention, where the check that
fires is not the check that matters.

Worth considering, not decided here:

1. Warn before expiry rather than failing on it (e.g. a soft window), so the owner is prompted
   while the row is still valid and `main` never reds for a calendar reason.
2. Fail only the owner's own pushes, if that is expressible.
3. Require an extension to record who extended it and why, so a renewal without re-review is
   visible rather than indistinguishable from a real one.
4. Treat a GAP row whose issue is closed as an error in its own right — that is a real
   inconsistency, unlike a date.

Filed rather than fixed because the right answer is a policy call, and because unilaterally
editing other owners' rows is how a re-review prompt becomes meaningless.

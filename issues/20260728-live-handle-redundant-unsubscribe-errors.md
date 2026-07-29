# Live-handle lifecycle reports redundant unsubscribe as failure

**Status:** Open
**Impact:** 4
**Urgency:** 4
**Ease:** 3
**Confidence:** 5
**Score reviewed:** 2026-07-28
**Score rationale:** The LLP 0102 Snapback Todo arm reproduced the same typed failure through repeated pause/resume and logout. Security state changed correctly, but normal lifecycle APIs surfaced false failures.
**Severity:** P1
**Systems:** Headless client, Realtime, Auth custody, React lifecycle
**Date:** 2026-07-28
**Governing:** LLP 0053, LLP 0059, LLP 0102

Two ordinary lifecycle paths in the Snapback Todo bakeoff arm attempted to
unsubscribe a server subscription that had already been retired:

1. repeated `pause()` / `resume()` cycles on one live handle eventually threw
   `SNAPBACK_UNKNOWN_SUBSCRIPTION`;
2. `replaceBearerToken(null)` blanked rows and prevented future delivery, but
   then threw an `AggregateError` containing
   `SNAPBACK_UNKNOWN_SUBSCRIPTION`.

The second case is especially confusing: the security transition succeeded,
yet the API reports rejection to application code. The arm had to catch and
classify the redundant cleanup diagnostic to verify logout.

Evidence:

- `demos/backend-bakeoff/arms/todo/snapback/receipts/correctness-smoke.v1.json`
- `diaries/0027-todo-backend-bakeoff.diary.md`

## Acceptance

- unsubscribe/retire is idempotent from the client lifecycle's perspective;
- repeated serialized pause/resume cycles do not reuse or double-retire a
  subscription generation;
- bearer replacement closes or blanks old leases before successor use and
  resolves successfully when only redundant cleanup observes an already-gone
  subscription;
- genuine non-redundant lifecycle failures remain visible and typed;
- dispose after pause, server invalidation, logout, reconnect, and terminal
  authorization denial is covered; and
- the Todo logout and reconnect performance barriers run without exception
  suppression or fresh-handle substitution.

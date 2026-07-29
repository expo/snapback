# Live-handle lifecycle reports redundant unsubscribe as failure

**Status:** Closed
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

## Resolution — 2026-07-28

High-level live-handle retirement now owns a read-only subscription generation
and translates only that generation's server-confirmed absence into the typed
`SNAPBACK_LIVE_SUBSCRIPTION_ALREADY_RETIRED` result. Repeated disposal shares
one cleanup task; logout, whole-session revocation, and query-specific terminal
authorization deletion are local-only once authority already owns retirement.
The low-level public unsubscribe remains strict, and ownership/session
mismatches remain typed failures.

The coordinator's real-server revocation gate found and fixed the
query-specific terminal-delete edge after the branch-local lifecycle tests:
`dispose()` had tried a second retirement under the intentionally stale query
fence. Full client tests, lifecycle tests, and the frozen Todo/Chat reruns pass
at Snapback commit `5f31cb6174daaefa04a1e05242acbbc22c725040`.

Resolution evidence:

- `packages/snapback-client/lifecycle-disposal.test.mjs`
- `demos/backend-bakeoff/reports/remediation-1/evidence/todo/correctness-smoke.v1.json`
- `demos/backend-bakeoff/reports/remediation-1/evidence/chat/correctness-smoke.v1.json`

# main red: scheduler defers the revocation obligation delivery — blankBeforeMutationReturn lost the settle race

**Status:** Closed (fixed in the same landing)
**Impact:** 5 (receipt-exported revocation contract; security-relevant client blanking)
**Urgency:** 5
**Systems:** Live queries, Auth, Performance
**Date:** 2026-08-09
**Related:** LLP 0200 §2.4 (fence + gate are the security step), LLP 0053
(client fence obligations), `tests/acceptance/require-role-live-revocation.mjs`

## Symptom

`tests/acceptance/require-role-live-revocation.mjs` red on main-era trees
(verified at clean 65064cd3a with a stamped matching binary):
`resource membership delete did not blank before the causing mutation
returned` — the first `verifyTerminalRevocation` leg's
`blankBeforeMutationReturn` assertion. With
`SNAPBACK_LIVE_SCHEDULER_DISABLED=1` the suite passes (exit 0,
`blankBeforeMutationReturn: true` ×4), so the red is scheduler-conditional.

## Cause

Since the Phase-1 scheduler landing, `notify_authorization_event_in_frame_with_policy`
returned early on the scheduler path after fence marking + obligation raise +
`enqueue_authority_restoration`, WITHOUT the inline delivery of the
preprojected obligation envelopes that the legacy path performs in the commit
turn. The client-visible blank therefore waited for the AuthorityRestore
scheduler turn. At Phase 1 that turn ran promptly and won the race against the
mutation's settle. Phase 3's write priority (LLP 0200 §2.5, Lane B stage 1)
defers scheduler turns while writers are visible — the causing revocation
mutation itself — so the blank now reliably loses to the settle and the
receipt-exported contract (`blankBeforeMutationReturn`, LLP 0200 §6a) breaks.

## Fix (this landing)

The fail-closed obligation projection publication is part of §2.4's cheap
security step, not restoration: it is now delivered inline in the commit turn
on BOTH scheduler and legacy paths (serialization + connection enqueue,
O(affected subscriptions), no evaluation), before the restoration lane work is
enqueued. Restoration (re-resolution + snapshot delivery) stays on the
scheduler's authority lane. This makes the client blank constructive rather
than racy.

## Evidence

- Before: suite exit 1 at leg 1; after: exit 0, `blankBeforeMutationReturn:
  true` ×4 with the scheduler enabled.
- `cargo test --test live_scheduler_v0 --test live_coalesce_v0`: 10 passed /
  0 failed (1 ignored) and 3 passed / 0 failed.
- Full lib suite: 2374 passed / 4 failed — the four failures are the
  documented pre-existing era set (agent_safe_publication derived-chain,
  detached_mutation reload-binding, membership_bridge sequence-abort,
  served_http_refusals), unrelated to this path.

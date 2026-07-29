# `requireRole` live revocation retains protected rows

**Status:** Closed
**Impact:** 5
**Urgency:** 5
**Ease:** 2
**Confidence:** 5
**Score reviewed:** 2026-07-28
**Score rationale:** The LLP 0102 Snapback Todo arm directly reproduced a security-boundary failure on a supported sessions-mode live path. Repair likely crosses codegen authorization dependence, matcher wakeup, and LLP 0053 delivery-obligation handling.
**Severity:** P0
**Systems:** Realtime, Memberships, Authorization invalidation, Ibex JS handlers, Codegen
**Date:** 2026-07-28
**Governing:** LLP 0053, LLP 0056, LLP 0102

The Snapback Todo bakeoff arm establishes a JS live query whose handler calls:

```js
await ctx.permissions.workspaceMembers.requireRole(
  workspaceId,
  'owner',
  'member',
);
```

Bob receives 100 authorized rows. He then removes his own `member` seat through
the declaration-bound `removeSelf(workspaceId)` transition.

Observed result:

- the membership mutation commits;
- a fresh Bob query receives `SNAPBACK_AUTH_PERMISSION_DENIED`;
- the established Bob live handle does not blank within eight seconds and
  retains all 100 protected rows;
- a later Alice write is not delivered to that handle.

The final point shows the future-delivery barrier partly works, but retained
protected data is not evicted. This contradicts LLP 0056's accepted
visible-to-hidden matcher-path and witnessed shrink obligation.

The generated function manifest currently describes `listTasks` with
`authorizationDependence: ["opaque"]`, despite the declaration-bound
`ctx.permissions.workspaceMembers.requireRole(...)` host read.

Evidence:

- `demos/backend-bakeoff/arms/todo/snapback/receipts/correctness-smoke.v1.json`
- `demos/backend-bakeoff/arms/todo/snapback/run-capsule.v1.json`
- `diaries/0027-todo-backend-bakeoff.diary.md`
- `demos/backend-bakeoff/arms/chat/snapback/receipts/correctness-smoke.v1.json`
- `demos/backend-bakeoff/arms/chat/snapback/run-capsule.v1.json`
- `diaries/0028-chat-backend-bakeoff.diary.md`

## 2026-07-28 Chat reproduction

The frozen Chat arm independently reproduced the same failure shape against a
private channel. Bob began with 125 authorized messages, removed his own
membership, and was denied on a fresh query. His established live handle
received no later forbidden message but retained all 125 predecessor rows
instead of blanking. The Chat capsule therefore records `CHAT-13-REVOKE` as
FAIL, not as a new issue or a Stop-class disclosure.

## Acceptance

- a `defineJsLiveQuery` gated only by declaration-bound `requireRole` captures
  the membership dependency in the analyzable authorization/matcher shape;
- deleting or downgrading the caller's seat wakes the established subscription;
- protected rows blank under the causing write's witnessed delivery obligation
  before any later forbidden delivery;
- a fresh query remains denied with the exact terminal diagnostic;
- hidden-to-visible behavior preserves the documented
  denied-at-subscribe-versus-empty distinction;
- regression coverage exercises resource-scoped and app-scoped declarations,
  delete and downgrade, sessions and dev auth, and a handler with no other
  membership read; and
- the Snapback Todo arm reruns TODO-12 as PASS without test-only invalidation.
- the Snapback Chat arm reruns CHAT-13 as PASS without UI-only clearing or
  test-only invalidation.

## Resolution — 2026-07-28

The server already emitted the correct next-epoch quarantine, terminal delete,
and exact acknowledgement obligation. The client authorization projection
incorrectly required the subscription's original epoch and rejected a
strictly newer epoch in the same issuer, scope, version stream, and
authorization incarnation as stale.

The repaired projection admits only that strictly newer same-incarnation
epoch; lower epochs and other incarnations still fail closed. The real-server
acceptance covers resource- and app-scoped delete and downgrade, blanking
before the causing mutation returns, exact ACK, fresh denial, no future
delivery, and an authority-independent live query that survives the churn.
Frozen TODO-12 and CHAT-13 both pass in the Stage 2 isolated rerun at Snapback
commit `5f31cb6174daaefa04a1e05242acbbc22c725040`.

Resolution evidence:

- `tests/acceptance/sb-001-revocation-evidence.md`
- `demos/backend-bakeoff/reports/remediation-1/evidence/todo/correctness-smoke.v1.json`
- `demos/backend-bakeoff/reports/remediation-1/evidence/chat/correctness-smoke.v1.json`

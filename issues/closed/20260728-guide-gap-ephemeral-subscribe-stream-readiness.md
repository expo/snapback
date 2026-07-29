# Guide gap: ephemeral subscribe omits live-stream readiness prerequisite

**Status:** Closed
**Impact:** 3
**Urgency:** 4
**Ease:** 4
**Confidence:** 5
**Score reviewed:** 2026-07-28
**Score rationale:** The frozen LLP 0102 Chat build twice failed to observe native ephemeral changes because the guide's subscription-shaped example did not expose the connection-manager readiness step used by the working reference app.
**Systems:** Guide, TypeScript client, Ephemeral state, Realtime
**Date:** 2026-07-28
**Labels:** guide-gap
**Governing:** LLP 0013, LLP 0061, LLP 0102

The Snapback Guide's ephemeral-state subscription path makes
`subscribeEphemeral(...)` appear sufficient to begin receiving room changes.
In the frozen Chat arm, that call registered the overlay but did not establish
the socket for a previously unused connection label. The working sequence was:

1. obtain `client.liveStreamManager(connectionId)`;
2. await `waitUntilReady()`;
3. register `subscribeEphemeral(...)`; and
4. attach `onChange`.

The repository reference application already follows this sequence, but the
intent-indexed guide did not make the prerequisite discoverable while building
the arm. Two failed attempts and the eventual native signal proof are retained
in:

- `demos/backend-bakeoff/arms/chat/snapback/receipts/failed-attempt-ephemeral-listener.json`
- `demos/backend-bakeoff/arms/chat/snapback/receipts/ephemeral-typing-diagnostic.json`
- `diaries/0028-chat-backend-bakeoff.diary.md`

## Acceptance

- the ephemeral-state guide states whether `subscribeEphemeral` establishes
  transport or only registers overlay state;
- its first complete subscription example establishes and awaits the relevant
  live-stream manager before subscribing;
- the example includes the change-listener ordering required to avoid a lost
  initial transition;
- generated/client diagnostics identify a missing or unready manager with an
  actionable correction where feasible;
- the capability index links the complete recipe; and
- the guide's CI-verified snippet exercises a fresh connection label rather
  than inheriting a socket opened by an unrelated live query.

## Resolution — 2026-07-28

`subscribeEphemeral` now defaults to stream transport, acquires its own managed
socket demand lease, proves readiness, subscribes the snapshot, and transfers
the lease to the overlay. Disposal and failed setup release demand. Explicit
`transport: "poll"` preserves the manual-drain path without weakening the
ordinary one-call stream path.

Code generation now retains the declared ephemeral scope and value types
instead of degrading result rows to `unknown`. The frozen Chat app removed all
manual `liveStreamManager(...).waitUntilReady()` calls, regenerated typed
bindings, and passed typing and presence on fresh connection labels at Snapback
commit `5f31cb6174daaefa04a1e05242acbbc22c725040`.

Resolution evidence:

- `demos/backend-bakeoff/reports/remediation-1/evidence/chat/correctness-smoke.v1.json`
- `demos/backend-bakeoff/reports/remediation-1/evidence/chat/ephemeral-typing-diagnostic.json`
- `demos/backend-bakeoff/arms/chat/snapback/work/snapback/generated/provider-bindings.d.ts`

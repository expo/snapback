# Declarative plan mutation over sessions bearer misclassified as connectivity failure

**Status:** Closed (2026-08-07)
**Impact:** 4
**Urgency:** 4
**Ease:** 3
**Confidence:** 4
**Systems:** Mutation runtime, Client transport, Auth
**Date:** 2026-08-07
**Related:** Diary 0066 (three-lane measurement, 0.1.12)

On a sessions bearer client, a declarative plan mutation's dispatch is
misclassified as a connectivity failure and falls into the offline-queue
path (`SNAPBACK_OUTBOX_NOT_WRITER` / `SNAPBACK_OFFLINE_QUEUE_DISABLED`),
while a JS mutation on the SAME client commits fine. Minimal repro
retained from the measurement lane:
`scratchpad m3-snapback-skill/chatapp/probe-sendtext.mjs` (session
transcript artifact — reproduce from its ~30 lines: mint session, bearer
client, invoke the declarative mutation, observe queue refusal vs JS
mutation success). Broke 2/5 comparator checks until the lane pointed
them at the JS mutation. Real defect: either the declarative path's
delivery envelope differs under bearer auth, or its error classification
maps an auth/protocol refusal onto the connectivity branch.

## Resolution (2026-08-07)

Reproduced from the retained probe, then diagnosed. Neither hypothesis was
it: the envelope is fine and no classifier fired. `SnapbackClient.mutate`
hard-required the durable outbox composition for every local-executable
generated-IR mutation (`#offlineQueueStore(true)`,
packages/snapback-client/index.mjs), so on a client that cannot carry the
outbox (`offlineQueue: false`, no/incapable/volatile `rqsStore`, agent
custody fence, or a non-single-writer context) the declarative mutation
threw `SNAPBACK_OFFLINE_QUEUE_DISABLED` / `SNAPBACK_OUTBOX_NOT_WRITER`
*before any network dispatch*, while JS mutations dispatched online
normally. Empirically the server executes the same declarative plan
authoritatively from a plain online dispatch under the same sessions
bearer.

Fix (client routing layer, per LLP 0155 §Local-read admission
"server-only is a valid degradation"):

- `queue: 'auto'` (default): compose with the durable outbox when
  available (unchanged behavior); otherwise degrade to server-delegated
  plain online dispatch — no local optimistic layer, no settlement claims,
  fail-loud on connectivity, never queued.
- `queue: true`: unchanged loud requirement.
- `queue: false`: server-delegated fail-loud dispatch; the
  `SNAPBACK_GENERATED_IR_DURABLE_OUTBOX_REQUIRED` refusal is deleted
  (this also unblocks `SnapbackCommandClient` and the React provider
  command path, which pass `queue: false`).
- `SNAPBACK_OUTBOX_NOT_WRITER` during the composed enqueue under `auto`
  degrades the same call to server-delegated dispatch.

Refusal posture unchanged: server-answered refusals never classify as
connectivity and never queue (pinned by a new classification unit test in
outbox-store.test.mjs). Regression tests for all degraded routes are in
generated-mutation-ir.test.mjs. After the fix the retained probe commits
both mutations on the same sessions bearer client; remaining probe
flakiness is the boot-window auth-transition family
(20260807-auth-stream-reset-boot-flake.md), hits both mutation kinds
equally, and is order-independent (verified by swapped-order runs).

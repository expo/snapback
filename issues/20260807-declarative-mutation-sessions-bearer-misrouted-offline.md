# Declarative plan mutation over sessions bearer misclassified as connectivity failure

**Status:** Open
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

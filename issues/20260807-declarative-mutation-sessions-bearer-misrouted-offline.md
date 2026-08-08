# Reconcile the resurrected sessions-mutation ticket and repair the auth-handshake gate

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

## Re-triage — 2026-08-08

The original product defect was fixed by `25e9674b0`, which moved the resolved
ticket to `issues/closed/`. Commit `0984a1e72` later restored this earlier open
copy from a stash, so the repository currently carries both the resolved record
and this stale open duplicate.

There is new work in the same area, but it is a canonical-fixture regression
after the sessions-custody outbox landing rather than evidence that the exact
original defect returned. Under pinned Node 24:

```text
$ node demos/_kit/tests/auth-handshake.mjs
FAIL _kit auth handshake — 20/22
```

The two failures are:

1. `sessions repeat protocol/bearer...` assumes the mutation is the second
   immediate network call and executes `JSON.parse(calls[1].init.body)`. The
   new sessions outbox path changes that timing/path, so `body` is undefined.
2. `agent custody preserves durable replay...` constructs a client store but
   reaches mutation before writer ownership is established and receives
   `SNAPBACK_OUTBOX_NOT_WRITER` instead of the expected direct settlement.

The pinned complete proof shows that this is broader than the one auth-handshake
fixture. Three additional integration surfaces enter the same non-writer path:

- `tests/acceptance/asset-conformance-v1.mjs` receives
  `SNAPBACK_OUTBOX_NOT_WRITER` where it expects `SNAPBACK_ASSET_FORBIDDEN`;
- `demos/card-game/tests/acceptance/authority-scope.mjs` cannot install its
  hidden-hand fixture because the file store has not acquired writer custody;
- the auth-handshake agent-custody case above fails identically.

The focused client outbox/store tests still pass, which points to a shared
integration-client construction or readiness contract rather than three
independent product failures. The repair must make writer acquisition an
explicit awaited precondition (or make the high-level client do so) and retain
each surface's original authorization assertion; changing expected errors to
`SNAPBACK_OUTBOX_NOT_WRITER` would hide the intended coverage.

The package's focused outbox/custody suites pass, so repair the integration
fixture to establish the intended store/writer posture explicitly and then
determine whether either scenario still exposes a product-path regression.
Do not merely change request indexes or suppress the refusal.

Revised acceptance:

- `node demos/_kit/tests/auth-handshake.mjs` passes 22/22 under pinned Node 24;
- `node tests/acceptance/asset-conformance-v1.mjs` and
  `node demos/card-game/tests/acceptance/authority-scope.mjs` pass under pinned
  Node 24;
- both cases still assert bearer/protocol/authority behavior through the
  intended direct-or-durable mutation path;
- this duplicate open record is reconciled with the resolved history (move the
  final record to `issues/closed/` rather than leaving two live states).

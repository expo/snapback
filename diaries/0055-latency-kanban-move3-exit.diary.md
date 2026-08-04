# Diary 0055: Latency Kanban Move-3 exit

**Date:** 2026-08-04  
**App:** `demos/latency-kanban`  
**Program:** LLP 0129 Phase 1 / LLP 0155 Move 3, lane M4

## Build experience

The best part of this build was deleting the conceptual boundary between “the
mutation” and “the optimistic mutation.” The five card verbs are ordinary
generated HostPlans, and codegen now publishes the plan, operation hash,
activation/schema identity, effect class, and exact point-read fields on the
same generated reference the app passes to `client.mutate`. The app never
describes how a title, assignee, archive flag, or rank should change a second
time; it subscribes to an outbox-derived view and renders the evaluator result.

Insert/Get/Guard/Patch was a good sizing choice. Create needs one labeled row-id
claim, while every other verb shares a readable Get/Guard/Patch shape that is
easy to inspect and rejects a locked card identically on both sides. Codegen's
existing complete document result contracts also meant the Kanban UI acquired
real card types immediately, with no degraded `unknown` row escape hatch.

The hard part was composition rather than mutation authoring. M2 deliberately
requires an active, completeness-honest materialization demand, M3 deliberately
keeps presentation layers non-durable, and settled identities may bridge until
authoritative delivery. The public view therefore needs the app to supply its
authoritative live-query base and the exact settlement identities reflected by
delivery; that is honest and mechanically testable, but more explicit ceremony
than a mature integrated query/mutation store should eventually require.

Boot replay felt strong once that seam existed: the socket-independent client
test durably queues an Insert, closes the first process-local view, and verifies
that a fresh view reconstructs exactly one post-intent row from retained base
plus the IR outbox without making a network request. The acceptance gate also
encodes the stronger SIGKILL child-process proof, but the sandbox denied the
controlled server's loopback bind with EPERM before that leg, so this lane
retains four BLOCKED receipt sections for the orchestrator's outside-sandbox
rerun rather than claiming unobserved settlement or convergence evidence.

## Guide and comparison

The authoring, mutation, offline, generated-artifact, and acceptance guide pages
accurately explained the pre-M4 pieces and made the identity/retention boundaries
clear. The guide already carries an explicit GAP for JS/React local evaluator
authoring, so I did not file a duplicate guide-gap ticket; the new public surface
and its delivery-retirement recipe should replace that GAP only when the
orchestrator presents and accepts the program exit.

Compared with React plus Convex or Supabase, Snapback removed the familiar
second optimistic reducer and produced much stronger replay/refusal identity
evidence. It currently asks the app to coordinate the authoritative base and
settlement retirement more explicitly than those integrated stores, trading
some convenience for a clearer account of what is durable, predicted, settled,
and actually observed.

# Make generated optimistic mutation projection the ordinary JS client path

**Status:** Closed (2026-08-16)
**Impact:** 5
**Urgency:** 4
**Ease:** 2
**Confidence:** 5
**Systems:** React, Expo, Headless client, Mutation IR, Optimistic rebase
**Date:** 2026-08-16
**Governing:** LLP 0155 Move 3, LLP 0129, LLP 0270
**Related:** LLP 0107, LLP 0133, LLP 0166, LLP 0218;
`issues/20260815-local-first-defaults-audit.md`

## Problem

The runtime already derives an `optimisticOperation` for generated
local-executable mutation IR
(`packages/snapback-client/generated-mutation-ir.mjs`) and can rebase it in
`packages/snapback-client/store-runtime.mjs`. The default UI path does not
install that prediction generally:

- React and Expo get automatic presentation only by selecting
  `useSnapbackOptimisticCreate(ref, { query, args, select })`, limited to
  exactly one generated `Insert` into the queried table
  (`guide/clients/react.md` and
  `packages/snapback-react/implementation.mjs`). Other
  `useSnapbackMutation` calls require app-authored
  `optimistic.update`/`isAuthoritative`, with `projectRecordFields(...)` as a
  shorthand.
- Headless `mutate()` deliberately returns queued work with
  `presentation: 'withheld'`; an app must create and feed
  `client.createOptimisticMutationView(...)`
  (`guide/clients/headless.md`).

## What default means

For every generated mutation classified `local-executable`, the ordinary
React, Expo, and headless mutation surface should attach the generated
operation to the canonical local materialization automatically. It should:

1. derive affected query/materialization identities and required reads from
   owner IR rather than an app-authored second reducer;
2. paint the admitted prediction immediately, persist the same deterministic
   ledger with queued intent, and replay pending layers after restart;
3. rebase remaining operations in local sequence order over authoritative
   delivery; and
4. degrade `server-only` or incomplete-read mutations to visible pending
   intent without fabricating a row effect.

Hand-written optimistic reducers may remain an explicit compatibility escape
hatch, but they must not be required for the generated common path and must
not be silently substituted while claiming same-operation parity.

## Consequence classification

**Semantic consequences — not SAFE as a wiring-only flip.** The default
changes what users see before server authority settles, which failures remove
which layers, provisional identity visibility, and reload presentation.
Generated/server evaluator agreement, local-read completeness, rejection,
concurrency, and settlement receipts are required under LLP 0155 and LLP
0133. Prediction never becomes authority.

## Acceptance

- Generated create, edit, delete/archive, and reorder mutations paint without
  an app-authored reducer on React, Expo, and headless reference hosts.
- Missing local reads produce an inspectable pending/no-prediction state,
  never “missing means absent.”
- Rejection removes only its layer; canonical delivery and id mapping retire
  it exactly once; remaining layers rebase deterministically.
- Process restart during queued settlement reconstructs the same provisional
  presentation from durable IR and ledger identity.

## Resolution (draft)

The ordinary headless `mutate()` path now instantiates generated
`local-executable` IR independently of durable-store availability. Active
generated `liveQuery()` handles own a materialization/table-scoped view over
the existing LLP 0155 rebase engine: `rows` is the projected presentation,
`authoritativeRows` remains canonical, and `optimisticPresentation` exposes
predicted versus pending-without-prediction state. A projected handle reports
`answerClass: 'optimistic'` even when its canonical base remains
`freshness: 'current'`; `authoritativeAnswerClass` exposes the base fact.
Durable outbox records reconstruct the same layer and identity after restart;
a process-local ephemeral ledger supplies online-only paint when durable
custody is unavailable. Durable records restored from prior processes sort
before current-process layers, while durable and ephemeral mutations invoked
in the same process replay in their shared invocation order.

The table-write projector attaches only to owner-proved table-complete query
coverage. Filtered/limited queries attach a pending-only view, and generated
`server-only` records remain visible in the ordinary handle's `queuedOnly`
surface. Cross-table-dependent plans conservatively degrade with
`SNAPBACK_OPTIMISTIC_CROSS_TABLE_REPLAY_UNPROVEN` rather than skipping earlier
non-target writes and mispredicting a later target write.

React's ordinary `useSnapbackMutation` consumes that headless presentation,
so create, edit, archive/delete, and reorder paint without an app reducer.
The AppDescriptor preparation path explicitly carries codegen's
non-enumerable generated artifacts into the stored public reference while its
portable structured clone remains the receipt/hash authority. Real
`SnapbackClient` React tests therefore exercise generated admission,
`liveQuery()`, `mutate()`, provider publication, and file-store restart rather
than simulating row edits in a stub.
Expo uses the same React carrier; its restart-replay coverage rides the
carrier qualification required by LLP 0270's rollout order (wave 2), rather
than claiming a separate Expo process witness here. App-authored
`optimistic.update`/`isAuthoritative` disables generated projection for that
call, and `useSnapbackOptimisticCreate` remains the explicit typed provisional
entity wrapper.

Missing required reads remain inspectable queued-only intent. Rejection
removes only the failed layer. Pause/resume and reconnect fresh subscriptions
always rebase pending layers. Authorization delete, denial, quarantine, and
error close the automatic view before a read-free prediction can repaint
protected data.

Settlement retirement reuses the LLP 0133 mapping resolver: every logical
mint must have one matching site/occurrence mapping, duplicates and collisions
fail closed, the delivery must reach the settlement version, and every write to
the handle's observed table must be reflected. Writes to other tables are
covered by the successful settlement and complete plan ID map rather than a
reflection the handle cannot observe. Canonical mappings rewrite exact string
leaves in reference values while remaining layers rebase. An unrelated later
authoritative delivery cannot retire a bridge. Because settlement ACK can delete durable recovery state before query
reflection, an installed bridge retains its already-admitted per-handle
matcher evidence until canonical reflection retires it.

Focused acceptance now covers real headless and React paths, reducer
precedence, exact reflection-gated retirement, rejection and authority
boundaries, resume replay, mixed durable/ephemeral ordering, conservative
multi-table handling, speculative reference remapping,
server-only/filtered pending visibility, React connection republishes, manual restart,
and restart reconstruction with the automatic drain plus settlement/ACK GC
lifecycle enabled.

---

**Closed 2026-08-16.** Implemented and landed via the LLP 0270 wave-2
orchestration: generated optimistic projection is the ordinary JS path for
local-executable mutations (owner-IR-derived, painted immediately,
durable-ledger replay, deterministic rebase), with server-only and
cross-table-dependent plans degrading to visible pending
(SNAPBACK_OPTIMISTIC_CROSS_TABLE_REPLAY_UNPROVEN), app reducers winning
per-call, and predictions presented as answerClass 'optimistic' — never
authoritative. Five-round dual-family review (codex + grok, xhigh) burned
down 20+ MATERIALs, headlined by: the React binding dropping codegen's
non-enumerable artifacts (ordinary hooks never painted — masked by a stubbed
test), settlement retirement without mapping validation, sequence-domain
interleaving after restart, authority-boundary repaint after quarantine, and
descriptor-cursor misalignment on evaluator-omitted writes. Converged READY
(codex r5 with exhaustive omission-subset verification, grok r3). Expo
restart-replay of queued intent remains gated on the carrier qualification
ticket per the LLP 0270 rollout order.

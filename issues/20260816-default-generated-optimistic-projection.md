# Make generated optimistic mutation projection the ordinary JS client path

**Status:** Open
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

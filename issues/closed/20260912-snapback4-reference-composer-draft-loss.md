# Snapback 4: Preserve reference-app drafts and show failed writes

Status: Closed
Resolved: 2026-09-13
Priority: P2
Observed: 2026-09-12
Review finding: R35
Evidence: Code traced
Baseline: `d6c803878a5432cce5f045777786a049972d3d70` / Snapback 4 0.0.16
Related: [LLP 3000.003](../../llp/3000.003-one-semantics-and-credible-verification.research.md), [comprehensive review](../../llp/reviews/3000-architecture-code-review-20260912.md)

## Problem and reproduction

The Expo composer clears its text before awaiting `send.run` and ignores the
returned write state. A failed write loses the draft and gives the user no
write-specific error. The web composer waits and preserves an immediate
failure, but clears the current field after success even if the user has typed
a new draft while the previous send was in flight.

For Expo, make the client return `failed` for a send: the current handler has
already called `setBody("")`, and the component does not render `send.last`.
For web, submit draft A, keep the promise unresolved, type draft B, then
resolve A as sent: the handler clears B. These are code-traced state sequences;
the reference UIs were not driven in a device simulator for this review.

Preserve the submitted draft on failure, surface the typed write outcome, and
clear only the version of the draft that was actually admitted. Cover sent,
pending, failed, and editing while an earlier send settles. Preserve the
existing offline admission behavior; do not wait for a server acknowledgement
before allowing another independently tracked draft.

## Implementation locations

- [apps/chat/src/Composer.tsx](../../snapback4/apps/chat/src/Composer.tsx)
- [apps/chat-expo/src/Thread.tsx](../../snapback4/apps/chat-expo/src/Thread.tsx)

## Resolution — 2026-09-13

Web and Expo composers preserve failed drafts, show failed outcomes, and clear only the submitted draft revision. Independently edited text survives settlement of an earlier send.

Verification and independent review are recorded in the [correction qualification](../../llp/reviews/3000-review-corrections-20260913.md). Relevant regression or artifact locations:

- [packages/snapback4/test/react.test.mjs](../../snapback4/packages/snapback4/test/react.test.mjs)

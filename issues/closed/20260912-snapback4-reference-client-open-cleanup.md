# Snapback 4: Close clients that finish opening after their component unmounts

Status: Closed
Resolved: 2026-09-13
Priority: P2
Observed: 2026-09-12
Review finding: R37
Evidence: Code traced
Baseline: `d6c803878a5432cce5f045777786a049972d3d70` / Snapback 4 0.0.16
Related: [LLP 3000.001](../../llp/3000.001-durable-replica-and-write-lifecycle.research.md), [comprehensive review](../../llp/reviews/3000-architecture-code-review-20260912.md)

## Problem and reproduction

Both reference apps open a client asynchronously in an effect and retain it in
`live` only after the open promise resolves. Cleanup closes `live` if present.
If the component unmounts while opening, cleanup sees null; the later client
is assigned and never closed. It can continue polling and holding its store,
and a replacement mount may open another client over the same device state.

Use a cancellation/disposal marker for the asynchronous open result. Close a
client immediately if its owning effect has already been cleaned up, and do
not publish its state into the old component. Also avoid reporting an old
open failure into a newer component lifetime. Verify cleanup before resolution,
cleanup after resolution, open rejection and Strict Mode effect replay with a
controlled open promise and close spy. This is a code-traced lifecycle finding;
the related library hook replay failures are separately reproduced in R28.

## Implementation locations

- [apps/chat/src/App.tsx](../../snapback4/apps/chat/src/App.tsx)
- [apps/chat-expo/App.tsx](../../snapback4/apps/chat-expo/App.tsx)

## Resolution — 2026-09-13

Reference app effects dispose a client that opens after cleanup and ignore stale open outcomes. Controlled open promises under real React cover early/late cleanup, rejection and Strict Mode replay. Native startup also probes its read-only receipt before client activity, closes incompatible/failed cores, and reports E_NATIVE_VERSION with update/rebuild guidance instead of appearing online over an old native module.

Verification and independent review are recorded in the [correction qualification](../../llp/reviews/3000-review-corrections-20260913.md). Relevant regression or artifact locations:

- [packages/snapback4/test/react.test.mjs](../../snapback4/packages/snapback4/test/react.test.mjs)
- [packages/snapback4/test/client-lifecycle.test.mjs](../../snapback4/packages/snapback4/test/client-lifecycle.test.mjs)

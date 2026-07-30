# Diary 0034: Campfire current-main rerun

**Application:** Campfire, native Snapback and Convex
**Date:** 2026-07-30
**Snapback revision:** `01e941730306973aadaf21cd50b4c1613d171075`
**Code:** `/Users/ccheever/projects/snapback-workout-matrix-20260729/apps/03-campfire`
**Prior diary:** `diaries/0025-campfire-matrix.diary.md`
**Systems:** Snapback, Convex, chat, shared pagination, inline handlers, result
contracts, native realtime

## Why rerun

The first Campfire implementation found two sharp Snapback problems:
table-shaped JS query results degraded to `unknown`, and newest-first pagination
materialized every message in a room before filtering/slicing. Current main has
inline handlers, exact result contracts, and a bounded direct query-builder
surface. This rerun tests whether those features close the concrete friction
without pretending the experimental membership/relation cursor story is
shipped.

## Current-main changes

The Snapback arm now:

- uses table-scoped IDs for message/reaction relationships;
- colocates all five handlers in `functions.mjs`;
- removes `handlers.mjs`;
- uses `results.documents("messages")` for finite and live message rows;
- uses exact computed/value result contracts for summary, send, and reaction
  toggle; and
- performs pagination with the `by_room_sequence` index plus
  `.lt("sequence", before).order("sequence", "desc").take(limit)`.

The pagination contract remains the paired app's deliberately simple public
cursor: the last returned monotonic sequence is passed as an exclusive
boundary. Convex source and behavior were unchanged.

## Shared pagination: prior versus current

The first diary said Snapback named the correct room index but collected all
room messages before applying the boundary and limit. That functional gap is
closed in this implementation. The current runtime's handler builder pushes
the exclusive range and page limit into the query plan, and the same
`[4,3] → [2,1]` acceptance now runs through bounded storage work.

Discoverability is still weak. The query guide explains indexed reads but does
not show `.lt(...)` plus `.take(...)` for a shared/public cursor. I found the
shipped surface by inspecting `packages/snapback-harness/ctx-bootstrap.js`.
Convex's query-builder documentation and types make the corresponding
`eq().lt().order().take()` path more obvious.

This app is public/dev-mode and intentionally has no room membership model.
Current owner-scoped standard-pattern cursors do not fit it, and LLP 0110's
bounded-children cursor remains experimental. Therefore this rerun does **not**
claim:

- a membership-authorized shared-room cursor;
- an opaque or tamper-resistant cursor;
- cursor binding to authority epochs; or
- `bounded_children_v1` publication.

A production member-only room still needs a stable, documented shared/
membership keyset profile. The current direct path is an honest and efficient
fit for this public deterministic workout, not the complete authorization
answer.

## Colocation and result contracts

`liveMessages` and `messagePage` now use
`results.documents("messages")`, so generated clients receive the complete
stored message document type, including server fields and branded room IDs.
`roomSummary` uses a closed record contract, while send/toggle return exact
objects. All five generated results are precise.

Codegen no longer emitted the prior three degraded-result warnings. The
generated API knows:

- message queries return `ReadonlyArray<GeneratedDataModel["messages"]>`;
- summary returns the exact participant/count record;
- send returns `{messageId, sequence}`; and
- toggle returns `{active, reactionId}`.

The old authored backend was 179 lines across schema/functions/handlers. The
current backend is 191 lines across schema/functions. Colocation removes
registry navigation without dramatically reducing source because result
contracts move type detail into the authoring file.

## Code generation and static evidence

Commands:

```sh
cd /Users/ccheever/projects/snapback
node packages/snapback-codegen/index.mjs \
  /Users/ccheever/projects/snapback-workout-matrix-20260729/apps/03-campfire/snapback-app/snapback

cd /Users/ccheever/projects/snapback-workout-matrix-20260729
npx tsc --noEmit --skipLibCheck \
  --module nodenext --moduleResolution nodenext --target es2022 \
  apps/03-campfire/snapback-app/snapback/generated/api.d.ts
npx tsc --noEmit \
  -p apps/03-campfire/convex-app/convex/tsconfig.json
```

Codegen result:

```text
tables 3; operations 5 (query 2, live query 1, mutation 2)
files 27 (review manifest 1, consumer committed 0, ignored cache 26)
warnings 0
inputsHash 27acc77c1c80…
```

Generated declarations and unchanged Convex types passed. Inspection confirmed
all five functions use `handlerForm: "inline"`, all five have non-unknown
result contracts, and none requires `bounded_children_v1` or
`write_activity_v1`.

The materialized generated tree is 27 files / 3,309 measured lines / 101,600
bytes. Inline bundles and exact contracts account for much of that graph. As
with Relay Board, current codegen classifies only
`artifacts.json` as review-manifest custody. The final matrix commit follows
that policy and retains generated-volume measurements rather than the legacy
full tree.

## Runtime/bootstrap incident

The first current-main real-server attempt failed identically to Relay Board:

```text
SNAPBACK_RUNTIME_CREATE_FAILED: Ibex runtime could not be created
```

The exact-stamp binary predated the final `hermesvm.framework` refresh by about
two minutes. The deeper native refusal was:

```text
Armed startup refused: Hermes promise rejection checkpoint tracking is unavailable
```

`scripts/ibex-doctor` considered the framework present, and server launch/health
alone did not exercise VM creation. Running
`scripts/bootstrap-ibex-runtime` after the framework refresh relinked the clean
`01e9417…` binary. Campfire then passed without code changes.

This must be counted against current-main setup. An exact source stamp and
green server launch were insufficient evidence for JS-handler readiness.

## Real-backend results

Snapback:

```sh
node apps/03-campfire/snapback-app/tests/acceptance.mjs
```

Result: **6/6 passed** on a real isolated current-main server.

- first page: `[4,3]`;
- index-bounded exclusive continuation: `[2,1]`;
- summary: 4 messages, 1 reaction, `Ada/Grace/Linus`;
- reaction toggle: `true → false`;
- whitespace-only send rejected with unchanged state; and
- native client B observed client A's sequence-5 message over the live stream.

Convex:

```sh
cd apps/03-campfire/convex-app
CONVEX_AGENT_MODE=anonymous npx convex dev \
  --start 'node tests/acceptance.mjs' \
  --tail-logs disable --typecheck disable
```

The unchanged Convex arm ran on isolated port 3220 and reported **6/6 passed**
with the same pages, summary, toggle, rollback, and native `onUpdate` evidence.
The watch process was stopped explicitly.

## What improved

- The prior scalability flaw is gone for this public cursor: boundary and limit
  reach the indexed storage plan.
- Table-shaped JS queries now have exact generated document types.
- Colocation removes source/export registry wiring.
- Negative mutation result boundaries are explicit and validated before commit.
- Codegen gives a useful one-screen summary and zero warnings.

## What remains worse or surprising

- The efficient shared pagination path is not discoverable from the current
  query guide; source inspection was required.
- The cursor is still a raw application sequence. Snapback's sealed
  authorization-bound cursor profiles do not yet cover a stable
  membership-shared room.
- Send still scans the room to derive the next sequence. A production chat
  would need a contention-safe sequence allocation or cursor key that does not
  require that scan.
- Current result contracts improve safety and types but add declaration bulk;
  Convex still infers equivalent result types.
- The bootstrap/runtime mismatch could only be seen when a JS handler created a
  VM, after schema/functions load began.

## Priority improvements exposed by the rerun

1. Document the shipped direct query-builder range and `take` surface with a
   public/shared pagination recipe.
2. Stabilize a membership-aware shared keyset cursor without asking apps to
   adopt Review-stage bounded-children publication.
3. Add an efficient server-derived monotonic/page-key pattern for append-heavy
   shared feeds.
4. Exercise real inline-handler VM creation in bootstrap and doctor after the
   final native artifact refresh.
5. Keep exact result contracts while reducing repetitive record-schema
   declarations and making the dense review-manifest diff easier to read.

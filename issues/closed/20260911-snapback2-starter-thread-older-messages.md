# Snapback 2 starter threads need a way to read older messages

**Status:** Closed
**Priority:** P2
**Date:** 2026-09-11
**Systems:** Snapback 2 React/Expo chat threads, composite query items and pagination
**Related:** LLP 1018.008.005, LLP 1018.006, LLP 1019

## Evidence and impact

At `b47337b26`, [React Thread](../../snapback2/packages/snapback2/templates/chat/react/src/Thread.tsx)
and [Expo Thread](../../snapback2/packages/snapback2/templates/chat/expo/src/screens/Thread.tsx)
observe `conversationView` without a continuation argument and render its items.
Neither consumes `snapshot.next` or offers older-message navigation. The
[backend query](../../snapback2/packages/snapback2/templates/chat/snapback/messages.q)
has a cursor and a `last 50` message page. Older permitted messages can therefore
exist without a route to them from the starter thread.

The source establishes the missing control; no new rendered reproduction was
run for this filing. Composite continuation is already supported by the
engine/compiler; the historical nested-page limitation is not this issue.

## Requested outcome and acceptance

- Reach more than 50 permitted messages from each starter through certified
  opaque continuation, with correct order and stable item keys.
- Preserve the count/preview's own query evidence. Loading history must not
  present an unproved scalar or copied receipt as authoritative.
- Preserve pending creates/edits/removes and live boundary changes while older
  pages are mounted. Account/conversation changes release old observations.
- Cover current members, later joiners reading permitted prior history, and
  original recipients using downloaded history offline. A fallback's first-page
  cursor is not a substitute for the primary query's continuation.
- Explain unavailable offline coverage without claiming server exhaustion.
  Verify both client arms and update the affected diary when implementing.

The [composition problem](../../llp/1018.008.005-composing-query-backed-screens.research.md)
may motivate a reusable surface, but this ticket can use existing primitives.
It does not reopen LLP 1018.007.003's repaired feed continuation or duplicate
the benchmark app's separate authorization-specific history follow-up.

## Resolution — 2026-09-11

Both Threads expose Load older messages through one SDK-owned primary/history page resource. Real-owner controls cover 50→100→105 messages, live edits/inserts/removes, and three cold history pages without transport or invented scalar summaries. Whole-row identity and per-view evidence remain separate; a real loss of eligible source requires temporary redaction.

Implemented with the four-plan commission in LLP 1018.008 §13–14. Integrated verification and source-review evidence are recorded there.

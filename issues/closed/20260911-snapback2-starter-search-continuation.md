# Snapback 2 starter search advertises more results without a continuation control

**Status:** Closed
**Priority:** P2
**Date:** 2026-09-11
**Systems:** Snapback 2 React and Expo chat starter search
**Related:** LLP 1018.008.005

## Evidence and impact

At `b47337b26`, both [React Search](../../snapback2/packages/snapback2/templates/chat/react/src/Search.tsx)
and [Expo Search](../../snapback2/packages/snapback2/templates/chat/expo/src/screens/Search.tsx)
read the first search page with `useQuery`. When `result.next` exists, the copy
says "more available", but neither screen offers a control that consumes it.
Users cannot reach later hits through the starter search UI.

This is a source-confirmed UI omission, not a newly executed browser/native
reproduction or evidence of an engine pagination defect.

## Requested outcome and acceptance

- Provide accessible continuation on both starters. With more than one page of
  authorized matches, reach later hits in order without duplicates, using the
  opaque returned cursors and retaining already displayed hits.
- A term/account change must reset the appropriate page chain; late responses
  cannot reinstate the previous query's results.
- Communicate loading and unavailable coverage. A missing continuation on a
  partial result is not proof that all server matches were read.
- Preserve prediction, revocation, live page boundaries, and the existing
  single-word Unicode search semantics. Verify the affected React and Expo
  paths and update their diary with the change.

The broader [composition problem](../../llp/1018.008.005-composing-query-backed-screens.research.md)
does not block this bounded fix. Product-status wording has its own
[ticket](./20260911-snapback2-starter-status-language.md).

## Resolution — 2026-09-11

Both React and Expo Search consume the SDK page resource and expose Show more results. Existing real-owner controls load 20→40 matches, preserve cursor boundaries and clear ineligible search on membership revocation. Product copy and inspected details retain evidence distinctions.

Implemented with the four-plan commission in LLP 1018.008 §13–14. Integrated verification and source-review evidence are recorded there.

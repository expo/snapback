# guide-gap: optimistic create and actionable application errors need a paved React pattern

**Status:** Open
**Impact:** 3
**Urgency:** 3
**Ease:** 4
**Confidence:** 5
**Severity:** P2
**Systems:** Guide, React client, Optimistic mutations, Generated IDs, Diagnostics
**Found by:** LLP 0138 Latency Kanban and Contention Calendar
**Date:** 2026-08-01
**Governing:** LLP 0061, LLP 0107, LLP 0138

## Problem

The Snapback Guide explains optimistic update, rollback, and authoritative
matching, but the Zero bakeoff exposed two adjacent authoring cases without a
paved example:

1. A create mutation whose canonical row ID is server-minted cannot safely
   project a complete generated row. The generated branded `Id<'reservations'>`
   type correctly rejects a forged provisional ID. Contention Calendar used an
   app-local pending sidecar, but the Guide did not teach that workaround or a
   first-class intent-ID reconciliation path.
2. A domain rejection such as `CARD_LOCKED` reaches the public mutation surface
   as `SNAPBACK_HANDLER_FAILED`. Latency Kanban had to retain local context to
   show actionable UI copy rather than parse unstable handler text. The Guide
   explains platform diagnostics but does not show how an optimistic React
   flow should preserve safe domain-specific failure details through rollback.

Zero's shared mutator and client-selected IDs made the speculative create fit
the normal query store, which made the missing Snapback path especially clear.

## Evidence

- `diaries/0043-latency-kanban-zero-bakeoff.diary.md`
- `diaries/0044-contention-calendar-zero-bakeoff.diary.md`
- `demos/zero-bakeoff/apps/latency-kanban/snapback/src/App.tsx`
- `demos/zero-bakeoff/apps/contention-calendar/snapback/src/App.tsx`

## Suggested resolution

- Add a CI-verified optimistic-create example with a client intent ID,
  server-minted canonical ID, typed provisional presentation, success mapping,
  and rollback.
- Document when an app-local pending sidecar is the correct current pattern.
- Add a safe, structured application-error example that survives optimistic
  rollback without exposing internal exception text.
- Link both examples from the React optimistic-mutation guide and capability
  index; record an explicit GAP row if the first-class API does not yet exist.

## Acceptance

- a clean Guide-led React demo can optimistically create a server-ID row without
  forging a generated ID;
- rejection removes only the corresponding provisional item and shows a stable
  declared application code/details payload;
- settlement maps one intent to one canonical row under ambiguous retry; and
- `node scripts/check-guide.mjs` exercises the example and capability-index
  coverage.


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

## Running log

- **2026-08-04 — interaction with the new replay advisory (LLP 0107
  replay-safety affordances).** The development replay-divergence advisory
  landed by issues/closed/20260804-optimistic-projection-replay-lint-and-helpers.md
  checks reducer idempotence over its own output. An append-shaped
  optimistic-create reducer (`rows => [...rows, capturedRow]`) is replay-safe
  under rebase-over-authority but not idempotent over its own output, so it
  will trip the advisory (dev-only, once per site). When this ticket paves
  the optimistic-create path, either teach the advisory to tolerate the
  paved append shape or have the paved helper mark its layers exempt — do
  not just tell authors to ignore the warning.
- **2026-08-07 — docs-only honest part absorbed; remains open for the
  CI-verified paved example.** `guide/clients/react.md` gained two sections:
  "Optimistically create a row the server will name" (documents why the
  branded-ID forgery refusal is deliberate, teaches the intent-keyed pending
  sidecar as the current paved shape, and notes an append-shaped reducer also
  trips the replay advisory) and "Show stable application errors through
  rollback" (routes to the `refusals`/`ctx.refuse` → `SNAPBACK_APP_REFUSAL`
  `appCode` channel that landed in 0.1.9 and is documented in
  `backend/mutations.md` — this closes the ticket's item 2 mechanism; what it
  needed at filing time now exists first-class). Capability index: new
  explicit GAP row `clients.optimistic-create` (owner: ccheever, review
  2026-09-30, pointing at this ticket) plus grep aliases on `clients.react`
  and `backend.functions`; retrieval-eval seed case 16 added. Still open:
  this ticket's acceptance — a Guide-led, CI-verified demo example of
  intent-ID optimistic create with one-intent/one-row settlement under
  ambiguous retry (and its interaction with the replay advisory, per the
  2026-08-04 note), which is demo build work plus possibly a first-class
  provider API, not prose. The sidecar section documents the workaround; the
  GAP row keeps the missing capability visible.
- **2026-08-03 — triaged in the guide re-verification pass; remains open.**
  This ticket's acceptance needs a new CI-verified demo example (intent-ID
  optimistic create + structured application-error survival through
  rollback), which is demo build work, not prose absorption — the existing
  zero-bakeoff sidecar code is bakeoff-arm evidence, not a Guide-led paved
  example. Deliberately not absorbed docs-only; needs an owner to land the
  example demo change and guide section together.


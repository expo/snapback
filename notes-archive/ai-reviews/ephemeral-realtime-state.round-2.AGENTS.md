# Review: LLP 0013 — Ephemeral realtime state (round 2)

**Reviewed:** `llp/0013-ephemeral-realtime-state.rfc.md`
**Reviewer:** Codex
**Date:** 2026-06-25
**Revision outcome:** Applied narrow revisions to the LLP after review.

## Overall assessment

This is a good proposal and the subsystem boundary is still right. LLP 0013 now
does the important job LLP 0008 left open: it tells agents and implementers that
presence, cursors, typing indicators, and similar high-frequency awareness state
belong in typed, scoped, TTL-bound ephemeral collections, not in durable table
sync and not behind app-visible Redis or memcached APIs.

The current draft is strong enough to guide the first local-process prototype.
The main remaining risk is not conceptual; it is empirical. Snapback still needs
to measure the fan-out ceiling, lane scheduling behavior, auth invalidation, and
restart/resubscribe recovery before this should be treated as a settled hosted
adapter contract.

## Strengths

- The durable / ephemeral / cache vocabulary gives agents an actionable decision
  rule instead of a vague performance preference.
- Scoped rooms, generated auth, TTLs, snapshot-first subscriptions, coalescing,
  and explicit backpressure are the right semantics for presence-like data.
- The proposal keeps storage mechanics behind an adapter, preserving the local /
  hosted / Cloudflare portability line from the surrounding LLP corpus.
- Delivery lane isolation is now measurable: ephemeral floods should not delay
  durable mutation acknowledgements or committed query-result deltas.
- The app API boundary is appropriately conservative: server-side reads of
  ephemeral state are outside the v1 paved path.

## Concerns

- **C1 — Client expiry should not depend on clock sync. [Medium]** The draft said
  the server provides wall-clock receive/expiry values or a monotonic basis.
  Presence cleanup is important enough that the client runtime should be able to
  schedule pruning using client-local monotonic time after receiving server TTL
  metadata. I revised the TTL section to make that requirement explicit.

- **C2 — Cross-document ownership was bundled into one open question. [Low]** API
  syntax ownership, auth-rule syntax ownership, and storage-portability bundle
  exclusions are separate follow-ups. I split these into separate open questions
  so LLP 0004, LLP 0011, and LLP 0007 can each absorb the right piece.

- **C3 — The LLP 0007 handoff overclaimed slightly. [Low]** LLP 0007 already
  excludes several non-durable runtime values, but it does not yet enumerate
  ephemeral realtime rooms. I revised the text to say 0013 treats these rooms as
  the same class and that 0007 should enumerate them on its next revision.

- **C4 — Status language needed sharper readiness boundaries. [Low]** The draft
  correctly says it answers the product-boundary question, but that can sound
  more final than intended. I revised the status section to say it is ready to
  guide the local prototype while remaining Draft until measurements exist.

- **C5 — The highest-risk question remains the measured fan-out ceiling. [Medium]**
  No prose change can settle the many-clients/high-frequency case. The first
  prototype should make this visible through benchmarks and diagnostics before
  hosted adapter decisions harden.

## Suggestions

- Keep `Status: Draft` for now. After the local prototype validates the listed
  acceptance cases, update the LLP to `Review` for broader ratification rather
  than silently treating the RFC as accepted.
- Add a focused implementation spike that measures cursor publish rates, room
  subscriber counts, durable-lane delay under ephemeral pressure, and restart /
  resubscribe behavior.
- When LLP 0004 or a follow-on API spec is revised, pin the generated ephemeral
  collection syntax there instead of letting this RFC's illustrative names become
  accidental API.
- When LLP 0011 or a follow-on auth API spec is revised, pin the `allow.*`
  permission-rule shape used by ephemeral publish and subscribe rules.
- When LLP 0007 is revised, explicitly list ephemeral realtime rooms among values
  excluded from the logical portable bundle.

## Open questions

- What benchmark target should determine whether the v1 local process fan-out
  ceiling is acceptable?
- Should hosted adapters be designed only after local measurements, or should a
  Redis-compatible prototype run in parallel to test the abstraction?
- Should the client API expose remaining TTL directly, an absolute server
  deadline, or both?
- What is the least surprising generated shape for composing durable query
  results with ephemeral overlays in React and headless clients?

## Revisions applied

- Updated `Revised` to mark this as the second review pass.
- Added LLP 0005 to `Related` and referenced it where generated clients and React
  bindings compose durable query results with ephemeral overlays.
- Clarified that client expiry pruning must be scheduleable without synchronized
  wall clocks.
- Noted that the `boardCursors` example deliberately mirrors the v1 local budget
  defaults.
- Reframed the LLP 0007 bundle-exclusion handoff.
- Split syntax and portability ownership into separate open questions.
- Clarified that the RFC should remain Draft until prototype measurements exist.

## GPT review note

The LLP process also recommends a GPT-family review. This Codex review can serve
as that pass if that is what the author intended; otherwise, create a separate
canonical GPT review artifact before treating the review loop as complete.

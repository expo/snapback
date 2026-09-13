# Proposal to LLP 0193 Phase 4: out-of-checkout `snapback feedback` verb

**Opened:** 2026-08-09
**Origin:** LLP 0207 dissolution (Withdrawn; dual-family review record
under `llp/reviews/0207-*`)
**Proposed owner:** LLP 0193 (errors-as-docs completeness), whose Phase 4
grading loop is the consumer — this ticket is an amendment proposal to
that document's owner, not commissioned work.


## Triage (2026-08-26 leftover sweep)

Still open as **implementation**. Accepted into LLP 0193 Phase 4. No `feedback` verb in `packages/snapback-cli` or `crates/snapback-cli`.

## Proposal

A `snapback feedback "<text>"` verb usable from any installed closure
(the expo-skill-feedback posture), feeding LLP 0193 Phase 4's grading
loop with out-of-checkout friction reports. Motivation: the npm-consumer
population is invisible to the grading loop today (LLP 0202 theme 5's
surface inventory shows no feedback affordance), so refusal grading runs
on internal benchmark evidence only. If accepted, the verb is also a
candidate *naturalistic evidence channel* for the measurement gates in
LLP 0186's failure-to-recovery trace amendment.

## What was evaluated and rejected (do not re-propose)

The 0207 review loop killed **opt-in `SNAPBACK_*` code-frequency
telemetry**: it observes the refusal-reachable population (not the
no-refusal layer that motivated it), and frequency without a
denominator, recovery outcome, or action trace cannot feed one-attempt
grading. Telemetry waits for a demonstrated question it can answer. See
`llp/reviews/0207-agent-efficiency-round-two.gpt-5.md` round 1
concern 6.

## Open design questions for the owner

Endpoint ownership, retention, consent copy — the former LLP 0207 OQ4.

## Disposition if declined

Remains a filed ticket; no verb lands anywhere else.

## Author ruling — 2026-08-10

Accepted in principle — build it. Ownership assigned as proposed to LLP 0193
(the Phase 4 grading loop is the consumer). Fences: explicit invocation
only, no ambient collection (the rejected telemetry stays rejected); the
owner designs endpoint ownership, retention, and consent copy before the
verb ships. Nothing else blocks on this.

**2026-08-10:** Amendment draft exists — LLP 0193 now carries the design
as "Dated amendment — 2026-08-10: the `snapback feedback` verb (Phase 4
intake)" (surface, exhaustive payload, consent copy, endpoint, retention,
Phase 4 wiring, failure behavior; three short items flagged for author
confirmation).

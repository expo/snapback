# Review: LLP 0000 Snapback, Round 2

**Reviewed:** 2026-06-25
**Reviewer:** Codex
**Target:** `llp/0000-snapback.explainer.md`

## Overall Assessment

LLP 0000 is doing the right job for a root document. It states the product
direction, names the core subsystems, records Contract/Exact and agent-first as
design drivers, and surfaces the important unknowns instead of pretending they
are solved.

The document is strong enough to remain the active root direction. The remaining
weaknesses are mostly unresolved definitions and follow-on ownership, not
contradictions in the root thesis.

## Strengths

- The document cleanly separates ratified direction from subsystem contracts
  that still need follow-on LLPs.
- The canonical local target and implementation order give agents a concrete
  default instead of a vague deployment matrix.
- The reference-app list is useful because it tests breadth of capability, not
  just a happy-path CRUD app.
- The non-goals section keeps the ambitious scale-up story bounded.
- The Valet and prior-art links correctly make empirical recovery part of early
  design work.

## Concerns

1. **Contract/Exact is still not defined.** The doc explicitly says it cannot
   define the term without the ratifying source. That is honest, but it remains
   the biggest orientation gap for agents.

2. **The root document is becoming broad.** Reference apps, non-goals,
   implementation order, deployment, local target, and follow-on work are all
   useful here, but this file should not absorb the detailed specs. It needs to
   stay a map.

3. **The scale-to-zero language is still aspirational.** The target-dependent
   caveat is good, but the workload envelope and billing envelope need their own
   measurable documents before agents make architectural tradeoffs from the
   phrase.

4. **Security/isolation is correctly called out but not yet a first-class
   cross-cutting section.** It can wait for a follow-on LLP, but any code
   execution work should treat it as load-bearing from day one.

## Suggestions

- Keep the `Contract/Exact` wording as an explicit terminology gap until Charlie
  supplies a canonical definition and link.
- Rename the "Twitch-style realtime games" non-goal to avoid confusion with the
  Twitch product; the intended point is fast-action/tick-rate games.
- Keep LLP 0000 active, but route detailed work into the follow-on documents it
  lists.

## Open Questions

- What canonical document defines Contract/Exact and Exact Design Mode?
- Which reference apps are launch acceptance targets versus later stress tests?
- What is the first Cloudflare target profile?
- What sandbox and tenancy model should govern executed JavaScript?

## Revisions Applied

- Clarified the Contract/Exact gap without inventing a definition.
- Renamed the realtime-game non-goal to avoid an ambiguous product-style label.

The LLP process also recommends a GPT review unless this Codex review is the GPT
review wanted for this round.

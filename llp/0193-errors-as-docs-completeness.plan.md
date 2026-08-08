# LLP 0193: Errors-as-docs completeness program

**Type:** Plan
**Status:** Draft
**Systems:** Diagnostics, Error handling, Guide, Agent experience, CI
**Author:** Charlie Cheever / Claude
**Date:** 2026-08-08
**Related:** LLP 0186 (W3 states the bar), LLP 0146 (D7 — typed
remediations, ratified at sitting #4), LLP 0010 (diagnostic codes),
diaries 0065-0069

## Summary

Five measurement runs agree that error quality is Snapback's
best-performing agent-efficiency investment: lanes repeatedly resolved
failures fastest when the refusal named its own fix (the PNG-CRC
diagnostic naming the failing chunk is the exemplar), and every remaining
expensive detour traces to a code that didn't. LLP 0186 W3 states the
bar — **every `SNAPBACK_*` refusal an authoring agent can trigger names
the violated rule and either the fix or a resolving guide anchor** — but
the bar has only ever been applied to codes that happened to appear in
diaries. This Plan audits the entire population once and then makes the
bar structural, so it can never regress.

## Evidence

- Diary 0069: zero framework defects, yet six of the run's expensive
  moments were knowledge-shaped — half of them reachable from a refusal
  that could have carried the answer.
- The counterexamples prove the mechanism in both directions: refusals
  that named remediations (`snapback assets put --user`, the CRC chunk,
  seed-recovery messages) cost near-zero; refusals that did not (the
  0.1.10-era `host-ops response was not JSON`, the hashed field path)
  each cost a bisection session.
- The infrastructure half-exists: stable code registry, the
  production diagnostic-inventory drift gate, and 0146 D7 ratified as
  the remediation carrier.

## Program

**Phase 1 — enumerate and grade.** Extract the complete `SNAPBACK_*`
code inventory (estimated 200-500 codes) from the diagnostic registry
plus a grep sweep for unregistered emissions. Fan out grading lanes:
each code graded A (names rule + fix/anchor), B (names rule only), or
C (bare), with the emitting site and agent-triggerability recorded.
Output: a checked-in graded ledger under `tests/acceptance/diagnostics/`.

**Phase 2 — fix in evidence order.** First: every B/C code that appears
in any diary's correction-loop list. Then B/C codes on
agent-triggerable paths, batched by subsystem. Message edits follow the
house style; guide anchors must resolve (check-guide enforces). Codes
that are genuinely internal (never agent-triggerable) are marked so in
the ledger rather than polished.

**Phase 3 — the ratchet.** Extend the diagnostic-inventory drift gate:
a new agent-triggerable code cannot land without a remediation field or
resolving guide anchor (this is 0146 D7's enforcement carrier — the
typed `remediations` shape lands here if not already built). Anchor
resolution joins CI. The graded ledger becomes the gate's baseline;
grade regressions fail.

**Phase 4 — close the loop with measurement.** The next benchmark run's
lane reports grade every refusal encountered; new B/C sightings are the
recurring audit input.

## Exit criteria

1. Graded ledger covers 100% of registered codes; zero ungraded
   emissions in the sweep.
2. Every diary-cited code is grade A.
3. The drift gate refuses a new agent-triggerable code without
   remediation/anchor (negative test).
4. A benchmark run passes with zero C-grade refusals encountered.

## Open questions

- OQ1: Whether D7's typed `remediations` array (structured) or message
  text + anchor (unstructured) is the Phase 3 minimum — structured is
  the 0146 design; text+anchor may be the pragmatic floor for the long
  tail. Proposal: structured for new codes, text+anchor acceptable for
  audited legacy codes until touched.
- OQ2: Grading authority for "agent-triggerable" — proposal: reachable
  from any published-surface operation, decided by the grading lane,
  spot-checked in review.

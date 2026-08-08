# LLP 0193: Errors-as-docs completeness program

**Type:** Plan
**Status:** Review
**Systems:** Diagnostics, Error handling, Guide, Agent experience, CI
**Author:** Charlie Cheever / Claude
**Date:** 2026-08-08
**Revised:** 2026-08-08 (r3) — pre-round-3 minors (citation precision, diary enumeration). 2026-08-08 (r1) — super-refine round-1 revision against the
dual-family cluster reviews (llp/reviews/0193-*.{claude,gpt-5}.md):
unretained/incorrect quantitative claims corrected to retained-artifact
citations; see the review artifacts for the concern ledger.
**Related:** LLP 0186 (W3 states the bar), LLP 0146 (D7 — typed
remediations, ratified at sitting #4), LLP 0010 (diagnostic codes),
diaries 0065/0066/0068/0069

## Summary

Across the retained measurement series, refusal-quality incidents
resolved fastest when the refusal named its own fix — diary 0048's
`SNAPBACK_ASSET_IMAGE_DECODE_FAILED` carrying the exact upstream parser
error, and the anonymous-upload refusal naming `snapback assets put
--user` (diary 0065's tickets) are retained exemplars — while several of
the expensive detours trace to refusals that carried neither rule nor
fix. (Additional unretained lane-report incidents exist but are not
cited as evidence here.) LLP 0186 W3 states the
bar — **every `SNAPBACK_*` refusal an authoring agent can trigger names
the violated rule and either the fix or a resolving guide anchor** — but
the bar has only ever been applied to codes that happened to appear in
diaries. This Plan audits the entire population once and then makes the
bar structural, so it can never regress.

## Evidence

- Diary 0069: zero framework defects, yet the run's expensive moments
  were knowledge-shaped — several reachable from a refusal that could
  have carried the answer.
- The retained record shows the mechanism in both directions: refusals
  that named remediations (`snapback assets put --user`, diary 0048's
  decode diagnostic, the seed-recovery messages) cost near-zero;
  refusals that did not each cost a bisection session — diary 0058's
  "host-ops error response was not JSON" (in-checkout era;
  `issues/closed/20260805-managed-dev-multi-json-load.md`) and the
  SHA-256-hashed field path
  (`issues/closed/20260805-result-contract-violation-hashes-field-path.md`).
- The infrastructure half-exists: stable code registry, the
  production diagnostic-inventory drift gate, and 0146 D7 ratified as
  the remediation carrier.

## Program

**Phase 1 — enumerate and grade.** Extract the complete `SNAPBACK_*`
code inventory (a raw identifier sweep finds ~2,700 `SNAPBACK_*` symbols
including env vars and test constants; the diagnostic subset is the
real population and Phase 1 establishes its size) from the diagnostic registry
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
a new agent-triggerable code cannot land without a remediation in the
carrier LLP 0146 OQ6 selects, or a resolving guide anchor as the interim
floor. The typed-remediation end state is 0146's ratified D7 and is not
reopened here; the carrier choice is OQ6's open ruling
(`issues/20260806-llp0146-oq6-remediation-carrier-decision.md`) and is a
named dependency of this phase's structured half — until it rules, the
gate enforces text+anchor as a bounded interim floor, upgraded
code-by-code as the carrier lands. Anchor
resolution joins CI. The graded ledger becomes the gate's baseline;
grade regressions fail.

**Phase 4 — close the loop with measurement.** The next benchmark run's
lane reports grade every refusal encountered; new B/C sightings are the
recurring audit input.

## Exit criteria

1. Graded ledger covers 100% of registered codes; zero ungraded
   emissions in the sweep.
2. **Every ledger entry classified agent-triggerable is grade A** (the
   program's declared bar; diary-cited codes are merely the first
   batch).
3. The drift gate refuses a new agent-triggerable code without
   remediation/anchor (negative test), and refuses grade regressions.
4. A benchmark run encounters zero B- or C-grade refusals — as
   validation of criterion 2, not a substitute for it.

## Open questions

- OQ1: The migration bound — how long audited legacy codes may remain
  on the text+anchor floor after the OQ6 carrier ruling lands. Proposal:
  structured on next touch, with a dated full-migration milestone set
  when the carrier ships (the typed end state itself is settled by
  0146's ratified D7, not by this Plan).
- OQ2: Grading authority for "agent-triggerable" — proposal: reachable
  from any published-surface operation, decided by the grading lane,
  spot-checked in review.

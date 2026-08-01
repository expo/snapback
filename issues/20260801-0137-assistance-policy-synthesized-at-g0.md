# LLP 0137 G0 froze a synthesized assistance policy — author should ratify

**Opened:** 2026-08-01
**Area:** LLP 0137 improvement sweep, Stage 0 (G0)
**Type:** author-decision / freeze note

## Observation

LLP 0137's G0 gate requires freezing "the assistance policy", but the Plan
never defines a standalone assistance policy. Its assistance rules are
scattered across the external-consumer posture (guide and public docs as the
only sanctioned documentation; posture breaks are findings), the fix-loop
rules, budgets-as-instruments, the honesty controls, and the inheritance of
LLP 0102's assistance-event discipline.

Stage 0 therefore froze a synthesis:
`demos/improvement-sweep/protocol/assistance-policy.v1.json`
(`llp-0137-external-consumer-assistance-v1`), assembled only from rules the
Plan states or explicitly inherits from LLP 0102. Notable synthesis choices:

- Snapback repository source inspection and repository-relative imports are
  recordable assistance events that also file posture-break findings (0137
  makes posture breaks findings; 0102 made source inspection an assistance
  event — the synthesis does both).
- Cross-arm knowledge inside the Snapback sweep is not an assistance event
  (0137 orders arms by ascending ambition explicitly so early arms teach
  later ones), but knowledge imported into a probe from a Snapback arm, or
  between probe providers, is one.
- 0102's independent-review block is not carried into Phase 1 (Phase 1
  produces no scores to audit); it returns with Phase 2's own freeze.

## Ask

Charlie (or a 0137 author session) confirms or amends the synthesized policy
before G1 completes. Amending it after a diaried arm starts requires a dated
prospective amendment and a re-freeze per the freeze boundary.

## Resolution

Open.

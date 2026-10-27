# Transition review resolutions

These are author/implementer responses, not additional model reviews. Original
responses and provenance remain verbatim under llp/reviews/.

- Round1 Codex: preserve non-actor stored prerequisites; reject auxiliary asserted
  reads. Fixed by870c3debfa/1f9d20e2be with closed/open-window and assertion
  regressions. Both round2 reviewers found these changes conservative.
- Round2 Codex: printed secondary writes omitted their typed descriptors (USD/EUR
  can share numeric0). Fixed by33317ed2ae: every written field's ColumnType is in
  both source-effect descriptors. The CLI regression uses identical zero-value
  replay rows/args and a factual candidate, requiring a renewed decision.
- Round2 Muse predicted035 was skipped, quoting same-side comparisons. The actual
  reviewed1f9d20e2be source compared opposite sides, and the contemporaneous five
  language and two complete-collector tests passed, including the actual cleaner.
  This source-only prediction was not an observed failure. Independently, the
  syntactic old-guard suppression is removed in33317ed2ae: actual engine admission
  judges the jump even when redundant/partial guards mention the old stage. The
  proper ordered repair is checked against the same bad-edge hypothesis, not
  merely by disappearance of a syntactic detector. This also eliminates the
  disputed carve-out from the final source.

Final independent review and native corpus measurement remain required.

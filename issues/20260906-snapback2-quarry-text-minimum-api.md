# Snapback2 Quarry declared text minimum accepts empty API input

Status: Open
Date: 2026-09-06
Scope: Snapback2 compiler / argument validation

Independent Clique M7 grading on published `snapback2@0.0.6` committed an
empty poll question and an empty option through the ordinary API despite
`body: text 1..200` and `options: [text 1..50]` declarations. Upper length
and option-cardinality checks refused their invalid inputs. The UI disables
empty questions, which hides the API behavior. The backing message body has
only an upper bound, so source-table validation cannot supply the omitted
argument constraint.

Evidence: [independent report](../benchmarks/runs/2026-09-06-clique-improvement/evidence/m7-completion-006/independent-grader-report.md),
Additional M7 requirements. This is a published-version observation, not yet
a reproduced diagnosis on the current candidate.

Next: reproduce minimally outside the frozen benchmark; identify whether
lowering or runtime validation loses the declared bound; fix with before/after
coverage for scalar and nested list text arguments. Preserve the frozen result.

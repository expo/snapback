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

Evidence: [independent report](../../benchmarks/runs/2026-09-06-clique-improvement/evidence/m7-completion-006/independent-grader-report.md),
Additional M7 requirements. This is a published-version observation, not yet
a reproduced diagnosis on the current candidate.

Next: reproduce minimally outside the frozen benchmark; identify whether
lowering or runtime validation loses the declared bound; fix with before/after
coverage for scalar and nested list text arguments. Preserve the frozen result.


The coordinated candidate now has actual native admission evidence:74 original
query/mutation/job cases pass (including empty-table job enqueue refusal), and
77 separate paired channel argument cases pass both HTTP subscribe and publish.
The latter includes Optional/List/nested List forms,49 refused pairs with no
observed invalid event or authorized-subscription delta, and28 accepted pairs.
All83 expected events were observed; the no-event claim is bounded by recorded
quiet windows and stream lifetimes. Production bearer authentication is not
qualified by this private-persona witness. Both reports and original harness
corrections are retained under evidence/minimum-api-provisional04 and
evidence/channel-minimum-provisional04. Code integration/review/publication is
still pending; keep this ticket open until the implemented fix lands.

## 2026-09-11 triage and resolution

**Priority:** P2. **Disposition:** Closed; the implementation, direct compiler
path, native/twin validation, and public guide contract have landed.

Commit `799ba19a6` added recursive `Text.min` admission and fenced the v5 value
model/evaluator graph; commit `5c35f692d` preserved those descriptors in
direct Quarry. `engine/mod.rs::validate_arg_value` checks descriptor bounds
before execution, while `value-runtime.ts::validateTypedValue` enforces the
same recursive minimum. Packaged `guide types` documents `text M..N` and says
minimums are enforced.

**Verification:** `cargo test -p snapback2-core text_minimum_` passed
`text_minimum_counts_scalars_recursively_and_keeps_canonical_identity`,
`text_minimum_certification_execution_channel_and_semantic_fence`, and
`text_minimum_refuses_before_empty_job_enqueue` on 2026-09-11. The compiler
suite passed `direct Quarry preserves recursive text refinements and refuses
them before the body`; the evaluator suite passed its v5 recursive minimum
checks. These cover scalar, nested list, query/mutation/job, and channel
admission before side effects.

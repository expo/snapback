# Grok Workroom-record review

Received 2026-09-16, fresh independent `grok-4.6`, xhigh (native model
`grok-4.6-build`), session `01a0abbb-cf48-7b20-8cdc-865c128051b5`.
The prompt bound integrated commit `ff50d3fed`'s four-file delta and supplied
its complete diff plus relevant validator context inline. No tools, other
review or authoring context were supplied. The reviewer reasoned over the
scenarios; it did not execute the tests. Actual final review follows.

**READY**

Workroom machine records are admitted only for `team-workspace`, with raw nullable B/O dimensions, shared builder points, three independent panels, and a per-grader total that is either the declared 100-point sum or explicit null. Existing briefs stay on `outcomeRubric` / `invariantPlatformScore`. I did not treat the 10/10 tests as the review.

## What the delta actually enforces

**Routing.** `brief` may be `team-workspace`. That brief requires `workroomScore` and forbids `rubric` / `outcomeRubric` / `invariantPlatformScore`. Any record that carries `workroomScore` must have `brief: "team-workspace"`. Other briefs still need the old two-layer fields. Schema.md matches that exception and still calls the instrument Draft.

**Shape.** Source is pinned to `benchmarks/briefs/team-workspace.md#scoring`. Builder has evidence, B1–B10, and `holisticBeforeTotal` (0–100 or null). Graders are exactly `astra` / `grok` / `muse`, each with scorer, `scored|unavailable`, evidence (`minItems: 1`), O1–O5, and `combinedTotal`. Extra Workroom keys are rejected in the loader because schema validation tolerates additive fields.

**Weights and totals.** Point contributions are O 13/8/10/8/6 and B 6/6/8/5/5/4/5/6/6/4 (45 + 55 = 100). `combinedTotal = Σ(dimension × weight / 100)` over all 15 dimensions. `holisticBeforeTotal` is not in that sum. There is no layer subtotal and no Astra/Grok/Muse average.

- Any null B or O ⇒ that grader’s `combinedTotal` must be null (`WORKROOM_SCORE_NULL_AGGREGATE`).
- All 15 present ⇒ `combinedTotal` must match within `1e-9` (`WORKROOM_SCORE_AGGREGATION_MISMATCH`).
- `unavailable` with any non-null O or a non-null total is rejected (`WORKROOM_SCORE_STATUS_MISMATCH`). `0` is a score, not “unmeasured” (the o1=0 case).

**Checked scenarios (admitted).** All-80 builder + panels 80/60/100 → totals 80/71/89. Unequal dimensions that only sum to 53 under the public weights. Honest `unavailable` panels with every O null, null total, and an evidence pointer. One incomplete O on an otherwise complete panel, if total is null.

**Checked scenarios (rejected).** Missing B1; extra `b11Undeclared`; `combinedTotal` 81 vs 80; o3 null with a leftover total; B10=101; `unavailable` plus o1=0; `rubric: {}` on a Workroom record.

**Non-regression.** Messaging-style records without `workroomScore` never enter `validateWorkroomScore`. Inventory now hard-fails the four Workroom reasons instead of swallowing a bad total.

## Residuals (not blocking)

- `status: "scored"` with every O null and `combinedTotal` null is still admitted as incomplete measurement. Totals cannot be fabricated that way; `unavailable` is only mandatory when that status is claimed. `benchmarks/tools/lib/record-loader.mjs` (`validateWorkroomScore`, unavailable-only `WORKROOM_SCORE_STATUS_MISMATCH` branch).
- Mixed panels (two scored, one unavailable) are not in the new tests; the per-grader loop still applies the same rules independently.

Publisher rendering and comparative publication were not reviewed (out of scope).
